# VNIBB Read-only MCP

## Purpose

`vnibb-mcp` is the dedicated read-only MCP server for VNIBB.

It gives VniAgent and other MCP-capable clients a curated, Appwrite-first interface for VNIBB market data without exposing write paths, admin controls, or raw operational mutation tools.

This branch intentionally ships a safer first step:

- read-only only
- Appwrite-backed
- VNIBB-shaped tools first
- no admin/write tools
- OCI-friendly deployment alongside the API

## Why this shape

VNIBB already has two useful but different MCP-adjacent pieces:

- the official Appwrite MCP launcher in `scripts/appwrite/run_mcp_from_env.mjs`
- the VNIBB API/backend itself, which already normalizes and consumes Appwrite data

This server sits between those two ideas.

It is not a generic Appwrite admin MCP.
It is not a raw `vnstock` MCP.

It is a VNIBB-specific read-only MCP designed for:

- VniAgent follow-on integration
- internal research agents
- remote MCP clients that need direct VNIBB/Appwrite data access
- safer experimentation on OCI without exposing mutation surfaces

## What ships in `vnibb-mcp`

Implementation entrypoint:

- `apps/api/vnibb/mcp/server.py`

Python command:

```bash
vnibb-mcp --transport stdio
```

Remote HTTP command:

```bash
vnibb-mcp --transport streamable-http --host 0.0.0.0 --port 8001
```

## Tool inventory

Read-only tools exposed by this branch:

Appwrite-backed (curated app collections):

- `list_supported_collections`
- `get_appwrite_status`
- `get_symbol_snapshot`
- `get_market_snapshot`
- `get_symbol_prices`
- `get_latest_financial_statement`
- `get_latest_financial_ratios`
- `get_company_news`
- `get_corporate_timeline`
- `query_appwrite_collection`

MongoDB-backed (vnstock premium analytical corpus):

- `get_mongo_status`
- `list_premium_datasets`
- `get_eod_price_history`
- `get_premium_dataset`
- `get_intraday_trades`
- `get_price_depth`

Design notes:

- `get_symbol_snapshot` and `get_market_snapshot` are the preferred high-level tools
- `query_appwrite_collection` is intentionally constrained by allowlists, max limits, and filter validation
- user-owned or operationally sensitive collections are intentionally excluded from the generic query tool
- the MongoDB tools read the private (Tailscale) analytical store directly via `MongoMarketDataService`; they do not proxy through the FastAPI app
- `get_premium_dataset` is constrained by a dataset allowlist (`PREMIUM_DATASET_SPECS`) and per-dataset max limits; disabled/empty source datasets (`company.capital_history`, `company.insider_deals`, `equity.block_trades`, `equity.put_through`) are intentionally excluded
- use `list_premium_datasets` to discover the allowlisted dataset names and their caps

## MongoDB analytical data source

The MongoDB tools expose the full vnstock premium corpus stored on the private
Tailscale MongoDB host (`vnibb-market`):

- `market_prices_eod` - end-of-day OHLCV history (~1.3M rows)
- `market_vnstock_premium_records` - shared collection holding ~80 datasets,
  each identified by a `dataset` field (e.g. `finance.ratio`, `company.info`,
  `equity.foreign_flow`, `macro.gdp`)

Access is gated by the same settings the backend uses:

```env
MONGODB_ENABLED=true
MONGODB_DATABASE=vnibb-market
MONGODB_URL=mongodb://<user>:<pass>@<tailscale-ip>:27017/vnibb-market?authSource=vnibb-market
MONGODB_TIMEOUT_MS=10000
```

When MongoDB is not configured, the MongoDB tools return a clear "not configured"
status (for `get_mongo_status`) or raise a descriptive error (for data tools)
rather than failing opaquely. Appwrite tools remain unaffected.

## Resource inventory

- `vnibb://mcp/guardrails`
- `vnibb://appwrite/collections`
- `vnibb://mongo/datasets`
- `vnibb://appwrite/schema/{collection}`

These resources exist so clients can inspect policy and schema intent without guessing.

