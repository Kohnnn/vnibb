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
VNSTOCK_SOURCE=VCI
VNSTOCK_RUNTIME_TIER=free  # free|golden; golden requires VNSTOCK_API_KEY in a secret store
VNSTOCK_RUNTIME_INSTALL=0
```

Database stack analytical source (required for the database-backed MCP tools):

```env
MONGODB_ENABLED=true
MONGODB_DATABASE=vnibb-market
MONGODB_URL=mongodb://<user>:<pass>@<tailscale-ip>:27017/vnibb-market?authSource=vnibb-market
MONGODB_TIMEOUT_MS=10000
```

The `mcp` service loads `deployment/env.oracle` via `env_file`, so these
database variables reach the MCP container without extra compose wiring. The MCP
server reads the database stack directly through the read-only `MongoMarketDataService`;
it does not proxy through the FastAPI app.

Important notes:

- `VNIBB_MCP_URL` is an API/VniAgent client setting. MCP snapshot handlers always use explicit local read-only builders, even when the sidecar inherits this URL from the shared environment; they never delegate to their own snapshot tools. A separately managed MCP process may leave the client URL unset. URL/hostname comparison is not a security or recursion boundary.
- `VNIBB_MCP_SHARED_BEARER_TOKEN` protects remote MCP HTTP access when requests arrive through Caddy or the tailnet-bound port
- the API, scheduler, and MCP share free-only runtime intent: Vietcap IQ primary and free vnstock VCI; the MCP reads persisted data only, never invokes providers or installs sponsor modules
- `MCP_PUBLIC_BIND=127.0.0.1` makes the raw MCP HTTP port reachable on the OCI host outside Docker without exposing it publicly on the internet
- set `MCP_PUBLIC_BIND=<private-ip>` to allow direct connections from other private-network machines (see "Private-network-direct access")
- if you intentionally want a public raw MCP port, change `MCP_PUBLIC_BIND=0.0.0.0` and open the security rule explicitly, but prefer the Caddy-routed `/mcp` endpoint whenever possible

## Private-network-direct access

To let other machines connect to the MCP directly for data over the private
network (current model; public TLS via Caddy stays available and can become the
primary path later):

```env
MCP_PUBLIC_BIND=<oci-tailscale-ip>
MCP_PUBLIC_PORT=8001
VNIBB_MCP_ALLOWED_HOSTS=<oci-tailscale-ip>:8001,<oci-tailscale-ip>
VNIBB_MCP_ALLOWED_ORIGINS=http://<oci-tailscale-ip>:8001
VNIBB_MCP_SHARED_BEARER_TOKEN=replace-with-long-random-value
```

- `MCP_PUBLIC_BIND` publishes the raw port on the OCI private-network IP (`<oci-tailscale-ip>`), not the public internet.
- `VNIBB_MCP_ALLOWED_HOSTS` / `VNIBB_MCP_ALLOWED_ORIGINS` extend the MCP transport's DNS-rebinding allowlist so the private-network `Host`/`Origin` headers are accepted. Loopback stays allowed for the Caddy reverse proxy. Both accept a comma-separated list or a JSON array; when both are empty the SDK defaults are preserved.
- Without the allowlist, direct private-network clients get `Invalid Host header` because the streamable-HTTP transport only accepts `localhost`/`127.0.0.1` by default.

Direct-connect client config from another tailnet machine:

- endpoint: `http://<oci-tailscale-ip>:8001/mcp`
- header: `Authorization: Bearer <VNIBB_MCP_SHARED_BEARER_TOKEN>`
- health (no auth): `http://<oci-tailscale-ip>:8001/health`

