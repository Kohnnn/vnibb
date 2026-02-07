"""
Trading API Endpoints

Provides endpoints for real-time trading data.
"""

from typing import List, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from vnibb.providers.vnstock.price_board import (
    VnstockPriceBoardFetcher,
    PriceBoardData,
)
from vnibb.providers.vnstock.top_movers import (
    VnstockTopMoversFetcher,
    TopMoverData,
    SectorStockData,
    SectorTopMoversData,
)
from vnibb.core.exceptions import ProviderError
from vnibb.core.cache import redis_client, build_cache_key

router = APIRouter()


# =============================================================================
# RESPONSE MODELS
# =============================================================================

class PriceBoardResponse(BaseModel):
    """Response for price board."""
    count: int
    data: List[PriceBoardData]


class TopMoversResponse(BaseModel):
    """Response for top movers."""
    type: str
    index: str
    count: int
    data: List[TopMoverData]


class SectorTopMoversResponse(BaseModel):
    """Response for sector top movers endpoint."""
    count: int
    type: str
    data: List[SectorTopMoversData]


# =============================================================================
# ENDPOINTS
# =============================================================================

@router.get(
    "/price-board",
    response_model=PriceBoardResponse,
    summary="Get Real-time Price Board",
    description="Get real-time prices for multiple symbols simultaneously.",
)
async def get_price_board(
    symbols: str = Query(
        ...,
        description="Comma-separated list of symbols (e.g., VNM,FPT,VIC)",
        examples=["VNM,FPT,VIC"],
    ),

    source: str = Query(
        default="KBS",
        pattern=r"^(KBS|VCI|DNSE)$",
        description="Data source: KBS (default), VCI, or DNSE",
    ),

) -> PriceBoardResponse:
    """Fetch real-time price board for multiple symbols. Cached for 1 minute."""
    symbol_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not symbol_list:
        raise HTTPException(status_code=400, detail="At least one symbol is required")
    if len(symbol_list) > 50:
        raise HTTPException(status_code=400, detail="Maximum 50 symbols allowed")
    
    # Create consistent cache key (sort symbols for cache hit on same set)
    sorted_symbols = ",".join(sorted(symbol_list))
    cache_key = build_cache_key("vnibb", "priceboard", sorted_symbols, source)
    
    # Check cache first (1 minute TTL)
    try:
        cached = await redis_client.get_json(cache_key)
        if cached:
            data = [PriceBoardData(**item) for item in cached]
            return PriceBoardResponse(count=len(data), data=data)
    except Exception:
        pass  # Cache miss or error, continue to fetch
    
    try:
        data = await VnstockPriceBoardFetcher.fetch(symbols=symbol_list, source=source)
        
        # Store in cache with 1 minute TTL (60 seconds)
        if data:
            try:
                await redis_client.set_json(
                    cache_key,
                    [d.model_dump(mode="json") for d in data],
                    ttl=60
                )
            except Exception:
                pass  # Cache write failure is non-fatal
        
        return PriceBoardResponse(count=len(data), data=data)
    except ProviderError as e:
        raise HTTPException(status_code=502, detail=f"Provider error: {e.message}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get(
    "/top-movers",
    response_model=TopMoversResponse,
    summary="Get Market Top Movers",
    description="Get top gainers/losers/volume/value stocks for a market index.",
)
async def get_top_movers(
    type: str = Query(
        default="gainer",
        pattern=r"^(gainer|loser|volume|value)$",
        description="Type of top movers: gainer, loser, volume, or value",
    ),
    index: str = Query(
        default="VNINDEX",
        pattern=r"^(VNINDEX|HNX|VN30)$",
        description="Market index to filter by",
    ),
    limit: int = Query(default=10, ge=1, le=50),
) -> TopMoversResponse:
    """Fetch top movers by type and index. Cached for 1 minute."""
    import logging
    logger = logging.getLogger(__name__)
    
    cache_key = build_cache_key("vnibb", "topmovers", type, index, str(limit))
    
    # Check cache first (1 minute TTL)
    try:
        cached = await redis_client.get_json(cache_key)
        if cached:
            data = [TopMoverData(**item) for item in cached]
            logger.info(f"Top movers cache hit: {len(data)} items for {type}/{index}")
            return TopMoversResponse(count=len(data), type=type, index=index, data=data)
    except Exception as e:
        logger.debug(f"Cache miss or error for top movers: {e}")
    
    try:
        logger.info(f"Fetching top movers: type={type}, index={index}, limit={limit}")
        data = await VnstockTopMoversFetcher.fetch(
            type=type,  # type: ignore
            index=index,  # type: ignore
            limit=limit,
        )
        
        logger.info(f"Top movers fetch returned {len(data)} items")
        
        # Store in cache with 1 minute TTL
        if data:
            try:
                await redis_client.set_json(
                    cache_key,
                    [d.model_dump(mode="json") for d in data],
                    ttl=60
                )
            except Exception as e:
                logger.debug(f"Cache write failed: {e}")
        
        return TopMoversResponse(count=len(data), type=type, index=index, data=data)
    except ProviderError as e:
        logger.error(f"Provider error fetching top movers: {e}")
        return TopMoversResponse(count=0, type=type, index=index, data=[])
    except Exception as e:
        logger.error(f"Unexpected error fetching top movers: {e}", exc_info=True)
        return TopMoversResponse(count=0, type=type, index=index, data=[])


