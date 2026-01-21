"""
Data Sync API Endpoints

Manual triggers for data pipeline jobs.
Useful for testing and on-demand data updates.
Includes health check and seeding endpoints.
"""

import logging
from datetime import date, timedelta
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Query, BackgroundTasks, WebSocket, WebSocketDisconnect
from typing import Optional, List
from pydantic import BaseModel

from vnibb.services.websocket_service import manager


router = APIRouter()
logger = logging.getLogger(__name__)


@router.websocket("/ws/status")
async def sync_status_websocket(websocket: WebSocket):
    """WebSocket endpoint for real-time sync status updates."""
    await manager.connect(websocket)
    
    try:
        while True:
            # Keep connection alive and listen for optional client messages
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)


async def broadcast_sync_status(status: dict):
    """Broadcast sync status to all connected clients."""
    await manager.broadcast_sync_status(status)


class SyncResponse(BaseModel):

    """Response for sync operations."""
    status: str
    message: str
    count: Optional[int] = None


class SyncJobRequest(BaseModel):
    """Request for running sync jobs."""
    job_type: str  # stock_list, prices, news, dividends, foreign_trading
    symbols: Optional[list[str]] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None


# =============================================================================
# HEALTH CHECK ENDPOINTS
# =============================================================================

class DatabaseHealthResponse(BaseModel):
    """Response for database health check."""
    status: str  # healthy, degraded, needs_seed
    timestamp: str
    database: dict
    sync: dict
    warnings: List[str]
    recommendations: List[str]


class SyncHistoryItem(BaseModel):
    """Single sync history entry."""
    id: int
    sync_type: str
    status: str
    started_at: Optional[str]
    completed_at: Optional[str]
    duration_seconds: Optional[float]
    success_count: int
    error_count: int


@router.get(
    "/health",
    response_model=DatabaseHealthResponse,
    summary="Database Health Check",
    description="Get comprehensive database health status including stock counts, sync status, and warnings.",
)
async def database_health() -> DatabaseHealthResponse:
    """
    Check database health and data status.
    
    Returns:
    - status: 'healthy', 'degraded', or 'needs_seed'
    - database: Stock counts, price records, screener records
    - sync: Last sync information
    - warnings: List of issues detected
    - recommendations: Suggested actions
    """
    from vnibb.services.health_service import get_health_service
    
    try:
        health = await get_health_service().get_database_health()
        return DatabaseHealthResponse(**health)
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get(
    "/sync/history",
    response_model=List[SyncHistoryItem],
    summary="Get Sync History",
    description="Get recent sync operation history.",
)
async def get_sync_history(
    limit: int = Query(default=10, ge=1, le=100),
    sync_type: Optional[str] = Query(default=None, description="Filter by sync type"),
) -> List[SyncHistoryItem]:
    """Get recent sync history."""
    from vnibb.services.health_service import get_health_service
    
    try:
        history = await get_health_service().get_sync_history(limit=limit, sync_type=sync_type)
        return [SyncHistoryItem(**h) for h in history]
    except Exception as e:
        logger.error(f"Failed to get sync history: {e}")
        raise HTTPException(status_code=500, detail=str(e))



# =============================================================================
# SEED ENDPOINTS
# =============================================================================

class SeedResponse(BaseModel):
    """Response for seed operations."""
    status: str
    message: str
    stocks_synced: int
    errors: int
    exchanges: dict


