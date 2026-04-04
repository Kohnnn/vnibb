# TradingView Native Widget Catalog

Date: 2026-04-04

This document lists the TradingView-native widgets now registered in the frontend widget library.

Source of truth:

- `apps/web/src/lib/tradingViewWidgets.ts`
- `apps/web/src/data/widgetDefinitions.ts`
- `apps/web/src/components/widgets/TradingViewNativeWidgets.tsx`

## Widgets

| App Widget Type | TradingView Widget | Format | Docs |
|---|---|---|---|
| `tradingview_chart` | Advanced Chart | iframe | `https://www.tradingview.com/widget-docs/widgets/charts/advanced-chart/` |
| `tradingview_symbol_overview` | Symbol Overview | iframe | `https://www.tradingview.com/widget-docs/widgets/charts/symbol-overview/` |
| `tradingview_mini_chart` | Mini Chart | Web Component | `https://www.tradingview.com/widget-docs/widgets/charts/mini-chart/` |
| `tradingview_market_summary` | Market Summary | Web Component | `https://www.tradingview.com/widget-docs/widgets/watchlists/market-summary/` |
| `tradingview_market_overview` | Market Overview | iframe | `https://www.tradingview.com/widget-docs/widgets/watchlists/market-overview/` |
| `tradingview_stock_market` | Stock Market | iframe | `https://www.tradingview.com/widget-docs/widgets/watchlists/stock-market/` |
| `tradingview_market_data` | Market Data | iframe | `https://www.tradingview.com/widget-docs/widgets/watchlists/market-quotes/` |
| `tradingview_ticker_tape` | Ticker Tape | Web Component | `https://www.tradingview.com/widget-docs/widgets/tickers/ticker-tape/` |
| `tradingview_ticker_tag` | Ticker Tag | Web Component | `https://www.tradingview.com/widget-docs/widgets/tickers/ticker-tag/` |
| `tradingview_single_ticker` | Single Ticker | iframe | `https://www.tradingview.com/widget-docs/widgets/tickers/single-ticker/` |
| `tradingview_ticker` | Ticker | iframe | `https://www.tradingview.com/widget-docs/widgets/tickers/ticker/` |
| `tradingview_stock_heatmap` | Stock Heatmap | iframe | `https://www.tradingview.com/widget-docs/widgets/heatmaps/stock-heatmap/` |
| `tradingview_crypto_heatmap` | Crypto Coins Heatmap | iframe | `https://www.tradingview.com/widget-docs/widgets/heatmaps/crypto-heatmap/` |
| `tradingview_forex_cross_rates` | Forex Cross Rates | iframe | `https://www.tradingview.com/widget-docs/widgets/heatmaps/forex-cross-rates/` |
| `tradingview_etf_heatmap` | ETF Heatmap | iframe | `https://www.tradingview.com/widget-docs/widgets/heatmaps/etf-heatmap/` |
| `tradingview_forex_heatmap` | Forex Heatmap | iframe | `https://www.tradingview.com/widget-docs/widgets/heatmaps/forex-heatmap/` |
| `tradingview_screener` | Screener | iframe | `https://www.tradingview.com/widget-docs/widgets/screeners/screener/` |
| `tradingview_crypto_market` | Cryptocurrency Market | iframe | `https://www.tradingview.com/widget-docs/widgets/screeners/crypto-mkt-screener/` |
| `tradingview_symbol_info` | Symbol Info | iframe | `https://www.tradingview.com/widget-docs/widgets/symbol-details/symbol-info/` |
| `tradingview_technical_analysis` | Technical Analysis | iframe | `https://www.tradingview.com/widget-docs/widgets/symbol-details/technical-analysis/` |
| `tradingview_fundamental_data` | Fundamental Data | iframe | `https://www.tradingview.com/widget-docs/widgets/symbol-details/fundamental-data/` |
| `tradingview_company_profile` | Company Profile | iframe | `https://www.tradingview.com/widget-docs/widgets/symbol-details/company-profile/` |
| `tradingview_top_stories` | Top Stories | iframe | `https://www.tradingview.com/widget-docs/widgets/news/top-stories/` |
| `tradingview_economic_calendar` | Economic Calendar | iframe | `https://www.tradingview.com/widget-docs/widgets/calendars/economic-calendar/` |
| `tradingview_economic_map` | Economic Map | Web Component | `https://www.tradingview.com/widget-docs/widgets/economics/economic-map/` |

## Notes

- TradingView widget settings are editable in-app through `WidgetSettingsModal`.
- Common options are exposed as typed controls, grouped by widget section where TradingView exposes a richer settings surface.
- `Advanced Chart` now includes grouped controls for chart visuals, indicators, compare symbols, watchlist symbols, and additional toolbar/popup options.
- `Market Overview` and `Market Data` now support TradingView-compatible preset builders for tabs and symbol groups, including cross-asset macro and Vietnam/regional risk presets, while advanced JSON still supports fully custom payloads.
- `Fundamental Data` now exposes a friendlier `Financial Panel` preset selector such as `Overview`, `Valuation`, `Profitability`, `Growth`, `Balance Sheet`, and `Cash Flow`, with manual `fieldGroups` and `columns` editors still available.
- Symbol-bearing TradingView widgets now support an app-level `Sync With Global Markets Symbol` option so linked chart and company-detail widgets can follow the same TradingView/global-market ticker across dashboards without changing the VNIBB stock-symbol flow.
- The shared TradingView/global-market default symbol is `NASDAQ:VFS`.
- On the admin-managed `Global Markets` system dashboard, widget settings are read-only until Admin Mode is enabled. After edits, use `Save Draft` or `Publish Global` from the floating admin controls to ship them.
- Dark mode is the default across TradingView widgets today. Light mode is still available per widget, and a future app-level theme pass can promote that into a global TradingView theme preference.
- Symbol-bearing TradingView widgets still keep a widget-local symbol in config, but linked TradingView widgets now resolve from the dedicated shared Global Markets symbol channel.
- The default Global Markets starter layout was updated to use a TradingView-native mix instead of the earlier mixed native/TradingView setup.
