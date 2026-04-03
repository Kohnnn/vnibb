# VNIBB Widget Documentation

> Legacy complete reference for the dashboard widget system. Phase 8 shipped widgets now include `bank_metrics`, `transaction_flow`, `industry_bubble`, `sector_board`, `money_flow_trend`, and `correlation_matrix`; use `apps/web/src/data/widgetDefinitions.ts` and `apps/web/src/components/widgets/WidgetRegistry.ts` as the current source of truth. Last synchronized with shipped cleanup on 2026-04-04.

---

## Phase 8 Widget Additions

| Widget Type | Name | Backend Endpoint | Status |
|-------------|------|------------------|--------|
| `bank_metrics` | Bank Analytics | `/equity/{symbol}/financial-ratios` | Live |
| `transaction_flow` | Transaction Flow | `/equity/{symbol}/transaction-flow` | Live |
| `industry_bubble` | Industry Bubble | `/market/industry-bubble` | Live |
| `sector_board` | Sector Board | `/market/sector-board` | Live |
| `money_flow_trend` | Money Flow Trend | `/market/money-flow-trend` | Live |
| `correlation_matrix` | Correlation Matrix | `/equity/{symbol}/correlation-matrix` | Code complete, waiting on final OCI validation |

## Widget Categories

| Category | Description |
|----------|-------------|
| `core_data` | Stock data, charts, financials, market info |
| `calendar` | Time-based events (dividends, earnings, economic) |
| `ownership` | Shareholder, officer, and subsidiary info |

## Current Rules

- Canonical widget IDs are `ticker_profile`, `unified_financials`, `major_shareholders`, and `database_inspector`.
- Do not use legacy aliases such as `company_profile`, `financials`, `institutional_ownership`, or `database_browser` in new code or templates.
- Widget-owned user state should persist through dashboard-backed widget config so it can ride the existing Appwrite-authenticated dashboard/backend sync path.
- Base widget sizes are now treated as autofit and initial-placement hints, not fixed runtime aspect-ratio rules.
- Saved dashboards now migrate away legacy `maxW`/`maxH` widget caps so older layouts do not keep blocking manual resize.
- Global prompt actions should route into the VniAgent sidebar prompt library, not a standalone modal.

---

## Widget Index

