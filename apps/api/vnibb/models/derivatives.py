"""
Derivatives ORM Models

Stores derivatives/futures price history.
"""

from datetime import date, datetime
from typing import Optional

from sqlalchemy import String, Float, Date, DateTime, BigInteger, Index, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from vnibb.core.database import Base


class DerivativePrice(Base):
    """
    Daily derivatives/futures price data.
    """

    __tablename__ = "derivative_prices"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)

    symbol: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    trade_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)

    open: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    high: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    low: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    close: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    volume: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    open_interest: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)

    interval: Mapped[str] = mapped_column(String(5), default="1D", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("symbol", "trade_date", "interval", name="uq_derivative_symbol_date_interval"),
        Index("ix_derivative_symbol_date", "symbol", "trade_date"),
    )

    def __repr__(self) -> str:
        return f"<DerivativePrice(symbol='{self.symbol}', date='{self.trade_date}')>"
