# VNStock Full Mongo Ingestion Plan

Date: 2026-06-05

Approval status: approved by user on 2026-06-05.

## Purpose

Populate VNIBB's private MongoDB analytical store with all practical VNStock premium data while keeping Supabase/PostgreSQL as the primary SQL, auth, and app-state runtime.

This plan covers these VNStock data layers:

- Market
- Fundamental
- Reference
- Macro
- Insights
- Analytics
- News

## Current Baseline

Active Mongo runtime:

```text
Database: vnibb-market
Primary raw collection: market_vnstock_premium_records
Primary EOD collection: market_prices_eod
```

Currently populated or partially populated:

- `market_prices_eod`
- `finance.income_statement.year`
- `finance.income_statement.quarter`
- `finance.balance_sheet.year`
- `finance.balance_sheet.quarter`
- `finance.cash_flow.year`
- `finance.cash_flow.quarter`
- `finance.ratio.year`
- `finance.ratio.quarter`
- `reference.shareholders`
- `company.officers`
- `company.subsidiaries`
- `company.events`
- `company.dividends`

The existing script `apps/api/scripts/backfill_mongo_vnstock_data.py` is intentionally narrow. It supports EOD, finance, and shareholders only.

## Design Decision

Use a Mongo-first premium ingestion layer next to the existing PostgreSQL/Appwrite data pipeline.

Do not replace current scheduled production jobs yet. The new ingestion layer must be:

- Manual-first and env-gated.
- Catalog-driven before broad ingestion.
- Checkpointed by dataset and scope.
- Conservative with VNStock calls.
- Explicit about retention for high-churn datasets.
- Safe to rerun.

## Retention Policy

Use hybrid retention.

Long-term full coverage:

- EOD prices.
- Fundamentals.
- Reference data.
- Corporate events/dividends.
- Foreign trading daily summaries where available.
- Macro observations.
- News article metadata/content.
- Provider analytics/insights snapshots.

Bounded high-churn coverage:

- Intraday trades: priority symbols only, retain 7-30 days initially.
- Price depth/order book: priority symbols during market hours, broad close snapshots if API budget allows, retain 30 days initially.
- Price board: priority market-hour snapshots plus broad open/midday/close snapshots, retain 7-30 days initially.

Keep `STORE_INTRADAY_TRADES=false` for the existing SQL/Appwrite pipeline unless intentionally testing that path. Mongo microstructure ingestion has its own retention gates.

## Collections

Keep existing collections:

```text
market_prices_eod
market_vnstock_premium_records
```

Add catalog and control collections:

```text
vnstock_api_catalog
vnstock_ingestion_runs
vnstock_ingestion_checkpoints
vnstock_ingestion_failures
```

Add typed read-model collections as datasets become stable:

```text
market_intraday_trades
market_price_depth_snapshots
market_price_board_snapshots
market_derivative_prices
market_foreign_trading
market_top_movers
market_overview_snapshots
reference_company_profiles
reference_symbol_listings
news_articles
macro_observations
analytics_observations
insights_observations
```

Raw provider payloads should continue to land in `market_vnstock_premium_records` with `dataset`, `datasetGroup`, `scopeType`, `scopeKey`, `recordKey`, `observedAt`, and `raw` fields.

## Indexes

Required existing indexes:

```text
market_prices_eod:
- { symbol: 1, tradeDate: 1, source: 1 } unique
- { symbol: 1, tradeDate: -1 }

market_vnstock_premium_records:
- { dataset: 1, symbol: 1, recordKey: 1 } unique
- { datasetGroup: 1, symbol: 1, observedAt: -1 }
- { scopeType: 1, scopeKey: 1, dataset: 1 }
```

New catalog/control indexes:

```text
vnstock_api_catalog:
- { layer: 1, object: 1, method: 1 } unique
- { status: 1, lastCheckedAt: -1 }

vnstock_ingestion_runs:
- { runId: 1 } unique
- { startedAt: -1 }

vnstock_ingestion_checkpoints:
- { runGroup: 1, dataset: 1, scopeKey: 1 } unique

vnstock_ingestion_failures:
- { runId: 1, dataset: 1, scopeKey: 1 }
- { dataset: 1, failedAt: -1 }
```

## Dataset Schedule

Market EOD:

- Scope: all active symbols.
- Interval: daily after close, with next-morning retry.
- Retention: long-term.
- Typed collection: `market_prices_eod`.

Market intraday:

- Scope: priority symbols only.
- Interval: every 5-15 minutes during market hours.
- Retention: 7-30 days.
- Typed collection: `market_intraday_trades`.

Price depth/order book:

