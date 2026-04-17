# Appwrite Primary / Supabase Write Bridge

Date: 2026-04-17

## Purpose

This document captures the intended long-term VNIBB data ownership model together with the temporary quota-pressure operating split.

The key clarification is simple:

- Appwrite is still the intended full VNIBB market-data corpus.
- Supabase/Postgres is not intended to mirror the full market corpus indefinitely.
- During Appwrite write-quota pressure, Supabase/Postgres is the write-side bridge for the specific runtime surfaces that must stay durable.

## Strategic Direction

- Appwrite remains the only practical home for the full VNIBB market database footprint.
- FastAPI remains the normalization, fallback, and widget-serving layer.
- Supabase/Postgres remains useful for auth, selected durable user/runtime writes, and quota-pressure continuity.
- Redis remains the hot cache and resilience layer.

This means VNIBB should not document or behave as if Supabase/Postgres has permanently replaced Appwrite as the full durable market-data system.

## Current Practical Split

During the current quota-constrained period:

- market-data reads should keep treating the Appwrite-backed VNIBB corpus as the primary research dataset where the runtime path already supports it cleanly
- user-facing durable writes that cannot wait for Appwrite write quota are allowed to land in Supabase/Postgres
- browser-local state continues to protect immediate dashboard UX
- vnstock remains the freshness and gap-fill layer

## Source-of-Truth Matrix

- Full market corpus:
  Appwrite primary
- Auth and quota-sensitive durable writes:
  Supabase/Postgres bridge
- Dashboard immediate UX state:
  browser-local first
- Widget/API normalization:
  FastAPI service layer
- Cache and resilience:
  Redis
- Freshness and gap fill:
  vnstock

## Important Constraint

Supabase/Postgres should not quietly become the implied long-term replacement for the full Appwrite market corpus just because quota pressure forced a temporary write-side bridge.

That would create two problems:

- documentation drift away from the actual intended architecture
- product assumptions that stop matching the only store capable of holding the full VNIBB database footprint

## What To Reinforce In Product Surfaces

- say `VNIBB database` or `Appwrite-backed VNIBB database` instead of implying Supabase/Postgres is the full research corpus
- keep AI settings, AI widgets, and MCP docs aligned around VNIBB database-first behavior
- describe Supabase/Postgres as the temporary durable write bridge when quota pressure blocks Appwrite writes

## Quota Refresh Direction

When Appwrite write quota refreshes:

- do not leave the architecture story ambiguous
- re-enable Appwrite writes deliberately and in controlled scopes
- keep Supabase/Postgres only where it still adds value for auth or constrained durable writes
- avoid documenting Supabase/Postgres as the permanent full-market primary store unless the product intentionally changes strategy later

## Related Docs

- `docs/APPWRITE_VNSTOCK_ROLLOUT.md`
- `docs/APPWRITE_FREEZE_SUPABASE_PRIMARY.md` (historical temporary runbook)
- `docs/DEPLOYMENT_AND_OPERATIONS.md`
- `docs/VNIBB_MCP_DEPLOYMENT.md`
