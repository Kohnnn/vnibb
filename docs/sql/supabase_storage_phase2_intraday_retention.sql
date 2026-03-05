-- V161 Phase 2: Intraday retention (optional)
-- Project: cbatjktmwtbhelgtweoi
-- Execute only after Phase 1 and explicit retention approval.
-- This script keeps only the most recent 3 days in intraday_trades.

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
VACUUM (ANALYZE) public.intraday_trades;

-- Post-checks.
SELECT
  pg_size_pretty(pg_total_relation_size('public.intraday_trades')) AS intraday_total_size_after,
  pg_size_pretty(pg_database_size(current_database())) AS db_size_after_phase2;
