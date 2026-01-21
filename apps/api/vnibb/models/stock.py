"""
Stock and Price ORM Models

Core models for:
- Stock: Master list of Vietnam-listed securities
- StockPrice: Historical OHLCV data
- StockIndex: Market indices (VN-INDEX, HNX-INDEX, etc.)
"""

from datetime import date, datetime
from typing import Optional, List

from sqlalchemy import (
    Column, String, Integer, Float, Date, DateTime, 
    ForeignKey, Index, UniqueConstraint, BigInteger, Text
)
from sqlalchemy.orm import relationship, Mapped, mapped_column

from vnibb.core.database import Base


class Stock(Base):
    """
    Master table of Vietnam-listed stocks.
    
    Contains basic identification and classification info.
    Updated daily from screener data.
    """
    __tablename__ = "stocks"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    
    # Identification
    symbol: Mapped[str] = mapped_column(String(10), unique=True, nullable=False, index=True)
    isin: Mapped[Optional[str]] = mapped_column(String(20), unique=True, nullable=True)
    
    # Company info
    company_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    short_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    
    # Classification
    exchange: Mapped[str] = mapped_column(
        String(10), nullable=False, default="HOSE", index=True
    )  # HOSE, HNX, UPCOM
    industry: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    sector: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    
    # Status
    is_active: Mapped[bool] = mapped_column(Integer, default=1, nullable=False)  # 1=active, 0=delisted
    listing_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    delisting_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    
    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )
    
    # Relationships
    prices: Mapped[List["StockPrice"]] = relationship("StockPrice", back_populates="stock", cascade="all, delete-orphan")
    
    def __repr__(self) -> str:
        return f"<Stock(symbol='{self.symbol}', exchange='{self.exchange}')>"


class StockPrice(Base):
    """
    Historical OHLCV price data.
    
    Stores daily/intraday price data for all stocks.
    Primary data source for charts and technical analysis.
    """
    __tablename__ = "stock_prices"
    
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    
    # Foreign key to stock
    stock_id: Mapped[int] = mapped_column(Integer, ForeignKey("stocks.id"), nullable=False, index=True)
    symbol: Mapped[str] = mapped_column(String(10), nullable=False, index=True)  # Denormalized for query performance
    
    # OHLCV data
    time: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    open: Mapped[float] = mapped_column(Float, nullable=False)
    high: Mapped[float] = mapped_column(Float, nullable=False)
    low: Mapped[float] = mapped_column(Float, nullable=False)
    close: Mapped[float] = mapped_column(Float, nullable=False)
    volume: Mapped[int] = mapped_column(BigInteger, nullable=False)
    
    # Extended data
    value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # Trading value in VND
    adj_close: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # Adjusted close
    
    # Data source tracking
    interval: Mapped[str] = mapped_column(String(5), default="1D", nullable=False)  # 1D, 1W, 1M
    source: Mapped[str] = mapped_column(String(20), default="vnstock", nullable=False)
    
    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    
    # Relationships
    stock: Mapped["Stock"] = relationship("Stock", back_populates="prices")
    
    # Constraints
    __table_args__ = (
        UniqueConstraint("symbol", "time", "interval", name="uq_stock_price_symbol_time_interval"),
        Index("ix_stock_price_symbol_time", "symbol", "time"),
        Index("ix_stock_price_date_only", "time"),
        Index("ix_stock_price_perf", "symbol", "close"),
    )

    
    def __repr__(self) -> str:
        return f"<StockPrice(symbol='{self.symbol}', time='{self.time}', close={self.close})>"


class StockIndex(Base):
    """
    Market indices historical data.
    
    Tracks VN-INDEX, HNX-INDEX, UPCOM-INDEX, VN30, etc.
    """
    __tablename__ = "stock_indices"
    
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    
    # Index identification
    index_code: Mapped[str] = mapped_column(String(20), nullable=False, index=True)  # VNINDEX, HNX, VN30
    
    # OHLCV
    time: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    open: Mapped[float] = mapped_column(Float, nullable=False)
    high: Mapped[float] = mapped_column(Float, nullable=False)
    low: Mapped[float] = mapped_column(Float, nullable=False)
    close: Mapped[float] = mapped_column(Float, nullable=False)
    volume: Mapped[int] = mapped_column(BigInteger, nullable=False)
    value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    # Changes
    change: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # Point change
    change_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # Percentage change
    
    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    
    __table_args__ = (
        UniqueConstraint("index_code", "time", name="uq_stock_index_code_time"),
        Index("ix_stock_index_code_time", "index_code", "time"),
    )
    
    def __repr__(self) -> str:
        return f"<StockIndex(code='{self.index_code}', time='{self.time}', close={self.close})>"
