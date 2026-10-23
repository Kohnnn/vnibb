# Data Retention and Partitioning

This document explains how VNIBB controls database growth and how to plan table
partitioning for large time-series tables.

## Retention cleanup

Automatic maintenance preserves all stored price history. The nightly retention
sweep excludes prices, and full seed runs do not prune prices after syncing.
Non-price cleanup continues to use its configured retention windows. Price rows
are deleted only by a manually requested cleanup that includes prices.

### Config

Set these environment variables as needed:

- `PRICE_HISTORY_YEARS` (default 5; seeding window and manual price-cleanup age,
  not an automatic storage limit)
- `NEWS_RETENTION_DAYS` (default 7)
- `SCREENER_RETENTION_DAYS` (default 365)
- `ORDER_FLOW_RETENTION_YEARS` (default 3)
- `FOREIGN_TRADING_RETENTION_YEARS` (default 3)
- `INTRADAY_RETENTION_DAYS` (default 7)
- `ORDERBOOK_RETENTION_DAYS` (default 30)
- `BLOCK_TRADES_RETENTION_DAYS` (default 365)

`PRICE_HISTORY_YEARS=0` does not disable explicitly requested price cleanup.
Automatic maintenance preserves prices regardless of this setting.

### Prediction-market storage limits

Prediction collection has separate fixed safety limits in
`vnibb/services/prediction_market_policy.py`; the generic retention settings
above do not disable them.

- Kalshi fetches use `mve_filter=exclude` and reject multivariate/combo tickers
  and metadata defensively. Legacy combo catalogue rows are preserved but do
  not enter snapshots or consume normal-market admission slots.
- The shared ingest writer accepts only canonical source IDs from
  `SNAPSHOT_SOURCES`: `polymarket`, `kalshi`, `predictit`, `limitless`, `manifold`.
  Unknown, mixed-case or whitespace-padded IDs reject the entire batch before
  any catalogue mutation; they are not normalized into a supported source.
- Each provider batch is limited to 1,000 records, with bounded response and
  stored field sizes. At most 10,000 fresh, real, open, unexpired non-combo
  markets per source count against the admission quota; older catalogue rows
  remain as history and are handled separately by bounded retention. The
  independent physical storage ceiling still limits the entire catalogue.
- PostgreSQL catalogue ingestion and terminal restore serialize under the same
  advisory transaction lock (`943416618`). A 4 GiB relation ceiling, including
  indexes/TOAST, reserves 256 KiB per pending row mutation before either insert
  or update. Insufficient headroom fails closed rather than continuing updates
  or restoring a partial batch. This is a conservative application guard, not
  a filesystem quota; archives, WAL, backups and unrelated data are outside it.
- Only real, active, nonclosed, nonexpired markets refreshed within 24 hours
  are snapshot candidates. Missing provider refreshes do not imply settlement
  and never manufacture a closed-market status.
- Both daily and 15-minute snapshots admit at most 5,000 markets per bucket,
  at most 1,000 per source. SQL limits apply before materialization. Repeated
  runs, including a changed eligible universe, share the same bucket quota;
  unique keys and writer serialization prevent duplicate captures.
- Snapshot storage has a combined 1 GiB relation-size guard with conservative
  row-growth reserves. When it refuses writes, retention still runs separately:
  seven days intraday and 30 days daily, in bounded resumable transactions.
- `prediction_market_catalogue_retention` runs hourly at :40 UTC, independently
  of ingestion. Each sweep commits at most 12 batches of 5,000 rows (60,000/hour)
  under the existing 30-minute timeout. It deletes only real rows unrefreshed
  for seven days that are neither inactive-and-closed nor archive-owned.
  Synthetic provenance, terminal contracts and copied snapshot history stay.
  A bounded existence probe reports remaining eligible debris as scheduler
  `partial`, not `ok`; failures and timeouts retain their own outcomes.
- Automatic fixture fallback and random historical backfill are removed. A
  provider failure remains observable; other providers still get an independent
  attempt. Empty history stays empty until genuine measurements arrive.

The nominal full-window coverage is 3,360,000 intraday rows over seven days plus
150,000 daily rows over 30 days, before storage-guard refusals. This is not an
instantaneous row bound: boundary buckets and cleanup lag can add rows.
Deletion generally makes PostgreSQL pages reusable; it does not promise an
immediate drop in filesystem usage. Do not disable guards to overcome a full
relation: investigate payloads, retention outcomes and allocated space first.

