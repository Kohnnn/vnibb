# Daily Trading Updater

This document describes the daily trading updater for VNIBB.

## Scope

The daily updater syncs and caches:
- Order flow (derived from intraday trades)
- Foreign trading (buy/sell flows)
- Big orders and block trades
- Derivatives/futures prices
- Optional warrants (configured symbols only)

Data is persisted to Supabase (PostgreSQL) and cached to Upstash (Redis) with resume support.

## Key Tables

- `intraday_trades`
- `order_flow_daily`
- `foreign_trading`
- `block_trades`
- `orderbook_snapshots`
- `derivative_prices`

## Resume + Progress

- Progress key: `vnibb:sync:daily_trading:progress`
- TTL: 3 days
- Safe to rerun after interruptions; it resumes from the last stage/symbol.

## Cache Keys (Upstash)

- `vnibb:foreign_trading:{SYMBOL}:{YYYY-MM-DD}` (per-symbol, optional)
- `vnibb:foreign_trading:{YYYY-MM-DD}:{EXCHANGE}:{CHUNK}` (chunked, default)
- `vnibb:order_flow:daily:{SYMBOL}:{YYYY-MM-DD}` (per-symbol, optional)
- `vnibb:order_flow:daily:{YYYY-MM-DD}:{EXCHANGE}:{CHUNK}` (chunked, default)
- `vnibb:intraday:latest:{SYMBOL}`
- `vnibb:orderbook:latest:{SYMBOL}`
- `vnibb:orderbook:daily:{SYMBOL}:{YYYY-MM-DD}`
- `vnibb:block_trades:daily:{SYMBOL}:{YYYY-MM-DD}`
- `vnibb:derivatives:latest:{SYMBOL}`
- `vnibb:derivatives:recent:{SYMBOL}`

## Config

Update `vnibb/apps/api/.env`:

```
VNSTOCK_CALLS_PER_MINUTE=550
BIG_ORDER_THRESHOLD_VND=10000000000
INTRADAY_LIMIT=500
INTRADAY_REQUIRE_MARKET_HOURS=true
INTRADAY_MARKET_TZ=Asia/Ho_Chi_Minh
INTRADAY_MARKET_OPEN=09:00
INTRADAY_MARKET_CLOSE=15:00
INTRADAY_BREAK_START=11:30
INTRADAY_BREAK_END=13:00
ORDERFLOW_AT_CLOSE_ONLY=true
ORDERBOOK_AT_CLOSE_ONLY=true
STORE_INTRADAY_TRADES=false
PROGRESS_CHECKPOINT_EVERY=50
CACHE_CHUNK_SIZE=200
CACHE_FOREIGN_TRADING_CHUNKED=true
CACHE_FOREIGN_TRADING_PER_SYMBOL=false
CACHE_ORDER_FLOW_CHUNKED=true
CACHE_ORDER_FLOW_PER_SYMBOL=false
SCREENER_RETENTION_DAYS=365
ORDER_FLOW_RETENTION_YEARS=3
FOREIGN_TRADING_RETENTION_YEARS=3
INTRADAY_RETENTION_DAYS=7
ORDERBOOK_RETENTION_DAYS=30
BLOCK_TRADES_RETENTION_DAYS=365
DERIVATIVES_SYMBOLS=VN30F1M,VN30F2M,VN30F1Q,VN30F2Q
WARRANT_SYMBOLS=["ABC1","XYZ2"]
```

Notes:
- `WARRANT_SYMBOLS` is optional. If empty, warrant sync is skipped.
- `DERIVATIVES_SYMBOLS` is optional; defaults to vnstock list.
- Intraday/orderbook/block-trade sync is skipped outside configured market hours.
- All vnstock calls use `VNSTOCK_SOURCE` (KBS).
- Intraday raw storage is disabled by default; only daily order flow is persisted.

## Redis Budget Controls

To keep Upstash commands under the 500k/month free-tier limit:

1. **Progress throttling**
   - Checkpoints are written every N symbols (`PROGRESS_CHECKPOINT_EVERY`, default 50).

2. **Disable cache writes for bulk seeds**
   - Full seeding skips data cache writes (progress still updates at throttled cadence).

3. **Per-day cache chunking (default)**
   - Aggregate by exchange (HOSE/HNX/UPCoM) and chunk symbols (e.g., 200 symbols per payload).
   - Toggle with `CACHE_FOREIGN_TRADING_CHUNKED` and `CACHE_ORDER_FLOW_CHUNKED`.

4. **Skip `price:recent` in bulk jobs**
   - Full seed only writes `price:latest`, not `price:recent`.

5. **UI polling reduction (scale option)**
   - Increase polling intervals or switch to WebSockets for live updates.

## Retention Cleanup

Retention cleanup runs after daily trading syncs and full seeds. You can also trigger it manually:

```
POST /api/v1/data/sync/cleanup
```

## Run Manually

```
set PYTHONUTF8=1
C:\Users\Admin\AppData\Local\Python\bin\python.EXE -c "import asyncio; from vnibb.services.data_pipeline import data_pipeline; asyncio.run(data_pipeline.run_daily_trading_updates())"
```

## Scheduler

The updater runs daily at 09:20 UTC (4:20 PM VNT) via APScheduler:

- Job ID: `daily_trading_sync`
- Defined in: `vnibb/apps/api/vnibb/core/scheduler.py`

## API Trigger

```
POST /api/v1/data/sync/daily-trading
```
