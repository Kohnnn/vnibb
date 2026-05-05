# CafeF Data Source Documentation

## Overview
**URL:** `https://s.cafef.vn`
**Primary Data:** Financial Reports (BCTC), Enterprise News, Dividends.
**Tech Stack:** ASP.NET (Server-side rendered), Nested HTML Tables.

## Financial Reports (BCTC)

### URL Structure
The site uses a strictly formatted URL pattern. The "Slug" at the end is mandatory but can be generic as long as it ends in `.chn`.

**Pattern:**
`https://s.cafef.vn/bao-cao-tai-chinh/{SYMBOL}/{REPORT_TYPE}/{YEAR}/{PERIOD}/{FROM_YEAR}/{TO_YEAR}/{SLUG}.chn`

**Parameters:**
- `SYMBOL`: Stock ticker (e.g., `VNM`, `FPT`).
- `REPORT_TYPE`:
    - `IncSta`: Income Statement (Kết quả hoạt động kinh doanh)
    - `BSheet`: Balance Sheet (Can đối kế toán)
    - `CashFlow`: Cash Flow Indirect (Lưu chuyển tiền tệ gián tiếp)
    - `CashFlowDirect`: Cash Flow Direct (Lưu chuyển tiền tệ trực tiếp)
- `YEAR`: Ending year of the data view (e.g., `2023`).
- `PERIOD`:
    - `0`: Yearly (Xem theo năm)
    - `1`: Quarterly (Xem theo quý)
    - `2`: 6-month Cumulative (Lũy kế 6 tháng)
- `FROM_YEAR`/`TO_YEAR`: Usually `0` to let the server decide (shows last 4 periods).
- `SLUG`: Required string ending in `.chn`.
    - Recommended Generic Slug: `ket-qua-hoat-dong-kinh-doanh.chn`

**Example URLs:**
- **VNM Income Statement (Quarterly, ending 2023):**
  `https://s.cafef.vn/bao-cao-tai-chinh/VNM/IncSta/2023/1/0/0/ket-qua-hoat-dong-kinh-doanh.chn`
- **SSI Balance Sheet (Yearly, ending 2023):**
  `https://s.cafef.vn/bao-cao-tai-chinh/SSI/BSheet/2023/0/0/0/can-doi-ke-toan.chn`

### HTML Structure & Parsing
**Selector:** `table#tableContent`

**Structure:**
- The main table contains the data, but it is deeply nested.
- Individual numbers are often inside nested `table` or `div` tags within the main `td` cells.
- **Parsing Strategy:** Use `pandas.read_html(url, attrs={'id': 'tableContent'})`. This function handles nested tables exceptionally well and allows for easy flattening of the data structure.

**Columns:**
1.  **Report Item:** The name of the financial metric.
2.  **Period 1:** Data for the oldest period shown.
3.  **Period 2:** ...
4.  **Period 3:** ...
5.  **Period 4:** Data for the most recent period shown.

## Best Use Cases
1.  **Historical Financials:** Most reliable source for long-term historical financial statements in Vietnam.
2.  **Detailed BCTC:** Provides breakdown details often missing from summary APIs.

## Integration Strategy
1.  **Scraper Function:** Implement a `fetch_cafef_financials(symbol, report_type, quarterly=True)` function.
2.  **Library:** Use `pandas` for parsing and `requests` (or `httpx`) for fetching.
3.  **Data Cleaning:**
    - Parse Vietnamese number formats (periods for thousands, commas for decimals).
    - Handle standardizing header names ("Doanh thu thuần" -> "Net Revenue").