- Scope: priority symbols during market hours; broad close snapshot if API budget allows.
- Interval: every 15-30 minutes for priority symbols; once after close for broader universe.
- Retention: 30 days.
- Typed collection: `market_price_depth_snapshots`.

Price board:

- Scope: priority symbols during market hours; broad universe at open, midday, close.
- Interval: 5-15 minutes priority, 3 broad snapshots per session.
- Retention: 7-30 days.
- Typed collection: `market_price_board_snapshots`.

Derivatives:

- Scope: configured symbols such as `VN30F1M`, `VN30F2M`, `VN30F1Q`, `VN30F2Q`.
- Interval: 5-15 minutes during market hours; daily close long-term snapshot.
- Retention: long-term for close snapshots, 30-90 days for intraday snapshots.

Top movers, market overview, sectors, groups:

- Scope: market/exchange/group.
- Interval: every 15-30 minutes during market hours; post-close snapshot long-term.
- Retention: long-term for close snapshots, 30-90 days for intraday snapshots.

Foreign trading:

- Scope: all active symbols after close; priority symbols intraday if supported.
- Interval: daily after close.
- Retention: 3+ years or long-term.

Fundamental:

- Scope: all active symbols.
- Interval: weekly full refresh; targeted daily retries for failures and priority symbols.
- Retention: long-term.

Reference:

- Listings/exchange/group/industry: daily or weekly.
- Profiles/officers/subsidiaries/shareholders: weekly.
- Dividends/events: daily after close.
- Ownership/insider deals: weekly or daily if provider support is stable.

Macro:

- Scope: provider-defined macro datasets.
- Interval: daily discovery check; monthly/quarterly full refresh depending on data cadence.
- Retention: long-term.

Insights:

- Scope: methods exposed by VNStock `Insights` layer.
- Interval: catalog first, then daily/weekly based on volatility.
- Retention: long-term snapshots.

Analytics:

- Scope: provider analytics plus VNIBB-derived analytics.
- Interval: after source dataset refresh.
- Retention: long-term snapshots.

News:

- Scope: supported `vnstock_news` sources.
- Interval: hourly small crawl, nightly broad crawl, historical backfill by source/date windows.
- Retention: long-term article records; large HTML/blob fields should move to object storage if they grow too large.

## API Call Strategy

Use a manifest for every ingestible dataset with these fields:

```text
dataset
layer
scope_type
scope_values
call_weight
priority
freshness_sla
retention
normalizer
batch_size
sleep_seconds
timeout_seconds
max_retries
enabled
```

Rules:

- Market-level calls run once per scope, not once per symbol.
- Exchange/group calls run once per exchange/group.
- Symbol calls are checkpointed and retried independently.
- Finance calls should reuse `Fundamental().equity(symbol)` per symbol.
- News calls should be source/date-window based.
- Unsupported methods should be recorded in `vnstock_api_catalog` and skipped until manually re-enabled.
- Transient failures should be retried with smaller batches and longer sleep.

## Initial Implementation Phases

Phase 0: discovery.

- Add `discover_vnstock_unified_ui.py`.
- Inspect `vnstock_data` classes and method surfaces.
- Store catalog rows in `vnstock_api_catalog`.
- Capture sample schemas where safe.

Phase 1: manifest ingestion scaffolding.

- Add `backfill_mongo_vnstock_full_catalog.py`.
- Support a conservative starter manifest.
- Write raw rows to `market_vnstock_premium_records`.
- Write control records to `vnstock_ingestion_runs`, `vnstock_ingestion_checkpoints`, and `vnstock_ingestion_failures`.

Phase 2: stable long-term data.

- EOD refresh.
- Fundamentals refresh/retry.
- Listings and company profile.
- Shareholders/officers/subsidiaries/dividends/events.
- Foreign trading daily if stable.

Phase 3: broad market snapshots.

- Market overview.
- Top movers.
- Sectors/groups.
- Derivatives close.
- Price board close.

Phase 4: bounded microstructure.

- Priority-symbol intraday.
- Priority-symbol price depth/order book.
- Retention cleanup.

Phase 5: macro, insights, analytics, news.

- Catalog-driven jobs per provider method.
- Conservative intervals until schemas and rate behavior are known.

## OCI Automation Gates

Start manual-only. Add scheduler jobs only after discovery and smoke runs pass.

Recommended env gates:

```text
VNSTOCK_MONGO_INGESTION_ENABLED=false
VNSTOCK_MONGO_DISCOVERY_ENABLED=false
VNSTOCK_MONGO_INTRADAY_ENABLED=false
VNSTOCK_MONGO_NEWS_ENABLED=false
VNSTOCK_MONGO_PRIORITY_SYMBOLS_PER_RUN=60
VNSTOCK_MONGO_FULL_SYMBOL_BATCH_SIZE=10
VNSTOCK_MONGO_CALLS_PER_MINUTE=300
```

