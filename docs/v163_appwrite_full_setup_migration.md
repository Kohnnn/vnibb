# V163 Appwrite Full Setup Migration Guide

Date: 2026-03-07

Goal: Move VNIBB operational setup from Supabase/Upstash to Appwrite with low risk and no historical data loss.

## 1) Current Status

- Appwrite project connectivity is validated.
- Appwrite database and core collections are provisioned.
- Backend sync and seed flows now populate Appwrite primary collections after Postgres writes.
- Migration tooling supports:
  - resumable keyset pagination
  - snapshot upper-bound freeze
  - baseline-aware verification
  - long-table chunk loops
- Core immutable datasets are partially/mostly migrated depending on table.

Important:

- Frontend auth can be switched to Appwrite now.
- Backend cache fallback logic is Appwrite-aware but does not yet implement a full Appwrite cache adapter.
- Backend write flows still land in Postgres first, then populate Appwrite so Appwrite stays primary at runtime.
- Supabase/Postgres is retained as fallback and rollback source only.

## 2) Service-by-Service Migration Map

### Supabase -> Appwrite

- Auth: migrate to Appwrite Account APIs.
- Database: migrate table data to Appwrite collections.
- Storage: move files/buckets to Appwrite Storage.

### Upstash -> Appwrite (or memory fallback)

- Near-term: keep Redis or use memory fallback.
- Mid-term: implement Appwrite-backed cache collection + TTL cleanup function.

### Zeabur Backend

- Keep host the same.
- Switch env and service integrations progressively.

### Vercel Frontend

- Keep host the same.
- Switch auth provider env to Appwrite.

## 3) Environment Cutover Checklist

### Appwrite (Cloud)

Ensure these are valid:

- `APPWRITE_ENDPOINT`
- `APPWRITE_NAME` or `APPWRITE_PROJECT_ID`
- `APPWRITE_SECRET` or `APPWRITE_API_KEY`
- `APPWRITE_DATABASE_ID`

Recommended API key scopes (minimum required for migration):

- databases.read
- databases.write
- collections.read
- collections.write
- documents.read
- documents.write

### Zeabur (Backend)

Set:

- `APPWRITE_ENDPOINT`
- `APPWRITE_PROJECT_ID`
- `APPWRITE_API_KEY`
- `APPWRITE_DATABASE_ID`
- `CACHE_BACKEND=auto` (recommended during transition)
- `DATA_BACKEND=appwrite`
- `APPWRITE_POPULATE_MAX_ROWS=1000` on Zeabur (`2000-3000` only for off-peak catch-up)

Keep for now:

- `DATABASE_URL` / `DATABASE_URL_SYNC` as fallback source and rollback path.

### Vercel (Frontend)

Set:

- `NEXT_PUBLIC_AUTH_PROVIDER=appwrite`
- `NEXT_PUBLIC_APPWRITE_ENDPOINT`
- `NEXT_PUBLIC_APPWRITE_PROJECT_ID`

Keep until stable:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Remove Supabase client vars only after auth cutover is fully verified.

## 4) Data Migration Playbook (Recommended)

1. Export baseline snapshot:

   `node scripts/appwrite/export_supabase_baseline.mjs`

2. Ensure collections exist:

   `node scripts/appwrite/ensure_appwrite_collections.mjs`

3. Ensure attributes for selected tables:

   `MIGRATION_TABLES=stocks,stock_prices,income_statements,balance_sheets,cash_flows,financial_ratios node scripts/appwrite/ensure_appwrite_attributes_textsafe.mjs`

4. Backfill large tables with loop runner:

   `BACKFILL_TABLE=stock_prices BACKFILL_MAX_CHUNKS=20 BACKFILL_CHUNK_ROWS=5000 node scripts/appwrite/run_backfill_loop.mjs`

5. Inspect checkpoint progress:

   `node scripts/appwrite/inspect_migration_state.mjs`

6. Verify against baseline:

   `node scripts/appwrite/check_cutover_readiness.mjs`

7. Generate deployment env checklist:

   `node scripts/appwrite/generate_cutover_env_checklist.mjs`

## 5) Auth Cutover Playbook

1. Set Vercel `NEXT_PUBLIC_AUTH_PROVIDER=appwrite` in preview first.
2. Validate flows in preview deployment:
   - email/password login
   - magic link callback
   - Google OAuth callback
   - sign out
3. Promote to production once success criteria pass.

Runtime verification endpoints after deploy:

- `GET /health` (quick provider summary)
- `GET /health/detailed` (includes Appwrite connectivity component)
- `GET /api/v1/admin/providers/status` with `X-Admin-Key` (provider/cutover diagnostics)

Provider fields now include both requested and effective backend:

- `data_backend_requested`
- `data_backend` (effective resolved backend)

## 6) Full Backend Data Cutover (Final Step)

To fully remove Supabase/Postgres dependency from backend runtime:

1. Introduce Appwrite repositories for core read paths.
2. Add provider switch for service layer (`postgres` vs `appwrite`).
3. Shadow-read and compare API responses.
4. Promote Appwrite as primary read path.
5. Keep Supabase in read-only fallback window.

Current backend progress:

- Appwrite-aware runtime diagnostics are live.
- Sync/seed orchestration now mirrors Appwrite primary collections after Postgres syncs.
- First real Appwrite read paths are now scaffolded in backend:
  - `GET /api/v1/equity/{symbol}/profile`
  - `GET /api/v1/equity/{symbol}/quote`
  - `GET /api/v1/equity/historical`
- Behavior:
  - `DATA_BACKEND=appwrite`: selected reads prefer Appwrite first, with Postgres/Supabase fallback.
  - `DATA_BACKEND=hybrid`: legacy alias that now resolves to the same Appwrite-first behavior when Appwrite is configured.

## 7) Cutover Gate (Do Not Skip)

Use this final gate before claiming full Appwrite data readiness:

`node scripts/appwrite/check_cutover_readiness.mjs`

Required: all required tables must report `PASS`.
