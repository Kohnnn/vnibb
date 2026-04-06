# Admin-First Global System Layouts

## Purpose
Enable an admin to edit locked Initial dashboards in the UI, save drafts, and publish layouts globally without needing SSH access, manual backend edits, or a frontend redeploy for layout-only changes.

For the exact click-by-click setup, see `docs/appwrite_system_layouts_manual_setup.md`.

This document also defines the recommended tenant-ready path so the current admin-first model can evolve cleanly into role-based tenant layout management later.

## Recommended Storage Model
Use the **current VNIBB Appwrite database** as the source of truth for global and tenant layout templates.

### Recommendation
- Keep using the existing `APPWRITE_DATABASE_ID`
- Add **separate collections** for layout management
- Keep backend APIs as the write boundary
- Do **not** reintroduce Supabase for layout/template storage

### Why share the current Appwrite database
- simpler deployment and fewer secrets
- easier backup/export/inspection
- easier to relate runtime VNIBB data and layout templates
- no second Appwrite database to provision or maintain
- best fit for the current admin-first rollout

### Why not Supabase
- this feature is document-oriented and fits Appwrite collections well
- your runtime direction is already Appwrite-first
- using Supabase here would reintroduce split ownership and extra operational overhead
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
- admin can save a hash key locally in the browser
- admin can unlock a locked Initial dashboard in the UI
- admin can save a draft or publish a global version through backend APIs
- published global templates are fetched from Appwrite on load
- if Appwrite is unavailable, frontend falls back to built-in templates in `apps/web/src/contexts/DashboardContext.tsx`

### Current backend endpoints
#### Public
- `GET /api/v1/dashboard/system-layouts/published`
  - returns published global system layouts

#### Admin
- `GET /api/v1/admin/system-layouts`
- `GET /api/v1/admin/system-layouts/{dashboard_key}`
- `PUT /api/v1/admin/system-layouts/{dashboard_key}`

### Current admin auth model
- admin enters the key in `Settings > Admin`
- key is stored in browser local storage
- admin requests send `X-Admin-Key`
- this is acceptable for initial admin-first operation
- later this should be replaced by a short-lived admin session/token

## Appwrite Collections
### Implement now
Use the existing Appwrite database and create this collection now:
- `system_dashboard_templates`

### Recommended schema: `system_dashboard_templates`
- `dashboard_key` string
- `status` string (`draft` or `published`)
- `version` integer
- `dashboard_json` string
- `notes` string
- `updated_by` string
- `updated_at` string
- `published_at` string

### Recommended indexes
- `(dashboard_key, status)`
- `(dashboard_key, version)`

## Tenant-Ready Design
These are not all implemented yet, but this is the recommended next layer.

### Future collection: `tenant_dashboard_templates`
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

### Future collection: `tenant_memberships`
Purpose:
- map users to tenants and roles

Recommended fields:
- `tenant_id`
- `user_id`
- `role` (`owner`, `admin`, `editor`, `viewer`)
- `status`
- `created_at`
- `updated_at`

### Future collection: `tenant_audit_logs`
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
- published layout JSON should live in Appwrite and be loaded through backend APIs

## Oracle / Production Environment
For the current implementation, keep using the existing Appwrite database only as an optional legacy fallback for system-template mirroring. SQL is the primary store during Appwrite quota pressure.

### Required backend env
Add these to your Oracle deployment env:

```env
APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1
APPWRITE_PROJECT_ID=your-appwrite-project-id
APPWRITE_API_KEY=your-appwrite-server-api-key
APPWRITE_DATABASE_ID=your-existing-vnibb-appwrite-database-id
APPWRITE_SYSTEM_TEMPLATES_COLLECTION_ID=system_dashboard_templates

ADMIN_API_KEY=replace-with-long-random-value
DATA_BACKEND=postgres
CACHE_BACKEND=redis
APPWRITE_WRITE_ENABLED=false
```

### Frontend env
The frontend does not need direct collection access. It only needs the normal API + auth/public Appwrite settings:

```env
NEXT_PUBLIC_API_URL=https://api.example.com
NEXT_PUBLIC_WS_URL=wss://api.example.com/api/v1/ws/prices
NEXT_PUBLIC_ENABLE_REALTIME=true
NEXT_PUBLIC_AUTH_PROVIDER=supabase
NEXT_PUBLIC_APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1
NEXT_PUBLIC_APPWRITE_PROJECT_ID=your-appwrite-project-id
```

If auth remains on Supabase temporarily, you can keep:

```env
NEXT_PUBLIC_AUTH_PROVIDER=supabase
```

That does **not** change the recommendation to keep system-layout APIs backend-mediated.

During the current Appwrite write-freeze mode, the primary template store is SQL `app_kv`, with Appwrite mirroring disabled.

## What "no backend access anymore" should mean
After the initial deploy and Appwrite setup:
- no SSH needed for layout-only changes
- no code changes needed for layout-only changes
- no frontend redeploy needed for layout-only changes
- admin uses the UI to draft/publish global layouts

What it should **not** mean:
- removing backend APIs from the flow

The backend should remain the security boundary because:
- it validates `X-Admin-Key`
- it controls writes to Appwrite
- it can later enforce tenant RBAC cleanly

## Rollout Checklist
### Implement now
1. keep current Appwrite database
2. create collection `system_dashboard_templates`
3. set:
   - `APPWRITE_ENDPOINT`
   - `APPWRITE_PROJECT_ID`
   - `APPWRITE_API_KEY`
   - `APPWRITE_DATABASE_ID`
   - `APPWRITE_SYSTEM_TEMPLATES_COLLECTION_ID`
   - `ADMIN_API_KEY`
4. redeploy backend + frontend
5. save admin key in `Settings > Admin`
6. unlock an Initial dashboard
7. save draft / publish global

### Future tenant phase
1. create `tenant_dashboard_templates`
2. create `tenant_memberships`
3. create `tenant_audit_logs`
4. add backend tenant resolution
5. add tenant scope selector to the publish UI
6. replace raw admin key with short-lived admin session

## Recommended Next Steps
1. Finish the admin-first global workflow using the shared Appwrite database
2. Add rollback/version history for global templates
3. Add tenant collections and backend tenant resolution
4. Add tenant-scoped publish controls in the UI
5. Replace raw `X-Admin-Key` browser usage with a short-lived admin session
