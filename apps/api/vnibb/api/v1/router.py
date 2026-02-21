"""
Main API Router Aggregator

Collects all v1 endpoint routers and mounts them
under a common prefix.
"""

from fastapi import APIRouter

from vnibb.api.v1.equity import router as equity_router
from vnibb.api.v1.screener import router as screener_router
from vnibb.api.v1.financials import router as financials_router
from vnibb.api.v1.dashboard import router as dashboard_router
from vnibb.api.v1.data_sync import router as data_sync_router
from vnibb.api.v1.realtime import router as realtime_router
from vnibb.api.v1.technical import router as technical_router
from vnibb.api.v1.news import router as news_router
from vnibb.api.v1.listing import router as listing_router
from vnibb.api.v1.trading import router as trading_router
from vnibb.api.v1.derivatives import router as derivatives_router
from vnibb.api.v1.user import router as user_router
from vnibb.api.v1.rs_rating import router as rs_rating_router
from vnibb.api.v1.market import router as market_router

from vnibb.api.v1.comparison import router as comparison_router
from vnibb.api.v1.sectors import router as sectors_router

# Main v1 router
api_router = APIRouter()

# Mount sub-routers
api_router.include_router(
    comparison_router,
    prefix="/comparison",
    tags=["Comparison"],
)

api_router.include_router(
    sectors_router,
    prefix="/sectors",
    tags=["Sectors"],
)


# Mount sub-routers
api_router.include_router(
    equity_router,
    prefix="/equity",
    tags=["Equity"],
)

api_router.include_router(
    screener_router,
    prefix="/screener",
    tags=["Screener"],
)

api_router.include_router(
    financials_router,
    prefix="/financials",
    tags=["Financials"],
)

api_router.include_router(
    dashboard_router,
    prefix="/dashboard",
    tags=["Dashboard"],
)

api_router.include_router(
    user_router,
    prefix="/user",
    tags=["User"],
)

api_router.include_router(
    data_sync_router,
    prefix="/data",
    tags=["Data Pipeline"],
)

# New vnstock premium endpoints
api_router.include_router(
    realtime_router,
    prefix="/stream",
    tags=["Real-time Streaming"],
)

api_router.include_router(
    technical_router,
    prefix="/analysis",
    tags=["Technical Analysis"],
)

api_router.include_router(
    market_router,
    prefix="/market",
    tags=["Market Data"],
)

api_router.include_router(
    news_router,
    prefix="/market",
    tags=["Market News"],
)

api_router.include_router(
    news_router,
    prefix="/news",
    tags=["News"],
)

# New Phase 1 endpoints - Listing, Trading, Derivatives
api_router.include_router(
    listing_router,
    prefix="/listing",
    tags=["Listing"],
)

api_router.include_router(
    trading_router,
    prefix="/trading",
    tags=["Trading"],
)

api_router.include_router(
    derivatives_router,
    prefix="/derivatives",
    tags=["Derivatives"],
)

# Phase 5 - Comparison Analysis
from vnibb.api.v1.analysis import router as analysis_router

api_router.include_router(
    analysis_router,
    prefix="/analysis",
    tags=["Comparison Analysis"],
)

api_router.include_router(
    analysis_router,
    prefix="/compare",
    tags=["Comparison Alias"],
)


# Phase 6 - AI Copilot
from vnibb.api.v1.copilot import router as copilot_router

api_router.include_router(
    copilot_router,
    prefix="/copilot",
    tags=["AI Copilot"],
)

# Phase 13 - WebSocket Real-time
from vnibb.api.v1.websocket import router as websocket_router

api_router.include_router(
    websocket_router,
    tags=["WebSocket"],
)

# Phase 14 - Data Export
from vnibb.api.v1.export import router as export_router

api_router.include_router(
    export_router,
    tags=["Export"],
)

# Phase 2 Task 42 - RS Rating System
api_router.include_router(
    rs_rating_router,
    prefix="/rs",
    tags=["RS Rating"],
)

# Phase 2 Task 41 - Insider Trading & Block Trade Alerts
from vnibb.api.v1.insider import router as insider_router

api_router.include_router(
    insider_router,
    tags=["Insider Trading & Alerts"],
)

# Admin Dashboard - Database Browser
from vnibb.api.v1.admin import router as admin_router

api_router.include_router(
    admin_router,
    prefix="/admin",
    tags=["Admin"],
)

# Chart Data - Local Lightweight Charts
from vnibb.api.v1.chart import router as chart_router

api_router.include_router(
    chart_router,
    prefix="/chart-data",
    tags=["Chart Data"],
)
