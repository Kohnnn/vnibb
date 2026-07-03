"""
Price Pipeline

Handles synchronization of stock price data from vnstock providers.
"""

import asyncio
import logging
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd
from sqlalchemy import select, update, and_

from vnibb.core.cache import build_cache_key
from vnibb.core.cache_constants import (
    PIPELINE_TTL_PRICE_LATEST,
    PIPELINE_TTL_PRICE_RECENT,
    RECENT_PRICE_DAYS,
)
from vnibb.core.config import settings
from vnibb.core.retry import with_retry
from vnibb.models.stock import Stock, StockPrice
from vnibb.services.pipeline.base import BasePipeline, get_upsert_stmt

logger = logging.getLogger(__name__)


class PricePipeline(BasePipeline):
    """Pipeline for synchronizing stock price data."""

    def __init__(self):
        super().__init__()

    @staticmethod
    def _describe_provider_exception(exc: BaseException) -> str:
        """Describe a provider exception with full chain."""
        parts: List[str] = []
        current: Optional[BaseException] = exc
        seen: set[int] = set()

        while current is not None and id(current) not in seen:
            seen.add(id(current))
            message = str(current).strip()
            parts.append(
                f"{type(current).__name__}: {message}" if message else type(current).__name__
            )

            next_exc: Optional[BaseException] = None
            last_attempt = getattr(current, "last_attempt", None)
            exception_getter = getattr(last_attempt, "exception", None)
            if callable(exception_getter):
                try:
                    next_exc = exception_getter()
                except Exception:
                    next_exc = None

            if next_exc is None:
                next_exc = current.__cause__
            if next_exc is None and not getattr(current, "__suppress_context__", False):
                next_exc = current.__context__

            current = next_exc

        return " <- ".join(parts)

    async def _fetch_quote_history_frame(
        self,
        symbol: str,
        start: str,
        end: str,
        interval: str = "1D",
        bypass_internal_retry: bool = False,
    ) -> pd.DataFrame:
        """Fetch quote history from vnstock provider."""
        timeout_seconds = max(float(getattr(settings, "vnstock_timeout", 0) or 0), 1.0)

        configured = (settings.vnstock_source or "KBS").upper()
        fallback_sources = [configured]
        for alt in ("KBS", "VCI"):
            if alt not in fallback_sources:
                fallback_sources.append(alt)

        last_error: Optional[Exception] = None
        for source in fallback_sources:
            def _fetch_sync(_source: str = source) -> pd.DataFrame:
                from vnibb.providers.vnstock.runtime import get_quote_class

                Quote = get_quote_class()
                quote = Quote(symbol=symbol, source=_source)
                history_callable = quote.history
                if bypass_internal_retry:
                    unwrapped_history = getattr(history_callable, "__wrapped__", None)
                    if callable(unwrapped_history):
                        return unwrapped_history(
                            quote,
                            start=start,
                            end=end,
                            interval=interval,
                        )
                return history_callable(start=start, end=end, interval=interval)

            try:
                df = await asyncio.wait_for(
                    asyncio.to_thread(_fetch_sync),
                    timeout=timeout_seconds,
                )
                if df is None:
                    df_is_empty = True
                elif hasattr(df, "empty"):
                    df_is_empty = bool(df.empty)
                else:
                    df_is_empty = not bool(df)

                if not df_is_empty:
                    if source != configured:
                        logger.info(
                            "Recovered %s prices from fallback source %s",
                            symbol,
                            source,
                        )
                    return df
                last_error = ValueError(f"empty data ({source})")
            except Exception as exc:
                last_error = exc
                logger.debug(
                    "Quote history fetch failed for %s via %s: %s",
                    symbol,
                    source,
                    exc,
                )
                continue

        if last_error is not None:
            raise last_error
        return pd.DataFrame()

    @with_retry(max_retries=3)
    async def sync_daily_prices(
        self,
        symbols: List[str] = None,
        days: int = 30,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        fill_missing_gaps: bool = False,
        progress: Optional[Dict[str, Any]] = None,
        sync_id: Optional[int] = None,
        cache_recent: bool = True,
    ) -> int:
        """Sync historical prices for specified symbols."""
        if not symbols:
            async with asyncio.timeout(30):
                async with self._get_session() as session:
                    result = await session.execute(select(Stock.symbol).where(Stock.is_active == 1))
                    symbols = [r[0] for r in result.fetchall()]

        resolved_end = end_date or date.today()
        resolved_start = start_date or (resolved_end - timedelta(days=days))
        if resolved_start > resolved_end:
            resolved_start, resolved_end = resolved_end, resolved_start

        start_date_str = resolved_start.strftime("%Y-%m-%d")
        end_date_str = resolved_end.strftime("%Y-%m-%d")
        effective_days = max((resolved_end - resolved_start).days, 0)
        logger.info(
            f"Syncing prices for {len(symbols)} symbols over {effective_days} days "
            f"({start_date_str} to {end_date_str})..."
        )

        start_index = 0
        if progress and progress.get("stage") == "prices":
            last_symbol = progress.get("last_symbol")
            if last_symbol and last_symbol in symbols:
                start_index = symbols.index(last_symbol) + 1

        if progress is not None:
            progress.setdefault("stage_stats", {})
            progress["stage"] = "prices"
            progress["stage_stats"].setdefault(
                "prices",
                {"success": 0, "errors": 0, "total": len(symbols)},
            )

        total_synced = 0
        for idx in range(start_index, len(symbols)):
            symbol = symbols[idx]
            active_range: Optional[Tuple[str, str]] = None
            try:
                fetch_ranges: List[Tuple[date, date]] = [(resolved_start, resolved_end)]
                existing_dates: set[date] = set()

                async with self._get_session() as session:
                    stock_id_result = await session.execute(
                        select(Stock.id).where(Stock.symbol == symbol)
                    )
                    stock_id = stock_id_result.scalar()
                    if not stock_id:
                        continue

                    if fill_missing_gaps:
                        existing_rows_result = await session.execute(
                            select(StockPrice.time).where(
                                StockPrice.symbol == symbol,
                                StockPrice.interval == "1D",
                            )
                        )
                        existing_dates = {
                            row_time
                            for (row_time,) in existing_rows_result.fetchall()
                            if isinstance(row_time, date)
                        }
                        if existing_dates:
                            db_min_time = min(existing_dates)
                            db_max_time = max(existing_dates)
                            gap_ranges = self._build_missing_date_ranges(
                                existing_dates=existing_dates,
                                start_date=db_min_time,
                                end_date=db_max_time,
                                max_range_days=30,
                            )
                            fetch_ranges = gap_ranges or []

                            if db_max_time < resolved_end:
                                tail_start = max(db_max_time + timedelta(days=1), resolved_start)
                                if tail_start <= resolved_end:
                                    fetch_ranges.append((tail_start, resolved_end))
                            if resolved_start < db_min_time:
                                head_end = min(db_min_time - timedelta(days=1), resolved_end)
                                if resolved_start <= head_end:
                                    fetch_ranges.append((resolved_start, head_end))

                            if not fetch_ranges:
                                fetch_ranges = [(resolved_start, resolved_end)]

                latest_row: Optional[Dict[str, Any]] = None
                symbol_synced = 0
                async with self._get_session() as session:
                    stock_id_result = await session.execute(
                        select(Stock.id).where(Stock.symbol == symbol)
                    )
                    stock_id = stock_id_result.scalar()
                    if not stock_id:
                        continue

                    for range_start, range_end in fetch_ranges:
                        if range_start > range_end:
                            continue

                        await self._wait_for_rate_limit("prices")
                        range_start_str = range_start.strftime("%Y-%m-%d")
                        range_end_str = range_end.strftime("%Y-%m-%d")
                        active_range = (range_start_str, range_end_str)
                        range_df = await self._fetch_quote_history_frame(
                            symbol=symbol,
                            start=range_start_str,
                            end=range_end_str,
                            interval="1D",
                            bypass_internal_retry=True,
                        )
                        if range_df is None or range_df.empty:
                            logger.debug(
                                "Price gap fetch returned empty for %s (%s -> %s)",
                                symbol,
                                range_start_str,
                                range_end_str,
                            )
                            continue

                        for _, row in range_df.iterrows():
                            row_time = (
                                row["time"].date() if hasattr(row["time"], "date") else row["time"]
                            )
                            val = {
                                "stock_id": stock_id,
                                "symbol": symbol,
                                "time": row_time,
                                "open": float(row["open"]),
                                "high": float(row["high"]),
                                "low": float(row["low"]),
                                "close": float(row["close"]),
                                "volume": int(row["volume"]),
                                "interval": "1D",
                                "source": "vnstock",
                            }
                            stmt = get_upsert_stmt(StockPrice, ["symbol", "time", "interval"], val)
                            await session.execute(stmt)

                        symbol_synced += len(range_df)
                        latest_candidate = range_df.iloc[-1].to_dict()
                        latest_row = latest_candidate

                    await session.commit()

                total_synced += symbol_synced
                if latest_row:
                    latest_payload = {
                        "symbol": symbol,
                        "time": str(latest_row.get("time")),
                        "open": float(latest_row.get("open")),
                        "high": float(latest_row.get("high")),
                        "low": float(latest_row.get("low")),
                        "close": float(latest_row.get("close")),
                        "volume": int(latest_row.get("volume")),
                        "interval": "1D",
                    }
                    latest_key = build_cache_key("vnibb", "price", "latest", symbol)
                    await self._cache_set_json(latest_key, latest_payload, PIPELINE_TTL_PRICE_LATEST)

                    if cache_recent:
                        recent_start = max(
                            resolved_start, resolved_end - timedelta(days=RECENT_PRICE_DAYS)
                        )
                        async with self._get_session() as session:
                            recent_rows_result = await session.execute(
                                select(
                                    StockPrice.time,
                                    StockPrice.open,
                                    StockPrice.high,
                                    StockPrice.low,
                                    StockPrice.close,
                                    StockPrice.volume,
                                )
                                .where(
                                    StockPrice.symbol == symbol,
                                    StockPrice.interval == "1D",
                                    StockPrice.time >= recent_start,
                                )
                                .order_by(StockPrice.time.asc())
                            )
                            recent_rows = [
                                {
                                    "time": row.time.isoformat()
                                    if hasattr(row.time, "isoformat")
                                    else row.time,
                                    "open": float(row.open),
                                    "high": float(row.high),
                                    "low": float(row.low),
                                    "close": float(row.close),
                                    "volume": int(row.volume),
                                }
                                for row in recent_rows_result.fetchall()
                            ]

                        recent_key = build_cache_key("vnibb", "price", "recent", symbol)
                        await self._cache_set_json(recent_key, recent_rows, PIPELINE_TTL_PRICE_RECENT)

                    if progress is not None and symbol_synced > 0:
                        progress["success_count"] = progress.get("success_count", 0) + 1
                        progress["stage_stats"]["prices"]["success"] += 1
                    if symbol_synced > 0:
                        try:
                            async with self._get_session() as reset_session:
                                await reset_session.execute(
                                    update(Stock)
                                    .where(Stock.symbol == symbol)
                                    .values(empty_sync_count=0)
                                )
                                await reset_session.commit()
                        except Exception:
                            pass
                elif progress is not None:
                    progress["error_count"] = progress.get("error_count", 0) + 1
                    progress["stage_stats"]["prices"]["errors"] += 1
            except SystemExit as exc:
                logger.warning(f"Price sync aborted for {symbol}: {exc}")
                if progress is not None:
                    progress["error_count"] = progress.get("error_count", 0) + 1
                    progress["stage_stats"]["prices"]["errors"] += 1
                continue
            except Exception as e:
                error_details = self._describe_provider_exception(e)
                if active_range is not None:
                    logger.error(
                        "Failed to sync prices for %s (%s -> %s): %s",
                        symbol,
                        active_range[0],
                        active_range[1],
                        error_details,
                    )
                else:
                    logger.error("Failed to sync prices for %s: %s", symbol, error_details)

                error_text = (str(e) or "").lower()
                empty_signals = (
                    "dữ liệu trống",
                    "du lieu trong",
                    "no data",
                    "empty data",
                    "no records",
                )
                is_empty_signal = any(signal in error_text for signal in empty_signals)
                if is_empty_signal:
                    try:
                        async with self._get_session() as deactivation_session:
                            await deactivation_session.execute(
                                update(Stock)
                                .where(Stock.symbol == symbol)
                                .values(empty_sync_count=Stock.empty_sync_count + 1)
                            )
                            current = (
                                await deactivation_session.execute(
                                    select(Stock.empty_sync_count).where(Stock.symbol == symbol)
                                )
                            ).scalar_one_or_none()
                            if current is not None and current >= 5:
                                await deactivation_session.execute(
                                    update(Stock)
                                    .where(Stock.symbol == symbol)
                                    .values(is_active=0)
                                )
                                logger.warning(
                                    "Auto-deactivated %s after %d consecutive empty-data sync failures",
                                    symbol,
                                    current,
                                )
                            await deactivation_session.commit()
                    except Exception:
                        pass
                if progress is not None:
                    progress["error_count"] = progress.get("error_count", 0) + 1
                    progress["stage_stats"]["prices"]["errors"] += 1
                continue

            if progress is not None and sync_id is not None:
                progress["last_symbol"] = symbol
                await self._checkpoint(progress, sync_id)

        return total_synced

    async def _get_session(self):
        """Get a database session."""
        return self._session_factory() if hasattr(self, '_session_factory') else async_session_maker()
