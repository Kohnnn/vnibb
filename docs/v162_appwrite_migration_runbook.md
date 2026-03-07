# V162 Appwrite Migration Runbook (Supabase + Upstash to Appwrite)

Date: 2026-03-06
Scope: VNIBB production stack migration with zero data-loss posture

## Target Architecture

- Keep `Zeabur` as backend host.
- Keep `Vercel` as frontend host.
- Move from Supabase/Upstash to Appwrite Cloud for:
  - Database
  - Auth
  - Storage
  - Cache-like ephemeral reads (via Appwrite DB + Functions/Realtime patterns)

## Current Deployment Endpoints

- Zeabur backend deployment:
  `https://zeabur.com/projects/69a8357415b3a09b48db70c2/services/69a835a5267d762cdff749c8/deployments/69a8363d2aac0b602d5dcf99?envID=69a83574a2c1609bd1efdff2`
- Upstash Redis:
  `https://console.upstash.com/redis/800c83d6-e1a4-443f-93b1-d1dbad3bb01d/details`
- Supabase SQL editor:
  `https://supabase.com/dashboard/project/cbatjktmwtbhelgtweoi/editor/23486?schema=public`
- Vercel frontend:
  `https://vercel.com/vphk2001-gmailcoms-projects/vnibb-web`

## Appwrite Connectivity Status

- Connectivity verified via `scripts/appwrite/check_appwrite_connectivity.mjs`.
- Project ID: `69a9c5ab0003bd4e280c`.
- Database: `VniBB` (`69a9c70d0026c7d08f51`).
- Current collection count: `9` (schema bootstrap completed).

## Migration Progress Snapshot

- Baseline exported: `scripts/appwrite/supabase_baseline.json`.
- Collection bootstrap completed via `scripts/appwrite/ensure_appwrite_collections.mjs`.
- Text-safe attribute bootstrap completed for immutable collections via `scripts/appwrite/ensure_appwrite_attributes_textsafe.mjs`.
- Live backfill status:
  - `stocks`: `1,738` docs (synced)
  - `income_statements`: `32,837` docs migrated (source currently lower due upstream cleanup)
  - `balance_sheets`: `83,060` docs migrated (source currently lower due upstream cleanup)
  - `cash_flows`: `46,334` docs migrated (source currently lower due upstream cleanup)
  - `financial_ratios`: `12,249` docs migrated with rolling catch-up (source actively changing)
  - `stock_prices`: `163,439 / 802,619` docs migrated (chunked backfill in progress)
- Parity verification uses `scripts/appwrite/verify_appwrite_counts.mjs`.

Important data note:

- Supabase source table counts are currently volatile because cleanup + ingestion jobs run concurrently.
- Appwrite intentionally keeps already-migrated historical records to avoid data loss, so target may be a superset when source shrinks after cleanup.

## What This Changes in VNIBB

- Frontend auth client (`apps/web/src/lib/supabase.ts`) migrates to Appwrite SDK client init.
- Frontend auth context (`apps/web/src/contexts/AuthContext.tsx`) maps sign in/up/OAuth flows to Appwrite account APIs.
- Backend cache layer (`apps/api/vnibb/core/cache.py`) gets provider abstraction with Appwrite-backed fallback path.
- Backend data source adapters move from direct Postgres/Supabase assumptions to Appwrite collection reads where needed.

## Critical Data Protection Rules

1. No hard cutover until dual-read validation passes.
2. No delete/prune operations on historical market data during migration window.
3. Monetary/financial fields must avoid precision loss:
   - Store high-value/ratio fields as strings in migration payload where required.
   - Keep raw source snapshots for audit.
4. Backfill is idempotent (upsert by deterministic document IDs).

## Supabase Optimization Status (Pre-Migration)

- Phase 1 index cleanup already executed.
- Size reduced from `580 MB` to `518 MB` without deleting rows.
- This lowers pressure while Appwrite migration is prepared.

Footprint query used:

```sql
SELECT
  relname AS "Table",
  pg_size_pretty(pg_total_relation_size(relid)) AS "Total Size",
  pg_size_pretty(pg_relation_size(relid)) AS "Data Size",
  pg_size_pretty(pg_total_relation_size(relid) - pg_relation_size(relid)) AS "Index Size"
FROM pg_catalog.pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC;
```

Top current consumers:

- `stock_prices`: total `216 MB` (data `103 MB`, index `113 MB`)
- `intraday_trades`: total `83 MB` (data `37 MB`, index `46 MB`)

## Collection Strategy (Recommended)

Use domain-based Appwrite collections. Keep natural table boundaries where possible.

- Market core:
  - `stocks`
  - `stock_prices`
  - `stock_indices`
  - `technical_indicators`
- Fundamentals:
  - `income_statements`
  - `balance_sheets`
  - `cash_flows`
  - `financial_ratios`
  - `screener_snapshots`
- Flow/events/news:
  - `intraday_trades`
  - `foreign_trading`
  - `order_flow_daily`
  - `company_events`
  - `market_news`
  - `company_news`
  - `dividends`
