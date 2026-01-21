# SieuCoPhieu.vn Data Source Documentation

## Overview
**URL:** https://sieucophieu.vn/  
**License:** robots.txt has content-signals (search=allowed, ai-input/ai-train=undefined)  
**Tech Stack:** Nuxt.js (Vue.js SSR framework)  
**Anti-Scrape:** Moderate - Cloudflare RUM, gated content, WebSocket data  

## Key Characteristics
- Public API available for industry cashflow
- Most valuable data behind login wall
- Real-time data via WebSocket (not HTTP)
- Good for sector-level analysis

---

## Available Data Sources

### 1. Public API: Industry Cashflow ⭐ (Best Source)
**URL:** `https://sieucophieu.vn/api/v1/stock/industry_cashflow/`

**Description:** JSON API with sector-level money flow data. **Publicly accessible without authentication.**

**Response Fields:**
```json
{
    "stock_list_name": "Ngân hàng",
    "cashflow": 123456789,
    "roc": 2.5,
    "rs_short": 1.2,
    "rs_mid": 0.8,
    "rs_relative": 1.5
}
```

| Field | Description |
|-------|-------------|
| stock_list_name | Industry/sector name (Vietnamese) |
| cashflow | Absolute cashflow value |
| roc | Rate of Change (%) |
| rs_short | Short-term relative strength |
| rs_mid | Medium-term relative strength |
| rs_relative | Overall relative strength score |

---

### 2. Smart Price Board
**URL:** `https://sieucophieu.vn/bang-dien`

**Description:** Real-time stock prices organized by sector groups (VN30, Banks, Real Estate, etc.)

**Data Available:**
- Stock symbols (Mã)
- Current prices (Giá)
- Volume (KL)
- Percentage change

**Technical:**
- Uses WebSocket for real-time updates
- Footer shows "Đã kết nối" when connected
- DOM-based extraction possible

---

### 3. Industry Statistics
**URL:** `https://sieucophieu.vn/thong-ke-nganh`

**Tabs:**
| Tab | Access | Description |
|-----|--------|-------------|
| Dòng tiền ngành | **Public** | Industry money flow (same as API) |
| Sức mạnh ngành | Login Required | Industry strength metrics |
| Sức mạnh CP | Login Required | Individual stock strength |

---

### 4. Market Pulse / Analysis (Login Required)
**URL:** `https://sieucophieu.vn/nhip-dap-thi-truong`

**Description:** Advanced money flow analysis and "Market Beat" metrics.

> ⚠️ Requires authentication. Do not attempt scraping.

---

### 5. Stock Rankings (Login Required)
**URL:** `https://sieucophieu.vn/xep-hang-co-phieu`

**Description:** Proprietary AI rankings based on multiple factors.

> ⚠️ Requires authentication.

---

### 6. Stock Analysis (Login Required)
**URL Pattern:** `https://sieucophieu.vn/phan-tich/{SYMBOL}`

**Description:** Detailed technical indicators and AI scores.

> ⚠️ Requires authentication.

---

### 7. Articles / Market Analysis
**URL:** `https://sieucophieu.vn/bai-viet`

**Description:** Public analysis articles. Can be useful for sentiment analysis.

---

## Scraping Strategy

### Strategy 1: Public API (Recommended)
```python
import aiohttp

async def get_industry_cashflow():
    url = 'https://sieucophieu.vn/api/v1/stock/industry_cashflow/'
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as resp:
            return await resp.json()
```

**Sample Usage:**
```python
data = await get_industry_cashflow()
for sector in data:
    print(f"{sector['stock_list_name']}: {sector['cashflow']} (ROC: {sector['roc']}%)")
```

### Strategy 2: Smart Board via Browser
```python
from playwright.async_api import async_playwright

async def scrape_smart_board():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        await page.goto('https://sieucophieu.vn/bang-dien')
        
        # Wait for WebSocket connection
        await page.wait_for_selector('text=Đã kết nối', timeout=10000)
        
        # Extract sector data
        content = await page.content()
        await browser.close()
        return content
```

### Strategy 3: Search Modal Trick
For basic stock info without full authentication:
1. Trigger search (Ctrl+K)
2. Search for symbol
3. Extract data from popup modal (includes TradingView chart and metrics)

---

## Anti-Scrape Considerations

### Detected Measures
1. **Gated Content:** Most valuable data requires login
2. **Cloudflare RUM:** May detect automated access
3. **WebSocket Data:** Real-time data not via HTTP
4. **Nuxt.js Hydration:** Requires JavaScript for full content

### Recommendations
- Focus on public API endpoint
- Don't attempt to bypass login
- Use moderate request rates
- Consider user-agent rotation

---

## Rate Limiting
- 2-3 second delays for API
- 5+ seconds for browser-based scraping
- Don't poll WebSocket endpoints rapidly

---

## Data Mapping to Database

| SieuCoPhieu Field | Database Column | Table |
|-------------------|-----------------|-------|
| stock_list_name | industry_name | industry_flow (new) |
| cashflow | cashflow | industry_flow |
| roc | rate_of_change | industry_flow |
| rs_short | rs_short | industry_flow |
| rs_mid | rs_mid | industry_flow |
| rs_relative | rs_relative | industry_flow |

---

## Best Use Cases
1. **Industry cashflow API** - Unique sector-level flow data
2. **Board data** - Real-time sector groupings (with browser)
3. **Sentiment** - Analysis articles

## Limitations
- Most stock-level data is gated
- No public API for individual stocks
- WebSocket complexity for real-time data