| # | Widget Type | Name | Requires Symbol | Backend Endpoint |
|---|-------------|------|-----------------|------------------|
| 1 | `ticker_info` | Ticker Info | ✅ | `/equity/{symbol}/profile` |
| 2 | `ticker_profile` | Ticker Profile | ✅ | `/equity/{symbol}/profile` |
| 3 | `price_chart` | Price Chart | ✅ | `/equity/{symbol}/historical` |
| 4 | `key_metrics` | Key Metrics | ✅ | `/equity/{symbol}/profile` |
| 5 | `share_statistics` | Share Statistics | ✅ | `/equity/{symbol}/profile` |
| 6 | `screener` | Stock Screener | ❌ | `/screener/` |
| 7 | `earnings_history` | Earnings History | ✅ | `/equity/{symbol}/events` |
| 8 | `dividend_payment` | Dividend Payment | ✅ | `/equity/{symbol}/events` |
| 9 | `stock_splits` | Stock Splits | ✅ | `/equity/{symbol}/events` |
| 10 | `company_filings` | Company Filings | ✅ | `/equity/{symbol}/news` |
| 11 | `news_feed` | Company News | ✅ | `/equity/{symbol}/news` |
| 12 | `events_calendar` | Events Calendar | ✅ | `/equity/{symbol}/events` |
| 13 | `major_shareholders` | Major Shareholders | ✅ | `/equity/{symbol}/shareholders` |
| 14 | `officers_management` | Officers & Management | ✅ | `/equity/{symbol}/officers` |
| 15 | `intraday_trades` | Intraday Trades | ✅ | `/equity/{symbol}/intraday` |
| 16 | `financial_ratios` | Financial Ratios | ✅ | `/equity/{symbol}/ratios` |
| 17 | `foreign_trading` | Foreign Trading | ✅ | `/equity/{symbol}/foreign-trading` |
| 18 | `subsidiaries` | Subsidiaries | ✅ | `/equity/{symbol}/subsidiaries` |
| 19 | `balance_sheet` | Balance Sheet | ✅ | `/equity/{symbol}/balance-sheet` |
| 20 | `income_statement` | Income Statement | ✅ | `/equity/{symbol}/income-statement` |
| 21 | `cash_flow` | Cash Flow | ✅ | `/equity/{symbol}/cash-flow` |
| 22 | `market_overview` | Market Overview | ❌ | `/equity/market/overview` |
| 23 | `watchlist` | Watchlist | ❌ | VNIBB WebSocket + widget config persistence |
| 24 | `peer_comparison` | Peer Comparison | ✅ | `/equity/{symbol}/profile` |
| 25 | `top_movers` | Top Gainers/Losers | ❌ | `/screener/` |
| 26 | `world_indices` | World Indices | ❌ | Mock (global APIs) |
| 27 | `sector_performance` | Sector Performance | ❌ | Mock (future API) |
| 28 | `portfolio_tracker` | Portfolio Tracker | ❌ | local portfolio hook + market data APIs |
| 29 | `price_alerts` | Price Alerts | ✅ | Widget config + WebSocket/quote fallback |
| 30 | `economic_calendar` | Economic Calendar | ❌ | Mock (future API) |
| 31 | `volume_analysis` | Volume Analysis | ✅ | `/equity/{symbol}/historical` |
| 32 | `technical_summary` | Technical Summary | ✅ | `/equity/{symbol}/historical` |
| 33 | `forex_rates` | Forex Rates | ❌ | Mock (forex API) |
| 34 | `commodities` | Commodities | ❌ | Mock (commodity API) |
| 35 | `similar_stocks` | Similar Stocks | ✅ | `/equity/{symbol}/profile` |
| 36 | `quick_stats` | Quick Stats | ✅ | `/equity/{symbol}/historical`, `/profile` |
| 37 | `notes` | Notes | ✅ | Widget config |
| 38 | `unified_financials` | Financial Statements | ✅ | `/equity/{symbol}/financials` and related statement endpoints |
| 40 | `analyst_estimates` | Analyst Estimates | ✅ | Mock (future API) |
| 41 | `comparison_analysis` | Comparison Analysis | ❌ | `/api/v1/comparison` |
| 42 | `news_flow` | News Flow | ✅ | `/api/v1/news/flow` |

---

## Detailed Widget Specifications

### 41. `comparison_analysis`
**Purpose:** Side-by-side comparison of 2-5 stocks  
**Data Source:** `compareStocks(symbols, period)`  
**Props:** `{ id: string, initialSymbols?: string[] }`  
**Features:** 
- Multi-ticker selection (max 5)
- Category switching (Valuation, Profitability, etc.)
- Best/Worst highlighting with icons
- Period toggle (FY, Q1-Q4, TTM)
- Data export support

### 42. `news_flow`
**Purpose:** Real-time chronological news timeline  
**Data Source:** `GET /api/v1/news/flow`  
**Props:** `{ id: string, initialSymbols?: string[] }`  
**Features:**
- Infinite scroll pagination
- Sentiment-based coloring and icons
- Symbol and sentiment filtering
- AI-generated summaries (when available)
- Link to source and related tickers


### 1. `ticker_info`
**Purpose:** Display basic stock ticker information  
**Data Source:** `useCompanyProfile(symbol)`  
**Props:** `{ symbol: string }`  
**Data Fields:**
- `symbol`, `company_name`, `short_name`
- `exchange`, `industry`, `sector`

---

### 2. `ticker_profile`
**Purpose:** Compact company profile card  
**Data Source:** `useCompanyProfile(symbol)`  
**Props:** `{ symbol: string }`  
**Data Fields:** Same as ticker_info + `description`

---

### 3. `price_chart`
**Purpose:** Interactive candlestick/line price chart  
**Data Source:** `useHistoricalPrices(symbol, { startDate, endDate })`  
**Props:** `{ symbol: string, timeframe?: string, indicators?: string[] }`  
**Data Fields:**
```typescript
{ time: string, open: number, high: number, low: number, close: number, volume: number }
```

---

### 4. `key_metrics`
**Purpose:** Key valuation metrics grid  
**Data Source:** `useCompanyProfile(symbol)`  
**Props:** `{ symbol: string }`  
**Data Fields:**
- `market_cap`, `pe_ratio`, `pb_ratio`, `eps`, `roe`

---

### 5. `share_statistics`
**Purpose:** Share float and trading statistics  
**Data Source:** `useCompanyProfile(symbol)`  
**Props:** `{ symbol: string }`  
**Data Fields:**
- `outstanding_shares`, `float_shares`, `avg_volume`