- User workspace/auth-adjacent app data:
  - `user_dashboards`
  - `dashboard_widgets`
  - `alert_settings`
  - `insider_alerts`

Relationship modeling in Appwrite:

- Use document ID references (`stockId`, `dashboardId`, `userId`) as string attributes.
- Keep foreign key pairs denormalized where query patterns are read-heavy (`symbol` + reference ID).

## Phased Migration Plan

### Phase A - Foundation

1. Create Appwrite project and environments (staging, production).
2. Create Appwrite database and collections.
3. Define attributes and indexes for top query paths (`symbol`, `time`, `trade_date`, `user_id`).
4. Create API key scoped to databases/documents/storage/auth management required for migration.

### Phase B - Backfill (No Traffic Switch Yet)

1. Export/import by batches from Supabase Postgres to Appwrite using script in `scripts/appwrite/`.
2. Start with immutable historical tables (`stock_prices`, statements, ratios).
3. Migrate user-facing mutable tables last (`user_dashboards`, `dashboard_widgets`, alerts).

### Phase C - Dual-Write / Shadow Read

1. Backend writes to both old and new stores.
2. Read path remains Supabase primary.
3. Run parity jobs comparing row/document counts and checksums per symbol/date window.

### Phase D - Controlled Read Cutover

1. Enable Appwrite read path for low-risk endpoints first (`company_news`, `company_events`, non-critical widgets).
2. Gradually migrate market/fundamental endpoints.
3. Keep Supabase as hot rollback source through full trading cycle.

### Phase E - Final Cutover + Decommission

1. Freeze writes briefly.
2. Run delta sync.
3. Flip primary reads and writes to Appwrite.
4. Keep Supabase read-only retention for rollback window.

## Cache Migration (Upstash -> Appwrite Pattern)

Recommended pattern for VNIBB:

- Introduce `CacheBackend` abstraction in API service layer.
- Implement:
  - `RedisCacheBackend` (current)
  - `AppwriteCacheBackend` (Appwrite collection + expiry field + background cleanup function)
  - `MemoryCacheBackend` (already exists as fallback)

Suggested cache collection fields:

- `key` (string, indexed)
- `payload` (string/json)
- `expires_at` (datetime, indexed)
- `namespace` (string)

## Security Mapping (Supabase RLS -> Appwrite Permissions)

- Public market data collections: `read:any`, write only server key/functions.
- User workspace collections:
  - Read/write limited to `Role.user(<ownerUserId>)`.
  - Optional team roles for admin support operations.
- Service-only maintenance collections: no public permissions.

## Frontend Client Switch (Reference)

Before:

```ts
createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
```

After:

```ts
new Client()
  .setEndpoint('https://cloud.appwrite.io/v1')
  .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!)
```

## Artifacts Added

- Migration script: `scripts/appwrite/migrate_supabase_to_appwrite.mjs`
- Schema map example: `scripts/appwrite/schema-map.example.json`
- Baseline export script: `scripts/appwrite/export_supabase_baseline.mjs`
- Connectivity check script: `scripts/appwrite/check_appwrite_connectivity.mjs`
- MCP launcher script: `scripts/appwrite/run_mcp_from_env.mjs`
- Collection bootstrap script: `scripts/appwrite/ensure_appwrite_collections.mjs`
- Attribute bootstrap script: `scripts/appwrite/ensure_appwrite_attributes_textsafe.mjs`
- Collection reset script: `scripts/appwrite/reset_appwrite_collections.mjs`
- Count verification script: `scripts/appwrite/verify_appwrite_counts.mjs`
- Chunked loop runner script: `scripts/appwrite/run_backfill_loop.mjs`
- Migration state inspector: `scripts/appwrite/inspect_migration_state.mjs`
- Deployment env checklist: `scripts/appwrite/generate_cutover_env_checklist.mjs`
- Script usage guide: `scripts/appwrite/README.md`
- Prompt for migration agent: `docs/v162_appwrite_migration_prompt.md`
- Step tracker: `docs/v162_appwrite_step_by_step.md`
- Full setup migration guide: `docs/v163_appwrite_full_setup_migration.md`

Code-level mitigation scaffolding added:

- Frontend Appwrite auth helper: `apps/web/src/lib/appwrite.ts`
- Frontend provider-aware auth context: `apps/web/src/contexts/AuthContext.tsx`
- Frontend callback handler (Appwrite + Supabase): `apps/web/src/app/auth/callback/page.tsx`
- Backend cache backend selector + fallback improvements:
  - `apps/api/vnibb/core/config.py`
  - `apps/api/vnibb/core/cache.py`

Migration reliability reinforcements:

- Default keyset pagination mode in migration runner (safer under concurrent inserts/deletes).
- Snapshot upper-bound support to freeze batch window for consistent runs.
- Per-table checkpoint state persisted in `scripts/appwrite/migration_state.json` for resumable backfills.
- Baseline-aware verification mode to compare against pre-migration snapshot when live source counts drift.
