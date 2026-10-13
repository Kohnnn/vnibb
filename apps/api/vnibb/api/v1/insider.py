"""
Insider Trading & Block Trade Alerts API

Endpoints:
- GET /api/v1/insider/{symbol}/deals - Insider trades for stock
- GET /api/v1/insider/recent - Recent insider activity (all stocks)
- GET /api/v1/insider/{symbol}/sentiment - Insider sentiment analysis
- GET /api/v1/insider/block-trades - Recent block trades
- GET /api/v1/alerts/insider - User's insider alerts
- PUT /api/v1/alerts/{alert_id}/read - Mark alert as read
- GET /api/v1/alerts/settings - Get alert settings
- PUT /api/v1/alerts/settings - Update alert thresholds
"""

import logging
from typing import Any, List, Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, Field, model_validator

from vnibb.core.database import get_db
from vnibb.services.insider_tracking import InsiderTrackingService

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Insider Trading & Alerts"])


# ============================================================================
# Pydantic Models
# ============================================================================


class InsiderDealResponse(BaseModel):
    """Insider deal response model.

    `deal_price`/`deal_value` are canonical VND only when the provider supplied
    explicit unit evidence; `price_unit`/`value_unit` report that admission
    ("VND" or "unknown") so consumers never assume VND from magnitude alone.
    `deal_action` is the normalized BUY/SELL/UNKNOWN token.
    """

    id: int
    symbol: str
    insider_name: Optional[str]
    insider_position: Optional[str]
    deal_action: Optional[str]
    deal_quantity: Optional[float]
    deal_price: Optional[float]
    deal_value: Optional[float]
    price_unit: Optional[str] = None
    value_unit: Optional[str] = None
    announce_date: datetime

    class Config:
        from_attributes = True

    @model_validator(mode="before")
    @classmethod
    def _admit_units(cls, value: Any) -> Any:
        raw = getattr(value, "raw_data", None)
        if isinstance(raw, dict):
            return {
                "price_unit": raw.get("price_unit"),
                "value_unit": raw.get("value_unit"),
                "id": value.id,
                "symbol": value.symbol,
                "insider_name": value.insider_name,
                "insider_position": value.insider_position,
                "deal_action": value.deal_action,
                "deal_quantity": value.deal_quantity,
                "deal_price": value.deal_price,
                "deal_value": value.deal_value,
                "announce_date": value.announce_date,
            }
        return value


class BlockTradeResponse(BaseModel):
    """Block trade response model"""

    id: int
    symbol: str
    side: Optional[str]
    quantity: int
    price: float
    value: float
    trade_time: datetime
    volume_ratio: Optional[float]
    is_foreign: bool
    is_proprietary: bool

    class Config:
        from_attributes = True


class InsiderAlertResponse(BaseModel):
    """Insider alert response model"""

    id: int
    alert_type: str
    severity: str
    symbol: str
    title: str
    description: str
    timestamp: datetime
    read: bool
    read_at: Optional[datetime]

    class Config:
        from_attributes = True


class AlertSettingsResponse(BaseModel):
    """Alert settings response model"""

    user_id: int
    block_trade_threshold: float
    enable_insider_buy_alerts: bool
    enable_insider_sell_alerts: bool
    enable_ownership_change_alerts: bool
    ownership_change_threshold: float
    enable_browser_notifications: bool
    enable_email_notifications: bool
    enable_sound_alerts: bool
    notification_email: Optional[str]

    class Config:
        from_attributes = True


class AlertSettingsUpdate(BaseModel):
    """Alert settings update request"""

    block_trade_threshold: Optional[float] = Field(None, ge=0)
    enable_insider_buy_alerts: Optional[bool] = None
    enable_insider_sell_alerts: Optional[bool] = None
    enable_ownership_change_alerts: Optional[bool] = None
    ownership_change_threshold: Optional[float] = Field(None, ge=0, le=100)
    enable_browser_notifications: Optional[bool] = None
    enable_email_notifications: Optional[bool] = None
    enable_sound_alerts: Optional[bool] = None
    notification_email: Optional[str] = None


class InsiderSentimentResponse(BaseModel):
    """Insider sentiment analysis response.

    `buy_value`/`sell_value`/`net_value` are canonical VND only when every
    classified deal in the window carries finite value + VND unit evidence;
    `value_unit` reports that admission ("VND" or null). Unadmitted aggregates
    and the derived `sentiment_score` are null rather than a partial sum.
    `buy_count`/`sell_count`/`total_deals` always count stored rows and UNKNOWN
    direction stays neutral.
    """

    symbol: str
    period_days: int
    buy_count: int
    sell_count: int
    buy_value: Optional[float]
    sell_value: Optional[float]
    net_value: Optional[float]
    sentiment_score: Optional[float]
    value_unit: Optional[str] = None
    total_deals: int


# ============================================================================
# Insider Deals Endpoints
# ============================================================================