Candidate scheduler jobs after smoke testing:

```text
09:05 UTC daily EOD + market close snapshots
09:45 UTC foreign trading + derivatives close
10:45 UTC fundamentals/reference rotating refresh
hourly news incremental
every 10 min market-hours priority microstructure
weekend full low-volatility refresh
```

## Operational Commands

OCI SSH:

```bash
ssh -i "C:\Users\Admin\.ssh\oci-vnibb" ubuntu@129.150.58.64
```

n6v SSH:

```bash
ssh -i "C:\Users\Admin\.ssh\oci-vnibb" vphk2001@100.72.199.91
```

Run discovery inside OCI container:

```bash
docker exec vnibb-api python /app/scripts/discover_vnstock_unified_ui.py --write-mongo --sample-limit 0
```

Run a dry-run starter manifest:

```bash
docker exec vnibb-api python /app/scripts/backfill_mongo_vnstock_full_catalog.py --symbols VCI,VNM,FPT --datasets reference.shareholders --dry-run
```

Run a small write smoke:

```bash
docker exec vnibb-api python /app/scripts/backfill_mongo_vnstock_full_catalog.py --symbols VCI,VNM,FPT --datasets reference.shareholders
```

Run a controlled slice from existing Mongo EOD symbols:

```bash
docker exec vnibb-api python /app/scripts/backfill_mongo_vnstock_full_catalog.py \
  --symbol-source mongo-eod \
  --limit 5 \
  --datasets reference.shareholders \
  --run-group mongo-eod-shareholders-smoke
```

For phased all-universe runs, advance with `--offset` and `--limit` instead of running the full universe in one process.

## Progress Log

