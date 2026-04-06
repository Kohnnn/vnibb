# Appwrite Freeze / Supabase Primary

This runbook documents the temporary operating mode for periods when Appwrite write quotas are exhausted but VNIBB still needs to stay usable during active market windows.

Current status: Appwrite reads are healthy, but Appwrite writes are blocked by the org-level error `limit_databases_writes_exceeded`. Treat this runbook as the live source of truth for the current month only.

In this month-long mode, `DATA_BACKEND=hybrid` means:

- writes remain on `Postgres/Supabase`
- reads prefer `Postgres`
- Appwrite is used only as a read fallback where the endpoint already supports it

## Goal

- keep dashboards working
- keep earnings-season data fresh enough to trust
- avoid introducing a risky database or auth migration during a live market month

## Operational Mode

- Auth: `Supabase`
- Durable database: `Postgres/Supabase`
- Hot cache: `Redis`
- Dashboard UX: `localStorage` first, Postgres durable save second
- Appwrite: read-only legacy fallback only, with writes disabled
- Live freshness fill: `vnstock`

## Required Environment Direction

Frontend:

```env
NEXT_PUBLIC_AUTH_PROVIDER=supabase
```

Backend:

```env
DATA_BACKEND=hybrid
APPWRITE_WRITE_ENABLED=false
ALLOW_ANONYMOUS_DASHBOARD_WRITES=true
SUPABASE_JWT_SECRET=your-supabase-jwt-secret
```

## Source-of-Truth Matrix

- Dashboards:
  local browser state is the immediate source of truth, with debounced durable saves to `user_dashboards`
- System dashboard templates:
  `app_kv` in SQL is primary; Appwrite mirror is optional and should stay disabled during quota pressure
- Quotes and historical prices:
  Postgres first, Appwrite read fallback second, `vnstock` freshness/gap-fill third
- Earnings and financial statements:
  Postgres first, Appwrite read fallback second where implemented, `vnstock` refresh/gap-fill third
- Market indices and world markets:
  live provider first, database fallback second

## Dashboard Safety Rules

- Never block the UI on a cloud save.
- New custom dashboards start as local IDs and are reconciled to numeric SQL IDs after successful backend creation.
- Do not overwrite a browser with remote dashboards if the browser already has custom local dashboards.
- Use backend hydrate only for fresh browsers that only contain the built-in system dashboards.

## Supabase Cleanup For This Mode

- ensure `dashboard_widgets.dashboard_id` has a covering index
- keep existing RLS policies on `user_dashboards` and `dashboard_widgets`
- keep `app_kv` as the lightweight system-template/config store for this month

## What Not To Do During Earnings Season

- do not move runtime storage to Oracle Autonomous Database
- do not switch auth providers again
- do not re-enable Appwrite writes unless doing a deliberate off-peak backfill
- do not widen the dashboard schema beyond what `layout_config` already carries

## Production Smoke Checklist

Run this immediately after backend/frontend deploy.

CLI verification:

```bash
bash scripts/oracle/runtime_verify.sh
BASE_URL=https://api.example.com bash scripts/oracle/runtime_verify.sh
```

### Auth and app boot

1. Load the app in a clean browser session.
2. Sign in with Supabase auth.
3. Confirm the shell loads without Appwrite-related auth errors.

### Dashboard durability

1. Create a new custom dashboard.
2. Rename it.
3. Add a tab.
4. Refresh the page.
5. Confirm the dashboard still exists.
6. Open a second browser or private window and sign in with the same account.
7. Confirm the dashboard hydrates from backend SQL.
8. Delete the dashboard.
9. Refresh and confirm it remains deleted.

### System templates

1. Open the admin layout flow.
2. Save a draft.
3. Confirm the API succeeds even with `APPWRITE_WRITE_ENABLED=false`.
4. Reload and confirm the draft is still available.

### Market-data freshness

1. Open one equity with recent earnings.
2. Confirm financial statements load.
3. Confirm ratios load.
4. Confirm quote/history widgets render.
5. Check `/market/earnings-season` and confirm results are present.

### Guardrail checks

1. Confirm backend env shows `DATA_BACKEND=hybrid`.
3. Confirm backend env shows `APPWRITE_WRITE_ENABLED=false`.
4. Confirm frontend env shows `NEXT_PUBLIC_AUTH_PROVIDER=supabase`.
5. Confirm no operator changed production back to Appwrite-first defaults.

## Next-Month Follow-up

- if Appwrite quota resets or the budget cap is changed, re-enable Appwrite only as an optional projection layer first, not as the immediate primary runtime store
- start with controlled off-peak backfills for a small set of high-value collections and verify quota behavior before enabling broader mirroring
- keep `Supabase/Postgres` as the durable source of truth until Appwrite proves stable again under real load
- decide whether Appwrite remains a read-only projection or is removed from runtime writes completely
- unify user-state ownership around Supabase IDs only
- decide whether `dashboard_widgets` remains active or `layout_config` stays canonical
- clean up any remaining docs/examples that still imply Appwrite-first runtime storage
