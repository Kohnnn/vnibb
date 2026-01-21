"""
Listing API Endpoints

Provides endpoints for stock symbol listings.
"""

from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from vnibb.providers.vnstock.listing import (
    VnstockListingFetcher,
    SymbolData,
    ExchangeSymbolData,
    IndexGroupSymbolData,
    IndustryData,
)
from vnibb.core.exceptions import ProviderError
from vnibb.core.cache import redis_client, build_cache_key
from vnibb.services.cache_manager import CacheManager

router = APIRouter()


# =============================================================================
# RESPONSE MODELS
# =============================================================================

class SymbolsResponse(BaseModel):
    """Response for symbol listing."""
    count: int
    data: List[SymbolData]


class ExchangeSymbolsResponse(BaseModel):
    """Response for symbols by exchange."""
    count: int
    data: List[ExchangeSymbolData]


class GroupSymbolsResponse(BaseModel):
    """Response for symbols by index group."""
    group: str
    count: int
    data: List[IndexGroupSymbolData]


class IndustriesResponse(BaseModel):
    """Response for ICB industries."""
    count: int
    data: List[IndustryData]


# =============================================================================
# ENDPOINTS
# =============================================================================

@router.get(
    "/symbols",
    response_model=SymbolsResponse,
    summary="Get All Symbols",
    description="Get list of all stock symbols in Vietnam market.",
)
async def get_all_symbols(
    source: str = Query(default="KBS", pattern=r"^(KBS|VCI|VND|TCBS|DNSE)$"),

) -> SymbolsResponse:
    """Fetch all stock symbols. Cached for 24 hours using database."""
    cache_manager = CacheManager()
    
    # Check database cache first (24 hour TTL)
    cache_result = await cache_manager.get_listing_data(source=source)
    
    if cache_result.is_fresh:
        # Convert Stock models to SymbolData
        data = [
            SymbolData(
                symbol=stock.symbol,
                organ_name=stock.company_name,
                exchange=stock.exchange,
            )
            for stock in cache_result.data
        ]
        return SymbolsResponse(count=len(data), data=data)
    
    # Fetch from upstream API
    try:
        data = await VnstockListingFetcher.fetch_all_symbols(source=source)
        
        # Store in database cache (24 hour TTL is built into CacheManager)
        if data:
            await cache_manager.store_listing_data(
                [d.model_dump(mode="json") for d in data],
                source=source
            )
            
            # Also update Redis for quick access
            cache_key = build_cache_key("vnibb", "listing", "symbols", source)
            try:
                await redis_client.set_json(
                    cache_key,
                    [d.model_dump(mode="json") for d in data],
                    ttl=86400
                )
            except Exception:
                pass  # Redis cache write failure is non-fatal
        
        return SymbolsResponse(count=len(data), data=data)
    except (ProviderError, Exception) as e:
        # Fallback to stale cache on API failure
        if cache_result.hit and cache_result.data:
            data = [
                SymbolData(
                    symbol=stock.symbol,
                    organ_name=stock.company_name,
                    exchange=stock.exchange,
                )
                for stock in cache_result.data
            ]
            return SymbolsResponse(count=len(data), data=data)
        
        if isinstance(e, ProviderError):
            raise HTTPException(status_code=502, detail=f"Provider error: {e.message}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get(
    "/exchanges",
    response_model=ExchangeSymbolsResponse,
    summary="Get Symbols by Exchange",
    description="Get symbols categorized by exchange (HOSE, HNX, UPCOM).",
)
async def get_symbols_by_exchange(
    source: str = Query(default="KBS", pattern=r"^(KBS|VCI|VND|TCBS|DNSE)$"),

    lang: str = Query(default="en", pattern=r"^(en|vi)$"),
) -> ExchangeSymbolsResponse:
    """Fetch symbols by exchange."""
    try:
        data = await VnstockListingFetcher.fetch_symbols_by_exchange(source=source, lang=lang)
        return ExchangeSymbolsResponse(count=len(data), data=data)
    except ProviderError as e:
        raise HTTPException(status_code=502, detail=f"Provider error: {e.message}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get(
    "/groups/{group}",
    response_model=GroupSymbolsResponse,
    summary="Get Symbols by Index Group",
    description="Get symbols in an index group (VN30, VN100, VNMidCap, etc.).",
)
async def get_symbols_by_group(
    group: str,
    source: str = Query(default="KBS", pattern=r"^(KBS|VCI|VND|TCBS|DNSE)$"),

) -> GroupSymbolsResponse:
    """Fetch symbols in an index group."""
    try:
        data = await VnstockListingFetcher.fetch_symbols_by_group(group=group, source=source)
        return GroupSymbolsResponse(group=group, count=len(data), data=data)
    except ProviderError as e:
        raise HTTPException(status_code=502, detail=f"Provider error: {e.message}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get(
    "/industries",
    response_model=IndustriesResponse,
    summary="Get ICB Industries",
    description="Get ICB (Industry Classification Benchmark) industry list.",
)
async def get_industries(
    source: str = Query(default="KBS", pattern=r"^(KBS|VCI|VND|TCBS|DNSE)$"),

) -> IndustriesResponse:
    """Fetch ICB industry classification. Cached for 24 hours using database."""
    cache_manager = CacheManager()
    
    # Check database cache first (24 hour TTL)
    cache_result = await cache_manager.get_industries_data(source=source)
    
    if cache_result.is_fresh and cache_result.data:
        # Extract unique industries from Stock records
        industries_set = set()
        for stock in cache_result.data:
            if stock.industry:
                industries_set.add(stock.industry)
        
        # Convert to IndustryData (simplified - using industry name as code)
        data = [
            IndustryData(icb_code=f"ICB_{i}", icb_name=industry)
            for i, industry in enumerate(sorted(industries_set))
        ]
        return IndustriesResponse(count=len(data), data=data)
    
    # Fetch from upstream API
    try:
        data = await VnstockListingFetcher.fetch_industries_icb(source=source)
        
        # Store in database cache via listing data (industries are derived from stocks)
        # The listing data store will update industry fields on Stock records
        
        return IndustriesResponse(count=len(data), data=data)
    except (ProviderError, Exception) as e:
        # Fallback to stale cache on API failure
        if cache_result.hit and cache_result.data:
            industries_set = set()
            for stock in cache_result.data:
                if stock.industry:
                    industries_set.add(stock.industry)
            
            data = [
                IndustryData(icb_code=f"ICB_{i}", icb_name=industry)
                for i, industry in enumerate(sorted(industries_set))
            ]
            return IndustriesResponse(count=len(data), data=data)
        
        if isinstance(e, ProviderError):
            raise HTTPException(status_code=502, detail=f"Provider error: {e.message}")
        raise HTTPException(status_code=500, detail=str(e))
