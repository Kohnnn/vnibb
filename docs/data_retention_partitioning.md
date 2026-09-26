# Data Retention and Partitioning

This document explains how VNIBB controls database growth and how to plan table
partitioning for large time-series tables.

## Retention cleanup

Retention cleanup removes old rows based on configuration settings. Cleanup is
triggered automatically after daily trading syncs and full seed runs, and can be
run on demand.

### Config

Set these environment variables as needed:

- `PRICE_HISTORY_YEARS` (default 5)
- `NEWS_RETENTION_DAYS` (default 7)
- `SCREENER_RETENTION_DAYS` (default 365)
- `ORDER_FLOW_RETENTION_YEARS` (default 3)
- `FOREIGN_TRADING_RETENTION_YEARS` (default 3)
- `INTRADAY_RETENTION_DAYS` (default 7)
- `ORDERBOOK_RETENTION_DAYS` (default 30)
- `BLOCK_TRADES_RETENTION_DAYS` (default 365)

Set any value to `0` to disable that cleanup.

### Prediction-market storage limits

Prediction collection has separate fixed safety limits in
`vnibb/services/prediction_market_policy.py`; the generic retention settings
above do not disable them.

- Kalshi fetches use `mve_filter=exclude` and reject multivariate/combo tickers
  and metadata defensively. Legacy combo catalogue rows are preserved but do
  not enter snapshots or consume normal-market admission slots.
- Each provider batch is limited to 1,000 records, with bounded response and
  stored field sizes. Admission stops at 10,000 non-combo catalogue records per
  source; existing records can still refresh while physical headroom permits.
- PostgreSQL catalogue mutations serialize under an advisory transaction lock.
  A 16 GiB relation ceiling, including indexes/TOAST, reserves 256 KiB per
  distinct mutation before either insert or update. Insufficient headroom fails
  closed rather than continuing updates. This is a conservative application
  guard, not a filesystem quota against unrelated SQL writers.
- Only real, active, nonclosed, nonexpired markets refreshed within 24 hours
  are snapshot candidates. Missing provider refreshes do not imply settlement
  and never manufacture a closed-market status.
- Both daily and 15-minute snapshots admit at most 5,000 markets per bucket,
  at most 1,000 per source. SQL limits apply before materialization. Repeated
  runs, including a changed eligible universe, share the same bucket quota;
  unique keys and writer serialization prevent duplicate captures.
- Snapshot storage has a combined 4 GiB relation-size guard with conservative
  row-growth reserves. When it refuses writes, retention still runs separately:
  seven days intraday and 30 days daily, in bounded resumable transactions.
- Automatic fixture fallback and random historical backfill are removed. A
  provider failure remains observable; other providers still get an independent
  attempt. Empty history stays empty until genuine measurements arrive.

At maximum coverage, seven intraday days contain at most 3,360,000 rows, plus
150,000 daily rows over 30 days, before considering storage-guard refusals.
Deletion generally makes PostgreSQL pages reusable; it does not promise an
immediate drop in filesystem usage. Do not disable guards to overcome a full
relation: investigate payloads, retention outcomes and allocated space first.

