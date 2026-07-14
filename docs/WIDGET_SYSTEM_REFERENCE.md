# Widget System Reference

Date: 2026-04-05

## Purpose

This is the canonical high-level reference for the non-TradingView widget system.

Use this document for:

- canonical widget/documentation rules
- resize and persistence behavior
- financial widget display rules
- template and shell behavior notes

Use these related docs for specialized areas:

- `docs/WIDGET_IMPROVEMENT_ROADMAP.md`: priority roadmap and shipped status
- `docs/TRADINGVIEW_WIDGET_CATALOG.md`: TradingView widget coverage and status
- `docs/TRADINGVIEW_SETTINGS_ARCHITECTURE.md`: TradingView settings modal behavior, runtime transforms, and admin editability rules
- `apps/web/src/data/widgetDefinitions.ts`: widget metadata source of truth
- `apps/web/src/components/widgets/WidgetRegistry.ts`: runtime registry and layout defaults

## Source Of Truth

- Widget metadata: `apps/web/src/data/widgetDefinitions.ts`
- Runtime registry: `apps/web/src/components/widgets/WidgetRegistry.ts`
- Size contracts and autofit: `apps/web/src/lib/dashboardLayout.ts`
- Dashboard templates: `apps/web/src/types/dashboard-templates.ts`
- Dashboard persistence/runtime state: `apps/web/src/contexts/DashboardContext.tsx`

Layout note:

- The effective placement/default size contract now comes from `apps/web/src/lib/dashboardLayout.ts`.
- Widget-library size badges are derived from that contract so the displayed size matches actual widget insertion behavior.
- `widgetDefinitions.ts` and `WidgetRegistry.ts` keep mirrored defaults for discoverability, but the layout contract remains the operative source of truth.

## Canonical Widget IDs

Use canonical IDs in templates, migrations, docs, and runtime logic.

Important canonical IDs:

- `ticker_profile`
- `unified_financials`
- `major_shareholders`
- `database_inspector`

Legacy aliases such as `company_profile`, `financials`, `institutional_ownership`, and `database_browser` should not be used in new logic.

## Current Widget Additions

- `financial_snapshot`: combined P&L, balance sheet, cash flow, and ratio snapshot
- `earnings_release_recap`: quarter recap combining statement deltas, cash-flow context, quality checks, and linked news/events
- `world_news_monitor`: live Vietnam and global RSS/Atom news monitor with article, source, feed links, custom feed input, and stronger duplicate filtering
- `world_news_map`: SVG world map for live world-news article density, source/coverage geography, latest headlines, regional view controls, and custom feed input
- `world_news_live_stream`: polling live headline stream for global and Vietnam market-risk monitoring
- `world_news_sources`: source registry audit surface with homepage, feed, geography, tier, region, category, and language metadata
- `polymarket` (expanded): canonical taxonomy now covers `economic | sports | politics | general`, so Pop Culture / Crypto / politics markets render instead of being silently dropped
- `kalshi`: Kalshi CFTC-regulated public-market ingestion rendered through the shared `PredictionMarketSource` factory
- `election_odds`: side-by-side Polymarket vs Kalshi politics composite with a consensus readout
- `prediction_movers`: top markets by |signed Δ probability| between the latest and windowed baseline snapshots; sub-24h windows use intraday snapshots and longer windows use nightly snapshots (24h default)
- `macro_calibration`: four-tile summary of the `/estimate/{cpi,fed,recession,macro}` outputs
- `consensus_odds`: multi-source readout aggregating Polymarket and Kalshi rows on the same question
- **`prediction_market_lifecycle`**: see the section below

## Prediction-Market Family

