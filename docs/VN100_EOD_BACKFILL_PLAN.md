# VN100 EOD Backfill Plan

> Update 2026-06-11: For full-universe + deeper-history backfill, prefer the
> Vietcap pipeline (`VIETCAP_DATA_SOURCE.md`, `apps/api/scripts/vietcap/`).
> Vietcap is now the PRIMARY source, is auth-free, off the vnstock quota, and
> returns history back to each symbol's listing date (often pre-2015, beyond
> the KBS floor this plan hit). The vnstock path below remains the daily-refresh
> fallback. EOD `source` precedence is `vietcap` > `vnstock-data`.

## Goal

Populate canonical end-of-day OHLCV history for the full VN100 universe so quant and backtesting widgets can run from local database data instead of repeated provider calls.

Initial history target:

- Start: `2008-01-01`
- End: current date at execution time
- Rule: fetch the full available range per symbol. If a symbol has no data back to 2008, keep every row the provider returns and do not synthesize missing history.

## Canonical Target

Use MongoDB as the canonical EOD corpus:

- Database: `vnibb-market`
- Collection: `market_prices_eod`
- Runtime readers: `/equity/historical`, quant endpoints, MCP `get_eod_price_history`

Do not write this bootstrap into Appwrite user/runtime collections. Appwrite writes remain controlled by `APPWRITE_WRITE_ENABLED` and are unrelated to this market corpus backfill.

## Source Priority

Preferred source path:

- Sponsored `vnstock_data`: `Market().equity(symbol).history(start="2008-01-01", end=<today>)`
- Existing script: `apps/api/scripts/backfill_mongo_vnstock_data.py`

Fallback source path:

- OSS `vnstock`: `Vnstock().stock(symbol=symbol, source="KBS").quote.history(start="2008-01-01", end=<today>, interval="1D")`
- Use `VCI` fallback only when KBS fails or returns no usable rows for a symbol.

VN100 universe source:

- `Listing(source="KBS").symbols_by_group(group="VN100")`
- Normalize ticker columns defensively (`symbol`, `ticker`, or provider-specific equivalent).

## Record Shape

Each normalized document in `market_prices_eod` should carry:

- `symbol`: uppercase ticker
- `tradeDate`: naive `datetime`, normalized to `07:00:00` for the trading day
- `interval`: `1D`
- `source`: `vnstock-data`
- `sourceKey`: `vnstock-data:{SYMBOL}:eod:{YYYY-MM-DD}`
- `open`, `high`, `low`, `close`, `volume`
- `value` when available
- `createdAt`, `updatedAt`, `syncedAt`
- `schemaVersion`: `1`

Upsert key:

```python
{"symbol": symbol, "tradeDate": trade_date_at_07_00_00, "source": "vnstock-data"}
```

The `07:00:00` timestamp matters. `MongoMarketDataService.bulk_upsert_eod_prices` already normalizes to this value so daily refreshes overwrite bootstrap rows instead of creating duplicate bars.

## Execution Plan

1. Inspect current Mongo status.
   - Confirm `MONGODB_URL` and `MONGODB_DATABASE=vnibb-market`.
   - Check `market_prices_eod` indexes.
   - Count current VN100 coverage and latest `tradeDate` by symbol.

2. Resolve VN100 symbols.
   - Fetch `Listing(source="KBS").symbols_by_group(group="VN100")`.
   - Save/log the exact symbol list used for the run.
   - Fail the run if the resolved list is unexpectedly tiny.

3. Run a small dry run.
   - Use `VCB,ACB,TCB` first.
   - Fetch `2008-01-01` to today.
   - Confirm row count, field names, date parsing, and close/volume quality.

4. Run full VN100 dry run.
   - Fetch all VN100 symbols.
   - Continue on symbol-level failure.
   - Log rows fetched, first date, last date, and errors per symbol.

5. Apply full VN100 bootstrap.
   - Bulk upsert per symbol with ordered writes disabled.
   - Keep the run id/log output for audit.
   - Do not delete existing rows during the first bootstrap.

