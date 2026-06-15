# Turtle-Inspired Company Analysis And Quant Progress

Date: 2026-06-14

## Goal

Build VNIBB-native versions of the Turtle-inspired workflows using VNIBB's own vnstock/Vietcap/Mongo corpus:

- full company description and fundamental analysis: dinh gia, phan tich co ban, phan tich tong quan, loi the canh tranh
- screener presets with pass reasons
- safe quant/backtesting foundation
- documented plan/progress so future agents can continue without re-reading the crawl

Turtle remains product inspiration only. Do not copy Turtle source, styling, private payloads, or endpoint contracts.

## Data Source Decision

Use VNIBB's corpus, not Turtle scraping:

- `company.info` for company overview, business model, profile/history, listing metadata
- `company.news`, `company.events`, `company.officers`, `company.subsidiaries`, `company.affiliate`, `reference.shareholders`
- `finance.income_statement`, `finance.balance_sheet`, `finance.cash_flow`, `finance.ratio`
- `market_fundamental_screener` for intrinsic value, margin of safety, moat, dividend years, FCF flag, growth CAGRs
- `market_prices_eod` for quant/backtesting and market diagnostics

## Workstreams

### 1. Company Fundamental Analysis

Status: implemented backend + frontend slice, then enriched with valuation and competitive-advantage sections.

Backend endpoint:

- `GET /api/v1/equity/{symbol}/fundamental-analysis`
- Composes existing read paths and degrades section-by-section.
- Returns profile, latest ratio/financial snapshot, statements, ratios, shareholders, officers, subsidiaries, news, events, and `section_errors`.
- Explicitly returns `valuation`, `competitive_advantage`, and `fundamental_snapshot` from `market_fundamental_screener` when Mongo is configured.

Frontend:

- `FundamentalAnalysisWidget` added and registered.
- `TickerProfileWidget` now renders the full `profileData.description` when available instead of only a generic industry sentence.

Remaining follow-ups:

- Consider adding `company.affiliate` and raw `business_model` fields from Mongo `company.info` if not already exposed through profile cache.
- Add deeper Vietnamese/English copy and source drilldowns in the final UI.

### 2. Screener Presets

Status: implemented frontend-only initial slice.

Added built-in presets:

- `cheap_profitable`
- `dividend_quality`
- `growth_reasonable_price`
- `low_debt_compounder`
- `fcf_margin_expansion`

Added derived frontend `pass_reason` column for preset rows.

Follow-ups:

- Move preset evaluation/pass reasons backend-side if users need export/API consistency.
- Add more presets later: `banking_strength`, `foreign_accumulation`, `rs_breakout_watch`.
- Add coverage badges when required fields are missing.

### 3. Quant Backtest Foundation

Status: implemented minimal backend endpoint, parameter sweep endpoint, and frontend Backtest Lab.

Backend endpoint:

- `POST /api/v1/quant/{symbol}/backtest`
- Schema-driven only; no arbitrary strategy code.
- Supports `moving_average_crossover` with `fast_window`, `slow_window`, `initial_capital`, `fee_bps`, period/source/adjustment controls.
- Returns metrics, equity curve summary, trade list, warnings, and metadata.

Sweep endpoint:

- `POST /api/v1/quant/{symbol}/sweep`
- Bounded moving-average grid over `fast_windows` and `slow_windows`.
- Returns compact cells plus best row ranked by selected objective.

Frontend:

- `BacktestLabWidget` added and registered.
- Exposes period, fast MA, slow MA, return, max drawdown, Sharpe, trade count, and recent trade list.

Remaining follow-ups:

- Add data coverage/debug details to response.
- Add one Turtle-style strategy schema: Donchian breakout.
- Add frontend Sweep Matrix widget for `POST /quant/{symbol}/sweep`.

### 4. Existing Dependency Context

Pre-existing uncommitted work remains relevant:

- quant benchmark-risk alias fix in `apps/api/vnibb/api/v1/quant.py`
- statement unit outlier repair in `apps/api/vnibb/services/fundamental_valuation.py`
- related backend tests

Do not revert these. They improve correctness for the new fundamental and quant work.

## Verification Log

Agent-level verification already completed:

- `rtk pytest apps/api/tests/test_api/test_equity_ratio_helpers.py -q`: 16 passed
- `python -m py_compile apps/api/vnibb/api/v1/equity.py`: passed
- `rtk pytest apps/api/tests/test_api/quant_endpoint_test.py -q`: 30 passed
- `python -m py_compile apps/api/vnibb/api/v1/quant.py`: passed
- `pnpm --filter frontend exec tsc --noEmit`: passed in frontend agent
- `pnpm --filter frontend lint`: passed in frontend agent

Full verification:

- `rtk pnpm run ci:gate`: passed
- Frontend: lint passed, typecheck passed, production build passed, Jest `79` tests passed
- Backend: compile check passed, pytest `358` tests passed

Latest full verification after completing next tranches:

- `rtk pnpm run ci:gate`: passed
- Frontend: lint passed, typecheck passed, production build passed, Jest `79` tests passed
- Backend: compile check passed, pytest `360` tests passed

## Registration Checklist

For `fundamental_analysis`, registration was added in:

- `apps/web/src/types/dashboard.ts`
- `apps/web/src/components/widgets/WidgetRegistry.ts`
- `apps/web/src/components/widgets/index.ts`
- `apps/web/src/lib/dashboardLayout.ts`
- `apps/web/src/data/widgetDefinitions.ts`
- `apps/web/src/lib/widgetDescriptions.ts`
- `apps/web/src/contexts/DashboardContext.tsx`

For `backtest_lab`, registration was added in:

- `apps/web/src/types/dashboard.ts`
- `apps/web/src/components/widgets/WidgetRegistry.ts`
- `apps/web/src/components/widgets/index.ts`
- `apps/web/src/lib/dashboardLayout.ts`
- `apps/web/src/data/widgetDefinitions.ts`
- `apps/web/src/lib/widgetDescriptions.ts`
- `apps/web/src/contexts/DashboardContext.tsx`

## Next Implementation Order

1. Add frontend Sweep Matrix widget for `POST /quant/{symbol}/sweep`.
2. Add data coverage/debug drawer for backtest runs.
3. Add Donchian breakout as the next safe schema-driven strategy.

## Balanced Initial Workspace Rollout

Status: shipped.

Goal: make the four Initial system dashboards a balanced default and surface the new `backtest_lab` / `sweep_matrix` quant widgets to existing and global users.

Built-in fallback (code):

- `createMainSystemDashboard` (`default-fundamental`): balanced 7 tabs - `Discovery`, `Fundamentals`, `Overview`, `Company`, `Ownership`, `Comparison`, `News & Events`.
- `createQuantSystemDashboard` (`default-quant`): `Quant` tab now ends with `backtest_lab` + `sweep_matrix`.
- `createTechnicalSystemDashboard` / `createGlobalMarketsDashboard`: structure preserved.
- `CURRENT_MIGRATION_VERSION` bumped `20 -> 21` with a `refreshSystemDashboardTemplates` step so users already at v20 pick up the new quant widgets.

Database publish (global):

- The four templates were re-published through `PUT /api/v1/admin/system-layouts/{dashboard_key}` because published DB templates override the code fallback on load.
- Payloads were generated from the real factories via `src/contexts/__generators__/systemLayoutPayloads.gen.test.ts` (`GENERATE_SYSTEM_LAYOUTS=1`) to avoid transcription drift.
- See `docs/WIDGET_SYSTEM_REFERENCE.md` -> "Dual-source publish" for the full flow.
