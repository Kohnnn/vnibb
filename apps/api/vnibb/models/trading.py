"""
Trading Data ORM Models

Models for:
- IntradayTrade: Tick-by-tick trade data
- OrderbookSnapshot: Order book depth snapshots
- ForeignTrading: Foreign investor buy/sell data
- FinancialRatio: Key financial ratios
"""

from datetime import date, datetime
from typing import Optional

from sqlalchemy import (
    String,
    Integer,
    Float,
    Date,
    DateTime,
    Index,
    UniqueConstraint,
    BigInteger,
    JSON,
)
from sqlalchemy.orm import Mapped, mapped_column

from vnibb.core.database import Base


class IntradayTrade(Base):
    """
    Intraday tick-by-tick trade data.

    Stores real-time trade matching during market hours.
    Use for trade tape widgets and volume analysis.
    """

    __tablename__ = "intraday_trades"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)

    # Stock reference
    symbol: Mapped[str] = mapped_column(String(10), nullable=False, index=True)

    # Trade details
    trade_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    price: Mapped[float] = mapped_column(Float, nullable=False)
    volume: Mapped[int] = mapped_column(Integer, nullable=False)

    # Match type: Buy, Sell, ATO/ATC
    match_type: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)

    # Accumulated values
    accumulated_vol: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    accumulated_val: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Transaction ID from exchange
    transaction_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)

    # Metadata
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_intraday_symbol_time", "symbol", "trade_time"),
        Index("ix_intraday_time", "trade_time"),
    )

    def __repr__(self) -> str:
        return (
            f"<IntradayTrade(symbol='{self.symbol}', time='{self.trade_time}', price={self.price})>"
        )


class OrderbookSnapshot(Base):
    """
    Order book depth snapshots.

    Captures bid/ask prices and volumes at regular intervals.
    Used for orderbook visualization and analysis.
    """

    __tablename__ = "orderbook_snapshots"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)

    # Stock reference
    symbol: Mapped[str] = mapped_column(String(10), nullable=False, index=True)

    # Snapshot time
    snapshot_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)

    # Order book data (stored as JSON arrays)
    # Format: [{"price": 62300, "volume": 4900, "buy_volume": 4900, "sell_volume": 0}, ...]
    price_depth: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    # Individual bid/ask levels (denormalized for quick access)
    bid1_price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    bid1_volume: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    bid2_price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    bid2_volume: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    bid3_price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    bid3_volume: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)

    ask1_price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    ask1_volume: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    ask2_price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    ask2_volume: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    ask3_price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    ask3_volume: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)

    # Totals
    total_bid_volume: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    total_ask_volume: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)

    # Metadata
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (Index("ix_orderbook_symbol_time", "symbol", "snapshot_time"),)

    def __repr__(self) -> str:
        return f"<OrderbookSnapshot(symbol='{self.symbol}', time='{self.snapshot_time}')>"


class ForeignTrading(Base):
    """
    Foreign investor trading data.

    Daily foreign buy/sell volumes and net values.
    Key indicator for institutional sentiment.
    """

    __tablename__ = "foreign_trading"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)

    # Stock reference
    symbol: Mapped[str] = mapped_column(String(10), nullable=False, index=True)

    # Trade date
    trade_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)

    # Buy side
    buy_volume: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    buy_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Sell side
    sell_volume: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    sell_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Net
    net_volume: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    net_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Foreign room
    room_available: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    room_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Metadata
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    __table_args__ = (
        UniqueConstraint("symbol", "trade_date", name="uq_foreign_trading_symbol_date"),
        Index("ix_foreign_symbol_date", "symbol", "trade_date"),
    )

    def __repr__(self) -> str:
        return f"<ForeignTrading(symbol='{self.symbol}', date='{self.trade_date}', net={self.net_value})>"


class OrderFlowDaily(Base):
    """
    Daily order flow summary derived from intraday trades.
    """

    __tablename__ = "order_flow_daily"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)

    symbol: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    trade_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)

    buy_volume: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    sell_volume: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    buy_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    sell_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    net_volume: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    net_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    foreign_buy_volume: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    foreign_sell_volume: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    foreign_net_volume: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)

    proprietary_buy_volume: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    proprietary_sell_volume: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    proprietary_net_volume: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)

    big_order_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    block_trade_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    __table_args__ = (
        UniqueConstraint("symbol", "trade_date", name="uq_order_flow_symbol_date"),
        Index("ix_order_flow_symbol_date", "symbol", "trade_date"),
    )

    def __repr__(self) -> str:
        return f"<OrderFlowDaily(symbol='{self.symbol}', date='{self.trade_date}')>"


class FinancialRatio(Base):
    """
    Key financial ratios.

    Valuation, profitability, liquidity, and leverage ratios.
    Updated quarterly from vnstock finance.ratio() API.
    """

    __tablename__ = "financial_ratios"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)

    # Stock reference
    symbol: Mapped[str] = mapped_column(String(10), nullable=False, index=True)

    # Period
    period: Mapped[str] = mapped_column(String(10), nullable=False)  # 2024, Q1-2024
    period_type: Mapped[str] = mapped_column(String(10), default="year", nullable=False)
    fiscal_year: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    fiscal_quarter: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Valuation ratios
    pe_ratio: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    pb_ratio: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    ps_ratio: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    peg_ratio: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    ev_ebitda: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    ev_sales: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Profitability ratios
    roe: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # Return on Equity
    roa: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # Return on Assets
    roic: Mapped[Optional[float]] = mapped_column(
        Float, nullable=True
    )  # Return on Invested Capital
    gross_margin: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    operating_margin: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    net_margin: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Liquidity ratios
    current_ratio: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    quick_ratio: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    cash_ratio: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Leverage ratios
    debt_to_equity: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    debt_to_assets: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    interest_coverage: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Per share metrics
    eps: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    bvps: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # Book Value Per Share
    dps: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # Dividend Per Share

    # Growth metrics
    revenue_growth: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    earnings_growth: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Raw data
    raw_data: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    # Metadata
    source: Mapped[str] = mapped_column(String(20), default="vnstock", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    __table_args__ = (
        UniqueConstraint(
            "symbol", "period", "period_type", name="uq_financial_ratio_symbol_period"
        ),
        Index("ix_ratio_symbol_year", "symbol", "fiscal_year"),
    )

    def __repr__(self) -> str:
        return (
            f"<FinancialRatio(symbol='{self.symbol}', period='{self.period}', pe={self.pe_ratio})>"
        )
