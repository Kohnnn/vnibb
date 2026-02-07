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

## Partitioning guidance (Postgres)

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

For Supabase, apply partitioning via migrations in a maintenance window. Avoid
long-running transactions in production.
