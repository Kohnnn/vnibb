# VNIBB Read-only MCP

## Purpose

`vnibb-mcp` is the dedicated read-only MCP server for VNIBB.

It gives VniAgent and other MCP-capable clients a curated, database-first interface for VNIBB market data without exposing write paths, admin controls, or raw operational mutation tools.

This branch intentionally ships a safer first step:

- read-only only
- database-backed
- VNIBB-shaped tools first
- no admin/write tools
- OCI-friendly deployment alongside the API

## Why this shape

VNIBB already has two useful but different MCP-adjacent data surfaces:

- the VNIBB API/backend, which normalizes and serves the Postgres app model
- the private MongoDB analytical corpus, which holds Vietcap IQ structured/raw evidence and historical records

This server sits between those two ideas.

It is not a generic database-admin MCP.
It is not a raw `vnstock` MCP.

It is a VNIBB-specific read-only MCP designed for:

- VniAgent follow-on integration
- internal research agents
- remote MCP clients that need direct VNIBB data access
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

Postgres-table-backed (curated VNIBB app tables):

- `list_supported_collections`
- `get_database_status`
- `get_symbol_snapshot`
- `get_market_snapshot`
- `get_symbol_prices`
- `get_latest_financial_statement`
- `get_latest_financial_ratios`
- `get_company_news`
- `get_corporate_timeline`
- `query_database_collection`

Analytical-corpus-backed (database reads only, never provider execution):

- `get_mongo_status`
- `list_premium_datasets`
- `get_eod_price_history`
- `get_premium_dataset`
- `get_intraday_trades`
- `get_price_depth`
- `get_reference_dataset` — exact IQ profile/metric-map physical-store reads
- `get_ingestion_receipts` — bounded acquisition receipts; no ingestion execution

Agent bootstrap and user-scoped reads:

- `get_agent_connection_guide` — returns the connection guide and the retrieval
  skills catalog inline, so an agent can self-bootstrap from the tool surface
  alone without a prior resource read
- `get_matrix_selection` — the caller's frozen Matrix selection and evidence,
  subject to source export rights; requires an authorized user JWT, so stdio and
  the shared bearer cannot call it

Design notes:

- `get_symbol_snapshot` and `get_market_snapshot` are the preferred high-level tools
- `query_database_collection` is intentionally constrained by allowlists, max limits, and filter validation
- user-owned or operationally sensitive collections are intentionally excluded from the generic query tool
- the database-stack tools read the private analytical store directly via `MongoMarketDataService`; they do not proxy through the FastAPI app
- `get_premium_dataset` is constrained by a dataset allowlist (`PREMIUM_DATASET_SPECS`) and per-dataset max limits; disabled/empty source datasets (`company.capital_history`, `company.insider_deals`, `equity.block_trades`, `equity.put_through`) are intentionally excluded
- `get_premium_dataset` queries symbol-scoped records by outer `symbol`; all ten `macro.*`, `market.pe`, `market.pb`, `market.evaluation`, `analytics.valuation.pe` and `analytics.valuation.pb` instead use exact `scopeType=market, scopeKey=market`, independent of the raw outer symbol. Market datasets require no equity symbol. Analytics valuations support only `index_code=VNINDEX`; other index selections are rejected. Historical market valuation catalog requests use `5Y`, not a complete-history guarantee.
- `get_price_depth` reads flat price/volume documents from the newest `updatedAt` write batch, caps returned valid levels by `limit`, and includes per-row `observedAt`, batch `updatedAt`, and `recordKey`. Write time is not proof of market-data freshness.
- Batch selection precedes price/volume filtering. If the newest batch contains only zero-volume or invalid levels, `get_price_depth` returns no items; older positive levels are never substituted as current depth.
- Catalog ingestion keys flat equity/futures/crypto depth levels by scope and normalized price. Volume changes update the level instead of creating a second identity; symbol/ticker/time metadata cannot collapse distinct prices.
- Previously overwritten levels cannot be recovered by rekeying the surviving document. Deploy the writer correction and refresh the affected depth datasets through catalog ingestion; a new batch excludes older surviving documents from `get_price_depth`. No production refresh is claimed here.
- Recovery smoke replayed the documented VCB provider frame (`price`, `volume`, buy/sell/undefined volumes) through the catalog fetcher, real MongoDB upserts, and the actual MCP tool. The two price levels remained distinct; an all-zero newest batch excluded a retained older positive level. This proves the captured-frame storage/read contract, not live premium accessor availability or market freshness.
- use `list_premium_datasets` to discover the allowlisted dataset names and their caps

