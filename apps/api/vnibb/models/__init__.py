"""
Models module - SQLAlchemy ORM models for VNIBB database.

Complete database schema for Vietnam stock market data:
- Stock & prices
- Company profiles & ownership
- Financial statements & ratios
- News, events & dividends
- Trading data & order book
- Market sectors & performance
- Technical indicators (new)
- Market news aggregation (new)
"""

from vnibb.models.stock import Stock, StockPrice, StockIndex
from vnibb.models.financials import IncomeStatement, BalanceSheet, CashFlow
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models.company import Company, Shareholder, Officer
from vnibb.models.dashboard import UserDashboard, DashboardWidget

# Existing models
from vnibb.models.news import CompanyNews, CompanyEvent, Dividend, InsiderDeal
from vnibb.models.trading import (
    IntradayTrade,
    OrderbookSnapshot,
    ForeignTrading,
    FinancialRatio,
    OrderFlowDaily,
)
from vnibb.models.derivatives import DerivativePrice
from vnibb.models.market import MarketSector, SectorPerformance, Subsidiary
from vnibb.models.app_kv import AppKeyValue

# New models for vnstock premium integration
from vnibb.models.technical_indicator import TechnicalIndicator
from vnibb.models.market_news import MarketNews

# Alert system models (new)
from vnibb.models.alerts import BlockTrade, InsiderAlert, AlertSettings

# Sync tracking model
from vnibb.models.sync_status import SyncStatus

__all__ = [
    # Stock
    "Stock",
    "StockPrice",
    "StockIndex",
    # Financials
    "IncomeStatement",
    "BalanceSheet",
    "CashFlow",
    # Screener
    "ScreenerSnapshot",
    # Company
    "Company",
    "Shareholder",
    "Officer",
    # Dashboard
    "UserDashboard",
    "DashboardWidget",
    # News & Events
    "CompanyNews",
    "CompanyEvent",
    "Dividend",
    "InsiderDeal",
    # Trading
    "IntradayTrade",
    "OrderbookSnapshot",
    "ForeignTrading",
    "FinancialRatio",
    "OrderFlowDaily",
    # Market
    "MarketSector",
    "SectorPerformance",
    "Subsidiary",
    # Technical Analysis (new)
    "TechnicalIndicator",
    # Market News Aggregation (new)
    "MarketNews",
    "DerivativePrice",
    "DerivativePrice",
    # Alert System (new)
    "BlockTrade",
    "InsiderAlert",
    "AlertSettings",
    "AppKeyValue",
    # Sync Tracking
    "SyncStatus",
]


