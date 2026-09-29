# Admin-First Global System Layouts

## Purpose
Enable an admin to edit locked Initial dashboards in the UI, save drafts, and publish layouts globally without needing SSH access, manual backend edits, or a frontend redeploy for layout-only changes.

For deployment and credential migration, use the rollout checklist below and `docs/oracle_runbook.md`; archived shared-key setup instructions are obsolete.

This document also defines the recommended tenant-ready path so the current admin-first model can evolve cleanly into role-based tenant layout management later.

## Recommended Storage Model
Use the **current VNIBB database stack** as the source of truth for global and tenant layout templates.

### Recommendation
- Store templates in the Postgres `app_kv` table
- Keep backend APIs as the write boundary
- Do **not** reintroduce a second store for layout/template storage

### Why share the current database stack
- simpler deployment and fewer secrets
- easier backup/export/inspection
- easier to relate runtime VNIBB data and layout templates
- no second database to provision or maintain
- best fit for the current admin-first rollout

### Why not a separate store
- this feature is small and key-addressed, which fits the `app_kv` table well
- your runtime direction is already consolidated on the single Postgres store
- using a separate store here would reintroduce split ownership and extra operational overhead
- later tenant RBAC can still be enforced in backend APIs without changing storage

## Scope Levels
The long-term system should support 3 layers of layout resolution.

1. **Global**
   - applies to everyone
   - current Initial dashboards
2. **Tenant**
   - applies to one organization/workspace/customer
3. **User override**
   - personal changes layered on top of tenant/global defaults

### Recommended resolution order
1. user override
2. tenant published template
3. global published template
4. built-in fallback in code

For the current rollout, only **Global** is implemented in code. Tenant and user override are documented here as the next phase.

## Current Admin-First Flow
### What is already implemented
- locked Initial dashboards remain read-only for normal users
- admins sign in through the existing Supabase authentication service; the backend authorizes their immutable user UUID
- admin can unlock a locked Initial dashboard in the UI
- admin can save a draft or publish a global version through backend APIs
- published global templates are fetched from Postgres on load
- if Postgres is unavailable, frontend falls back to built-in templates in `apps/web/src/contexts/DashboardContext.tsx`

### Current backend endpoints
#### Public
- `GET /api/v1/dashboard/system-layouts/published`
  - returns published global system layouts

#### Admin
- `GET /api/v1/admin/system-layouts`
- `GET /api/v1/admin/system-layouts/{dashboard_key}`
- `PUT /api/v1/admin/system-layouts/{dashboard_key}`

### Current admin auth model
- Interactive `/api/v1/admin/*` calls use `Authorization: Bearer <Supabase access JWT>`, not a shared key. The automation routes below are the explicit exception.
- Set backend `ADMIN_USER_IDS` to a comma-separated string of verified immutable Supabase user UUIDs (`sub`), not emails or browser-supplied roles. An empty allowlist denies all interactive admin access.
- The backend verifies HS256 signatures with server-only `SUPABASE_JWT_SECRET`. Required claims are `exp`, `iat`, `sub`, `session_id`, `iss`, and `aud`; issuer must be `${SUPABASE_URL}/auth/v1` (without a duplicate slash), audience must be `authenticated`, and user/session identifiers must be UUIDs.
- `ADMIN_SESSION_MAX_TTL_SECONDS=3600` bounds the accepted signed token lifetime (`exp - iat`); tokens exceeding it are rejected, not silently shortened.
- `ADMIN_REVOKED_SESSION_IDS` is a comma-separated string of session UUIDs denied by the backend. Remove a user UUID from `ADMIN_USER_IDS` to revoke all of that user's admin access.
- Roll **all API workers/replicas** after changing allowlist, denylist, TTL, or signing configuration. Until every old worker is replaced, stale authorization can still be accepted.
- Supabase logout or remote session revocation does **not** instantly invalidate an already issued access JWT here. It remains usable until expiry or backend denylisting/allowlist removal takes effect. The operator must explicitly accept and provision this revocation authority before production use.
- Supabase authentication is separate from the serving PostgreSQL database. Verify operator UUIDs through the existing trusted Supabase project/admin interface; never query an `auth` schema in the serving database.

