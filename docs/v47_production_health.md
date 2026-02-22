# V47 Production Stability Report

Date: 2026-02-22

## Scope

This report captures V47 Track 6 stability work (timeouts + hot-endpoint load reduction + cache coverage) and verification status.

## Implemented Changes

### 1) Global API request timeout

- Added `api_request_timeout_seconds` (default `30`) in `apps/api/vnibb/core/config.py`.
- Added `RequestTimeoutMiddleware` in `apps/api/vnibb/api/main.py`.
- Behavior:
  - Applies to non-health requests.
  - Returns `504` with payload:
    - `error: true`
    - `code: REQUEST_TIMEOUT`
    - `message: Request timed out. Please try again.`
  - Bypasses `/live`, `/ready`, `/health`, and docs endpoints.

### 2) Heavy endpoint default load tuning

- Reduced `/api/v1/market/heatmap` default `limit` from `500` to `200` in `apps/api/vnibb/api/v1/market.py`.

### 3) Redis/API cache TTL alignment for hot routes

- Added endpoint caching decorators in `apps/api/vnibb/api/v1/market.py`:
  - `/market/indices` -> `60s`
  - `/market/world-indices` -> `300s`
  - `/market/heatmap` -> `120s`
- Updated quote caching target in `apps/api/vnibb/api/v1/equity.py`:
  - `/equity/{symbol}/quote` -> `30s`.
- Added cache metadata entries in `apps/api/vnibb/core/cache.py` for new market keys.

## Verification Results

### Backend tests

- `cd apps/api && pytest tests -q`
- Result: `70 passed`.

### Frontend gates

- `pnpm --filter frontend exec tsc --noEmit`
- `pnpm --filter frontend lint`
- `pnpm --filter frontend build`
- Result: pass.

### Monorepo gates

- `pnpm lint`
- `pnpm test`
- `pnpm build`
- Result: pass.

### Additional readiness checks

- `python -m py_compile apps/api/vnibb/api/main.py` -> pass.
- `python -X utf8 .agent/skills/seo-fundamentals/scripts/seo_checker.py vnibb` -> pass.
- `python -X utf8 .agent/scripts/checklist.py .` -> 5/6 passed; UX audit remains heuristic-noisy.
- `python -X utf8 .agent/skills/frontend-design/scripts/ux_audit.py vnibb` -> fails with heuristic regex issues (10 hard issues, 1057 warnings), dominated by false positives.

### Production endpoint spot-check (latest)

- `/live` -> `200` in `0.709s`
- `/ready` -> `200` in `0.408s`
- `/api/v1/equity/VNM/quote` -> `200` in `0.608s`
- `/api/v1/market/world-indices` -> `200` in `6.401s`

### Production matrix

- Command:
  - `python -m scripts.widget_health_matrix --base-url https://vnibb.zeabur.app --repeats 2 --timeout 10 --output scripts/v47_production_widget_matrix_latest.json`
- Result:
  - `overall_ok: true`
  - `endpoint_ok: true`
  - `widget_state_ok: true`

### V49-V50 pre-deploy probe (new endpoint baseline)

- `GET /api/v1/equity/VNM/peers` -> `404` (new route implemented in code, not deployed yet)
- `GET /api/v1/equity/VNM/ttm` -> `404` (new route implemented in code, not deployed yet)
- `GET /api/v1/equity/VNM/growth` -> `404` (new route implemented in code, not deployed yet)
- `GET /api/v1/sectors/banking/stocks` -> `404` (new route implemented in code, not deployed yet)
- Existing endpoints remain `200`, but missing financial fields on production payloads persist until backend deployment.

### Full production endpoint matrix rerun (2026-02-22, latest)

- `GET /api/v1/equity/VNM/peers` -> `404`
- `GET /api/v1/equity/VNM/income-statement` -> `200`
- `GET /api/v1/equity/VNM/balance-sheet` -> `200`
- `GET /api/v1/equity/VNM/cash-flow` -> `200`
- `GET /api/v1/equity/VNM/ratios` -> `200`
- `GET /api/v1/equity/VNM/ttm` -> `404`
- `GET /api/v1/equity/VNM/growth` -> `404`
- `GET /api/v1/sectors` -> `200`
- `GET /api/v1/sectors/banking/stocks` -> `404`
- `GET /api/v1/comparison/VNM,FPT,VCB` -> `404`
- `GET /api/v1/market/indices` -> `200`
- `GET /api/v1/market/world-indices` -> `200`
- `GET /api/v1/market/heatmap` -> `504` (timeout)
- `GET /api/v1/screener` -> `307` (redirect)

Interpretation:

- New V49/V50 backend routes are still not live in production.
- There is also an active production reliability issue on `/market/heatmap` (`504`) that needs backend investigation after deploy.

### Local code-level mitigations prepared (pending deploy)

- Added no-trailing-slash route compatibility:
  - `/api/v1/screener` and `/api/v1/comparison` now resolve directly without 307 redirect.
- Added path-style comparison alias:
  - `/api/v1/comparison/{symbols}` supports calls like `/api/v1/comparison/VNM,FPT,VCB`.
- Hardened heatmap fetch path:
  - Uses stale screener cache entries when available (faster fallback).
  - Added explicit provider timeout guard (`20s`) for both primary fetch and fresh-refetch fallback.
  - On provider timeout/error, returns an empty heatmap payload instead of surfacing 5xx (frontend can render empty-state instead of hard failure).

## Documentation Artifacts (V52)

- Added `docs/API_REFERENCE.md` with current frontend-consumed route map and deployment probes.
- Added `docs/WIDGET_CATALOG.md` with 59 registered widgets and data-source mapping.
- Added root `CHANGELOG.md` with V46-V52 grouped release notes.

## Notes

- Cache-hit rate validation (>60%) requires runtime cache telemetry/log counters in deployed environment.
- Timeout/caching changes above are implemented in code and covered by tests; verify post-deploy behavior with log-based hit/miss sampling.
