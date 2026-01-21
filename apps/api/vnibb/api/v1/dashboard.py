"""
Dashboard API Endpoints

Provides endpoints for:
- Dashboard CRUD operations
- Widget management
- Layout persistence
"""

from typing import List, Optional

from fastapi import APIRouter, HTTPException, Depends, status, Query

from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete

from vnibb.api.deps import DatabaseDep
from vnibb.models.dashboard import UserDashboard, DashboardWidget
from vnibb.providers.vnstock.market_overview import (
    MarketIndexData,
)
from vnibb.providers.vnstock.top_movers import TopMoverData
from vnibb.services.dashboard_service import dashboard_service

router = APIRouter()



# ============ Request/Response Models ============

class WidgetLayout(BaseModel):
    """Widget position and size for React-Grid-Layout."""
    x: int = Field(..., ge=0, description="Grid column position")
    y: int = Field(..., ge=0, description="Grid row position")
    w: int = Field(..., ge=1, description="Width in grid units")
    h: int = Field(..., ge=1, description="Height in grid units")
    minW: Optional[int] = Field(None, description="Minimum width")
    minH: Optional[int] = Field(None, description="Minimum height")


class WidgetConfig(BaseModel):
    """Widget-specific configuration."""
    symbol: Optional[str] = None
    timeframe: Optional[str] = None
    indicators: Optional[List[str]] = None
    refreshInterval: Optional[int] = None


class WidgetCreate(BaseModel):
    """Request body for creating a widget."""
    widget_id: str = Field(..., description="Unique widget ID within dashboard")
    widget_type: str = Field(..., description="Widget type (price_chart, screener, etc)")
    layout: WidgetLayout
    widget_config: Optional[WidgetConfig] = None


class WidgetResponse(BaseModel):
    """Widget response model."""
    id: int
    widget_id: str
    widget_type: str
    layout: dict
    widget_config: Optional[dict]


class DashboardCreate(BaseModel):
    """Request body for creating a dashboard."""
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    is_default: bool = False
    layout_config: Optional[dict] = None


class DashboardUpdate(BaseModel):
    """Request body for updating a dashboard."""
    name: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    is_default: Optional[bool] = None
    layout_config: Optional[dict] = None


class DashboardResponse(BaseModel):
    """Dashboard response model."""
    id: int
    user_id: str
    name: str
    description: Optional[str]
    is_default: bool
    layout_config: Optional[dict]
    widgets: List[WidgetResponse] = []

    class Config:
        from_attributes = True


class DashboardListResponse(BaseModel):
    """List of dashboards response."""
    count: int
    data: List[DashboardResponse]


class MarketOverviewResponse(BaseModel):
    """Market overview response model."""
    indices: List[MarketIndexData]
    timestamp: str


class TopMoversResponse(BaseModel):
    """Top movers response model."""
    type: str
    index: str
    data: List[TopMoverData]
    timestamp: str


# ============ Dashboard Endpoints ============


@router.get(
    "/",
    response_model=DashboardListResponse,
    summary="List Dashboards",
    description="Get all dashboards for the current user.",
)
async def list_dashboards(
    db: DatabaseDep,
    user_id: str = "anonymous",  # Placeholder for auth
) -> DashboardListResponse:
    """Get all dashboards for a user."""
    result = await db.execute(
        select(UserDashboard)
        .where(UserDashboard.user_id == user_id)
        .order_by(UserDashboard.is_default.desc(), UserDashboard.name)
    )
    dashboards = result.scalars().all()
    
    return DashboardListResponse(
        count=len(dashboards),
        data=[_to_response(d) for d in dashboards],
    )


@router.get(
    "/market-overview",
    response_model=MarketOverviewResponse,
    summary="Get Market Overview",
    description="Get current market indices and overview data.",
)
async def get_market_overview() -> MarketOverviewResponse:
    """Get market overview data."""
    from datetime import datetime
    
    indices = await dashboard_service.get_market_overview()
    return MarketOverviewResponse(
        indices=indices,
        timestamp=datetime.now().isoformat(),
    )


@router.get(
    "/top-gainers",
    response_model=TopMoversResponse,
    summary="Get Top Gainers",
)
async def get_top_gainers(
    index: str = Query("VNINDEX", pattern=r"^(VNINDEX|HNX|VN30)$"),
    limit: int = Query(10, ge=1, le=50),
) -> TopMoversResponse:
    """Get market top gainers."""
    from datetime import datetime
    data = await dashboard_service.get_top_movers("gainer", index, limit)
    return TopMoversResponse(
        type="gainer",
        index=index,
        data=data,
        timestamp=datetime.now().isoformat(),
    )


@router.get(
    "/top-losers",
    response_model=TopMoversResponse,
    summary="Get Top Losers",
)
async def get_top_losers(
    index: str = Query("VNINDEX", pattern=r"^(VNINDEX|HNX|VN30)$"),
    limit: int = Query(10, ge=1, le=50),
) -> TopMoversResponse:
    """Get market top losers."""
    from datetime import datetime
    data = await dashboard_service.get_top_movers("loser", index, limit)
    return TopMoversResponse(
        type="loser",
        index=index,
        data=data,
        timestamp=datetime.now().isoformat(),
    )


