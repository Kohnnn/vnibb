"""
Google Apps Script read-only data endpoints.

All endpoints require X-API-Key header matching VNIBB_APPS_SCRIPT_KEY.
Returns plain JSON — no StreamingResponse, no CSV/Excel wrapping.

These are thin wrappers over existing service layers; they add auth and
flatten responses so Apps Script's UrlFetchApp can consume them directly.

On n6v, expose FastAPI via Tailscale Funnel:
    sudo tailscale funnel 8000

Apps Script calls:
    https://<your-host>.your-tailnet.ts.net/api/v1/apps-script/screener?exchange=HOSE&limit=100
"""

import logging
from datetime import date
from typing import Annotated, Any, List, Literal, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.core.config import settings
from vnibb.core.database import get_db
from vnibb.api.v1.schemas import StandardResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/apps-script", tags=["Apps Script"])


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

async def _require_api_key(x_api_key: Annotated[str, Header(alias="X-API-Key")]) -> str:
    """Validate the X-API-Key header against VNIBB_APPS_SCRIPT_KEY."""
    if not settings.apps_script_api_key:
        raise HTTPException(
            503,
            detail="Apps Script integration is not configured. "
            "Set VNIBB_APPS_SCRIPT_KEY in your environment.",
        )
    if x_api_key != settings.apps_script_api_key:
        raise HTTPException(401, detail="Invalid API key.")
    return x_api_key


# ---------------------------------------------------------------------------
# Screener
# ---------------------------------------------------------------------------

from vnibb.providers.vnstock.equity_screener import (
    StockScreenerParams,
    VnstockScreenerFetcher,
)


@router.get(
    "/screener",
    summary="Stock Screener",
    description=(
        "Return flat JSON array of stock rows with 84 financial metrics. "
        "Wraps the existing screener pipeline; returns raw Pydantic-serialised rows."
    ),
)
async def gs_screener(
    exchange: str = Query(default="HOSE", pattern=r"^(HOSE|HNX|UPCOM|ALL)$"),
    industry: Optional[str] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=2000),
    source: str = Query(default="KBS"),
    _: str = Depends(_require_api_key),
    db: AsyncSession = Depends(get_db),
) -> List[dict[str, Any]]:
    """
    Pull stock screener rows as a flat JSON array for Google Sheets.

    Each row contains all 84 financial metrics from vnstock for one ticker.
    Use exchange=HOSE (default), HNX, UPCOM, or ALL.
    """
    params = StockScreenerParams(
        exchange=exchange,
        industry=industry,
        limit=limit,
        source=source,
    )
    rows = await VnstockScreenerFetcher.fetch(params)
    return [row.model_dump(mode="json") for row in rows]


# ---------------------------------------------------------------------------
# Financials
# ---------------------------------------------------------------------------

from vnibb.providers.vnstock.financials import (
    StatementType,
    VnstockFinancialsFetcher,
    FinancialsQueryParams,
)


@router.get(
    "/financials/{symbol}",
    summary="Financial Statements",
    description="Return income statement, balance sheet, or cash flow as JSON array.",
)
async def gs_financials(
    symbol: str,
    statement_type: Literal["income", "balance", "cashflow"] = Query(
        default="income",
        description="Statement type: income, balance, or cashflow",
    ),
    period: Literal["year", "quarter"] = Query(default="year"),
    limit: int = Query(default=5, ge=1, le=20),
    _: str = Depends(_require_api_key),
) -> List[dict[str, Any]]:
    """
    Fetch financial statements for a symbol.

    statement_type: income | balance | cashflow
    period:        year  | quarter
    limit:         1-20 periods (default 5)
    """
    st_enum = StatementType(statement_type)
    params = FinancialsQueryParams(
        symbol=symbol.upper(),
        statement_type=st_enum,
        period=period,
        limit=limit,
    )
    data = await VnstockFinancialsFetcher.fetch(params)
    return [row.model_dump(mode="json") for row in data]


# ---------------------------------------------------------------------------
# Historical OHLCV
# ---------------------------------------------------------------------------

from vnibb.providers.vnstock.equity_historical import (
    EquityHistoricalQueryParams,
    VnstockEquityHistoricalFetcher,
)


@router.get(
    "/historical/{symbol}",
    summary="Historical OHLCV",
    description="Return OHLCV price history as JSON array.",
)
async def gs_historical(
    symbol: str,
    start_date: date = Query(
        ..., description="Start date (YYYY-MM-DD). Defaults to 1 year ago if omitted."
    ),
    end_date: date = Query(default_factory=date.today, description="End date (YYYY-MM-DD)"),
    interval: str = Query(default="1D", description="Candle interval: 1D, 1W, 1M"),
    _: str = Depends(_require_api_key),
) -> List[dict[str, Any]]:
    """
    Fetch OHLCV historical data for a symbol.

    Dates are ISO format: YYYY-MM-DD.  interval: 1D | 1W | 1M.
    """
    params = EquityHistoricalQueryParams(
        symbol=symbol.upper(),
        start_date=start_date,
        end_date=end_date,
        interval=interval,
        source=settings.vnstock_source,
    )
    data = await VnstockEquityHistoricalFetcher.fetch(params)
    return [row.model_dump(mode="json") for row in data]


