"""
Cache Constants - Unified TTL values for VNIBB data caching.

This module consolidates all TTL (Time To Live) constants used across
the caching system, including Redis cache TTLs and database cache TTLs.
"""

from typing import Dict

# =============================================================================
# Redis Cache TTLs (in seconds)
# =============================================================================

# Market data - short TTL for real-time data
REDIS_TTL_MARKET_INDICES = 60  # 1 minute
REDIS_TTL_WORLD_INDICES = 300  # 5 minutes
REDIS_TTL_MARKET_HEATMAP = 120  # 2 minutes
REDIS_TTL_MICROSTRUCTURE = 60  # 1 minute

# Quote/pricing data - very short TTL
REDIS_TTL_QUOTE = 30  # 30 seconds

# Financial data - long TTL (stable data)
REDIS_TTL_RATIOS = 86400  # 24 hours
REDIS_TTL_RATIOS_HISTORY = 86400  # 24 hours
REDIS_TTL_FINANCIALS = 86400  # 24 hours
REDIS_TTL_INCOME_STATEMENT = 86400  # 24 hours
REDIS_TTL_BALANCE_SHEET = 86400  # 24 hours
REDIS_TTL_CASH_FLOW = 86400  # 24 hours

# News data - medium TTL
REDIS_TTL_NEWS = 1800  # 30 minutes
REDIS_TTL_COMPANY_NEWS_V26 = 1800  # 30 minutes
REDIS_TTL_COMPANY_EVENTS_V26 = 1800  # 30 minutes

# Profile data - very long TTL (static data)
REDIS_TTL_PROFILE = 604800  # 7 days

# Screener data - medium TTL
REDIS_TTL_SCREENER = 3600  # 1 hour

# Redis cache TTLs dictionary (for dynamic lookup by key prefix)
REDIS_CACHE_TTLS: Dict[str, int] = {
    "screener": REDIS_TTL_SCREENER,
    "quote": REDIS_TTL_QUOTE,
    "market_indices": REDIS_TTL_MARKET_INDICES,
    "world_indices": REDIS_TTL_WORLD_INDICES,
    "market_heatmap": REDIS_TTL_MARKET_HEATMAP,
    "microstructure": REDIS_TTL_MICROSTRUCTURE,
    "ratios": REDIS_TTL_RATIOS,
    "ratios_history": REDIS_TTL_RATIOS_HISTORY,
    "financials": REDIS_TTL_FINANCIALS,
    "income_statement": REDIS_TTL_INCOME_STATEMENT,
    "balance_sheet": REDIS_TTL_BALANCE_SHEET,
    "cash_flow": REDIS_TTL_CASH_FLOW,
    "news": REDIS_TTL_NEWS,
    "company_news_v26": REDIS_TTL_COMPANY_NEWS_V26,
    "company_events_v26": REDIS_TTL_COMPANY_EVENTS_V26,
    "profile": REDIS_TTL_PROFILE,
}

# Redis cache key prefixes (short versions for key length optimization)
REDIS_CACHE_PREFIX_SHORT: Dict[str, str] = {
    "screener": "sc",
    "quote": "q",
    "ratios": "r",
    "ratios_history": "rh",
    "financials": "f",
    "income_statement": "is",
    "balance_sheet": "bs",
    "cash_flow": "cf",
    "news": "n",
    "company_news_v26": "cn",
    "company_events_v26": "ce",
    "profile": "p",
    "market_indices": "mi",
    "world_indices": "wi",
    "market_heatmap": "mh",
    "microstructure": "ms",
}


# =============================================================================
# Database Cache TTLs (in minutes)
# =============================================================================

# Real-time data - very short TTL
DB_TTL_PRICE_BOARD = 1  # 1 minute
DB_TTL_PRICE_DEPTH = 0.5  # 30 seconds
DB_TTL_INTRADAY = 1  # 1 minute

# Market data - short TTL
DB_TTL_SCREENER = 60  # 60 minutes
DB_TTL_TRADING_STATS = 60  # 60 minutes
DB_TTL_FOREIGN_TRADING = 60  # 60 minutes

# Company data - medium TTL
DB_TTL_PROFILE = 10080  # 7 days (in minutes)
DB_TTL_FINANCIAL_RATIOS = 1440  # 24 hours
DB_TTL_OFFICERS = 1440  # 24 hours
DB_TTL_SHAREHOLDERS = 1440  # 24 hours
DB_TTL_INSIDER_DEALS = 1440  # 24 hours

# Static data - long TTL
DB_TTL_LISTING = 1440  # 24 hours
DB_TTL_INDUSTRIES = 1440  # 24 hours
DB_TTL_DIVIDENDS = 1440  # 24 hours
DB_TTL_BALANCE_SHEET_DB = 1440  # 24 hours
DB_TTL_INCOME_STATEMENT_DB = 1440  # 24 hours
DB_TTL_CASH_FLOW_DB = 1440  # 24 hours

