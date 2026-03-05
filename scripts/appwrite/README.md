# Appwrite Migration Scripts

This folder contains utilities to migrate VNIBB data from Supabase Postgres to Appwrite.

## Files

- `migrate_supabase_to_appwrite.mjs`: batch migration runner (idempotent upsert behavior).
- `schema-map.example.json`: sample table->collection mapping config.
- `export_supabase_baseline.mjs`: exports source baseline counts + sample hashes for parity checks.
- `check_appwrite_connectivity.mjs`: validates Appwrite endpoint/project/database connectivity.
- `run_mcp_from_env.mjs`: starts Appwrite MCP server using vars loaded from `apps/api/.env`.

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
MIGRATION_BATCH_SIZE=500
MIGRATION_CONCURRENCY=5
MIGRATION_DRY_RUN=true
MIGRATION_BASELINE_OUT=./scripts/appwrite/supabase_baseline.json
MIGRATION_BASELINE_SAMPLE_SIZE=500
```

Alias support is included if your env file uses these names:

```bash
APPWRITE_NAME=<project-id>
APPWRITE_SECRET=<api-key>
```

## Run

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

## Safety Notes

- The script uses deterministic document IDs to support retries/resume.
- On duplicate IDs, it updates existing documents.
- Monetary and ratio fields can be coerced to strings using `precisionColumns` in schema map.
- Start with immutable data collections before user-owned mutable collections.
- Always generate `supabase_baseline.json` before first live migration batch.
