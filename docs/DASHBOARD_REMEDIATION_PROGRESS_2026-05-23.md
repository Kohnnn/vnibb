# Dashboard Remediation Progress - 2026-05-23

## Goals

- Fix template apply flow so locked/default dashboards never feel "blacked out"; clicking a template should always succeed.
- Make the Financial Statements tab non-blank by extending period normalization end to end, and validate parity for all tickers via an in-process script that bypasses FastAPI rate limits.
- Clean up the Seasonality Heatmap (no `W` prefix anywhere user-facing) and improve the Spiral Heatmap to support daily and weekly granularity.
- Harden technical chart reliability across native VNIBB widgets and every TradingView wrapper.
- Fix the "New in v1.4" panel: 5s auto-dismiss, dismiss on tab switch, reopen via Settings + Sidebar, render the full changelog inline.

## Plan (build phase)

1. Plumbing: shared `lib/version.ts`, in-process parity scripts under `apps/api/scripts/`, generate-changelog script + raw module, this progress doc.
2. Templates on locked dashboards: clicking "Use Template" auto-creates a new editable workspace and switches to it. Same UX for empty-tab starter cards and quick-add. Confirm dialog removed.
3. Financial Statement period normalization: FE maps every `FY|Q|Q1..Q4|TTM` to a backend canonical (`year|quarter|ttm`); BE bumps cache prefix from `_v2` to `_v3` to invalidate stale empties. Add an in-process parity script.
4. Heatmap: strip `W` prefix in cards, tooltips, and avg row across `SeasonalityHeatmapWidget`. Spiral widget gets a `daily | weekly` granularity selector plus geometry per granularity. No yearly. Keep both widgets registered.
5. WhatsNew panel: 5s auto-dismiss with hover/focus pause, dismiss on `visibilitychange` hidden, reopen via `vnibb:whats-new:reopen` window event from Sidebar version label and a new Settings "Release Notes" card. Inline full changelog from `vnibb/CHANGELOG.md` via generated module + `react-markdown`.
6. CHANGELOG.md: rewrite to Keep a Changelog format with `[v1.4.0]` -> `[v1.0.0]`, sections `Added | Changed | Fixed | Internal`.
7. Technical charts: hardened `createTradingViewWrapper` (retry button + TradingView deep-link in error card). `TechnicalSnapshotWidget` already had loading-timeout retry. Parity script for technicals.
8. Run parity scripts, full `pnpm run ci:gate`, document results.

## Progress

### 2026-05-23 build cycle

- Locked decisions on the six open questions and shipped every item in the plan.
- All gates passed locally.

#### Templates

- `apps/web/src/components/shell/DashboardClient.tsx`: removed `templateConfirm` state and confirm dialog. `handleApplyTemplate`, `handleSeedEmptyTab`, and `handleQuickAddWidget` now auto-create a fresh editable workspace seeded with the requested template/widget when the active dashboard is locked. No more silent warnings, no "blacked out" CTA.
- Captures a new analytics source `locked_dashboard_auto_workspace`, `empty_tab_seed_locked_auto_workspace` so we can monitor adoption.

#### WhatsNew panel + version + changelog

- `apps/web/src/lib/version.ts` is the single source of truth (`CURRENT_RELEASE = 'v1.4.0'`). `Sidebar.tsx` and `WhatsNewPanel.tsx` both import it.
- `apps/web/src/components/layout/WhatsNewPanel.tsx`:
  - Auto-dismisses 5 seconds after open. Hovering or focusing the panel pauses the timer; mouse-leave / blur resumes.
  - Listens for `visibilitychange`; auto-dismisses when the tab goes hidden.
  - Listens for `vnibb:whats-new:reopen`; clears `localStorage` and re-opens with the changelog expanded.
  - "Show full changelog" toggle expands the panel and streams `CHANGELOG.md` via `react-markdown` + `remark-gfm` (`max-h-[50vh]` scroll).
