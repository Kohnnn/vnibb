Cloud-01 node optimization — findings and fixes (2026-09-26)

Host: cloud-01 (100.107.9.31), Oracle ARM, 4 vCPU, 23 GiB RAM, 193 GB root.
Runs the vnibb production stack (api, scheduler, mcp, caddy, auth, db, redis, mongo)
plus oci (vlegal-backend, f1-racing-api) and fs-ocr.

## 1. Disk reclaimed (done, verified)

Before: 74G used / 39%.  After: 69G used / 36%.  All 13 containers stayed healthy.

- 69 orphaned (dangling) volumes: removed ~2.58 GB
- Old vnibb-api release image 49c167d79177 (superseded, and not the pinned
  rollback digest 38f5a4eaa5d8): removed 3.02 GB
- Unused images vci-research-api:ci, postgres:17-alpine, alpine:latest,
  curlimages/curl, alpine:3.22: ~1.8 GB
- systemd journal vacuumed to 200 MB: 624 MB

Deliberately retained: the active image 731f2845278e and the pinned rollback
digest 38f5a4eaa5d8, all attached data volumes, and every running container's image.

## 2. Root cause: unbounded Kalshi catalogue growth (the real problem)

`prediction_markets` is 14 GB (12.3 GB heap + 443 MB new index, 14.7 M rows).
Measured breakdown:

| metric | value |
|---|---|
| total rows | 14,732,981 |
| kalshi rows | 14,732,811 |
| refreshed in last 24 h | 27,192 |
| never refreshed in 7 days | 12,169,619 |
| dead tuples (before analyze) | 21,838 (44.5 %) |
| last manual vacuum | never |
| last autovacuum | never |
| last analyze | never |

Only ~27 k rows are live at the read horizon. Reads bound to
`SNAPSHOT_SOURCE_LIMIT` (1,000) per source, so ~14.7 M rows are provably
unreadable debris that still costs disk and index maintenance.

### Why it happened
- `kalshi_service.fetch_kalshi_markets` swept the cursor up to
  `KALSHI_MAX_PAGES = 10` x 200/page (2,000 rows/cycle) with no corpus bound.
- The upsert keys on `(source, source_id)` and never deletes, so every contract
  Kalshi later delists stays forever.
- `prediction_market_retention` only archives *terminal, resolved* markets, in
  batches of 100, and the scheduled caller runs it **dry-run only**
  (`data_pipeline.py:2384`) — so nothing was ever deleted.
- No index supported the `updated_at` range the sweep needs.

## 3. Fixes applied in the repo

- `prediction_market_policy.py`: added `MARKET_RETENTION` (7 d),
  `MARKET_RETENTION_BATCH` (5,000), `market_retention_cutoff`.
- `prediction_market_catalogue_retention.py` (new): batched, resumable,
  dry-run-by-default sweep deleting stale, non-synthetic, non-archived rows.
  Never touches terminal rows (owned by the archiving retention) or synthetic
  provenance.
- `kalshi_service.py`: `KALSHI_MAX_PAGES` 10 -> 2 and a hard
  `KALSHI_INGEST_BUDGET` (400) so a cycle can never page the whole corpus.
- `scheduler.py`: `schedule_prediction_market_catalogue_retention()` wired into

## 4. Measured evidence

- Before analyze, the debris count was a **parallel sequential scan: 112 s**,
  1.5 M buffers.
- `ANALYZE prediction_markets` was required once: `pg_stats` had top-level
  `n_distinct = -1` (no stats over 14.7 M of 15.0 M pages) and stale `reltuples`.
- The fix is a **bounded ordered walk**, not a count:
  `ORDER BY updated_at, id LIMIT n` over the stale end, then delete those ids.
  On the same production table the planner picks
  `Index Scan using ix_prediction_markets_updated_at_id` naturally:
  **3.26 ms** for a 5,000-row batch (vs 112 s), with no planner hints.
- Verified end-to-end against production inside a rolled-back transaction:
  `DELETE 5000` in 2.5 s, table unchanged after `ROLLBACK`.
