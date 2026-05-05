"""
Screener Snapshot ORM Model

Stores point-in-time snapshots of screener data with all 84 metrics.
Used for historical analysis and RS rating calculations.
"""

from datetime import date, datetime
from typing import Optional

from sqlalchemy import (
    Column, String, Integer, Float, Date, DateTime,
    Index, UniqueConstraint, BigInteger, JSON
)
from sqlalchemy.orm import Mapped, mapped_column

from vnibb.core.database import Base


class ScreenerSnapshot(Base):
    """
    Daily snapshot of screener metrics for all stocks.
    
    Contains 84 financial metrics including:
    - Valuation: PE, PB, PS, EV/EBITDA
    - Profitability: ROE, ROA, ROIC, margins
    - Growth: Revenue growth, earnings growth
    - Technical: RS rating (calculated)
    """
    __tablename__ = "screener_snapshots"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    
    # Stock reference
    symbol: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    snapshot_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    
    # Company info
    company_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    exchange: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    industry: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    
    # Price & Volume
    price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    volume: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    market_cap: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    # Valuation Ratios
    pe: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    pb: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    ps: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    ev_ebitda: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    # Profitability
    roe: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    roa: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    roic: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    gross_margin: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    net_margin: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    operating_margin: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    # Growth
    revenue_growth: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    earnings_growth: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    # Dividend
    dividend_yield: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    # Debt & Liquidity
    debt_to_equity: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    current_ratio: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    quick_ratio: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    # Per Share
    eps: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    bvps: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    # Ownership
    foreign_ownership: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    # Calculated Metrics (VNIBB specific)
    rs_rating: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # 1-99 Relative Strength
    rs_rank: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # Rank among all stocks
    
    # Additional metrics stored as JSON
    extended_metrics: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    
    # Metadata
    source: Mapped[str] = mapped_column(String(20), default="vnstock", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    
    __table_args__ = (
        UniqueConstraint("symbol", "snapshot_date", name="uq_screener_snapshot_symbol_date"),
        Index("ix_screener_symbol_date", "symbol", "snapshot_date"),
        Index("ix_screener_date_industry", "snapshot_date", "industry"),
        Index("ix_screener_date_rs", "snapshot_date", "rs_rating"),
        Index("ix_screener_market_cap", "market_cap"),
        Index("ix_screener_date_market_cap", "snapshot_date", "market_cap"),
    )

    
    def __repr__(self) -> str:
        return f"<ScreenerSnapshot(symbol='{self.symbol}', date='{self.snapshot_date}')>"
