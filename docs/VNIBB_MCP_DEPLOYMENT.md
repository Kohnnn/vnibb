# VNIBB MCP Deployment

## Purpose

This document is the operator-facing deployment reference for the dedicated `vnibb-mcp` service.

Use it when deploying the read-only MCP companion alongside the VNIBB backend on OCI.

Canonical implementation details still live in `VNIBB_MCP_READONLY.md`.

## Runtime shape

The deployed topology is:

- `api` serves the FastAPI backend on internal `8000`
- `mcp` serves the read-only MCP companion on internal `8001`
- `mcp` is also published on the OCI host as `127.0.0.1:8001` by default for host-level smoke checks outside Docker
- `caddy` reverse proxies:
  - normal API traffic to `api`
  - `/mcp*` traffic to `mcp`
  - `/mcp-health` to the MCP health endpoint

This keeps `vnibb-mcp` as a dedicated service instead of mixing MCP transport handling into the main API process.

## Files involved

- `docker-compose.oracle.yml`
- `deployment/Caddyfile`
- `deployment/env.oracle.example`
- `scripts/oracle/mcp_smoke_test.sh`

## Required environment

Set these in `deployment/env.oracle`:

```env
VNIBB_MCP_HOST=0.0.0.0
VNIBB_MCP_PORT=8001
VNIBB_MCP_TRANSPORT=streamable-http
VNIBB_MCP_URL=http://mcp:8001/mcp
VNIBB_MCP_TIMEOUT_SECONDS=20
VNIBB_MCP_SHARED_BEARER_TOKEN=replace-with-long-random-value
MCP_UPSTREAM=mcp:8001
MCP_PUBLIC_BIND=127.0.0.1
MCP_PUBLIC_PORT=8001
```

Important notes:

- `VNIBB_MCP_URL` is used by the backend so VniAgent can call the MCP sidecar server-side
- `VNIBB_MCP_SHARED_BEARER_TOKEN` protects remote MCP HTTP access when requests arrive through Caddy
- the backend and MCP service should share the same runtime data-source env so they read the same primary store; this month that means Supabase/Postgres primary with Appwrite read-only fallback only
- `MCP_PUBLIC_BIND=127.0.0.1` makes the raw MCP HTTP port reachable on the OCI host outside Docker without exposing it publicly on the internet
- if you intentionally want a public raw MCP port, change `MCP_PUBLIC_BIND=0.0.0.0` and open the security rule explicitly, but prefer the Caddy-routed `/mcp` endpoint whenever possible

## Public endpoints

Assuming the backend hostname is `https://api.example.com`:

- MCP endpoint: `https://api.example.com/mcp`
- MCP health: `https://api.example.com/mcp-health`

Host-level direct endpoints on OCI:

- MCP endpoint: `http://127.0.0.1:8001/mcp`
- MCP health: `http://127.0.0.1:8001/health`

The direct port is plain HTTP. Use it for on-host testing and operational smoke checks. Use the Caddy path for public TLS access.

## Deploy sequence

From `vnibb/`:

```bash
docker compose -f docker-compose.oracle.yml up -d --build
docker compose -f docker-compose.oracle.yml ps
docker compose -f docker-compose.oracle.yml logs mcp --tail=200
docker compose -f docker-compose.oracle.yml logs caddy --tail=200
```

## Validation

Run the dedicated smoke check:

```bash
bash scripts/oracle/mcp_smoke_test.sh
BASE_URL=https://api.example.com bash scripts/oracle/mcp_smoke_test.sh
BASE_URL=http://127.0.0.1:8001 bash scripts/oracle/mcp_smoke_test.sh
```

If the deployment is protected by a shared bearer token, export it first:

```bash
export VNIBB_MCP_SHARED_BEARER_TOKEN=replace-with-long-random-value
```

What success looks like:

- `/mcp-health` returns `200`
- or `/health` returns `200` when using the direct host port
- MCP initialization succeeds
- tool listing succeeds
- `get_appwrite_status` returns successfully

## VniAgent expectation

When `VNIBB_MCP_URL` is configured in the backend runtime, VniAgent server-side runtime context reads should prefer the dedicated `vnibb-mcp` service for selected Appwrite-backed reads.

Current MCP-backed VniAgent reads:

- `get_market_snapshot`
- `get_symbol_snapshot`

If the MCP sidecar is unavailable, backend logs should show a warning and VniAgent should fall back to direct Appwrite/Postgres context assembly instead of fully failing.

## Operational warning

This deployment is intentionally read-only.

Do not add write, delete, backfill, admin, or schema-mutation MCP tools to this public sidecar without a stronger auth model and an explicitly separate operator surface.
