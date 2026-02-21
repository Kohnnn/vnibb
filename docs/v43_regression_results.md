# V43 Regression Results

Date: 2026-02-15

## Automated Gates

- Frontend lint: `pnpm --filter frontend lint` -> pass
- Frontend build: `pnpm --filter frontend build` -> pass
- Backend integration tests: `python -m pytest apps/api/tests/test_integration/test_api_integration.py -q` -> 14 passed
- Backend tests: `cd apps/api && python -m pytest tests -q` -> 57 passed

## Endpoint Smoke Notes

- `GET /health/` on local backend returned 200.
- Existing long-running local backend process returned 404 for newly added routes in curl smoke (`/api/v1/market/research/rss-feed`, `/api/v1/admin/data-health`).
- Route-level tests for new endpoints are green, so this is treated as a local runtime process alignment issue, not a code-level regression.

## Manual Visual Regression Status

Manual regression pass completed for core dashboard behavior:

- Symbols checked on Overview: `VNM`, `FPT`, `VCB`, `HPG`, `VIC`.
- Viewports checked: `1920`, `1366`, `768`, `375`.
- Themes checked: light/dark toggle path.
- Findings:
  - Single Manage Tabs trigger present (no duplicate manage control reproduced).
  - Rapid triple-click on Add Tab produced only one additional tab (race guard behavior confirmed).
  - Manage modal opens/closes normally.
  - Theme toggle updates both `data-theme` and root `html` class as expected.
  - No page-level overflow observed; small viewports use horizontal tab scrolling + mobile menu path.

## Carryover Actions

1. Restart/reconcile local backend runtime before final endpoint curl gate.
2. Re-verify TA full-analysis endpoints over HTTP after runtime recycle.
3. Resolve/triage empty sector payload from `/api/v1/market/heatmap` before final V45 status promotion.

## Follow-up Gate Rerun (2026-02-15, latest pass)

- Frontend typecheck: `pnpm --filter frontend exec tsc --noEmit` -> pass
- Frontend build rerun after widget lazy-load typing fix -> pass
- Frontend lint rerun -> pass
- Backend test rerun after TA fallback hardening (`technical_analysis.py`) -> `57 passed`
- Backend test rerun after heatmap fallback/filter hardening (`market.py`) -> `57 passed`
