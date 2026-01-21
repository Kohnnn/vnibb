# 24HMoney.vn Data Source Documentation

## Overview
**URL:** https://24hmoney.vn/  
**License:** robots.txt allows all (`User-agent: * Allow: /`)  
**Tech Stack:** Nuxt.js (Vue.js SSR framework)  
**Anti-Scrape:** Minimal - no captchas detected, some promotional popups  

## Key Characteristics
- Uses Nuxt.js with SSR hydration
- Much data embedded in `window.__NUXT__` JavaScript object
- Internal JSON APIs available for efficient scraping
- Good for buy/sell flow and sector analysis

---

## Available Data Sources

### 1. Real-Time Price Board
**URL:** `https://24hmoney.vn/bang-gia-chung-khoan`

**Description:** Comprehensive real-time stock prices with bid/ask data and foreign room.

**Data Available:**
- Current price and change
- Bid/Ask volumes
- Foreign room remaining
- Trading volume

**Note:** Heavily dynamic, requires JavaScript or API access.

---

### 2. Financial Reports per Stock
**URL Pattern:** `https://24hmoney.vn/stock/{SYMBOL}/financial-report`

**Description:** Full financial statements in both quarterly and annual formats.

**Table Structure:**
- Class: `financial-report-box-content`
- Units: Billion VND
- Columns: Time periods
- Rows: Financial metrics

**Available Statements:**
- Income Statement (Kết quả kinh doanh)
- Balance Sheet (Bảng cân đối kế toán)
- Cash Flow Statement (Lưu chuyển tiền tệ)

---

### 3. Financial Indicators per Stock
**URL Pattern:** `https://24hmoney.vn/stock/{SYMBOL}/financial-indicators`

**Metrics Available:**
- P/E, P/B, EPS
- ROE, ROA
- Profit margins
- Growth rates

---

### 4. Transaction History per Stock
**URL Pattern:** `https://24hmoney.vn/stock/{SYMBOL}/transactions`

**Description:** Detailed buy/sell flow data with active buying/selling indicators.

**Columns:**
- Time
- Price
- Volume
- Active Buy/Sell indicator
- Matched value

---

### 5. Market Indices Overview
**URL:** `https://24hmoney.vn/indices`

**Features:**
- Top gainers/losers
- Volume breakouts
- Technical signals
- Sector performance

---

### 6. Sector/Industry Money Flow
**URL:** `https://24hmoney.vn/recommend/business`

**Description:** Aggregated money flow distribution across different industry sectors. **Highly valuable for sector analysis.**

**Data:**
- Net buy/sell by sector
- Sector strength indicators
- Capital flow trends

---

### 7. Foreign Trading (Index Level)
**URL Pattern:** `https://24hmoney.vn/indices/{INDEX}/giao-dich-khoi-ngoai`

**Example:** `https://24hmoney.vn/indices/vn-index/giao-dich-khoi-ngoai`

**Features:**
- Daily net buy/sell
- Cumulative flow charts
- Top stocks by foreign activity

---

### 8. Stock Screener API
**Endpoint:** `https://api-finance-t19.24hmoney.vn/v1/ios/company/technical-filter`

**Method:** `GET`

**Description:**
Returns a list of stocks matching technical and fundamental filters. Contains valuable metrics including Relative Strength and EV/EBITDA.

**Key Parameters:**
- `param`: Pipe-separated filter string (e.g., `pe4Q:0:50|pb4Q:0:10|eps4Q:1000:50000|`)
- `floor`: `all`, `HOSE`, `HNX`, `UPCOM`
- `group_id`: Industry group ID (default `all`)
- `key` & `sort`: Sort field and direction (e.g., `key=eps4Q&sort=asc`)
- `page` & `per_page`: Pagination
- `device_id`, `browser_id`: Required generated strings
- `os`: `Chrome` (header or param)

**Response Fields:**
- `symbol`, `company_name`
- `match_price`
- `pe4Q`, `pb4Q`, `eps4Q`
- `roe`, `roa`
- `market_cap`
- `rs1m`, `rs3m`, `rs52w` (**Relative Strength** - highly valuable)
- `ev_per_ebit`, `ev_per_ebitda` (**Valuation metrics**)
- `the_beta4Q`

**Integration Strategy:**
- Mimic the browser's `device_id` generation or reuse a static one.
- Construct the `param` string dynamically based on desired screen filters.
- Excellent source for RS and Enterprise Value metrics.

---

## Scraping Strategy

### Option 1: Nuxt Hydration State (Recommended)
```python
import re
import json
import aiohttp

async def extract_nuxt_data(url):
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as resp:
            html = await resp.text()
    
    # Extract __NUXT__ state from script tag
    match = re.search(r'window\.__NUXT__\s*=\s*({.+?});?\s*</script>', html, re.DOTALL)
    if match:
        # Parse JSON (may need cleaning)
        return json.loads(match.group(1))
    return None
```

### Option 2: Internal API Access
The site uses internal APIs for data fetching. Inspect network traffic to identify endpoints like:
- `api.24hmoney.vn/*`
- `https://api-finance-t19.24hmoney.vn/v1/ios/company/technical-filter` (Screener)

### Option 3: Headless Browser (For Complex Pages)
```python
from playwright.async_api import async_playwright

async def scrape_with_playwright(url):
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        await page.goto(url)
        await page.wait_for_selector('.financial-report-box-content')
        content = await page.content()
        await browser.close()
        return content
```

---

## Rate Limiting
- Standard 2-3 second delays
- Use browser-like headers
- Respect high traffic during market hours (9:00-15:00 VN time)

---

## Data Mapping to Database

| 24HMoney Field | Database Column | Table |
|----------------|-----------------|-------|
| Symbol | symbol | stocks |
| Giá | current_price | stock_prices |
| KL Mua chủ động | active_buy_volume | stock_prices (new) |
| KL Bán chủ động | active_sell_volume | stock_prices (new) |
| P/E | pe_ratio | stock_prices |
| ROE | roe | stock_prices |
| Dòng tiền ngành | industry_flow | market_indices (new) |
| rs1m / rs3m | relative_strength_1m / 3m | stock_prices (new) |
| ev_per_ebitda | ev_ebitda | stock_prices (new) |

---

## Best Use Cases
1. **Transaction data** - Active buy/sell flow per stock
2. **Sector money flow** - Industry-wide capital movement
3. **Foreign trading** - Institutional investor activity
4. **Financial reports** - Clean quarterly/annual statements
5. **Technical Screening** - RS and EV metrics via Screener API
