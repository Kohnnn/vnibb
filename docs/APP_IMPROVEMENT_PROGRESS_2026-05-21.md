# App Improvement Progress - 2026-05-21

## Goal

Improve high-frequency research flow after the v1.4.x QA remediation cycle, then commit, push, and redeploy on OCI.

## Scope

- Add quick comparison support to the native price chart.
- Improve command palette discovery for analysis widgets and shortcuts.
- Keep writes local-only unless explicitly needed.
- Verify with frontend checks and the repo gate before deployment.

## Plan

1. Inspect existing chart, command palette, dashboard, and deployment paths.
2. Add low-risk chart overlay support using existing historical price APIs.
3. Expose compare controls in `PriceChartWidget` without adding backend writes.
4. Add command palette actions for common research widgets and keyboard help.
5. Run verification, commit, push, and redeploy via OCI runbook commands.

## Progress

- Started from current `main` after v1.4.3 remediation docs were pushed.
- Confirmed `TradingViewAdvancedChart` owns lightweight-charts rendering and can support a second line series.
- Confirmed `PriceChartWidget` currently ignores widget `config`, so chart compare needs a prop pass-through from dashboard rendering.
- Confirmed `CommandPalette` already owns global `Ctrl/Cmd+K` discovery actions.
- Added a native chart compare input that overlays a normalized comparison line from existing historical price data.
- Added command palette actions for Price Chart, Comparison Analysis, Relative Rotation, Watchlist, and Keyboard Shortcuts.
- Passed widget `config` through dashboard rendering so configurable widgets can read saved defaults consistently.

## Verification Log

- `pnpm --filter frontend exec tsc --noEmit` passed.
- `pnpm --filter frontend lint` passed.
- `pnpm run ci:gate` passed: frontend lint/build/tests, backend compile, and 252 backend tests.

## Deployment Log

- Pending.