---

### 6. `screener`
**Purpose:** Filter and sort stocks by criteria  
**Data Source:** `useScreenerData({ exchange, industry, limit })`  
**Props:** `{ onSymbolClick?: (symbol) => void }`  
**Data Fields:**
```typescript
{ symbol, company_name, price, change_pct, volume, market_cap, pe_ratio }
```

---

### 7-9. `earnings_history`, `dividend_payment`, `stock_splits`
**Purpose:** Corporate action calendars  
**Data Source:** `useCompanyEvents(symbol)`  
**Props:** `{ symbol: string }`  
**Data Fields:**
```typescript
{ event_type: 'dividend' | 'earnings' | 'split', date, value, description }
```

---

### 10-11. `company_filings`, `news_feed`
**Purpose:** News and document filings  
**Data Source:** `useCompanyNews(symbol)`  
**Props:** `{ symbol: string }`  
**Data Fields:**
```typescript
{ title, source, published_date, url, summary }
```

---

### 12. `events_calendar`
**Purpose:** Unified corporate events timeline  
**Data Source:** `useCompanyEvents(symbol)`  
**Props:** `{ symbol: string }`  
**Data Fields:** Same as earnings/dividend/splits combined

---

### 13. `major_shareholders`
**Purpose:** Ownership breakdown table  
**Data Source:** `useShareholders(symbol)`  
**Props:** `{ symbol: string }`  
**Data Fields:**
```typescript
{ holder_name, shares, ownership_pct, holder_type }
```

---

### 14. `officers_management`
**Purpose:** Executive team listing  
**Data Source:** `useOfficers(symbol)`  
**Props:** `{ symbol: string }`  
**Data Fields:**
```typescript
{ name, title, year_born, year_appointed }
```

---

### 15. `intraday_trades`
**Purpose:** Real-time trade tape  
**Data Source:** `useIntradayData(symbol)`  
**Props:** `{ symbol: string }`  
**Data Fields:**
```typescript
{ time, price, volume, side: 'buy' | 'sell' }
```

---

### 16. `financial_ratios`
**Purpose:** Comprehensive financial ratios table  
**Data Source:** `useFinancialRatios(symbol, { period })`  
**Props:** `{ symbol: string }`  
**Data Fields:**
```typescript
{ period, pe_ratio, pb_ratio, roe, roa, debt_to_equity, current_ratio }
```

---

### 17. `foreign_trading`
**Purpose:** Foreign investor net buy/sell  
**Data Source:** `useForeignTrading(symbol)`  
**Props:** `{ symbol: string }`  
**Data Fields:**
```typescript
{ date, buy_volume, sell_volume, net_value }
```

---

### 18. `subsidiaries`
**Purpose:** Company subsidiary listing  
**Data Source:** `useSubsidiaries(symbol)`  
**Props:** `{ symbol: string }`  
**Data Fields:**
```typescript
{ company_name, ownership_pct, charter_capital }
```

---

### 19-21. `balance_sheet`, `income_statement`, `cash_flow`
**Purpose:** Financial statements table  
**Data Source:** `useBalanceSheet`, `useIncomeStatement`, `useCashFlow`  
**Props:** `{ symbol: string }`  
**Data Fields:**
```typescript
// Balance Sheet
{ period, total_assets, equity, total_liabilities, cash, inventory }

// Income Statement
{ period, revenue, gross_profit, operating_income, net_income, eps }

// Cash Flow
{ period, operating_cash_flow, investing_cash_flow, financing_cash_flow, free_cash_flow }
```

---

### 22. `market_overview`
**Purpose:** Vietnam market indices cards  
**Data Source:** `useMarketOverview()`  
**Props:** None (global widget)  
**Data Fields:**
```typescript
{ index_name, current_value, change, change_pct }
// Indices: VN-INDEX, VN30, HNX, UPCOM
```

---

### 23. `watchlist`
**Purpose:** Custom stock watchlist  
**Data Source:** widget config + WebSocket/live quote data  
**Props:** `{ onSymbolClick?: (symbol) => void }`  
**Persisted Fields:** `watchlistSymbols`, `watchlistSort`

---

### 24. `peer_comparison`
**Purpose:** Side-by-side stock comparison  
**Data Source:** `useCompanyProfile` per peer symbol  
**Props:** `{ symbol: string }`  
**Comparison Fields:** `market_cap`, `pe_ratio`, `pb_ratio`, `roe`

