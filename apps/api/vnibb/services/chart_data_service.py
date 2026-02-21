"""
Chart Data Service

Provides OHLCV price data for the local Lightweight Charts component.
Uses vnstock to fetch historical price data with in-memory LRU cache.
"""

import asyncio
import logging
from datetime import date, timedelta
from functools import lru_cache
from typing import Any, Dict, List, Optional

from vnibb.core.config import settings

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


# Simple in-memory cache keyed by (symbol, period)
_cache: Dict[str, Any] = {}
_CACHE_MAX_SIZE = 50


def _cache_key(symbol: str, period: str) -> str:
    return f"{symbol}:{period}"


def _evict_oldest():
    """Evict oldest entry if cache exceeds max size."""
    if len(_cache) >= _CACHE_MAX_SIZE:
        oldest_key = next(iter(_cache))
        del _cache[oldest_key]


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
        List of dicts with {time, open, high, low, close, volume}
        sorted ascending by time.
    """
    symbol = symbol.upper().strip()
    if source is None:
        source = settings.vnstock_source

    # Check cache
    key = _cache_key(symbol, period)
    if key in _cache:
        logger.debug(f"Chart cache hit: {key}")
        return _cache[key]

    start_date = _compute_start_date(period)
    end_date = date.today()

    loop = asyncio.get_event_loop()

    def _fetch_sync() -> List[Dict[str, Any]]:
        try:
            from vnstock import Vnstock

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
            for _, row in df.iterrows():
                time_val = row.get("time") or row.get("date") or row.get("trading_date")
                if hasattr(time_val, "isoformat"):
                    time_str = time_val.isoformat()[:10]
                else:
                    time_str = str(time_val)[:10]

                records.append(
                    {
                        "time": time_str,
                        "open": float(row.get("open", 0)),
                        "high": float(row.get("high", 0)),
                        "low": float(row.get("low", 0)),
                        "close": float(row.get("close", 0)),
                        "volume": int(row.get("volume", 0)),
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