# Derivatives - short TTL
DB_TTL_DERIVATIVES = 5  # 5 minutes

# Database cache TTLs dictionary
DB_CACHE_TTLS: Dict[str, float] = {
    # Real-time data - very short TTL
    "price_board": DB_TTL_PRICE_BOARD,
    "price_depth": DB_TTL_PRICE_DEPTH,
    "intraday": DB_TTL_INTRADAY,
    # Market data - short TTL
    "screener": DB_TTL_SCREENER,
    "trading_stats": DB_TTL_TRADING_STATS,
    "foreign_trading": DB_TTL_FOREIGN_TRADING,
    # Company data - medium TTL
    "profile": DB_TTL_PROFILE,
    "financial_ratios": DB_TTL_FINANCIAL_RATIOS,
    "officers": DB_TTL_OFFICERS,
    "shareholders": DB_TTL_SHAREHOLDERS,
    "insider_deals": DB_TTL_INSIDER_DEALS,
    # Static data - long TTL
    "listing": DB_TTL_LISTING,
    "industries": DB_TTL_INDUSTRIES,
    "dividends": DB_TTL_DIVIDENDS,
    "balance_sheet": DB_TTL_BALANCE_SHEET_DB,
    "income_statement": DB_TTL_INCOME_STATEMENT_DB,
    "cash_flow": DB_TTL_CASH_FLOW_DB,
    # Derivatives
    "derivatives": DB_TTL_DERIVATIVES,
}


# =============================================================================
# Data Pipeline TTLs (in seconds)
# =============================================================================

PIPELINE_TTL_LISTING = 24 * 60 * 60  # 24 hours
PIPELINE_TTL_PROFILE = 7 * 24 * 60 * 60  # 7 days
PIPELINE_TTL_SCREENER = 6 * 60 * 60  # 6 hours
PIPELINE_TTL_PRICE_LATEST = 60 * 60  # 1 hour
PIPELINE_TTL_PRICE_RECENT = 6 * 60 * 60  # 6 hours
PIPELINE_TTL_FINANCIALS = 7 * 24 * 60 * 60  # 7 days
PIPELINE_TTL_FOREIGN_TRADING = 24 * 60 * 60  # 24 hours
PIPELINE_TTL_ORDER_FLOW = 24 * 60 * 60  # 24 hours
PIPELINE_TTL_INTRADAY = 60 * 60  # 1 hour
PIPELINE_TTL_ORDERBOOK = 10 * 60  # 10 minutes
PIPELINE_TTL_ORDERBOOK_DAILY = 24 * 60 * 60  # 24 hours
PIPELINE_TTL_BLOCK_TRADES = 24 * 60 * 60  # 24 hours
PIPELINE_TTL_DERIVATIVES_LATEST = 6 * 60 * 60  # 6 hours
PIPELINE_TTL_DERIVATIVES_RECENT = 24 * 60 * 60  # 24 hours

# Data Pipeline TTLs dictionary
PIPELINE_CACHE_TTLS: Dict[str, int] = {
    "listing": PIPELINE_TTL_LISTING,
    "profile": PIPELINE_TTL_PROFILE,
    "screener": PIPELINE_TTL_SCREENER,
    "price_latest": PIPELINE_TTL_PRICE_LATEST,
    "price_recent": PIPELINE_TTL_PRICE_RECENT,
    "financials": PIPELINE_TTL_FINANCIALS,
    "foreign_trading": PIPELINE_TTL_FOREIGN_TRADING,
    "order_flow": PIPELINE_TTL_ORDER_FLOW,
    "intraday": PIPELINE_TTL_INTRADAY,
    "orderbook": PIPELINE_TTL_ORDERBOOK,
    "orderbook_daily": PIPELINE_TTL_ORDERBOOK_DAILY,
    "block_trades": PIPELINE_TTL_BLOCK_TRADES,
    "derivatives_latest": PIPELINE_TTL_DERIVATIVES_LATEST,
    "derivatives_recent": PIPELINE_TTL_DERIVATIVES_RECENT,
}


# =============================================================================
# Legacy constants for backward compatibility
# =============================================================================

# Database cache legacy constants
SCREENER_TTL_MINUTES = DB_TTL_SCREENER
PROFILE_TTL_HOURS = DB_TTL_PROFILE / 60  # Convert to hours
MAX_STALE_DAYS = 7  # Maximum days before treating screener as stale

# Pipeline constants
RECENT_PRICE_DAYS = 60
RECENT_DERIVATIVE_DAYS = 60