@router.get(
    "/most-active",
    response_model=TopMoversResponse,
    summary="Get Most Active",
)
async def get_most_active(
    index: str = Query("VNINDEX", pattern=r"^(VNINDEX|HNX|VN30)$"),
    limit: int = Query(10, ge=1, le=50),
) -> TopMoversResponse:
    """Get market most active stocks (by volume)."""
    from datetime import datetime
    data = await dashboard_service.get_top_movers("volume", index, limit)
    return TopMoversResponse(
        type="volume",
        index=index,
        data=data,
        timestamp=datetime.now().isoformat(),
    )


@router.get(
    "/{dashboard_id}",

    response_model=DashboardResponse,
    summary="Get Dashboard",
    description="Get a specific dashboard by ID.",
)
async def get_dashboard(
    dashboard_id: int,
    db: DatabaseDep,
) -> DashboardResponse:
    """Get a dashboard by ID."""
    result = await db.execute(
        select(UserDashboard).where(UserDashboard.id == dashboard_id)
    )
    dashboard = result.scalar_one_or_none()
    
    if not dashboard:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Dashboard {dashboard_id} not found",
        )
    
    return _to_response(dashboard)


@router.patch(
    "/{dashboard_id}",
    response_model=DashboardResponse,
    summary="Update Dashboard",
    description="Update dashboard properties.",
)
async def update_dashboard(
    dashboard_id: int,
    data: DashboardUpdate,
    db: DatabaseDep,
) -> DashboardResponse:
    """Update a dashboard."""
    result = await db.execute(
        select(UserDashboard).where(UserDashboard.id == dashboard_id)
    )
    dashboard = result.scalar_one_or_none()
    
    if not dashboard:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Dashboard {dashboard_id} not found",
        )
    
    # Update fields if provided
    if data.name is not None:
        dashboard.name = data.name
    if data.description is not None:
        dashboard.description = data.description
    if data.layout_config is not None:
        dashboard.layout_config = data.layout_config
    if data.is_default is not None:
        if data.is_default:
            # Unset other defaults
            await db.execute(
                update(UserDashboard)
                .where(UserDashboard.user_id == dashboard.user_id)
                .where(UserDashboard.id != dashboard_id)
                .values(is_default=0)
            )
        dashboard.is_default = 1 if data.is_default else 0
    
    await db.flush()
    await db.refresh(dashboard)
    
    return _to_response(dashboard)


@router.delete(
    "/{dashboard_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete Dashboard",
    description="Delete a dashboard and all its widgets.",
)
async def delete_dashboard(
    dashboard_id: int,
    db: DatabaseDep,
) -> None:
    """Delete a dashboard."""
    result = await db.execute(
        select(UserDashboard).where(UserDashboard.id == dashboard_id)
    )
    dashboard = result.scalar_one_or_none()
    
    if not dashboard:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Dashboard {dashboard_id} not found",
        )
    
    await db.delete(dashboard)


# ============ Widget Endpoints ============

@router.post(
    "/{dashboard_id}/widgets",
    response_model=WidgetResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Add Widget",
    description="Add a widget to a dashboard.",
)
async def add_widget(
    dashboard_id: int,
    data: WidgetCreate,
    db: DatabaseDep,
) -> WidgetResponse:
    """Add a widget to a dashboard."""
    # Verify dashboard exists
    result = await db.execute(
        select(UserDashboard).where(UserDashboard.id == dashboard_id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Dashboard {dashboard_id} not found",
        )
    
    widget = DashboardWidget(
        dashboard_id=dashboard_id,
        widget_id=data.widget_id,
        widget_type=data.widget_type,
        layout=data.layout.model_dump(),
        widget_config=data.widget_config.model_dump() if data.widget_config else {},
    )
    db.add(widget)
    await db.flush()
    await db.refresh(widget)
    
    return WidgetResponse(
        id=widget.id,
        widget_id=widget.widget_id,
        widget_type=widget.widget_type,
        layout=widget.layout,
        widget_config=widget.widget_config,
    )


@router.delete(
    "/{dashboard_id}/widgets/{widget_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove Widget",
    description="Remove a widget from a dashboard.",
)
async def remove_widget(
    dashboard_id: int,
    widget_id: int,
    db: DatabaseDep,
) -> None:
    """Remove a widget from a dashboard."""
    result = await db.execute(
        select(DashboardWidget)
        .where(DashboardWidget.dashboard_id == dashboard_id)
        .where(DashboardWidget.id == widget_id)
    )
    widget = result.scalar_one_or_none()
    
    if not widget:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Widget {widget_id} not found",
        )
    
    await db.delete(widget)


# ============ Helper Functions ============

def _to_response(dashboard: UserDashboard) -> DashboardResponse:
    """Convert ORM model to response model."""
    return DashboardResponse(
        id=dashboard.id,
        user_id=dashboard.user_id,
        name=dashboard.name,
        description=dashboard.description,
        is_default=bool(dashboard.is_default),
        layout_config=dashboard.layout_config,
        widgets=[
            WidgetResponse(
                id=w.id,
                widget_id=w.widget_id,
                widget_type=w.widget_type,
                layout=w.layout,
                widget_config=w.widget_config,
            )
            for w in (dashboard.widgets or [])
        ],
    )
