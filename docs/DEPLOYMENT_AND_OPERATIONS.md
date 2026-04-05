# Deployment and Operations

## Current production shape

The current operational picture reflected in recent project context is:

- frontend deployed on Vercel
- backend deployed on OCI
- Appwrite serving as the primary database and auth provider
- Supabase (PostgreSQL) retained as fallback database for seeding and population scripts
- Redis used for cache and resilience behavior

## Why operations became a major project theme

VNIBB depends on upstream market data providers that are not perfectly stable. That means operational quality is part of the product, not just infrastructure work.

The deployment and ops work has focused on:

- keeping the app alive during provider instability
- reducing noisy 502 and timeout behavior
- preventing brittle startup failures
- tightening cache behavior for expensive market endpoints
- making production debugging faster with better logs and health checks

## Runtime topology

At a high level, production looks like:

1. Vercel serves the frontend
2. OCI hosts the backend runtime and the dedicated `vnibb-mcp` sidecar
3. the backend exposes HTTP and WebSocket surfaces
4. the `vnibb-mcp` sidecar exposes the read-only MCP HTTP surface for VniAgent and remote clients
5. Appwrite and cache services back persistence and runtime state
6. upstream market providers feed the service layer

```text
Vercel frontend
  -> OCI Caddy
     -> FastAPI api service (:8000)
     -> vnibb-mcp service (:8001)

VniAgent server context path
  -> apps/api
  -> VNIBB_MCP_URL
  -> vnibb-mcp
  -> Appwrite
```

## Important operational lessons already learned

### 1. Provider instability is normal

The project has had to harden around:

- DNS instability
- slow upstreams
- incomplete payloads
- provider-specific schema oddities

Because of this, VNIBB relies on:

- source fallback ordering
- endpoint cache tuning
- more defensive transformations
- stronger timeout and retry behavior

### 2. Deployment bugs often present as product bugs

A broken WebSocket path, bad CORS config, stale env setup, or over-eager health check can look like a frontend feature failure even when the core code is correct.

### 3. Infrastructure migration is part of product evolution

The project's history includes:

- early Zeabur and Supabase deployment troubleshooting
- security and runtime hardening
- OCI adoption with staged mitigation planning
- migration toward a more controlled backend environment

## Local validation before deploy

From `vnibb/`:

```bash
pnpm run ci:gate
```

This is the best local confidence check because it runs the real sequence used by the repo's CI gate.

## Operational health checks

At minimum, verify:

- frontend loads the dashboard shell
- backend health endpoints respond
- key market endpoints return non-empty data
- WebSocket price path resolves correctly
- symbol-switching flows do not leave widgets in a permanent loading state

## Reliability-focused commands

From `vnibb/`:

```bash
pnpm run gate:no502
pnpm run gate:widgets:strict
```

These are useful when validating service hardening or widget runtime resilience.

## CI source of truth

Primary files:

- `vnibb/.github/workflows/ci.yml`
- `vnibb/scripts/ci-gate.mjs`

The CI gate currently checks:

- frontend lint
- frontend build
- frontend Jest tests
- backend compile smoke check
- backend pytest

## OCI workstream summary

The OCI documentation in `.agent/OCI/` shows a staged operational mindset:

- harden host first
- deploy runtime second
- introduce load balancer after app stability
- add WAF only after baseline traffic is healthy
- preserve rollback paths while moving layers one by one

That staged method is worth keeping. It prevented the project from mixing too many risky changes into one deployment step.

## What operators should watch most closely

- slow warnings on market aggregation endpoints
- cache TTL regressions that increase upstream pressure
- provider-specific fallback drift
- WebSocket reconnect noise after backend restarts
- frontend surfaces that degrade into empty or misleading placeholders

## Practical guidance for future changes

- Treat logs and smoke probes as first-class evidence.
- Test multiple symbols, including banks and non-bank issuers.
- Be suspicious of any feature that only works for one symbol.
- If a provider is flaky, solve it in the backend once rather than teaching each widget to cope separately.