@router.get("/insider/{symbol}/deals", response_model=List[InsiderDealResponse])
async def get_insider_deals(
    symbol: str, limit: int = Query(50, ge=1, le=500), db: AsyncSession = Depends(get_db)
):
    """
    Get insider trading deals for a specific stock.

    Args:
        symbol: Stock symbol (e.g., 'VNM', 'HPG')
        limit: Maximum number of deals to return

    Returns:
        List of insider deals
    """
    try:
        service = InsiderTrackingService(db)
        deals = await service.get_recent_insider_deals(symbol=symbol, limit=limit)

        return [InsiderDealResponse.model_validate(deal) for deal in deals]

    except Exception as e:
        logger.error(f"Error fetching insider deals for {symbol}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/insider/recent", response_model=List[InsiderDealResponse])
async def get_recent_insider_deals(
    limit: int = Query(100, ge=1, le=500), db: AsyncSession = Depends(get_db)
):
    """
    Get recent insider trading deals across all stocks.

    Args:
        limit: Maximum number of deals to return

    Returns:
        List of recent insider deals
    """
    try:
        service = InsiderTrackingService(db)
        deals = await service.get_recent_insider_deals(limit=limit)

        return [InsiderDealResponse.model_validate(deal) for deal in deals]

    except Exception as e:
        logger.error(f"Error fetching recent insider deals: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/insider/{symbol}/sentiment", response_model=InsiderSentimentResponse)
async def get_insider_sentiment(
    symbol: str, days: int = Query(90, ge=1, le=365), db: AsyncSession = Depends(get_db)
):
    """
    Calculate insider sentiment score for a stock.

    Args:
        symbol: Stock symbol
        days: Number of days to analyze (default: 90)

    Returns:
        Insider sentiment analysis
    """
    try:
        service = InsiderTrackingService(db)
        sentiment = await service.calculate_insider_sentiment(symbol, days)

        return InsiderSentimentResponse(**sentiment)

    except Exception as e:
        logger.error(f"Error calculating insider sentiment for {symbol}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# Block Trades Endpoints
# ============================================================================


@router.get("/insider/block-trades", response_model=List[BlockTradeResponse])
async def get_block_trades(
    symbol: Optional[str] = None,
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    """
    Get recent large block trades.

    Args:
        symbol: Optional stock symbol filter
        limit: Maximum number of trades to return

    Returns:
        List of block trades
    """
    try:
        service = InsiderTrackingService(db)
        trades = await service.get_recent_block_trades(symbol=symbol, limit=limit)

        return [BlockTradeResponse.model_validate(trade) for trade in trades]

    except Exception:
        logger.exception("Error fetching block trades")
        raise HTTPException(status_code=503, detail="Block-trade data unavailable") from None


# ============================================================================
# Alerts Endpoints
# ============================================================================


@router.get("/alerts/insider", response_model=List[InsiderAlertResponse])
async def get_insider_alerts(
    user_id: Optional[int] = None,
    unread_only: bool = False,
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    """
    Get insider trading alerts.

    Args:
        user_id: Optional user ID filter
        unread_only: Only return unread alerts
        limit: Maximum number of alerts to return

    Returns:
        List of insider alerts
    """
    try:
        service = InsiderTrackingService(db)
        alerts = await service.get_user_alerts(
            user_id=user_id, unread_only=unread_only, limit=limit
        )

        return [InsiderAlertResponse.model_validate(alert) for alert in alerts]

    except Exception as e:
        logger.error(f"Error fetching insider alerts: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/alerts/{alert_id}/read", response_model=InsiderAlertResponse)
async def mark_alert_read(alert_id: int, db: AsyncSession = Depends(get_db)):
    """
    Mark an alert as read.

    Args:
        alert_id: Alert ID

    Returns:
        Updated alert
    """
    try:
        service = InsiderTrackingService(db)
        alert = await service.mark_alert_read(alert_id)

        if not alert:
            raise HTTPException(status_code=404, detail="Alert not found")

        return InsiderAlertResponse.model_validate(alert)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error marking alert {alert_id} as read: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# Alert Settings Endpoints
# ============================================================================


@router.get("/alerts/settings", response_model=AlertSettingsResponse)
async def get_alert_settings(
    user_id: int = Query(..., description="User ID"), db: AsyncSession = Depends(get_db)
):
    """
    Get alert settings for a user.

    Args:
        user_id: User ID

    Returns:
        Alert settings
    """
    try:
        service = InsiderTrackingService(db)
        settings = await service.get_or_create_alert_settings(user_id)

        return AlertSettingsResponse.model_validate(settings)

    except Exception as e:
        logger.error(f"Error fetching alert settings for user {user_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/alerts/settings", response_model=AlertSettingsResponse)
async def update_alert_settings(
    user_id: int = Query(..., description="User ID"),
    settings: AlertSettingsUpdate = ...,
    db: AsyncSession = Depends(get_db),
):
    """
    Update alert settings for a user.

    Args:
        user_id: User ID
        settings: Settings to update

    Returns:
        Updated alert settings
    """
    try:
        service = InsiderTrackingService(db)

        # Filter out None values
        update_data = {k: v for k, v in settings.model_dump().items() if v is not None}

        updated_settings = await service.update_alert_settings(user_id, **update_data)

        return AlertSettingsResponse.model_validate(updated_settings)

    except Exception as e:
        logger.error(f"Error updating alert settings for user {user_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))
