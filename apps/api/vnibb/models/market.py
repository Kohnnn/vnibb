"""
Market Data ORM Models

Models for:
- MarketSector: Industry/sector classifications
- SectorPerformance: Daily sector performance metrics
- Subsidiary: Company subsidiaries and affiliates
"""

from datetime import date, datetime
from typing import Optional

from sqlalchemy import (
    String, Integer, Float, Date, DateTime,
    Index, UniqueConstraint, BigInteger, Text
)
from sqlalchemy.orm import Mapped, mapped_column

from vnibb.core.database import Base


class MarketSector(Base):
    """
    Industry and sector classifications.
    
    Hierarchical sector structure for Vietnam market.
    """
    __tablename__ = "market_sectors"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    
    # Sector identification
    sector_code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False, index=True)
    sector_name: Mapped[str] = mapped_column(String(100), nullable=False)
    sector_name_en: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    
    # Hierarchy
    parent_code: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # Parent sector code
    level: Mapped[int] = mapped_column(Integer, default=1, nullable=False)  # 1=sector, 2=industry, 3=sub-industry
    
    # ICB classification (if applicable)
    icb_code: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    
    # Metadata
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __repr__(self) -> str:
        return f"<MarketSector(code='{self.sector_code}', name='{self.sector_name}')>"


class SectorPerformance(Base):
    """
    Daily sector performance metrics.
    
    Aggregated performance data by sector.
    """
    __tablename__ = "sector_performance"
    
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    
    # Sector reference
    sector_code: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    
    # Date
    trade_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    
    # Performance
    change_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    avg_change_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    # Volume
    total_volume: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    avg_volume: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    total_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    # Market cap
    total_market_cap: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    # Top performers
    top_gainer_symbol: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    top_gainer_change: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    top_loser_symbol: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    top_loser_change: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    # Breadth
    advance_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    decline_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    unchanged_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    
    # Metadata
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    
    __table_args__ = (
        UniqueConstraint("sector_code", "trade_date", name="uq_sector_perf_code_date"),
        Index("ix_sector_perf_date", "trade_date"),
    )
    
    def __repr__(self) -> str:
        return f"<SectorPerformance(sector='{self.sector_code}', date='{self.trade_date}', change={self.change_pct})>"


class Subsidiary(Base):
    """
    Company subsidiaries and affiliates.
    
    Tracks ownership structure and related companies.
    """
    __tablename__ = "subsidiaries"
    
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    
    # Parent company reference
    symbol: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    
    # Subsidiary details
    subsidiary_name: Mapped[str] = mapped_column(String(255), nullable=False)
    subsidiary_symbol: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)  # If listed
    
    # Ownership
    ownership_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    charter_capital: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    # Classification
    relationship_type: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)  # subsidiary, associate, JV
    
    # Description
    business_description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    # Metadata
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    __table_args__ = (
        Index("ix_subsidiary_symbol", "symbol"),
    )
    
    def __repr__(self) -> str:
        return f"<Subsidiary(parent='{self.symbol}', name='{self.subsidiary_name}', ownership={self.ownership_pct})>"
