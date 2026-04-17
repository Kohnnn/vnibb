# Widget Improvement Roadmap

Date: 2026-04-05

## Goal

Improve data correctness, chart semantics, resize behavior, analytical depth, and adjustment-aware price workflows across the widget surface without layering visual polish on top of inconsistent data.

## Canonical References

- `docs/WIDGET_SYSTEM_REFERENCE.md`: canonical non-TradingView widget rules and behavior
- `docs/TRADINGVIEW_WIDGET_CATALOG.md`: TradingView widget coverage and status
- `apps/web/src/data/widgetDefinitions.ts`: widget metadata source of truth
- `apps/web/src/components/widgets/WidgetRegistry.ts`: runtime registry and default layouts

## Status Snapshot

### Shipped

- Phase 1: quarterly data integrity for shared financial period handling
- Phase 2: income sankey and cash flow waterfall model cleanup
- Phase 3: resize/runtime layout reliability improvements for rigid widgets
- Phase 4: sector breakdown and money flow trend decluttering
- Phase 5: valuation history expansion, chronology fixes, and statistical bands
- Phase 6: risk dashboard explanation and warning improvements
- Phase 7A: historical price `adjustment_mode`, adjusted chart toggles, and structured corporate-event classification
- Phase 7B: best-effort corporate-action adjustment factor engine for historical prices

### In Progress / Partial

- Corporate-action support is best-effort, not yet a full institutional total-return engine
- Adjusted-price history is available and quant endpoints now accept `adjustment_mode`, but not every backend stat/derived endpoint is fully action-aware yet

### Not Started

- Full corporate-action propagation through all quant endpoints
- Event markers and action-aware annotations across all chart widgets
- Deeper risk model upgrade with benchmark-relative and downside distribution measures
- Lower-priority backend-ready widget backlog:
  - `ttm_snapshot`
  - `growth_bridge`
  - `ownership_rating_summary`
  - `market_sentiment`
  - expanded derivatives analytics beyond contracts/history
  - broader listing/discovery surfaces beyond the first `listing_browser` pass

## Priority Structure

### P0: Data Correctness

#### P0.1 Quarterly Data Integrity

Status: Shipped

Affected widgets:

- Financial Ratios
- Income Statement
- Balance Sheet
- Cash Flow
- Financial Snapshot
- Earnings History
- Unified financial views that reuse shared period helpers

Delivered:

- backend period normalization for statement and ratio rows
- frontend quarter-only filtering for quarter views
- shared period-label safety so annual rows are not shown as fake quarters
- backend and frontend regression tests

Remaining follow-up:

- runtime QA on more real symbols with sparse/dirty provider payloads

#### P0.2 Price Adjustments And Corporate Actions

Status: Partially shipped

Cross-cutting scope:

- historical prices
- quant metrics
- valuation views
- event-aware charting

Delivered:

- `adjustment_mode` support on historical prices (`raw` or `adjusted`)
- adjusted OHLC derivation from stored `adj_close` when available
- best-effort backward adjustment factors from splits, stock dividends, rights/new issuance, and cash dividends
- frontend raw/adjusted toggle in key chart consumers
- adjusted-history default for risk-oriented consumers
- normalized company-event classification fields for dividends, splits, issuance, and meetings

Remaining follow-up:

- push adjusted-price logic deeper into the remaining backend stat/derived endpoints beyond the main quant set
- add total-return or richer action-aware modes when data quality is good enough
- expand event markers and adjustment explanations beyond the main price-chart surfaces

### P1: Financial Visualization Quality

#### P1.1 Income Sankey

Status: Shipped first pass

Delivered:

- simplified main flow into clearer major nodes
- moved detailed operating and non-operating pieces into breakdown cards
- reduced node and label clutter

Remaining follow-up:

- fine-tune spacing and label density on very wide or very small layouts
- add optional expanded drill-down mode if needed

#### P1.2 Cash Flow Waterfall

Status: Shipped first pass

Delivered:

- removed confusing mid-chart free-cash-flow subtotal bar
- rebuilt the chart as a cleaner bridge from operating cash flow to net cash change
- improved long-label wrapping

Remaining follow-up:

- add optional alternate bridge mode if users want a pure FCF bridge view

### P1: Resize And Layout Reliability

#### P1.3 Runtime Resize Behavior

Status: Shipped first pass

Priority widgets:

