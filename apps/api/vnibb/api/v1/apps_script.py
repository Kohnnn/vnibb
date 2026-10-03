"""
Google Apps Script data endpoints for Google Sheets.

Legacy endpoints (`/screener`, `/financials/{symbol}`, ...) keep their original
contract: flat JSON arrays that map straight onto sheet rows. They are thin
wrappers over the existing serving pipeline and are what the checked-in cell
formulas (`VNIBB_QUOTE`, `VNIBB_RATIO`, `VNIBB_FINANCIAL`) call.

`/bounded/{dataset}` is the opt-in workflow that adds truthful provenance on
top of the same serving pipeline: an explicit query, an availability state that
distinguishes unavailable from empty, a source date that stays `null` when it is
unknown (fetch time is never reported as the data date), and the limitations
that apply to the numbers. It never re-derives data from a second provider.

All endpoints require X-API-Key header matching VNIBB_APPS_SCRIPT_KEY.
Returns plain JSON — no StreamingResponse, no CSV/Excel wrapping.

On n6v, expose FastAPI via Tailscale Funnel:
    sudo tailscale funnel 8000

Apps Script calls:
    https://<your-host>.your-tailnet.ts.net/api/v1/apps-script/screener?exchange=HOSE&limit=100
"""

import logging
from datetime import UTC, date, datetime
from typing import Annotated, Any, List, Literal, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.core.config import settings
from vnibb.core.database import get_db
from vnibb.api.v1.schemas import MetaData, StandardResponse

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


# ---------------------------------------------------------------------------
# Bounded workflow — opt-in provenance envelope
# ---------------------------------------------------------------------------
#
# Legacy endpoints keep returning bare arrays. `/bounded/{dataset}` is a
# companion that wraps the same serving pipeline in a truth-telling envelope:
# what was asked, what was returned, whether the result is unavailable or
# genuinely empty, which serving path produced it, the date the *data* is from
# (null when unknown), and the limitations on the numbers. Fetch time is
# reported separately and never substituted for a source date.

BOUNDED_LIMIT_MAX = 2000
BOUNDED_HISTORICAL_MAX_DAYS = 1826  # ~5 years of calendar span per request

_PROVENANCE_DATE_KEYS: dict[str, tuple[str, ...]] = {
    "screener": ("trade_date",),
    "financials": (),
    "historical": ("time",),
    "ratios": (),
    "listing": (),
    "market_indices": ("time", "date"),
}


def _bounded_row_dict(row: Any) -> dict[str, Any]:
    if hasattr(row, "model_dump"):
        return row.model_dump(mode="json")
    return dict(row) if isinstance(row, dict) else {"value": row}


def _latest_provenance_date(rows: List[dict[str, Any]], keys: tuple[str, ...]) -> Optional[str]:
    """Newest explicit observation date; never a persistence timestamp."""
    latest: str | None = None
    for row in rows:
        for key in keys:
            value = row.get(key)
            if value in (None, ""):
                continue
            try:
                text = date.fromisoformat(str(value)[:10]).isoformat()
            except ValueError:
                continue
            if latest is None or text > latest:
                latest = text
            break
    return latest


def _bounded_envelope(
    dataset: str,
    rows: List[dict[str, Any]],
    *,
    query: dict[str, Any],
    limit: int,
    source: str | None,
    error: str | None = None,
    limitations: List[str] | None = None,
    serving_meta: dict[str, Any] | None = None,
) -> StandardResponse[List[dict[str, Any]]]:
    sliced = rows[:limit]
    if sliced:
        availability = "partial" if error or (serving_meta or {}).get("completeness_status") == "partial" else "available"
    elif error is not None:
        availability = "unavailable"
    else:
        availability = "empty"
    return StandardResponse(
        data=sliced,
        error=error,
        meta=MetaData(
            count=len(sliced),
            limit=limit,
            dataset=dataset,
            query=query,
            availability=availability,
            source=source,
            source_date=_latest_provenance_date(sliced, _PROVENANCE_DATE_KEYS[dataset]),
            source_date_basis="Newest explicit observation date among returned rows; not whole-dataset freshness.",
            undated_row_count=sum(
                _latest_provenance_date([row], _PROVENANCE_DATE_KEYS[dataset]) is None
                for row in sliced
            ),
            retrieved_at=datetime.now(UTC).isoformat(),
            limitations=limitations or [],
            serving_meta=serving_meta or {},
        ),
    )


