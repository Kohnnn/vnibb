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
- Result: `64 passed`.

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

## Notes

- Cache-hit rate validation (>60%) requires runtime cache telemetry/log counters in deployed environment.
- Timeout/caching changes above are implemented in code and covered by tests; verify post-deploy behavior with log-based hit/miss sampling.