@router.get(
    "/sector-top-movers",
    response_model=SectorTopMoversResponse,
    summary="Get Sector Top Movers",
    description="Get top movers grouped by sector/industry.",
)
async def get_sector_top_movers(
    type: str = Query(
        default="gainers",
        pattern=r"^(gainers|losers)$",
        description="Type: gainers or losers",
    ),
    limit: int = Query(
        default=5,
        ge=1,
        le=10,
        description="Max stocks per sector",
    ),
    source: str = Query(
        default="KBS",
        pattern=r"^(KBS|VCI|DNSE)$",
        description="Data source: KBS (default), VCI, or DNSE",
    ),

) -> SectorTopMoversResponse:
    """Fetch top movers grouped by sector. Cached for 1 minute."""
    cache_key = build_cache_key("vnibb", "sectortopmovers", type, str(limit), source)
    
    # Check cache first
    try:
        cached = await redis_client.get_json(cache_key)
        if cached:
            data = [SectorTopMoversData(**item) for item in cached]
            return SectorTopMoversResponse(count=len(data), type=type, data=data)
    except Exception:
        pass
    
    try:
        data = await VnstockTopMoversFetcher.fetch_sector_top_movers(
            type=type,  # type: ignore
            limit_per_sector=limit,
            source=source,
        )
        
        # Store in cache
        if data:
            try:
                await redis_client.set_json(
                    cache_key,
                    [d.model_dump(mode="json") for d in data],
                    ttl=60
                )
            except Exception:
                pass
        
        return SectorTopMoversResponse(count=len(data), type=type, data=data)
    except ProviderError as e:
        # Return empty response instead of error
        return SectorTopMoversResponse(count=0, type=type, data=[])
    except Exception as e:
        # Log error but return empty response
        return SectorTopMoversResponse(count=0, type=type, data=[])


@router.get(
    "/top-gainers",
    response_model=TopMoversResponse,
    summary="Get Top Gainers",
    description="Get top gaining stocks by price change percentage.",
)
async def get_top_gainers(
    index: Literal["VNINDEX", "HNX", "VN30"] = Query(default="VNINDEX"),
    limit: int = Query(default=10, ge=1, le=50),
) -> TopMoversResponse:
    """Fetch top gaining stocks."""
    try:
        data = await VnstockTopMoversFetcher.fetch(type="gainer", index=index, limit=limit)
        return TopMoversResponse(type="gainer", index=index, count=len(data), data=data)
    except Exception:
        return TopMoversResponse(type="gainer", index=index, count=0, data=[])


