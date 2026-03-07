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

### Follow-Up Production Execution (2026-03-06)

- Phase 2 intraday retention: executed in production.
  - Deleted `241,032` `intraday_trades` rows older than 3 days.
  - `intraday_trades` shrank from `~91 MB` to `~45 MB` after `VACUUM FULL ANALYZE`.
  - Database size dropped from `557,722,771` bytes (`532 MB`) to `510,299,283` bytes (`487 MB`).
- Financial period cleanup: executed in production.
  - Removed legacy broken rows where `period` was stored as one or two digits instead of a real year/quarter key:
    - `income_statements`: `13,842`
    - `balance_sheets`: `51,624`
    - `cash_flows`: `26,774`
    - `financial_ratios`: `22,374`
  - Post-cleanup table sizes:
    - `balance_sheets`: `~24 MB`
    - `cash_flows`: `~21 MB`
    - `income_statements`: `~20 MB`
    - `financial_ratios`: `~11 MB`
  - Database size dropped again to `420,834,451` bytes (`401 MB`).
- RLS performance cleanup: executed in production.
  - Rewrote `user_dashboards` and `dashboard_widgets` policies to use `(select auth.uid())`.
  - Supabase performance advisor no longer reports `auth_rls_initplan` warnings for those tables.
  - Remaining performance advisor findings are now `INFO`-level `unused_index` suggestions only.

## Current State

- Supabase organization plan: `free`
- Supabase documented free-plan DB limit: `500 MB per project`
- Current production DB size after cleanup: `401 MB`
- Current WAL size during audit: `160 MB`
- Current cache hit rates:
  - table hit rate: `98.84%`
  - index hit rate: `99.65%`

The database is no longer above the free-plan limit. Immediate capacity pressure is resolved.

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
  - `intraday_trades` rows older than 3 days: executed on 2026-03-06
  - `stock_prices` rows older than 3 years: `~25%` of table (`~67 MB` estimated reclaim)
- Legacy `period > 4` cleanup SQL from older sprint notes is unsafe against the current schema because annual rows now use 4-digit years like `2024` and `2025`.
- The safe filter for legacy broken financial periods is `period ~ '^[0-9]{1,2}$'`.

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
- Phase 2 SQL: `docs/sql/supabase_storage_phase2_intraday_retention.sql`
- Financial period cleanup SQL: `docs/sql/financial_period_cleanup_20260306.sql`

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
