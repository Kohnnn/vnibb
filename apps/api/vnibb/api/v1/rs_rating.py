"""
RS Rating API Router

Endpoints for Relative Strength rating data:
- Get RS rating for a single stock
- Get RS leaders (top performers)
- Get RS laggards (bottom performers)
- Get RS gainers (biggest improvements)
- Trigger manual RS calculation
"""

import logging
from datetime import date
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Query, BackgroundTasks
from pydantic import BaseModel, Field

from vnibb.services.rs_rating_service import RSRatingService

logger = logging.getLogger(__name__)

router = APIRouter(tags=["RS Rating"])


# Response Models
class RSRatingResponse(BaseModel):
    """Single stock RS rating response."""
    symbol: str
    rs_rating: int = Field(..., ge=1, le=99, description="RS Rating (1-99)")
    rs_rank: Optional[int] = Field(None, description="Rank among all stocks")
    snapshot_date: str = Field(..., description="Date of calculation")


class RSStockItem(BaseModel):
    """Stock item in RS rankings."""
    symbol: str
    company_name: Optional[str] = None
    rs_rating: int = Field(..., ge=1, le=99)
    rs_rank: Optional[int] = None
    price: Optional[float] = None
    industry: Optional[str] = None


class RSGainerItem(RSStockItem):
    """Stock item with RS rating change."""
    rs_rating_prev: int = Field(..., ge=1, le=99, description="Previous RS rating")
    rs_rating_change: int = Field(..., description="Change in RS rating")


class RSLeadersResponse(BaseModel):
    """RS leaders response."""
    leaders: List[RSStockItem]
    total: int
    sector: Optional[str] = None


class RSLaggardsResponse(BaseModel):
    """RS laggards response."""
    laggards: List[RSStockItem]
    total: int
    sector: Optional[str] = None


class RSGainersResponse(BaseModel):
    """RS gainers response."""
    gainers: List[RSGainerItem]
    total: int
    lookback_days: int


class RSCalculationResponse(BaseModel):
    """RS calculation job response."""
    success: bool
    message: str
    calculation_date: Optional[str] = None
    total_stocks: Optional[int] = None
    failed_stocks: Optional[int] = None
    statistics: Optional[dict] = None


# Endpoints
@router.get("/{symbol}", response_model=RSRatingResponse)
async def get_rs_rating(symbol: str):
    """
    Get current RS rating for a single stock.
    
    Args:
        symbol: Stock symbol (e.g., "VNM", "HPG")
        
    Returns:
        RS rating data including rating, rank, and calculation date
    """
    service = RSRatingService()
    
    try:
        result = await service.get_rs_rating(symbol.upper())
        
        if not result:
            raise HTTPException(
                status_code=404,
                detail=f"RS rating not found for {symbol}. May not have been calculated yet."
            )
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get RS rating for {symbol}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/leaders", response_model=RSLeadersResponse)
async def get_rs_leaders(
    limit: int = Query(50, ge=1, le=200, description="Number of leaders to return"),
    sector: Optional[str] = Query(None, description="Filter by sector")
):
    """
    Get top RS rated stocks (leaders).
    
    Returns stocks with highest RS ratings, optionally filtered by sector.
    
    Args:
        limit: Number of stocks to return (max 200)
        sector: Optional sector filter
        
    Returns:
        List of top RS stocks
    """
    service = RSRatingService()
    
    try:
        leaders = await service.get_rs_leaders(limit=limit, sector=sector)
        
        return {
            "leaders": leaders,
            "total": len(leaders),
            "sector": sector,
        }
        
    except Exception as e:
        logger.error(f"Failed to get RS leaders: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/laggards", response_model=RSLaggardsResponse)
async def get_rs_laggards(
    limit: int = Query(50, ge=1, le=200, description="Number of laggards to return"),
    sector: Optional[str] = Query(None, description="Filter by sector")
):
    """
    Get bottom RS rated stocks (laggards).
    
    Returns stocks with lowest RS ratings, optionally filtered by sector.
    
    Args:
        limit: Number of stocks to return (max 200)
        sector: Optional sector filter
        
    Returns:
        List of bottom RS stocks
    """
    service = RSRatingService()
    
    try:
        laggards = await service.get_rs_laggards(limit=limit, sector=sector)
        
        return {
            "laggards": laggards,
            "total": len(laggards),
            "sector": sector,
        }
        
    except Exception as e:
        logger.error(f"Failed to get RS laggards: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/gainers", response_model=RSGainersResponse)
async def get_rs_gainers(
    limit: int = Query(50, ge=1, le=200, description="Number of gainers to return"),
    lookback_days: int = Query(7, ge=1, le=30, description="Days to look back for comparison")
):
    """
    Get stocks with biggest RS rating improvement.
    
    Returns stocks that have improved their RS rating the most over the lookback period.
    
    Args:
        limit: Number of stocks to return (max 200)
        lookback_days: Days to look back for comparison (max 30)
        
    Returns:
        List of stocks with biggest RS gains
    """
    service = RSRatingService()
    
    try:
        gainers = await service.get_rs_gainers(limit=limit, lookback_days=lookback_days)
        
        return {
            "gainers": gainers,
            "total": len(gainers),
            "lookback_days": lookback_days,
        }
        
    except Exception as e:
        logger.error(f"Failed to get RS gainers: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{symbol}/history", response_model=List[dict])
async def get_rs_history(
    symbol: str,
    limit: int = Query(100, ge=1, le=500, description="Number of historical points to return")
):
    """
    Get historical RS ratings for a stock.
    
    Args:
        symbol: Stock symbol
        limit: Number of history points
        
    Returns:
        List of {time, value} points
    """
    service = RSRatingService()
    
    try:
        return await service.get_rs_rating_history(symbol.upper(), limit=limit)
    except Exception as e:
        logger.error(f"Failed to get RS history for {symbol}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/calculate", response_model=RSCalculationResponse)
async def trigger_rs_calculation(
    background_tasks: BackgroundTasks,
    calculation_date: Optional[str] = Query(None, description="Date to calculate for (YYYY-MM-DD)")
):
    """
    Trigger manual RS rating calculation.
    
    This endpoint triggers a background job to calculate RS ratings for all stocks.
    Normally this runs automatically via scheduler, but can be triggered manually.
    
    Args:
        calculation_date: Optional date to calculate for (defaults to today)
        
    Returns:
        Calculation status and results
    """
    service = RSRatingService()
    
    try:
        # Parse date if provided
        calc_date = None
        if calculation_date:
            try:
                calc_date = date.fromisoformat(calculation_date)
            except ValueError:
                raise HTTPException(
                    status_code=400,
                    detail="Invalid date format. Use YYYY-MM-DD"
                )
        
        # Run calculation (this may take a while)
        logger.info(f"Starting manual RS calculation for {calc_date or 'today'}")
        result = await service.calculate_all_rs_ratings(calculation_date=calc_date)
        
        if result.get("success"):
            return {
                "success": True,
                "message": "RS rating calculation completed successfully",
                **result
            }
        else:
            return {
                "success": False,
                "message": f"RS rating calculation failed: {result.get('error', 'Unknown error')}",
            }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to trigger RS calculation: {e}")
        raise HTTPException(status_code=500, detail=str(e))
