# VnStock Library - Comprehensive API Documentation

> **Official Documentation**: [vnstocks.com/docs](https://vnstocks.com/docs)
> **GitHub**: [github.com/thinh-vu/vnstock](https://github.com/thinh-vu/vnstock)
> **Version**: 3.5.0+ (KBS default data source, TCBS removed)

Please check context7 mcp for detail documentation about vnstock library.

This document provides a complete reference for all vnstock library functions and how to use them effectively without violating rate limits.

---

## Table of Contents

1. [Installation & Setup](#installation--setup)
2. [Data Sources](#data-sources)
3. [Proxy Support (3.3.1+)](#proxy-support)
4. [Listing API](#listing-api)
5. [Company Information API](#company-information-api)
6. [Price History API](#price-history-api)
7. [Financial Statements API](#financial-statements-api)
8. [Stock Screener API](#stock-screener-api)
9. [Trading Board API](#trading-board-api)
10. [Fund API](#fund-api)
11. [Rate Limit Guidelines](#rate-limit-guidelines)
12. [Best Practices](#best-practices)

---

## Installation & Setup

```bash
pip install -U vnstock
# OR for specific vnstock3 version:
# pip install vnstock3
```

### Basic Import Pattern
```python
from vnstock import Vnstock, Listing, Company, Finance, Trading
```

---

## Proxy Support (3.3.1+)

VnStock 3.3.1 includes automatic proxy support to avoid IP blocking:

```python
from vnstock.core.utils.proxy_manager import ProxyManager

# Initialize proxy manager
proxy_manager = ProxyManager(timeout=15)

# Fetch available proxies
proxies = proxy_manager.fetch_proxies(limit=10)
print(f"Got {len(proxies)} proxies")

# Get best working proxy
best_proxy = proxy_manager.get_best_proxy()
```

> **Note**: Proxy is useful when accessing from cloud environments (Google Colab, Kaggle) or when experiencing IP blocks.

---

## Data Sources

VnStock supports multiple data sources:

| Source | Description | Recommended For |
|--------|-------------|-----------------|
| **KBS** | KBS Securities (v3.5.0+ default) | All operations (default) |
| **VCI** | VNDirect data | Price history, financial statements, company overview |
| **DNSE** | DNSE data source | Price/intraday alternatives and redundancy |

> **v3.5.0 Note**: KBS is the default source. `TCBS` was removed upstream, so source selection should be limited to `KBS`, `VCI`, and `DNSE`. The `Vnstock` class remains available but specific classes (`Listing`, `Company`, `Finance`) are preferred.

```python
# KBS source (v3.5.0+ default)
stock = Vnstock().stock(symbol='VCI', source='KBS')

# VCI source (legacy, still works)
stock = Vnstock().stock(symbol='VCI', source='VCI')

# Using specific classes (recommended in v3.5.0+)
from vnstock import Listing, Company, Finance
listing = Listing(source='KBS')  # or just Listing() for default
```

---

## Listing API

Get lists of all stocks, indices, and securities.

### List All Symbols
```python
from vnstock import Listing
listing = Listing()  # Uses KBS by default in v3.5.0+

# Get all stock symbols with company names
df = listing.all_symbols()
# Returns: ticker, organ_name
# ~1,600 stocks
```

### Symbols by Exchange
```python
# Filter by exchange
df = listing.symbols_by_exchange(exchange='HOSE')  # or 'HNX', 'UPCOM'
```

### Symbols by Industry (ICB)
```python
# Get stocks by industry classification
df = listing.symbols_by_group(group='VN30')  # VN30, VN100, etc.

# Get stocks by ICB code
df = listing.symbols_by_industries(icb='banking')
```

### Market Indices
```python
# List all market indices
df = listing.all_indices()

# Indices by group
df = listing.indices_by_group(group='HOSE')
```

---

## Company Information API

### Initialize Company Module
```python
from vnstock import Company

# Using VCI source
company = Company(symbol='ACB', source='VCI')

# Using KBS source (default)
company = Company(symbol='ACB', source='KBS')
```

### Company Overview
```python
df = company.overview()
# Returns: symbol, id, issue_share, history, company_profile,
#          icb_name2 (sector), icb_name3 (industry), icb_name4 (sub-industry),
#          charter_capital
```

### Major Shareholders
```python
df = company.shareholders()
# Returns: id, share_holder, quantity, share_own_percent, update_date
```

### Officers & Management
```python
df = company.officers(filter_by='working')
# filter_by options: 'working' (default), 'resigned', 'all'
# Returns: officer_name, officer_position, officer_own_percent, quantity
```

### Subsidiaries
```python
df = company.subsidiaries()
# Returns: company information of subsidiaries
```

### Dividend History
```python
company = Company(symbol='VCB', source='VCI')
df = company.dividends()
# Returns: exercise_date, cash_year, cash_dividend_percentage, issue_method
```

### Company Events
```python
df = company.events()
# Returns: corporate events, announcements
```

### Company News
```python
df = company.news()
# Returns: news articles related to the company
```

### Insider Trading
```python
company = Company(symbol='VCB', source='VCI')
df = company.insider_trading()
# Returns: insider buy/sell transactions
```

---

## Price History API

### Initialize Quote Module
```python
from vnstock import Vnstock
stock = Vnstock().stock(symbol='VCI', source='VCI')
quote = stock.quote
```

### Historical OHLCV Data
```python
df = quote.history(
    start='2020-01-01',
    end='2024-12-31',
    interval='1D'  # Default daily
)
# Returns: time, open, high, low, close, volume
```

### Interval Options
| Interval | Description |
|----------|-------------|
| `1m` | 1 minute |
| `5m` | 5 minutes |
| `15m` | 15 minutes |
| `30m` | 30 minutes |
| `1H` | 1 hour |
| `1D` | 1 day (default) |
| `1W` | 1 week |
| `1M` | 1 month |

### Intraday Order Matching Data
```python
df = quote.intraday(page_size=10000)
# Returns: time, price, volume, match_type (Buy/Sell/ATO/ATC), id
# Real-time order matching during market hours (9:15 - 14:45)
```

### Price Board (Multiple Symbols)
```python
df = quote.price_board(symbols_list=['VCB', 'ACB', 'TCB', 'BID'])
# Returns: bid/ask data for multiple symbols simultaneously
```

---

## Financial Statements API

### Initialize Finance Module
```python
from vnstock import Finance
finance = Finance(symbol='VCI', source='VCI')
```

### Income Statement
```python
df = finance.income_statement(
    period='year',  # or 'quarter'
    lang='en',      # or 'vi'
    dropna=False    # Remove empty rows
)
# Returns: revenue, gross_profit, operating_profit, net_profit, EPS, etc.
# 60 columns of detailed P&L data
```

### Balance Sheet
```python
df = finance.balance_sheet(
    period='year',
    lang='en'
)
# Returns: total_assets, liabilities, equity, cash, debt, etc.
```

### Cash Flow Statement
```python
df = finance.cash_flow(
    period='year',
    lang='en'
)
# Returns: operating_cash_flow, investing_cash_flow, financing_cash_flow
```

### Financial Ratios
```python
df = finance.ratio(
    period='year',
    lang='en'
)
# Returns: PE, PB, ROE, ROA, EPS, dividend_yield, debt_equity, etc.
```

---

## Stock Screener API

### Status in vnstock 3.5.0+

`Screener().stock()` in the OSS path is no longer a reliable source for the historical 84-column dataset after TCBS removal.

Recommended paths in VNIBB:

1. Use VNIBB backend screener endpoints (cached and normalized).
2. Install premium VNStock modules for full screener parity when needed:
   - `vnstock_data`
   - `vnstock_ta`
   - `vnstock_pipeline`
   - `vnstock_news`
   - `vnii`

### Runtime guidance

- Keep `VNSTOCK_SOURCE` on `KBS` (recommended), `VCI`, or `DNSE`.
- Do not configure `TCBS`; it is removed upstream in vnstock 3.5.0+.
- For migration/backfill workloads, run the Appwrite migration orchestrator after source sync completion.

---

## Trading Board API

Real-time price board data with bid/ask information.

### Basic Usage
```python
from vnstock import Trading

trading = Trading(symbol='VN30F1M')  # Any symbol to initialize
df = trading.price_board(symbols_list=['VCB', 'ACB', 'TCB', 'BID'])
```

### Response Structure (36 Columns)

#### Listing Info
- `symbol`, `ceiling`, `floor`, `ref_price`, `stock_type`, `exchange`
- `listed_share`, `organ_name`, `prior_close_price`

#### Match Info
- `match_price`, `match_vol`, `accumulated_volume`, `accumulated_value`
- `avg_match_price`, `highest`, `lowest`
- `foreign_buy_volume`, `foreign_sell_volume`, `current_room`, `total_room`

#### Bid/Ask Data
- `bid_1_price`, `bid_1_volume`, `bid_2_price`, `bid_2_volume`, `bid_3_price`, `bid_3_volume`
- `ask_1_price`, `ask_1_volume`, `ask_2_price`, `ask_2_volume`, `ask_3_price`, `ask_3_volume`

435: ---
436: 
437: ## Fund API
438: 
439: Access open-end fund data (fmarket.vn source).
440: 
441: ### Initialize Fund Module
442: ```python
443: from vnstock import Fund
444: fund = Fund()
445: ```
446: 
447: ### List All Open-End Funds
448: ```python
449: df = fund.listing()
450: # Returns dataframe of all available funds
451: ```
452: 
453: ### Filter Funds by Symbol
454: ```python
455: df = fund.filter('DC')
456: # Returns funds containing 'DC' in symbol
457: ```
458: 
459: ### Top Holdings
460: ```python
461: df = fund.details.top_holding('SSISCA')
462: # Returns top assets held by the fund
463: ```
464: 
465: ### NAV Report
466: ```python
467: df = fund.details.nav_report('SSISCA')
468: # Returns Net Asset Value history
469: ```
470: 
471: ---

## Rate Limit Guidelines

> ⚠️ **CRITICAL**: VnStock APIs have implicit rate limits. Exceeding them will result in IP blocking or temporary bans.

### Recommended Rate Limits

| Operation | Max Calls/Min | Recommended Delay |
|-----------|--------------|-------------------|
| Listing API | 10 | 6 seconds |
| Company Overview | 20 | 3 seconds |
| Price History | 30 | 2 seconds |
| Financial Statements | 15 | 4 seconds |
| Premium screener backfill | 2 | 30 seconds |
| Trading Board | 20 | 3 seconds |
| Intraday Data | 10 | 6 seconds |

### Rate Limiting Implementation

```python
import asyncio

class RateLimiter:
    def __init__(self, calls_per_minute: int):
        self.delay = 60.0 / calls_per_minute
        self.last_call = 0
    
    async def acquire(self):
        now = time.time()
        wait_time = self.delay - (now - self.last_call)
        if wait_time > 0:
            await asyncio.sleep(wait_time)
        self.last_call = time.time()
```

### Circuit Breaker Pattern

When consecutive failures occur, stop making API calls:

```python
class CircuitBreaker:
    def __init__(self, failure_threshold=5, recovery_timeout=300):
        self.failures = 0
        self.threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.last_failure = None
    
    @property
    def is_open(self):
        if self.failures >= self.threshold:
            if time.time() - self.last_failure > self.recovery_timeout:
                self.failures = 0  # Try again
                return False
            return True
        return False
```

---

## Best Practices

### 1. Use VNIBB cached screener endpoints for bulk data
```python
# ✅ GOOD: Consume normalized backend screener payloads
rows = await fetch_backend_screener(limit=1700)

# ❌ BAD: 1,600 per-symbol calls
for symbol in all_symbols:
    stock.quote.history(...)  # Don't do this!
```

### 2. Batch Price History by Date Range
```python
# ✅ GOOD: Collect all needed dates in one call
df = quote.history(start='2020-01-01', end='2024-12-31')

# ❌ BAD: Multiple calls for same symbol
for year in range(2020, 2025):
    quote.history(start=f'{year}-01-01', end=f'{year}-12-31')
```

### 3. Collect Financial Data Infrequently
```python
# Financial reports only update quarterly
# Collect once per week at most
if days_since_last_update >= 7:
    finance.income_statement(period='quarter')
```

### 4. Use Market Hours Awareness
```python
def is_market_hours():
    now = datetime.now()
    if now.weekday() >= 5:  # Weekend
        return False
    market_open = now.replace(hour=9, minute=0)
    market_close = now.replace(hour=15, minute=0)
    return market_open <= now <= market_close

# Only collect intraday during market hours
if is_market_hours():
    quote.intraday(page_size=10000)
```

### 5. Priority-Based Updates

```python
# Priority Queue for Updates
VN30_INTERVAL = 5 * 60      # 5 minutes (high priority)
TOP100_INTERVAL = 15 * 60   # 15 minutes (medium)
ALL_STOCKS_INTERVAL = 60 * 60  # 1 hour (low priority)

# Backend screener cache refresh
SCREENER_CACHE_INTERVAL = 30 * 60  # 30 minutes
```

### 6. Store and Reuse Data
```python
# Store listings locally - they rarely change
# Update once per day at market open
if last_listing_update.date() < datetime.now().date():
    listings = listing.all_symbols()
    save_to_database(listings)
```

---

## API Call Efficiency Matrix

| Data Type | API Method | Efficiency | Update Frequency |
|-----------|------------|------------|------------------|
| Bulk screener dataset | Backend screener cache / premium pipeline | ⭐⭐⭐⭐ | Every 30 min |
| Stock Listings | `Listing().all_symbols()` | ⭐⭐⭐⭐⭐ | Daily |
| Price History | `quote.history()` | ⭐⭐⭐ | Per symbol |
| Company Overview | `company.overview()` | ⭐⭐⭐ | Weekly |
| Financial Statements | `finance.*_statement()` | ⭐⭐ | Quarterly |
| Intraday Data | `quote.intraday()` | ⭐⭐ | Market hours only |
| Real-time Prices | `trading.price_board()` | ⭐⭐⭐⭐ | Batch multiple |

---

## Summary: Optimal Data Collection Strategy

```
┌─────────────────────────────────────────────────────────────────┐
│                 RECOMMENDED UPDATE SCHEDULE                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ⏰ DAILY (Market Open):                                       │
│      • listing.all_symbols() → Update stock list               │
│                                                                 │
│   ⏰ EVERY 30 MIN (Market Hours):                               │
│      • Refresh backend screener cache / premium pipeline        │
│                                                                 │
│   ⏰ EVERY 5 MIN (VN30 Only):                                   │
│      • trading.price_board(VN30_list) → Real-time prices       │
│                                                                 │
│   ⏰ WEEKLY:                                                    │
│      • company.overview() → Company info updates                │
│      • company.dividends() → Dividend history                   │
│                                                                 │
│   ⏰ QUARTERLY:                                                 │
│      • finance.income_statement() → P&L data                    │
│      • finance.balance_sheet() → Balance data                   │
│      • finance.cash_flow() → Cash flow data                     │
│                                                                 │
│   ⏰ MONTHLY:                                                   │
│      • Batch price history for all stocks                       │
│      • company.shareholders() → Ownership updates               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Error Handling

```python
from vnstock import VnstockError

try:
    df = stock.quote.history(start='2024-01-01', end='2024-12-31')
except VnstockError as e:
    logger.error(f"VnStock API error: {e}")
    # Implement backoff
    await asyncio.sleep(60)
except Exception as e:
    logger.error(f"Unexpected error: {e}")
    # Trigger circuit breaker
    circuit_breaker.record_failure()
```

---

*Documentation generated from vnstocks.com/docs - Last updated: 2026-03-14 - Updated for v3.5.0+*