def _serving_result(result: Any, limitations: list[str]) -> tuple:
    raw = result if isinstance(result, dict) else result.model_dump(mode="json")
    rows = [_bounded_row_dict(row) for row in (raw.get("data") or [])]
    meta = raw.get("meta") or {}
    label = meta.get("source_mode") or meta.get("source") or raw.get("source")
    if not label:
        limitations.append("The serving pipeline does not retain the original supplier identity; source is unknown.")
    limitations.extend(str(item) for item in (meta.get("warnings") or []))
    if meta.get("fallback") or meta.get("fallback_used"):
        limitations.append("The serving pipeline used fallback observations.")
    if meta.get("stale"):
        limitations.append("The serving pipeline reports stale observations.")
    error = raw.get("error")
    if not rows and meta.get("availability") == "unavailable" and not error:
        error = "Serving pipeline reports data unavailable."
    return rows, label, limitations, error, meta


async def _bounded_screener(
    *, request: Request, db: AsyncSession, exchange: str, industry: str | None, limit: int, source: str
) -> tuple:
    from vnibb.api.v1.screener import get_screener

    result = await get_screener(
        request=request, db=db, symbol=None, universe="ALL", exchange=exchange,
        industry=industry, as_of_date=None, min_listing_age_days=None,
        target_upside_min=None, limit=limit, source=source, use_cache=True,
        refresh=False, filters=None, sort=None, pe_min=None, pe_max=None,
        pb_min=None, pb_max=None, ps_min=None, ps_max=None, roe_min=None,
        roa_min=None, debt_to_equity_max=None, market_cap_min=None,
        market_cap_max=None, volume_min=None, moat=None, margin_of_safety_min=None,
        margin_of_safety_max=None, dividend_years_min=None, fcf_positive=None,
        include_fundamental=False, columns=None, sort_by=None, sort_order="desc",
    )
    return _serving_result(result, [
        "Screener fields may mix observation dates; trade_date applies to price and volume, not every metric.",
        "Rows without a trade date have an unknown source date.",
    ])


async def _bounded_financials(
    *, db: AsyncSession, symbol: str, statement_type: str, period: str, limit: int
) -> tuple:
    from vnibb.api.v1.equity import get_financials

    result = await get_financials(
        symbol=symbol.upper(), statement_type=statement_type, period=period,
        limit=limit, db=db,
    )
    return _serving_result(result, [
        "Statement period labels are reporting periods, not publication dates.",
        "Row updated_at and serving last_data_date are persistence timestamps, not source dates.",
    ])


async def _bounded_historical(
    *, db: AsyncSession, symbol: str, start_date: date, end_date: date, interval: str, source: str
) -> tuple:
    from vnibb.api.v1.equity import get_historical_prices

    result = await get_historical_prices(
        symbol=symbol.upper(), start_date=start_date, end_date=end_date,
        interval=interval, source=source, adjustment_mode="raw", db=db,
    )
    return _serving_result(result, [
        "Trade dates are observation dates, not retrieval dates; missing sessions are absent, not zero.",
        "Raw prices are not corporate-action-adjusted; retained unit and completeness metadata must be consulted.",
    ])


async def _bounded_ratios(*, db: AsyncSession, symbol: str, period: str) -> tuple:
    from vnibb.api.v1.equity import get_financial_ratios

    result = await get_financial_ratios(symbol=symbol.upper(), period=period, db=db)
    return _serving_result(result, [
        "Ratios may be enriched or derived by the serving pipeline; missing metrics are null, not zero.",
        "Ratio fiscal periods and latest stored price dates are not statement publication dates.",
    ])


async def _bounded_listing(
    *, request: Request, db: AsyncSession, exchange: str, limit: int
) -> tuple:
    rows, label, limitations, error, meta = await _bounded_screener(
        request=request, db=db, exchange=exchange, industry=None, limit=limit,
        source=settings.vnstock_source,
    )
    data = [{"symbol": row.get("symbol"), "company_name": row.get("organ_name"),
             "exchange": row.get("exchange"), "industry": row.get("industry_name")}
            for row in rows]
    limitations.append("Listing is a bounded projection of the serving screener, not a complete exchange registry; source date is unknown.")
    return data, label, limitations, error, meta


