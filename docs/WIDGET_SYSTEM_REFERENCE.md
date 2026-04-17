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

## Shell / Workspace Rules

- The app stores the last active dashboard and the last active tab per dashboard locally.
- Low-resolution layouts should treat VniAgent as an overlay sooner to protect workspace width.
- Header and tab-strip controls should collapse or simplify earlier instead of forcing horizontal crowding.
- Recoverable widget/runtime failures should surface in UI state first; production builds should avoid noisy browser-console logging for handled widget errors, export failures, and local fallback paths.

## USD Display

- `USD` is available for financial and statement-style widgets.
- User overrides are stored locally by report year.
- Admin runtime config now supports both a global USD/VND fallback and per-year admin defaults.
- Effective rate precedence is `local year override -> admin year default -> admin global fallback -> hardcoded fallback`.
- Broader USD conversion for quote and market widgets remains separate roadmap work.

See also: `docs/USD_DISPLAY_ARCHITECTURE.md`.

## Screener / AI Notes

- Screener Pro persists quick filters, advanced filter-builder state, sorting, and screen config in widget config.
- Prompt library behavior is VniAgent-owned.
- Global prompt actions should open the VniAgent sidebar first.

## Related Docs

- `docs/WIDGET_IMPROVEMENT_ROADMAP.md`
- `docs/TRADINGVIEW_WIDGET_CATALOG.md`
- `docs/WIDGET_CATALOG.md` (legacy snapshot)