@router.post(
    "/seed/stocks",
    response_model=SeedResponse,
    summary="Seed Stock Symbols",
    description="Populate database with all stock symbols from HOSE/HNX/UPCOM.",
)
async def seed_stocks(
    background_tasks: BackgroundTasks,
    async_mode: bool = Query(default=False, description="Run in background"),
) -> SeedResponse:
    """
    Seed all stock symbols from vnstock.
    
    This is the primary way to initialize an empty database.
    Fetches all symbols from HOSE, HNX, and UPCOM exchanges.
    """
    from vnibb.cli.seed import seed_stock_symbols
    
    if async_mode:
        background_tasks.add_task(seed_stock_symbols)
        return SeedResponse(
            status="started",
            message="Stock seeding started in background",
            stocks_synced=0,
            errors=0,
            exchanges={},
        )
    
    try:
        results = await seed_stock_symbols()
        return SeedResponse(
            status="success" if results["error_count"] == 0 else "partial",
            message=f"Seeded {results['success_count']} stocks",
            stocks_synced=results["success_count"],
            errors=results["error_count"],
            exchanges=results["exchanges"],
        )
    except Exception as e:
        logger.error(f"Stock seeding failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/seed/full",
    response_model=SyncResponse,
    summary="Full Database Seed",
    description="Run complete database seeding including stocks, industries, and optionally prices.",
)
async def seed_full(
    background_tasks: BackgroundTasks,
    include_prices: bool = Query(default=False, description="Also seed price data"),
    price_days: int = Query(default=30, ge=1, le=365, description="Days of price history"),
) -> SyncResponse:
    """
    Run complete database seeding.
    
    Includes:
    - All stock symbols
    - ICB industry mappings
    - Optionally: Historical price data
    """
    from vnibb.cli.seed import run_full_seed
    
    async def _run_seed():
        await run_full_seed(include_prices=include_prices, price_days=price_days)
    
    background_tasks.add_task(_run_seed)
    
    return SyncResponse(
        status="started",
        message=f"Full seed started in background (prices: {include_prices})",
    )


