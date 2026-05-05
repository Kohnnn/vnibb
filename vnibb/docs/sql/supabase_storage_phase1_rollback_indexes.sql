-- V161 Phase 1 rollback script
-- Recreate indexes dropped during storage optimization if query performance regresses.

CREATE INDEX IF NOT EXISTS ix_block_time
  ON public.block_trades USING btree (trade_time);

CREATE INDEX IF NOT EXISTS ix_intraday_time
  ON public.intraday_trades USING btree (trade_time);

CREATE INDEX IF NOT EXISTS ix_market_news_published
  ON public.market_news USING btree (published_date);

CREATE INDEX IF NOT EXISTS ix_officer_symbol
  ON public.officers USING btree (symbol);

CREATE INDEX IF NOT EXISTS ix_sector_perf_date
  ON public.sector_performance USING btree (trade_date);

CREATE INDEX IF NOT EXISTS ix_stock_price_date_only
  ON public.stock_prices USING btree ("time");

CREATE INDEX IF NOT EXISTS ix_subsidiaries_symbol
  ON public.subsidiaries USING btree (symbol);

CREATE INDEX IF NOT EXISTS ix_stock_price_perf
  ON public.stock_prices USING btree (symbol, close);
