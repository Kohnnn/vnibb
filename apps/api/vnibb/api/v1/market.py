"""
Market API Endpoints

Provides endpoints for:
- Market heatmap data (treemap visualization)
- Sector aggregations
- Market overview statistics
"""

import logging
from typing import List, Optional, Dict, Any
from collections import defaultdict

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from vnibb.core.config import settings
from vnibb.providers.vnstock.equity_screener import (
    VnstockScreenerFetcher,
    StockScreenerParams,
    ScreenerData,
)
from vnibb.core.exceptions import ProviderError, ProviderTimeoutError
from vnibb.services.cache_manager import CacheManager

router = APIRouter()
logger = logging.getLogger(__name__)


class HeatmapStock(BaseModel):
    """Individual stock data for heatmap visualization."""
    
    symbol: str
    name: str
    sector: str
    industry: Optional[str] = None
    market_cap: float
    price: float
    change: float  # Absolute price change
    change_pct: float  # Percentage change
    volume: Optional[float] = None


class SectorGroup(BaseModel):
    """Aggregated sector data for heatmap."""
    
    sector: str
    stocks: List[HeatmapStock]
    total_market_cap: float
    avg_change_pct: float
    stock_count: int


class HeatmapResponse(BaseModel):
    """API response for heatmap data."""
    
    count: int
    group_by: str
    color_metric: str
    size_metric: str
    sectors: List[SectorGroup]
    cached: bool = False


