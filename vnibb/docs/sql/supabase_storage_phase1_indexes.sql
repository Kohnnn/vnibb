-- V161 Phase 1: Safe index cleanup (duplicate + clearly unused large indexes)
-- Project: cbatjktmwtbhelgtweoi
-- Execute in Supabase SQL Editor.
-- Notes:
-- 1) Do not wrap DROP INDEX CONCURRENTLY in BEGIN/COMMIT.
-- 2) If your execution path wraps statements in a transaction, use non-CONCURRENTLY DROP INDEX.
-- 3) Re-run validation queries after execution.

-- Preview target indexes and sizes before dropping.
SELECT
  schemaname,
  relname AS table_name,
  indexrelname AS index_name,
  pg_size_pretty(pg_relation_size(indexrelid)) AS index_size,
  idx_scan
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
  AND indexrelname IN (
    'ix_block_time',
    'ix_intraday_time',
    'ix_market_news_published',
    'ix_officer_symbol',
    'ix_sector_perf_date',
    'ix_stock_price_date_only',
    'ix_subsidiaries_symbol',
    'ix_stock_price_perf'
  )
ORDER BY pg_relation_size(indexrelid) DESC;

-- Duplicate index cleanup (keep the sibling index named by SQLAlchemy auto conventions).
DROP INDEX CONCURRENTLY IF EXISTS public.ix_block_time;
DROP INDEX CONCURRENTLY IF EXISTS public.ix_intraday_time;
DROP INDEX CONCURRENTLY IF EXISTS public.ix_market_news_published;
DROP INDEX CONCURRENTLY IF EXISTS public.ix_officer_symbol;
DROP INDEX CONCURRENTLY IF EXISTS public.ix_sector_perf_date;
DROP INDEX CONCURRENTLY IF EXISTS public.ix_stock_price_date_only;
DROP INDEX CONCURRENTLY IF EXISTS public.ix_subsidiaries_symbol;

-- Large unused index candidate.
DROP INDEX CONCURRENTLY IF EXISTS public.ix_stock_price_perf;

-- Fallback variant when CONCURRENTLY is not allowed by your SQL execution wrapper:
-- DROP INDEX IF EXISTS public.ix_block_time;
-- DROP INDEX IF EXISTS public.ix_intraday_time;
-- DROP INDEX IF EXISTS public.ix_market_news_published;
-- DROP INDEX IF EXISTS public.ix_officer_symbol;
-- DROP INDEX IF EXISTS public.ix_sector_perf_date;
-- DROP INDEX IF EXISTS public.ix_stock_price_date_only;
-- DROP INDEX IF EXISTS public.ix_subsidiaries_symbol;
-- DROP INDEX IF EXISTS public.ix_stock_price_perf;

-- Validation after drops.
SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size_after_phase1;

SELECT
  schemaname,
  relname AS table_name,
  indexrelname AS index_name,
  idx_scan
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
  AND indexrelname IN (
    'ix_block_time',
    'ix_intraday_time',
    'ix_market_news_published',
    'ix_officer_symbol',
    'ix_sector_perf_date',
    'ix_stock_price_date_only',
    'ix_subsidiaries_symbol',
    'ix_stock_price_perf'
  );
