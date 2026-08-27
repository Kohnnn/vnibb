# BigQuery warehouse state

Concrete snapshot of `vnibb-data.vnibb` after the trade_date repair and EOD dedupe.
For the security/IAM and query-grammar rules, see `BQ_CONNECTED_SHEETS_QUERIES.md`;
that document is deliberately schema-agnostic and stays that way.

Verify anything here against `INFORMATION_SCHEMA` before relying on it.

## Shape

- 49 tables, 9,309,929 rows. 34 originated in Postgres, 14 in MongoDB, 1 orphan.
- Every table is native-typed. The 18 tables that were a single `data JSON` column were
  flattened in place into real snake_case columns, and the `flat_*` / `mongo_*` staging
  copies were dropped after row-count verification.
- No table is partitioned. The four `market_prices_*` tables are `CLUSTER BY symbol,
  trade_date`; several others cluster by `symbol`.

## Why nothing is partitioned

The project is a **BigQuery sandbox** (no billing account). Sandbox mandates a dataset
partition expiration under 60 days, and `ops/bq_sandbox_fix.py` set it to 59 days so the
initial load could succeed.

That expiration is enforced **at write time**. Rebuilding a partitioned table causes
BigQuery to drop every partition older than the window during the rebuild: a partitioned
rebuild of `market_prices_eod` produced 27,784 of 4,839,699 rows. Clustering has no
expiration semantics, so the price tables are clustered instead. Clustering still prunes
single-symbol and date-range scans well at this size (a 40-day single-symbol window
scans ~10 MB).

Re-partition by day once billing is enabled.

## Live expiration risk

Every table currently carries a hard expiry inherited from the dataset default:

- 45 tables: `TABLE-EXPIRES 2026-09-03/04`
- dataset defaults: `default_table_expiration_ms = default_partition_expiration_ms = 5097600000` (59 days)

**The entire dataset deletes itself around 2026-09-03.** Clearing this is impossible
while the project is a sandbox; the API rejects the change:

```
403 PATCH .../datasets/vnibb: Billing has not been enabled for this project.
The default table expiration time must be less than 60 days
```

Enabling billing is the only fix. Afterwards run `ops/bq_clear_expiration.py --apply`,
which clears both dataset defaults and every per-table timer.

Sandbox also forbids DML, so `INSERT`/`UPDATE`/`DELETE` are unavailable. Table rewrites
use CTAS into a staging table, verify, then `ALTER TABLE ... RENAME TO` (metadata-only,
preserves the cluster spec). The original is never dropped before staging verifies.

## market_prices_eod

4,832,940 rows, 1,727 symbols, 2000-07-28 .. 2026-07-06, one row per (symbol, trade_date).

Prices are in **VND**, not thousand-VND. Source is `vietcap` for 4,814,842 rows and
`vnstock-data` for 18,098; all carry `price_unit = 'VND'`.

Two bugs were fixed here:

1. **`trade_date` was 100% NULL** across all four `market_prices_*` tables (5.01M rows).
   Mongo stores `tradeDate` as a datetime (`2024-11-06T07:00:00`), and
   `SAFE_CAST('2024-11-06T07:00:00' AS DATE)` returns NULL in BigQuery, so forcing the
   column to `DATE` nulled it entirely and made `PARTITION BY trade_date` inert. Repaired
   from `source_key` (`vnstock-data:ACS:eod:2024-11-06`), which carries the ISO date in
   100% of rows and was verified against Mongo `tradeDate` on 15,401/15,401 sampled docs
   with zero disagreement. Fixed at source in `ops/bq_flatten_all.py`, which now casts
   dates via TIMESTAMP and fails loudly on any all-NULL column.

   Note the NULL was accidentally protecting the data: NULL rows sit in the `__NULL__`
   partition, which has no date to expire against.

2. **6,759 duplicate `(symbol, trade_date)` rows.** They were unscaled: `price_unit IS
   NULL` and prices in thousand-VND (median close 12.1 against 8,183.77 for VND). 6,715
   were exactly 1000x their vietcap twin; the other 44 differed by ~1100-1280x, the same
   scale error plus a provider price/adjustment discrepancy. All 6,759 had a vietcap
   twin, so removing them lost no dates or symbols.

   **The source is clean** — this was an export artifact, not an upstream bug. Checked
   live: 0 documents in Mongo are missing `priceUnit`, and a 1,500-document sample of
   `vnstock-data` rows found 0 with a Vietcap twin. `reconcile_eod_source`
   (`apps/api/scripts/vietcap/vietcap_writers.py:353`) is working; the export snapshot
   simply caught rows it had not yet reconciled.

   Note for anyone copying this collection out: the Mongo unique index is
   `(symbol, tradeDate, source)`, so two sources *may* legitimately hold the same
   symbol-day. One-row-per-symbol-day is enforced by `reconcile_eod_source` at write
   time, not by the index. Apply the same source/`priceUnit` precedence when exporting
   rather than assuming uniqueness.

## Scripts

| script | purpose |
| --- | --- |
| `ops/bq_audit_expiration.py` | read-only: dataset defaults, per-table expiry, partition/cluster spec, date coverage |
| `ops/bq_clear_expiration.py` | clears dataset defaults + per-table timers; dry-run default; blocked until billing is on |
| `ops/bq_repair_trade_date.py` | rebuilds the 4 price tables with trade_date parsed from source_key; dry-run default |
| `ops/bq_dedupe_eod.py` | drops unscaled duplicate EOD rows; aborts if any lacks a vietcap twin; dry-run default |
| `ops/bq_diag_trade_date.py`, `ops/bq_diag_date_recovery.py`, `ops/bq_diag_eod_dupes.py` | read-only diagnostics |
| `ops/mongo_verify_tradedate.py` | validates source_key against Mongo tradeDate; reads credentials from `.env` |
| `ops/bq_flatten_all.py` | flattens JSON tables; now TIMESTAMP-tolerant on dates, with an all-NULL column check |

All mutating scripts default to dry run and require `--apply`.