---

### 25. `top_movers`
**Purpose:** Daily top gainers and losers  
**Data Source:** `useScreenerData({ limit: 100 })`  
**Props:** `{ onSymbolClick?: (symbol) => void }`  
**Features:** Toggle between gainers/losers view

---

### 26. `world_indices`
**Purpose:** Global market indices  
**Data Source:** Mock data (replace with global API)  
**Props:** None  
**Indices:** S&P 500, Dow Jones, NASDAQ, Nikkei, Hang Seng, DAX, FTSE

---

### 27. `sector_performance`
**Purpose:** Vietnam sector heatmap  
**Data Source:** Mock data (replace with sector API)  
**Props:** None  
**Views:** Grid heatmap, List view

---

### 28. `portfolio_tracker`
**Purpose:** Track holdings with P&L  
**Data Source:** local portfolio hook + market data APIs  
**Props:** `{ onSymbolClick?: (symbol) => void }`  
**Note:** still not migrated into dashboard-backed widget config in this batch  
**Data Fields:**
```typescript
{ symbol, quantity, avgCost, currentPrice }
```

---

### 29. `price_alerts`
**Purpose:** Set price target alerts  
**Data Source:** widget config + WebSocket/live quote fallback  
**Props:** `{ symbol?: string }`  
**Persisted Fields:** `alerts`  
**Data Fields:**
```typescript
{ symbol, targetPrice, condition: 'above' | 'below', triggered: boolean }
```

---

### 30. `economic_calendar`
**Purpose:** Macro economic events  
**Data Source:** Mock data (replace with economic API)  
**Props:** None  
**Features:** Impact levels (high/medium/low), country filter

---

### 31. `volume_analysis`
**Purpose:** Volume bars with average comparison  
**Data Source:** `useHistoricalPrices(symbol)`  
**Props:** `{ symbol: string }`  
**Calculated Fields:** `avgVolume`, `volumeChange%`

---

### 32. `technical_summary`
**Purpose:** Technical indicators with signals  
**Data Source:** `useHistoricalPrices(symbol)`  
**Props:** `{ symbol: string }`  
**Indicators:** SMA 20, SMA 50, RSI (14), MACD, Stochastic, ADX  
**Output:** Buy/Sell/Neutral signal for each

---

### 33. `forex_rates`
**Purpose:** VND currency exchange rates  
**Data Source:** Mock data (replace with forex API)  
**Props:** None  
**Pairs:** USD/VND, EUR/VND, JPY/VND, GBP/VND, CNY/VND, etc.

---

### 34. `commodities`
**Purpose:** Gold, oil, commodity prices  
**Data Source:** Mock data (replace with commodity API)  
**Props:** None  
**Commodities:** Gold, Silver, WTI, Brent, Natural Gas, Copper

---

### 35. `similar_stocks`
**Purpose:** Find related stocks  
**Data Source:** `useCompanyProfile` per similar symbol  
**Props:** `{ symbol: string, onSymbolClick?: (symbol) => void }`  
**Logic:** Pre-defined peer mappings by sector

---

### 36. `quick_stats`
**Purpose:** Summary statistics grid  
**Data Source:** `useHistoricalPrices`, `useCompanyProfile`  
**Props:** `{ symbol: string }`  
**Stats:** Price, Change%, 30D High/Low, Avg Volume, P/E Ratio

---

### 37. `notes`
**Purpose:** Symbol-specific research notes  
**Data Source:** widget config  
**Persisted Fields:** `notesBySymbol`

---

### 38. `unified_financials`
**Purpose:** Unified financial statements and ratios workspace  
**Data Source:** VNIBB financial endpoints  
**Props:** `{ symbol: string }`  
**Notes:** canonical replacement for legacy `financials`

---

### Widget Persistence Status

Dashboard-backed widget config now covers:
- `notes`
- `watchlist`
- `price_alerts`
- `peer_comparison`
- `research_browser`

Browser-only persistence should now be reserved for device-local behavior such as notification permission hints and lightweight UI recents.
**Purpose:** Personal stock notes  
**Data Source:** localStorage  
**Props:** `{ symbol: string }`  
**Storage Key:** `vnibb_notes`

---

## Common Widget Props Interface