Kalshi's filter contract is documented at
[Get Markets](https://docs.kalshi.com/api-reference/market/get-markets).

### Cleanup endpoint

Run cleanup on demand. The manual endpoint retains its `include_prices=true`
default, which deletes price rows older than `PRICE_HISTORY_YEARS`; pass
`include_prices=false` to preserve prices while cleaning non-price data:

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
  combo records defensively. Each source admits at most 10,000 fresh, real,
  active, nonclosed, unexpired non-combo markets; older catalogue rows remain
  stored but do not consume fresh admission slots.
- PostgreSQL catalogue ingestion and terminal restore share the advisory
  transaction lock and 4 GiB relation ceiling, including a 256 KiB reserve per
  pending row mutation. Insufficient headroom fails closed. Legacy combo rows
  remain stored but do not consume non-combo admission slots. These limits do
  not delete the catalogue.
- Snapshots select only real, active, nonclosed, unexpired markets refreshed
  within 24 hours. Missing a feed refresh does not falsely mark a market settled.
  Each 15-minute/day bucket holds at most 5,000 rows total and 1,000 per source.
  Unique bucket keys and writer serialization prevent retries or concurrent
  runs from multiplying rows, including when the selected universe changes.
- The combined daily/intraday snapshot relations have a 1 GiB admission ceiling,
  including conservative reserved space for each pending insert batch. A
  capacity failure stops writes rather than disabling retention or returning
  fabricated history. This is an application admission guard, not a filesystem quota.
- Separate scheduled sweeps prune intraday history after seven days and daily
  history after 30 days in bounded transactions, even when ingestion fails.
  Random synthetic historical backfill and production fixture fallbacks are
  removed; empty history remains empty until real observations accumulate.

Relation-size guards include indexes and allocated space. Deletes make space
reusable by PostgreSQL but do not guarantee filesystem shrinkage. A guard that
remains tripped after cleanup needs operator investigation, not a raised limit
or a blind `VACUUM FULL`. The latter rewrites data and needs extra disk space.
Archives, WAL, backups and unrelated database/host files are outside both guards.
Direct SQL can bypass application admission. Protected catalogue rows do not
expire automatically; admission still fails closed when their allocation fills
the catalogue ceiling. Do not enable terminal archival as a storage workaround.


### Prediction-market terminal archive (operator-only)

General daily cleanup does **not** prune `prediction_markets`; the separate hourly catalogue job above removes only stale nonterminal debris. `python -m vnibb.services.prediction_market_retention --limit 100` reports an operator-only terminal dry-run batch. Eligibility is deliberately narrow: inactive and closed, end date older than 365 days, provider-certified resolved outcome present in the market's outcomes, and no nightly or intraday snapshot references. It skips markets already archived. Batch size is capped at 100; no scheduled terminal archival or mass deletion is enabled.

Before applying, measure eligible rows by age/source/status on the serving PostgreSQL database and prove a recent database-matched backup with an actual isolated restore. An operator supplies a private JSON receipt with `backup_path`, its `sha256`, database name, and UTC `verified_at` from the last 24 hours, then chooses a unique protected archive file path. Only after these checks, run `python -m vnibb.services.prediction_market_retention --apply --limit 100 --backup-receipt /secure/verified-backup.json --archive-file /secure/batch.json --confirm-isolated-restore`. It writes and verifies each complete row in the archive table plus an exclusive local artifact before deleting only locked eligible rows; never discard either artifact. Restore a verified batch with `python -m vnibb.services.prediction_market_retention --restore /secure/batch.json`; an already re-ingested ID fails rather than being overwritten. The receipt is an operator assertion, not independent proof of the isolated restore. No production batch has been applied or sized in this release work.

Restore remains PostgreSQL-only and accepts a verified manifest containing
1–100 rows. Before any catalogue insert or archive removal, it acquires the
same catalogue writer lock as ingestion and reserves capacity for the entire
manifest. Restored terminal rows do not need fresh/live source-admission slots:
their original IDs, fields and terminal history are preserved. A conflict or
capacity refusal leaves both catalogue and database archive unchanged; success
removes only the matching archive batch. This guard changes no retention
windows, enables no extra deletion and adds no archive-size quota. The existing
1 GiB combined-snapshot budget and history windows are unchanged.

Deployment evidence for [#146](https://github.com/Kohnnn/vnibb/issues/146) /
[PR #147](https://github.com/Kohnnn/vnibb/pull/147): API, MCP and scheduler
switched at `2026-10-23T16:52:56Z` to source
`a5c3a0b443f6728a5789d7d69bc41b6c9f560569`, ARM64 image
`sha256:dd3ac9b7652ee4bc47ce3ce513843fbcd1109d92a632d6318a0732725656dbd4`.
The published image matched 511 committed API files and 111 pinned dependency
versions. The full backend run passed 3,519 tests (21 skipped); six real
PostgreSQL restore contracts and the published-image restore CLI passed.
Public HTTPS health and retained-market reads returned 200; retained history
returned 15 observations. Auth, PostgreSQL, MongoDB, Redis and Caddy containers
were unchanged. No data migration or manual history deletion ran. Rollback
source `cfc5efc82d8162f0cef777b95d754f08aa090278` remains protected by image
retention. Mypy retains ten identical baseline errors. Prediction ingestion
already reported `RuntimeError` before cutover; this rollout does not claim
provider-ingestion recovery.

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
