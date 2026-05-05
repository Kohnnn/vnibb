"""
Dashboard ORM Models

Models for:
- UserDashboard: User's saved dashboard configurations
- DashboardWidget: Individual widget placement and config
"""

from datetime import datetime
from typing import Optional, List

from sqlalchemy import (
    Column, String, Integer, DateTime,
    ForeignKey, Index, JSON, Text
)
from sqlalchemy.orm import relationship, Mapped, mapped_column

from vnibb.core.database import Base


class UserDashboard(Base):
    """
    User's saved dashboard configurations.
    
    Stores layout preferences and widget arrangements.
    Compatible with React-Grid-Layout.
    """
    __tablename__ = "user_dashboards"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    
    # User reference (placeholder for future auth)
    user_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True, default="anonymous")
    
    # Dashboard info
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    is_default: Mapped[int] = mapped_column(Integer, default=0)  # 0=False, 1=True
    
    # Layout configuration (JSON)
    # Contains: version, theme, gridCols, rowHeight, widgets array
    layout_config: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True, default=dict)
    
    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    widgets: Mapped[List["DashboardWidget"]] = relationship(
        "DashboardWidget", back_populates="dashboard", cascade="all, delete-orphan"
    )
    
    __table_args__ = (
        Index("ix_dashboard_user_default", "user_id", "is_default"),
    )
    
    def __repr__(self) -> str:
        return f"<UserDashboard(id={self.id}, name='{self.name}')>"


class DashboardWidget(Base):
    """
    Individual widget placement within a dashboard.
    
    Stores position, size, and widget-specific configuration.
    """
    __tablename__ = "dashboard_widgets"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    
    # Dashboard reference
    dashboard_id: Mapped[int] = mapped_column(Integer, ForeignKey("user_dashboards.id"), nullable=False, index=True)
    
    # Widget identification
    widget_id: Mapped[str] = mapped_column(String(50), nullable=False)  # Unique within dashboard
    widget_type: Mapped[str] = mapped_column(String(50), nullable=False)
    # Types: ticker_info, price_chart, key_metrics, company_profile, 
    #        financials, screener, price_performance, share_statistics
    
    # React-Grid-Layout position/size
    # Stored as JSON: {x, y, w, h, minW, minH}
    layout: Mapped[dict] = mapped_column(JSON, nullable=False)
    
    # Widget-specific configuration
    # Example: {symbol: "VNM", timeframe: "1D", indicators: ["SMA9"]}
    widget_config: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True, default=dict)
    
    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    dashboard: Mapped["UserDashboard"] = relationship("UserDashboard", back_populates="widgets")
    
    def __repr__(self) -> str:
        return f"<DashboardWidget(id={self.id}, type='{self.widget_type}')>"