Kalshi's filter contract is documented at
[Get Markets](https://docs.kalshi.com/api-reference/market/get-markets).

### Cleanup endpoint

Run cleanup on demand:

```bash
curl -X POST "http://localhost:8000/api/v1/data/sync/cleanup?async_mode=true&include_prices=true"
```

If you need a blocking response:

```bash
curl -X POST "http://localhost:8000/api/v1/data/sync/cleanup?async_mode=false&include_prices=true"
```

### Prediction-market storage bounds

Prediction writes use independent safety limits rather than relying on a
successful ingest to reach cleanup:

- Live ingestion accepts at most 1,000 records per call, with bounded response
  and field sizes. Kalshi requests `mve_filter=exclude` and rejects multivariate
  combo records defensively. Each source admits at most 10,000 non-combo
  catalogue rows; existing IDs can still refresh at that row cap.
- PostgreSQL catalogue mutations serialize with an advisory transaction lock.
  At the 16 GiB relation ceiling, including a conservative per-mutation reserve,
  all mutations fail closed. Legacy combo rows remain stored but do not consume
  non-combo admission slots. These limits do not delete the catalogue.
- Snapshots select only real, active, nonclosed, unexpired markets refreshed
  within 24 hours. Missing a feed refresh does not falsely mark a market settled.
  Each 15-minute/day bucket holds at most 5,000 rows total and 1,000 per source.
  Unique bucket keys and writer serialization prevent retries or concurrent
  runs from multiplying rows, including when the selected universe changes.
- The combined daily/intraday snapshot relations have a 4 GiB admission ceiling,
  including conservative reserved space for each pending insert batch. A
  capacity failure stops writes rather than disabling retention or returning
  fabricated history. This bounds these tables, not unrelated host workloads.
- Separate scheduled sweeps prune intraday history after seven days and daily
  history after 30 days in bounded transactions, even when ingestion fails.
  Random synthetic historical backfill and production fixture fallbacks are
  removed; empty history remains empty until real observations accumulate.

Relation-size guards include indexes and allocated space. Deletes make space
reusable by PostgreSQL but do not guarantee filesystem shrinkage. A guard that
remains tripped after cleanup needs operator investigation, not a raised limit
or a blind `VACUUM FULL`. The latter rewrites data and needs extra disk space.


### Prediction-market terminal archive (operator-only)

The daily cleanup above does **not** prune `prediction_markets`. `python -m vnibb.services.prediction_market_retention --limit 100` reports a dry-run batch. Eligibility is deliberately narrow: inactive and closed, end date older than 365 days, provider-certified resolved outcome present in the market's outcomes, and no nightly or intraday snapshot references. It skips markets already archived. Batch size is capped at 100; no scheduled mass deletion is enabled.

Before applying, measure eligible rows by age/source/status on the serving PostgreSQL database and prove a recent database-matched backup with an actual isolated restore. An operator supplies a private JSON receipt with `backup_path`, its `sha256`, database name, and UTC `verified_at` from the last 24 hours, then chooses a unique protected archive file path. Only after these checks, run `python -m vnibb.services.prediction_market_retention --apply --limit 100 --backup-receipt /secure/verified-backup.json --archive-file /secure/batch.json --confirm-isolated-restore`. It writes and verifies each complete row in the archive table plus an exclusive local artifact before deleting only locked eligible rows; never discard either artifact. Restore a verified batch with `python -m vnibb.services.prediction_market_retention --restore /secure/batch.json`; an already re-ingested ID fails rather than being overwritten. The receipt is an operator assertion, not independent proof of the isolated restore. No production batch has been applied or sized in this release work.

## Partitioning guidance (durable storage)

Partitioning is recommended for the largest time-series tables. This reduces
index bloat and improves retention deletes.

### Good candidates

- `intraday_trades` (by `trade_time`)
- `orderbook_snapshots` (by `snapshot_time`)
- `stock_prices` (by `time`)
- `order_flow_daily` (by `trade_date`)
- `foreign_trading` (by `trade_date`)
- `screener_snapshots` (by `snapshot_date`)
- `company_news` (by `published_date` or `created_at`)

### Strategy

- Use range partitions by month.
- Keep indexes on each partition that match your most common queries.
- Create future partitions ahead of time (e.g., 6-12 months).
- Drop old partitions instead of deleting rows for faster cleanup.

### Example (conceptual)

```sql
-- 1) Create a partitioned parent table
CREATE TABLE intraday_trades_new (
  LIKE intraday_trades INCLUDING ALL
) PARTITION BY RANGE (trade_time);

-- 2) Create partitions (monthly)
CREATE TABLE intraday_trades_2026_01 PARTITION OF intraday_trades_new
FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');

-- 3) Copy data into the new table, then swap
INSERT INTO intraday_trades_new SELECT * FROM intraday_trades;
ALTER TABLE intraday_trades RENAME TO intraday_trades_old;
ALTER TABLE intraday_trades_new RENAME TO intraday_trades;

-- 4) Recreate indexes per partition if needed
```

### Operational notes

- Run partition migrations during low-traffic windows.
- For large tables, copy data in batches to avoid long locks.
- After moving data, run `ANALYZE` to refresh planner stats.

For the durable storage tier, apply partitioning via migrations in a maintenance window. Avoid
long-running transactions in production.