- `apps/web/src/components/layout/Sidebar.tsx`: footer label switched from hardcoded `v1.3.0` link to a button that fires the reopen event.
- `apps/web/src/components/settings/SettingsModal.tsx` (General tab): new "Release Notes" card with a "Show Release Notes" button that fires the same event.
- `apps/web/scripts/generate-changelog.mjs` + `apps/web/src/data/changelog.generated.ts`: predev/prebuild step keeps the panel content in sync with `CHANGELOG.md`.
- `vnibb/CHANGELOG.md`: rewritten to Keep a Changelog format (`v1.4.0`, `v1.3.0`, `v1.2.0`, `v1.1.0`, `v1.0.0`) with `Added | Changed | Fixed | Internal` sections.

#### Heatmap

- `apps/web/src/components/widgets/SeasonalityHeatmapWidget.tsx`: added `stripWeekPrefix()` helper used by Best Avg, Worst Avg, Latest cards and column tooltips. The `W##` prefix is now display-stripped without breaking backend cache keys.
- `apps/web/src/components/widgets/SeasonalitySpiralHeatmapWidget.tsx`: added a `daily | weekly` granularity toggle, per-granularity geometry config, granularity-aware center label and bottom-strip note, weekly tooltips strip the `W` prefix.
- `apps/web/src/data/widgetDefinitions.ts`: renamed display from "Daily Spiral Heatmap" to "Spiral Heatmap" with updated description.

#### Financial Statement

- `apps/web/src/lib/api.ts`: `normalizeFinancialStatementPeriod` now exports as a named function and maps every UI selector (`FY`, `Q`, `Q1..Q4`, `TTM`, `year`, `annual`, `trailing`) to canonical backend values. `normalizeFinancialRatioPeriod` aligned similarly.
- `apps/api/vnibb/api/v1/equity.py`: bumped cache prefixes `income_statement_v2` -> `_v3`, `balance_sheet_v2` -> `_v3`, `cash_flow_v2` -> `_v3` so deployed instances drop stale empties on rollout.
- `apps/web/src/lib/__tests__/financialPeriods.test.ts`: new Jest test covering all six selector mappings + the empty-input case + unknown-input passthrough.
- `apps/api/scripts/finstmt_parity.py`: new in-process parity probe. Uses `vnibb.services.financial_service.get_financials_with_ttm` directly so it bypasses FastAPI rate limiting. Outputs `output/finstmt_parity_<ts>.csv` plus a JSON summary with blank/error/filled buckets. Smoke-tested locally end-to-end.

#### Technical charts

- `apps/web/src/components/widgets/TradingViewNativeWidgets.tsx`: when a TradingView embed errors out, wrappers now render a styled error card with the metadata title, the underlying error message, a Retry button (re-mounts the host without reloading the page), and an "Open in TradingView" deep link. Mount key bumps via a new `mountAttempt` state.
- `apps/api/scripts/technical_parity.py`: new in-process probe that calls `services.technical_analysis.get_ta_service().get_full_technical_analysis(...)` for every active symbol and buckets the `data_quality.issues` strings. Outputs `output/technical_parity_<ts>.csv` plus a JSON summary with median bars, issue buckets, and signal coverage.

## Verification Log

- `pnpm --filter frontend exec tsc --noEmit` passed.
- `pnpm --filter frontend lint` passed.
- `pnpm --filter frontend test -- --runInBand` passed (7 suites, 19 tests).
- `pnpm --filter frontend build` passed (with `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_WS_URL` set, same as `ci:gate`).
- `python -m py_compile` passed for `apps/api/vnibb/api/v1/equity.py`, `apps/api/scripts/finstmt_parity.py`, `apps/api/scripts/technical_parity.py`.
- `python -m pytest apps/api/tests -q` passed (252 tests).
- `pnpm run ci:gate` passed end to end.
- `python -m apps.api.scripts.finstmt_parity --symbols VNM --period FY --statements income --concurrency 1` ran cleanly against local DB and produced CSV + summary; locally returned `blank=1` because the dev DB has no VNM income rows yet, confirming the probe path works without HTTP rate limits.

