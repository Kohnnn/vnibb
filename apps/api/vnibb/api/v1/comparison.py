from fastapi import APIRouter, Query, HTTPException
from typing import List
from vnibb.models.comparison import ComparisonResponse, COMPARISON_METRICS, StockComparison
from vnibb.services.comparison_service import get_comparison_data, get_multi_performance_data

router = APIRouter()


async def _build_comparison_response(symbols: str, period: str) -> ComparisonResponse:
    symbol_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]

    if len(symbol_list) < 2:
        raise HTTPException(400, "At least 2 symbols required")
    if len(symbol_list) > 6:
        raise HTTPException(400, "Maximum 6 symbols allowed")

    stocks = await get_comparison_data(symbol_list, period)

    return ComparisonResponse(
        metrics=COMPARISON_METRICS,
        stocks=stocks,
        period=period,
    )


@router.get("/performance")
async def get_multi_performance(
    symbols: str = Query(..., description="Comma-separated stock symbols (max 5)"),
    days: int = Query(30, ge=7, le=365),
    period: str | None = Query(
        default=None,
        pattern=r"^(1M|3M|6M|1Y|3Y|5Y|YTD|ALL)$",
        description="Optional period override: 1M, 3M, 6M, 1Y, 3Y, 5Y, YTD, ALL",
    ),
):
    """
    Get normalized price performance (%) for multiple stocks.
    Used for overlay charts.
    """
    symbol_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    try:
        return await get_multi_performance_data(symbol_list, days=days, period=period)
    except Exception as e:
        return []


@router.get("", response_model=ComparisonResponse)
@router.get("/", response_model=ComparisonResponse)
async def compare_stocks(
    symbols: str = Query(..., description="Comma-separated stock symbols (max 6)"),
    period: str = Query("FY", description="Period: FY, Q1, Q2, Q3, Q4, TTM"),
):
    """
    Compare multiple stocks across valuation and financial metrics.

    Example: /comparison?symbols=VNM,FPT,VIC&period=FY
    """
    return await _build_comparison_response(symbols=symbols, period=period)


@router.get("/{symbols}", response_model=ComparisonResponse)
async def compare_stocks_path(
    symbols: str,
    period: str = Query("FY", description="Period: FY, Q1, Q2, Q3, Q4, TTM"),
):
    """
    Compatibility route for path-style symbol lists.

    Example: /comparison/VNM,FPT,VIC?period=FY
    """
    return await _build_comparison_response(symbols=symbols, period=period)
