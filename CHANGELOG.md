# Changelog

## 2026-02-24 - Sprint V61 to V66

### Backend and data pipeline execution
- Hardened API connectivity flow with CORS/health route alignment, websocket/API routing refinements, and backend health signal handling updates.
- Extended sector and heatmap intelligence using broader Vietnamese industry normalization and snapshot-aware sector symbol derivation.
- Improved screener and comparison enrichment pipeline paths in `data_pipeline`/`comparison_service`, including additional ratio fallback hydration.
- Enriched `/equity/{symbol}/dividends` with normalized payout classification (`cash`/`stock`/`mixed`), cleaned null-only records, annual DPS rollups, and computed dividend yield from latest available price.
- Added operational repair utilities for batch refreshes:
  - `apps/api/scripts/v62_financial_resync.py`
  - `apps/api/scripts/v64_screener_enrich.py`

### Frontend stability and light-mode polish
- Improved Top Movers data resilience by parsing mixed payload key styles and deriving change percent when only absolute change/price is present.
- Increased light-theme readability for dashboard controls and labels in header/sidebar/copilot components.
- Updated dividend-related widgets (`Dividend Payment`, `Dividend Ladder`, `News + Corporate Actions`, `Ticker Profile`) to render normalized payout type/value and yield metadata safely across mixed payload formats.
- Continued dashboard connectivity hardening via backend status checks and sync handling updates.

### Verification and release notes
- Backend tests: `pytest tests -q` (74 passed).
- Frontend quality gate: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm build` (all passed).
- Checklist run: `python -X utf8 .agent/scripts/checklist.py .` (5/6 passed; UX audit still reports repository-wide heuristic issues).
- Production verification remains blocked by upstream deploy health: `/api/v1/health` and key data endpoints currently return `502`, so post-deploy revalidation is required.

## 2026-02-23 - Sprint V53 to V56

### Backend data completeness and intelligence
- Expanded financial statement and ratio persistence in the sync pipeline to reduce null-heavy income, balance, cashflow, and ratio payloads.
- Upgraded peer selection to prioritize same-industry peers, then same-exchange candidates, then market-cap proximity with deterministic ranking.
- Reworked market heatmap aggregation to use real DB-derived change percentages and robust sector/industry grouping instead of mock/random change values.
- Added dynamic `/sectors` symbol population from database metadata and market-cap ranking; enhanced `/sectors/{sector}/stocks` with richer matching and computed `change_pct`.
- Improved profile enrichment fallback in equity API with derived market cap and listing date/contact-aware projection from cached/company data.

### Frontend stability and UX hardening
- Fixed Sector Top Movers null-formatting crash and hardened payload compatibility across `sectors`/`data` response variants.
- Restored legacy widget compatibility by mapping `tradingview_chart` to the current `price_chart` widget and advanced dashboard migration version.
- Reduced light-mode dark artifacts by replacing hardcoded dark surfaces with tokenized backgrounds and light-theme overrides.
- Improved modal readability and backdrop quality for Apps Library and Template Selector.
- Added resilient company logo fallback chain (Clearbit, favicon services, initials fallback).
- Improved admin health dashboard endpoint resolution so `/health/detailed` is requested from the root API host even when API base includes `/api/v1`.
- Updated dividend widget rendering to suppress null-value rows and align table styling with theme variables.

### Quality gates completed
- Backend tests: `pytest apps/api/tests -q` (71 passed)
- Frontend checks: `pnpm --filter frontend exec tsc --noEmit`, `pnpm --filter frontend lint`, `pnpm --filter frontend build`

## 2026-02-22 - Sprint V46 to V52

### Data fixes
- Expanded financial statement fields in backend providers/services and equity API payloads for income statement, balance sheet, and cash flow.
- Added ratio enrichment coverage and additional ratio DTO fields (growth and dividend-oriented metrics included).
- Added new V50 endpoints for parity: peers, TTM aggregates, growth rates, and sector stock drill-down.
- Added comparison path alias support and no-trailing-slash compatibility for screener/comparison routes.
- Hardened market heatmap behavior with stale-cache fallback, explicit provider timeout guard, and safe empty-state response fallback.

### UI/UX fixes
- Migrated modal and command palette surfaces to opaque theme-token based styling to resolve transparency and dark-stuck issues.
- Extended light/dark-safe token migration across key dashboard widgets and screener controls.
- Improved template selector previews with richer visual cards.
- Added runtime stale-tab cleanup and improved empty-tab quick-add actions.
- Added chart mount guards for multiple financial widgets to reduce hidden-container chart dimension warnings.

### New features and parity improvements
- Added frontend support for peers endpoint and expanded financial typings.
- Expanded financial widgets to render newly available statement/ratio fields.
- Continued parity work for comparison analysis and period-aware data flows in V52 track.

### Quality gates completed
- Backend tests: `cd apps/api && pytest tests -q` (70 passed)
- Focused API regressions: smoke endpoints and sector endpoint suites passing
- Frontend lint/build passing
- Monorepo lint/test/build passing

### Deployment readiness notes
- Code-level fixes are ready for deployment.
- Latest production probe before deploy still reflects old deployment behavior on new V49/V50 routes.
- Post-deploy verification should re-run endpoint matrix and widget smoke checks.
