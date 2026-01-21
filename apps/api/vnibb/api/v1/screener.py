"""
Screener API Endpoints

Provides endpoints for:
- Stock screening with 84 financial metrics
- Filtering by exchange, industry
- Database caching with TTL
"""

import logging
import asyncio
from datetime import datetime, date
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query, Request, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
import pandas as pd

from vnibb.core.database import get_db
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

def apply_advanced_filters(
    data: List[ScreenerData],
    filters: Optional[str] = None,
    sort: Optional[str] = None,
    **kwargs
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
            if key.endswith('_min'):
                field = key[:-4]
                if field in df.columns:
                    df = df[df[field] >= val]
            elif key.endswith('_max'):
                field = key[:-4]
                if field in df.columns:
                    df = df[df[field] <= val]

    if sort:
        df = ScreenerFilterService.apply_multi_sort(df, sort)
    elif kwargs.get('sort_by'):
        sort_by = kwargs.get('sort_by')
        sort_order = kwargs.get('sort_order', 'desc')
        df = ScreenerFilterService.apply_multi_sort(df, f"{sort_by}:{sort_order}")

    return [ScreenerData(**row) for row in df.to_dict('records')]

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
    
    if use_cache:
        try:
            cache_result = await cache_manager.get_screener_data(symbol=symbol, source=source, allow_stale=True)
            if cache_result.is_fresh:
                data = [
                    ScreenerData(
                        symbol=s.symbol, organ_name=s.company_name, exchange=s.exchange,
                        industry_name=s.industry, price=s.price, volume=s.volume,
                        market_cap=s.market_cap, pe=s.pe, pb=s.pb, ps=s.ps,
                        ev_ebitda=s.ev_ebitda, roe=s.roe, roa=s.roa, roic=s.roic,
                        gross_margin=s.gross_margin, net_margin=s.net_margin,
                        operating_margin=s.operating_margin, revenue_growth=s.revenue_growth,
                        earnings_growth=s.earnings_growth, dividend_yield=s.dividend_yield,
                        debt_to_equity=s.debt_to_equity, current_ratio=s.current_ratio,
                        quick_ratio=s.quick_ratio, eps=s.eps, bvps=s.bvps,
                        foreign_ownership=s.foreign_ownership,
                    ) for s in cache_result.data
                ]
                data = apply_advanced_filters(
                    data, filters=filters, sort=sort, pe_min=pe_min, pe_max=pe_max,
                    pb_min=pb_min, pb_max=pb_max, ps_min=ps_min, ps_max=ps_max,
                    roe_min=roe_min, roa_min=roa_min, debt_to_equity_max=debt_to_equity_max,
                    market_cap_min=market_cap_min, market_cap_max=market_cap_max,
                    volume_min=volume_min, sort_by=sort_by, sort_order=sort_order,
                )[:limit]
                return StandardResponse(data=data, meta=MetaData(count=len(data)))
        except Exception as e:
            logger.warning(f"Cache lookup failed: {e}")
    
    try:
        params = StockScreenerParams(symbol=symbol, exchange=exchange, industry=industry, limit=limit, source=source)
        data = await asyncio.wait_for(VnstockScreenerFetcher.fetch(params), timeout=30.0)
        
        if not data:
            raise ProviderError(message="API returned empty data", provider="vnstock")
        
        data = apply_advanced_filters(
            data, filters=filters, sort=sort, pe_min=pe_min, pe_max=pe_max,
            pb_min=pb_min, pb_max=pb_max, ps_min=ps_min, ps_max=ps_max,
            roe_min=roe_min, roa_min=roa_min, debt_to_equity_max=debt_to_equity_max,
            market_cap_min=market_cap_min, market_cap_max=market_cap_max,
            volume_min=volume_min, sort_by=sort_by, sort_order=sort_order,
        )[:limit]
        
        await cache_manager.store_screener_data(data=[d.model_dump() for d in data], source=source)
        return StandardResponse(data=data, meta=MetaData(count=len(data)))
        
    except (ProviderTimeoutError, ProviderError, ProviderRateLimitError) as e:
        if use_cache:
            cache_result = await cache_manager.get_screener_data(symbol=symbol, source=source, allow_stale=True)
            if cache_result.hit and cache_result.data:
                data = [
                    ScreenerData(
                        symbol=s.symbol, organ_name=s.company_name, exchange=s.exchange,
                        industry_name=s.industry, price=s.price, volume=s.volume,
                        market_cap=s.market_cap, pe=s.pe, pb=s.pb, ps=s.ps,
                        ev_ebitda=s.ev_ebitda, roe=s.roe, roa=s.roa, roic=s.roic,
                        gross_margin=s.gross_margin, net_margin=s.net_margin,
                        operating_margin=s.operating_margin, revenue_growth=s.revenue_growth,
                        earnings_growth=s.earnings_growth, dividend_yield=s.dividend_yield,
                        debt_to_equity=s.debt_to_equity, current_ratio=s.current_ratio,
                        quick_ratio=s.quick_ratio, eps=s.eps, bvps=s.bvps,
                        foreign_ownership=s.foreign_ownership,
                    ) for s in cache_result.data
                ]
                data = apply_advanced_filters(
                    data, filters=filters, sort=sort, pe_min=pe_min, pe_max=pe_max,
                    pb_min=pb_min, pb_max=pb_max, ps_min=ps_min, ps_max=ps_max,
                    roe_min=roe_min, roa_min=roa_min, debt_to_equity_max=debt_to_equity_max,
                    market_cap_min=market_cap_min, market_cap_max=market_cap_max,
                    volume_min=volume_min, sort_by=sort_by, sort_order=sort_order,
                )[:limit]
                return StandardResponse(data=data, meta=MetaData(count=len(data)))
        
        # Final fallback: return empty results with user-friendly message
        # This prevents 502 errors and provides better UX
        logger.warning(f"Screener request failed, returning empty results: {e}")
        return StandardResponse(
            data=[],
            meta=MetaData(
                count=0,
                message="No data available. Please try again later or check your connection."
            )
        )
    
    except Exception as e:
        # Catch-all for unexpected errors
        logger.error(f"Unexpected screener error: {e}")
        return StandardResponse(
            data=[],
            meta=MetaData(
                count=0,
                message="An error occurred. Please try again."
            )
        )

