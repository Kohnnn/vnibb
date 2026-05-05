# Cophieu68.vn Data Source Documentation

## Overview
**URL:** https://www.cophieu68.vn/  
**License:** robots.txt allows all (`User-agent: * Allow: /`)  
**Tech Stack:** Server-Side Rendered (SSR) PHP  
**Anti-Scrape:** None detected - very scraper-friendly  

## Available Data Sources

### 1. Bulk Daily Data (Recommended for Daily Updates)
**URL:** `https://www.cophieu68.vn/download/historydaily.php`

**Description:** Single page with all stocks' daily OHLCV data. Most efficient for daily sync.

**Columns Available:**
- Mã CK (Symbol)
- Đóng cửa (Close Price)
- Thay đổi (Change)
- KL Khớp (Matched Volume)
- Mở cửa (Open)
- Cao nhất (High)
- Thấp nhất (Low)
- NN Mua (Foreign Buy Volume)
- NN Bán (Foreign Sell Volume)
- Giá trị NN (Foreign Net Value)

---

### 2. Financial Indicators Filter
**URL:** `https://www.cophieu68.vn/signal/filter_financial.php`

**Description:** Filterable view of fundamental metrics for all stocks. Best for periodic fundamental data sync.

**Columns Available:**
- Mã CK (Symbol)
- Giá (Price)
- EPS
- P/E
- P/B
- P/S
- ROA (%)
- ROE (%)
- Vốn TT (Market Cap)
- Nợ/Vốn CSH (Debt/Equity)

**Pagination:** Uses page parameter, ~20 stocks per page, ~100 pages for full coverage.

---

### 3. Exchange IDs (Required for Full Coverage)
**URL Pattern:** `https://www.cophieu68.vn/market/markets.php?id={exchange_id}&vt={type}`

The site separates stocks by exchange. **You MUST iterate through all exchanges** to get complete coverage:

| Exchange ID | Name | Stock Count | Description |
|-------------|------|-------------|-------------|
| `^vnindex` | HOSE | ~370 | Ho Chi Minh Stock Exchange (blue chips) |
| `^hastc` | HNX | ~310 | Hanoi Stock Exchange |
| `^upcom` | UPCOM | ~780 | Unlisted Public Companies Market |

**Sector IDs (optional):**
- `^bb`: Banks/Insurance
- `^bds`: Real Estate
- `^ck`: Securities
- etc.

---

### 4. Column Structure (CRITICAL)
Each table has these columns in order:

| Col | vt=1 | vt=2 | vt=3 |
|-----|------|------|------|
| 0 | Mã CK (Symbol) | Mã CK | Mã CK |
| 1 | **Giá (Price)** | **Giá** | **Giá** |
| 2 | Thay đổi (Change) | Thay đổi | Thay đổi |
| 3 | KLGD 24h | Giá sổ sách | Nợ |
| 4 | KLGD 52w | P/B | Vốn CSH |
| 5 | KL Niêm Yết | EPS | Tổng TS |
| 6 | Vốn TT | PE | %Nợ/CSH |
| 7 | NN sở hữu | PS | %CSH/TS |
| 8 | | ROA | Tiền mặt |
| 9 | | ROE | |

> **⚠️ IMPORTANT:** Column 1 is the **actual price**, Column 2 is **price change**. Price is in 1000 VND units (e.g., 57.50 = 57,500 VND).

---

### 5. Market Overview by View Type (vt parameter)
**Base URL:** `https://www.cophieu68.vn/market/markets.php?id={exchange}&vt={type}`

| vt | Data Type | Key Columns |
|----|-----------|-------------|
| 1 | Listings & Basic | Price, Volume, Market Cap, Foreign Ownership |
| 2 | Valuation Ratios | P/B, EPS, PE, PS, ROA, ROE |
| 3 | Balance Sheet | Debt, Equity, Total Assets, Cash |

---

### 4. Stock-Specific Financial Statements
**URL Pattern:** `https://www.cophieu68.vn/quote/financial_detail.php?id={SYMBOL}&type={quarter|year}`

**Description:** Full quarterly or yearly financial statements (Balance Sheet, P&L).

**Table Structure:**
- Rows: Metric names (Chỉ tiêu)
- Columns: Time periods (Quarters or Years)
- Values: In Million VND (Triệu VNĐ)

---

### 5. Historical Price Data per Stock
**URL Pattern:** `https://www.cophieu68.vn/quote/history.php?id={SYMBOL}`

**Columns:**
- Ngày (Date)
- Đóng cửa (Close)
- Thay đổi (Change)
- KL Khớp (Match Volume)
- Mở cửa (Open)
- Cao nhất (High)
- Thấp nhất (Low)
- NN Mua (Foreign Buy)
- NN Bán (Foreign Sell)
- Giá trị NN (Foreign Net Value)

---

### 6. Foreign Transaction Statistics
**Overall:** `https://www.cophieu68.vn/stats/foreigner.php`
**Detailed:** `https://www.cophieu68.vn/stats/foreigner_detail.php?id=^vnindex&ym={MM_YYYY}`

**Columns:**
- Mã CK (Symbol)
- Tổng KL Mua (Total Buy Volume)
- Tổng KL Bán (Total Sell Volume)
- Giá Trị Ròng (Net Value)

---

### 7. Volume Anomalies / Money Flow Spikes
**URL:** `https://www.cophieu68.vn/stats/volume_buzz.php`

**Description:** Identifies stocks with sudden volume spikes - useful for buy/sell flow detection.

---

## Scraping Strategy

### Recommended Approach
```python
import aiohttp
from bs4 import BeautifulSoup

# Simple async scraping - no JS needed
async def fetch_page(url):
    async with aiohttp.ClientSession() as session:
        async with session.get(url, headers={'User-Agent': 'Mozilla/5.0'}) as resp:
            return await resp.text()

# Parse standard HTML tables
def parse_table(html):
    soup = BeautifulSoup(html, 'html.parser')
    table = soup.find('table', {'class': 'stock'})
    # Extract rows...
```

### Rate Limiting
- Minimum 2-3 seconds between requests
- Add random jitter (0-2 seconds)
- Respect server load during market hours

### Best Practices
1. Use `historydaily.php` for bulk daily updates (1 request = all stocks)
2. Use `filter_financial.php` for weekly fundamental sync
3. Use individual stock pages only for historical backfill
4. All data is in standard HTML tables - use BeautifulSoup

---

## Data Mapping to Database

| Cophieu68 Field | Database Column | Table |
|-----------------|-----------------|-------|
| Mã CK | symbol | stocks |
| Giá/Đóng cửa | current_price | stock_prices |
| Thay đổi | price_change | stock_prices |
| KL Khớp | volume | stock_prices |
| Vốn TT | market_cap | stock_prices |
| P/E | pe_ratio | stock_prices |
| P/B | pb_ratio | stock_prices |
| ROE | roe | stock_prices |
| EPS | eps | stock_prices |
| NN Mua | foreign_buy_volume | stock_prices |
| NN Bán | foreign_sell_volume | stock_prices |
