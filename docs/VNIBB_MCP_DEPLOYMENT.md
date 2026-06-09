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

MongoDB analytical source (required for the MongoDB-backed MCP tools):

```env
MONGODB_ENABLED=true
MONGODB_DATABASE=vnibb-market
MONGODB_URL=mongodb://<user>:<pass>@<tailscale-ip>:27017/vnibb-market?authSource=vnibb-market
MONGODB_TIMEOUT_MS=10000
```

The `mcp` service loads `deployment/env.oracle` via `env_file`, so these
MongoDB variables reach the MCP container without extra compose wiring. The MCP
server reads MongoDB directly through the read-only `MongoMarketDataService`;
it does not proxy through the FastAPI app.

Important notes:

- `VNIBB_MCP_URL` is used by the backend so VniAgent can call the MCP sidecar server-side
- `VNIBB_MCP_SHARED_BEARER_TOKEN` protects remote MCP HTTP access when requests arrive through Caddy or the tailnet-bound port
- the backend and MCP service should share the same runtime data-source intent; Appwrite remains the intended VNIBB market corpus, MongoDB carries the vnstock premium analytical corpus, while Supabase/Postgres may temporarily carry write-side bridge responsibilities during quota pressure
- `MCP_PUBLIC_BIND=127.0.0.1` makes the raw MCP HTTP port reachable on the OCI host outside Docker without exposing it publicly on the internet
- set `MCP_PUBLIC_BIND=<tailscale-ip>` to allow direct connections from other tailnet machines (see "Tailscale-direct access")
- if you intentionally want a public raw MCP port, change `MCP_PUBLIC_BIND=0.0.0.0` and open the security rule explicitly, but prefer the Caddy-routed `/mcp` endpoint whenever possible

## Tailscale-direct access

To let other machines connect to the MCP directly for data over the private
tailnet (current model; public TLS via Caddy stays available and can become the
primary path later):

```env
MCP_PUBLIC_BIND=100.107.9.31
MCP_PUBLIC_PORT=8001
VNIBB_MCP_ALLOWED_HOSTS=100.107.9.31:8001,100.107.9.31
VNIBB_MCP_ALLOWED_ORIGINS=http://100.107.9.31:8001
VNIBB_MCP_SHARED_BEARER_TOKEN=replace-with-long-random-value
```

- `MCP_PUBLIC_BIND` publishes the raw port on the OCI Tailscale IP (`100.107.9.31`), not the public internet.
- `VNIBB_MCP_ALLOWED_HOSTS` / `VNIBB_MCP_ALLOWED_ORIGINS` extend the MCP transport's DNS-rebinding allowlist so the tailnet `Host`/`Origin` headers are accepted. Loopback stays allowed for the Caddy reverse proxy. Both accept a comma-separated list or a JSON array; when both are empty the SDK defaults are preserved.
- Without the allowlist, direct tailnet clients get `Invalid Host header` because the streamable-HTTP transport only accepts `localhost`/`127.0.0.1` by default.

Direct-connect client config from another tailnet machine:

- endpoint: `http://100.107.9.31:8001/mcp`
- header: `Authorization: Bearer <VNIBB_MCP_SHARED_BEARER_TOKEN>`
- health (no auth): `http://100.107.9.31:8001/health`

Keep MongoDB private over Tailscale. Only the MCP read surface is published; the database is never exposed publicly.

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
docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml up -d --build
docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml ps
docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml logs mcp --tail=200
docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml logs caddy --tail=200
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
- tool listing succeeds (includes Appwrite tools and the MongoDB tools: `get_mongo_status`, `list_premium_datasets`, `get_eod_price_history`, `get_premium_dataset`, `get_intraday_trades`, `get_price_depth`)
- `get_appwrite_status` returns successfully
- `get_mongo_status` reports `enabled: true` when the MongoDB source is configured

Quick MongoDB-tool checks over the tailnet bind (replace token):

```bash
TOKEN=...; IP=100.107.9.31
curl -s -X POST http://$IP:8001/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_eod_price_history","arguments":{"symbol":"VCI","lookback_days":30,"limit":3}}}'
```

## VniAgent expectation

When `VNIBB_MCP_URL` is configured in the backend runtime, VniAgent server-side runtime context reads should prefer the dedicated `vnibb-mcp` service for selected Appwrite-backed reads.

Current MCP-backed VniAgent reads:

- `get_market_snapshot`
- `get_symbol_snapshot`

If the MCP sidecar is unavailable, backend logs should show a warning and VniAgent should fall back to direct Appwrite/Postgres context assembly instead of fully failing.

## Operational warning

This deployment is intentionally read-only.

Do not add write, delete, backfill, admin, or schema-mutation MCP tools to this public sidecar without a stronger auth model and an explicitly separate operator surface.
