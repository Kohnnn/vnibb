"""
Screener API Endpoints

Provides endpoints for:
- Stock screening with 84 financial metrics
- Filtering by exchange, industry
- Database caching with TTL
"""

import logging
import asyncio
import math
from datetime import datetime, date
from typing import Any, List, Optional, Callable, Awaitable

from fastapi import APIRouter, HTTPException, Query, Request, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import pandas as pd

from vnibb.core.database import get_db
from vnibb.models.stock import Stock, StockPrice
from vnibb.models.company import Company
from vnibb.models.financials import IncomeStatement, BalanceSheet, CashFlow
from vnibb.models.trading import FinancialRatio
from vnibb.providers.vnstock.equity_screener import (
    VnstockScreenerFetcher,
    StockScreenerParams,
    ScreenerData,
)
from vnibb.core.exceptions import ProviderError, ProviderTimeoutError, ProviderRateLimitError
from vnibb.services.cache_manager import CacheManager
from vnibb.services.screener_filter_service import ScreenerFilterService
from vnibb.core.cache import cached
from vnibb.api.v1.schemas import StandardResponse, MetaData
from vnibb.core.retry import vnstock_cb

router = APIRouter()
logger = logging.getLogger(__name__)

_REFRESH_LOCK = asyncio.Lock()
_REFRESH_IN_FLIGHT: set[str] = set()


async def _schedule_refresh(key: str, refresh_fn: Callable[[], Awaitable[None]]) -> None:
    async with _REFRESH_LOCK:
        if key in _REFRESH_IN_FLIGHT:
            return
        _REFRESH_IN_FLIGHT.add(key)

    async def runner() -> None:
        try:
            await refresh_fn()
        finally:
            async with _REFRESH_LOCK:
                _REFRESH_IN_FLIGHT.discard(key)

    asyncio.create_task(runner())


def _to_screener_data_row(row: object) -> ScreenerData:
    extended_metrics = getattr(row, "extended_metrics", None)
    if not isinstance(extended_metrics, dict):
        extended_metrics = {}

    def _pick(*values: Any) -> Any:
        for value in values:
            if value is not None:
                return value
        return None

    return ScreenerData(
        symbol=getattr(row, "symbol", None),
        organ_name=getattr(row, "company_name", None),
        exchange=getattr(row, "exchange", None),
        industry_name=getattr(row, "industry", None),
        price=getattr(row, "price", None),
        volume=getattr(row, "volume", None),
        change_1d=_pick(
            getattr(row, "change_1d", None),
            getattr(row, "price_change_1d_pct", None),
            extended_metrics.get("change_1d"),
            extended_metrics.get("price_change_1d_pct"),
        ),
        perf_1w=_pick(
            getattr(row, "perf_1w", None),
            getattr(row, "price_change_1w_pct", None),
            extended_metrics.get("perf_1w"),
            extended_metrics.get("price_change_1w_pct"),
        ),
        perf_1m=_pick(
            getattr(row, "perf_1m", None),
            getattr(row, "price_change_1m_pct", None),
            extended_metrics.get("perf_1m"),
            extended_metrics.get("price_change_1m_pct"),
        ),
        perf_ytd=_pick(
            getattr(row, "perf_ytd", None),
            getattr(row, "price_change_ytd_pct", None),
            extended_metrics.get("perf_ytd"),
            extended_metrics.get("price_change_ytd_pct"),
        ),
        market_cap=getattr(row, "market_cap", None),
        pe=getattr(row, "pe", None),
        pb=getattr(row, "pb", None),
        ps=getattr(row, "ps", None),
        ev_ebitda=getattr(row, "ev_ebitda", None),
        roe=getattr(row, "roe", None),
        roa=getattr(row, "roa", None),
        roic=getattr(row, "roic", None),
        gross_margin=getattr(row, "gross_margin", None),
        net_margin=getattr(row, "net_margin", None),
        operating_margin=getattr(row, "operating_margin", None),
        revenue_growth=getattr(row, "revenue_growth", None),
        earnings_growth=getattr(row, "earnings_growth", None),
        dividend_yield=getattr(row, "dividend_yield", None),
        debt_to_equity=getattr(row, "debt_to_equity", None),
        debt_to_asset=_pick(
            getattr(row, "debt_to_asset", None),
            extended_metrics.get("debt_to_asset"),
            extended_metrics.get("debt_to_assets"),
        ),
        current_ratio=getattr(row, "current_ratio", None),
        quick_ratio=getattr(row, "quick_ratio", None),
        days_receivable=_pick(
            getattr(row, "days_receivable", None),
            extended_metrics.get("days_receivable"),
            extended_metrics.get("dso"),
        ),
        days_payable=_pick(
            getattr(row, "days_payable", None),
            extended_metrics.get("days_payable"),
            extended_metrics.get("dpo"),
        ),
        equity_on_total_asset=_pick(
            getattr(row, "equity_on_total_asset", None),
            extended_metrics.get("equity_on_total_asset"),
        ),
        revenue_on_asset=_pick(
            getattr(row, "revenue_on_asset", None),
            extended_metrics.get("revenue_on_asset"),
            extended_metrics.get("asset_turnover"),
        ),
        eps=getattr(row, "eps", None),
        bvps=getattr(row, "bvps", None),
        foreign_ownership=getattr(row, "foreign_ownership", None),
    )