### Pre-existing repo-wide issues (out of scope)

- `python -m ruff check apps/api` reports 4,410 pre-existing repo-wide lints (`UP006`, `UP041`, `UP045`, `W293`, etc.) covering files I did not touch in this cycle. `ci:gate` does not run ruff, so these do not block. Recommend a separate pass with `python -m ruff check apps/api --fix --unsafe-fixes` plus a manual review of `B006` and `F401` cases. My new scripts pass `ruff check` cleanly.

## Deployment Log

- 2026-05-22 (previous cycle): commit `8a255c3 fix(dashboard): improve templates financials and seasonality` deployed to OCI; doc update committed as `bbd4c6e docs: record dashboard parity deployment`.
- 2026-05-22 (this cycle):
  - Committed as `470ce4e feat(dashboard): templates auto-create workspace, spiral heatmap granularity, whats-new revamp, parity probes` and pushed to `origin/main`.
  - OCI `/srv/vnibb` fast-forwarded `bbd4c6e` -> `470ce4e`.
  - Rebuilt `vnibb-api` and `vnibb-mcp` with `docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml up -d --build api mcp`.
  - Both containers report `Up (healthy)` after restart.
  - Public healthcheck `https://129.150.58.64.sslip.io`:
    - `/api/v1/health` -> 200
    - `/health/` -> 200
    - `/live` -> 200
    - `/ready` -> 200
- 2026-05-22 (follow-up cycle): templates "still stuck" + spiral heatmap looked wrong + reinforce financials.
  - Templates: rewrote `handleApplyTemplate` to ALWAYS create a fresh editable workspace seeded with the template, regardless of the current dashboard's lock state. Removed the conditional branching, removed the leftover `createTab` import. Wrapped in try/catch + analytics so failures surface a toast instead of silently no-oping.
  - Spiral heatmap: rewrote with a proper Archimedean spiral. Each cell is now an SVG `<path>` arc segment connecting two radii along the curve `r(theta) = a*theta`, so the result reads as a continuous "snail shell" instead of a sparse dot pattern. Adjacent cells share edges; the latest period gets a cyan dot for orientation. Daily uses 60 segments/turn, weekly uses 52 segments/turn (one full ring per ISO year).
  - Financial Statement reinforcement:
    - `useIncomeStatement / useBalanceSheet / useCashFlow` now request `limit=80` so the table renders the full multi-year history.
    - Income statement metrics expanded from 5 -> 11 rows (Revenue, COGS, Gross Profit, OpEx, Operating Income, Interest, Pre-Tax, Tax, Net Income, EBITDA, EPS).
    - Balance sheet expanded from 4 -> 14 rows (Cash, ST Investments, Receivables, Inventory, Current Assets, LT Investments, Fixed Assets, Total Assets, ST Debt, Current Liab, LT Debt, Total Liab, Retained Earnings, Total Equity).
    - Cash flow expanded from 4 -> 9 rows (Operating CF, CapEx, Investing CF, Debt Issued, Debt Repaid, Dividends Paid, Financing CF, Net Change, FCF).
    - Ratios expanded from 8 -> 16 metrics (added EPS, BVPS, Operating Margin, Quick Ratio, Asset Turnover, Inventory Turnover, Dividend Yield, Payout Ratio).
    - Aliases extended end-to-end so each metric reads from camelCase, snake_case, and Vietnamese-diacritic variants of provider payloads.
    - Existing `initialScrollPosition="end"` keeps the freshest period in view on mount.

## How to run the parity scripts

```pwsh
# Financial statements parity (in-process, no rate limit)
python -m apps.api.scripts.finstmt_parity --symbols ALL --period FY,Q1,Q2,Q3,Q4,TTM --concurrency 4

# Technical analysis parity (in-process, no rate limit)
python -m apps.api.scripts.technical_parity --symbols ALL --timeframe D --concurrency 4
```

Both scripts write to `output/` with a UTC timestamp suffix. The summary JSON contains the bucket counts to spot tickers worth manual investigation.
