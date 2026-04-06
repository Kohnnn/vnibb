# Appwrite Freeze / Supabase Primary

This runbook documents the temporary operating mode for periods when Appwrite write quotas are exhausted but VNIBB still needs to stay usable during active market windows.

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
DATA_BACKEND=postgres
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
  Postgres first, `vnstock` gap-fill second, Appwrite only as stale legacy fallback
- Earnings and financial statements:
  Postgres first, `vnstock` refresh/gap-fill second
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

## Next-Month Follow-up

- decide whether Appwrite remains a read-only projection or is removed from runtime writes completely
- unify user-state ownership around Supabase IDs only
- decide whether `dashboard_widgets` remains active or `layout_config` stays canonical
- clean up any remaining docs/examples that still imply Appwrite-first runtime storage