- 2026-06-05: User approved hybrid retention for microstructure data.
- 2026-06-05: User approved Mongo-first premium ingestion plan.
- 2026-06-05: Added this design plan to repo docs.
- 2026-06-05: Added `apps/api/scripts/discover_vnstock_unified_ui.py`.
- 2026-06-05: Added `apps/api/scripts/backfill_mongo_vnstock_full_catalog.py`.
- 2026-06-05: Deployed both scripts to OCI `/srv/vnibb` and copied them into the live `vnibb-api` container for immediate manual use.
- 2026-06-05: Discovery smoke passed on OCI and wrote `101` catalog rows to `vnstock_api_catalog`.
- 2026-06-05: Shareholder dry-run smoke passed for `VCI,VNM,FPT`: `177` rows, `0` errors.
- 2026-06-05: Shareholder write smoke passed for `VCI,VNM,FPT`: `177` rows, `0` errors; ingestion controls show `1` run, `3` checkpoints, and `0` failures.
- 2026-06-05: VCI shareholder verification returned `28` `reference.shareholders` records by `scopeKey=VCI`.
- 2026-06-05: Added `--symbols-file`, `--symbol-source mongo-eod`, `--limit`, and `--offset` to `backfill_mongo_vnstock_full_catalog.py` for safe universe slicing.
- 2026-06-05: Deployed the slicing-capable runner to OCI and live `vnibb-api`.
- 2026-06-05: `--symbol-source mongo-eod --limit 5` dry-run smoke passed for `reference.shareholders`: `5` symbols, `65` rows, `0` errors.
- 2026-06-05: `--symbol-source mongo-eod --limit 5` write smoke passed for `reference.shareholders`: `5` symbols, `65` rows, `0` errors, `5` checkpoints, `0` shareholder failures.
- 2026-06-05: `reference.shareholders` phase slice `--symbol-source mongo-eod --offset 5 --limit 20 --batch-size 5 --sleep-seconds 5` passed: `20` symbols, `419` rows, `0` errors, `20` checkpoints, `0` run failures.
- 2026-06-05: `reference.shareholders` phase slice `--symbol-source mongo-eod --offset 25 --limit 50 --batch-size 5 --sleep-seconds 5` passed: `50` symbols, `816` rows, `0` errors; cumulative `mongo-eod-shareholders-phase1` checkpoints: `70`.
- 2026-06-05: Before continuing, progress check showed `1,565` EOD symbols, `70` phase checkpoints, `70` completed phase checkpoints, `0` shareholder failures, `1,578` distinct `reference.shareholders` scopes, and `28,400` shareholder docs.
- 2026-06-05: `reference.shareholders` phase slice `--symbol-source mongo-eod --offset 75 --limit 100 --batch-size 5 --sleep-seconds 5` passed: `100` symbols, `1,569` rows, `0` errors. Latest run ID: `vnstock-mongo-4bf519b771`; cumulative `mongo-eod-shareholders-phase1` checkpoints: `170`; shareholder failures remain `0`.
- 2026-06-05: `reference.shareholders` phase slice `--symbol-source mongo-eod --offset 175 --limit 200 --batch-size 5 --sleep-seconds 5` passed: `200` symbols, `3,606` rows, `0` errors. Latest run ID: `vnstock-mongo-3034bd1994`; cumulative checkpoints: `370`; shareholder failures remain `0`; shareholder docs: `31,464`.
- 2026-06-05: `reference.shareholders` phase slice `--symbol-source mongo-eod --offset 375 --limit 300 --batch-size 5 --sleep-seconds 5` passed: `300` symbols, `5,639` rows, `0` errors. Latest run ID: `vnstock-mongo-9eaf7ba13d`; cumulative checkpoints: `670`; shareholder failures remain `0`; shareholder docs: `34,454`.
- 2026-06-05: `reference.shareholders` phase slice `--symbol-source mongo-eod --offset 675 --limit 300 --batch-size 5 --sleep-seconds 5` passed: `300` symbols, `5,350` rows, `0` errors. Latest run ID: `vnstock-mongo-73862100dd`; cumulative checkpoints: `970`; shareholder failures remain `0`.
- 2026-06-05: `reference.shareholders` phase slice `--symbol-source mongo-eod --offset 975 --limit 300 --batch-size 5 --sleep-seconds 5` passed: `300` symbols, `5,117` rows, `0` errors. Latest run ID: `vnstock-mongo-fe5e551855`; cumulative checkpoints: `1,270`; shareholder failures remain `0`.
- 2026-06-05: `reference.shareholders` final EOD-symbol slice `--symbol-source mongo-eod --offset 1275 --limit 400 --batch-size 5 --sleep-seconds 5` passed: `290` symbols, `4,997` rows, `0` errors. Latest run ID: `vnstock-mongo-97f506bb3e`.
- 2026-06-05: `reference.shareholders` checkpointed EOD-symbol refresh completed: `1,565` EOD symbols total, `5` smoke checkpoints plus `1,560` phase1 checkpoints, `0` shareholder failures, `42,967` shareholder docs, `1,602` distinct shareholder scopes.
- 2026-06-06: Initial `reference.listings` run returned `0` rows because the starter fetcher incorrectly used `Reference`; patched it to use `Listing(source=os.getenv("VNSTOCK_SOURCE", "KBS").lower()).all_symbols()`.
- 2026-06-06: `reference.listings` source-aware run passed: `1` market scope, `1,532` rows, `0` errors. Latest run ID: `vnstock-mongo-55689c6164`; `reference.listings` docs: `1,532`.
- 2026-06-06: `finance.ratio.year,finance.ratio.quarter` first controlled slice `--symbol-source mongo-eod --offset 0 --limit 100 --batch-size 5 --sleep-seconds 5` passed: year `100` symbols / `1,192` rows / `0` errors; quarter `100` symbols / `3,346` rows / `0` errors. Latest run ID: `vnstock-mongo-10dc3db52b`; checkpoints: `200`; `finance.ratio` docs: `79,577`; distinct finance ratio scopes: `1,566`.
- 2026-06-06: `finance.ratio.year,finance.ratio.quarter` slice `--symbol-source mongo-eod --offset 100 --limit 200 --batch-size 5 --sleep-seconds 5` passed: year `200` symbols / `2,485` rows / `0` errors; quarter `200` symbols / `6,693` rows / `0` errors. Latest run ID: `vnstock-mongo-0e56b20346`; cumulative checkpoints: `600`; finance ratio failures: `0`; `finance.ratio` docs: `88,755`; distinct finance ratio scopes: `1,566`.
- 2026-06-06: `finance.ratio.year,finance.ratio.quarter` slice `--symbol-source mongo-eod --offset 300 --limit 300 --batch-size 5 --sleep-seconds 5` passed: year `300` symbols / `3,618` rows / `0` errors; quarter `300` symbols / `9,635` rows / `0` errors. Latest run ID: `vnstock-mongo-ce89c661c7`; cumulative checkpoints: `1,200`; finance ratio failures: `0`; `finance.ratio` docs: `102,008`; distinct finance ratio scopes: `1,566`.
- 2026-06-06: `finance.ratio.year,finance.ratio.quarter` slice `--symbol-source mongo-eod --offset 600 --limit 300 --batch-size 5 --sleep-seconds 5` passed: year `300` symbols / `3,794` rows / `0` errors; quarter `300` symbols / `10,775` rows / `0` errors. Latest run ID: `vnstock-mongo-9f3db8d5e5`; cumulative checkpoints: `1,800`; finance ratio failures: `0`; `finance.ratio` docs: `116,577`; distinct finance ratio scopes: `1,566`.
- 2026-06-06: `finance.ratio.year,finance.ratio.quarter` slice `--symbol-source mongo-eod --offset 900 --limit 300 --batch-size 5 --sleep-seconds 5` passed: year `300` symbols / `3,831` rows / `0` errors; quarter `300` symbols / `11,665` rows / `0` errors. Latest run ID: `vnstock-mongo-41d9e592c9`; cumulative checkpoints: `2,400`; finance ratio failures: `0`; `finance.ratio` docs: `132,073`; distinct finance ratio scopes: `1,566`.
- 2026-06-06: Final `finance.ratio.year,finance.ratio.quarter` slice `--symbol-source mongo-eod --offset 1200 --limit 365 --batch-size 5 --sleep-seconds 5` completed with year `365` symbols / `4,501` rows / `0` errors and quarter `364` symbols / `13,141` rows / `1` timeout error for `VDS`. Latest run ID: `vnstock-mongo-6a940707f8`; cumulative phase checkpoints: `3,130`; `finance.ratio` docs: `149,715`.
- 2026-06-06: Retried `VDS` `finance.ratio.quarter` with a one-symbol run; retry passed with `57` rows and `0` errors. Retry run ID: `vnstock-mongo-1bd74e58a2`; final `finance.ratio` docs: `149,772`; `VDS` ratio docs: `142`.
- 2026-06-06: Started `finance-statements-phase1` for income statement, balance sheet, and cash flow year + quarter. First slice `--symbol-source mongo-eod --offset 0 --limit 100 --batch-size 5 --sleep-seconds 5` passed all six datasets with `0` errors: income year `1,192` rows, income quarter `3,346`, balance year `1,192`, balance quarter `3,253`, cash flow year `1,192`, cash flow quarter `3,346`. Latest run ID: `vnstock-mongo-d879acb3b5`; checkpoints: `600`; latest failures: `0`.
- 2026-06-06: `finance-statements-phase1` slice `--symbol-source mongo-eod --offset 100 --limit 200 --batch-size 5 --sleep-seconds 5` passed all six datasets with `0` errors: income year `2,485` rows, income quarter `6,693`, balance year `2,485`, balance quarter `6,388`, cash flow year `2,485`, cash flow quarter `6,693`. Latest run ID: `vnstock-mongo-3d043a6547`; cumulative checkpoints: `1,800`; latest failures: `0`.
- 2026-06-06: `finance-statements-phase1` slice `--symbol-source mongo-eod --offset 300 --limit 300 --batch-size 5 --sleep-seconds 5` completed with one timeout: income year `3,619` rows / `0` errors, income quarter `9,635` / `0`, balance year `3,605` / `1` timeout for `DID`, balance quarter `9,131` / `0`, cash flow year `3,619` / `0`, cash flow quarter `9,636` / `0`. Latest run ID: `vnstock-mongo-6fcbd947fc`.
- 2026-06-06: Retried `DID` `finance.balance_sheet.year`; retry passed with `14` rows and `0` errors. Retry run ID: `vnstock-mongo-01b0adfbd7`; current statement docs: income `100,602`, balance `96,987`, cash flow `100,604`.
- 2026-06-07: `finance-statements-phase1` slice `--symbol-source mongo-eod --offset 600 --limit 300 --batch-size 5 --sleep-seconds 5` completed with one timeout: income year `3,796` rows / `0` errors, income quarter `10,775` / `0`, balance year `3,785` / `1` timeout for `KTT`, balance quarter `10,192` / `0`, cash flow year `3,796` / `0`, cash flow quarter `10,775` / `0`. Latest run ID: `vnstock-mongo-d6f8abc12d`.
- 2026-06-07: Retried `KTT` `finance.balance_sheet.year`; retry passed with `12` rows and `0` errors. Retry run ID: `vnstock-mongo-38ecb812b7`; current statement docs: income `115,173`, balance `110,976`, cash flow `115,175`.
- 2026-06-07: `finance-statements-phase1` slice `--symbol-source mongo-eod --offset 900 --limit 300 --batch-size 5 --sleep-seconds 5` completed with one timeout: income year `3,832` rows / `0` errors, income quarter `11,625` / `1` timeout for `PVM`, balance year `3,831` / `0`, balance quarter `10,949` / `0`, cash flow year `3,832` / `0`, cash flow quarter `11,664` / `0`. Latest run ID: `vnstock-mongo-742aa235e9`.
- 2026-06-07: Retried `PVM` `finance.income_statement.quarter`; retry passed with `39` rows and `0` errors. Retry run ID: `vnstock-mongo-e1e4dd0bb8`; current statement docs: income `130,669`, balance `125,756`, cash flow `130,671`.
- 2026-06-07: Final `finance-statements-phase1` slice `--symbol-source mongo-eod --offset 1200 --limit 365 --batch-size 5 --sleep-seconds 5` passed all six datasets with `0` errors: income year `4,502` rows, income quarter `13,198`, balance year `4,503`, balance quarter `12,604`, cash flow year `4,502`, cash flow quarter `13,198`. Latest run ID: `vnstock-mongo-54e5f5a1eb`.
- 2026-06-07: Financial statements refresh completed with no unresolved statement failures. Final docs/scopes: income statement `148,369` docs / `1,566` scopes; balance sheet `142,863` docs / `1,566` scopes; cash flow `148,371` docs / `1,566` scopes. OCI containers remained healthy.
- 2026-06-07: Extended `backfill_mongo_vnstock_full_catalog.py` manifest with `company.info`, `company.events`, `company.officers`, and `company.subsidiaries` using `Reference().company(symbol)` methods discovered in `vnstock_api_catalog`.
- 2026-06-07: Deployed company/reference manifest update to OCI `/srv/vnibb` and live `vnibb-api`.
- 2026-06-07: Company/reference smoke `--symbol-source mongo-eod --offset 0 --limit 20 --datasets company.info,company.events,company.officers,company.subsidiaries --batch-size 5 --sleep-seconds 5 --run-group company-reference-smoke` passed with `0` errors: `company.info` `20` rows, `company.events` `825`, `company.officers` `132`, `company.subsidiaries` `32`. Latest run ID: `vnstock-mongo-7d1ed33fb7`; Mongo totals after smoke: info `20`, events `840`, officers `16,133`, subsidiaries `5,201`.
- 2026-06-07: Company/reference slice `--symbol-source mongo-eod --offset 20 --limit 100 --batch-size 5 --sleep-seconds 5 --run-group company-reference-phase1` passed with `0` errors: `company.info` `100` rows, `company.events` `3,507`, `company.officers` `445`, `company.subsidiaries` `334`. Latest run ID: `vnstock-mongo-811de18944`; phase checkpoints: `400`; Mongo totals: info `120`, events `4,347`, officers `16,220`, subsidiaries `5,253`.
- 2026-06-07: Company/reference slice `--symbol-source mongo-eod --offset 120 --limit 200 --batch-size 5 --sleep-seconds 5 --run-group company-reference-phase1` passed with `0` errors: `company.info` `200` rows, `company.events` `7,495`, `company.officers` `1,030`, `company.subsidiaries` `494`. Latest run ID: `vnstock-mongo-d689b6a717`; phase checkpoints: `1,200`; Mongo totals: info `320`, events `11,842`, officers `16,405`, subsidiaries `5,359`.
- 2026-06-07: Company/reference slice `--symbol-source mongo-eod --offset 320 --limit 300 --batch-size 5 --sleep-seconds 5 --run-group company-reference-phase1` passed with `0` errors: `company.info` `300` rows, `company.events` `11,275`, `company.officers` `1,518`, `company.subsidiaries` `887`. Latest run ID: `vnstock-mongo-27510ecff3`; phase checkpoints: `2,400`; Mongo totals: info `620`, events `23,117`, officers `16,688`, subsidiaries `5,522`.
- 2026-06-08: Verified live OCI `vnibb-api` runtime baseline now reports `vnstock` `4.0.4` and `vnii` `0.2.4` with premium packages still available: `vnstock_data` `3.1.3`, `vnstock_news` `2.1.4`, `vnstock_ta` `1.0.3`, `vnstock_pipeline` `2.2.1`.
- 2026-06-08: Company/reference slice `--symbol-source mongo-eod --offset 620 --limit 300 --batch-size 5 --sleep-seconds 5 --run-group company-reference-phase1` passed with `0` errors: `company.info` `300` rows, `company.events` `11,302`, `company.officers` `1,469`, `company.subsidiaries` `856`. Latest run ID: `vnstock-mongo-d35720b143`; Mongo totals: info `920`, events `34,419`, officers `16,958`, subsidiaries `5,676`.
- 2026-06-08: Company/reference slice `--symbol-source mongo-eod --offset 920 --limit 300 --batch-size 5 --sleep-seconds 5 --run-group company-reference-phase1` passed with `0` errors: `company.info` `300` rows, `company.events` `11,187`, `company.officers` `1,244`, `company.subsidiaries` `921`. Latest run ID: `vnstock-mongo-8da4b95c42`; Mongo totals: info `1,220`, events `45,606`, officers `17,224`, subsidiaries `5,844`.
- 2026-06-08: Final company/reference slice `--symbol-source mongo-eod --offset 1220 --limit 400 --batch-size 5 --sleep-seconds 5 --run-group company-reference-phase1` passed with `0` errors: `company.info` `345` rows, `company.events` `12,914`, `company.officers` `1,599`, `company.subsidiaries` `1,215`. Latest run ID: `vnstock-mongo-2c832c1bee`.
- 2026-06-08: Company/reference EOD-symbol refresh completed for all `1,565` EOD symbols with `0` unresolved failures. Final docs: `company.info` `1,565`, `company.events` `58,520`, `company.officers` `17,538`, `company.subsidiaries` `6,036`. Checkpoint coverage is split across `company-reference-smoke` for the first `20` symbols and `company-reference-phase1` for the remaining `1,545` symbols.
- 2026-06-08: Extended manifest with `company.affiliate` and `company.news` using `vnstock_data.api.company.Company` only. A legacy-wrapper attempt for `company.dividends`, `company.ownership`, and `company.insider_deals` was stopped after it emitted the VNStock legacy deprecation warning. `company.capital_history` and `company.insider_deals` remain disabled because the live `vnstock_data.api.company.Company` methods raise `NotImplementedError` for the tested VCI source.
- 2026-06-08: `company.affiliate,company.news` smoke `--symbol-source mongo-eod --limit 5 --batch-size 1 --sleep-seconds 2 --run-group company-extra-smoke` passed with `0` errors: affiliate `3` rows, news `250` rows. Latest run ID: `vnstock-mongo-ced6079ec4`.
- 2026-06-08: `company.affiliate,company.news` phase slices completed for the remaining EOD universe with `0` errors. Run IDs: `vnstock-mongo-7a90be1f2a`, `vnstock-mongo-7d32c2548a`, `vnstock-mongo-95183dbcc4`, `vnstock-mongo-36a33d24a0`, `vnstock-mongo-55b6e2e1e0`.
- 2026-06-08: Verified final current Mongo totals: `market_prices_eod` `1,324,798`; `company.info` `1,565`; `company.events` `58,520`; `company.officers` `17,538`; `company.subsidiaries` `6,036`; `company.affiliate` `1,551`; `company.news` `77,504`; `reference.shareholders` `42,967`; `reference.listings` `1,532`; `finance.ratio` `149,772`; `finance.income_statement` `148,369`; `finance.balance_sheet` `142,863`; `finance.cash_flow` `148,371`.
- 2026-06-08: Created authenticated post-population Mongo backup from OCI over the private Tailscale Mongo URI using `mongo:7` tools, then copied the archive to n6v because n6v Docker API remains inaccessible over SSH. Backup file: `C:\vnibb-mongo\backup\vnibb-market-after-full-vnstock-20260607-200025.archive.gz`, size `156,395,968` bytes.
- 2026-06-08: Probed live `vnstock_data` surfaces and extended the manifest with confirmed non-legacy datasets: listing metadata, macro series, market PE/PB/evaluation, and per-symbol equity summary/session stats/foreign flow/trade history/proprietary flow. The fetchers use `vnstock_data` UI/API classes, not legacy `Vnstock().stock(...)`.
- 2026-06-08: Wrote market-scope reference/macro/valuation datasets with `0` run errors. Added `reference.listings.etf` `22`, `reference.listings.indices` `29`, `reference.listings.futures` `14`, `reference.listings.covered_warrants` `233`, `reference.listings.symbols_by_exchange` `3,243`, `reference.listings.symbols_by_group` `30`, macro datasets (`gdp` `440`, `cpi` `500`, `exchange_rate` `500`, `interest_rate` `32`, `money_supply` `498`, `fdi` `406`, `import_export` `500`, `industry_prod` `500`, `population_labor` `248`, `retail` `500`), and market valuation datasets (`pe` `1,240`, `pb` `1,240`, `evaluation` `1,240`).
- 2026-06-08: Populated all-symbol equity market datasets in five slices with `0` run errors: `equity.summary` `1,546` docs / `1,546` scopes, `equity.session_stats` `1,565` docs / `1,565` scopes, `equity.foreign_flow` `156,131` docs / `1,565` scopes, and `equity.trade_history` `156,131` docs / `1,565` scopes.
- 2026-06-08: Tested `equity.proprietary_flow`. It works only for a subset of symbols; smoke plus first broad slice wrote `6,781` docs across `182` scopes, then all-symbol continuation was stopped because many symbols do not support this endpoint. This is treated as source coverage limitation, not a full-population blocker.
- 2026-06-08: Fixed record-key generation for listing rows by including `industry_code`, `industry_name`, `exchange`, `group`, and `name`. Reran `reference.listings.symbols_by_industries`; current stored count is `650` because the first run left `25` older coarse-key records and the corrected rerun inserted the full `625` symbol/industry rows.
- 2026-06-08: Extended manifest with high-churn equity market endpoints using `Market().equity(symbol)`: `quote`, `intraday`, `trades`, `block_trades`, `price_depth`, `order_book`, `matched_by_price`, `odd_lot`, `put_through`, and `volume_profile`. Liquid-symbol smoke (`VCI,VNM,FPT`) passed with `0` errors.
- 2026-06-08: Ran high-churn all-symbol population with bounded recent/snapshot retention. `equity.quote`, `equity.price_depth`, `equity.order_book`, `equity.matched_by_price`, `equity.odd_lot`, and `equity.volume_profile` completed the EOD universe in slices after excluding unsupported broad `intraday`/`trades` continuation. Final counts/scopes: `equity.quote` `1,565` / `1,565`, `equity.price_depth` `1,516` / `1,513`, `equity.order_book` `1,516` / `1,513`, `equity.matched_by_price` `3,561` / `713`, `equity.odd_lot` `1,035` / `1,035`, `equity.volume_profile` `3,653` / `719`.
- 2026-06-08: `equity.intraday` and `equity.trades` were written only for supported/liquid subsets because the first broad slice had `84` unsupported symbols out of `150`. Current partial counts/scopes: `equity.intraday` `3,274` / `69`; `equity.trades` `3,436` / `69`. `equity.block_trades` and `equity.put_through` returned `0` rows in smoke and were not broadened.
- 2026-06-08: Probed non-equity `vnstock_data` surfaces. Confirmed and populated fund, futures, warrant reference, bond list, index, and crypto datasets. Commodity/forex/bond market calls were not broadened because probes returned HTTP 400, invalid-symbol, or not-implemented errors for tested symbols.
- 2026-06-08: Populated fund datasets for all `65` Fmarket funds. Final counts/scopes: `reference.fund.list` `65` / `1`, `fund.history` `93,145` / `65`, `fund.asset_holding` `130` / `65`, `fund.industry_holding` `975` / `65`, `fund.top_holding` `650` / `65`.
- 2026-06-08: Populated futures, warrants, bonds, indexes, and crypto. Final counts/scopes: `reference.futures.list` `16` / `1`, `reference.futures.info` `8` / `8`, `futures.summary` `8` / `8`, `futures.quote` `8` / `8`, `futures.trades` `1,181` / `7`, `futures.price_depth` `8` / `8`, `futures.order_book` `8` / `8`, `reference.warrant.list` `466` / `1`, `reference.warrant.info` `20` / `20`, `reference.bond.list` `93` / `1`, `index.summary` `29` / `29`, `index.quote` `29` / `29`, `index.trade_history` `25` / `25`, `crypto.quote` `5` / `5`, `crypto.history` `2,500` / `5`, `crypto.trades` `2,500` / `5`, `crypto.price_depth` `5` / `5`, `crypto.order_book` `5` / `5`.
- 2026-06-08: `reference.futures.list` and `reference.warrant.list` counts doubled after rerunning with corrected Series-derived symbol keys; old coarse `MARKET` rows remain alongside corrected rows. They are harmless but can be cleaned later if desired.
- 2026-06-08: Probed and populated remaining clean `vnstock_data` reference/insights/analytics datasets. Write run `remaining-vnstock-phase1` completed with `0` errors for `reference.equity.list`, `reference.etf.list`, `reference.events.calendar`, `reference.industry.list`, `reference.market.status`, `insights.screener.filter`, all seven `insights.ranking.*` views, and `analytics.valuation.pe/pb`.
- 2026-06-08: Final counts/scopes for this batch: `reference.equity.list` `1,744` / `1`, `reference.etf.list` `22` / `1`, `reference.events.calendar` `19` / `1`, `reference.industry.list` `177` / `1`, `reference.market.status` `3` / `1`, `insights.screener.filter` `10` / `1`, `insights.ranking.deal` `10` / `1`, `insights.ranking.foreign_buy` `10` / `1`, `insights.ranking.foreign_sell` `10` / `1`, `insights.ranking.gainer` `10` / `1`, `insights.ranking.loser` `10` / `1`, `insights.ranking.value` `10` / `1`, `insights.ranking.volume` `10` / `1`, `analytics.valuation.pe` `1,240` / `1`, `analytics.valuation.pb` `1,240` / `1`. `reference.events.calendar` and `reference.market.status` fetched more rows than final stored count because overlapping natural keys were upserted.
- 2026-06-08: Ran enabled-manifest coverage check after all population phases. All enabled datasets have non-zero Mongo coverage. Disabled datasets are source-empty or not implemented in the live package: `company.capital_history`, `company.insider_deals`, `equity.block_trades`, and `equity.put_through`.