async def _hydrate_screener_rows(rows: List[ScreenerData], db: AsyncSession) -> List[ScreenerData]:
    def _is_missing(value: object) -> bool:
        if value is None:
            return True
        if isinstance(value, float) and math.isnan(value):
            return True
        if isinstance(value, str) and value.strip().lower() in {"", "nan", "none", "null"}:
            return True
        return False

    def _estimate_market_cap(price: object, shares_outstanding: object) -> Optional[float]:
        if _is_missing(price) or _is_missing(shares_outstanding):
            return None
        try:
            price_value = float(price)
            shares_value = float(shares_outstanding)
            # vnstock sometimes returns shares in millions, while company profiles
            # can store absolute share counts.
            multiplier = 1.0 if shares_value >= 1_000_000 else 1_000_000.0
            return price_value * shares_value * multiplier
        except (TypeError, ValueError):
            return None

    missing_symbols = [
        row.symbol
        for row in rows
        if row.symbol
        and (
            _is_missing(row.organ_name)
            or _is_missing(row.exchange)
            or _is_missing(row.industry_name)
            or _is_missing(row.shares_outstanding)
            or _is_missing(row.market_cap)
        )
    ]
    symbols = sorted({symbol for symbol in missing_symbols if symbol})
    stock_map: dict[str, tuple[Optional[str], Optional[str], Optional[str]]] = {}
    company_map: dict[
        str, tuple[Optional[str], Optional[str], Optional[str], Optional[float], Optional[float]]
    ] = {}
    if symbols:
        stock_result = await db.execute(
            select(Stock.symbol, Stock.company_name, Stock.exchange, Stock.industry).where(
                Stock.symbol.in_(symbols)
            )
        )
        stock_map = {
            symbol: (company_name, exchange, industry)
            for symbol, company_name, exchange, industry in stock_result.fetchall()
        }
        company_result = await db.execute(
            select(
                Company.symbol,
                Company.company_name,
                Company.exchange,
                Company.industry,
                Company.outstanding_shares,
                Company.listed_shares,
            ).where(Company.symbol.in_(symbols))
        )
        company_map = {
            symbol: (
                company_name,
                exchange,
                industry,
                outstanding_shares,
                listed_shares,
            )
            for (
                symbol,
                company_name,
                exchange,
                industry,
                outstanding_shares,
                listed_shares,
            ) in company_result.fetchall()
        }

    hydrated: List[ScreenerData] = []
    for row in rows:
        updates: dict[str, Any] = {}
        symbol = row.symbol
        company_name = None
        exchange = None
        industry = None
        outstanding_shares = None
        listed_shares = None

        if symbol:
            if symbol in company_map:
                company_name, exchange, industry, outstanding_shares, listed_shares = company_map[
                    symbol
                ]
            if symbol in stock_map:
                stock_company, stock_exchange, stock_industry = stock_map[symbol]
                if not company_name:
                    company_name = stock_company
                if not exchange:
                    exchange = stock_exchange
                if not industry:
                    industry = stock_industry

            if company_name and _is_missing(row.organ_name):
                updates["organ_name"] = company_name
            if exchange and _is_missing(row.exchange):
                updates["exchange"] = exchange
            if industry and _is_missing(row.industry_name):
                updates["industry_name"] = industry
            if outstanding_shares and _is_missing(row.shares_outstanding):
                updates["shares_outstanding"] = outstanding_shares
            elif listed_shares and _is_missing(row.shares_outstanding):
                updates["shares_outstanding"] = listed_shares

        shares_for_market_cap = updates.get("shares_outstanding", row.shares_outstanding)
        if _is_missing(row.market_cap):
            estimated_market_cap = _estimate_market_cap(row.price, shares_for_market_cap)
            if estimated_market_cap is not None:
                updates["market_cap"] = estimated_market_cap

        if updates:
            row = row.model_copy(update=updates)

        if (
            _is_missing(row.organ_name)
            or _is_missing(row.exchange)
            or _is_missing(row.industry_name)
        ):
            row = row.model_copy(
                update={
                    "organ_name": row.symbol if _is_missing(row.organ_name) else row.organ_name,
                    "exchange": "UNKNOWN" if _is_missing(row.exchange) else row.exchange,
                    "industry_name": "Unknown"
                    if _is_missing(row.industry_name)
                    else row.industry_name,
                }
            )

        hydrated.append(row)

    return hydrated


