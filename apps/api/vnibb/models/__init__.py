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

# Alert system models (new)
from vnibb.models.alerts import AlertSettings, BlockTrade, InsiderAlert
from vnibb.models.app_kv import AppKeyValue
from vnibb.models.company import Company, Officer, Shareholder
from vnibb.models.dashboard import DashboardWidget, UserDashboard
from vnibb.models.data_quality import DataQualityBreachState, DataQualityRun
from vnibb.models.derivatives import DerivativePrice
from vnibb.models.financials import BalanceSheet, CashFlow, IncomeStatement
from vnibb.models.market import MarketSector, SectorPerformance, Subsidiary
from vnibb.models.market_news import MarketNews

# Existing models
from vnibb.models.news import CompanyEvent, CompanyNews, Dividend, InsiderDeal
from vnibb.models.prediction_market import PredictionMarket
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models.stock import Stock, StockIndex, StockPrice

# Sync tracking model
from vnibb.models.sync_status import SyncStatus

# New models for vnstock premium integration
from vnibb.models.technical_indicator import TechnicalIndicator
from vnibb.models.trading import (
    FinancialRatio,
    ForeignTrading,
    IntradayTrade,
    OrderbookSnapshot,
    OrderFlowDaily,
)

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
    "PredictionMarket",
    "DerivativePrice",
    "DerivativePrice",
    # Alert System (new)
    "BlockTrade",
    "InsiderAlert",
    "AlertSettings",
    "AppKeyValue",
    "DataQualityRun",
    "DataQualityBreachState",
    # Sync Tracking
    "SyncStatus",
]


