-- Financial period cleanup for production data-quality repair
-- Project: cbatjktmwtbhelgtweoi
-- Date: 2026-03-06
--
-- Purpose:
-- Remove legacy broken financial rows where `period` was stored as a one- or
-- two-digit number (`0`..`99`) instead of a real year (`2024`) or quarter key
-- (`Q1-2025`, `2025-Q1`).
--
-- IMPORTANT:
-- Do NOT use the old `period::int > 4` heuristic on the current schema.
-- Valid annual rows now use 4-digit years like `2024` and `2025`.
-- The safe production filter is: `period ~ '^[0-9]{1,2}$'`.

-- Preview invalid-row counts.
select 'income_statements' as table_name, count(*) as invalid_rows
from public.income_statements
where period ~ '^[0-9]{1,2}$'
union all
select 'balance_sheets', count(*)
from public.balance_sheets
where period ~ '^[0-9]{1,2}$'
union all
select 'cash_flows', count(*)
from public.cash_flows
where period ~ '^[0-9]{1,2}$'
union all
select 'financial_ratios', count(*)
from public.financial_ratios
where period ~ '^[0-9]{1,2}$';

-- Sample bad rows.
select symbol, period, period_type, fiscal_year, fiscal_quarter, updated_at
from public.income_statements
where period ~ '^[0-9]{1,2}$'
order by updated_at desc
limit 20;

begin;

delete from public.income_statements
where period ~ '^[0-9]{1,2}$';

delete from public.balance_sheets
where period ~ '^[0-9]{1,2}$';

delete from public.cash_flows
where period ~ '^[0-9]{1,2}$';

delete from public.financial_ratios
where period ~ '^[0-9]{1,2}$';

commit;

vacuum full analyze public.income_statements;
vacuum full analyze public.balance_sheets;
vacuum full analyze public.cash_flows;
vacuum full analyze public.financial_ratios;

-- Post-checks.
select 'income_statements' as table_name, count(*) as invalid_rows
from public.income_statements
where period ~ '^[0-9]{1,2}$'
union all
select 'balance_sheets', count(*)
from public.balance_sheets
where period ~ '^[0-9]{1,2}$'
union all
select 'cash_flows', count(*)
from public.cash_flows
where period ~ '^[0-9]{1,2}$'
union all
select 'financial_ratios', count(*)
from public.financial_ratios
where period ~ '^[0-9]{1,2}$';

select pg_size_pretty(pg_database_size(current_database())) as db_size_after_cleanup;