## Prompt inventory

- `symbol_deep_dive`
- `market_brief`
- `appwrite_collection_audit`

These prompts are lightweight helpers for recurring research workflows.

## Security and guardrails

This branch reinforces the read-only design in several ways:

- no write tools
- no delete tools
- no admin tools
- no sync/backfill triggers
- no schema mutation tools
- collection allowlists
- per-collection max limits
- narrow filter validation
- optional shared bearer token for remote HTTP deployments

Remote protection env:

```env
VNIBB_MCP_SHARED_BEARER_TOKEN=replace-with-long-random-value
```

When set, the HTTP server requires:

```http
Authorization: Bearer <token>
```

Important:

- this is a pragmatic first layer for test deployments, not a full OAuth story
- VniAgent or any other app should call the remote MCP from a trusted server-side context, not directly from an untrusted browser
- if browser-native MCP is needed later, add a proper auth model instead of weakening this server

## Supported Appwrite collections

This branch allows read-only access to a curated subset only:

- `stocks`
- `stock_prices`
- `stock_indices`
- `income_statements`
- `balance_sheets`
- `cash_flows`
- `financial_ratios`
- `company_news`
- `company_events`
- `dividends`
- `insider_deals`
- `foreign_trading`
- `order_flow_daily`
- `market_sectors`
- `sector_performance`
- `screener_snapshots`

Excluded on purpose:

- user-owned dashboard/layout collections
- system template write paths
- tenant/admin collections
- direct mutation or operational collections

## Local usage

Install from `vnibb/`:

```bash
python -m pip install -e "apps/api[dev]"
```

Run in stdio mode for local IDE clients:

```bash
vnibb-mcp --transport stdio
```

Run as a remote MCP endpoint locally:

```bash
vnibb-mcp --transport streamable-http --host 127.0.0.1 --port 8001
```

Expected MCP endpoint:

- `http://127.0.0.1:8001/mcp`

Health endpoint:

- `http://127.0.0.1:8001/health`

## OCI deployment shape

This branch wires the MCP server into the OCI compose deployment.

Relevant files:

- `docker-compose.oracle.yml`
- `deployment/Caddyfile`
- `deployment/env.oracle.example`

OCI runtime model in this branch:

- `api` continues serving FastAPI on internal `8000`
- `mcp` serves the read-only MCP on internal `8001`
- `mcp` is also published to the OCI host on `127.0.0.1:8001` by default for host-level testing outside Docker
- `caddy` routes normal API traffic to `api`
- `caddy` routes `/mcp*` to the MCP service

Public paths on the existing API hostname:

- MCP endpoint: `https://api.example.com/mcp`
- MCP health: `https://api.example.com/mcp-health`

Host-level direct paths on OCI:

- MCP endpoint: `http://127.0.0.1:8001/mcp`
- MCP health: `http://127.0.0.1:8001/health`

Recommended OCI env values:

```env
VNIBB_MCP_HOST=0.0.0.0
VNIBB_MCP_PORT=8001
VNIBB_MCP_TRANSPORT=streamable-http
VNIBB_MCP_SHARED_BEARER_TOKEN=replace-with-long-random-value
MCP_UPSTREAM=mcp:8001
MCP_PUBLIC_BIND=127.0.0.1
MCP_PUBLIC_PORT=8001
```

Keep `MCP_PUBLIC_BIND=127.0.0.1` if you only want host-level access outside Docker. Change it to `0.0.0.0` only if you intentionally want to expose the raw MCP port beyond the OCI host.

## Direct access from other machines (Tailscale)

Other machines can connect to `vnibb-mcp` directly for data, without routing
through the FastAPI app. The current model is Tailscale-private; public TLS via
Caddy remains available and can be the primary path later.

Tailscale-private model (current):

- bind the published MCP port to the OCI Tailscale IP instead of loopback
- require the shared bearer token on all non-health routes
- allowlist the Tailscale host for the MCP transport's DNS-rebinding protection