Keep the database stack private over the private network. Only the MCP read surface is published; the database is never exposed publicly.

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
docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml pull api mcp migrate
docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml run --rm migrate
docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml up -d --no-build api mcp caddy
docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml ps
docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml logs mcp --tail=200
docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml logs caddy --tail=200
```

## Validation

Run the dedicated protocol smoke against an already running sidecar:

```bash
VNIBB_MCP_SHARED_BEARER_TOKEN=... SYMBOL=FPT PERIOD_TYPE=year PYTHON_MODE=host:python3 BASE_URL=http://127.0.0.1:8001 bash scripts/oracle/mcp_smoke_test.sh
VNIBB_MCP_SHARED_BEARER_TOKEN=... SYMBOL=FPT PERIOD_TYPE=quarter PYTHON_MODE=host:python3 BASE_URL=https://api.example.com bash scripts/oracle/mcp_smoke_test.sh
# Container mode reads its existing bearer env unless explicitly overridden:
ENV_FILE=deployment/env.oracle COMPOSE_FILE=docker-compose.oracle.yml PYTHON_MODE=container SYMBOL=FPT bash scripts/oracle/mcp_smoke_test.sh
```

Host mode needs installed `mcp` and `httpx`. Auto mode prefers that host client, then a running compose MCP container. The script passes `--env-file "$ENV_FILE"` for compose interpolation and never starts a service. Set `MCP_URL`/`HEALTH_URL` when routing differs. In container mode, `127.0.0.1` is the MCP container, not the host.

Pass criteria:

- authenticated protocol initialization and required tool discovery succeed
- PostgreSQL and MongoDB connectivity statuses are `connected`; unconfigured/unreachable is distinct from empty symbol data
- symbol-scoped PostgreSQL price rows have explicit units and source evidence
- PostgreSQL income statement, balance sheet, and cash flow contain structured numeric values for the requested fiscal period with `source=vietcap`
- matching Mongo IQ statement envelopes contain exact symbol/dataset variant, source units, fiscal basis/year, raw payload, company type, descriptor evidence, structured values, and record identity

`/health` and `/mcp-health` prove process availability only, not database access. TLS verification is always enabled; set `SSL_CERT_FILE` for a trusted private CA, with a path accessible in the selected runtime. No TLS bypass is supported.

Failures flatten nested protocol `ExceptionGroup` leaves (for example HTTP 401 instead of an opaque TaskGroup error), redact URLs and configured credential values, and return nonzero. If `/health` works but MCP is 401, supply the same shared bearer configured in the sidecar; never bypass authentication.

Limitations: one symbol/fiscal basis only, persisted-data validation rather than live API reachability, freshness, ratios, or whole-market coverage. Empty/missing evidence fails instead of inventing units or substituting historical paid records. Historical non-financial corpus remains read-only with truthful provenance; canonical financial reads use IQ first (explicit VCI-only persisted rows are the PostgreSQL secondary source). See [read-only MCP contracts](VNIBB_MCP_READONLY.md#oci-smoke-checks) for focused regression commands.

## VniAgent expectation

When `VNIBB_MCP_URL` is configured in the backend runtime, VniAgent server-side runtime context reads should prefer the dedicated `vnibb-mcp` service for selected database-backed reads.

Current MCP-backed VniAgent reads:

- `get_market_snapshot`
- `get_symbol_snapshot`

If the MCP sidecar is unavailable or times out, backend logs show a warning and VniAgent falls back to direct database context assembly. A failed database read remains an error, not an empty successful snapshot. Disabled clients use the same local path; a distinct configured remote endpoint is still a legitimate API client target.

Snapshots are bounded AI summaries, not complete historical exports: daily price input is capped at 21 observations with 20 recent rows; news/events and sector leaders/laggards are capped at four; news text is capped at 500 characters. Use dedicated price/collection tools for full requested data. Price summaries retain dated missing/NaN/Infinity observations as unavailable rather than promoting older dates or compressing horizons. Five/twenty-session returns and twenty-observation ranges require finite positive closes, coherent certified units/basis and every expected exchange session. Window endpoints, status and unavailable reasons are returned. Weekends and configured `MARKET_HOLIDAY_DATES` are excluded; unconfigured exchange closures are not certified. No magnitude-based price correction or percent clamp is applied.

Matrix API owner reads, VniAgent Matrix selections and MCP user identity use the existing active-session policy: HS256 signature, configured issuer, `authenticated` audience, required `sub`/`iat`/`exp`/UUID `session_id`, bounded lifetime and online issuing Auth lookup on every request with subject matching. Configure `SUPABASE_JWT_SECRET`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `ACTIVE_SESSION_MAX_TTL_SECONDS`; ordinary owners do not require an admin allowlist. Auth denial fails closed (401); unavailable authority/configuration returns 503. Shared deployment bearer tokens never confer Matrix ownership. Snapshot revocation, owner checks, result subsets and source-export permission remain separate gates. Ordinary non-Matrix VniAgent chat does not gain a new auth requirement.

Before claiming deployed acceptance, record actual API/MCP revisions and process-specific client/auth configuration, then use an authorized disposable user session to prove owner/other-owner behavior and online denial after sign-out. A public health response or unauthenticated 401 is insufficient. Do not stress-test recursion in production or expose secrets in retained evidence.

## Operational warning

This deployment is intentionally read-only.

Do not add write, delete, backfill, admin, or schema-mutation MCP tools to this public sidecar without a stronger auth model and an explicitly separate operator surface.
