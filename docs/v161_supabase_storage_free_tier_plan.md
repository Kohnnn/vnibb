# V161 Supabase Free-Tier Storage Audit and Optimization Plan

Date: 2026-03-06
Project: `cbatjktmwtbhelgtweoi` (`vnibb-production`)

## Execution Status

- Phase 1 index cleanup: executed on 2026-03-06.
- Database size before: `607,947,923` bytes (`580 MB`).
- Database size after: `543,083,667` bytes (`518 MB`).
- Immediate reclaim: `64,864,256` bytes (`~61.9 MB`, about `10.7%`).
- Preserved all table data (index-only cleanup).
- Supabase performance advisors no longer report duplicate-index warnings for the removed index pairs.
- Post-cleanup live-row estimates remain intact for core tables (for example, `stock_prices ~802k`, `intraday_trades ~417k`).

### Dropped Indexes (Executed)

- `public.ix_block_time`
- `public.ix_intraday_time`
- `public.ix_market_news_published`
- `public.ix_officer_symbol`
- `public.ix_sector_perf_date`
- `public.ix_stock_price_date_only`
- `public.ix_subsidiaries_symbol`
- `public.ix_stock_price_perf`

## Objective

- Measure current database footprint.
- Identify safe storage optimization steps that do not delete critical long-term market history.
- Define an execution order with rollback-ready SQL.

## Current Footprint Snapshot

- Database size: `607,808,659` bytes (`~580 MB`).
- `public` schema size: `~567 MB`.
- Largest tables by total size:
  - `stock_prices`: `~266 MB`
  - `intraday_trades`: `~94 MB`
  - `balance_sheets`: `~63 MB`
  - `cash_flows`: `~42 MB`
  - `income_statements`: `~30 MB`
  - `financial_ratios`: `~22 MB`
  - `screener_snapshots`: `~22 MB`

## Key Findings

- Index bloat/opportunity is meaningful in hot tables, especially `stock_prices` and `intraday_trades`.
- `pg_stat_database.stats_reset` is `2025-12-08`, so index usage stats are mature enough for first-pass cleanup.
- Large non-unique indexes with `idx_scan = 0` include:
  - `ix_stock_price_perf` (`~43 MB`)
  - `ix_intraday_time` (`~11 MB`)
  - `ix_stock_price_date_only` (`~7 MB`)
- Supabase performance advisors flag multiple duplicate indexes and many unused indexes.
- Retention estimate windows (not yet executed):
  - `intraday_trades` rows older than 3 days: `~38%` of table (`~36 MB` estimated reclaim)
  - `stock_prices` rows older than 3 years: `~25%` of table (`~67 MB` estimated reclaim)

## Safety Constraints

- Preserve long-horizon end-of-day history in `stock_prices` unless explicitly approved.
- Favor index cleanup first (low risk, reversible by recreating indexes).
- Do not run destructive retention deletes without a final approved retention window and export plan.

## Recommended Execution Order

1. Phase 1 (low risk): drop duplicate indexes and clearly unused large indexes. (Done)
2. Re-measure DB size and advisor output. (Done)
3. Phase 2 (optional, medium risk): enforce short retention on `intraday_trades` only.
4. Phase 3 (optional, high business impact): archive and prune oldest `stock_prices` history only if user approves exact window.

## SQL Artifacts

- Phase 1 SQL: `docs/sql/supabase_storage_phase1_indexes.sql`
- Phase 1 rollback SQL: `docs/sql/supabase_storage_phase1_rollback_indexes.sql`
- Phase 2 SQL draft: `docs/sql/supabase_storage_phase2_intraday_retention.sql`

Run SQL in Supabase SQL Editor:
`https://supabase.com/dashboard/project/cbatjktmwtbhelgtweoi/editor`

## Validation Queries

```sql
-- Current DB size
SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size;

-- Top 15 table+index consumers
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
  pg_size_pretty(pg_relation_size(c.oid)) AS table_size,
  pg_size_pretty(pg_total_relation_size(c.oid) - pg_relation_size(c.oid)) AS index_toast_size
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r' AND n.nspname = 'public'
ORDER BY pg_total_relation_size(c.oid) DESC
LIMIT 15;
```