```env
# Publish the raw MCP port on the tailnet IP (not the public internet)
MCP_PUBLIC_BIND=100.107.9.31
MCP_PUBLIC_PORT=8001

# Required so the streamable-HTTP transport accepts the tailnet Host/Origin
# headers (loopback is always kept for the Caddy reverse proxy).
VNIBB_MCP_ALLOWED_HOSTS=100.107.9.31:8001,100.107.9.31
VNIBB_MCP_ALLOWED_ORIGINS=http://100.107.9.31:8001

# Enforce auth on the tailnet-exposed port
VNIBB_MCP_SHARED_BEARER_TOKEN=replace-with-long-random-value
```

Why `VNIBB_MCP_ALLOWED_HOSTS` is needed: the MCP SDK's streamable-HTTP transport
enables DNS-rebinding protection and, by default, only accepts `localhost` /
`127.0.0.1` Host headers. Caddy works because it rewrites `Host: localhost:8001`.
Direct tailnet clients send `Host: <tailscale-ip>:8001`, which must be
allowlisted or the server returns `Invalid Host header`. When both
`VNIBB_MCP_ALLOWED_HOSTS` and `VNIBB_MCP_ALLOWED_ORIGINS` are empty, the SDK
defaults are preserved unchanged.

Direct-connect client config (e.g. another tailnet machine or an IDE MCP client):

- endpoint: `http://100.107.9.31:8001/mcp`
- header: `Authorization: Bearer <VNIBB_MCP_SHARED_BEARER_TOKEN>`
- health (no auth): `http://100.107.9.31:8001/health`

Public TLS model (available, can become primary later):

- endpoint: `https://<SITE_HOSTNAME>/mcp`
- health: `https://<SITE_HOSTNAME>/mcp-health`
- same bearer token enforced inside the MCP app

Keep MongoDB itself private over Tailscale. Only the MCP read surface is exposed;
the database is never published publicly.

## VniAgent integration guidance

This branch now rewires selected VniAgent server-side reads through the MCP companion.

Current integration point:

- `apps/api/vnibb/api/v1/copilot.py`
- `apps/api/vnibb/services/ai_context_service.py`
- `apps/api/vnibb/services/vnibb_mcp_client_service.py`

Current behavior:

1. `chat/stream` still builds runtime context on the server
2. when `VNIBB_MCP_URL` is configured, selected Appwrite-backed reads use MCP tools instead of direct Appwrite reads
3. current selected MCP-backed reads are:
   - `get_market_snapshot`
   - `get_symbol_snapshot`
4. if the MCP companion is unavailable, the backend logs a warning and falls back to direct Appwrite/Postgres logic

This keeps the current VniAgent surface stable while making MCP the preferred read path for Appwrite-backed copilot context.

Recommended runtime env for the API service:

```env
VNIBB_MCP_URL=http://mcp:8001/mcp
VNIBB_MCP_TIMEOUT_SECONDS=20
VNIBB_MCP_SHARED_BEARER_TOKEN=replace-with-long-random-value
```

Recommended local development env when running the MCP server separately:

```env
VNIBB_MCP_URL=http://127.0.0.1:8001/mcp
```

## Dangerous roadmap items

Not shipped in this branch. Keep these clearly separated from the public/read-only MCP:

- dashboard writes
- widget/layout writes
- watchlist writes
- Appwrite writes or deletes
- sync, seed, backfill, or refresh triggers
- admin data-health actions
- schema/index management

These are dangerous because they can:

- alter user state
- create expensive write amplification
- expose operational internals
- make agent mistakes costly instead of recoverable

If these are ever added later, put them behind a separate admin MCP surface with stronger auth and explicit operator controls.

## OCI smoke checks

Use the dedicated smoke script after deploy:

```bash
bash scripts/oracle/mcp_smoke_test.sh
BASE_URL=https://api.example.com bash scripts/oracle/mcp_smoke_test.sh
```

The script verifies:

- `/mcp-health` returns `200`
- `/mcp` is reachable
- MCP initialization succeeds
- the server can list tools
- `get_appwrite_status` executes successfully