```typescript
interface WidgetProps {
    symbol?: string;           // Stock symbol (e.g., 'VNM')
    isEditing?: boolean;       // Dashboard edit mode
    onRemove?: () => void;     // Remove widget callback
    onSymbolClick?: (symbol: string) => void;  // Navigate to symbol
    [key: string]: unknown;    // Additional config
}
```

---

## Backend API Response Types

```typescript
// Historical Prices
interface EquityHistoricalResponse {
    symbol: string;
    count: number;
    data: { time: string; open: number; high: number; low: number; close: number; volume: number }[];
}

// Company Profile
interface EquityProfileResponse {
    symbol: string;
    company_name?: string;
    short_name?: string;
    exchange?: string;
    industry?: string;
    market_cap?: number;
    pe_ratio?: number;
    pb_ratio?: number;
    roe?: number;
}

// Screener
interface ScreenerResponse {
    count: number;
    data: { symbol: string; company_name: string; price: number; change_pct: number; }[];
}
```

---

## Adding New Widgets

1. **Create component:** `frontend/src/components/widgets/NewWidget.tsx`
2. **Add type:** `frontend/src/types/dashboard.ts` → `WidgetType`
3. **Register:** `frontend/src/components/widgets/WidgetRegistry.ts`
4. **Export:** `frontend/src/components/widgets/index.ts`
5. **Define:** `frontend/src/data/widgetDefinitions.ts`
6. **Backend (if needed):** Create fetcher in `backend/vnibb/providers/vnstock/`

---

*Last updated: 2026-02-06*

## 2026-02-06 Additions

### `research_browser`
**Purpose:** Embedded research browser for saved external sites
**Data Source:** localStorage (no backend)
**Props:** `{ id: string }`
**Notes:**
- Uses iframe embedding; many sites may block embedding via `X-Frame-Options`
- Cannot share the user's native browser login profile/cookies
- Saved URLs persist in localStorage

### `dividend_ladder`
**Purpose:** Upcoming dividend schedule (ex-date, record date, payment)
**Data Source:** `useDividends(symbol)` → `/equity/{symbol}/dividends`
**Props:** `{ symbol: string }`
**Data Fields:** `ex_date`, `record_date`, `payment_date`, `dividend_type`, `value`

### `insider_deal_timeline`
**Purpose:** Recent insider activity with buy/sell summary
**Data Source:** `useInsiderDeals(symbol)` → `/insider/{symbol}/deals`
**Props:** `{ symbol: string }`
**Data Fields:** `insider_name`, `insider_position`, `deal_action`, `deal_quantity`, `deal_price`, `deal_value`, `announce_date`

### `sector_rotation_radar`
**Purpose:** Sector leadership shifts (leaders/laggards)
**Data Source:** `useSectorPerformance()` → `/trading/sector-performance`
**Props:** `{ widgetGroup?: WidgetGroupId }`
**Data Fields:** `sector_code`, `sector_name`, `change_pct`, `top_gainer_symbol`, `top_loser_symbol`

### `market_breadth`
**Purpose:** Advancers vs decliners by exchange (HOSE/HNX/UPCOM)
**Data Source:** `useScreenerData({ exchange })` → `/screener/`
**Props:** `{}`
**Notes:** Exchange-level breadth is an approximation of index breadth.

### `technical_snapshot`
**Purpose:** Daily technical indicator summary (RSI, MACD, ADX, support/resistance)
**Data Source:** `useFullTechnicalAnalysis(symbol)` → `/analysis/ta/{symbol}/full`
**Props:** `{ symbol: string }`
**Data Fields:** `signals.overall_signal`, `oscillators.rsi`, `oscillators.macd`, `volatility.adx`, `levels.support_resistance`

### `ownership_changes`
**Purpose:** Latest major shareholder snapshot
**Data Source:** `useShareholders(symbol)` → `/equity/{symbol}/shareholders`
**Props:** `{ symbol: string }`
**Notes:** No historical change data yet; current snapshot only.

### `market_movers_sectors`
**Purpose:** Combined market movers + sector performance
**Data Source:** `useSectorPerformance()` → `/trading/sector-performance`
**Props:** `{ widgetGroup?: WidgetGroupId }`

### `news_corporate_actions`
**Purpose:** Company news with dividend + insider action feed
**Data Source:** `useCompanyNews`, `useDividends`, `useInsiderDeals`
**Props:** `{ symbol: string }`