6. Validate corpus.
   - Confirm every resolved VN100 symbol has at least one row or a documented provider failure.
   - Check latest `tradeDate` by symbol.
   - Check earliest `tradeDate` by symbol to identify symbols without 2008 history.
   - Check duplicate `(symbol, tradeDate)` bars.
   - Check null `close`, negative prices, and impossible OHLC ranges.

7. Refresh recent window.
   - Run `mongo_eod_sync` for a 7-day window after bootstrap.
   - This proves the scheduled daily writer can advance the bootstrapped VN100 symbols.

8. Widget readiness.
   - Backtesting widgets should read from backend data APIs backed by `market_prices_eod`, not call vnstock directly.
   - For VN100-wide backtests, add a backend batch API later instead of issuing 100 frontend historical requests.

## Candidate Commands

Small dry run with existing sponsored-path script:

```bash
python apps/api/scripts/backfill_mongo_vnstock_data.py --symbols VCB,ACB,TCB --datasets market_prices_eod --start 2008-01-01 --dry-run
```

Apply with an explicit VN100 symbol list after universe resolution:

```bash
python apps/api/scripts/backfill_mongo_vnstock_data.py --symbols <VN100_COMMA_LIST> --datasets market_prices_eod --start 2008-01-01
```

Refresh recent bars after bootstrap:

```bash
curl -X POST "http://localhost:8000/api/v1/sync/mongo-eod?window_days=7&async_mode=false"
```

## Progress Log

### 2026-06-10

- Read VNIBB vnstock reference notes.
- Confirmed historical OHLCV API shape: `quote.history(start, end, interval="1D")` returns `time`, `open`, `high`, `low`, `close`, `volume`.
- Confirmed VN100 universe can be resolved with `Listing(source="KBS").symbols_by_group(group="VN100")`.
- Confirmed canonical runtime target is Mongo `vnibb-market.market_prices_eod`.
- Confirmed quant data loader already prefers Mongo `market_prices_eod` before Postgres/cache/provider fallback.
- Confirmed `/equity/historical` also prefers Mongo, so this backfill benefits chart and quant widgets.
- Confirmed scheduled `mongo_eod_sync` refreshes only symbols already present in `market_prices_eod`; VN100 bootstrap is required before daily refresh covers the full VN100 list.
- Updated initial range requirement to `2008-01-01` through current date, keeping all provider-available rows when a symbol lacks full 2008 history.
- Verified local environment: OSS `vnstock` and `pymongo` are installed; sponsored `vnstock_data` is not installed in this shell.
- Loaded n6v Mongo connection settings from the workspace parent `.env` without printing credentials.
- Resolved the current VN100 universe through `Listing(source="KBS").symbols_by_group(group="VN100")`; it returned 100 symbols.
- Checked pre-run n6v coverage: all 100 VN100 symbols already existed in `vnibb-market.market_prices_eod`; total collection size was about 1.33M EOD rows.
- Ran a one-off OSS `vnstock` bootstrap for all 100 VN100 symbols from `2008-01-01` through `2026-06-10`, using KBS for every successful symbol and the canonical `07:00:00` `tradeDate` key.
- Backfill result: 100 symbols succeeded, 0 symbol errors, 231371 provider rows fetched/upserted into `market_prices_eod`.
- Provider availability note: KBS returned available histories mostly from 2015 onward, not from 2008. No synthetic pre-provider rows were inserted.
- Validation result: 100/100 VN100 symbols covered, 231371 VN100 rows present, latest `tradeDate` is `2026-06-10` for all 100 symbols, earliest available `tradeDate` is `2015-09-28`, duplicate `(symbol, tradeDate)` keys = 0, bad/null-close OHLC rows = 0.

## Open Items

- Decide whether to install `vnstock_data` in the backend environment or keep the OSS fallback path for future EOD bootstrap operations.
- Convert the one-off OSS bootstrap into a committed script or extend the existing backfill script with `--symbols-group VN100` and OSS fallback support.
- Decide whether to enhance the existing backfill script with `--symbols-group VN100` and validation summaries, or run it with a generated comma-separated symbol list.
