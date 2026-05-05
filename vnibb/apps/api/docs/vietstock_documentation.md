# Vietstock Finance Data Source Documentation

## Overview
**URL:** https://finance.vietstock.vn/  
**License:** robots.txt returns 403 via HTTP client (accessible via browser)  
**Tech Stack:** Heavy AJAX/JavaScript rendering  
**Anti-Scrape:** Moderate to High - User-agent filtering, login walls, possible Cloudflare  

## Key Characteristics
- Most data requires JavaScript execution
- Many features behind VietstockID login
- Complex POST requests with tokens for data tables
- Best for detailed order statistics (buy/sell flow)

> ⚠️ **WARNING:** This site has anti-scrape measures. Use headless browser with proper headers.

---

## Available Data Sources

### 1. Stock Overview
**URL Pattern:** `https://finance.vietstock.vn/{TICKER}.htm`

**Note:** Redirects to full ticker name URL (e.g., `VNM-ctcp-sua-viet-nam.htm`)

**Data Available:**
- Basic price and summary metrics
- Company overview

---

### 2. Financial Statements
**URL Pattern:** `https://finance.vietstock.vn/{TICKER}/tai-chinh.htm`

**Sub-tabs (Query Parameters):**
| Tab | Parameter | Description |
|-----|-----------|-------------|
| Summary | `?tab=BCTT` | Financial summary |
| Balance Sheet | `?tab=CDKT` | Bảng cân đối kế toán |
| Income Statement | `?tab=KQKD` | Kết quả kinh doanh |
| Cash Flow | `?tab=LC` | Lưu chuyển tiền tệ |

**Table Structure:**
- Metrics in rows
- Time periods (Quarter/Year) in columns
- Requires JavaScript to load

> ⚠️ Triggers login popup on interaction. Some data visible after closing popup.

---

### 3. Buy/Sell Order Statistics (Market-Wide)
**URL:** `https://finance.vietstock.vn/ket-qua-giao-dich?tab=thong-ke-dat-lenh`

**Description:** Daily buy/sell order statistics for the entire market. **Most valuable data from this site.**

**Columns:**
- KL đặt mua (Buy Order Volume)
- KL đặt bán (Sell Order Volume)
- Chênh lệch (Difference)
- Số lệnh mua (Number of Buy Orders)
- Số lệnh bán (Number of Sell Orders)

---

### 4. Stock Transaction Statistics (Per Stock)
**URL Pattern:** `https://finance.vietstock.vn/{TICKER}/thong-ke-giao-dich.htm`

**Description:** Detailed intraday transaction log showing execution lots.

**Columns:**
- Time
- Price
- Volume
- Transaction type

---

### 5. Price Statistics (Market-Wide)
**URL:** `https://finance.vietstock.vn/ket-qua-giao-dich`

**Description:** Daily historical prices for all stocks.

---

### 6. Company A-Z Directory
**URL:** `https://finance.vietstock.vn/doanh-nghiep-a-z`

**Description:** Complete listing of all companies. Can be used to build symbol list.

---

### 7. Industry Data
**URL:** `https://finance.vietstock.vn/du-lieu-nganh.htm`

**Description:** Comparative data across different sectors and industries.

---

## Anti-Scrape Measures

### Detected Issues
1. **JavaScript Dependency:** Tables don't load on plain GET requests
2. **Login Popups:** Frequent VietstockID prompts for "Full" data
3. **User-Agent Filtering:** Standard requests may get 403
4. **Request Tokens:** Some POST endpoints require specific headers/tokens
5. **Cloudflare Protection:** Possible RUM/challenge detection

### Workarounds
```python
# Use browser-like headers
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
    'Referer': 'https://finance.vietstock.vn/'
}
```

---

## Scraping Strategy

### Required: Headless Browser
```python
from playwright.async_api import async_playwright

async def scrape_vietstock(url):
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64)...',
            viewport={'width': 1280, 'height': 720}
        )
        page = await context.new_page()
        
        try:
            await page.goto(url, wait_until='networkidle')
            
            # Close login popup if appears
            try:
                close_btn = page.locator('.modal .close')
                await close_btn.click(timeout=2000)
            except:
                pass
            
            # Wait for data table
            await page.wait_for_selector('table.table-data', timeout=10000)
            
            content = await page.content()
            return content
        finally:
            await browser.close()
```

### Session Management
- Consider maintaining cookie sessions
- May need to simulate login for full data access

---

## Rate Limiting
- Higher delays recommended (5+ seconds)
- Rotate user agents
- Use residential proxies if blocked
- Avoid peak hours if possible

---

## Data Mapping to Database

| Vietstock Field | Database Column | Table |
|-----------------|-----------------|-------|
| Mã CK | symbol | stocks |
| Giá | current_price | stock_prices |
| KL đặt mua | buy_order_volume | order_flow (new) |
| KL đặt bán | sell_order_volume | order_flow (new) |
| Chênh lệch | order_imbalance | order_flow (new) |

---

## Best Use Cases
1. **Order flow statistics** - Unique data not available elsewhere
2. **Industry comparison** - Sector-wide analysis
3. **Backup source** - When other sources fail

## Limitations
- High anti-scrape friction
- Login required for many features
- Slower scraping due to JavaScript
- Consider as secondary source only
