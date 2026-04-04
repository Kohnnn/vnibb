# Widget Reference

Last updated: 2026-04-04

## Source Of Truth

- Widget metadata: `apps/web/src/data/widgetDefinitions.ts`
- Runtime registry: `apps/web/src/components/widgets/WidgetRegistry.ts`
- Size contracts and autofit: `apps/web/src/lib/dashboardLayout.ts`
- Dashboard template catalog: `apps/web/src/types/dashboard-templates.ts`

## Canonical Widget IDs

Use these canonical IDs in templates, migrations, docs, and runtime logic:

- `ticker_profile`
- `unified_financials`
- `major_shareholders`
- `database_inspector`

Legacy aliases such as `company_profile`, `financials`, `institutional_ownership`, and `database_browser` are migrated out of saved dashboards on load.

## New Widgets

- `financial_snapshot`: combined P&L, balance sheet, cash flow, and ratio snapshot rendered as four dense statement tables.
- `earnings_release_recap`: quarter recap widget combining income statement deltas, cash-flow context, earnings-quality checks, company events, and company news.

## Persistence Rules

Widget-owned state should persist through dashboard-backed widget config so it follows Appwrite-authenticated dashboard sync.

Current config-backed widget state includes:

- `notes`
- `watchlist`
- `price_alerts`
- `peer_comparison`
- `research_browser`

## Resize Rules

- Base widget sizes are for autofit and initial placement.
- Manual resizing should not be blocked by legacy saved `maxW` and `maxH` caps.
- Existing dashboards are migrated to strip stale layout caps.
- Dense table and list widgets should favor wrapping and scrolling over fixed truncation where practical.

## Financial Widget Defaults

- `unified_financials`, `income_statement`, `balance_sheet`, `cash_flow`, `financial_ratios`, and `financial_snapshot` now render periods in chronological ascending order.
- These tables auto-scroll to the newest periods on first render so the latest data is visible by default while older history remains accessible to the left.
- Growth badges still compare current values against the older adjacent period.
- Quarter identities should be treated as canonicalized before display or filtering; mixed raw forms should not produce duplicate visible quarter columns.

## History Caps

- Current annual and quarterly caps are intentionally retained to avoid first-load regressions and oversized financial payloads.
- Broader 10Y normalization is a planned future optimization, not part of the current default history window.

## Workspace Persistence

- The app stores the last active dashboard ID and the last active tab per dashboard locally.
- This is separate from the `defaultTab` preference, which remains a preference fallback rather than the sole source of startup navigation.

## USD Display

- `USD` is now a valid unit display mode for financial and statement-style widgets.
- User overrides are stored locally by report year.
- Missing yearly overrides fall back to the admin global default USD/VND rate.
- Quote/market widgets are not converted to USD yet; that remains future roadmap work.

## Low-Resolution UX

- On tighter desktop viewports, VniAgent should overlay instead of permanently shrinking the main workspace.
- Header and tab-strip controls should prefer collapsing, wrapping, or hiding labels earlier rather than forcing horizontal crowding.
- The header is now intentionally search-first and no longer tries to keep all branding/symbol/index chips visible at the same time.

## Template Rules

Both template surfaces should consume the canonical template catalog in `apps/web/src/types/dashboard-templates.ts`.

Template categories:

- `market`
- `fundamentals`
- `technical`
- `quant`
- `research`
- `global`

## VniAgent Rules

- Global prompt actions should open the VniAgent sidebar first.
- The prompt library is owned by VniAgent, not a disconnected modal.
- Default prompt behavior is prefill, not auto-send.

## Appwrite / AI Notes

- App-default copilot mode normalizes unsupported legacy providers back to `openrouter`.
- Copilot no longer depends on browser-side Appwrite JWT minting for the streaming chat route.
- Browser-side Appwrite JWT mint failures now back off before retry to avoid repeated noisy failures when Appwrite platform CORS is misconfigured.
