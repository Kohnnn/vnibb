# Appwrite VNStock Rollout

Date: 2026-04-02

## Purpose

This document turns the VNStock and Appwrite discovery work into an execution-ready rollout for VNIBB.

The goal is to:

- fix the current Appwrite market-data footprint
- create the missing market collections needed by VNIBB widgets
- populate the database within the available VNStock Golden limits
- keep FastAPI as the main query layer while Appwrite becomes a stronger persisted runtime store

## Current Appwrite Findings

Database:

- endpoint: `https://sgp.cloud.appwrite.io/v1`
- project: `69a9c5ab0003bd4e280c`
- database: `69a9c70d0026c7d08f51`

Observed collection counts during audit:

- `stocks`: `1738`
- `stock_prices`: `5000`
- `stock_indices`: `4`
- `income_statements`: `5000`
- `balance_sheets`: `5000`
- `cash_flows`: `5000`
- `financial_ratios`: `5000`
- `intraday_trades`: `0`

Observed problems:

- current market collections use `longtext` attributes only
- current core market collections have `0` Appwrite indexes
- `stock_prices` only covers a small subset of symbols
- `stock_indices` is only a latest-snapshot footprint, not a real history
- financial collections contain malformed period/year values such as `0`, `1`, `2`
- `stocks.exchange` already shows normalization drift (`UPCOM` and `UPCoM`)

## Strategy

Use a 2-layer data strategy:

1. Keep Appwrite as the persisted document store.
2. Keep FastAPI as the main query, normalization, fallback, and widget-serving layer.

This rollout does not assume widgets query Appwrite directly.

That is important because the current frontend already talks to VNIBB API routes, and many widgets need backend-side normalization anyway.

## Collection Strategy

### Existing Collections To Keep And Repair

- `stocks`
- `stock_prices`
- `stock_indices`
- `income_statements`
- `balance_sheets`
- `cash_flows`
- `financial_ratios`
- `intraday_trades`

### New Collections To Add

- `companies`
- `shareholders`
- `officers`
- `subsidiaries`
- `dividends`
- `company_events`
- `company_news`
- `insider_deals`
- `foreign_trading`
- `order_flow_daily`
- `orderbook_snapshots`
- `derivative_prices`
- `screener_snapshots`
- `market_sectors`
- `sector_performance`

## Schema Approach

### Base Attributes

Keep the existing text-safe Appwrite mirroring approach for raw source fields.

That means the source SQL columns remain mirrored as longtext-safe document fields so large values and provider drift do not break ingestion.

### Query Overlay Attributes

Add a second layer of typed query-safe attributes for the fields that need Appwrite-side filtering and indexing.

Naming convention:

- string query fields: `_q`
- integer query fields: `_i`
- float query fields: `_f`
- datetime query fields: `_dt`
- boolean query fields: `_b`

Examples:

- `symbol_q`
- `exchange_q`
- `industry_q`
- `period_type_q`
- `fiscal_year_i`
- `fiscal_quarter_i`
- `time_dt`
- `trade_date_dt`
- `snapshot_time_dt`

This keeps raw document compatibility while making Appwrite-side lookups practical.

## Index Plan

Minimum practical indexes:

- `stocks`: `symbol_q`, `exchange_q`, `industry_q`
- `stock_prices`: `symbol_q`, `time_dt`, `symbol_q+time_dt+interval_q`
- `stock_indices`: `index_code_q`, `time_dt`, `index_code_q+time_dt`
- `income_statements`: `symbol_q`, `symbol_q+period_type_q+fiscal_year_i+fiscal_quarter_i`
- `balance_sheets`: `symbol_q`, `symbol_q+period_type_q+fiscal_year_i+fiscal_quarter_i`
- `cash_flows`: `symbol_q`, `symbol_q+period_type_q+fiscal_year_i+fiscal_quarter_i`
- `financial_ratios`: `symbol_q`, `symbol_q+period_type_q+fiscal_year_i+fiscal_quarter_i`
- `intraday_trades`: `symbol_q`, `trade_time_dt`, `symbol_q+trade_time_dt`
- `companies`: `symbol_q`, `exchange_q`, `industry_q`
- `shareholders`: `symbol_q`, `as_of_date_dt`, `symbol_q+as_of_date_dt`
- `officers`: `symbol_q`
- `subsidiaries`: `symbol_q`
- `dividends`: `symbol_q`, `exercise_date_dt`, `symbol_q+exercise_date_dt`
- `company_events`: `symbol_q`, `event_type_q`, `symbol_q+event_type_q+event_date_dt`
- `company_news`: `symbol_q`, `published_date_dt`, `source_q`
- `insider_deals`: `symbol_q`, `announce_date_dt`
- `foreign_trading`: `symbol_q`, `symbol_q+trade_date_dt`
- `order_flow_daily`: `symbol_q`, `symbol_q+trade_date_dt`
- `orderbook_snapshots`: `symbol_q`, `snapshot_time_dt`
- `derivative_prices`: `symbol_q`, `symbol_q+trade_date_dt+interval_q`
- `screener_snapshots`: `symbol_q`, `snapshot_date_dt`, `exchange_q`, `industry_q`
- `market_sectors`: `sector_code_q`, `parent_code_q`
- `sector_performance`: `sector_code_q`, `sector_code_q+trade_date_dt`

