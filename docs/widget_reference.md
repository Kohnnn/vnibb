# VNIBB Widget Reference Documentation

> **Purpose**: Comprehensive reference for all dashboard widgets - their functions, required data, and data sources.
> **Last Updated**: 2026-04-04

---

## Table of Contents

1. [Phase 8 Shipped Widgets](#phase-8-shipped-widgets)
2. [Currently Implemented Widgets (legacy section)](#currently-implemented-widgets)
3. [OpenBB Target Widgets (40 Easy)](#openbb-target-widgets-40)
4. [Extended Widgets (60 Total)](#extended-widgets-60-total)
5. [Data Sources Reference](#data-sources-reference)

---

## Current Rules

- Canonical widget IDs are `ticker_profile`, `unified_financials`, `major_shareholders`, and `database_inspector`.
- Legacy aliases such as `company_profile`, `financials`, `institutional_ownership`, and `database_browser` are migrated out of saved dashboards on load and should not be used in new docs, templates, or code.
- Source-of-truth split:
  - Widget metadata: `vnibb/apps/web/src/data/widgetDefinitions.ts`
  - Runtime registry: `vnibb/apps/web/src/components/widgets/WidgetRegistry.ts`
  - Autofit/base sizing: `vnibb/apps/web/src/lib/dashboardLayout.ts`
- Widget-owned state should persist through dashboard-backed widget config so it rides the Appwrite-authenticated dashboard/backend sync path.
- Base sizes are for autofit and initial placement only, not fixed runtime aspect-ratio locks.
- Legacy saved widget layout caps are migrated away on load so stale `maxW`/`maxH` values do not keep blocking resize on existing dashboards.
- Global prompt actions should open the VniAgent sidebar first, then open the VniAgent-owned prompt library there.

---

## Phase 8 Shipped Widgets

| Widget Type | Name | File | Backend Endpoint | Notes |
|-------------|------|------|------------------|-------|
| `bank_metrics` | Bank Analytics | `BankMetricsWidget.tsx` | `/equity/{symbol}/financial-ratios` | Bank-native KPI surface |
| `transaction_flow` | Transaction Flow | `TransactionFlowWidget.tsx` | `/equity/{symbol}/transaction-flow` | Domestic/foreign/proprietary flow with price overlay |
| `industry_bubble` | Industry Bubble | `IndustryBubbleWidget.tsx` | `/market/industry-bubble` | Sector peer scatter/bubble chart |
| `sector_board` | Sector Board | `SectorBoardWidget.tsx` | `/market/sector-board` | Columnar sector tape |
| `money_flow_trend` | Money Flow Trend | `MoneyFlowTrendWidget.tsx` | `/market/money-flow-trend` | RRG-style quadrant scatter with trails |
| `correlation_matrix` | Correlation Matrix | `CorrelationMatrixWidget.tsx` | `/equity/{symbol}/correlation-matrix` | Peer return heatmap |

## Currently Implemented Widgets

### 1. `ticker_info` - Ticker Info

| Property | Value |
|----------|-------|
| **File** | `TickerInfoWidget.tsx` |
| **Function** | Displays stock symbol, current price, daily change %, company name, exchange badge, and volume |
| **Default Size** | 3×4 |

**Required Data:**
```typescript
{
  symbol: string;           // Stock ticker (e.g., "VNM")
  company_name: string;     // Full company name
  exchange: string;         // "HOSE" | "HNX" | "UPCOM"
  price: number;            // Current price in VND
  change_1d: number;        // 1-day % change
  volume: number;           // Trading volume
  industry: string;         // Company industry
}
```

**Data Sources:** vnstock `Screener().stock()`, `Company().overview()`

---

### 2. `ticker_profile` - Company Profile

| Property | Value |
|----------|-------|
| **File** | `TickerProfileWidget.tsx` |
| **Function** | Shows full company information: name, industry, exchange, website, employee count, established year, listing date |
| **Default Size** | 3×5 |

**Required Data:**
```typescript
{
  symbol: string;
  company_name: string;
  short_name: string;
  industry: string;
  exchange: string;
  website: string;
  no_employees: number;
  established_year: number;
  listed_date: string;
  company_type: string;
}
```

**Data Sources:** vnstock `Company().overview()`, SSI iBoard `/stock/stock-info`

---

### 3. `price_chart` - Price Chart

| Property | Value |
|----------|-------|
| **File** | `PriceChartWidget.tsx` |
| **Function** | Interactive candlestick chart with volume histogram using TradingView Lightweight Charts |
| **Default Size** | 6×6 |
| **Parameters** | `timeframe`: "1m" \| "5m" \| "15m" \| "30m" \| "1H" \| "1D" \| "1W" \| "1M" |

**Required Data:**
```typescript
{
  data: Array<{
    time: string;      // ISO 8601 date
    open: number;      // Open price
    high: number;      // High price
    low: number;       // Low price
    close: number;     // Close price
    volume: number;    // Volume
  }>;
}
```

**Data Sources:** vnstock `quote.history()`, cophieu68 `/download/historydaily.php`

---

### 4. `key_metrics` - Key Metrics

| Property | Value |
|----------|-------|
| **File** | `KeyMetricsWidget.tsx` |
| **Function** | Displays valuation (P/E, P/B, P/S, EV/EBITDA), profitability (ROE, ROA, ROIC, margins), financial health (D/E, current ratio), market data (cap, dividend, beta) |
| **Default Size** | 3×8 |

**Required Data:**
```typescript
{
  pe: number;              // P/E ratio
  pb: number;              // P/B ratio
  ps: number;              // P/S ratio
  ev_ebitda: number;       // EV/EBITDA
  roe: number;             // Return on Equity %
  roa: number;             // Return on Assets %
  roic: number;            // Return on Invested Capital %
  net_margin: number;      // Net Profit Margin %
  gross_margin: number;    // Gross Margin %
  debt_to_equity: number;  // D/E ratio
  current_ratio: number;   // Current Ratio
  market_cap: number;      // Market Cap in VND
  dividend_yield: number;  // Dividend Yield %
  beta: number;            // Beta coefficient
}
```

**Data Sources:** vnstock `Screener().stock()` (84 metrics), 24hmoney API

---

### 5. `share_statistics` - Share Statistics

| Property | Value |
|----------|-------|
| **File** | `ShareStatisticsWidget.tsx` |
| **Function** | Shows outstanding shares, float, insider ownership %, institutional ownership % |
| **Default Size** | 3×6 |

**Required Data:**
```typescript
{
  outstanding_shares: number;
  float_shares: number;
  insider_ownership_pct: number;
  institutional_ownership_pct: number;
  foreign_ownership_pct: number;
  foreign_room: number;
}
```

**Data Sources:** vnstock `Company().shareholders()`, cophieu68 foreign data

---

### 6. `screener` - Stock Screener

| Property | Value |
|----------|-------|
| **File** | `ScreenerWidget.tsx` |
| **Function** | 84-metric stock screening table with sorting, filtering by exchange, pagination |
| **Default Size** | 9×8 |
| **Parameters** | `exchange`: "ALL" \| "HOSE" \| "HNX" \| "UPCOM", `limit`: number |

**Required Data:**
```typescript
{
  data: Array<{
    ticker: string;
    price: number;
    change_1d: number;
    market_cap: number;
    pe: number;
    pb: number;
    roe: number;
    volume: number;
    // ... 84 total columns available
  }>;
}
```

**Data Sources:** vnstock `Screener().stock()`, Vietcap screening API

---

### 7. `earnings_history` - Earnings History

| Property | Value |
|----------|-------|
| **File** | `EarningsHistoryWidget.tsx` |
| **Function** | Quarterly earnings table: date, actual EPS, estimated EPS, beat/miss, revenue vs estimate |
| **Default Size** | 6×6 |

**Required Data:**
```typescript
{
  data: Array<{
    date: string;          // Earnings date
    eps: number;           // Actual EPS
    epsEst: number;        // Estimated EPS
    revenue: number;       // Actual revenue (millions)
    revenueEst: number;    // Estimated revenue
    transcript?: string;   // Optional transcript link
  }>;
}
```

**Data Sources:** vnstock `Company().events()`, cafef financial reports

---

### 8. `dividend_payment` - Dividend Payment

| Property | Value |
|----------|-------|
| **File** | `DividendPaymentWidget.tsx` |
| **Function** | Dividend history: ex-date, record date, payment date, cash amount, stock dividend % |
| **Default Size** | 6×6 |

**Required Data:**
```typescript
{
  data: Array<{
    exercise_date: string;
    cash_year: number;
    cash_dividend_percentage: number;
    issue_method: string;
  }>;
}
```

**Data Sources:** vnstock `Company(source='TCBS').dividends()`

---

### 9. `stock_splits` - Stock Splits

| Property | Value |
|----------|-------|
| **File** | `StockSplitsWidget.tsx` |
| **Function** | Stock split history with date and split ratio |
| **Default Size** | 6×4 |

**Required Data:**
```typescript
{
  data: Array<{
    date: string;
    ratio: string;      // e.g., "2:1"
    split_factor: number;
  }>;
}
```

**Data Sources:** vnstock `Company().events()`, cafef

---

### 10. `company_filings` - Company Filings

| Property | Value |
|----------|-------|
| **File** | `CompanyFilingsWidget.tsx` |
| **Function** | SEC-style filings list: date, filing type, title, download link |
| **Default Size** | 6×6 |

**Required Data:**
```typescript
{
  data: Array<{
    date: string;
    type: string;       // "Annual Report", "Quarterly", etc.
    title: string;
    url: string;
  }>;
}
```

**Data Sources:** Company websites, HNX/HOSE announcements

---

### 11. `unified_financials` - Financial Statements

| Property | Value |
|----------|-------|
| **File** | `FinancialsWidget.tsx` |
| **Function** | Unified financial statements and ratios workspace with statement tabs and period controls |
| **Default Size** | 24×10 base size for autofit; user-resizable beyond old fixed-width behavior |
| **Parameters** | Statement and period controls are kept in widget config/runtime state |

**Required Data:**
```typescript
// Income Statement
{
  revenue: number[];           // Array of periods
  cost_of_revenue: number[];
  gross_profit: number[];
  operating_expenses: number[];
  operating_income: number[];
  net_income: number[];
}

// Balance Sheet
{
  total_assets: number[];
  current_assets: number[];
  total_liabilities: number[];
  total_equity: number[];
}

// Cash Flow
{
  operating_cash_flow: number[];
  investing_cash_flow: number[];
  financing_cash_flow: number[];
  net_cash_flow: number[];
}
```

**Data Sources:** VNIBB backend financial endpoints, with widget state persisted through dashboard-backed config

---

### 12. `watchlist` - Watchlist

| Property | Value |
|----------|-------|
| **File** | `WatchlistWidget.tsx` |
| **Function** | User's customizable stock watchlist with real-time price updates, add/remove symbols |
| **Default Size** | 4×6 |

**Required Data:**
```typescript
{
  items: Array<{
    symbol: string;
    name: string;
    price: number;
    change: number;
    changePercent: number;
    volume?: number;
  }>;
}
```

**Data Sources:** VNIBB quote/WebSocket feeds, with symbols and sort state persisted in widget config

---

### 13. Widget State Persistence

These widgets now persist user-owned state via dashboard-backed widget config instead of separate widget-local browser storage keys:

| Widget Type | Persisted State |
|-------------|-----------------|
| `notes` | `notesBySymbol` |
| `watchlist` | `watchlistSymbols`, `watchlistSort` |
| `price_alerts` | `alerts` |
| `peer_comparison` | peers, saved sets, active view, period, heatmap, sort |
| `research_browser` | active source, saved sites, active bookmark, last visited map |

---

### 14. Placeholder Widgets (Need Implementation)

| Widget ID | Current Implementation | Purpose |
|-----------|----------------------|---------|
| `insider_trading` | Uses ShareStatisticsWidget | Insider buy/sell transactions |
| `analyst_estimates` | Uses EarningsHistoryWidget | EPS/Revenue estimates |

---

## OpenBB Target Widgets (40)

### Tier 1: Easy (Use Existing vnstock Data) - 15 widgets

| # | Widget ID | Name | Data Source | Difficulty |
|---|-----------|------|-------------|------------|
| 1 | `news_feed` | Company News | `Company().news()` | 🟢 Easy |
| 2 | `events_calendar` | Corporate Events | `Company().events()` | 🟢 Easy |
| 3 | `major_shareholders` | Major Shareholders | `Company().shareholders()` | 🟢 Easy |
| 4 | `officers_management` | Officers & Mgmt | `Company().officers()` | 🟢 Easy |
| 5 | `subsidiaries` | Subsidiaries | `Company().subsidiaries()` | 🟢 Easy |
| 6 | `intraday_trades` | Intraday Trades | `quote.intraday()` | 🟢 Easy |
| 7 | `price_board` | Multi-Stock Board | `Trading().price_board()` | 🟢 Easy |
| 8 | `financial_ratios` | Ratio History | `Finance().ratio()` | 🟢 Easy |
| 9 | `fund_holdings` | Fund Top Holdings | `Fund().details.top_holding()` | 🟢 Easy |
| 10 | `fund_nav` | Fund NAV Chart | `Fund().details.nav_report()` | 🟢 Easy |
| 11 | `volume_analysis` | Volume Analytics | `Screener()` vol_vs_sma columns | 🟢 Easy |
| 12 | `performance_1y` | 52-Week Performance | `Screener()` prev_1y columns | 🟢 Easy |
| 13 | `technical_signals` | Technical Signals | `Screener()` rsi, macd, breakout | 🟢 Easy |
| 14 | `foreign_trading` | Foreign Activity | `Screener()` foreign columns | 🟢 Easy |
| 15 | `stock_ratings` | TCBS Ratings | `Screener()` rating columns | 🟢 Easy |

### Tier 2: Medium (Combine Data Sources) - 15 widgets

| # | Widget ID | Name | Data Sources | Difficulty |
|---|-----------|------|--------------|------------|
| 16 | `sector_heatmap` | Sector Heatmap | Screener + grouping | 🟡 Medium |
| 17 | `market_overview` | Market Overview | SSI iBoard groups | 🟡 Medium |
| 18 | `industry_cashflow` | Industry Flow | SieuCoPhieu API | 🟡 Medium |
| 19 | `relative_strength` | RS Ranking | 24hmoney rs1m/rs3m | 🟡 Medium |
| 20 | `sector_performance` | Sector Perf | Screener by industry | 🟡 Medium |
| 21 | `eps_growth_chart` | EPS Growth Chart | Finance + charting | 🟡 Medium |
| 22 | `revenue_breakdown` | Revenue Segments | Cafef + parsing | 🟡 Medium |
| 23 | `debt_maturity` | Debt Schedule | Balance sheet parsing | 🟡 Medium |
| 24 | `peer_comparison` | Peer Comparison | Screener by industry | 🟡 Medium |
| 25 | `valuation_multiples` | Valuation Chart | PE/PB over time | 🟡 Medium |
| 26 | `momentum_scanner` | Momentum Scanner | Screener + RS | 🟡 Medium |
| 27 | `volatility_analysis` | Volatility | Price history + calc | 🟡 Medium |
| 28 | `correlation_matrix` | Correlation | Multi-stock prices | 🟡 Medium |
| 29 | `index_components` | Index Components | VN30/VN100 list | 🟡 Medium |
| 30 | `market_breadth` | Advance/Decline | Screener aggregation | 🟡 Medium |

### Tier 3: Advanced (Require Calculation/Scraping) - 10 widgets

| # | Widget ID | Name | Data Sources | Difficulty |
|---|-----------|------|--------------|------------|
| 31 | `dcf_valuation` | DCF Model | Financials + calc | 🔴 Hard |
| 32 | `dupont_analysis` | DuPont Analysis | Financials + calc | 🔴 Hard |
| 33 | `altman_z` | Altman Z-Score | Balance sheet calc | 🔴 Hard |
| 34 | `piotroski_f` | Piotroski F-Score | Financials calc | 🔴 Hard |
| 35 | `options_chain` | Options Chain | Not available VN | 🔴 N/A |
| 36 | `order_flow` | Order Statistics | Vietstock scrape | 🔴 Hard |
| 37 | `money_flow_index` | MFI Indicator | Price+Volume calc | 🔴 Hard |
| 38 | `accumulation_dist` | A/D Line | Price history calc | 🔴 Hard |
| 39 | `sentiment_analysis` | News Sentiment | AI + News parsing | 🔴 Hard |
| 40 | `earnings_transcript` | Earnings Call | External source | 🔴 Hard |

---

## Extended Widgets (60 Total)

Additional widgets from Vietnamese financial sites:

### From 24hmoney

| # | Widget ID | Name | API Endpoint |
|---|-----------|------|--------------|
| 41 | `active_buysell` | Active Buy/Sell Flow | `/stock/{symbol}/transactions` |
| 42 | `sector_moneyflow` | Sector Money Flow | `/recommend/business` |
| 43 | `ev_metrics` | EV Valuation | Screener API ev_per_ebitda |

### From Cophieu68

| # | Widget ID | Name | URL |
|---|-----------|------|-----|
| 44 | `volume_buzz` | Volume Anomalies | `/stats/volume_buzz.php` |
| 45 | `foreign_monthly` | Monthly Foreign Flow | `/stats/foreigner_detail.php` |
| 46 | `balance_summary` | Balance Summary (vt=3) | `/market/markets.php?vt=3` |

### From SSI iBoard

| # | Widget ID | Name | API Endpoint |
|---|-----------|------|--------------|
| 47 | `market_depth` | Market Depth L2 | `/stock/group/{group}` |
| 48 | `realtime_quotes` | Real-time Quotes | WebSocket MQTT |

### From Vietcap

| # | Widget ID | Name | API Endpoint |
|---|-----------|------|--------------|
| 49 | `stock_strength` | Stock Strength RS | `screening/paging` stockStrength |
| 50 | `liquidity_rank` | Liquidity Ranking | `screening/paging` ADTV |

### Calculated/Derived Widgets

| # | Widget ID | Name | Calculation |
|---|-----------|------|-------------|
| 51 | `bollinger_bands` | Bollinger Bands | Price + 20-day MA ± 2σ |
| 52 | `macd_chart` | MACD Chart | EMA(12) - EMA(26) |
| 53 | `rsi_chart` | RSI Chart | 14-period RSI |
| 54 | `moving_averages` | MA Overlay | SMA(5,10,20,50,200) |
| 55 | `profit_margin_trend` | Margin Trend | Financials over time |
| 56 | `cash_conversion` | Cash Conversion | Operating/Net Income |
| 57 | `working_capital` | Working Capital | Current A - Current L |
| 58 | `capex_ratio` | CapEx/Revenue | Cash flow ratio |
| 59 | `dividend_growth` | Div Growth Rate | YoY dividend change |
| 60 | `shareholder_yield` | Shareholder Yield | Div + Buyback yield |

---

## Data Sources Reference

### Primary: vnstock Library (Recommended)

| API | Data | Rate Limit | Best For |
|-----|------|------------|----------|
| `Screener().stock()` | 84 metrics, all stocks | 2/min | Bulk metrics |
| `Listing().all_symbols()` | Stock list | 10/min | Reference data |
| `quote.history()` | OHLCV | 30/min | Price charts |
| `Company().overview()` | Company info | 20/min | Profile widgets |
| `Finance().*` | Financial statements | 15/min | Quarterly analysis |
| `Trading().price_board()` | Real-time prices | 20/min | Watchlists |

### Secondary: Vietnamese Sites

| Source | Specialty | Difficulty | Notes |
|--------|-----------|------------|-------|
| **Cophieu68** | Bulk data, foreign trading | 🟢 Easy | No anti-scrape |
| **24hmoney** | RS metrics, sector flow | 🟡 Medium | Nuxt extraction |
| **SieuCoPhieu** | Industry cashflow | 🟡 Medium | Public API only |
| **SSI iBoard** | Real-time, market depth | 🟡 Medium | Header validation |
| **Vietcap** | Stock strength | 🟡 Medium | JSON API |
| **Cafef** | Historical financials | 🟡 Medium | `pandas.read_html` |
| **Vietstock** | Order statistics | 🔴 Hard | Headless browser |

---

## 2026-02-06 Additions

| Widget Type | File | Primary Data Source | Notes |
|-------------|------|---------------------|-------|
| `research_browser` | `ResearchBrowserWidget.tsx` | localStorage | Iframe embed only; cannot share browser profile/cookies; some sites block embedding |
| `dividend_ladder` | `DividendLadderWidget.tsx` | `/equity/{symbol}/dividends` | Shows ex/record/payment ladder |
| `insider_deal_timeline` | `InsiderDealTimelineWidget.tsx` | `/insider/{symbol}/deals` | Buy/sell summary + timeline |
| `sector_rotation_radar` | `SectorRotationRadarWidget.tsx` | `/trading/sector-performance` | Leaders/laggards by sector |
| `market_breadth` | `MarketBreadthWidget.tsx` | `/screener` | Exchange-based breadth (HOSE/HNX/UPCOM) |
| `technical_snapshot` | `TechnicalSnapshotWidget.tsx` | `/analysis/ta/{symbol}/full` | Daily technical signal summary |
| `ownership_changes` | `OwnershipChangesWidget.tsx` | `/equity/{symbol}/shareholders` | Snapshot only (no history) |
| `market_movers_sectors` | `MarketMoversSectorsWidget.tsx` | `/trading/sector-performance` | Combined movers + sectors |
| `news_corporate_actions` | `NewsCorporateActionsWidget.tsx` | `/equity/{symbol}/news`, `/equity/{symbol}/dividends`, `/insider/{symbol}/deals` | Combined feed |

---

## Widget Implementation Checklist

When implementing a new widget:

- [ ] Add type to `WidgetType` in `dashboard.ts`
- [ ] Create component in `frontend/src/components/widgets/`
- [ ] Register in `WidgetRegistry.ts` with default layout
- [ ] Add to `WidgetLibrary.tsx` catalog
- [ ] Create API query hook in `lib/queries.ts`
- [ ] Add backend endpoint if needed
- [ ] Update this documentation

---

*This document is the source of truth for widget development. Update when adding new widgets.*
