"""
Alert System ORM Models

Models for:
- BlockTrade: Large block trade detection
- InsiderAlert: User alerts for insider activity
- AlertSettings: User-configurable alert thresholds
"""

from datetime import datetime
from typing import Optional
from enum import Enum

from sqlalchemy import (
    String, Integer, Float, DateTime, Boolean,
    Index, UniqueConstraint, BigInteger, Text, Enum as SQLEnum
)
from sqlalchemy.orm import Mapped, mapped_column

from vnibb.core.database import Base


class AlertType(str, Enum):
    """Alert types for insider activity"""
    INSIDER_BUY = "INSIDER_BUY"
    INSIDER_SELL = "INSIDER_SELL"
    BLOCK_TRADE = "BLOCK_TRADE"
    OWNERSHIP_CHANGE = "OWNERSHIP_CHANGE"


class AlertSeverity(str, Enum):
    """Alert severity levels"""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class TradeSide(str, Enum):
    """Trade side for block trades"""
    BUY = "BUY"
    SELL = "SELL"


class BlockTrade(Base):
    """
    Large block trade detection.
    
    Tracks trades exceeding configured thresholds (default: VND 10 billion).
    Used for institutional activity monitoring.
    """
    __tablename__ = "block_trades"
    
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    
    # Stock reference
    symbol: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    
    # Trade details
    side: Mapped[str] = mapped_column(SQLEnum(TradeSide), nullable=False)
    quantity: Mapped[int] = mapped_column(BigInteger, nullable=False)
    price: Mapped[float] = mapped_column(Float, nullable=False)
    value: Mapped[float] = mapped_column(Float, nullable=False)  # VND
    
    # Timing
    trade_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    
    # Additional context
    counterparty: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    is_foreign: Mapped[bool] = mapped_column(Boolean, default=False)
    is_proprietary: Mapped[bool] = mapped_column(Boolean, default=False)
    
    # Volume analysis
    avg_volume_20d: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    volume_ratio: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # Trade vol / avg vol
    
    # Metadata
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    
    __table_args__ = (
        Index("ix_block_symbol_time", "symbol", "trade_time"),
        Index("ix_block_time", "trade_time"),
        Index("ix_block_value", "value"),
    )
    
    def __repr__(self) -> str:
        return f"<BlockTrade(symbol='{self.symbol}', side='{self.side}', value={self.value})>"


class InsiderAlert(Base):
    """
    User alerts for insider trading activity.
    
    Stores generated alerts based on insider deals and block trades.
    Supports read/unread status and user-specific filtering.
    """
    __tablename__ = "insider_alerts"
    
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    
    # Alert classification
    alert_type: Mapped[str] = mapped_column(SQLEnum(AlertType), nullable=False, index=True)
    severity: Mapped[str] = mapped_column(SQLEnum(AlertSeverity), nullable=False, index=True)
    
    # Stock reference
    symbol: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    
    # Alert content
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    
    # Related entity IDs
    insider_deal_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    block_trade_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    
    # User interaction
    user_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True, index=True)
    read: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    read_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    
    # Timing
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    
    # Metadata
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    
    __table_args__ = (
        Index("ix_alert_user_read", "user_id", "read"),
        Index("ix_alert_symbol_time", "symbol", "timestamp"),
        Index("ix_alert_type_time", "alert_type", "timestamp"),
    )
    
    def __repr__(self) -> str:
        return f"<InsiderAlert(type='{self.alert_type}', symbol='{self.symbol}', read={self.read})>"


class AlertSettings(Base):
    """
    User-configurable alert thresholds.
    
    Stores per-user preferences for alert generation.
    """
    __tablename__ = "alert_settings"
    
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    
    # User reference
    user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, unique=True, index=True)
    
    # Block trade thresholds
    block_trade_threshold: Mapped[float] = mapped_column(
        Float, 
        default=10_000_000_000,  # VND 10 billion
        nullable=False
    )
    
    # Insider trading alerts
    enable_insider_buy_alerts: Mapped[bool] = mapped_column(Boolean, default=True)
    enable_insider_sell_alerts: Mapped[bool] = mapped_column(Boolean, default=True)
    enable_ownership_change_alerts: Mapped[bool] = mapped_column(Boolean, default=True)
    
    # Ownership change threshold (%)
    ownership_change_threshold: Mapped[float] = mapped_column(Float, default=5.0)
    
    # Notification preferences
    enable_browser_notifications: Mapped[bool] = mapped_column(Boolean, default=True)
    enable_email_notifications: Mapped[bool] = mapped_column(Boolean, default=False)
    enable_sound_alerts: Mapped[bool] = mapped_column(Boolean, default=True)
    
    # Email for notifications
    notification_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    
    # Metadata
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, 
        default=datetime.utcnow, 
        onupdate=datetime.utcnow
    )
    
    def __repr__(self) -> str:
        return f"<AlertSettings(user_id={self.user_id}, block_threshold={self.block_trade_threshold})>"