@router.post(
    "/sync/stocks",
    response_model=SyncResponse,
    summary="Sync Stock List",
    description="Sync all stock symbols from vnstock listing.",
)
async def sync_stocks() -> SyncResponse:
    """Sync stock list from vnstock."""

    from vnibb.services.data_pipeline import data_pipeline
    try:
        count = await data_pipeline.sync_stock_list()
        return SyncResponse(
            status="success",
            message=f"Synced {count} stocks",
            count=count,
        )
    except Exception as e:
        logger.error(f"Stock sync failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/sync/profiles",
    response_model=SyncResponse,
    summary="Sync Company Profiles",
    description="Sync company profiles for all or specified stocks.",
)
async def sync_profiles(
    background_tasks: BackgroundTasks,
    symbols: Optional[list[str]] = Query(default=None, description="Specific symbols to sync"),
    async_mode: bool = Query(default=True, description="Run in background"),
) -> SyncResponse:
    """Sync company profiles to database."""
    from vnibb.services.data_pipeline import data_pipeline
    if async_mode:
        background_tasks.add_task(
            data_pipeline.sync_company_profiles,
            symbols=symbols,
        )
        return SyncResponse(
            status="started",
            message="Profile sync started in background",
        )
    
    try:
        count = await data_pipeline.sync_company_profiles(symbols=symbols)
        return SyncResponse(
            status="success",
            message=f"Synced {count} company profiles",
            count=count,
        )
    except Exception as e:
        logger.error(f"Profile sync failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/sync/screener",
    response_model=SyncResponse,
    summary="Sync Screener Data",
    description="Sync screener data (market cap, ratios, etc) for all stocks.",
)
async def sync_screener(
    background_tasks: BackgroundTasks,
    async_mode: bool = Query(default=True, description="Run in background"),
) -> SyncResponse:
    """Sync screener data."""
    from vnibb.services.data_pipeline import data_pipeline
    
    if async_mode:
        background_tasks.add_task(
            data_pipeline.sync_screener_data
        )
        return SyncResponse(
            status="started",
            message="Screener sync started in background",
        )
    
    try:
        count = await data_pipeline.sync_screener_data()
        return SyncResponse(
            status="success",
            message=f"Synced {count} screener records",
            count=count,
        )
    except Exception as e:
        logger.error(f"Screener sync failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/sync/prices",
    response_model=SyncResponse,
    summary="Sync Daily Prices",
    description="Sync daily OHLCV prices for stocks.",
)
async def sync_prices(
    background_tasks: BackgroundTasks,
    symbols: Optional[list[str]] = Query(default=None),
    start_date: Optional[date] = Query(default=None),
    end_date: Optional[date] = Query(default=None),
    async_mode: bool = Query(default=True, description="Run in background"),
) -> SyncResponse:
    """Sync daily prices for stocks."""
    from vnibb.services.data_pipeline import data_pipeline
    if async_mode:
        background_tasks.add_task(
            data_pipeline.sync_daily_prices,
            symbols=symbols,
            start_date=start_date,
            end_date=end_date,
        )
        return SyncResponse(
            status="started",
            message="Price sync started in background",
        )
    
    try:
        count = await data_pipeline.sync_daily_prices(
            symbols=symbols,
            start_date=start_date,
            end_date=end_date,
        )
        return SyncResponse(
            status="success",
            message=f"Synced {count} price records",
            count=count,
        )
    except Exception as e:
        logger.error(f"Price sync failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/sync/news",
    response_model=SyncResponse,
    summary="Sync Company News",
    description="Sync news articles for stocks.",
)
async def sync_news(
    background_tasks: BackgroundTasks,
    symbols: Optional[list[str]] = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    async_mode: bool = Query(default=True),
) -> SyncResponse:
    """Sync company news."""
    from vnibb.services.data_pipeline import data_pipeline
    if async_mode:
        background_tasks.add_task(
            data_pipeline.sync_company_news,
            symbols=symbols,
            limit=limit,
        )
        return SyncResponse(
            status="started",
            message="News sync started in background",
        )
    
    try:
        count = await data_pipeline.sync_company_news(symbols=symbols, limit=limit)
        return SyncResponse(
            status="success",
            message=f"Synced {count} news articles",
            count=count,
        )
    except Exception as e:
        logger.error(f"News sync failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/sync/dividends",
    response_model=SyncResponse,
    summary="Sync Dividends",
    description="Sync dividend history for stocks.",
)
async def sync_dividends(
    background_tasks: BackgroundTasks,
    symbols: Optional[list[str]] = Query(default=None),
    async_mode: bool = Query(default=True),
) -> SyncResponse:
    """Sync dividend data."""
    from vnibb.services.data_pipeline import data_pipeline
    if async_mode:
        background_tasks.add_task(
            data_pipeline.sync_dividends,
            symbols=symbols,
        )
        return SyncResponse(
            status="started",
            message="Dividend sync started in background",
        )
    
    try:
        count = await data_pipeline.sync_dividends(symbols=symbols)
        return SyncResponse(
            status="success",
            message=f"Synced {count} dividend records",
            count=count,
        )
    except Exception as e:
        logger.error(f"Dividend sync failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/sync/foreign-trading",
    response_model=SyncResponse,
    summary="Sync Foreign Trading",
    description="Sync foreign investor trading data.",
)
async def sync_foreign_trading(
    trade_date: Optional[date] = Query(default=None),
) -> SyncResponse:
    """Sync foreign trading data."""
    from vnibb.services.data_pipeline import data_pipeline
    try:
        count = await data_pipeline.sync_foreign_trading(trade_date=trade_date)
        return SyncResponse(
            status="success",
            message=f"Synced {count} foreign trading records",
            count=count,
        )
    except Exception as e:
        logger.error(f"Foreign trading sync failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/sync/financials",
    response_model=SyncResponse,
    summary="Sync Financial Statements",
    description="Sync financial statements (income, balance, cashflow) for stocks.",
)
async def sync_financials(
    background_tasks: BackgroundTasks,
    symbols: Optional[list[str]] = Query(default=None, description="Specific symbols to sync"),
    period: str = Query(
        default="year",
        pattern="^(year|quarter)$",
        description="Reporting period: year or quarter",
    ),
    async_mode: bool = Query(default=True, description="Run in background"),
) -> SyncResponse:
    """Sync financial statements to database."""
    from vnibb.services.data_pipeline import data_pipeline
    if async_mode:
        background_tasks.add_task(
            data_pipeline.sync_financial_statements,
            symbols=symbols,
            period=period,
        )
        return SyncResponse(
            status="started",
            message="Financial statements sync started in background",
        )
    
    try:
        counts = await data_pipeline.sync_financial_statements(
            symbols=symbols,
            period=period,
        )
        total = sum(counts.values()) if isinstance(counts, dict) else counts
        return SyncResponse(
            status="success",
            message=f"Synced financial statements: {counts}",
            count=total,
        )
    except Exception as e:
        logger.error(f"Financial statements sync failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/sync/metrics",
    response_model=SyncResponse,
    summary="Sync Financial Ratios (Metrics)",
    description="Specifically sync financial ratios for sparklines.",
)
async def sync_metrics(
    background_tasks: BackgroundTasks,
    symbols: Optional[list[str]] = Query(default=None),
    period: str = Query(default="quarter", pattern="^(year|quarter)$"),
    async_mode: bool = Query(default=True),
) -> SyncResponse:
    """Sync financial ratios to database."""
    from vnibb.services.data_pipeline import data_pipeline
    
    async def _run_sync():
        await data_pipeline.sync_financial_statements(symbols=symbols, period=period)
        
    if async_mode:
        background_tasks.add_task(_run_sync)
        return SyncResponse(status="started", message="Metrics sync started in background")
    
    try:
        counts = await data_pipeline.sync_financial_statements(symbols=symbols, period=period)
        return SyncResponse(status="success", message=f"Synced metrics: {counts}", count=counts.get('ratios', 0))
    except Exception as e:
        logger.error(f"Metrics sync failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))



@router.post(
    "/sync/all",
    response_model=SyncResponse,
    summary="Run Full Sync",
    description="Run all sync jobs (stocks, prices, news, dividends).",
)
async def sync_all(
    background_tasks: BackgroundTasks,
) -> SyncResponse:
    """Run full data sync in background."""
    from vnibb.services.data_pipeline import run_daily_sync
    
    background_tasks.add_task(run_daily_sync)
    return SyncResponse(
        status="started",
        message="Full sync started in background",
    )


# =============================================================================
# FULL MARKET SYNC (NEW)
# =============================================================================

class FullSyncResultsResponse(BaseModel):
    """Response for full market sync."""
    success: bool
    results: dict
    total_synced: int
    total_errors: int
    total_duration: float


@router.post(
    "/sync/full-market",
    response_model=FullSyncResultsResponse,
    summary="Run Full Market Sync",
    description="Run comprehensive market data sync using vnstock with batch processing.",
)
async def sync_full_market(
    background_tasks: BackgroundTasks,
    max_symbols: Optional[int] = Query(
        default=None,
        description="Optional limit on symbols to sync (for testing)"
    ),
    include_historical: bool = Query(
        default=False,
        description="Whether to sync historical price data"
    ),
    async_mode: bool = Query(
        default=True,
        description="Run sync in background"
    ),
) -> FullSyncResultsResponse:
    """
    Run comprehensive market data sync.
    
    Syncs:
    - All stock symbols
    - Current prices from screener
    - Company profiles (batched)
    - Optional: Historical data
    """
    from vnibb.services.sync_all_data import FullMarketSync
    
    if async_mode:
        async def _run_sync():
            sync = FullMarketSync()
            await sync.run_full_sync(
                include_historical=include_historical,
                max_symbols=max_symbols
            )
        
        background_tasks.add_task(_run_sync)
        return FullSyncResultsResponse(
            success=True,
            results={"status": "started"},
            total_synced=0,
            total_errors=0,
            total_duration=0
        )
    
    try:
        sync = FullMarketSync()
        results = await sync.run_full_sync(
            include_historical=include_historical,
            max_symbols=max_symbols
        )
        
        # Convert SyncResult objects to dict
        results_dict = {
            k: {
                "synced_count": v.synced_count,
                "error_count": v.error_count,
                "duration_seconds": v.duration_seconds,
                "success": v.success
            }
            for k, v in results.items()
        }
        
        total_synced = sum(v.synced_count for v in results.values())
        total_errors = sum(v.error_count for v in results.values())
        total_duration = sum(v.duration_seconds for v in results.values())
        
        return FullSyncResultsResponse(
            success=all(v.success for v in results.values()),
            results=results_dict,
            total_synced=total_synced,
            total_errors=total_errors,
            total_duration=total_duration
        )
    except Exception as e:
        logger.error(f"Full market sync failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get(
    "/sync/status",
    summary="Get Sync Job Status",
    description="Get status of all scheduled sync jobs.",
)
async def get_sync_status():
    """Get scheduler job status."""
    from vnibb.core.scheduler import get_job_status
    return get_job_status()
