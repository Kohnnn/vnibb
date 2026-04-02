# vnstock Library - VNIBB Reference Notes

> **Official documentation (stable/public)**: [vnstocks.com/docs](https://vnstocks.com/docs)
> **Official version history**: [vnstocks.com/docs/tai-lieu/lich-su-phien-ban](https://vnstocks.com/docs/tai-lieu/lich-su-phien-ban)
> **Upstream repo**: [github.com/thinh-vu/vnstock](https://github.com/thinh-vu/vnstock)
> **MCP/CLI companion**: [github.com/mrgoonie/vnstock-agent](https://github.com/mrgoonie/vnstock-agent)
> **VNIBB runtime target**: `vnstock>=3.5.0,<3.6` in `apps/api/pyproject.toml`

This document is a VNIBB-facing reference, not the canonical upstream manual. It is audited against the public docs site, the official version history, the upstream GitHub README/CHANGELOG, and the `vnstock-agent` README.

When those sources disagree, use this order of precedence:
- `vnstocks.com/docs` and the official version-history page for stable public behavior
- GitHub `main` for newer runtime changes that may not be mirrored on the docs site yet
- VNIBB config and `pyproject.toml` for local integration assumptions

Context7 is still useful for deeper API lookup, but it should be treated as a supporting source rather than the primary source of truth.

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
# Legacy package alias kept only for old 3.1.0-era installs:
# pip install vnstock3
# GitHub main / unreleased runtime line used by VNIBB:
# pip install git+https://github.com/thinh-vu/vnstock.git
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

vnstock source behavior differs slightly across the audited sources:

| Source | Upstream status | Recommended use in VNIBB |
|--------|-----------------|---------------------------|
| **KBS** | Public docs/README use it as the default from `3.4.0` onward | Primary/default source |
| **VCI** | Still supported | Fallback and parity with `vnstock-agent` default config |
| **DNSE** | Still supported | Quote/intraday redundancy |
| **TCBS** | Removed from GitHub `main` changelog on `2026-03-05` | Do not configure |

Notes:
- The official docs site currently documents stable releases through `v3.4.2` (`2026-02-01`).
- GitHub `main` includes later March 2026 changes, including TCBS removal, that VNIBB follows locally.
- `mrgoonie/vnstock-agent` defaults `VNSTOCK_SOURCE=VCI`; set `KBS` explicitly if you want parity with VNIBB.
- The `Vnstock` class remains available, but specific classes (`Listing`, `Company`, `Finance`, `Trading`) are preferred in VNIBB.

```python
# KBS source (VNIBB default / official docs first choice)
stock = Vnstock().stock(symbol='VCI', source='KBS')

# VCI source (explicit fallback / matches vnstock-agent default)
stock = Vnstock().stock(symbol='VCI', source='VCI')

# Using specific classes (preferred in VNIBB)
from vnstock import Listing, Company, Finance
listing = Listing(source='KBS')  # or just Listing() for default
```

---

## Listing API

Get lists of all stocks, indices, and securities.

### List All Symbols
```python
from vnstock import Listing
listing = Listing()  # Uses the current default source; VNIBB sets KBS explicitly for clarity

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
from vnstock import Trading

trading = Trading(source='KBS')
df = trading.price_board(symbols_list=['VCB', 'ACB', 'TCB', 'BID'])
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

### Current upstream status

The audited sources disagree slightly on screener messaging:
- The public docs/README still describe screener historically and mark it as temporarily unavailable.
- The GitHub `CHANGELOG.md` entry dated `2026-03-05` removes the TCBS-backed OSS screener path.
- `vnstock-agent` does not expose a screener tool or CLI command.

For VNIBB planning, treat the built-in OSS screener path as unavailable.

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
- Do not configure `TCBS`; it is removed in the newer upstream runtime line used by VNIBB.
- For migration/backfill workloads, run the Appwrite migration orchestrator after source sync completion.

---

## Trading Board API

Real-time price board data with bid/ask information.

### Basic Usage
```python
from vnstock import Trading

trading = Trading(source='KBS')
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

---

## Fund API

Access open-end fund data (fmarket.vn source).

### Initialize Fund Module
```python
from vnstock.explorer.fmarket.fund import Fund

fund = Fund()
```

### List All Open-End Funds
```python
df = fund.listing()
# Returns dataframe of all available funds
```

### Filter Funds by Symbol
```python
df = fund.filter('DC')
# Returns funds containing 'DC' in symbol
```

### Top Holdings
```python
df = fund.details.top_holding('SSISCA')
# Returns top assets held by the fund
```

### NAV Report
```python
df = fund.details.nav_report('SSISCA')
# Returns Net Asset Value history
```

---

## Rate Limit Guidelines

> ⚠️ **CRITICAL**: vnstock rate limits are tier-dependent. Exceeding them can still lead to throttling, degraded responses, or temporary bans.

### Upstream Tier Guidance

| Tier / Context | Guidance from audited sources |
|----------------|-------------------------------|
| Guest | ~20 requests/minute, no registration |
| Community | ~60 requests/minute, free registration |
| Sponsor | 3-5x the free tier according to the upstream README |
| VNIBB backend | Local env defaults reserve `500/min` main budget plus `50/min` reinforcement budget for premium/server-side workloads |

Notes:
- The `500/min` and `50/min` figures come from VNIBB's own env defaults, not from the public upstream docs.
- If you run ad-hoc scripts or use `vnstock-agent` locally, assume the lower public-tier limits unless you have sponsor access and a configured `VNSTOCK_API_KEY`.
- Batch endpoints such as `Trading.price_board()` and cached backend screener snapshots are preferred over many per-symbol calls.

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

*Audited on 2026-04-02 against `vnstocks.com/docs`, the official version-history page, `thinh-vu/vnstock` README/CHANGELOG, and `mrgoonie/vnstock-agent` README.*