## Analytical data source

The analytical tools read the privately hosted database stack (`vnibb-market`):

- `market_prices_eod` — persisted end-of-day OHLCV history
- `market_vnstock_premium_records` — historical collection name, also used for free Vietcap IQ records keyed by `dataset`, `datasetVariant`, and symbol

New ingestion/execution is Vietcap IQ primary plus free `vnstock` VCI only. MCP does not import or execute provider fetchers, install sponsor packages, backfill, or use banned provider fallbacks. Historical non-financial records may remain readable with their actual source and dates; the word `premium` in the legacy tool/collection name is not a runtime subscription requirement. Never describe these records as current without checking source observation dates.

`get_premium_dataset` finance reads surface retained-row identity disclosures rather than hiding removed rows: `legacy_period_labels` names records whose stored outer `period` label is unusable while the raw fiscal identity is valid, and `unrepresentable_financial_identity` maps `recordKey` to a reason (`ratio_ttm`, `unsupported_period_type:*`, `unsupported_variant:*`). `row_count` stays `len(items)`; excluded rows are counted separately from the returned items, never silently dropped. Non-financial datasets omit these keys.

Canonical PostgreSQL financial tools prefer persisted `vietcap` rows, then explicitly identified free VCI rows; ambiguous `vnstock` rows are not source proof. Mongo `finance.*` reads use `source=vietcap`, optional `period_type=year|quarter` maps to the exact dataset variant, and return the lossless source envelope (raw payload, descriptor evidence, company type, source units, fiscal basis, and dates). No IQ rows means empty, not a substitution from old paid data. Database read failures are tool errors, not empty results. `freshness` is deliberately `not_assessed`; `updatedAt` is ingestion time, not proof of current financial data.

Generic PostgreSQL financial queries apply the full admitted-source list (`vietcap`, `VCI`) as SQL `IN`, so both sources remain readable and unsupported sources stay excluded. Generic ratio queries, latest-ratio reads and symbol snapshots require canonical `percent` evidence for percentage metrics, including ROIC and debt/assets. Missing, unknown or fractional unit evidence withholds canonical percentages and returns `unavailable_metrics` reasons with `data_status=partial_unavailable`; other metrics and `raw_data` remain available without modifying stored observations.

The HTTP dividend endpoint retains its PostgreSQL dividend/event fallbacks after a live free VCI provider exception and returns the provider failure in `error` alongside any usable rows. Cancellation propagates rather than being converted into fallback data.

PostgreSQL `StockPrice` has no raw/unit columns. Its stock-only IQ bridge persists `source=vietcap_vnd` only after validating explicit VND source evidence, following the existing `vnstock_vnd` marker convention. MCP returns `price_unit=VND` without rescaling for that exact certified marker. Historical generic `vietcap` rows remain unknown-unit; no numeric-magnitude inference or blanket source admission occurs. Full raw price/unit evidence remains in MongoDB rather than PostgreSQL. Reapply IQ ingestion to upgrade only owned IQ rows; unrelated source rows are not overwritten.

### Full-data JSON and bounds

Generic collection and dedicated history/news/timeline/financial tools preserve every fetched row, model column, nested raw lineage value, evidence string and URL. `row_count` equals `len(items)`; no list, dictionary, string or nesting budget silently removes data. Finite Decimal values and integers outside JavaScript's safe range (`abs(value) > 2**53 - 1`) are exact decimal strings. Ordinary integers, finite floats, booleans, nulls and strings retain their types/contents; dates/timestamps use ISO strings. NaN/Infinity, including nonfinite Decimal values, produce an error before JSON serialization rather than fabricated null values.

`limit=0` requests an empty page; negatives are rejected. Larger requests are capped at the discovered collection/dataset maximum. SQL generic caps remain collection-specific (20–250 for the original 16 tables), news 25, timeline 30, SQL prices 250, EOD/depth 5000 and intraday 20000. The collection/schema resources include the complete ordered model-field inventory. SQL filters/sorts are explicitly mapped columns: screener does not advertise nonexistent `sector` or `value`; sector-performance sorts use `total_volume` and `total_value`. Unmapped constraints are errors. Primary-key ascending tie-breaking makes bounded SQL pages deterministic.