## VNStock Population Budget

Golden VNStock limits supplied by the user:

- `500` requests/minute
- `150000` requests/day

Recommended operational budget:

- bulk backfill budget: `100000/day`
- daily maintenance budget: `30000/day`
- reserve for retries/manual runs: `20000/day`

Recommended sustained bulk rate:

- `250-350` requests/minute

Reason:

- the daily cap is the real constraint
- leaving retry headroom avoids wasting the day budget on provider spikes or throttling

## Backfill Feasibility By Dataset

### Full or Near-Full Historical Backfill

- `stocks`
- `stock_prices`
- `stock_indices`
- `income_statements`
- `balance_sheets`
- `cash_flows`
- `financial_ratios`
- `companies`
- `shareholders`
- `officers`
- `subsidiaries`
- `dividends`
- `company_events`
- `company_news` (recent-heavy, archive depth depends on provider coverage)
- `insider_deals` (recent-heavy, archive depth depends on provider coverage)
- `derivative_prices`
- `market_sectors`
- `sector_performance` (best derived)
- `screener_snapshots` (best derived)

### Forward Capture, Not True Historical Recovery

- `intraday_trades`
- `order_flow_daily`
- `orderbook_snapshots`
- `foreign_trading` via the current price-board-derived path
- `block_trades`

These should be treated as datasets that start building durable history from now forward.

## Rollout Order

### Phase 1 - Appwrite Schema Repair

1. Create missing collections.
2. Add text-safe source attributes.
3. Add query overlay attributes.
4. Add indexes on the query overlay attributes.

### Phase 2 - Repair Core Existing Data

1. Normalize `stocks.exchange` values.
2. Fully repopulate `stock_prices`.
3. Expand `stock_indices` beyond the current latest-snapshot footprint.
4. Validate source financial tables before mirroring.
5. Reset and repopulate malformed financial collections if the source is clean.

### Phase 3 - Add Missing Widget-Critical Collections

1. `companies`
2. `shareholders`
3. `officers`
4. `subsidiaries`
5. `dividends`
6. `company_events`
7. `company_news`
8. `insider_deals`

### Phase 4 - Add Flow And Derivatives Collections

1. `foreign_trading`
2. `intraday_trades`
3. `order_flow_daily`
4. `orderbook_snapshots`
5. `derivative_prices`

### Phase 5 - Derived Market Datasets

1. `screener_snapshots`
2. `market_sectors`
3. `sector_performance`

## Widget Mapping

### Immediate Widget Wins

- `ticker_profile` -> `companies`
- `major_shareholders` -> `shareholders`
- `officers_management` -> `officers`
- `subsidiaries` -> `subsidiaries`
- `dividend_payment` -> `dividends`
- `dividend_ladder` -> `dividends`
- `events_calendar` -> `company_events`
- `stock_splits` -> `company_events`
- `company_filings` -> `company_events`
- `news_feed` -> `company_news`
- `news_flow` -> `company_news`
- `insider_trading` -> `insider_deals`
- `insider_deal_timeline` -> `insider_deals`
- `foreign_trading` -> `foreign_trading`
- `intraday_trades` -> `intraday_trades`
- `orderbook` -> `orderbook_snapshots`
- `screener` -> `screener_snapshots`
- `sector_performance` -> `sector_performance`
- `sector_rotation_radar` -> `sector_performance`
- `sector_breakdown` -> `market_sectors`, `sector_performance`

### Important Architectural Note

Most widgets should continue using FastAPI routes first.

The right runtime pattern is:

widget -> FastAPI endpoint -> cache / Appwrite / Postgres / live provider fallback

That avoids pushing provider-specific quirks into the UI.

## Execution Commands

After the new schema tooling is in place, the Appwrite collection rollout should follow this order:

```bash
node ./scripts/appwrite/ensure_appwrite_collections.mjs
node ./scripts/appwrite/ensure_appwrite_attributes_textsafe.mjs
node ./scripts/appwrite/ensure_appwrite_query_attributes.mjs
node ./scripts/appwrite/ensure_appwrite_indexes.mjs
```

Then the dataset population order should be:

```bash
python apps/api/scripts/seed_historical.py --type stocks
python apps/api/scripts/seed_historical.py --type prices --days 365
python apps/api/scripts/full_seed.py
```

For large historical runs, prefer scoped table backfills and resumable Appwrite mirroring.

## Safety Rules

- do not delete malformed financial Appwrite data until the source SQL data has been validated
- do not change deterministic document ID strategy for an existing collection without either resetting it or accepting duplicates
- do not query Appwrite directly from widgets until the query overlay attributes and indexes are in place
- treat intraday and orderbook history as forward-capture datasets

## Recommended Immediate Outcome

The most useful near-term shipped state is:

1. Appwrite collections and indexes are fixed.
2. Missing widget-critical collections exist.
3. Core price and financial collections are repopulated correctly.
4. Company, ownership, dividend, event, news, and insider datasets are available to the backend.
5. FastAPI continues serving widgets while Appwrite becomes a much stronger persisted market-data layer.