# ---------------------------------------------------------------------------
# Live Quote
# ---------------------------------------------------------------------------

from vnibb.api.v1.equity import get_quote  # re-use existing endpoint handler


@router.get(
    "/quote/{symbol}",
    summary="Live Quote",
    description="Return current price, change, volume for a single symbol.",
    response_model=StandardResponse[dict[str, Any]],
)
async def gs_quote(
    symbol: str,
    request: Request,
    source: str = Query(default="VCI"),
    _: str = Depends(_require_api_key),
    db: AsyncSession = Depends(get_db),
) -> StandardResponse[dict[str, Any]]:
    """
    Fetch a live quote for one ticker.

    Returns StandardResponse wrapping a dict with:
    symbol, price, change, change_pct, high, low, open, volume, updated_at
    """
    return await get_quote(
        symbol=symbol,
        source=source,
        refresh=False,
        request=request,
        db=db,
    )


# ---------------------------------------------------------------------------
# Ratios
# ---------------------------------------------------------------------------


@router.get(
    "/ratios/{symbol}",
    summary="Financial Ratios",
    description="Return latest financial ratios for a single symbol.",
)
async def gs_ratios(
    symbol: str,
    period: Literal["year", "quarter"] = Query(default="year"),
    _: str = Depends(_require_api_key),
) -> List[dict[str, Any]]:
    """
    Fetch the latest financial ratios for a single symbol.

    Uses the screener fetcher with symbol filter and limit=1,
    then extracts the first row's ratio fields.
    """
    params = StockScreenerParams(symbol=symbol.upper(), limit=1)
    rows = await VnstockScreenerFetcher.fetch(params)
    if not rows:
        return []
    # Return the first (and only) row as a flat dict
    return [rows[0].model_dump(mode="json")]


# ---------------------------------------------------------------------------
# Listing — available symbols
# ---------------------------------------------------------------------------


@router.get(
    "/listing",
    summary="List Symbols",
    description="Return a simple list of ticker symbols by exchange.",
)
async def gs_listing(
    exchange: str = Query(default="HOSE", pattern=r"^(HOSE|HNX|UPCOM|ALL)$"),
    _: str = Depends(_require_api_key),
) -> List[dict[str, str]]:
    """
    Return lightweight symbol list for an exchange.

    Each row: {symbol, company_name, exchange, industry}
    Much cheaper than full screener when you only need the ticker list.
    """
    params = StockScreenerParams(exchange=exchange, limit=2000)
    rows = await VnstockScreenerFetcher.fetch(params)
    return [
        {
            "symbol": r.symbol or "",
            "company_name": r.company_name or "",
            "exchange": r.exchange or "",
            "industry": r.industry or "",
        }
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Market Indices
# ---------------------------------------------------------------------------

@router.get(
    "/market/indices",
    summary="Market Indices",
    description="Return VNINDEX, VN30, HNX, UPCOM index snapshots.",
)
async def gs_market_indices(
    _: str = Depends(_require_api_key),
    db: AsyncSession = Depends(get_db),
) -> List[dict[str, Any]]:
    """
    Return current market index data.

    Proxies the existing market indices endpoint — returns a list of index dicts.
    """
    from vnibb.api.v1.market import get_market_indices

    result = await get_market_indices(limit=10, db=db)
    # MarketIndicesResponse wraps data in a StandardResponse-like shape; unwrap to list
    if hasattr(result, "data"):
        raw = result.data
    else:
        raw = result
    if isinstance(raw, list):
        return [item.model_dump(mode="json") if hasattr(item, "model_dump") else item for item in raw]
    return [raw] if raw else []


# ---------------------------------------------------------------------------
# Health / Ping
# ---------------------------------------------------------------------------

from vnibb.core.database import check_database_connection


@router.get(
    "/health",
    summary="Health Check",
    description="Lightweight ping — returns 200 if the service is up.",
)
async def gs_health(
    _: str = Depends(_require_api_key),
) -> dict[str, Any]:
    """
    Health check for the Apps Script integration.

    Returns {status, database, version}.
    Does NOT require database connectivity (db ping is optional).
    """
    db_ok = await check_database_connection(max_retries=1)
    return {
        "status": "ok",
        "database": "connected" if db_ok else "degraded",
        "version": settings.app_version,
    }