def _coerce_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(numeric):
        return None
    return numeric


def _pick_float(*values: Any) -> Optional[float]:
    for value in values:
        numeric = _coerce_float(value)
        if numeric is not None:
            return numeric
    return None


def _shares_multiplier(shares: float) -> float:
    return 1.0 if shares >= 1_000_000 else 1_000_000.0


def _compute_growth(current: Optional[float], previous: Optional[float]) -> Optional[float]:
    if current is None or previous in (None, 0):
        return None
    return ((current - previous) / previous) * 100


def _normalize_dividend_yield(value: Any) -> Optional[float]:
    numeric = _coerce_float(value)
    if numeric is None:
        return None

    normalized = numeric
    while abs(normalized) > 100:
        normalized /= 100

    return normalized


async def _enrich_screener_metrics(
    rows: List[ScreenerData], db: AsyncSession
) -> List[ScreenerData]:
    if not rows:
        return rows

    target_symbols = sorted(
        {
            row.symbol
            for row in rows
            if row.symbol
            and (
                row.revenue_growth is None
                or row.earnings_growth is None
                or row.operating_margin is None
                or row.ev_ebitda is None
                or row.dividend_yield is None
                or row.change_1d is None
                or row.perf_1w is None
                or row.perf_1m is None
                or row.perf_ytd is None
                or row.debt_to_asset is None
                or row.equity_on_total_asset is None
                or row.market_cap is None
            )
        }
    )
    if not target_symbols:
        return rows

    ratio_rows = (
        (
            await db.execute(
                select(FinancialRatio)
                .where(
                    FinancialRatio.symbol.in_(target_symbols), FinancialRatio.period_type == "year"
                )
                .order_by(
                    FinancialRatio.symbol.asc(),
                    FinancialRatio.fiscal_year.desc(),
                    FinancialRatio.fiscal_quarter.desc(),
                )
            )
        )
        .scalars()
        .all()
    )
    ratio_by_symbol: dict[str, FinancialRatio] = {}
    for ratio in ratio_rows:
        ratio_by_symbol.setdefault(ratio.symbol, ratio)

    income_rows = (
        await db.execute(
            select(
                IncomeStatement.symbol,
                IncomeStatement.fiscal_year,
                IncomeStatement.revenue,
                IncomeStatement.operating_income,
                IncomeStatement.net_income,
            )
            .where(
                IncomeStatement.symbol.in_(target_symbols),
                IncomeStatement.period_type == "year",
            )
            .order_by(IncomeStatement.symbol.asc(), IncomeStatement.fiscal_year.desc())
        )
    ).all()
    income_by_symbol: dict[str, list[dict[str, Optional[float]]]] = {
        symbol: [] for symbol in target_symbols
    }
    for symbol, _year, revenue, operating_income, net_income in income_rows:
        bucket = income_by_symbol.setdefault(symbol, [])
        if len(bucket) >= 2:
            continue
        bucket.append(
            {
                "revenue": _coerce_float(revenue),
                "operating_income": _coerce_float(operating_income),
                "net_income": _coerce_float(net_income),
            }
        )

    balance_rows = (
        await db.execute(
            select(
                BalanceSheet.symbol,
                BalanceSheet.total_assets,
                BalanceSheet.total_liabilities,
                BalanceSheet.total_equity,
            )
            .where(BalanceSheet.symbol.in_(target_symbols), BalanceSheet.period_type == "year")
            .order_by(BalanceSheet.symbol.asc(), BalanceSheet.fiscal_year.desc())
        )
    ).all()
    balance_by_symbol: dict[str, dict[str, Optional[float]]] = {}
    for symbol, total_assets, total_liabilities, total_equity in balance_rows:
        if symbol in balance_by_symbol:
            continue
        balance_by_symbol[symbol] = {
            "total_assets": _coerce_float(total_assets),
            "total_liabilities": _coerce_float(total_liabilities),
            "total_equity": _coerce_float(total_equity),
        }

    cashflow_rows = (
        await db.execute(
            select(CashFlow.symbol, CashFlow.dividends_paid)
            .where(CashFlow.symbol.in_(target_symbols), CashFlow.period_type == "year")
            .order_by(CashFlow.symbol.asc(), CashFlow.fiscal_year.desc())
        )
    ).all()
    dividends_by_symbol: dict[str, Optional[float]] = {}
    for symbol, dividends_paid in cashflow_rows:
        if symbol not in dividends_by_symbol:
            dividends_by_symbol[symbol] = _coerce_float(dividends_paid)

    company_rows = (
        await db.execute(
            select(
                Company.symbol,
                Company.outstanding_shares,
                Company.listed_shares,
                Company.raw_data,
            ).where(Company.symbol.in_(target_symbols))
        )
    ).all()
    shares_by_symbol: dict[str, Optional[float]] = {}
    for symbol, outstanding_shares, listed_shares, raw_data in company_rows:
        payload = raw_data if isinstance(raw_data, dict) else {}
        shares_by_symbol[symbol] = _pick_float(
            outstanding_shares,
            listed_shares,
            payload.get("outstanding_shares"),
            payload.get("listed_shares"),
            payload.get("issue_share"),
            payload.get("financial_ratio_issue_share"),
        )

    price_rows = (
        await db.execute(
            select(StockPrice.symbol, StockPrice.time, StockPrice.close)
            .where(StockPrice.symbol.in_(target_symbols), StockPrice.interval == "1D")
            .order_by(StockPrice.symbol.asc(), StockPrice.time.desc())
        )
    ).all()

    price_series_by_symbol: dict[str, list[tuple[Any, float]]] = {
        symbol: [] for symbol in target_symbols
    }
    for symbol, price_time, close in price_rows:
        close_value = _coerce_float(close)
        if close_value in (None, 0):
            continue
        bucket = price_series_by_symbol.setdefault(symbol, [])
        if len(bucket) >= 260:
            continue
        bucket.append((price_time, close_value))

    def _build_performance_map(days: int) -> dict[str, float]:
        perf_map: dict[str, float] = {}
        for symbol, series in price_series_by_symbol.items():
            if len(series) < 2:
                continue
            latest_price = series[0][1]
            lookback_index = min(days, len(series) - 1)
            base_price = series[lookback_index][1]
            if base_price in (None, 0):
                continue
            perf_map[symbol] = ((latest_price - base_price) / base_price) * 100
        return perf_map

    perf_1d_map = _build_performance_map(1)
    perf_1w_map = _build_performance_map(5)
    perf_1m_map = _build_performance_map(21)
    perf_ytd_map = _build_performance_map(252)

    enriched_rows: List[ScreenerData] = []
    for row in rows:
        updates: dict[str, Any] = {}
        symbol = row.symbol
        ratio_row = ratio_by_symbol.get(symbol)
        ratio_raw = ratio_row.raw_data if ratio_row and isinstance(ratio_row.raw_data, dict) else {}
        income = income_by_symbol.get(symbol, [])
        latest_income = income[0] if income else {}
        prev_income = income[1] if len(income) > 1 else {}
        balance = balance_by_symbol.get(symbol, {})

        if row.ev_ebitda is None:
            ev_ebitda = _pick_float(
                ratio_row.ev_ebitda if ratio_row else None,
                ratio_raw.get("ev_ebitda"),
                ratio_raw.get("valueBeforeEbitda"),
                ratio_raw.get("evEbitda"),
            )
            if ev_ebitda is not None:
                updates["ev_ebitda"] = ev_ebitda

        if row.operating_margin is None:
            operating_margin = _pick_float(
                ratio_row.operating_margin if ratio_row else None,
                ratio_raw.get("operating_margin"),
                ratio_raw.get("operatingMargin"),
            )
            if operating_margin is None:
                revenue = _coerce_float(latest_income.get("revenue"))
                operating_income = _coerce_float(latest_income.get("operating_income"))
                if revenue not in (None, 0) and operating_income is not None:
                    operating_margin = (operating_income / revenue) * 100
            if operating_margin is not None:
                updates["operating_margin"] = operating_margin

        if row.revenue_growth is None:
            revenue_growth = _pick_float(
                ratio_row.revenue_growth if ratio_row else None,
                ratio_raw.get("revenue_growth"),
                ratio_raw.get("revenueGrowth"),
            )
            if revenue_growth is None:
                revenue_growth = _compute_growth(
                    _coerce_float(latest_income.get("revenue")),
                    _coerce_float(prev_income.get("revenue")),
                )
            if revenue_growth is not None:
                updates["revenue_growth"] = revenue_growth

        if row.earnings_growth is None:
            earnings_growth = _pick_float(
                ratio_row.earnings_growth if ratio_row else None,
                ratio_raw.get("earnings_growth"),
                ratio_raw.get("earningsGrowth"),
                ratio_raw.get("net_profit_growth"),
            )
            if earnings_growth is None:
                earnings_growth = _compute_growth(
                    _coerce_float(latest_income.get("net_income")),
                    _coerce_float(prev_income.get("net_income")),
                )
            if earnings_growth is not None:
                updates["earnings_growth"] = earnings_growth

        if row.debt_to_asset is None:
            debt_to_asset = _pick_float(
                ratio_row.debt_to_assets if ratio_row else None,
                ratio_raw.get("debt_to_assets"),
                ratio_raw.get("debt_to_asset"),
                ratio_raw.get("debtOnAsset"),
            )
            if debt_to_asset is None:
                liabilities = _coerce_float(balance.get("total_liabilities"))
                assets = _coerce_float(balance.get("total_assets"))
                if liabilities is not None and assets not in (None, 0):
                    debt_to_asset = liabilities / assets
            if debt_to_asset is not None:
                updates["debt_to_asset"] = debt_to_asset

        if row.equity_on_total_asset is None:
            equity_on_total_asset = _pick_float(
                ratio_raw.get("equity_on_total_asset"),
                ratio_raw.get("equityOnTotalAsset"),
            )
            if equity_on_total_asset is None:
                equity = _coerce_float(balance.get("total_equity"))
                assets = _coerce_float(balance.get("total_assets"))
                if equity is not None and assets not in (None, 0):
                    equity_on_total_asset = (equity / assets) * 100
            if equity_on_total_asset is not None:
                updates["equity_on_total_asset"] = equity_on_total_asset

        if row.dividend_yield is None:
            dividend_yield = _normalize_dividend_yield(
                _pick_float(
                    ratio_raw.get("dividend_yield"),
                    ratio_raw.get("dividendYield"),
                )
            )
            if dividend_yield is None:
                dps = _pick_float(
                    ratio_row.dps if ratio_row else None,
                    ratio_raw.get("dps"),
                    ratio_raw.get("dividend_per_share"),
                )
                if dps is None:
                    dividends_paid = _coerce_float(dividends_by_symbol.get(symbol))
                    shares = _coerce_float(shares_by_symbol.get(symbol))
                    if dividends_paid is not None and shares not in (None, 0):
                        dps = abs(dividends_paid) / (shares * _shares_multiplier(shares))
                price = _coerce_float(row.price)
                if dps is not None and price not in (None, 0):
                    dividend_yield = _normalize_dividend_yield((dps / price) * 100)
            if dividend_yield is not None:
                updates["dividend_yield"] = dividend_yield

        if row.change_1d is None and symbol in perf_1d_map:
            updates["change_1d"] = perf_1d_map[symbol]

        if row.perf_1w is None and symbol in perf_1w_map:
            updates["perf_1w"] = perf_1w_map[symbol]

        if row.perf_1m is None and symbol in perf_1m_map:
            updates["perf_1m"] = perf_1m_map[symbol]

        if row.perf_ytd is None and symbol in perf_ytd_map:
            updates["perf_ytd"] = perf_ytd_map[symbol]

        if row.market_cap is None:
            shares = _coerce_float(row.shares_outstanding) or _coerce_float(
                shares_by_symbol.get(symbol)
            )
            price = _coerce_float(row.price)
            if shares not in (None, 0) and price not in (None, 0):
                updates["market_cap"] = price * shares * _shares_multiplier(shares)

        if updates:
            row = row.model_copy(update=updates)

        enriched_rows.append(row)

    return enriched_rows