- Transaction Flow
- Volume Flow
- Sortino Monthly
- Momentum
- Commodities
- Insider Trading
- Major Shareholders
- Officer & Management
- Foreign Trading
- Intraday Trades
- Order Book

Delivered:

- fixed `layoutHint` handling in `WidgetWrapper` so manual resize is preserved better
- lowered several default/min heights in the widget registry
- reduced rigid min-height pressure in transaction/volume/sortino chart sections

Remaining follow-up:

- add explicit resize regression coverage if this area changes again
- review remaining list-heavy widgets for unnecessary fixed internal sections

### P2: Market Structure And Flow Readability

#### P2.1 Sector Breakdown

Status: Shipped first pass

Delivered:

- ranked bar view instead of cramped donut-first layout
- top 5 / 10 / 20 / all controls
- metric modes for market-cap share, average change, and stock count
- ranked side summary panel

Remaining follow-up:

- add treemap mode if needed
- consider trading-value and trading-volume metrics if backend data is ready

#### P2.2 Money Flow Trend

Status: Shipped first pass

Delivered:

- top 5 / 10 / 20 / all controls
- ranking modes for composite, trend, strength, and change percentage
- dynamic chart axes instead of fixed `80-120`
- label density reduction and better ranked side panel

Remaining follow-up:

- add universe metric choices requested by the user when backend response includes them cleanly
- consider trail toggle and quadrant filters if needed

### P2: Valuation History And Statistical Context

#### P2.3 Valuation Band

Status: Shipped first pass

Delivered:

- added `P/S`, `EV/EBITDA`, and `EV/Sales`
- added mean and `±1σ`, `±2σ` reference context
- fixed oldest-to-newest chronology and deeper history

Remaining follow-up:

- add optional percentile or z-score annotations directly on chart points

#### P2.4 Valuation Multiples Chart

Status: Shipped first pass

Delivered:

- fixed oldest-to-newest chronology
- increased history depth
- added series toggles for readability

Remaining follow-up:

- optionally auto-focus newest viewport while preserving full history context

### P2: Risk UX

#### P2.5 Risk Dashboard

Status: Shipped first pass

Delivered:

- warning banner support for quant-data quality notes
- clearer score explanation and explicit score-driver cards
- responsive underwater chart panel
- better Hurst/latest-data context

Remaining follow-up:

- deeper benchmark-relative risk model
- distribution-aware downside metrics like VaR/CVaR if needed

## TradingView / Global Markets Progress

TradingView work completed in parallel with the widget-improvement roadmap:

- full TradingView native widget catalog registration
- grouped widget settings UI and advanced JSON fallback
- dedicated Global Markets symbol channel isolated from VNIBB stock symbol flow
- admin-managed Global Markets widget settings with existing draft/publish flow
- Global Markets default symbol set to `NASDAQ:VFS`

See also:

- `docs/TRADINGVIEW_WIDGET_CATALOG.md`
- `docs/TRADINGVIEW_WIDGET_IMPLEMENTATION_PLAN.md`
- `docs/TRADINGVIEW_GLOBAL_MARKETS_IMPLEMENTATION_PLAN.md`

## Suggested Next Priorities

1. Finish Phase 7 deeper propagation:
   backend quant endpoints that still assume raw history
2. Add chart/event integration:
   event markers for dividends, splits, issuance
3. Consider the lower-priority data-to-widget expansion set after current surfaces settle:
   TTM snapshot, growth bridge, ownership/rating summary, market sentiment, and richer derivatives widgets
3. Add more money-flow universe metrics if the backend can supply them cleanly
4. Add valuation viewport focus/pinning around the newest range

## Validation Reference

Core validations already exercised during this roadmap execution included combinations of:

- `python -m pytest apps/api/tests/test_api/test_financial_service.py -q`
- `python -m pytest apps/api/tests/test_api/test_equity_ratio_helpers.py -q`
- `python -m pytest apps/api/tests/test_api/test_price_adjustments_and_events.py -q`
- `pnpm --filter frontend test -- --runTestsByPath src/lib/financialPeriods.test.ts src/components/widgets/FinancialRatiosWidget.test.tsx --runInBand`
- `pnpm --filter frontend test -- --runTestsByPath src/lib/financialVisualizations.test.ts --runInBand`
- `python -m py_compile apps/api/vnibb/api/v1/equity.py apps/api/vnibb/services/financial_service.py apps/api/vnibb/providers/vnstock/equity_historical.py apps/api/vnibb/providers/vnstock/company_events.py`
- `pnpm --filter frontend build`