async def _bounded_market_indices(db: AsyncSession, *, limit: int) -> tuple:
    from vnibb.api.v1.market import get_market_indices

    result = await get_market_indices(limit=min(limit, 20), db=db)
    return _serving_result(result, [
        "Index timestamps must identify observations; store updated_at is not a source date.",
    ])


@router.get(
    "/bounded/{dataset}",
    summary="Bounded pull with provenance",
    description=(
        "Companion to the flat endpoints: returns a StandardResponse envelope with "
        "the query, applied limit, availability (available/empty/unavailable), the "
        "serving source, a source date that stays null when unknown, and the "
        "limitations on the returned numbers. Never returns more rows than requested."
    ),
)
async def gs_bounded(
    dataset: Literal["screener", "financials", "historical", "ratios", "listing", "market_indices"],
    request: Request,
    symbol: str | None = Query(default=None),
    exchange: str = Query(default="HOSE", pattern=r"^(HOSE|HNX|UPCOM|ALL)$"),
    industry: str | None = Query(default=None),
    statement_type: Literal["income", "balance", "cashflow"] = Query(default="income"),
    period: Literal["year", "quarter"] = Query(default="year"),
    interval: str = Query(default="1D", pattern=r"^(1m|5m|15m|30m|1H|1D|1W|1M)$"),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    limit: int = Query(default=5, ge=1, le=BOUNDED_LIMIT_MAX),
    source: str = Query(default="KBS", pattern=r"^(KBS|VCI|MSN|FMP)$"),
    _: str = Depends(_require_api_key),
    db: AsyncSession = Depends(get_db),
) -> StandardResponse[List[dict[str, Any]]]:
    """Run one bounded pull and attach provenance to whatever comes back."""
    query: dict[str, Any] = {"dataset": dataset, "limit": limit}
    try:
        if dataset == "screener":
            query.update(exchange=exchange, industry=industry, source=source)
            rows, label, limits, error, serving_meta = await _bounded_screener(
                request=request, db=db, exchange=exchange, industry=industry, limit=limit, source=source
            )
        elif dataset == "financials":
            if not symbol:
                raise HTTPException(422, detail="symbol is required for financials.")
            query.update(symbol=symbol.upper(), statement_type=statement_type, period=period)
            if limit > 20:
                raise HTTPException(422, detail="financials limit must be between 1 and 20.")
            rows, label, limits, error, serving_meta = await _bounded_financials(
                db=db, symbol=symbol, statement_type=statement_type, period=period, limit=limit
            )
        elif dataset == "historical":
            if not symbol or start_date is None:
                raise HTTPException(
                    422, detail="symbol and start_date are required for historical."
                )
            range_end = end_date or date.today()
            if range_end < start_date:
                raise HTTPException(422, detail="end_date must be >= start_date.")
            if (range_end - start_date).days > BOUNDED_HISTORICAL_MAX_DAYS:
                raise HTTPException(
                    422,
                    detail=(
                        f"historical range exceeds {BOUNDED_HISTORICAL_MAX_DAYS} days; "
                        "narrow the request."
                    ),
                )
            query.update(
                symbol=symbol.upper(),
                start_date=start_date.isoformat(),
                end_date=range_end.isoformat(),
                interval=interval,
                source=source,
            )
            rows, label, limits, error, serving_meta = await _bounded_historical(
                db=db,
                symbol=symbol,
                start_date=start_date,
                end_date=range_end,
                interval=interval,
                source=source,
            )
        elif dataset == "ratios":
            if not symbol:
                raise HTTPException(422, detail="symbol is required for ratios.")
            query.update(symbol=symbol.upper(), period=period)
            rows, label, limits, error, serving_meta = await _bounded_ratios(db=db, symbol=symbol, period=period)
        elif dataset == "listing":
            query.update(exchange=exchange)
            rows, label, limits, error, serving_meta = await _bounded_listing(request=request, db=db, exchange=exchange, limit=limit)
        else:
            rows, label, limits, error, serving_meta = await _bounded_market_indices(db, limit=limit)
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Bounded %s pull failed: %s", dataset, exc)
        return _bounded_envelope(
            dataset,
            [],
            query=query,
            limit=limit,
            source="unavailable",
            error="Data unavailable from the serving pipeline.",
            limitations=["The serving pipeline did not return data for this request."],
        )
    return _bounded_envelope(
        dataset, rows, query=query, limit=limit, source=label, limitations=limits,
        error=error, serving_meta=serving_meta,
    )
