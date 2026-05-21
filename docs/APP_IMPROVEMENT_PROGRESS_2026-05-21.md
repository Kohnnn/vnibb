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

- Committed as `68556e2` with message `feat(web): improve symbol discovery and quick comparison`.
- Pushed `main` to `origin/main`.
- OCI active host: `129.150.58.64`; old attempted host `152.69.210.235` timed out on SSH.
- `/srv/vnibb` fast-forwarded from `d5f32f9` to `68556e2`.
- Rebuilt and recreated OCI stack with `docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml up -d --build`.
- `vnibb-api`, `vnibb-mcp`, and `vnibb-caddy` are running; `vnibb-api` and `vnibb-mcp` are healthy.
- Public healthcheck against `https://129.150.58.64.sslip.io` passed for `/live`, `/ready`, and `/health/`.
- Public smoke test passed for health, API health, profile, quote, screener, microstructure, and CORS preflight from `https://vnibb.vercel.app`.
- Runtime verify warning: deployment is configured with `DATA_BACKEND=postgres`, while the script expects `hybrid`. Appwrite remains connected, `APPWRITE_WRITE_ENABLED=false`, and anonymous dashboard writes remain enabled.
- MCP smoke passed against `http://127.0.0.1:8001` with configured bearer token and returned 10 tools plus Appwrite connectivity.
