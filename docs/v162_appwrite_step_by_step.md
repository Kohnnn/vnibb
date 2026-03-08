# V162 Step-by-Step Appwrite Mitigation

Date: 2026-03-06

## Goal

Migrate safely from Supabase + Upstash toward Appwrite without losing historical financial/market data.
Current runtime rule: Appwrite is primary, Supabase/Postgres is fallback-only.

## Step 1 - Stabilize Current Footprint (Done)

- [x] Removed duplicate + unused indexes in Supabase production.
- [x] Reduced DB size from `580 MB` to `518 MB` with zero row deletion.
- [x] Added rollback SQL for dropped indexes.

Artifacts:

- `docs/v161_supabase_storage_free_tier_plan.md`
- `docs/sql/supabase_storage_phase1_indexes.sql`
- `docs/sql/supabase_storage_phase1_rollback_indexes.sql`

## Step 2 - Migration Tooling and Contracts (Done)

- [x] Added migration runbook and migration-agent prompt.
- [x] Added Node migration script (Supabase Postgres -> Appwrite).
- [x] Added schema map template with precision-safe column guidance.

Artifacts:

- `docs/v162_appwrite_migration_runbook.md`
- `docs/v162_appwrite_migration_prompt.md`
- `scripts/appwrite/migrate_supabase_to_appwrite.mjs`
- `scripts/appwrite/schema-map.example.json`
- `scripts/appwrite/README.md`

## Step 3 - Frontend Auth Provider Mitigation (Done)

- [x] Added Appwrite REST helper module for auth sessions.
- [x] Updated auth context to support provider switch:
  - default: Supabase
  - migration mode: Appwrite (`NEXT_PUBLIC_AUTH_PROVIDER=appwrite`)
- [x] Updated auth callback page to handle Appwrite OAuth/magic-link token flow.

Artifacts:

- `apps/web/src/lib/appwrite.ts`
- `apps/web/src/contexts/AuthContext.tsx`
- `apps/web/src/app/auth/callback/page.tsx`
- `apps/web/src/lib/env.ts`
- `apps/web/src/lib/config.ts`

## Step 4 - Backend Cache Mitigation (Done)

- [x] Added Appwrite/cache backend configuration fields.
- [x] Added `CACHE_BACKEND` setting (`auto|redis|memory|appwrite`).
- [x] Improved cache decorator fallback behavior:
  - memory cache can work even when Redis is disabled.
  - warns and safely falls back when `CACHE_BACKEND=appwrite` but adapter is not active yet.

Artifacts:

- `apps/api/vnibb/core/config.py`
- `apps/api/vnibb/core/cache.py`
- `apps/api/.env.example`

## Step 5 - Staging Migration Execution (Next)

- [x] Validate Appwrite credentials and DB access:
  - `node scripts/appwrite/check_appwrite_connectivity.mjs`
- [x] Start MCP server from `.env` (uses `APPWRITE_PROJECT_ID`/`APPWRITE_API_KEY` or aliases `APPWRITE_NAME`/`APPWRITE_SECRET`):
  - `node scripts/appwrite/run_mcp_from_env.mjs --databases`
- [x] Run migration script in dry-run mode (filtered pilot):
  - `MIGRATION_TABLES=stocks,income_statements`
  - rows read: `34,575`, failures: `0`
- [x] Create Appwrite database collections from schema map:
  - created 9 collections in `VniBB (69a9c70d0026c7d08f51)`.
- [x] Add automated chunk loop runner for very large tables:
  - `scripts/appwrite/run_backfill_loop.mjs`
- [x] Reinforce migration engine with keyset pagination + state checkpoints:
  - `MIGRATION_PAGINATION_MODE=keyset` (default)
  - `MIGRATION_STATE_FILE=./scripts/appwrite/migration_state.json`
  - resumeable cursor checkpoints per table
- [x] Populate text-safe attributes for pilot collections:
  - `stocks`, `income_statements` longtext attributes created from source columns.
- [x] Run first live backfill pilot for immutable tables:
  - `stocks`: `1,738` created, `0` failed.
  - `income_statements`: migrated in chunks to full source parity.
- [x] Create/validate attributes for remaining immutable collections (`stock_prices`, `balance_sheets`, `cash_flows`, `financial_ratios`).
- [~] Run chunked backfills for remaining immutable collections:
  - `balance_sheets`: backfill complete (`83,060` docs in Appwrite)
  - `cash_flows`: backfill complete (`46,334` docs in Appwrite)
  - `financial_ratios`: near-realtime catch-up active (`12,249` docs; source changing during sync)
  - `stock_prices`: in progress (`163,439 / 802,619` docs; chunked runner ongoing)

## Step 6 - Data Integrity Verification (Next)

- [x] Export Supabase baseline counts + sample hashes using:
  - `node scripts/appwrite/export_supabase_baseline.mjs`
  - output: `scripts/appwrite/supabase_baseline.json`
- [ ] Build source-vs-target count checks by table.
- [x] Build source-vs-target count checks by table (automation script):
  - `node scripts/appwrite/verify_appwrite_counts.mjs`
- [x] Added baseline-aware verification mode to reduce false mismatches during live source drift:
  - `VERIFY_SOURCE_MODE=baseline`
  - `VERIFY_BASELINE_FILE=./scripts/appwrite/supabase_baseline.json`
- [x] Build source-vs-target count checks by table (pilot):
  - `stocks`: source `1738`, target `1738`.
  - `income_statements`: source `32837`, target `32837`.
- [x] Added reset/bootstrap scripts for iterative backfill and resumable repair:
  - `scripts/appwrite/reset_appwrite_collections.mjs`
  - `scripts/appwrite/ensure_appwrite_attributes_textsafe.mjs`
- [ ] Add sample checksum validation by symbol/date windows.
- [ ] Validate no precision drift for money/ratio columns.

Note:

- Source row counts in Supabase are currently volatile (cleanup + live ingestion), so strict parity to *current* source can drift.
- We preserve migrated historical records in Appwrite to avoid data loss; where source shrinks, Appwrite may intentionally hold a superset.

## Step 7 - Controlled Cutover (Next)

- [ ] Enable Appwrite auth provider in staging frontend.
- [x] Populate Appwrite primary collections after backend sync/seed runs.
- [ ] Expand Appwrite-first reads across additional low-risk endpoints.
- [ ] Promote to production only after parity checks pass.
