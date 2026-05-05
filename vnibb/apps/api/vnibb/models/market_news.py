"""
Market News ORM Model

Stores general market news from multiple Vietnamese sources.
Aggregated using vnstock_news or fallback RSS crawling.
Enhanced with AI sentiment analysis.
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import (
    String, Text, DateTime, Index, Boolean, Float, Integer
)
from sqlalchemy.orm import Mapped, mapped_column

from vnibb.core.database import Base


class MarketNews(Base):
    """
    General market news articles with AI sentiment analysis.
    
    Aggregated from multiple sources:
    - CafeF, VnExpress, VietStock, Tuoi Tre, VnEconomy, etc.
    
    Used for market sentiment analysis and news feed widgets.
    """
    __tablename__ = "market_news"
    
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    
    # Content
    title: Mapped[str] = mapped_column(Text, nullable=False)
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    # Source metadata
    source: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    url: Mapped[Optional[str]] = mapped_column(Text, nullable=True, unique=True)
    author: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    image_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    # Categorization
    category: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    tags: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # Comma-separated tags
    
    # Related stocks (if mentioned)
    related_symbols: Mapped[Optional[str]] = mapped_column(
        String(200), nullable=True, index=True
    )  # Comma-separated symbols
    sectors: Mapped[Optional[str]] = mapped_column(
        String(200), nullable=True
    )  # Comma-separated sectors
    
    # AI Sentiment Analysis
    sentiment: Mapped[Optional[str]] = mapped_column(
        String(20), nullable=True
    )  # bullish, neutral, bearish
    sentiment_score: Mapped[Optional[float]] = mapped_column(
        Float, nullable=True
    )  # Confidence 0-100
    ai_summary: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True
    )  # AI-generated 2-3 sentence summary
    
    # User engagement
    read_count: Mapped[int] = mapped_column(Integer, default=0)
    bookmark_count: Mapped[int] = mapped_column(Integer, default=0)
    
    # Timestamps
    published_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, index=True)
    crawled_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    
    # Processing status
    is_processed: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    
    __table_args__ = (
        Index("ix_market_news_source_date", "source", "published_date"),
        Index("ix_market_news_published", "published_date"),
        Index("ix_market_news_sentiment", "sentiment", "published_date"),
    )
    
    def __repr__(self):
        return f"<MarketNews {self.source}: {self.title[:30]}...>"
    
    def to_dict(self):
        """Convert to dictionary for API response."""
        return {
            "id": self.id,
            "title": self.title,
            "summary": self.summary,
            "content": self.content,
            "source": self.source,
            "url": self.url,
            "author": self.author,
            "image_url": self.image_url,
            "category": self.category,
            "published_date": self.published_date.isoformat() if self.published_date else None,
            "related_symbols": self.related_symbols.split(",") if self.related_symbols else [],
            "sectors": self.sectors.split(",") if self.sectors else [],
            "sentiment": self.sentiment,
            "sentiment_score": self.sentiment_score,
            "ai_summary": self.ai_summary,
            "read_count": self.read_count,
            "bookmarked": False,  # Will be populated from user data later
        }
