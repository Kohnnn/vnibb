"""
Financial Statement ORM Models

Models for:
- IncomeStatement: Revenue, profit, expenses
- BalanceSheet: Assets, liabilities, equity
- CashFlow: Operating, investing, financing flows
"""

from datetime import date, datetime
from typing import Optional

from sqlalchemy import (
    Column, String, Integer, Float, Date, DateTime,
    ForeignKey, Index, UniqueConstraint, BigInteger, JSON, Text
)
from sqlalchemy.orm import relationship, Mapped, mapped_column

from vnibb.core.database import Base


class IncomeStatement(Base):
    """
    Income Statement (Profit & Loss) data.
    
    Quarterly and annual income statements for all stocks.
    """
    __tablename__ = "income_statements"
    
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    
    # Stock reference
    symbol: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    
    # Period
    period: Mapped[str] = mapped_column(String(10), nullable=False)  # 2024, Q1-2024
    period_type: Mapped[str] = mapped_column(String(10), default="year", nullable=False)  # year, quarter
    fiscal_year: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    fiscal_quarter: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # 1-4 for quarterly
    
    # Revenue
    revenue: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    cost_of_revenue: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    gross_profit: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    # Operating
    operating_expenses: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    operating_income: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    # Non-operating
    interest_expense: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    other_income: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    # Profit
    income_before_tax: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    income_tax: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    net_income: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    # Per share
    eps: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    eps_diluted: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    # EBITDA
    ebitda: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    # Raw data (for additional fields)
    raw_data: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    
    # Metadata
    source: Mapped[str] = mapped_column(String(20), default="vnstock", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    __table_args__ = (
        UniqueConstraint("symbol", "period", "period_type", name="uq_income_stmt_symbol_period"),
        Index("ix_income_stmt_symbol_year", "symbol", "fiscal_year"),
        Index("ix_income_stmt_perf", "symbol", "net_income"),
    )



class BalanceSheet(Base):
    """
    Balance Sheet data.
    
    Assets, liabilities, and equity for all stocks.
    """
    __tablename__ = "balance_sheets"
    
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    
    # Stock reference
    symbol: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    
    # Period
    period: Mapped[str] = mapped_column(String(10), nullable=False)
    period_type: Mapped[str] = mapped_column(String(10), default="year", nullable=False)
    fiscal_year: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    fiscal_quarter: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    
    # Assets
    total_assets: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    current_assets: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    cash_and_equivalents: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    short_term_investments: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    accounts_receivable: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    inventory: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    non_current_assets: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    fixed_assets: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    # Liabilities
    total_liabilities: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    current_liabilities: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    accounts_payable: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    short_term_debt: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    non_current_liabilities: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    long_term_debt: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    # Equity
    total_equity: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    retained_earnings: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    # Per share
    book_value_per_share: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    # Raw data
    raw_data: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    
    # Metadata
    source: Mapped[str] = mapped_column(String(20), default="vnstock", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    __table_args__ = (
        UniqueConstraint("symbol", "period", "period_type", name="uq_balance_sheet_symbol_period"),
        Index("ix_balance_sheet_symbol_year", "symbol", "fiscal_year"),
    )


class CashFlow(Base):
    """
    Cash Flow Statement data.
    
    Operating, investing, and financing cash flows.
    """
    __tablename__ = "cash_flows"
    
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    
    # Stock reference
    symbol: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    
    # Period
    period: Mapped[str] = mapped_column(String(10), nullable=False)
    period_type: Mapped[str] = mapped_column(String(10), default="year", nullable=False)
    fiscal_year: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    fiscal_quarter: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    
    # Operating activities
    operating_cash_flow: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    depreciation: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    # Investing activities
    investing_cash_flow: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    capital_expenditure: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    # Financing activities
    financing_cash_flow: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    dividends_paid: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    debt_repayment: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    # Net change
    net_change_in_cash: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    free_cash_flow: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    # Raw data
    raw_data: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    
    # Metadata
    source: Mapped[str] = mapped_column(String(20), default="vnstock", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    __table_args__ = (
        UniqueConstraint("symbol", "period", "period_type", name="uq_cash_flow_symbol_period"),
        Index("ix_cash_flow_symbol_year", "symbol", "fiscal_year"),
    )