### Server-only automation
- `GET` / `PUT /api/v1/admin/automation/system-layouts/{dashboard_key}` require `X-Admin-Key` matching backend `ADMIN_API_KEY`.
- These routes use the fixed verified actor `automation:layout-publisher`. Callers cannot choose an actor with `X-Admin-Actor`.
- Keep this secret in server/CI secret storage only, never browser settings, browser storage, or `NEXT_PUBLIC_*` variables. It also protects retained operational `/data`, realtime start/stop, and metrics/debug routes; migrate their secret consumers together.
- Rotate any formerly browser-exposed key before enabling automation. Clearing stored browser keys is necessary cleanup, **not revocation**; replace the server secret, update authorized automation consumers, and roll every worker so the old value is rejected.

## Layout Template Storage
### Implement now
Templates live in the existing `app_kv` table in Postgres:
- key prefix `system_layout_template`

### Recommended record shape
- `dashboard_key` string
- `status` string (`draft` or `published`)
- `version` integer
- `dashboard_json` string
- `notes` string
- `updated_by` string
- `updated_at` string
- `published_at` string

### Recommended keys
- `(dashboard_key, status)`
- `(dashboard_key, version)`

## Tenant-Ready Design
These are not all implemented yet, but this is the recommended next layer.

### Future table: `tenant_dashboard_templates`
Purpose:
- store tenant-specific overrides for dashboards that should differ from the global Initial layouts

Recommended fields:
- `tenant_id`
- `dashboard_key`
- `status`
- `version`
- `dashboard_json`
- `notes`
- `updated_by`
- `updated_at`
- `published_at`
- `inherits_global` boolean

### Future table: `tenant_memberships`
Purpose:
- map users to tenants and roles

Recommended fields:
- `tenant_id`
- `user_id`
- `role` (`owner`, `admin`, `editor`, `viewer`)
- `status`
- `created_at`
- `updated_at`

### Future table: `tenant_audit_logs`
Purpose:
- record save/publish/rollback events for tenant and global templates

Recommended fields:
- `scope` (`global` or `tenant`)
- `tenant_id` nullable
- `dashboard_key`
- `action` (`save_draft`, `publish`, `rollback`)
- `version`
- `actor_id`
- `notes`
- `created_at`

## Role Model
### Implemented now
- `platform_admin`
  - can edit/publish global Initial layouts

### Recommended next phase
- `tenant_owner`
  - full tenant layout control
- `tenant_admin`
  - draft + publish tenant layouts
- `tenant_editor`
  - draft only
- `tenant_viewer`
  - read only

## Publishing Model
### Global publish
- admin unlocks Initial dashboard
- makes changes in existing dashboard UI
- `Save Draft`
- `Publish Global`
- every client receives the new published template on next load

### Future tenant publish
- admin selects scope: `Global` or `Tenant`
- if `Tenant`, save to `tenant_dashboard_templates`
- tenant published template overrides the global template for that tenant only

## Runtime Behavior
### Frontend fallback order
1. user local override (future)
2. tenant published template (future)
3. global published template (implemented)
4. built-in code template in `DashboardContext.tsx`

### Persistence rules
- global Initial layouts should not depend on local storage as the source of truth
- local storage may keep lightweight UI state only
- published layout JSON should live in Postgres and be loaded through backend APIs

## Oracle / Production Environment
System-layout templates are stored in the Postgres `app_kv` table. No other store participates.

### Required backend env
Add these to your Oracle deployment env:

```env
SUPABASE_URL=https://your-existing-auth-project.supabase.co
SUPABASE_JWT_SECRET=replace-with-existing-project-hs256-signing-secret
# Comma-separated immutable operator UUIDs; empty denies interactive admin access.
ADMIN_USER_IDS=
# Comma-separated session UUIDs explicitly revoked by the backend.
ADMIN_REVOKED_SESSION_IDS=
ADMIN_SESSION_MAX_TTL_SECONDS=3600
# Server-only automation/operations secret; rotate the formerly browser-exposed value.
ADMIN_API_KEY=replace-with-new-long-random-value
DATA_BACKEND=postgres
CACHE_BACKEND=redis
```

### Frontend env
The frontend does not need direct table access. It only needs the normal API + auth/public settings:

```env
NEXT_PUBLIC_API_URL=https://api.example.com
NEXT_PUBLIC_WS_URL=wss://api.example.com/api/v1/ws/prices
NEXT_PUBLIC_ENABLE_REALTIME=true
NEXT_PUBLIC_AUTH_PROVIDER=supabase
```

### One-off admin seed scripts
For dashboards where the bundled fallback is good enough but you want
the admin-published version to be ahead of time-of-deploy, the repo
ships canonical scripts that PUT to the dedicated automation system-layouts endpoint:

```bash
# Inject ADMIN_API_KEY from server/CI secret storage; do not paste it into command history.
# Standard: Global Markets dashboard (one-off seed).
python apps/api/scripts/publish_global_markets_layout.py \
    --base-url https://api.example.com

# Phase 7.7: Prediction Markets dashboard (Polymarket, Kalshi, Election,
# Macro Calibration, Movers). The --dry-run flag prints the JSON payload
# without contacting the API.
python apps/api/scripts/publish_prediction_markets_layout.py \
    --base-url https://api.example.com --dry-run
```

Both scripts are self-contained (no FastAPI imports; only `urllib`) so
they run from any Python 3.11+ host without project deps.

That does **not** change the recommendation to keep system-layout APIs backend-mediated.

## What "no backend access anymore" should mean
After the initial deploy and database-stack setup:
- no SSH needed for layout-only changes
- no code changes needed for layout-only changes
- no frontend redeploy needed for layout-only changes
- admin uses the UI to draft/publish global layouts

What it should **not** mean:
- removing backend APIs from the flow

The backend should remain the security boundary because:
- it verifies the signed user session and server allowlist for interactive requests, and the separate server-only automation key for automation requests
- it controls writes to the database stack
- it can later enforce tenant RBAC cleanly

## Rollout Checklist
### Production gate — BLOCKED pending verified acceptance
1. Keep the current Postgres stack and confirm `app_kv` exists; do not inspect or migrate authentication schemas in the serving database.
2. Verify each intended operator's immutable UUID in the existing Supabase project and configure `ADMIN_USER_IDS`; configure the matching issuer and HS256 signing secret server-side.
3. Provision an accountable operator with authority to edit `ADMIN_REVOKED_SESSION_IDS` / `ADMIN_USER_IDS` and roll every worker. Explicitly accept the signed-token expiry/revocation caveat and the 3600-second lifetime bound.
4. Remove existing stored platform admin keys from every operator browser profile/site storage. Rotate the formerly browser-exposed `ADMIN_API_KEY`, update trusted automation/operational consumers, and roll all workers; clearing browser storage alone does not revoke it.
5. Deploy backend + frontend with no public admin secret. Complete authenticated live acceptance: allowlisted operator can unlock, save draft, and publish; non-allowlisted and expired/revoked sessions are denied; shared-key-only interactive requests and the old automation key are denied.
6. Verify automation with the rotated server-only secret and verify a published layout reloads for a normal client. Record the operator UUID verification, rotation, accepted/provisioned revocation authority, and live acceptance evidence before unblocking production.

### Future tenant phase
1. create `tenant_dashboard_templates`
2. create `tenant_memberships`
3. create `tenant_audit_logs`
4. add backend tenant resolution
5. add tenant scope selector to the publish UI

## Recommended Next Steps
1. Finish the admin-first global workflow using the shared Postgres store
2. Add rollback/version history for global templates
3. Add tenant tables and backend tenant resolution
4. Add tenant-scoped publish controls in the UI
