# Appwrite System Layouts Manual Setup

This is the exact manual checklist to enable the admin-first global Initial layout workflow.

## Goal
After you finish this once:
- no SSH is needed for layout-only changes
- no code edits are needed for layout-only changes
- no frontend redeploy is needed for layout-only changes
- admin can edit locked Initial dashboards from the UI and publish globally

## Use The Existing Appwrite Database
Do **not** create a second Appwrite database.

Use:
- the current VNIBB Appwrite project
- the current VNIBB Appwrite database
- a new collection inside that database

## Part 1 - Create The Appwrite Collection
### 1. Open Appwrite Console
- Open your Appwrite project
- Go to `Databases`
- Open the **existing VNIBB database** that you already use in production

### 2. Create the collection
Create a collection named:
- `system_dashboard_templates`

### 3. Add attributes
Add these attributes exactly:

| Attribute | Type | Required | Notes |
| --- | --- | --- | --- |
| `dashboard_key` | string | yes | e.g. `default-fundamental` |
| `status` | string | yes | `draft` or `published` |
| `version` | integer | yes | publish version number |
| `dashboard_json` | string | yes | full serialized dashboard JSON |
| `notes` | string | no | optional release note |
| `updated_by` | string | no | admin identifier |
| `updated_at` | string | yes | ISO timestamp |
| `published_at` | string | no | ISO timestamp for published version |

Recommended sizing:
- `dashboard_json`: allow large strings; make this the largest text field in the collection
- all other strings can be normal size

### 4. Add indexes
Create these indexes:

1. `idx_dashboard_key_status`
   - fields: `dashboard_key`, `status`
2. `idx_dashboard_key_version`
   - fields: `dashboard_key`, `version`

### 5. Permissions
You do **not** need public collection write access.

Recommended:
- keep collection locked down in Appwrite console
- backend writes using the server API key
- public frontend only reads through backend API, never directly from Appwrite collection

## Part 2 - Ensure Appwrite API Key Has Enough Access
Your backend Appwrite API key must be able to:
- read documents
- create documents
- update documents
- access the target database/collection

If you create a new Appwrite API key for this feature, give it the minimum database/document write scopes needed for the current VNIBB database.

## Part 3 - Update Oracle Backend Environment
Open your real Oracle backend env file and set these values.

Required:

```env
APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1
APPWRITE_PROJECT_ID=<your current VNIBB Appwrite project id>
APPWRITE_API_KEY=<your Appwrite server API key>
APPWRITE_DATABASE_ID=<your current VNIBB Appwrite database id>
APPWRITE_SYSTEM_TEMPLATES_COLLECTION_ID=system_dashboard_templates

ADMIN_API_KEY=<your long random admin key>
DATA_BACKEND=postgres
CACHE_BACKEND=redis
APPWRITE_WRITE_ENABLED=false
```

Notes:
- `APPWRITE_DATABASE_ID` should be the **existing VNIBB database**, not a new one
- `ADMIN_API_KEY` is the admin hash key you will save in the browser UI later

## Part 4 - Update Frontend Environment
Your frontend does **not** need the collection id.
It only needs the normal backend URL and Appwrite public auth/project settings.

Required frontend env:

```env
NEXT_PUBLIC_API_URL=https://api.example.com
NEXT_PUBLIC_WS_URL=wss://api.example.com/api/v1/ws/prices
NEXT_PUBLIC_ENABLE_REALTIME=true
NEXT_PUBLIC_APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1
NEXT_PUBLIC_APPWRITE_PROJECT_ID=<your current VNIBB Appwrite project id>
```

Auth provider:
- current recommended production mode:
  - `NEXT_PUBLIC_AUTH_PROVIDER=supabase`
- use `NEXT_PUBLIC_AUTH_PROVIDER=appwrite` only if you intentionally move auth back, which is not recommended during the current freeze window

This choice does **not** change the backend API shape.
During the current Appwrite write-freeze mode, templates are persisted in SQL first and Appwrite should remain a disabled mirror unless you are doing a controlled backfill.

