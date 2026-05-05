-- V161 Phase 2: Intraday retention
-- Project: cbatjktmwtbhelgtweoi
-- This script keeps only the most recent 3 days in intraday_trades.
-- 2026-03-06 production execution note:
--   - deleted 241,032 rows older than 3 days
--   - table shrank from ~91 MB to ~45 MB after VACUUM FULL ANALYZE
--   - project DB size dropped from ~532 MB to ~487 MB

-- Preview rows that would be removed.
SELECT COUNT(*) AS rows_to_delete
FROM public.intraday_trades
WHERE trade_time < now() - interval '3 days';

-- Optional export reminder:
-- Before delete, export rows_to_delete subset from Supabase Studio if needed.

BEGIN;

DELETE FROM public.intraday_trades
WHERE trade_time < now() - interval '3 days';

COMMIT;

-- Reclaim storage on table and indexes.
VACUUM FULL ANALYZE public.intraday_trades;

-- Post-checks.
SELECT
  pg_size_pretty(pg_total_relation_size('public.intraday_trades')) AS intraday_total_size_after,
  pg_size_pretty(pg_database_size(current_database())) AS db_size_after_phase2;
