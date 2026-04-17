# USD Display Architecture

Date: 2026-04-16

## Scope

- USD conversion currently applies to financial, statement-style, and fundamental widgets that already route values through the shared unit helpers.
- Quote widgets, market-wide widgets, and generic TradingView embeds are still out of scope for this conversion layer.

## Runtime Model

The USD/VND runtime config now has two admin-controlled layers:

- `usd_vnd_default_rate`: global fallback rate.
- `usd_vnd_rates_by_year`: admin-managed yearly defaults keyed by report year.

Current admin endpoints:

- Public runtime read: `GET /api/v1/admin/unit-runtime/public`
- Admin runtime read: `GET /api/v1/admin/unit-runtime`
- Admin runtime save: `PUT /api/v1/admin/unit-runtime`

## Effective Precedence

When the UI displays a financial value in `USD`, the effective rate is resolved in this order:

1. Browser-local year override
2. Admin year default
3. Admin global fallback
4. Hardcoded fallback (`25_000`)

This means admin defaults now provide shared yearly baselines without taking control away from users who need browser-local what-if overrides.

## Current Persistence Phases

### Phase 1: Browser-local user overrides

- User yearly overrides are stored in browser-local storage via `UnitContext`.
- This is intentionally lightweight and does not require authentication.

### Phase 2: Future tenant / org persistence

- The repo does not currently have a first-class organization or tenant model for this feature.
- Future work should move user/org overrides into a dedicated backend store keyed by an owner scope such as `user` or `org`.
- Admin defaults remain the shared baseline even after tenant-aware persistence exists.

## Frontend Touchpoints

- `apps/web/src/lib/units.ts`: rate resolution and value conversion
- `apps/web/src/contexts/UnitContext.tsx`: local overrides plus admin-runtime hydration/merge
- `apps/web/src/components/settings/SettingsModal.tsx`: local override UI and admin default editor
- `apps/web/src/lib/api.ts`: runtime-config request/response types

## Settings Surface

- The site settings `Data` tab now keeps the `Currency & FX` section visible even when the current display unit is `VND`.
- Users can configure browser-local yearly USD/VND overrides before switching the site into `USD` display mode.
- The settings UI also shows the loaded admin fallback rate and whether a year is using a local override, an admin yearly default, or the admin global fallback.
- This section intentionally lives beside decimal places and source preferences so currency, precision, and data-source decisions remain in one site-level control surface.

## Backend Touchpoints

- `apps/api/vnibb/api/v1/admin.py`: admin/public unit-runtime endpoints
- `apps/api/vnibb/services/unit_runtime_config_service.py`: persistence + normalization inside `app_kv`

## Operational Notes

- Clearing an admin yearly value removes that year-specific default and falls back to the global admin rate.
- Clearing a browser-local yearly value removes only the local override for that year.
- Browser-local overrides should remain explicit UI behavior until a tenant-aware settings store is introduced.
