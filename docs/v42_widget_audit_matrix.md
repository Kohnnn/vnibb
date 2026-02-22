# V42 Widget Audit Matrix

Date: 2026-02-15
Updated: 2026-02-22

Audit method:
- Static wiring check from `WidgetRegistry.ts` + API hook paths.
- Backend endpoint smoke checks for core market/equity/chart routes.
- Fast pass runtime validation via build/type/lint.

Status buckets:
- `✅ Works`: wired and expected to render non-empty data in normal conditions.
- `⚠️ Partial`: wired but data quality/provider coverage or UX remains limited.
- `❌ Broken`: known rendering or data-path failure.
- `🔲 No endpoint`: frontend route exists but backend route missing.

| Widget | Status | Primary data path | Notes |
|---|---|---|---|
| Ticker Info | ✅ Works | `/equity/{symbol}/quote` + profile + screener cap | Includes prev close + market cap in V42 pass. |
| Price Chart (Local) | ✅ Works | `/chart-data/{symbol}` | Default 10Y enabled. |
| Key Metrics | ✅ Works | screener + `/equity/{symbol}/ratios` fallback | Core valuation/profitability rows present. |
| Screener | ✅ Works | `/screener` | Symbol mapping and fallback paths already fixed. |
| Market Overview | ✅ Works | `/market/indices` | Frontend aligned to market router. |
| Top Movers | ✅ Works | `/market/top-movers` | Aligned in V42 completion pass. |
| Sector Performance | ✅ Works | `/market/sector-performance` | Aligned in V42 completion pass. |
| Sector Top Movers | ✅ Works | `/trading/sector-top-movers` | Sector columns render via trading route. |
| Order Book | ✅ Works | `/equity/{symbol}/orderbook` | Uses normalized `entries` payload. |
| Intraday Trades | ✅ Works | `/equity/{symbol}/intraday` | Tick table wired with side coloring. |
| Financials (Unified) | ✅ Works | `/equity/{symbol}/financials` + statement routes | Quarter parsing fix applied server-side. |
| Income Statement | ✅ Works | `/equity/{symbol}/income-statement` | Quarterly bug fixed in V42. |
| Balance Sheet | ✅ Works | `/equity/{symbol}/balance-sheet` | Wired. |
| Cash Flow | ✅ Works | `/equity/{symbol}/cash-flow` | Wired. |
| Financial Ratios | ✅ Works | `/equity/{symbol}/ratios` | Wired. |
| Market News | ✅ Works | `/news/*` aggregate hooks | HTML/date parsing hardening applied. |
| Research Browser | ✅ Works | External/embed hybrid | Fallback card mode for blocked embeds. |
| News Flow | ✅ Works | `/news/flow` | Unified stream available. |
| Company Filings | ✅ Works | Company endpoints | 14x5 local matrix (timeout=10) returns loaded for all test symbols. |
| Share Statistics | ✅ Works | Screener/profile-derived fields | Multi-source fallback + source labels validated in 14x5 local matrix. |
| Peer Comparison | ✅ Works | comparison endpoints + peers | Loaded for all 5 test symbols in latest local matrix run. |
| Foreign Trading | ✅ Works | `/equity/{symbol}/foreign-trading` | Loaded across 14x5 local matrix target symbols. |
| Sector Breakdown | ⚠️ Partial | `/market/heatmap` | Empty-heatmap fallback fixed; payload now non-empty but still sector-poor (`Other`-heavy) due sparse industry metadata. |
| Watchlist | ✅ Works | mixed quote paths | Latest 14x5 local matrix run returns loaded for all test symbols. |
| Portfolio Tracker | ✅ Works | quote + local state | Loaded for all 5 test symbols in latest local matrix run. |
| Price Alerts | ✅ Works | quote + local state | Loaded for all 5 test symbols in latest local matrix run. |
| Technical Summary | ✅ Works | analysis routes | TA fallback fix + latest local matrix show loaded for all test symbols. |
| Technical Snapshot | ✅ Works | analysis routes | TA fallback fix + latest local matrix show loaded for all test symbols. |
| World Indices | ✅ Works | `/market/world-indices` | Endpoint timeout path tuned; now returns fallback payload within matrix timeout budget. |
| Forex Rates | ✅ Works | `/market/forex-rates` | Wired to VCB exchange-rate feed via vnstock explorer helpers. |
| Commodities | ✅ Works | `/market/commodities` | Wired to BTMC/SJC gold feeds via vnstock explorer helpers. |
| Quick Stats | ✅ Works | quote + ratios + historical | Stabilized query path in V47 with dedicated quote/ratios hooks and partial-load fallback behavior. |
| Similar Stocks | ✅ Works | peers/screener | Loaded for all 5 test symbols in latest local matrix run. |
| Market Heatmap | ✅ Works | `/market/heatmap` | Endpoint present and wired. |
| Ownership Changes | ✅ Works | ownership endpoints | Loaded for all 5 test symbols in latest local matrix run. |

## Summary

- `✅ Works`: 34
- `⚠️ Partial`: 1
- `❌ Broken`: 0 (in this static+wiring audit)
- `🔲 No endpoint`: 0 for core V42 scope

## Remaining carryover to V43

- Close remaining partial widget (`Sector Breakdown`) with final UI-side validation after latest industry enrichment.
- Reconcile production runtime health (502/timeout) with local matrix outcomes before deployment promotion.
- Continue light-mode visual pass across long-tail widgets.