def apply_advanced_filters(
    data: List[ScreenerData], filters: Optional[str] = None, sort: Optional[str] = None, **kwargs
) -> List[ScreenerData]:
    """Apply dynamic filters and sorting using ScreenerFilterService."""
    if not data:
        return []

    df = pd.DataFrame([d.model_dump() for d in data])

    if filters:
        filter_group = ScreenerFilterService.parse_filter_json(filters)
        df = ScreenerFilterService.apply_filters(df, filter_group)

    for key, val in kwargs.items():
        if val is not None:
            if key.endswith("_min"):
                field = key[:-4]
                if field in df.columns:
                    df = df[df[field] >= val]
            elif key.endswith("_max"):
                field = key[:-4]
                if field in df.columns:
                    df = df[df[field] <= val]

    if sort:
        df = ScreenerFilterService.apply_multi_sort(df, sort)
    elif kwargs.get("sort_by"):
        sort_by = kwargs.get("sort_by")
        sort_order = kwargs.get("sort_order", "desc")
        df = ScreenerFilterService.apply_multi_sort(df, f"{sort_by}:{sort_order}")

    return [ScreenerData(**row) for row in df.to_dict("records")]


def fill_market_cap(rows: List[ScreenerData]) -> List[ScreenerData]:
    for row in rows:
        if row.market_cap is None and row.price is not None and row.shares_outstanding:
            multiplier = 1 if row.shares_outstanding >= 1_000_000 else 1_000_000
            row.market_cap = row.price * row.shares_outstanding * multiplier
    return rows