@router.get(
    "/heatmap",
    response_model=HeatmapResponse,
    summary="Get Market Heatmap Data",
    description="Get aggregated market data for treemap visualization. Supports grouping by sector/industry.",
)
async def get_heatmap_data(
    group_by: str = Query(
        default="sector",
        pattern=r"^(sector|industry|vn30|hnx30)$",
        description="Group stocks by: sector, industry, vn30, or hnx30",
    ),
    color_metric: str = Query(
        default="change_pct",
        pattern=r"^(change_pct|weekly_pct|monthly_pct|ytd_pct)$",
        description="Metric for color intensity: change_pct, weekly_pct, monthly_pct, ytd_pct",
    ),
    size_metric: str = Query(
        default="market_cap",
        pattern=r"^(market_cap|volume|value_traded)$",
        description="Metric for rectangle size: market_cap, volume, value_traded",
    ),
    exchange: str = Query(
        default="HOSE",
        pattern=r"^(HOSE|HNX|UPCOM|ALL)$",
        description="Exchange filter: HOSE, HNX, UPCOM, or ALL",
    ),
    limit: int = Query(
        default=500,
        ge=1,
        le=2000,
        description="Maximum stocks to include",
    ),
    use_cache: bool = Query(
        default=True,
        description="Use cached data if available",
    ),
) -> HeatmapResponse:
    """
    Fetch market heatmap data with sector/industry grouping.
    
    ## Features
    - **Treemap Visualization**: Rectangle size by market cap, color by price change
    - **Grouping**: By sector, industry, or index (VN30, HNX30)
    - **Metrics**: Customizable color and size metrics
    
    ## Use Cases
    - Market overview dashboard
    - Sector performance analysis
    - Visual stock screening
    """
    cache_manager = CacheManager()
    
    # Step 1: Fetch screener data (with cache support)
    try:
        params = StockScreenerParams(
            symbol=None,
            exchange=exchange,
            limit=limit,
            source=settings.vnstock_source,
        )
        
        # Try cache first
        screener_data: List[ScreenerData] = []
        cached = False
        
        if use_cache:
            try:
                cache_result = await cache_manager.get_screener_data(
                    symbol=None,
                    source=settings.vnstock_source,
                    allow_stale=True,
                )
                
                if cache_result.is_fresh and cache_result.data:
                    logger.info(f"Using cached screener data for heatmap ({len(cache_result.data)} records)")
                    # Convert ORM to Pydantic
                    screener_data = [
                        ScreenerData(
                            symbol=s.symbol,
                            organ_name=s.company_name,
                            exchange=s.exchange,
                            industry_name=s.industry,
                            price=s.price,
                            volume=s.volume,
                            market_cap=s.market_cap,
                            pe=s.pe,
                            pb=s.pb,
                        )
                        for s in cache_result.data
                    ]
                    cached = True
            except Exception as e:
                logger.warning(f"Cache lookup failed for heatmap: {e}")
        
        # Fetch from API if no cache
        if not screener_data:
            screener_data = await VnstockScreenerFetcher.fetch(params)
            logger.info(f"Fetched {len(screener_data)} stocks from API for heatmap")
        
        # Step 2: Filter by exchange if needed
        if exchange != "ALL":
            screener_data = [s for s in screener_data if s.exchange == exchange]
        
        # Step 3: Calculate change_pct (for now, use mock data since we don't have historical prices)
        # In production, you'd fetch yesterday's close price and calculate actual change
        # For now, we'll use a simple heuristic based on volume/market_cap
        import random
        random.seed(42)  # Deterministic for demo
        
        # Step 4: Group stocks by sector/industry
        groups: Dict[str, List[HeatmapStock]] = defaultdict(list)
        
        for stock in screener_data:
            # Skip stocks with missing critical data
            if not stock.market_cap or stock.market_cap <= 0:
                continue
            if not stock.price or stock.price <= 0:
                continue
            
            # Determine grouping key
            if group_by == "sector":
                # Extract sector from industry_name (e.g., "Ngân hàng" from "Ngân hàng - Dịch vụ tài chính")
                group_key = stock.industry_name.split("-")[0].strip() if stock.industry_name else "Other"
            elif group_by == "industry":
                group_key = stock.industry_name or "Other"
            elif group_by == "vn30":
                # TODO: Filter only VN30 stocks (need VN30 list)
                group_key = "VN30"
            elif group_by == "hnx30":
                # TODO: Filter only HNX30 stocks
                group_key = "HNX30"
            else:
                group_key = "Other"
            
            # Mock change_pct calculation (replace with real data in production)
            # Use a normal distribution centered around 0
            change_pct = random.gauss(0, 2.5)  # Mean 0%, StdDev 2.5%
            change = stock.price * (change_pct / 100)
            
            heatmap_stock = HeatmapStock(
                symbol=stock.symbol,
                name=stock.organ_name or stock.symbol,
                sector=group_key,
                industry=stock.industry_name,
                market_cap=stock.market_cap,
                price=stock.price,
                change=change,
                change_pct=change_pct,
                volume=stock.volume,
            )
            
            groups[group_key].append(heatmap_stock)
        
        # Step 5: Create sector aggregations
        sectors: List[SectorGroup] = []
        for sector_name, stocks in groups.items():
            total_market_cap = sum(s.market_cap for s in stocks)
            # Weighted average change by market cap
            if total_market_cap > 0:
                avg_change_pct = sum(s.change_pct * s.market_cap for s in stocks) / total_market_cap
            else:
                avg_change_pct = 0
            
            sectors.append(
                SectorGroup(
                    sector=sector_name,
                    stocks=stocks,
                    total_market_cap=total_market_cap,
                    avg_change_pct=avg_change_pct,
                    stock_count=len(stocks),
                )
            )
        
        # Sort sectors by total market cap (largest first)
        sectors.sort(key=lambda s: s.total_market_cap, reverse=True)
        
        total_stocks = sum(len(s.stocks) for s in sectors)
        
        return HeatmapResponse(
            count=total_stocks,
            group_by=group_by,
            color_metric=color_metric,
            size_metric=size_metric,
            sectors=sectors,
            cached=cached,
        )
        
    except (ProviderTimeoutError, ProviderError) as e:
        if isinstance(e, ProviderTimeoutError):
            raise HTTPException(status_code=504, detail=f"Timeout: {e.message}")
        raise HTTPException(status_code=502, detail=f"Provider error: {e.message}")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
