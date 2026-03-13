# Appwrite Migration Scripts

This folder contains utilities to migrate VNIBB data from Supabase Postgres to Appwrite.

Runtime model:

- Appwrite is the primary runtime datastore for Appwrite-enabled reads.
- Supabase/Postgres stays in place as the fallback source and seed source.
- Backend sync flows can call this migration runner to populate Appwrite after Postgres syncs.
- Production backend now has a Python HTTP mirror fallback, so Appwrite population can still run on Zeabur even when `node` is unavailable in the container.

## Files

- `migrate_supabase_to_appwrite.mjs`: batch migration runner (idempotent upsert behavior).
- `schema-map.example.json`: sample table->collection mapping config.
- `export_supabase_baseline.mjs`: exports source baseline counts + sample hashes for parity checks.
- `check_appwrite_connectivity.mjs`: validates Appwrite endpoint/project/database connectivity.
- `run_mcp_from_env.mjs`: starts Appwrite MCP server using vars loaded from `apps/api/.env`.
- `ensure_appwrite_collections.mjs`: creates missing Appwrite collections from schema map.
- `ensure_appwrite_attributes_textsafe.mjs`: creates longtext attributes from source table columns.
- `reset_appwrite_collections.mjs`: deletes + recreates selected collections.
- `verify_appwrite_counts.mjs`: compares Supabase row counts vs Appwrite document counts.
- `run_backfill_loop.mjs`: repeatedly runs chunked backfills for one table until caught up or chunk limit is reached.
- `inspect_migration_state.mjs`: prints per-table keyset checkpoint progress from migration state.
- `check_cutover_readiness.mjs`: baseline-based readiness gate for full Appwrite data cutover.
- `generate_cutover_env_checklist.mjs`: prints Zeabur/Vercel Appwrite env checklist from `apps/api/.env`.

## Prerequisites

Install dependencies in repo root:

```bash
pnpm add -D pg node-appwrite
```

Set env vars:

```bash
SUPABASE_DATABASE_URL=postgresql://...
APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1
APPWRITE_PROJECT_ID=...
APPWRITE_API_KEY=...
APPWRITE_DATABASE_ID=...
MIGRATION_SCHEMA_MAP=./scripts/appwrite/schema-map.example.json
MIGRATION_PAGINATION_MODE=keyset
MIGRATION_RESUME=true
MIGRATION_SNAPSHOT_UPPER_BOUND=true
MIGRATION_BOOTSTRAP_CURSOR_FROM_TARGET_COUNT=false
MIGRATION_STATE_FILE=./scripts/appwrite/migration_state.json
MIGRATION_BATCH_SIZE=500
MIGRATION_CONCURRENCY=5
MIGRATION_DRY_RUN=true
MIGRATION_TABLES=stocks,stock_prices
MIGRATION_COERCE_ALL_TO_STRING=true
MIGRATION_START_CURSOR=
MIGRATION_MAX_ROWS=0
MIGRATION_BASELINE_OUT=./scripts/appwrite/supabase_baseline.json
MIGRATION_BASELINE_SAMPLE_SIZE=500
APPWRITE_POPULATE_MAX_ROWS=1000
APPWRITE_POPULATE_FORCE_HTTP=1
```

Alias support is included if your env file uses these names:

```bash
APPWRITE_NAME=<project-id>
APPWRITE_SECRET=<api-key>
```

## Run

### One-command full Node migration (recommended for Oracle cutover)

From repo root:

```bash
bash ./scripts/appwrite/run_full_node_migration.sh
```

Oracle deploys should point script env loading to `deployment/env.oracle`:

```bash
APPWRITE_ENV_FILE=./deployment/env.oracle \
MIGRATION_DRY_RUN=false \
MIGRATION_MAX_ROWS=0 \
MIGRATION_BATCH_SIZE=300 \
MIGRATION_CONCURRENCY=4 \
bash ./scripts/appwrite/run_full_node_migration.sh
```

Optional table-scoped backfill:

```bash
APPWRITE_ENV_FILE=./deployment/env.oracle \
MIGRATION_TABLES=stocks,stock_prices,income_statements,balance_sheets,cash_flows,financial_ratios \
MIGRATION_DRY_RUN=false \
MIGRATION_MAX_ROWS=0 \
bash ./scripts/appwrite/run_full_node_migration.sh
```

Dry run first:

```bash
node ./scripts/appwrite/migrate_supabase_to_appwrite.mjs
```

Then run live:

```bash
MIGRATION_DRY_RUN=false node ./scripts/appwrite/migrate_supabase_to_appwrite.mjs
```

