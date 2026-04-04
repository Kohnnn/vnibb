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
- `apps/web/src/data/widgetDefinitions.ts`: widget metadata source of truth
- `apps/web/src/components/widgets/WidgetRegistry.ts`: runtime registry and layout defaults

## Source Of Truth

- Widget metadata: `apps/web/src/data/widgetDefinitions.ts`
- Runtime registry: `apps/web/src/components/widgets/WidgetRegistry.ts`
- Size contracts and autofit: `apps/web/src/lib/dashboardLayout.ts`
- Dashboard templates: `apps/web/src/types/dashboard-templates.ts`
- Dashboard persistence/runtime state: `apps/web/src/contexts/DashboardContext.tsx`

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

## Financial Widget Rules

- Financial statement and ratio widgets render oldest to newest.
- Financial tables auto-scroll to the newest periods on first render so the latest data is visible by default.
- Growth badges still compare current values against the older adjacent period.
- Quarter identities should be canonicalized before display or filtering.
- Bare year rows should not be fabricated into fake quarter labels.
- Quarter views should not mix annual rows into quarterly tables/charts.

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

## Shell / Workspace Rules

- The app stores the last active dashboard and the last active tab per dashboard locally.
- Low-resolution layouts should treat VniAgent as an overlay sooner to protect workspace width.
- Header and tab-strip controls should collapse or simplify earlier instead of forcing horizontal crowding.

## USD Display

- `USD` is available for financial and statement-style widgets.
- User overrides are stored locally by report year.
- Missing yearly overrides fall back to the admin global default USD/VND rate.
- Broader USD conversion for quote and market widgets remains separate roadmap work.

## Screener / AI Notes

- Screener Pro persists quick filters, advanced filter-builder state, sorting, and screen config in widget config.
- Prompt library behavior is VniAgent-owned.
- Global prompt actions should open the VniAgent sidebar first.

## Related Docs

- `docs/WIDGET_IMPROVEMENT_ROADMAP.md`
- `docs/TRADINGVIEW_WIDGET_CATALOG.md`
- `docs/WIDGET_CATALOG.md` (legacy snapshot)