Data responses expose `retrieved_at` separately from retained source observation/publication/fiscal/ingestion fields. Repeated reads update only retrieval time; unknown source age remains unknown.

SQL Date filters compare dates; DateTime bounds cover the full requested day inclusively. No/start/end/both date bounds are supported; invalid or inverted bounds are rejected. EOD uses its bounded range reader whenever either bound is supplied, with the omitted side open, not the default lookback. Every EOD row exposes `time` as the canonical date-only session identity derived from the retained `tradeDate`, matching the SQL price envelope, and keeps the raw `tradeDate` plus source/observation/update provenance. EOD always includes retained source/observation/update provenance. Repeated retrieval never changes stored observation time. `year`, `annual`, `yearly`, `fy` normalize to `year`; `quarter`, `quarterly`, `q` normalize to `quarter` case-insensitively. Unsupported periods, including TTM, are rejected; no arbitrary four-row aggregation is implied.

Snapshots deliberately remain **compact AI summaries**, with explicit `serialization_policy`: prices query 21 daily observations and retain a 20-observation series; foreign/order flow query 20 sessions and summarize the recent 5; news/events and sector leaders/laggards use four entries; news strings use 500 characters. Full financial evidence is retained in the MCP snapshot overlay. For full original records use the dedicated tools or generic collection query; AI-context compaction is not the full-data serializer. Snapshot handlers call local database builders, never an outbound MCP client.

### Explicit stores and coverage

SQL `companies`, `shareholders`, `officers`, and `subsidiaries` are exposed through `query_database_collection`; they are not silently substituted by similarly named raw datasets. `get_reference_dataset(symbol, store)` supports only IQ `market_company_profiles` and `market_financial_metric_map`; metric descriptors select the exact outer `symbol`, `source=vietcap`, `schemaVersion=3` and return original `descriptors` with symbol/type/section-scoped `descriptorEvidence`. Legacy type-wide documents remain historical raw retention, never a served compatibility fallback. IQ `company.shareholder_structure` is read through `get_premium_dataset` with `source=vietcap`. The explicit source/store, record identity, units and separate observation/fiscal/publication/ingestion timestamps remain in returned rows when retained; absent evidence remains unknown.

Intraday/depth responses derive outer source from the actual selected `sourceCollection` or empty-batch metadata. Raw/derived stores are not mislabeled as premium. Depth is only the latest write batch, not historical session replay. A successful empty current batch does not substitute older rows. SQL retention defaults are prices 5×365 days, news/ticks 7 days, screener/block trades 365 days, foreign/order flow 3×365 days and orderbook 30 days; runtime configuration and retained receipts, not these defaults, determine actual coverage. Catalog long/short-term labels do not enforce TTL.

IQ reference cycle receipts use `iq_company_profile` and `iq_shareholder_structure` under `iq_reference_maintenance`, with destinations `market_company_profiles` and `market_vnstock_premium_records` (`company.shareholder_structure`) respectively.

`get_ingestion_receipts(symbol, dataset, limit)` projects only the selected symbol/dataset from SQL `sync_status` cycles or exact-symbol Mongo `market_eod_catchup_receipts`. Each dataset maps to its actual scheduler owner: `profiles` → `daily_profile_maintenance`; `financials_year`/`financials_quarter`/`ratios_year` → `daily_financial_maintenance`; `ratios_quarter` → `financial_ratios_maintenance`; `iq_company_profile`/`iq_shareholder_structure` → `iq_reference_maintenance`; `foreign_trading`/`intraday_trades` → their universe cycles; `shareholders`/`officers`/`subsidiaries`/`company_news`/`insider_deals` → `supplemental_company_maintenance`. The legacy `supplemental_company_maintenance` cycle stays accepted for financial/profile selectors so older receipts remain readable, and `eod_catchup` selects Mongo receipts. A receipt records acquisition outcome, not complete historical/session coverage. Recent fetch/write timestamps, nominal cadence and successful empty results never certify freshness or full population. Authorized retained-store reads and successful source access must be checked separately before asserting live availability.

