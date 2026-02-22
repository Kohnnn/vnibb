# Widget Catalog (V52)

Date: 2026-02-22

This catalog lists widget types currently registered in `apps/web/src/data/widgetDefinitions.ts`.

Total registered widgets: **59**.

## Category summary

- `core_data`: 39
- `charting`: 3
- `calendar`: 7
- `ownership`: 8
- `estimates`: 1
- `screener`: 1
- `analysis`: 2

## Widgets

| Widget | Type | Category | Primary data source |
|---|---|---|---|
| Ticker Info | `ticker_info` | core_data | `GET /equity/{symbol}/quote` |
| Company Profile | `ticker_profile` | core_data | `GET /equity/{symbol}/profile` |
| Key Metrics | `key_metrics` | core_data | `GET /equity/{symbol}/ratios`, `GET /equity/{symbol}/metrics/history` |
| Share Statistics | `share_statistics` | core_data | `GET /equity/{symbol}/trading-stats`, `GET /equity/{symbol}/ownership` |
| Company News | `news_feed` | core_data | `GET /equity/{symbol}/news` |
| Price Chart | `price_chart` | charting | `GET /equity/historical` |
| Valuation Multiples Chart | `valuation_multiples_chart` | charting | `GET /equity/{symbol}/ratios/history` |
| Earnings History | `earnings_history` | calendar | `GET /equity/{symbol}/financials` |
| Events Calendar | `events_calendar` | calendar | `GET /equity/{symbol}/events` |
| Dividend Payment | `dividend_payment` | calendar | `GET /equity/{symbol}/dividends` |
| Stock Splits | `stock_splits` | calendar | `GET /equity/{symbol}/events` |
| Company Filings | `company_filings` | calendar | `GET /equity/{symbol}/events`, provider-derived filings feed |
| Institutional Ownership | `institutional_ownership` | ownership | `GET /equity/{symbol}/ownership` |
| Insider Trading | `insider_trading` | ownership | `GET /insider/{symbol}/deals`, `GET /insider/recent` |
| Major Shareholders | `major_shareholders` | ownership | `GET /equity/{symbol}/shareholders` |
| Officers & Management | `officers_management` | ownership | `GET /equity/{symbol}/officers` |
| Analyst Estimates | `analyst_estimates` | estimates | `GET /analysis/*`, provider-derived estimate snapshots |
| Stock Screener | `screener` | screener | `GET /screener` |
| Intraday Trades | `intraday_trades` | core_data | `GET /equity/{symbol}/intraday` |
| Financial Ratios | `financial_ratios` | core_data | `GET /equity/{symbol}/ratios`, `GET /equity/{symbol}/growth`, `GET /equity/{symbol}/ttm` |
| Foreign Trading | `foreign_trading` | ownership | `GET /equity/{symbol}/foreign-trading` |
| Subsidiaries | `subsidiaries` | ownership | `GET /equity/{symbol}/subsidiaries` |
| Balance Sheet | `balance_sheet` | core_data | `GET /equity/{symbol}/balance-sheet` |
| Income Statement | `income_statement` | core_data | `GET /equity/{symbol}/income-statement` |
| Cash Flow | `cash_flow` | core_data | `GET /equity/{symbol}/cash-flow` |
| Market Overview | `market_overview` | core_data | `GET /market/indices` |
| Market Breadth | `market_breadth` | core_data | `GET /market/top-movers`, `GET /market/sector-performance` |
| Watchlist | `watchlist` | core_data | Local dashboard state + quote/profile endpoints |
| Peer Comparison | `peer_comparison` | core_data | `GET /equity/{symbol}/peers`, `GET /comparison` |
| Top Gainers/Losers | `top_movers` | core_data | `GET /market/top-movers` |
| World Indices | `world_indices` | core_data | `GET /market/world-indices` |
| Sector Performance | `sector_performance` | core_data | `GET /market/sector-performance`, `GET /market/heatmap` |
| Sector Rotation Radar | `sector_rotation_radar` | core_data | `GET /market/sector-performance`, `GET /sectors` |
| Market Movers & Sectors | `market_movers_sectors` | core_data | `GET /market/top-movers`, `GET /trading/sector-top-movers` |
| Portfolio Tracker | `portfolio_tracker` | core_data | Local portfolio state + quote endpoints |
| Price Alerts | `price_alerts` | core_data | `GET /alerts/insider`, `POST /alerts/{id}/read`, local notification state |
| Economic Calendar | `economic_calendar` | calendar | `GET /equity/{symbol}/events`, calendar composites |
| Dividend Ladder | `dividend_ladder` | calendar | `GET /equity/{symbol}/dividends` |
| Volume Analysis | `volume_analysis` | core_data | `GET /equity/historical`, `GET /equity/{symbol}/intraday` |
| Technical Summary | `technical_summary` | core_data | `GET /analysis/ta/{symbol}/full` |
| Technical Snapshot | `technical_snapshot` | charting | `GET /analysis/ta/{symbol}/history` |
| Forex Rates | `forex_rates` | core_data | `GET /market/forex-rates` |
| Commodities | `commodities` | core_data | `GET /market/commodities` |
| Similar Stocks | `similar_stocks` | core_data | `GET /equity/{symbol}/peers` + local similarity heuristics |
| Quick Stats | `quick_stats` | core_data | Quote, profile, and ratios composite calls |
| Notes | `notes` | core_data | Local dashboard persistence |
| Research Browser | `research_browser` | analysis | External URLs in embedded browser + local saved links |
| Insider Deal Timeline | `insider_deal_timeline` | ownership | `GET /insider/{symbol}/deals`, `GET /insider/recent` |
| Ownership Changes | `ownership_changes` | ownership | `GET /equity/{symbol}/ownership` |
| Data Browser | `database_inspector` | core_data | `GET /admin/data-health`, admin table/query endpoints |
| Order Book | `orderbook` | core_data | `GET /equity/{symbol}/orderbook` |
| Index Comparison | `index_comparison` | core_data | `GET /market/indices`, `GET /market/world-indices` |
| Market News | `market_news` | core_data | `GET /news/*`, `GET /market/research/rss-feed` |
| Sector Breakdown | `sector_breakdown` | core_data | `GET /market/heatmap`, `GET /sectors` |
| Comparison Analysis | `comparison_analysis` | core_data | `GET /comparison`, `GET /comparison/performance` |
| News Flow | `news_flow` | core_data | `GET /news/*`, `GET /equity/{symbol}/news` |
| News + Corporate Actions | `news_corporate_actions` | core_data | `GET /equity/{symbol}/news`, `GET /equity/{symbol}/events`, insider feeds |
| AI Analysis | `ai_analysis` | analysis | `POST /copilot/ask`, `GET /copilot/suggestions`, Gemini-backed analysis service |
| Sector Top Movers | `sector_top_movers` | core_data | `GET /trading/sector-top-movers`, `GET /sectors/{sector}/stocks` |

## Notes

- This document reflects registered widget definitions, not all component files under `src/components/widgets`.
- Some widgets combine multiple APIs and local dashboard state for filtering, caching, and layout persistence.
- Source providers include vnstock-backed services and cached VNIBB API responses.