Generate baseline report (before migration):

```bash
node ./scripts/appwrite/export_supabase_baseline.mjs
```

Validate Appwrite connectivity:

```bash
node ./scripts/appwrite/check_appwrite_connectivity.mjs
```

Start Appwrite MCP server from `apps/api/.env`:

```bash
node ./scripts/appwrite/run_mcp_from_env.mjs --databases
```

Enable all tools if needed:

```bash
node ./scripts/appwrite/run_mcp_from_env.mjs --all
```

Runtime sync/seed helpers that now populate Appwrite automatically:

- `apps/api/vnibb/services/sync_all_data.py`
- `apps/api/scripts/seed_historical.py`
- `apps/api/scripts/full_seed.py`

For Zeabur-style Python containers, set `APPWRITE_POPULATE_FORCE_HTTP=1` to use the built-in HTTP mirror fallback instead of relying on `node` in the runtime image.

Create collections from schema map:

```bash
node ./scripts/appwrite/ensure_appwrite_collections.mjs
```

Create text-safe attributes (all longtext) for selected tables:

```bash
MIGRATION_TABLES=stocks,income_statements node ./scripts/appwrite/ensure_appwrite_attributes_textsafe.mjs
```

Reset selected collections (staging only):

```bash
MIGRATION_TABLES=income_statements node ./scripts/appwrite/reset_appwrite_collections.mjs
```

Verify counts after migration:

```bash
MIGRATION_TABLES=stocks,income_statements node ./scripts/appwrite/verify_appwrite_counts.mjs
```

Verify against baseline snapshot instead of live source counts:

```bash
VERIFY_SOURCE_MODE=baseline \
VERIFY_BASELINE_FILE=./scripts/appwrite/supabase_baseline.json \
MIGRATION_TABLES=stocks,income_statements \
node ./scripts/appwrite/verify_appwrite_counts.mjs
```

Run full baseline readiness gate (recommended before cutover):

```bash
node ./scripts/appwrite/check_cutover_readiness.mjs
```

Generate deployment env checklist for Zeabur + Vercel:

```bash
node ./scripts/appwrite/generate_cutover_env_checklist.mjs
```

Recommended long-running stock price backfill settings:

```bash
MIGRATION_TABLES=stock_prices \
MIGRATION_DRY_RUN=false \
MIGRATION_COERCE_ALL_TO_STRING=true \
MIGRATION_BATCH_SIZE=300 \
MIGRATION_CONCURRENCY=4 \
MIGRATION_PAGINATION_MODE=keyset \
MIGRATION_RESUME=true \
MIGRATION_SNAPSHOT_UPPER_BOUND=true \
MIGRATION_MAX_ROWS=5000 \
node ./scripts/appwrite/migrate_supabase_to_appwrite.mjs
```

Resume by rerunning the same command; keyset mode checkpoint is stored in `MIGRATION_STATE_FILE`.

If you are switching from old offset-based partial migrations, you can bootstrap keyset cursor from
current Appwrite document count:

```bash
MIGRATION_BOOTSTRAP_CURSOR_FROM_TARGET_COUNT=true node ./scripts/appwrite/migrate_supabase_to_appwrite.mjs
```

Inspect migration checkpoint state:

```bash
node ./scripts/appwrite/inspect_migration_state.mjs
```

Automated loop runner (recommended for very large tables):

```bash
BACKFILL_TABLE=stock_prices \
BACKFILL_MAX_CHUNKS=10 \
BACKFILL_CHUNK_ROWS=5000 \
node ./scripts/appwrite/run_backfill_loop.mjs
```

## Safety Notes

- The script uses deterministic document IDs to support retries/resume.
- On duplicate IDs, it updates existing documents.
- Monetary and ratio fields can be coerced to strings using `precisionColumns` in schema map.
- Use `MIGRATION_COERCE_ALL_TO_STRING=true` with text-safe longtext attributes to avoid precision drift.
- Start with immutable data collections before user-owned mutable collections.
- Always generate `supabase_baseline.json` before first live migration batch.
- Prefer `MIGRATION_PAGINATION_MODE=keyset` for large/volatile tables; it is safer than OFFSET under concurrent writes/deletes.
- Use `MIGRATION_MAX_ROWS` to control chunk size per run; use `MIGRATION_START_CURSOR` only for manual keyset overrides.
- `MIGRATION_START_OFFSET` is legacy and only used in `offset` mode.
- During active source cleanup/ingestion windows, source row counts may drift; Appwrite may intentionally hold a superset to preserve historical data.
