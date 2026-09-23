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

### Cleanup endpoint

Run cleanup on demand:

```bash
curl -X POST "http://localhost:8000/api/v1/data/sync/cleanup?async_mode=true&include_prices=true"
```

If you need a blocking response:

```bash
curl -X POST "http://localhost:8000/api/v1/data/sync/cleanup?async_mode=false&include_prices=true"
```

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