## Part 5 - Redeploy
After collection + env are ready:

1. redeploy backend
2. redeploy frontend

You need this once so the admin-first system-layout APIs and UI are live.

## Part 6 - Verify Backend Is Live
### Public check
Open or call:
- `GET /api/v1/dashboard/system-layouts/published`

Expected before first publish:
- likely `count: 0`

### Admin check
Call:

```bash
curl -H "X-Admin-Key: <ADMIN_API_KEY>" \
  https://api.example.com/api/v1/admin/system-layouts
```

Expected:
- success response from backend
- empty or partial records if nothing has been published yet

## Part 7 - Use The UI
### 1. Save the admin key
- Open VNIBB
- Go to `Settings`
- Open the `Admin` tab
- paste `ADMIN_API_KEY`
- click `Save Key`

### 2. Edit a locked Initial dashboard
- Open an Initial dashboard like `Fundamental`, `Technical`, `Quant`, or `Global Markets`
- You should see the admin banner
- Click `Enable Admin Layout Mode`

### 3. Change the layout
- drag widgets
- resize widgets
- adjust tabs as needed

### 4. Save or publish
- `Save Draft` stores a draft in Appwrite
- `Publish Global` writes the published version in Appwrite

### 5. Verify publish worked
- hard refresh the page
- open the same Initial dashboard
- confirm the published layout reloads
- test on another browser/device if possible

## What Documents Will Look Like
The backend writes predictable documents based on dashboard key and status.

Examples:
- `system-layout-draft-default-fundamental`
- `system-layout-published-default-fundamental`
- `system-layout-draft-default-technical`
- `system-layout-published-default-technical`

Supported dashboard keys today:
- `default-fundamental`
- `default-technical`
- `default-quant`
- `default-global-markets`

## What Not To Do
- Do not create a second Appwrite database for this feature
- Do not store the raw admin key inside Appwrite documents
- Do not give the frontend direct Appwrite document write access for system templates
- Do not use Supabase for layout-template storage in this flow

## Future Tenant Phase (Not Required Now)
When you are ready for tenant-specific layouts, add these collections to the **same Appwrite database**:
- `tenant_dashboard_templates`
- `tenant_memberships`
- `tenant_audit_logs`

You do not need them for the current admin-first global rollout.

## Troubleshooting
### Admin banner does not appear
Check:
- frontend redeployed
- admin key saved in `Settings > Admin`
- you are on an Initial system dashboard

### Publish fails
Check:
- `ADMIN_API_KEY` matches what backend expects
- backend env contains `APPWRITE_SYSTEM_TEMPLATES_COLLECTION_ID`
- Appwrite API key has document read/write access
- collection name is exactly `system_dashboard_templates`

### Layout does not change after publish
Check:
- the publish API succeeded
- `GET /api/v1/dashboard/system-layouts/published` returns documents
- hard refresh the frontend
- check another browser/device to rule out old client state

### Backend logs mention Appwrite configuration missing
Check:
- `APPWRITE_ENDPOINT`
- `APPWRITE_PROJECT_ID`
- `APPWRITE_API_KEY`
- `APPWRITE_DATABASE_ID`
- `APPWRITE_SYSTEM_TEMPLATES_COLLECTION_ID`

## Minimum Manual Checklist
If you only want the shortest version, do this:

1. In the existing VNIBB Appwrite database, create collection `system_dashboard_templates`
2. Add 8 attributes:
   - `dashboard_key`
   - `status`
   - `version`
   - `dashboard_json`
   - `notes`
   - `updated_by`
   - `updated_at`
   - `published_at`
3. Add 2 indexes:
   - `dashboard_key + status`
   - `dashboard_key + version`
4. Set backend env:
   - `APPWRITE_SYSTEM_TEMPLATES_COLLECTION_ID=system_dashboard_templates`
   - `ADMIN_API_KEY=...`
5. Redeploy backend + frontend
6. Save admin key in the UI
7. Enable admin layout mode
8. Save draft / publish global
