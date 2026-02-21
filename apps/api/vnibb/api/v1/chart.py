"""
Chart Data API Route

Provides OHLCV price data endpoints for the local chart component.
"""

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from vnibb.services.chart_data_service import fetch_chart_data

logger = logging.getLogger(__name__)

router = APIRouter()

VALID_PERIODS = {"1M", "3M", "6M", "1Y", "3Y", "5Y", "10Y", "ALL"}


@router.get("/{symbol}")
async def get_chart_data(
    symbol: str,
    period: str = Query(default="5Y", description="Time period: 1M, 3M, 6M, 1Y, 3Y, 5Y, 10Y, ALL"),
    source: Optional[str] = Query(default=None, description="Data source: KBS, VCI, DNSE"),
):
    """
    Get OHLCV chart data for a symbol.

    Returns an array of {time, open, high, low, close, volume} sorted ascending.
    Used by the local Lightweight Charts widget to render candlestick/line/area charts.
    """
    symbol = symbol.upper().strip()

    if not symbol:
        raise HTTPException(status_code=400, detail="Symbol is required")

    if period not in VALID_PERIODS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid period '{period}'. Valid: {', '.join(sorted(VALID_PERIODS))}",
        )

    try:
        data = await fetch_chart_data(symbol=symbol, period=period, source=source)

        if not data:
            raise HTTPException(
                status_code=404,
                detail=f"No chart data found for symbol '{symbol}'",
            )

        return {
            "symbol": symbol,
            "period": period,
            "count": len(data),
            "data": data,
        }

    except HTTPException:
        raise
    except TimeoutError:
        raise HTTPException(
            status_code=504,
            detail=f"Data fetch timed out for '{symbol}'. Try again later.",
        )
    except Exception as e:
        logger.error(f"Chart data error for {symbol}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch chart data for '{symbol}': {str(e)}",
        )
