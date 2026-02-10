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
from typing import List, Optional, Callable, Awaitable

from fastapi import APIRouter, HTTPException, Query, Request, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import pandas as pd

from vnibb.core.database import get_db
from vnibb.models.stock import Stock
from vnibb.models.company import Company
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
    return ScreenerData(
        symbol=getattr(row, "symbol", None),
        organ_name=getattr(row, "company_name", None),
        exchange=getattr(row, "exchange", None),
        industry_name=getattr(row, "industry", None),
        price=getattr(row, "price", None),
        volume=getattr(row, "volume", None),
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
        current_ratio=getattr(row, "current_ratio", None),
        quick_ratio=getattr(row, "quick_ratio", None),
        eps=getattr(row, "eps", None),
        bvps=getattr(row, "bvps", None),
        foreign_ownership=getattr(row, "foreign_ownership", None),
    )


async def _hydrate_screener_rows(
    rows: List[ScreenerData], db: AsyncSession
) -> List[ScreenerData]:
    def _is_missing(value: object) -> bool:
        if value is None:
            return True
        if isinstance(value, float) and math.isnan(value):
            return True
        if isinstance(value, str) and value.strip().lower() in {"", "nan", "none", "null"}:
            return True
        return False

    missing_symbols = [
        row.symbol
        for row in rows
        if row.symbol
        and (
            _is_missing(row.organ_name)
            or _is_missing(row.exchange)
            or _is_missing(row.industry_name)
        )
    ]
    symbols = sorted({symbol for symbol in missing_symbols if symbol})
    stock_map: dict[str, tuple[Optional[str], Optional[str], Optional[str]]] = {}
    company_map: dict[str, tuple[Optional[str], Optional[str], Optional[str]]] = {}
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
            select(Company.symbol, Company.company_name, Company.exchange, Company.industry).where(
                Company.symbol.in_(symbols)
            )
        )
        company_map = {
            symbol: (company_name, exchange, industry)
            for symbol, company_name, exchange, industry in company_result.fetchall()
        }

    hydrated: List[ScreenerData] = []
    for row in rows:
        updates: dict[str, Optional[str]] = {}
        symbol = row.symbol
        company_name = None
        exchange = None
        industry = None

        if symbol:
            if symbol in company_map:
                company_name, exchange, industry = company_map[symbol]
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
                    "industry_name": "Unknown" if _is_missing(row.industry_name) else row.industry_name,
                }
            )

        hydrated.append(row)

    return hydrated


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
            row.market_cap = row.price * row.shares_outstanding * 1_000_000
    return rows


async def _refresh_screener_cache(params: StockScreenerParams) -> None:
    cache_manager = CacheManager()
    try:
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
                        limit=2000,
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