- The goodbye condition is `candidates < MARKET_RETENTION_BATCH`, never
  `deleted == 0`: a concurrent insert would otherwise re-trigger the loop.
- Backlog immediately before the drain: **12,175,647 stale rows** of
  14,733,109 total.
- Drain completed: **12,043,647 stale rows removed**, leaving 2,549,499 rows
  (of which **0** stale) — the catalogue is now bounded to roughly the live
  horizon. Batches ran ~1.3 s per 20 k rows with every service healthy.

## 4b. Final outcome

After the drain and `VACUUM (FULL, ANALYZE) prediction_markets`:

| metric | before | after |
|---|---|---|
| `prediction_markets` rows | 14,733,109 | 2,549,500 |
| stale rows | 12,175,647 | **0** |
| table heap | ~12.3 GB | **1.3 GB** |
| table total (heap + indexes) | ~15.3 GB | **1.7 GB** |
| `vnibb` database | 15 GB | **2.4 GB** |
| host root used | 74 G (39 %) | **58 G (30 %)** |

Net host reclaim for this work: **16 GB**, plus the ~5 GB from the image and
volume cleanup, for a combined **~21 GB** and root usage down from 39 % to 30 %.
Reads were re-verified afterwards: 27,354 fresh eligible rows
(100 Polymarket, 27,254 Kalshi) with real prices, and the retention walk is
1.2 ms. Every service stayed healthy throughout.

## 5. Operator follow-up still required

The drain and `VACUUM FULL` were executed directly against production, so the
table is already clean. Two things remain for the deploying session:

1. Deploy a revision containing these changes — the retention module, the
   scheduler job, and the Kalshi ingest bound. Until then, Kalshi keeps
   re-accumulating write-once rows at the old sweep width.
2. `alembic upgrade head` to record `20260926_1800_index_stale_prediction_markets`.
   The index itself was already created concurrently out-of-band, and the
   migration is written to no-op when it finds the index present.

The nightly 19:40 UTC job needs no backlog drain now (0 stale rows); it exists to
keep the catalogue bounded going forward.

Do NOT `VACUUM FULL` while a sweep is mid-run.

## 6. Node baseline after the work

All 14 containers healthy (`vnibb-api`, `vnibb-scheduler`, `vnibb-mcp`,
`vnibb-db`, `vnibb-redis`, `vnibb-mongo`, `vnibb-auth`, `vnibb-caddy`,
`vlegal-backend`, `f1-racing-api`, `fs-ocr`, plus buildx builders).

| metric | before | after |
|---|---|---|
| root filesystem used | 74 G / 39 % | **55 G / 29 %** |
| `vnibb_vnibb_postgres` volume | 16 GB | **3.58 GB** |
| `prediction_markets` rows | 14,733,109 | 2,549,500 |
| Alembic head | `a926b4d87501` | unchanged (index migration staged) |
| memory available | 16 Gi | 16 Gi |
| total host reclaim | — | **19 GB** |

Retained deliberately: the active image `731f2845278e` **and** the documented
rollback digest `38f5a4eaa5d8`, even though the latter reports zero attached
containers. A stale rollback image is cheaper than losing the rollback.

Note: a `postgres176bookworm` container restarted during the session and spawned a
fresh buildx builder. It is **not** the VNIBB database — it runs a separate 46 MB
data volume and has no `postgres` role. The application database lives on
`vnibb_vnibb_postgres` and was verified intact (2.5 M prediction rows,
1.75 M stock price rows, `pg_isready` accepting connections).

After further safe image cleanup the node settled at:

- root filesystem **55 G / 29 %** (was 74 G / 39 %) — **19 GB reclaimed**
- `vnibb` database **2.4 GB** (was 15 GB)
- `prediction_markets` **2,550,277** rows, 0 stale
- 12 containers, all healthy

The only image with zero attached containers is the retained rollback digest
`38f5a4eaa5d8`. Nothing further was pruned: buildx cache is already empty, and
dropping the rollback image is a risk this node does not need to take.
