# Next Work: Spec Sweep Findings

## Goal

Turn the 16 scattered plan/spec docs into one honest picture of what is actually
left, then fix the one item with real blast radius.

Scanned at `01799a6` (CI green). 16 spec docs, ~5,250 lines, checked against live
source by four read-only scouts plus direct verification of every high-impact claim.

## What the sweep actually found

The plan docs are **overwhelmingly done**. Across all 16, the recurring status is
"Repository complete; live/CI evidence pending." That phrase is accurate far more
often than not — I spot-checked Wave 3.1 (VN30 filter in
`screener/QuickFiltersBar.tsx`), Wave 3.2 (`min_listing_age_days` in
`api/v1/screener.py:533`), Wave 7.1 (`release_revision` in `core/config.py:51`),
and Wave 8 (`postgres-release-contract` job in `.github/workflows/ci.yml:53`).
All four are genuinely implemented. The docs are not lying.

So the remaining work is **not** a backlog of unimplemented features. It is:

1. one real safety defect,
2. live/ops gates that no commit can close,
3. a handful of stale docs and superseded scripts.

## Tasks

- [ ] **Task 1: Gate the destructive Mongo EOD dedup.** →
  Verify: `dedup_mongo_eod.py` with no `--apply` flag deletes nothing and prints
  what it would delete.

  `apps/api/scripts/dedup_mongo_eod.py` calls `delete_many` unconditionally
  (line 48). It has **no `--dry-run` and no `--apply`** — there is no way to run
  it without deleting. Three problems compound:
  - it ranks survivors by `updatedAt` → `createdAt` → `_id` only (lines 36-41),
    so it is blind to `source`. On a collection where Vietcap and vnstock rows
    share a key, it can delete a higher-quality source's row because a
    lower-quality one was touched later;
  - it takes no archive, so the delete is unrecoverable;
  - it never bumps `schemaVersion`.

  A safe, archive-backed, source-aware replacement **already exists**:
  `apps/api/scripts/vietcap/vietcap_writers.py:353`
  `reconcile_eod_source(db, symbol, *, dry_run: bool)`. The unsafe script was
  simply never retired in its favor — which is exactly what
  `V1_6_1_BACKEND_DATA_EXECUTION_PLAN.md` Phase 2 left as "pending".

  Fix: add the `--dry-run`/`--apply` gate and source precedence, or delete the
  script and point callers at `reconcile_eod_source`. Do not leave two tools that
  both claim to dedup the same collection.

- [ ] **Task 2: Make Mongo EOD uniqueness a service-layer invariant.** →
  Verify: the unique index exists on the live collection and a duplicate insert
  is rejected.

  A unique index on `(symbol, tradeDate, source)` is created in *backfill scripts*
  (`scripts/vietcap/backfill_vietcap.py:459`,
  `scripts/backfill_mongo_vnstock_full_catalog.py:509,522`) but **not** in
  `services/mongo_market_data_service.py`. So whether duplicates are even possible
  depends on which script happened to run — a data-integrity guarantee that lives
  in the wrong layer. Move it into the service's index setup, and make it
  idempotent.

- [ ] **Task 3: Decide ownership of the Screener Snapshot (#8).** →
  Verify: a live `limit=100` request cannot cause a later reader to see a
  100-symbol Universe.

  Issue #8 is the one genuinely open, well-specified defect in the tracker. A
  live screener miss upserts whatever the bounded provider fetch returned into
  the shared Screener Snapshot under today's date; cache reads for today apply no
  row-count floor, so every later reader — heatmap, breadth, comparison — gets a
  confident answer computed over ~6% of the market.

  The issue recommends "stop writing from the request path" and flags that it
  needs a maintainer decision first. **That decision is the blocker, not the code.**
  It is a small change once made.

- [ ] **Task 4: Turn on the Redis rate limiter.** → Verify: `/health` or a metric
  shows shadow decisions, then enforce.

  `core/config.py:158` defaults `rate_limit_mode = "off"`, and
  `/srv/vnibb/deployment/env.oracle` sets no override — so rate limiting is not
  even in `shadow`, despite the mode being implemented and the plan calling for
  "observe shadow for seven days." This is a pure ops decision with a one-line
  change; it sat unscheduled because it falls between code work and ops work.

- [ ] **Task 5: Close the live gates that no commit can close.** →
  Verify: each gate is either observed or explicitly waived in the map.

  From Wave 0 / `PRODUCT_INFRA_DATA_EXECUTION_PLAN.md`: n6v inventory, two Bronze
  exports, one exact-snapshot Restic backup plus isolated restore, one full
  market + post-close scheduler cycle observed with no duplicate jobs, and the
  canary rollout. None of these are repository deliverables.

- [ ] **Task 6: Retire the superseded docs and scripts.** →
  Verify: docs index no longer lists a dead plan as active.

  - `VN100_EOD_BACKFILL_PLAN.md` — its own 2026-06-11 header redirects to Vietcap,
    which already covers full-universe + deeper history. All three "Open Items"
    are moot. Delete or move to an archive folder.
  - `NEXT_PHASES_EXECUTION_PLAN.md` — stale (2026-04-17); its remaining gaps are
    independently tracked by `WIDGET_IMPROVEMENT_ROADMAP.md`, except Phase 3 (USD/FX),
    which nothing tracks. Decide: re-home Phase 3 or drop it.
  - `scripts/restore-drill.ps1` — Windows-only, never run against Postgres 17;
    already replaced by `scripts/oracle/verify-backup.sh`. Delete.
  - `ConnectBackendModal.tsx` — zero importers. Delete.
  - `AUTO_UPDATE_STRATEGY.md` — add the observability section it lacks now that
    `get_job_status` exposes per-job outcomes and `failing_jobs`.

## Done When

- [ ] No script can delete from `market_prices_eod` without an explicit `--apply`.
- [ ] Mongo EOD uniqueness is enforced by the service layer, not by whichever
      script ran last.
- [ ] #8 has a maintainer decision recorded, even if the change lands later.
- [ ] `rate_limit_mode` is at least `shadow` in production.
- [ ] The docs index lists no superseded plan as active.

## Notes

**One scout finding was falsified and is deliberately excluded.** A scout reported
that `@cached` stacked *below* `@router.get(response_model=...)` on 26 endpoints
silently drops `response_model`. I tested it two ways and it is **not true**:
`cached()` uses `functools.wraps`, which preserves the signature, and the real
route `equity.router` `/historical` retains
`response_model=StandardResponse[list[EquityHistoricalData]]` when imported. Both
decorator orderings kept the model. Had I taken the scout's word, this plan would
have opened 26 endpoints to a pointless reordering. **Verify before planning.**

**Two doc-drift items are cosmetic, not worth a task:** `TRADINGVIEW_WIDGET_CATALOG.md`
claims a `NASDAQ:VFS` default while the shipped default is `AMEX:SPY`
(`globalMarketsSymbol.ts`), and `GLOBAL_MARKETS_CRYPTO_TEMPLATE` passes
`symbolsPreset: 'crypto_majors'` with no runtime transform (unlike `tabsPreset`,
`symbolsGroupsPreset`, `panelPreset`). Fold both into whatever TradingView work
comes next rather than scheduling them.

**Out of scope, per the plans' own rules:** no Elasticsearch/Spark/Kafka, no
billing subsystem, no new data-quality platform, no cash-flow-aware portfolio
performance before a deterministic transaction ledger exists.
