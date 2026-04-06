# Auto Update Strategy

## Goal

Run vnstock-backed updates automatically without burning through the practical operating budget.

The working assumption for runtime planning is:

- hard provider cap: `150000` calls/day
- practical steady-state target: about `100` calls/minute

That means the backend should not treat all datasets equally.

## Operating model

### Trading hours

Only refresh market-sensitive datasets on a smaller symbol universe.

Primary targets:

- `foreign_trading`
- `order_flow_daily`
- `intraday_trades`
- `orderbook_snapshots`
- `derivative_prices`

The backend now runs a market-hours scheduler job that uses a priority symbol slice instead of the full universe.

Default live scope:

- `scheduler_live_symbols_per_run=60`

Priority symbols are selected from the latest `screener_snapshots` by market cap, with an active-stock fallback if screener data is unavailable.

### After close

Run heavier end-of-day refreshes after the market closes.

Primary targets:

- `stock_prices`
- `stock_indices`
- `foreign_trading`
- `order_flow_daily`
- `orderbook_snapshots`
- `derivative_prices`
- daily `screener_snapshots`
- daily price/financial freshness work

This is handled by the existing post-close market and daily trading jobs.

### Off hours and weekends

Use a rotating supplemental sync for slower-changing company datasets.

Primary targets:

- `shareholders`
- `officers`
- `subsidiaries`
- broader `company_news`

Weekday model:

- one domain per day on a rotating top-symbol slice

Weekend model:

- broader top-symbol coverage across all supplemental domains

Default batch sizes:

- `scheduler_supplemental_symbols_per_run=120`
- `scheduler_weekend_symbols_per_run=300`
- `scheduler_company_news_limit=10`

## Bundling and rate-limit efficiency

### Good bundling paths

- `price_board` batch fetches for `foreign_trading`
- listing metadata calls such as `all_symbols`, `symbols_by_exchange`, and `symbols_by_industries`
- deriving screeners and rankings from SQL/Appwrite instead of refetching everything live

### Poor bundling paths

- `stock_prices` historical fetches remain largely per symbol / per range
- `intraday_trades` is still per symbol
- `orderbook_snapshots` is still per symbol
- `shareholders`, `officers`, `subsidiaries`, `dividends`, and `company_events` are mostly per symbol

Those should therefore be scheduled outside trading hours or on smaller symbol slices.

## Current automatic schedule

### Existing core jobs

- `daily_sync` at `09:00 UTC` / `4:00 PM VNT`
- `rs_rating_sync` at `09:10 UTC`
- `daily_trading_sync` at `09:20 UTC`
- `daily_data_quality_check` at `09:40 UTC`
- `hourly_news` every hour

### Added jobs / reinforced behavior

- `intraday_sync` is no longer a placeholder; it now runs a limited market-hours slice against priority symbols
- `supplemental_company_sync` runs at `10:30 UTC` / `5:30 PM VNT`

## Appwrite mirroring behavior

This section describes the intended Appwrite projection behavior when Appwrite writes are available.

For the current month, Appwrite writes are disabled because the org is returning `limit_databases_writes_exceeded`. The scheduler should update SQL/Supabase first and treat Appwrite mirroring as paused until quota is available again.

Current scheduled mirroring rules:

- post-close daily trading sync mirrors:
  - `foreign_trading`
  - `order_flow_daily`
  - `derivative_prices`
  - `intraday_trades` if raw intraday storage is enabled
  - `orderbook_snapshots` if orderbook snapshots are enabled outside close-only mode
- market-hours intraday slice mirrors:
  - `foreign_trading`
  - `order_flow_daily`
  - `derivative_prices`
  - optional `intraday_trades`
  - optional `orderbook_snapshots`
- supplemental company sync mirrors:
  - `shareholders`
  - `officers`
  - `subsidiaries`
  - `company_news`

## Practical rate budget guidance

Suggested daily operating split:

- `40k/day` trading-hours live refreshes
- `60k/day` after-close + nightly maintenance
- `50k/day` retry reserve, backfills, and weekend catch-up

Suggested market-hours behavior:

- stay near `50-80` effective calls/minute
- keep retry headroom instead of pushing the full ceiling continuously

## Recommended runtime env values

For the current scheduler design, these are the recommended production-oriented values:

```env
VNSTOCK_SOURCE=KBS
VNSTOCK_CALLS_PER_MINUTE=100
INTRADAY_SYMBOLS_PER_RUN=60
SCHEDULER_LIVE_SYMBOLS_PER_RUN=60
SCHEDULER_SUPPLEMENTAL_SYMBOLS_PER_RUN=120
SCHEDULER_WEEKEND_SYMBOLS_PER_RUN=300
SCHEDULER_COMPANY_NEWS_LIMIT=10
ORDERFLOW_AT_CLOSE_ONLY=true
ORDERBOOK_AT_CLOSE_ONLY=true
STORE_INTRADAY_TRADES=false
INTRADAY_REQUIRE_MARKET_HOURS=true
INTRADAY_ALLOW_OUT_OF_HOURS_IN_PROD=false
CACHE_FOREIGN_TRADING_CHUNKED=true
CACHE_ORDER_FLOW_CHUNKED=true
CACHE_CHUNK_SIZE=200
```

Notes:

- `VNSTOCK_CALLS_PER_MINUTE=100` is the practical operating target, even though the provider hard cap is higher.
- `STORE_INTRADAY_TRADES=false` keeps the runtime from exploding Appwrite/SQL write volume unless you explicitly want full raw intraday storage.
- The live scheduler and the legacy intraday limiter should match at `60` to avoid confusion.

## Implementation summary

The backend now follows this philosophy:

- fast-moving market data during trading hours on a limited priority universe
- post-close daily market refreshes for price, index, screener, and financial freshness
- rotating supplemental vnstock updates for slower-changing company datasets off trading hours
- optional Appwrite mirroring for the tables that power legacy runtime reads when write quota is available

This is the safest way to get materially better freshness without treating every vnstock dataset like a real-time feed.

## Next-month fallback plan

If Appwrite quota resets cleanly next month, re-enable Appwrite writes in a controlled sequence:

1. keep `Postgres/Supabase` as the primary durable store
2. enable `APPWRITE_WRITE_ENABLED=true` only during controlled off-peak windows
3. backfill the highest-value collections first instead of turning on all live mirroring at once
4. verify read paths against Appwrite freshness before expanding the projection scope
5. if Appwrite shows quota pressure again, switch writes back off immediately without changing the primary source of truth
