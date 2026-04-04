# TradingView Native Widget Implementation Plan

Date: 2026-04-04

## Goal

Add the TradingView native widget catalog to the app's Global Markets toolkit, make widget settings editable inside the dashboard UI, and persist those settings per widget instance so different dashboards can keep different TradingView configurations.

## Scope

Target widget set:

- Charts: Advanced Chart, Symbol Overview, Mini Chart
- Watchlists: Market Summary, Market Overview, Stock Market, Market Data
- Tickers: Ticker Tape, Ticker Tag, Single Ticker, Ticker
- Heatmaps: Stock Heatmap, Crypto Coins Heatmap, Forex Cross Rates, ETF Heatmap, Forex Heatmap
- Screeners: Screener, Cryptocurrency Market
- Symbol Details: Symbol Info, Technical Analysis, Fundamental Data, Company Profile
- News: Top Stories
- Calendars: Economic Calendar
- Economics: Economic Map

## Current State

- Dashboard widget config already persists through dashboard state and backend sync.
- The app already ships three TradingView embeds: chart, technical analysis, ticker tape.
- Existing TradingView widgets are hard-coded and do not use the generic widget settings modal.
- The Global Markets starter layout is TradingView-first, but it mixes native VNIBB widgets with only a small subset of TradingView-native widgets.

## Architecture

### 1. Central TradingView metadata

Create a single source of truth for TradingView widgets that defines:

- app widget type
- TradingView format: iframe or web component
- script/module source
- default config
- layout defaults
- display name and description
- widget settings fields exposed in-app
- symbol behavior: widget-scoped symbol or no symbol

This metadata will drive:

- widget library registration
- runtime rendering
- settings modal fields
- widget symbol resolution in the dashboard shell
- documentation/catalog output

### 2. Reusable runtime renderer

Build a shared TradingView renderer component that can:

- mount iframe widgets by injecting the official `embed-widget-*.js` scripts
- mount web component widgets by loading TradingView's ES module loader once and rendering the `tv-*` element
- translate app config into TradingView runtime config or element attributes
- rebuild widgets when config changes
- surface load/config errors cleanly inside the widget container

### 3. Per-widget settings UI

Upgrade `WidgetSettingsModal` so TradingView widgets get typed controls for common settings:

- symbol
- theme / color theme
- locale
- autosize / transparent mode
- interval / timeframe
- display mode
- widths / heights where applicable
- symbol lists, currencies, exchange, market, data source, grouping, etc.

Keep the existing advanced JSON editor as a fallback for unsupported or nested TradingView options like tabs, studies, compare symbols, and watchlists.

### 4. Widget symbol ownership

Move TradingView symbol handling out of the current hard-coded `DashboardClient` special case.

The dashboard shell should ask TradingView metadata whether a widget uses:

- a widget-scoped symbol from `widget.config.symbol`
- no symbol at all

This keeps symbol-bearing TradingView widgets independent per dashboard instance.

## Implementation Steps

1. Add the plan and TradingView catalog metadata.
2. Add new TradingView widget types to dashboard typings.
3. Build shared TradingView renderer and wrappers.
4. Migrate existing TradingView chart, technical analysis, and ticker tape widgets onto the shared renderer.
5. Register the remaining TradingView widgets in the widget registry and widget library.
6. Upgrade widget settings modal to render TradingView-specific controls plus advanced JSON.
7. Update Global Markets documentation to reflect TradingView native coverage.
8. Run frontend validation and fix any regressions.

## Non-Goals

- Replacing existing VNIBB-native widgets that serve Vietnam-specific data well.
- Building a full visual copy of TradingView's website-side embed configurator.
- Adding commit/push automation unless explicitly requested.

## Verification

Minimum verification:

- TypeScript compile for the frontend
- Frontend production build

Manual spot checks after build:

- add multiple TradingView widgets to a dashboard
- edit settings through the modal
- confirm the widget re-renders from saved config
- duplicate the widget into another dashboard and verify settings stay instance-local

## Theme Roadmap

- Current default: all TradingView widget defaults are dark-first to match the app's existing dashboard visual language.
- Near-term roadmap: add a top-level app preference that can switch TradingView defaults and preset color tokens between dark and light without requiring per-widget manual edits.
- Existing support: individual TradingView widgets already expose `theme` or `colorTheme` controls in the widget settings modal for manual light-mode testing.
