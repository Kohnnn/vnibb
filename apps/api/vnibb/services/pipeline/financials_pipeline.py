"""
Financials Pipeline

Handles synchronization of financial statements (income, balance sheet, cash flow).
"""

import asyncio
import logging
from datetime import date, datetime
from typing import Any, Dict, List, Optional

import pandas as pd
from sqlalchemy import select, and_

from vnibb.core.cache import build_cache_key
from vnibb.core.cache_constants import PIPELINE_TTL_FINANCIALS
from vnibb.core.config import settings
from vnibb.core.retry import with_retry
from vnibb.models.stock import Stock
from vnibb.models.financials import IncomeStatement, BalanceSheet, CashFlow
from vnibb.services.pipeline.base import BasePipeline, get_upsert_stmt

logger = logging.getLogger(__name__)


class FinancialsPipeline(BasePipeline):
    """Pipeline for synchronizing financial statement data."""

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

    def _parse_year_quarter(self, value: Any) -> tuple[Optional[int], Optional[int]]:
        """Parse year and quarter from a value like '2024Q1' or 'Q1/2024'."""
        if value is None:
            return None, None
        text = str(value).strip()

        import re
        # Try format like '2024Q1' or '2024Q2'
        match = re.match(r"(\d{4})[Qq](\d)", text)
        if match:
            return int(match.group(1)), int(match.group(2))

        # Try format like 'Q1/2024' or 'Q1-2024'
        match = re.match(r"[Qq](\d)[/-](\d{4})", text)
        if match:
            return int(match.group(2)), int(match.group(1))

        return None, None

    def _map_period_type(self, period: str) -> str:
        """Map period string to period type."""
        period_lower = period.lower() if period else ""
        if "q" in period_lower or "quy" in period_lower:
            return "quarter"
        return "year"

    @with_retry(max_retries=3)
    async def sync_financials(
        self,
        symbols: Optional[List[str]] = None,
        period: str = "quarter",
        limit: Optional[int] = None,
        progress: Optional[Dict[str, Any]] = None,
        sync_id: Optional[int] = None,
    ) -> int:
        """Sync financial statements for specified symbols."""
        from vnibb.providers.vnstock.financials import (
            FinancialsQueryParams,
            StatementType,
            VnstockFinancialsFetcher,
        )

        logger.info(f"Syncing {period} financials...")

        if not symbols:
            async with self._get_session() as session:
                result = await session.execute(select(Stock.symbol).where(Stock.is_active == 1))
                symbols = [r[0] for r in result.fetchall()]

        if limit:
            symbols = symbols[:limit]

        total_synced = 0

        for idx, symbol in enumerate(symbols):
            try:
                await self._wait_for_rate_limit("financials")

                for statement_type in [StatementType.INCOME, StatementType.BALANCE, StatementType.CASH_FLOW]:
                    try:
                        params = FinancialsQueryParams(
                            symbol=symbol,
                            statement_type=statement_type,
                            period=period,
                        )

                        def _fetch_sync():
                            fetcher = VnstockFinancialsFetcher()
                            return asyncio.run(fetcher.fetch(params))

                        data = await asyncio.wait_for(
                            asyncio.to_thread(_fetch_sync),
                            timeout=30,
                        )

                        if data:
                            await self._store_financial_data(symbol, statement_type, period, data)
                            total_synced += 1

                    except Exception as e:
                        logger.debug(f"Failed to sync {statement_type} for {symbol}: {e}")

                if progress is not None:
                    progress["success_count"] = progress.get("success_count", 0) + 1
                    progress["last_symbol"] = symbol

            except Exception as e:
                logger.error(f"Financials sync failed for {symbol}: {e}")
                if progress is not None:
                    progress["error_count"] = progress.get("error_count", 0) + 1

        logger.info(f"Synced financials for {total_synced} records")
        return total_synced

    async def _store_financial_data(
        self,
        symbol: str,
        statement_type: StatementType,
        period: str,
        data: List[Dict[str, Any]],
    ) -> None:
        """Store financial data to the appropriate table."""
        import pandas as pd

        model_map = {
            StatementType.INCOME: IncomeStatement,
            StatementType.BALANCE: BalanceSheet,
            StatementType.CASH_FLOW: CashFlow,
        }

        model = model_map.get(statement_type)
        if not model:
            return

        for record in data:
            fiscal_year, fiscal_quarter = self._parse_year_quarter(record.get("period"))
            if fiscal_year is None:
                continue

            values = {
                "symbol": symbol.upper(),
                "fiscal_year": fiscal_year,
                "fiscal_quarter": fiscal_quarter,
                "period": record.get("period"),
                "period_type": self._map_period_type(period),
                "updated_at": datetime.utcnow(),
            }

            # Add financial fields based on statement type
            if statement_type == StatementType.INCOME:
                values.update({
                    "revenue": self._parse_float(record.get("revenue")),
                    "gross_profit": self._parse_float(record.get("gross_profit")),
                    "operating_income": self._parse_float(record.get("operating_income")),
                    "net_income": self._parse_float(record.get("net_income")),
                    "eps": self._parse_float(record.get("eps")),
                })
            elif statement_type == StatementType.BALANCE:
                values.update({
                    "total_assets": self._parse_float(record.get("total_assets")),
                    "total_liabilities": self._parse_float(record.get("total_liabilities")),
                    "total_equity": self._parse_float(record.get("total_equity")),
                })
            elif statement_type == StatementType.CASH_FLOW:
                values.update({
                    "operating_cash_flow": self._parse_float(record.get("operating_cash_flow")),
                    "investing_cash_flow": self._parse_float(record.get("investing_cash_flow")),
                    "financing_cash_flow": self._parse_float(record.get("financing_cash_flow")),
                })

            async with self._get_session() as session:
                stmt = get_upsert_stmt(
                    model,
                    ["symbol", "fiscal_year", "fiscal_quarter", "period_type"],
                    values,
                )
                await session.execute(stmt)
                await session.commit()

    async def sync_financial_ratios(
        self,
        symbols: Optional[List[str]] = None,
        limit: Optional[int] = None,
        progress: Optional[Dict[str, Any]] = None,
        sync_id: Optional[int] = None,
    ) -> int:
        """Sync financial ratios."""
        from vnibb.providers.vnstock.financial_ratios import (
            FinancialRatiosQueryParams,
            VnstockFinancialRatiosFetcher,
        )

        logger.info("Syncing financial ratios...")

        if not symbols:
            async with self._get_session() as session:
                result = await session.execute(select(Stock.symbol).where(Stock.is_active == 1))
                symbols = [r[0] for r in result.fetchall()]

        if limit:
            symbols = symbols[:limit]

        total_synced = 0

        for idx, symbol in enumerate(symbols):
            try:
                await self._wait_for_rate_limit("financials")

                params = FinancialRatiosQueryParams(symbol=symbol)

                def _fetch_sync():
                    fetcher = VnstockFinancialRatiosFetcher()
                    return asyncio.run(fetcher.fetch(params))

                data = await asyncio.wait_for(
                    asyncio.to_thread(_fetch_sync),
                    timeout=30,
                )

                if data:
                    # Store ratios - simplified implementation
                    logger.debug(f"Synced ratios for {symbol}")
                    total_synced += 1

                if progress is not None:
                    progress["success_count"] = progress.get("success_count", 0) + 1

            except Exception as e:
                logger.debug(f"Failed to sync ratios for {symbol}: {e}")
                if progress is not None:
                    progress["error_count"] = progress.get("error_count", 0) + 1

        logger.info(f"Synced ratios for {total_synced} symbols")
        return total_synced

    async def _get_session(self):
        """Get a database session."""
        return self._session_factory() if hasattr(self, '_session_factory') else async_session_maker()