For SQL receipts, `expected_count` is the selected stage's symbol denominator from the root `expected_symbols` universe. `pending_count` includes expected symbols not acquired and receipts still failed, deferred, attempted or awaiting revalidation; `complete` means that stage has no outstanding acquisition work, not that the overall cycle completed. Confirmed `empty` receipts count as acquired, unlike failures. Historical records without an expected-symbol universe retain unknown (`null`) stage completeness. These counts never certify historical or exchange-session coverage and do not expose other symbols' receipts.

Access is gated by the same settings the backend uses:

```env
MONGODB_ENABLED=true
MONGODB_DATABASE=vnibb-market
MONGODB_URL=mongodb://<user>:<pass>@<tailscale-ip>:27017/vnibb-market?authSource=vnibb-market
MONGODB_TIMEOUT_MS=10000
```

Use the same free-only runtime intent for the API, scheduler, and sidecar:

```env
VNSTOCK_SOURCE=VCI
VNSTOCK_RUNTIME_TIER=free
VNSTOCK_RUNTIME_INSTALL=0
```

The sidecar reads PostgreSQL via `DATABASE_URL` and MongoDB via the settings above. Populate them through the existing IQ ingestion path, not MCP. `/health` reports process/configuration only; `get_database_status` and `get_mongo_status` exercise database connectivity separately from whether a symbol has data.

When the database stack is not configured, the database-stack tools return a clear "not configured"
status (for `get_mongo_status`) or raise a descriptive error (for data tools)
rather than failing opaquely. The Postgres-table tools remain unaffected.

## Resource inventory

- `vnibb://mcp/guardrails`
- `vnibb://database/collections`
- `vnibb://mongo/datasets`
- `vnibb://database/schema/{collection}`
- `vnibb://mcp/guide` — connection guide for downstream agents: transport,
  authentication, discovery order, and the read-only contract
- `vnibb://mcp/skills` — retrieval skills catalog: named workflows agents adopt
  when their matching intent is detected

These resources exist so clients can inspect policy and schema intent without guessing.

The `get_agent_connection_guide` tool returns both the guide and the skills
catalog inline, so an agent can self-bootstrap from the tool surface alone
without a prior resource read.

## Prompt inventory

- `symbol_deep_dive`
- `market_brief`
- `database_collection_audit`
- `eod_price_history`
- `premium_dataset`
- `intraday_trades`
- `price_depth`

These prompts are lightweight helpers for recurring research workflows. Each
mirrors the identically named skill in `vnibb://mcp/skills`. The catalog also
covers read-only workflows that deliberately have no prompt template:
`matrix_selection` (a verified user JWT is required) and `reference_dataset`
and `ingestion_receipts` (low-level store reads).

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

## Supported Postgres tables

This server allows read-only access to a curated subset only:

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

## Direct access from other machines (private network)

Other machines can connect to `vnibb-mcp` directly for data, without routing
through the FastAPI app. The current model is private-network-only; public TLS via
Caddy remains available and can be the primary path later.

Private-network model (current):

- bind the published MCP port to the OCI private-network IP instead of loopback
- require the shared bearer token on all non-health routes
- allowlist the private-network host for the MCP transport's DNS-rebinding protection

```env
# Publish the raw MCP port on the private-network IP (not the public internet)
MCP_PUBLIC_BIND=<oci-tailscale-ip>
MCP_PUBLIC_PORT=8001

# Required so the streamable-HTTP transport accepts the private-network Host/Origin
# headers (loopback is always kept for the Caddy reverse proxy).
VNIBB_MCP_ALLOWED_HOSTS=<oci-tailscale-ip>:8001,<oci-tailscale-ip>
VNIBB_MCP_ALLOWED_ORIGINS=http://<oci-tailscale-ip>:8001

# Enforce auth on the privately exposed port
VNIBB_MCP_SHARED_BEARER_TOKEN=replace-with-long-random-value
```