@router.get(
    "/top-losers",
    response_model=TopMoversResponse,
    summary="Get Top Losers",
    description="Get top losing stocks by price change percentage.",
)
async def get_top_losers(
    index: Literal["VNINDEX", "HNX", "VN30"] = Query(default="VNINDEX"),
    limit: int = Query(default=10, ge=1, le=50),
) -> TopMoversResponse:
    """Fetch top losing stocks."""
    try:
        data = await VnstockTopMoversFetcher.fetch(type="loser", index=index, limit=limit)
        return TopMoversResponse(type="loser", index=index, count=len(data), data=data)
    except Exception:
        return TopMoversResponse(type="loser", index=index, count=0, data=[])


@router.get(
    "/top-volume",
    response_model=TopMoversResponse,
    summary="Get Top by Volume",
    description="Get top stocks by trading volume.",
)
async def get_top_volume(
    index: Literal["VNINDEX", "HNX", "VN30"] = Query(default="VNINDEX"),
    limit: int = Query(default=10, ge=1, le=50),
) -> TopMoversResponse:
    """Fetch top stocks by volume."""
    try:
        data = await VnstockTopMoversFetcher.fetch(type="volume", index=index, limit=limit)
        return TopMoversResponse(type="volume", index=index, count=len(data), data=data)
    except Exception:
        return TopMoversResponse(type="volume", index=index, count=0, data=[])


@router.get(
    "/top-value",
    response_model=TopMoversResponse,
    summary="Get Top by Value",
    description="Get top stocks by trading value.",
)
async def get_top_value(
    index: Literal["VNINDEX", "HNX", "VN30"] = Query(default="VNINDEX"),
    limit: int = Query(default=10, ge=1, le=50),
) -> TopMoversResponse:
    """Fetch top stocks by value."""
    try:
        data = await VnstockTopMoversFetcher.fetch(type="value", index=index, limit=limit)
        return TopMoversResponse(type="value", index=index, count=len(data), data=data)
    except Exception:
        return TopMoversResponse(type="value", index=index, count=0, data=[])


# =============================================================================
# SECTOR PERFORMANCE ENDPOINT
# =============================================================================

from vnibb.services.sector_service import SectorService, SectorPerformance
from vnibb.providers.vnstock.equity_screener import VnstockScreenerFetcher


class SectorPerformanceResponse(BaseModel):
    """Response for sector performance endpoint."""
    count: int
    data: List[SectorPerformance]


@router.get(
    "/sector-performance",
    response_model=SectorPerformanceResponse,
    summary="Get All Sector Performance",
    description="Get performance data for all Vietnamese market sectors with top movers.",
)
async def get_all_sector_performance(
    source: str = Query(
        default="KBS",
        pattern=r"^(KBS|VCI|DNSE)$",
        description="Data source: KBS (default), VCI, or DNSE",
    ),

) -> SectorPerformanceResponse:
    """
    Get performance data for all VN market sectors.
    
    Returns sector change percentages, top gainers/losers, 
    and total stock counts for each sector.
    """
    cache_key = build_cache_key("vnibb", "sectorperformance", source)
    
    # Check cache first (1 minute TTL)
    try:
        cached = await redis_client.get_json(cache_key)
        if cached:
            data = [SectorPerformance(**item) for item in cached]
            return SectorPerformanceResponse(count=len(data), data=data)
    except Exception:
        pass
    
    try:
        # Fetch all screener data
        screener_result = await VnstockScreenerFetcher.fetch(limit=2000, source=source)
        screener_data = [s.model_dump() for s in screener_result] if screener_result else []
        
        # Calculate sector performance
        sector_data = await SectorService.calculate_sector_performance(screener_data)
        
        # Cache result
        if sector_data:
            try:
                await redis_client.set_json(
                    cache_key,
                    [d.model_dump(mode="json", by_alias=True) for d in sector_data],
                    ttl=60
                )
            except Exception:
                pass
        
        return SectorPerformanceResponse(count=len(sector_data), data=sector_data)
    except Exception as e:
        # Return empty on error
        return SectorPerformanceResponse(count=0, data=[])
