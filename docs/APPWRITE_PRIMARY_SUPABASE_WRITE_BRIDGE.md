# Database Stack: Primary Storage And Write Path

Date: 2026-06-24

## Purpose

VNIBB uses a single self-hosted database stack as the durable system of record for market data, runtime state, auth, and cache/resilience behavior.

This document exists because older project notes used mixed Appwrite/Supabase wording. The current operational contract is:

- market-data reads use the database-backed VNIBB corpus first;
- FastAPI is the normalization, fallback, and widget-serving layer;
- vnstock and exchange/provider feeds are freshness and gap-fill sources;
- browser-local state protects immediate dashboard UX;
- durable runtime writes are controlled and must not silently split across stores.

## Source-Of-Truth Matrix

| Surface | Current source of truth |
|---|---|
| Full market corpus | Self-hosted database stack |
| Backend API normalization | FastAPI service layer |
| Auth/session posture | Database-stack auth integration and backend guards |
| Durable app/runtime state | Self-hosted database stack, unless a documented bridge is explicitly enabled |
| Dashboard immediate UX | Browser-local first, backend sync when enabled |
| Cache and resilience | Cache tier plus database fallback |
| Freshness and gap fill | vnstock/provider ingestion |

## Appwrite Write Freeze

Appwrite writes remain frozen by default.

Operational default:

```env
APPWRITE_WRITE_ENABLED=false
```

Do not re-enable Appwrite writes during normal feature work. Re-enabling requires a controlled backfill or bridge runbook, operator approval, and post-run verification.

## Write-Bridge Rule

When a feature needs durable writes:

1. Keep the product behavior database-stack-first.
2. Use existing backend write guards instead of client-side direct writes.
3. Treat Appwrite as frozen unless the runbook explicitly says otherwise.
4. If a bridge/backfill is required, run it as an operator step, not as an incidental code change.

## Documentation Rule

Product, AI, MCP, and widget docs should say `VNIBB database` or `database-backed VNIBB corpus` rather than implying competing durable stores.

If a doc mentions Appwrite, it must also state whether the path is:

- historical,
- read-only,
- browser-local only,
- or behind `APPWRITE_WRITE_ENABLED=false` until a controlled backfill.

## Related Docs

- `DEPLOYMENT_AND_OPERATIONS.md`
- `DATABASE_SCHEMA.md`
- `N6V_DATABASE_CONSOLIDATION_RUNBOOK.md`
- `VNIBB_MCP_DEPLOYMENT.md`
- `QUANT_REMAINING_ROADMAP_HANDOFF.md`