async def _refresh_screener_cache(params: StockScreenerParams) -> None:
    cache_manager = CacheManager()
    try:
        if not vnstock_cb.is_available():
            logger.info("Skipping screener background refresh while circuit breaker is open")
            return

        data = await asyncio.wait_for(VnstockScreenerFetcher.fetch(params), timeout=20.0)
        if not data:
            logger.warning(f"Screener refresh returned empty data (source={params.source})")
            return
        data = fill_market_cap(data)
        await cache_manager.store_screener_data(
            data=[d.model_dump() for d in data],
            source=params.source,
        )
        logger.info(f"Background screener refresh complete (source={params.source})")
    except Exception as e:
        logger.warning(f"Background screener refresh failed (source={params.source}): {e}")


@router.get(
    "",
    response_model=StandardResponse[List[ScreenerData]],
    response_model_by_alias=False,
    summary="Get Stock Screener Data",
)
@router.get(
    "/",
    response_model=StandardResponse[List[ScreenerData]],
    response_model_by_alias=False,
    summary="Get Stock Screener Data",
)
async def get_screener(
    request: Request,
    symbol: Optional[str] = Query(None),
    exchange: str = Query(default="ALL", pattern=r"^(HOSE|HNX|UPCOM|ALL)$"),
    industry: Optional[str] = Query(None),
    limit: int = Query(default=100, ge=1, le=2000),
    source: str = Query(default="KBS"),
    use_cache: bool = Query(default=True),
    refresh: bool = Query(default=False),
    filters: Optional[str] = Query(None),
    sort: Optional[str] = Query(None),
    pe_min: Optional[float] = Query(None),
    pe_max: Optional[float] = Query(None),
    pb_min: Optional[float] = Query(None),
    pb_max: Optional[float] = Query(None),
    ps_min: Optional[float] = Query(None),
    ps_max: Optional[float] = Query(None),
    roe_min: Optional[float] = Query(None),
    roa_min: Optional[float] = Query(None),
    debt_to_equity_max: Optional[float] = Query(None),
    market_cap_min: Optional[float] = Query(None),
    market_cap_max: Optional[float] = Query(None),
    volume_min: Optional[int] = Query(None),
    sort_by: Optional[str] = Query(None),
    sort_order: str = Query(default="desc", pattern=r"^(asc|desc)$"),
    db: AsyncSession = Depends(get_db),
) -> StandardResponse[List[ScreenerData]]:
    cache_manager = CacheManager(db)
    now = datetime.now()

    if use_cache and not refresh:
        try:
            cache_result = await cache_manager.get_screener_data(
                symbol=symbol, source=source, allow_stale=True
            )
            if cache_result.hit and cache_result.data:
                data = [_to_screener_data_row(s) for s in cache_result.data]
                data = await _hydrate_screener_rows(data, db)
                data = fill_market_cap(data)
                data = await _enrich_screener_metrics(data, db)
                data = apply_advanced_filters(
                    data,
                    filters=filters,
                    sort=sort,
                    pe_min=pe_min,
                    pe_max=pe_max,
                    pb_min=pb_min,
                    pb_max=pb_max,
                    ps_min=ps_min,
                    ps_max=ps_max,
                    roe_min=roe_min,
                    roa_min=roa_min,
                    debt_to_equity_max=debt_to_equity_max,
                    market_cap_min=market_cap_min,
                    market_cap_max=market_cap_max,
                    volume_min=volume_min,
                    sort_by=sort_by,
                    sort_order=sort_order,
                )[:limit]
                if cache_result.is_stale and not refresh:
                    refresh_key = f"screener:{source}:full"
                    refresh_params = StockScreenerParams(
                        symbol=None,
                        exchange="ALL",
                        industry=None,
                        limit=120,
                        source=source,
                    )
                    await _schedule_refresh(
                        refresh_key,
                        lambda: _refresh_screener_cache(refresh_params),
                    )
                return StandardResponse(data=data, meta=MetaData(count=len(data)))

            if source:
                fallback_cache = await cache_manager.get_screener_data(
                    symbol=symbol, source=None, allow_stale=True
                )
                if fallback_cache.hit and fallback_cache.data:
                    data = [_to_screener_data_row(s) for s in fallback_cache.data]
                    data = await _hydrate_screener_rows(data, db)
                    data = fill_market_cap(data)
                    data = await _enrich_screener_metrics(data, db)
                    data = apply_advanced_filters(
                        data,
                        filters=filters,
                        sort=sort,
                        pe_min=pe_min,
                        pe_max=pe_max,
                        pb_min=pb_min,
                        pb_max=pb_max,
                        ps_min=ps_min,
                        ps_max=ps_max,
                        roe_min=roe_min,
                        roa_min=roa_min,
                        debt_to_equity_max=debt_to_equity_max,
                        market_cap_min=market_cap_min,
                        market_cap_max=market_cap_max,
                        volume_min=volume_min,
                        sort_by=sort_by,
                        sort_order=sort_order,
                    )[:limit]
                    return StandardResponse(data=data, meta=MetaData(count=len(data)))
        except Exception as e:
            logger.warning(f"Cache lookup failed: {e}")

    try:
        params = StockScreenerParams(
            symbol=symbol, exchange=exchange, industry=industry, limit=limit, source=source
        )
        data = await asyncio.wait_for(VnstockScreenerFetcher.fetch(params), timeout=20.0)

        if not data:
            raise ProviderError(message="API returned empty data", provider="vnstock")

        data = fill_market_cap(data)
        data = await _enrich_screener_metrics(data, db)
        data = apply_advanced_filters(
            data,
            filters=filters,
            sort=sort,
            pe_min=pe_min,
            pe_max=pe_max,
            pb_min=pb_min,
            pb_max=pb_max,
            ps_min=ps_min,
            ps_max=ps_max,
            roe_min=roe_min,
            roa_min=roa_min,
            debt_to_equity_max=debt_to_equity_max,
            market_cap_min=market_cap_min,
            market_cap_max=market_cap_max,
            volume_min=volume_min,
            sort_by=sort_by,
            sort_order=sort_order,
        )[:limit]

        data = await _hydrate_screener_rows(data, db)

        await cache_manager.store_screener_data(data=[d.model_dump() for d in data], source=source)
        return StandardResponse(data=data, meta=MetaData(count=len(data)))

    except (ProviderTimeoutError, ProviderError, ProviderRateLimitError) as e:
        if use_cache:
            cache_result = await cache_manager.get_screener_data(
                symbol=symbol, source=source, allow_stale=True
            )
            if cache_result.hit and cache_result.data:
                data = [_to_screener_data_row(s) for s in cache_result.data]
                data = await _hydrate_screener_rows(data, db)
                data = fill_market_cap(data)
                data = await _enrich_screener_metrics(data, db)
                data = apply_advanced_filters(
                    data,
                    filters=filters,
                    sort=sort,
                    pe_min=pe_min,
                    pe_max=pe_max,
                    pb_min=pb_min,
                    pb_max=pb_max,
                    ps_min=ps_min,
                    ps_max=ps_max,
                    roe_min=roe_min,
                    roa_min=roa_min,
                    debt_to_equity_max=debt_to_equity_max,
                    market_cap_min=market_cap_min,
                    market_cap_max=market_cap_max,
                    volume_min=volume_min,
                    sort_by=sort_by,
                    sort_order=sort_order,
                )[:limit]
                return StandardResponse(data=data, meta=MetaData(count=len(data)))

        # Final fallback: return empty results with user-friendly message
        # This prevents 502 errors and provides better UX
        logger.warning(f"Screener request failed, returning empty results: {e}")
        return StandardResponse(
            data=[],
            meta=MetaData(
                count=0,
                message="No data available. Please try again later or check your connection.",
            ),
        )

    except Exception as e:
        # Catch-all for unexpected errors
        logger.error(f"Unexpected screener error: {e}")
        return StandardResponse(
            data=[], meta=MetaData(count=0, message="An error occurred. Please try again.")
        )