Why `VNIBB_MCP_ALLOWED_HOSTS` is needed: the MCP SDK's streamable-HTTP transport
enables DNS-rebinding protection and, by default, only accepts `localhost` /
`127.0.0.1` Host headers. Caddy works because it rewrites `Host: localhost:8001`.
Direct private-network clients send `Host: <private-ip>:8001`, which must be
allowlisted or the server returns `Invalid Host header`. When both
`VNIBB_MCP_ALLOWED_HOSTS` and `VNIBB_MCP_ALLOWED_ORIGINS` are empty, the SDK
defaults are preserved unchanged.

Direct-connect client config (e.g. another private-network machine or an IDE MCP client):

- endpoint: `http://<oci-tailscale-ip>:8001/mcp`
- header: `Authorization: Bearer <VNIBB_MCP_SHARED_BEARER_TOKEN>`
- health (no auth): `http://<oci-tailscale-ip>:8001/health`

Public TLS model (available, can become primary later):

- endpoint: `https://<SITE_HOSTNAME>/mcp`
- health: `https://<SITE_HOSTNAME>/mcp-health`
- same bearer token enforced inside the MCP app

Keep the database stack itself private over the private network. Only the MCP read surface is exposed;
the database is never published publicly.

## VniAgent integration guidance

This branch now rewires selected VniAgent server-side reads through the MCP companion.

Current integration point:

- `apps/api/vnibb/api/v1/copilot.py`
- `apps/api/vnibb/services/ai_context_service.py`
- `apps/api/vnibb/services/vnibb_mcp_client_service.py`

Current behavior:

1. `chat/stream` still builds runtime context on the server
2. when `VNIBB_MCP_URL` is configured, selected database-backed reads use MCP tools instead of direct database reads
3. current selected MCP-backed reads are:
   - `get_market_snapshot`
   - `get_symbol_snapshot`
4. if the MCP companion is unavailable, the backend logs a warning and falls back to direct database-stack logic

This keeps the current VniAgent surface stable while making MCP the preferred read path for database-backed copilot context.

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
- database writes or deletes
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

Run from `vnibb/` against an already running sidecar; this command does not start production:

```bash
VNIBB_MCP_SHARED_BEARER_TOKEN=... SYMBOL=FPT PERIOD_TYPE=year PYTHON_MODE=host:python3 BASE_URL=http://127.0.0.1:8001 bash scripts/oracle/mcp_smoke_test.sh
VNIBB_MCP_SHARED_BEARER_TOKEN=... SYMBOL=FPT PERIOD_TYPE=quarter PYTHON_MODE=host:python3 BASE_URL=https://api.example.com bash scripts/oracle/mcp_smoke_test.sh
# Uses the running container's bearer env when not explicitly supplied:
ENV_FILE=deployment/env.oracle COMPOSE_FILE=docker-compose.oracle.yml PYTHON_MODE=container SYMBOL=FPT bash scripts/oracle/mcp_smoke_test.sh
```

The protocol smoke initializes MCP, lists required tools, checks both database statuses, and reads symbol-scoped PostgreSQL prices plus all three structured statements and matching Mongo IQ envelopes. It validates source, explicit units, fiscal scope, numeric financial values, raw payload, descriptors, and company type. Disconnected/unconfigured databases and connected-but-empty IQ data fail with different messages. Health alone is never connectivity proof.

TLS verification is always enabled. For a private CA, set `SSL_CERT_FILE` to the trusted CA bundle (the path must exist in the selected container when using container mode). No TLS bypass is provided. Auto mode chooses a host Python with `mcp`/`httpx`, otherwise a running compose MCP container; compose interpolation always uses `--env-file "$ENV_FILE"`. `MCP_URL`/`HEALTH_URL` override routing; container loopback points to that container, not the caller's host.

Limitations: this is persisted-data acceptance for one symbol and one fiscal basis, not live provider reachability, all-symbol coverage, freshness, ratio completeness, or unit equivalence across datasets. The ratio dataset is probed and reports availability, but completeness is not asserted. IQ may legitimately omit units or a decoded fiscal basis: the writer preserves `unknown` and raw evidence, and smoke fails acceptance for that dataset rather than fabricating scale or labeling cumulative values quarterly. Source-date absence also fails; receipt time cannot substitute. Run both fiscal periods and each target symbol as needed. Focused regressions (not run during edits):

```bash
python -m pytest apps/api/tests/test_api/test_mcp_server.py apps/api/tests/test_api/test_matrix_mcp.py -q
```