Phase 7 added a vertical prediction-market surface from ingestion to quant
dashboards. Phase 8 (this doc's update) hardens the family, adds an
intraday micro-snapshot job, and ships four new widgets (Alerts, Drift,
Pulse, Deep-Dive drawer) plus three new read endpoints. Phase v2.x
populates the snapshot tables on every cold boot via the one-shot
`populate_prediction_markets_now` scheduler job, broadens the election
filter into a topic-driven regex, ships resilient retries + offline seed
fixtures for PredictIt / Limitless / Manifold, and adds a full UX
overhaul (shared primitives in
`apps/web/src/components/widgets/prediction-market-ui/`).

The data flow:

```
Polymarket Gamma ─┐
                  │
Kalshi Trades v2 ─┤
                  ├─► prediction_market_service.py / kalshi_service.py
PredictIt         │            │
                  │            │   ↑ populates extra.canonical_topics
Limitless         │            │
                  │            ▼
Manifold        ──┘   prediction_markets (DB table, source-agnostic)
                              │
                              ▼
        /api/v1/prediction-markets  (?category ?topic ?search)
        /api/v1/prediction-markets/movers?window_hours
        /api/v1/prediction-markets/alerts?window_hours
        /api/v1/prediction-markets/consensus?query
        /api/v1/prediction-markets/spread
        /api/v1/prediction-markets/{source}/{source_id}/history?days
        /api/v1/prediction-markets/cross-calibration
        /api/v1/prediction-markets/estimate/{cpi,fed,recession,macro}
                              │
                              ▼
        Polymarket / Kalshi / ElectionOdds / PredictionMovers / Consensus /
        TopMoversPulse / SourceDrift / PredictionAlerts / PredictionMarketDrawer
        PredictIt / Limitless / Manifold (all share PredictionMarketSourceWidget)
                              │
                              ▼
        nightly snapshot job → prediction_market_snapshots (30-day retention)
        intraday micro-snapshot job (15-min cadence, 7-day retention)
        one-shot backfill on first boot → 7d × 2 snapshots/day if table < 100 rows
                              │
                              ▼
        MacroCalibrationWidget (cached 600s) with confidence pills
        CrossSourceCalibrationWidget (per-source probability bars)

Conventions:

- The `category` column carries the canonical taxonomy
  (`economic | sports | politics | general`). The freeform original is
  preserved under `extra.raw_category` whenever the ingestion path stores
  extra metadata; downstream consumers should query by the canonical value.
- `extra.canonical_topics` derives a semantic list (`election`, `macro`,
  `sports`, `crypto`) from question text + raw category; the read
  endpoint exposes it via `?topic=election` to broaden the ElectionOdds
  widget past the upstream's mis-tagged market list.
- The `source` column is a free lower-case slug (`polymarket`, `kalshi`,
  `predictit`, `limitless`, `manifold`, …) and the read endpoint filters by exact match.

### Sources

| Source | API | Auth | Rate limit | Cadence | Taxonomy mapping |
|--------|-----|------|------------|---------|------------------|
| Polymarket Gamma | `https://gamma-api.polymarket.com/markets` | none | generous | every 5 min | `economic | sports | politics | general` |
| Kalshi Trades | `https://api.elections.kalshi.com/trade-api/v2/markets` | none | 60 req/min | every 5 min | `economic | sports | politics | general` |
| PredictIt | `https://www.predictit.org/api/markets` | none | ~30 req/min | every 5 min | `politics | general` |
| Limitless | `https://api.limitless.exchange/markets` | none | generous | every 5 min | `crypto | general` |
| Manifold | `https://api.manifold.markets/v0` | none | generous | every 5 min | freeform under `extra.raw_category` |

Each source shares the `_upsert_prediction_market` upsert from `prediction_market_service`,
so the schema is source-agnostic and the read endpoint can blend across all of them.

Phase 9 adds PredictIt and Limitless. Phase 10 adds Manifold. Each phase's ingest is
wrapped in a `try / except` at the scheduler layer so one source going down does not
poison the others (only the affected source's count is missing from the log line).
Phase v2.x layers in `prediction_market_http.fetch_json_with_retry` for retries +
content-type validation and a fallback `prediction_market_seed` path that reads
checked-in JSON fixtures (`apps/api/vnibb/services/seed_fixtures/*`) when the live
APIs return 429 / non-JSON.

### Cross-Source Calibration widget (Phase 10)

`/prediction-markets/cross-calibration` aggregates per-topic consensus across all five
sources (Polymarket, Kalshi, PredictIt, Limitless, Manifold where tagged). The widget
shows three tiles (CPI / Fed / Recession) with one row per source and a
`sources_agree` indicator (green when the spread between min and max consensus is
below a per-topic threshold — 5pp CPI / 8pp Fed / 12pp Recession — otherwise amber).
- Snapshot retention is 30 days; anything older is removed by the
  ingestion-time housekeeping pass.
- Estimator results are cached in-process for 600 s (`vnibb.core.cache`).
  Coordinated invalidation across workers is out of scope for v1.

The full developer doc lives in
`apps/api/vnibb/services/prediction_market_estimator.py` (functions
`estimate_cpi`, `estimate_fed`, `estimate_recession`,
`estimate_macro_composite`).

### Prediction-market UX primitives

All prediction-market widgets share a folder of visual primitives under
`apps/web/src/components/widgets/prediction-market-ui/`:

- `ProbabilityBar` — full-width horizontal progress bar with optional
  now-vs-open delta marker (green→amber→red gradient).
- `ProbabilityGauge` — semi-circle gauge for KPI tiles
  (`MacroCalibrationWidget`, `ElectionOddsWidget`).
- `Sparkline` — small inline SVG line chart (extracted from
  `TopMoversPulseWidget` and `PredictionMarketDrawer`).
- `ConsensusStrip` — per-source comparator for any per-row sidebar.
- `SearchBar` — debounced search input with clear button.
- `SortButton` / `CategoryPills` — light toggle pills used for sort /
  category filtering.
- `PredictionMarketWatchlistProvider` — localStorage-backed favorites
  store used by the context menu.
- `PredictionMarketContextMenu` — right-click menu exposing "Open in
  drawer", "Copy market link", "Open on {source}", "Add to watchlist".

The shared `PredictionMarketSourceWidget` (rendered via `SourceWidget`)
applies these primitives per-row and adds click-through to the
`PredictionMarketDrawer`. Each of the source-specific wrappers
(PolymarketWidget, KalshiWidget, PredictItWidget, LimitlessWidget,
ManifoldWidget) is now a one-liner.

### One-shot populate (Phase v2.x)

`apps/api/vnibb/services/populate_prediction_markets.py`
runs a sequenced pass over every source, falls back to offline seed
fixtures when a live API is unreachable, fires the nightly + intraday
snapshot jobs, and backfills the snapshot table when fewer than 100 rows
exist. It's scheduled by the scheduler boot guard as a one-shot job,
and exposed via `populate_prediction_markets_now()` so deployments can
invoke it from a CLI script (see
`apps/api/vnibb/scripts/populate_prediction_markets.py`).

## Dashboard Persistence Hardening (Phase 0)

Before Phase 0, dashboard sync was prone to a 422 storm against
`PATCH /api/v1/dashboard/` whenever the dashboard was still a local
`dash-…` placeholder. The bug surface is now closed:

- `useDashboardSync.toBackendPayload` strips undefined keys and only
  serialises fields the backend actually echoes back.
- The sync loop skips the PATCH when `parseNumericDashboardId` is null so
  placeholder IDs never reach the wire.
- An in-flight `useRef` guard prevents overlapping runs from producing
  duplicate 422s.
- `api.updateDashboard` refuses non-numeric IDs at the boundary and
  rethrows with descriptive context.
- Backend `DashboardUpdate` schema now declares
  `model_config = ConfigDict(extra="forbid")` so future contract drift
  surfaces as a 422 instead of silently accepting data.

A regression test lives in
`apps/api/tests/test_api/test_dashboard_sync.py` and the smoke test in
Phase 5 of the plan calls for the `polymarket` widget to survive a
refresh on a fresh dashboard.

## Colorblind Mode (Phase 3 / DEF-03)

A shared `useColorblind()` hook (`apps/web/src/lib/colorblind.ts`) tracks
`html[data-color-mode="colorblind"]` and `apps/web/src/app/globals.css`
remaps legacy `text-emerald-*` / `bg-emerald-*` / `border-emerald-*`
Tailwind classes onto the canonical positive/negative tokens so the
palette swap propagates to widgets that haven't migrated to the token
system yet. The helper exposes `colorblindClass(intent, suffix)` for new
code paths.

## Persistence Rules

Widget-owned state should persist through dashboard-backed widget config so it follows dashboard sync and published system layouts.

Current config-backed widget state includes:

- `notes`
- `watchlist`
- `price_alerts`
- `peer_comparison`
- `research_browser`
- TradingView widget settings and TradingView-linked symbol behavior

Browser-only storage should stay limited to device-local behavior such as notification permission hints and lightweight recent UI picks.

## System Dashboard Editing

- The four shipped system dashboards (`default-fundamental`, `default-technical`, `default-quant`, `default-global-markets`) are admin-managed surfaces.
- Users should customize layouts in their own workspace dashboards instead of editing the shipped system dashboards directly.
- Widget settings on system dashboards stay read-only until Admin Mode is enabled.
- After editing a system dashboard widget, admins still need to use the floating system dashboard controls to `Save Draft` or `Publish Global`.
- System dashboard template refreshes are migration-driven; shipped layout improvements are applied to the admin-managed system dashboards through the dashboard migration flow.

### Dual-source publish (code fallback + database)

System dashboard layouts have two sources, and both must be updated together when shipping a layout change for existing/global users:

1. Built-in fallback factories in `apps/web/src/contexts/DashboardContext.tsx` (`createMainSystemDashboard`, `createTechnicalSystemDashboard`, `createQuantSystemDashboard`, `createGlobalMarketsDashboard`). These are applied locally via `refreshSystemDashboardTemplates` during a `CURRENT_MIGRATION_VERSION` bump.
2. Database-published templates served by `GET /api/v1/dashboard/system-layouts/published`. On load the frontend applies these via the `APPLY_SYSTEM_TEMPLATES` action **after** local migration, so a published template overrides the code fallback for that dashboard.

Implications:

- A code-only change does not reach users who already have a published template for that key until the database template is re-published (or removed).
- Bump `CURRENT_MIGRATION_VERSION` and add a `refreshSystemDashboardTemplates` migration step whenever the built-in factories change, so local fallback users (and offline/no-DB-template cases) pick up the new layout.
- Re-publish the four templates (`default-fundamental`, `default-technical`, `default-quant`, `default-global-markets`) through `PUT /api/v1/admin/system-layouts/{dashboard_key}` (requires `X-Admin-Key`) so global users get the same layout.

To avoid hand-transcription drift between the code factories and the published payloads, generate the publish JSON directly from the factories:

```
# from vnibb/apps/web
GENERATE_SYSTEM_LAYOUTS=1 OUT_DIR=../../.tmp/system-layouts \
  pnpm jest --runTestsByPath src/contexts/__generators__/systemLayoutPayloads.gen.test.ts
```

The generator (`src/contexts/__generators__/systemLayoutPayloads.gen.test.ts`) mirrors `DashboardClient.serializeSystemDashboardForPublish`, emits deterministic widget IDs, and is a no-op (guard-only) during the normal `ci:gate` Jest run. Publish each emitted `{dashboard_key}.json` body with the admin endpoint, then confirm version increments via `GET /api/v1/dashboard/system-layouts/published`.

## Resize Rules

- Base widget sizes are for autofit and initial placement.
- Manual resizing should not be blocked by stale `maxW` / `maxH` caps.
- Runtime auto-compact behavior should only shrink genuinely empty widgets and should not override manual resize after data is present.
- Dense table and list widgets should prefer wrapping and scrolling over fixed truncation where practical.

Recent resize/runtime cleanup covered these widgets in particular:

- `transaction_flow`
- `volume_flow`
- `sortino_monthly`
- `momentum`
- `commodities`
- `insider_trading`
- `major_shareholders`
- `officers_management`
- `foreign_trading`
- `intraday_trades`
- `orderbook`

Chart-hosting rule:

- Widgets using `ResponsiveContainer height="100%"` should mount inside an explicit-height host instead of relying on `min-height` alone.
- `industry_bubble` now uses an explicit chart-height host to avoid silent no-SVG mounts when grid sizing settles late.
- `orderbook` now renders its cumulative depth chart inside an explicit-height host above the depth table.
- `relative_rotation` now renders a quadrant chart scaffold even when benchmark-relative data is unavailable, so the widget no longer collapses into a chart-less empty state.
- `market_heatmap` now computes its D3 treemap from live container dimensions instead of a fixed `800x500`-style canvas assumption.
- `sector_board` columns now stretch to fill wide containers instead of leaving large dead areas when the sector count is low.
- `market_breadth` now renders exchange cards whenever breadth rows exist, even if totals are temporarily zero.
- TradingView wrappers should show a visible loading overlay while upstream scripts/iframes initialize so slow third-party widgets do not look broken.
- TradingView quote-table presets should prefer quote-friendly tradable proxies over sparse index-only symbols when the widget needs OHLC/change fields.
- TradingView widget settings are exposed through a typed modal, but preset fields may expand into nested TradingView payloads at runtime.
- The settings modal now shows the effective runtime payload preview so admins can verify what is actually sent to TradingView.

## Financial Widget Rules

- Financial statement and ratio widgets render oldest to newest.
- Financial tables auto-scroll to the newest periods on first render so the latest data is visible by default.
- Growth badges still compare current values against the older adjacent period.
- Quarter identities should be canonicalized before display or filtering.
- Bare year rows should not be fabricated into fake quarter labels.
- Quarter views should not mix annual rows into quarterly tables/charts.

## Technical / Market Visual Rules

- `technical_summary` now includes a visual signal-distribution gauge alongside the buy/neutral/sell counts.
- `orderbook` includes both a cumulative depth chart and the existing row-level depth table.
- `relative_rotation` should prefer rendering the quadrant chart first, then layer metrics and trail details around it.
- main historical price charts should show corporate-action markers for dividends, splits, and rights/stock-dividend actions when those events are available in-range.

## History / Valuation Rules

- Valuation widgets now favor deeper oldest-to-newest history.
- Valuation bands support richer multiple sets and statistical overlays.
- Current adjusted-price groundwork exists, but not every quant/stat endpoint is fully adjustment-aware yet.

## Template Rules

Both template surfaces should consume `apps/web/src/types/dashboard-templates.ts` as the canonical template catalog.

Template categories:

- `market`
- `fundamentals`
- `technical`
- `quant`
- `research`
- `global`

Recent shipped system template changes:

- Fundamental `Overview` now favors price chart plus company/profile context instead of a tall left-side metric tower.
- Fundamental `Fundamentals` now uses a balanced 2x2 financial-statement grid with synced period controls.
- Fundamental `Ownership` now includes `share_statistics` and `subsidiaries`, and no longer wastes half the tab on tiny cards.
- Technical `Overview` now centers on price chart plus signal summary, momentum, volume, and ATR context.
- Technical `Trading` removes duplicate foreign-trading placement and gives order-flow widgets usable height.
- Technical `Market` increases top-row market widget height and gives heatmap / sector board more responsive room.
- Quant `Market` removes duplicate `rs_ranking` / `relative_rotation` placement in favor of broader market context widgets.
- Global Markets and News & Events templates now include the World Monitor suite (`world_news_map`, `world_news_live_stream`, `world_news_monitor`, `world_news_sources`) so live external source links, source geography, and source registry auditability are available in default workspaces.

Template selector UX rules:

- Template cards should make the primary action visible with an explicit `Use Template` CTA instead of relying on hidden hover overlays.
- Template discovery should support searching by template name, template description, and included widget names.
- Template cards should expose workflow intent, widget count, notable data dependencies such as `Live RSS` or `TradingView`, and whether a template can be used without a symbol.
- Template previews should reflect actual layout proportions from `apps/web/src/types/dashboard-templates.ts` rather than generic placeholder grids.
- Template cards should list the first several included widgets so users can decide without opening documentation.

Widget library UX rules:

- The widget drawer is an `Add Widgets` command surface, not only a raw component list.
- Curated bundles should appear before categories when no search is active. Current bundles are `World Monitor Suite`, `Market Pulse Pack`, and `Fundamental Core`.
- Individual widget rows/cards should expose scope, data source, and default size from the shared layout contract.
- Primary add actions should remain visible. Batch selection stays available, but checkboxes should not be the only obvious affordance.
- Search should match widget names, descriptions, keywords, and user-facing bundle/data language where practical.

## Dashboard Intelligence

- Shared dashboard intelligence now analyzes active-tab widget layouts using the same size contracts defined in `dashboardLayout.ts`.
- The shell can now detect:
  - duplicate non-repeatable widget types in a tab
  - compacted sparse widgets that are likely carrying empty-state dead space
  - widgets that are below their recommended height and may clip content
  - very dense tabs that would benefit from a compact or analyst-friendly re-layout
- Tab-level recommendation banners are visible during edit mode, or automatically when a tab looks materially dead.
- Per-widget layout-fit guidance appears in edit mode when a widget is clearly undersized or auto-compacted into a sparse state.

## Discovery Surfaces

- `listing_browser` is now a discovery-first universe browser rather than a plain listing dump.
- `listing_browser` should support exchange, index-group, industry, and search filtering together, plus browser-local saved views.
- `market_sentiment` should act as a top-down narrative discovery widget, pairing aggregate mood with trending topics and most-mentioned stocks.
- `world_news_monitor`, `world_news_map`, and `world_news_live_stream` should preserve source transparency by showing original article links, source homepage links, and feed links for every headline.
- `world_news_monitor` and `world_news_map` should expose request-scoped custom RSS/Atom inputs while keeping the maintained registry as the default source set.
- `world_news_map` should render a recognizable world-map surface with graticule, land masses, regional view controls, and source/coverage markers instead of abstract geography blobs.
- `world_news_sources` should preserve source transparency by exposing the maintained source registry, homepage links, feed URLs, geography, tier, region, category, and language metadata.
- `ttm_snapshot` should compress trailing-twelve-month income, cash flow, and balance-sheet scale into a fast current-state pulse.
- `growth_bridge` should compare annual growth with the latest comparable-quarter growth so users can detect acceleration or stall quickly.
- `ownership_rating_summary` should synthesize concentration, foreign participation, and insider bias into a compact ownership-quality readout.
- `derivatives_analytics` should extend derivatives discovery beyond a simple contract list by exposing front-contract pulse and short-curve structure.

## Shell / Workspace Rules

- The app stores the last active dashboard and the last active tab per dashboard locally.
- Low-resolution layouts should treat VniAgent as an overlay sooner to protect workspace width.
- Header and tab-strip controls should collapse or simplify earlier instead of forcing horizontal crowding.
- Recoverable widget/runtime failures should surface in UI state first; production builds should avoid noisy browser-console logging for handled widget errors, export failures, and local fallback paths.

## Data Quality / Empty States

- Shared data-quality status now uses a lightweight `WidgetHealthState` model.
- `WidgetMeta` can render explicit health badges such as cached snapshot, stale snapshot, limited history, coverage gap, and awaiting snapshot.
- `WidgetEmpty` can render the same health labels plus a short explanatory detail line.
- Use these explicit states when the widget is functioning correctly but the upstream feed is sparse, stale, cached, or not yet published.

Current first-wave coverage includes:

- `MarketBreadthWidget`
- `RelativeRotationWidget`
- `TransactionFlowWidget`
- `ForeignTradingWidget`

Expected behavior:

- coverage or publication gaps should not look like render failures
- cached or stale snapshots should be labeled as such in widget meta
- sparse provider support should explain itself in the empty state instead of only saying "No data"

## USD Display

- `USD` is available for financial and statement-style widgets.
- User overrides are stored locally by report year.
- Admin runtime config now supports both a global USD/VND fallback and per-year admin defaults.
- Effective rate precedence is `local year override -> admin year default -> admin global fallback -> hardcoded fallback`.
- Broader USD conversion for quote and market widgets remains separate roadmap work.

See also: `docs/USD_DISPLAY_ARCHITECTURE.md`.

## Adjustment-Aware Analytics

- quant endpoints now support `adjustment_mode` so frontend quant and risk widgets can stay aligned with adjusted history.
- quant and risk widgets should prefer adjusted history by default unless a specific surface explicitly needs raw behavior.
- main price-chart surfaces now render compact corporate-action markers for dividends, splits, and rights-related actions.

## Risk Model

- the quant API now supports a `benchmark_risk` metric family anchored on `VNINDEX`.
- `RiskDashboardWidget` and `QuantSummaryWidget` now surface benchmark-relative drawdown, rolling beta, tracking error, downside deviation, and 95% VaR/CVaR.
- current benchmark-relative risk visuals are card/panel first; deeper dedicated time-series panels remain follow-up work.

## Screener / AI Notes

- Screener Pro persists quick filters, advanced filter-builder state, sorting, and screen config in widget config.
- Prompt library behavior is VniAgent-owned.
- Global prompt actions should open the VniAgent sidebar first.

## Related Docs

- `docs/WIDGET_IMPROVEMENT_ROADMAP.md`
- `docs/TRADINGVIEW_WIDGET_CATALOG.md`
- `docs/WIDGET_CATALOG.md` (legacy snapshot)
