"""
Screener Pipeline

Handles synchronization of screener/financial ratio data from vnstock providers.
"""

import asyncio
import logging
from datetime import date
from typing import Any, Dict, List, Optional

import pandas as pd
from sqlalchemy import select, and_, func

from vnibb.core.cache import build_cache_key
from vnibb.core.cache_constants import PIPELINE_TTL_SCREENER
from vnibb.core.config import settings
from vnibb.core.retry import with_retry
from vnibb.core.vn_sectors import resolve_sector_name
from vnibb.models.stock import Stock, StockPrice
from vnibb.models.company import Company
from vnibb.models.screener import ScreenerSnapshot
from vnibb.services.pipeline.base import BasePipeline, get_upsert_stmt

logger = logging.getLogger(__name__)


class ScreenerPipeline(BasePipeline):
    """Pipeline for synchronizing screener/financial ratio data."""

    def __init__(self):
        super().__init__()

    def _normalize_text(self, value: Any) -> Optional[str]:
        if value is None:
            return None
        if isinstance(value, float) and pd.isna(value):
            return None
        raw = str(value).strip()
        return raw or None

    def _parse_float(self, value: Any) -> Optional[float]:
        if value is None:
            return None
        if isinstance(value, float) and pd.isna(value):
            return None
        try:
            parsed = float(value)
            if pd.isna(parsed):
                return None
            return parsed
        except (TypeError, ValueError):
            return None

    def _normalize_share_count(self, value: Any) -> Optional[float]:
        parsed = self._parse_float(value)
        if parsed in (None, 0):
            return None
        if abs(parsed) < 1_000_000:
            return parsed * 1_000_000.0
        return parsed

    def _pick_float(self, *values: Any) -> Optional[float]:
        for value in values:
            parsed = self._parse_float(value)
            if parsed is not None:
                return parsed
        return None

    def _normalize_dividend_yield(self, value: Any) -> Optional[float]:
        parsed = self._parse_float(value)
        if parsed is None:
            return None
        normalized = parsed
        while abs(normalized) > 100:
            normalized /= 100
        return normalized

    @with_retry(max_retries=3)
    async def sync_screener_data(
        self,
        symbols: Optional[List[str]] = None,
        exchanges: Optional[List[str]] = None,
        limit: Optional[int] = None,
        progress: Optional[Dict[str, Any]] = None,
        sync_id: Optional[int] = None,
    ) -> int:
        """Sync comprehensive metrics for stocks using vnstock finance.ratio."""
        from vnibb.providers.vnstock.runtime import get_listing_class, get_vnstock_class

        Listing = get_listing_class()
        Vnstock = get_vnstock_class()

        logger.info("Syncing screener data...")
        loop = asyncio.get_running_loop()

        normalized_exchanges: List[str] = []
        if exchanges:
            normalized_exchanges = [
                exchange.strip().upper()
                for exchange in exchanges
                if isinstance(exchange, str) and exchange.strip()
            ]

        if symbols:
            symbol_list = [
                symbol.strip().upper()
                for symbol in symbols
                if isinstance(symbol, str) and symbol.strip()
            ]
            deduped_symbols = list(dict.fromkeys(symbol_list))
        else:
            async with self._get_session() as session:
                stmt = select(Stock.symbol).where(Stock.is_active == 1)
                if normalized_exchanges:
                    stmt = stmt.where(func.upper(Stock.exchange).in_(normalized_exchanges))
                result = await session.execute(stmt)
                deduped_symbols = [str(row[0]).upper() for row in result.fetchall() if row[0]]

        if limit is not None and limit > 0:
            deduped_symbols = deduped_symbols[:limit]

        if not deduped_symbols:
            logger.warning("No symbols found in database for screener sync.")
            return 0

        stock_metadata: Dict[str, Dict[str, Any]] = {}
        async with self._get_session() as session:
            rows = await session.execute(
                select(Stock.symbol, Stock.company_name, Stock.exchange, Stock.industry).where(
                    Stock.symbol.in_(deduped_symbols)
                )
            )
            for symbol, company_name, exchange_value, industry_value in rows.fetchall():
                stock_metadata[str(symbol).upper()] = {
                    "company_name": self._normalize_text(company_name),
                    "exchange": self._normalize_text(exchange_value),
                    "industry": self._normalize_text(industry_value),
                }

        start_index = 0
        if progress and progress.get("stage") == "screener":
            last_index = progress.get("last_index")
            last_symbol = progress.get("last_symbol")
            if isinstance(last_index, int) and last_index >= 0:
                start_index = last_index + 1
            elif last_symbol and last_symbol in deduped_symbols:
                start_index = deduped_symbols.index(last_symbol) + 1

        batch_size = 20
        today = date.today()

        total_synced = 0
        for idx in range(start_index, len(deduped_symbols)):
            symbol = deduped_symbols[idx]
            try:
                await self._wait_for_rate_limit("screener")

                def _fetch_sync():
                    vnstock = Vnstock()
                    try:
                        df = vnstock.finance.ratios(symbol=symbol)
                        return df
                    except Exception as e:
                        logger.debug(f"Ratio fetch failed for {symbol}: {e}")
                        return None

                ratio_df = await loop.run_in_executor(None, _fetch_sync)

                if ratio_df is not None and not ratio_df.empty:
                    # Process ratio data and store
                    for _, row in ratio_df.iterrows():
                        extended_metrics = {
                            "change_1d": self._pick_float(
                                row.get("price_change_1d_pct"),
                                row.get("change_1d"),
                            ),
                            "perf_1w": self._pick_float(
                                row.get("price_change_1w_pct"),
                                row.get("weekly_pct"),
                            ),
                            "perf_1m": self._pick_float(
                                row.get("price_change_1m_pct"),
                                row.get("monthly_pct"),
                            ),
                            "perf_ytd": self._pick_float(
                                row.get("price_change_ytd_pct"),
                                row.get("ytd_pct"),
                            ),
                        }

                        metadata = stock_metadata.get(symbol, {})
                        values = {
                            "symbol": symbol,
                            "snapshot_date": today,
                            "company_name": metadata.get("company_name"),
                            "exchange": metadata.get("exchange"),
                            "industry": metadata.get("industry"),
                            "price": self._pick_float(row.get("price"), row.get("close")),
                            "volume": self._parse_float(row.get("volume")),
                            "market_cap": self._pick_float(
                                row.get("market_cap"),
                                row.get("marketCap"),
                            ),
                            "pe": self._parse_float(row.get("pe")),
                            "pb": self._parse_float(row.get("pb")),
                            "ps": self._parse_float(row.get("ps")),
                            "ev_ebitda": self._pick_float(
                                row.get("ev_ebitda"),
                                row.get("evEbitda"),
                            ),
                            "roe": self._parse_float(row.get("roe")),
                            "roa": self._parse_float(row.get("roa")),
                            "roic": self._parse_float(row.get("roic")),
                            "gross_margin": self._parse_float(row.get("gross_margin")),
                            "net_margin": self._parse_float(row.get("net_margin")),
                            "operating_margin": self._parse_float(row.get("operating_margin")),
                            "revenue_growth": self._parse_float(row.get("revenue_growth")),
                            "earnings_growth": self._parse_float(row.get("earnings_growth")),
                            "dividend_yield": self._normalize_dividend_yield(row.get("dividend_yield")),
                            "debt_to_equity": self._parse_float(row.get("debt_to_equity")),
                            "current_ratio": self._parse_float(row.get("current_ratio")),
                            "quick_ratio": self._parse_float(row.get("quick_ratio")),
                            "eps": self._parse_float(row.get("eps")),
                            "bvps": self._parse_float(row.get("bvps")),
                            "extended_metrics": extended_metrics,
                            "source": settings.vnstock_source or "KBS",
                            "created_at": date.today(),
                        }

                        async with self._get_session() as session:
                            stmt = get_upsert_stmt(
                                ScreenerSnapshot,
                                ["symbol", "snapshot_date"],
                                values,
                            )
                            await session.execute(stmt)
                            await session.commit()

                    total_synced += 1

                if progress is not None:
                    progress["success_count"] = progress.get("success_count", 0) + 1
                    progress["last_symbol"] = symbol
                    progress["last_index"] = idx

                if sync_id is not None and self._should_checkpoint(idx, len(deduped_symbols)):
                    await self._checkpoint(progress, sync_id)

            except Exception as e:
                logger.debug(f"Failed to sync screener for {symbol}: {e}")
                if progress is not None:
                    progress["error_count"] = progress.get("error_count", 0) + 1

        logger.info(f"Synced screener data for {total_synced} symbols")
        return total_synced

    async def _get_session(self):
        """Get a database session."""
        return self._session_factory() if hasattr(self, '_session_factory') else async_session_maker()
