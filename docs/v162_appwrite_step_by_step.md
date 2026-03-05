# V162 Step-by-Step Appwrite Mitigation

Date: 2026-03-06

## Goal

Migrate safely from Supabase + Upstash toward Appwrite without losing historical financial/market data.

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

- [ ] Validate Appwrite credentials and DB access:
  - `node scripts/appwrite/check_appwrite_connectivity.mjs`
- [ ] Start MCP server from `.env` (uses `APPWRITE_PROJECT_ID`/`APPWRITE_API_KEY` or aliases `APPWRITE_NAME`/`APPWRITE_SECRET`):
  - `node scripts/appwrite/run_mcp_from_env.mjs --databases`
- [ ] Create Appwrite staging project + database + collections.
- [ ] Populate `schema-map` with real collection IDs and owner permission fields.
- [ ] Run migration script in dry-run mode.
- [ ] Run first live backfill for immutable tables only (`stocks`, `stock_prices`, financial statements, ratios).

## Step 6 - Data Integrity Verification (Next)

- [ ] Export Supabase baseline counts + sample hashes using:
  - `node scripts/appwrite/export_supabase_baseline.mjs`
- [ ] Build source-vs-target count checks by table.
- [ ] Add sample checksum validation by symbol/date windows.
- [ ] Validate no precision drift for money/ratio columns.

## Step 7 - Controlled Cutover (Next)

- [ ] Enable Appwrite auth provider in staging frontend.
- [ ] Add backend dual-write for selected collections.
- [ ] Shadow-read Appwrite on low-risk endpoints.
- [ ] Promote to production only after parity checks pass.