## Oracle env profile

For the Oracle backend deployment path, the current recommended runtime profile is:

```env
ENVIRONMENT=production
DATA_BACKEND=appwrite
CACHE_BACKEND=auto
APPWRITE_POPULATE_FORCE_HTTP=1
APPWRITE_POPULATE_BATCH_SIZE=500
APPWRITE_POPULATE_CONCURRENCY=5
APPWRITE_POPULATE_MAX_ROWS=1000
APPWRITE_POPULATE_FULL_MAX_ROWS=0
APPWRITE_POPULATE_RESUME=true
VNSTOCK_SOURCE=KBS
VNSTOCK_CALLS_PER_MINUTE=100
INTRADAY_SYMBOLS_PER_RUN=60
SCHEDULER_LIVE_SYMBOLS_PER_RUN=60
SCHEDULER_SUPPLEMENTAL_SYMBOLS_PER_RUN=120
SCHEDULER_WEEKEND_SYMBOLS_PER_RUN=300
SCHEDULER_COMPANY_NEWS_LIMIT=10
ORDERFLOW_AT_CLOSE_ONLY=true
ORDERBOOK_AT_CLOSE_ONLY=true
STORE_INTRADAY_TRADES=false
INTRADAY_REQUIRE_MARKET_HOURS=true
INTRADAY_ALLOW_OUT_OF_HOURS_IN_PROD=false
SKIP_SCHEDULER_STARTUP=false
SKIP_WEBSOCKET_STARTUP=false
```

## Oracle env review notes

### Safe to keep

- `DATA_BACKEND=appwrite`
- `CACHE_BACKEND=auto`
- `APPWRITE_POPULATE_FORCE_HTTP=1`
- `VNSTOCK_CALLS_PER_MINUTE=100`
- `SKIP_SCHEDULER_STARTUP=false`
- `SKIP_WEBSOCKET_STARTUP=false`

### Why `CACHE_BACKEND=auto` is acceptable

In this backend, `auto` resolves to Redis when `REDIS_URL` is configured, and falls back to memory only if Redis is unavailable.

That makes it a reasonable production default when the goal is graceful degradation instead of hard failure.

### Settings worth watching closely

- `ALEMBIC_STRICT=0`
  - safer for operational flexibility, but it can hide migration drift during deploys
  - acceptable if deploys are already controlled and migration status is monitored
- `VNSTOCK_RUNTIME_INSTALL=0`
  - recommended steady-state production value
  - keep runtime install disabled after the environment is bootstrapped
- `STORE_INTRADAY_TRADES=false`
  - recommended unless full raw intraday retention is a deliberate requirement
  - avoids unnecessary write amplification in SQL and Appwrite pipelines

### Memory cache fallback settings

- `MEMORY_CACHE_MAX_ENTRIES=200`
- `MEMORY_CACHE_MAX_ENTRY_BYTES=131072`

These only matter when the in-process fallback cache is used. They are defensive limits and are fine to keep in production.

### Startup tuning settings

- `STARTUP_DB_CHECK_TIMEOUT_SECONDS=12`
- `STARTUP_VNSTOCK_REG_TIMEOUT_SECONDS=10`
- `STARTUP_WS_TIMEOUT_SECONDS=5`
- `SKIP_WARMUP=false`

These are reasonable defaults. They keep startup bounded while leaving the scheduler and websocket pipeline enabled.

## OCI current setup

For the Oracle backend deployment, the current setup is: 
- Compute (ARM): 4 OCPUs and 24 GB of RAM
- Storage: 200 GB total Block Volume (boot/block) + 10 GB Object + 10 GB Archive.
- Network: 10 TB egress data transfer per month. (Load Balancer enabled, WAF not provisioned yet)

Possible expandable quota:
- Compute (x86): 2 x VM.Standard.E2.1.Micro instances (AMD). (provisioned)
- Database: 2 x Oracle Autonomous Databases (19c or 23ai). (provisioned)
