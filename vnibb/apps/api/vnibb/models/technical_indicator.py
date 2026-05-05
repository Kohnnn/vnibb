"""
Technical Indicator ORM Model

Stores calculated technical analysis indicators for stocks.
Updated daily from vnstock_ta or fallback calculations.
"""

from datetime import date, datetime
from typing import Optional

from sqlalchemy import (
    String, Float, Date, DateTime,
    Index, UniqueConstraint
)
from sqlalchemy.orm import Mapped, mapped_column

from vnibb.core.database import Base


class TechnicalIndicator(Base):
    """
    Calculated technical indicators.
    
    Stores daily calculated values from vnstock_ta.
    Used for chart overlays and trading signals.
    """
    __tablename__ = "technical_indicators"
    
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    symbol: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    calc_date: Mapped[date] = mapped_column(Date, nullable=False)
    
    # Moving Averages
    sma_20: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    sma_50: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    sma_200: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    ema_12: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    ema_26: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    # Momentum Indicators
    rsi_14: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    stoch_k: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    stoch_d: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    # MACD
    macd: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    macd_signal: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    macd_hist: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    # Bollinger Bands
    bb_upper: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    bb_middle: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    bb_lower: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    # Volume Indicators
    obv: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    vwap: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    # Volatility
    atr_14: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    # Metadata
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )
    
    __table_args__ = (
        UniqueConstraint("symbol", "calc_date", name="uq_technical_indicator_symbol_date"),
        Index("ix_ta_symbol_date", "symbol", "calc_date"),
    )
    
    def __repr__(self):
        return f"<TechnicalIndicator {self.symbol} {self.calc_date}>"
    
    def to_dict(self):
        """Convert to dictionary for API response."""
        return {
            "symbol": self.symbol,
            "date": self.calc_date.isoformat() if self.calc_date else None,
            "sma_20": self.sma_20,
            "sma_50": self.sma_50,
            "sma_200": self.sma_200,
            "ema_12": self.ema_12,
            "ema_26": self.ema_26,
            "rsi_14": self.rsi_14,
            "macd": self.macd,
            "macd_signal": self.macd_signal,
            "macd_hist": self.macd_hist,
            "bb_upper": self.bb_upper,
            "bb_middle": self.bb_middle,
            "bb_lower": self.bb_lower,
            "atr_14": self.atr_14,
        }
