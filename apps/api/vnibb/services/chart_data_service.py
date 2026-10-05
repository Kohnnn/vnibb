"""
Chart Data Service

Provides OHLCV price data for the local Lightweight Charts component.
Uses vnstock to fetch historical price data with in-memory LRU cache.
"""

import asyncio
import logging
from datetime import date, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import select

from vnibb.core.config import settings
from vnibb.core.database import async_session_maker
from vnibb.core.price_units import history_price_records, persisted_price_record
from vnibb.models.stock import StockPrice

logger = logging.getLogger(__name__)

# Period to start-date mapping
PERIOD_MAP: Dict[str, int] = {
    "1M": 30,
    "3M": 90,
    "6M": 180,
    "1Y": 365,
    "3Y": 365 * 3,
    "5Y": 365 * 5,
    "10Y": 365 * 10,
    "ALL": 365 * 20,
}


def _compute_start_date(period: str) -> date:
    """Compute start date from period string."""
    days = PERIOD_MAP.get(period, PERIOD_MAP["5Y"])
    return date.today() - timedelta(days=days)


# Simple in-memory cache keyed by (symbol, period, source)
_cache: Dict[str, Any] = {}
_CACHE_MAX_SIZE = 50


def _cache_key(symbol: str, period: str, source: str) -> str:
    return f"{symbol}:{period}:{source}"


def _evict_oldest():
    """Evict oldest entry if cache exceeds max size."""
    if len(_cache) >= _CACHE_MAX_SIZE:
        oldest_key = next(iter(_cache))
        del _cache[oldest_key]


async def _fetch_chart_data_from_db(symbol: str, start_date: date) -> List[Dict[str, Any]]:
    async with async_session_maker() as session:
        rows = (
            await session.execute(
                select(StockPrice)
                .where(
                    StockPrice.symbol == symbol,
                    StockPrice.interval == "1D",
                    StockPrice.time >= start_date,
                )
                .order_by(StockPrice.time.asc())
            )
        ).scalars().all()

    records: List[Dict[str, Any]] = []
    for row in rows:
        normalized = persisted_price_record(row)
        if normalized["price_unit"] == "unknown":
            logger.warning("Excluding chart bar with unknown price unit: %s %s", symbol, row.time)
            continue
        records.append(
            {
                "time": row.time.isoformat(),
                "open": float(normalized["open"]),
                "high": float(normalized["high"]),
                "low": float(normalized["low"]),
                "close": float(normalized["close"]),
                "volume": int(normalized["volume"] or 0),
                "price_unit": normalized["price_unit"],
            }
        )

    return records


async def fetch_chart_data(
    symbol: str,
    period: str = "5Y",
    source: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Fetch OHLCV data for a symbol.

    Args:
        symbol: Stock ticker (e.g. VNM, FPT)
        period: Time period (1M, 3M, 6M, 1Y, 3Y, 5Y, 10Y, ALL)
        source: Data source (KBS, VCI, DNSE). Defaults to settings.

    Returns:
        List of dicts with {time, open, high, low, close, volume, price_unit}
        sorted ascending by time.
    """
    symbol = symbol.upper().strip()
    if source is None:
        source = settings.vnstock_source

    # Check cache
    key = _cache_key(symbol, period, source)
    if key in _cache:
        logger.debug(f"Chart cache hit: {key}")
        return _cache[key]

    start_date = _compute_start_date(period)
    end_date = date.today()

    loop = asyncio.get_event_loop()

    def _fetch_sync() -> List[Dict[str, Any]]:
        try:
            from vnibb.providers.vnstock.runtime import get_vnstock_class

            Vnstock = get_vnstock_class()
            stock = Vnstock().stock(symbol=symbol, source=source)
            df = stock.quote.history(
                start=start_date.isoformat(),
                end=end_date.isoformat(),
                interval="1D",
            )

            if df is None or df.empty:
                logger.warning(f"No chart data for {symbol}")
                return []

            records = []
            normalized_rows = history_price_records(df, symbol=symbol, source=source, provider=stock.quote)
            for normalized in normalized_rows:
                time_val = normalized.get("time") or normalized.get("date") or normalized.get("trading_date")
                if hasattr(time_val, "isoformat"):
                    time_str = time_val.isoformat()[:10]
                else:
                    time_str = str(time_val)[:10]

                if normalized["price_unit"] == "unknown":
                    logger.warning("Excluding chart bar with unknown price unit: %s %s", symbol, time_str)
                    continue
                records.append(
                    {
                        "time": time_str,
                        "open": float(normalized.get("open", 0)),
                        "high": float(normalized.get("high", 0)),
                        "low": float(normalized.get("low", 0)),
                        "close": float(normalized.get("close", 0)),
                        "volume": int(normalized.get("volume", 0)),
                        "price_unit": normalized["price_unit"],
                    }
                )

            # Sort ascending by time
            records.sort(key=lambda r: r["time"])
            return records

        except Exception as e:
            logger.error(f"Chart data fetch error for {symbol}: {e}")
            raise

    try:
        data = await asyncio.wait_for(
            loop.run_in_executor(None, _fetch_sync),
            timeout=getattr(settings, "vnstock_timeout", 30),
        )

        if not data:
            data = await _fetch_chart_data_from_db(symbol=symbol, start_date=start_date)
            if data:
                logger.info(
                    "Chart data fallback hit DB cache: %s (%d points, period=%s)",
                    symbol,
                    len(data),
                    period,
                )

        # Cache result
        if data:
            _evict_oldest()
            _cache[key] = data
            logger.info(f"Chart data cached: {symbol} ({len(data)} points, period={period})")

        return data

    except asyncio.TimeoutError:
        logger.error(f"Chart data timeout for {symbol}")
        raise
    except Exception:
        raise
