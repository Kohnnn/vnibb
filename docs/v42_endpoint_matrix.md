# V42 Frontend-Backend Endpoint Matrix

Date: 2026-02-15

This matrix tracks widget-facing frontend calls in `apps/web/src/lib/api.ts` against mounted backend routes under `apps/api/vnibb/api/v1`.

| Frontend helper | Frontend path | Backend route | Status | Notes |
|---|---|---|---|---|
| `getQuote` | `/equity/{symbol}/quote` | `equity.py -> /{symbol}/quote` | ✅ | Core quote payload with change and prevClose. |
| `getProfile` | `/equity/{symbol}/profile` | `equity.py -> /{symbol}/profile` | ✅ | Profile endpoint present. |
| `getCompanyNews` | `/equity/{symbol}/news` | `equity.py -> /{symbol}/news` | ✅ | Mounted under `/api/v1/equity`. |
| `getCompanyEvents` | `/equity/{symbol}/events` | `equity.py -> /{symbol}/events` | ✅ | Present. |
| `getShareholders` | `/equity/{symbol}/shareholders` | `equity.py -> /{symbol}/shareholders` | ✅ | Present. |
| `getOfficers` | `/equity/{symbol}/officers` | `equity.py -> /{symbol}/officers` | ✅ | Present. |
| `getIntraday` | `/equity/{symbol}/intraday` | `equity.py -> /{symbol}/intraday` | ✅ | Added in V42. |
| `getForeignTrading` | `/equity/{symbol}/foreign-trading` | `equity.py -> /{symbol}/foreign-trading` | ✅ | Added in V42; can be sparse depending on provider. |
| `getSubsidiaries` | `/equity/{symbol}/subsidiaries` | `equity.py -> /{symbol}/subsidiaries` | ✅ | Added in V42. |
| `getPriceDepth` | `/equity/{symbol}/orderbook` | `equity.py -> /{symbol}/orderbook` | ✅ | Added in V42 with normalized `entries`. |
| `getTradingStats` | `/equity/{symbol}/trading-stats` | `equity.py -> /{symbol}/trading-stats` | ✅ | Added in V42. |
| `getRating` | `/equity/{symbol}/rating` | `equity.py -> /{symbol}/rating` | ✅ | Added in V42. |
| `getFinancialRatios` | `/equity/{symbol}/ratios` | `equity.py -> /{symbol}/ratios` | ✅ | Present. |
| `getIncomeStatement` | `/equity/{symbol}/income-statement` | `equity.py -> /{symbol}/income-statement` | ✅ | Quarterly filter fixed in V42. |
| `getBalanceSheet` | `/equity/{symbol}/balance-sheet` | `equity.py -> /{symbol}/balance-sheet` | ✅ | Present. |
| `getCashFlow` | `/equity/{symbol}/cash-flow` | `equity.py -> /{symbol}/cash-flow` | ✅ | Present. |
| `getMarketOverview` | `/market/indices` | `market.py -> /indices` | ✅ | Added in V42; frontend aligned. |
| `getTopMovers` | `/market/top-movers` | `market.py -> /top-movers` | ✅ | Frontend aligned in this pass. |
| `getSectorPerformance` | `/market/sector-performance` | `market.py -> /sector-performance` | ✅ | Frontend aligned in this pass. |
| `getWorldIndices` | `/market/world-indices` | `market.py -> /world-indices` | ✅ | Added in completion pass; fallback to VN indices when global feed is unavailable. |
| `getForexRates` | `/market/forex-rates` | `market.py -> /forex-rates` | ✅ | Added in completion pass; uses vnstock VCB exchange rates. |
| `getCommodities` | `/market/commodities` | `market.py -> /commodities` | ✅ | Added in completion pass; uses vnstock gold price helpers. |
| `getMarketHeatmap` | `/market/heatmap` | `market.py -> /heatmap` | ✅ | Present. |
| `getSectorTopMovers` | `/trading/sector-top-movers` | `trading.py -> /sector-top-movers` | ✅ | Legacy trading route kept for sector columns widget. |
| `getChartData` | `/chart-data/{symbol}` | `chart.py -> /{symbol}` | ✅ | Mounted at `/api/v1/chart-data`. |

## V42 endpoint outcome

- No core widget-facing endpoint remains in 404 state.
- New V42 routes are now mounted and callable from web widgets.
- Provider sparsity still exists for some datasets (notably foreign trading and some mover slices), but endpoints degrade gracefully with 200 + empty payloads instead of 404/500.
