"""
News, Events, and Dividends ORM Models

Models for:
- CompanyNews: News articles and filings
- CompanyEvent: Corporate actions (AGM, splits, etc.)
- Dividend: Historical dividend payments
- InsiderDeal: Insider trading transactions
"""

from datetime import date, datetime
from typing import Optional

from sqlalchemy import (
    String, Integer, Float, Date, DateTime,
    Index, UniqueConstraint, BigInteger, Text, JSON
)
from sqlalchemy.orm import Mapped, mapped_column

from vnibb.core.database import Base


class CompanyNews(Base):
    """
    Company news articles and announcements.
    
    Stores news from TCBS, VNDirect, and other sources.
    Updated hourly via data pipeline.
    """
    __tablename__ = "company_news"
    
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    
    # Stock reference
    symbol: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    
    # News content
    title: Mapped[str] = mapped_column(Text, nullable=False)
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    source: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)  # TCBS, VNDirect, etc.
    url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    # Publication
    published_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, index=True)
    
    # Technical indicators (from vnstock news API)
    rsi: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    rs: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    price_change: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    price_change_ratio: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    # Metadata
    news_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)  # Original ID from source
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    
    __table_args__ = (
        UniqueConstraint("symbol", "title", "published_date", name="uq_news_symbol_title_date"),
        Index("ix_news_symbol_published", "symbol", "published_date"),
        Index("ix_news_source", "source"),
    )

    
    def __repr__(self) -> str:
        return f"<CompanyNews(symbol='{self.symbol}', title='{self.title[:50]}...')>"


class CompanyEvent(Base):
    """
    Corporate events and actions.
    
    Tracks dividends, AGMs, earnings releases, stock splits, etc.
    """
    __tablename__ = "company_events"
    
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    
    # Stock reference
    symbol: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    
    # Event details
    event_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    # Types: dividend, earnings, split, AGM, bonus_issue, rights_issue
    
    # Dates
    event_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True, index=True)
    ex_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    record_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    payment_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    
    # Value
    value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # Dividend amount, split ratio, etc.
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    # Raw data
    raw_data: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    
    # Metadata
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    __table_args__ = (
        UniqueConstraint("symbol", "event_type", "event_date", name="uq_event_symbol_type_date"),
        Index("ix_event_symbol_date", "symbol", "event_date"),
        Index("ix_event_type_date", "event_type", "event_date"),
    )
    
    def __repr__(self) -> str:
        return f"<CompanyEvent(symbol='{self.symbol}', type='{self.event_type}', date='{self.event_date}')>"


class Dividend(Base):
    """
    Historical dividend payments.
    
    Detailed dividend data including rates and payment methods.
    """
    __tablename__ = "dividends"
    
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    
    # Stock reference
    symbol: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    
    # Dividend details
    exercise_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True, index=True)
    cash_year: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    dividend_rate: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # % of par value
    dividend_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # VND per share
    
    # Method
    issue_method: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)  # cash, stock
    
    # Dates
    record_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    payment_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    
    # Raw data
    raw_data: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    
    # Metadata
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    
    __table_args__ = (
        UniqueConstraint("symbol", "exercise_date", "cash_year", name="uq_dividend_symbol_date_year"),
        Index("ix_dividend_symbol_date", "symbol", "exercise_date"),
    )
    
    def __repr__(self) -> str:
        return f"<Dividend(symbol='{self.symbol}', date='{self.exercise_date}', rate={self.dividend_rate})>"


class InsiderDeal(Base):
    """
    Insider trading transactions.
    
    Tracks buy/sell transactions by company insiders.
    """
    __tablename__ = "insider_deals"
    
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    
    # Stock reference
    symbol: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    
    # Deal details
    announce_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    deal_method: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    deal_action: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)  # Mua (Buy), Bán (Sell)
    
    # Quantities
    deal_quantity: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    deal_price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    deal_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    deal_ratio: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    # Insider info
    insider_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    insider_position: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    
    # Raw data
    raw_data: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    
    # Metadata
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    
    __table_args__ = (
        Index("ix_insider_symbol_date", "symbol", "announce_date"),
    )
    
    def __repr__(self) -> str:
        return f"<InsiderDeal(symbol='{self.symbol}', date='{self.announce_date}', action='{self.deal_action}')>"
