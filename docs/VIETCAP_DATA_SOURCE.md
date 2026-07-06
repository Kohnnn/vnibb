# Vietcap Data Source

Status: active (added 2026-06-11)
Owner: market-data pipeline
Canonical store: MongoDB `vnibb-market` on n6v (`<n6v-tailscale-ip>:27017`)

## Why Vietcap

Vietcap's public IQ and `trading.vietcap.com.vn` endpoints are usable without
authentication and are **not** subject to the vnstock provider quota
(~150k calls/day). They provide:

- Deeper EOD history than the KBS/vnstock path. KBS floors most symbols at
  2015; Vietcap returns full listing history (e.g. VCB to 2009-06-30,
  FPT to 2006-12-13, BVH to 2009-06-25).
- Full instrument universe (3,371 instruments: stocks, ETFs, CW, futures, bonds).
- Analyst-grade financial statements with a code->label mapping endpoint.
- Pre-computed financial ratios.
- Company master data, sector (ICB) classification, analyst ratings and target prices.
- Shareholder structure.
- Index/group membership.

Reverse-engineering reference:
`docs/reverse-engineering/vietcap-iq-endpoint/vci_endpoint_evaluation_report.md`.

## Source precedence (Vietcap is primary)

Vietcap is the PRIMARY market-data source. vnstock remains the daily-refresh
fallback for symbols/days Vietcap does not cover.

Critical detail: the runtime EOD read path
(`MongoMarketDataService.get_eod_prices*`) filters only on `(symbol, tradeDate)`
and **ignores `source`**. The upsert key is `(symbol, tradeDate, source)`.
Therefore, if both a `vietcap` and a `vnstock-data` row exist for the same day,
reads would double-count that bar.

The backfill resolves this with a reconciliation step (`--reconcile`): for every
`(symbol, tradeDate)` that has a `vietcap` bar, any non-`vietcap` bar for the
same symbol/day is deleted. This makes "Vietcap corrects/overrides vnstock"
literal and guarantees exactly one bar per trading day.

Pre-2015 dates (which vnstock never had) are inserted as new `vietcap` rows.

## Units

Prices are stored as **raw VND** exactly as Vietcap returns them
(e.g. VCB close `61600.0`). Each Vietcap price doc carries `priceUnit: "VND"`.

The legacy `vnstock-data` rows are in **thousand VND** (the vnstock convention,
see `apps/api/vnibb/services/fundamental_valuation.py`). The agreed convention
going forward: when the vnstock path needs parity with Vietcap, it multiplies by
1000. The backfill does **not** rescale Vietcap data.

Because the same `market_prices_eod` collection now mixes a thousand-VND legacy
floor (older non-reconciled symbols) with raw-VND Vietcap rows, run `--reconcile`
whenever you apply OHLC so a symbol's bars are single-sourced. A fully
reconciled symbol is 100% `vietcap` and therefore 100% raw VND.

## Endpoints used

Market data (`https://trading.vietcap.com.vn`):

| Purpose | Endpoint |
|---|---|
| Instrument universe | `GET /api/price/symbols/getAll` |
| Group / index members | `GET /api/price/symbols/getByGroup?group={GROUP}` |
| EOD OHLC history | `POST /api/chart/OHLCChart/gap-chart` (one symbol, `countBack:10000`) |

Company / fundamentals (`https://iq.vietcap.com.vn/api/iq-insight-service`):

| Purpose | Endpoint |
|---|---|
| Company search universe | `GET /v2/company/search-bar?language=1` |
| ICB sector dictionary | `GET /v1/sectors/icb-codes` |
| Market indices | `GET /v1/market-indices` |
| Company details | `GET /v1/company/details?ticker={SYMBOL}` |
| Shareholder structure | `GET /v1/company/{SYMBOL}/shareholder-structure` |
| Financial metric map | `GET /v1/company/{SYMBOL}/financial-statement/metrics` |
| Financial statement | `GET /v1/company/{SYMBOL}/financial-statement?section={SECTION}` |
| Financial ratios | `GET /v1/company/{SYMBOL}/statistics-financial` |

`SECTION` in `{INCOME_STATEMENT, BALANCE_SHEET, CASH_FLOW}`. The `RATIO` section
returns null for some symbols; use `statistics-financial` instead.

## Safe-usage limits

The client (`scripts/vietcap/vietcap_client.py`) enforces:

- ~1 request/second global throttle
- exponential backoff on 403 / 429 / 5xx
- circuit breaker after repeated consecutive failures
- browser-like UA + referer/origin headers

No auth is used. Per the evaluation, a bearer token adds nothing for these
market/fundamental endpoints.

## Collections written

See `DATABASE_SCHEMA.md` for full attribute tables. Summary:

| Collection | Content | Identity |
|---|---|---|
| `market_prices_eod` | EOD OHLCV for stocks + ETFs + indices (raw VND) | `(symbol, tradeDate, source)` |
| `market_prices_cw` | EOD OHLCV for covered warrants | `(symbol, tradeDate, source)` unique |
| `market_prices_derivatives` | EOD OHLCV for futures (`FU`) | `(symbol, tradeDate, source)` unique |
| `market_prices_bond` | EOD OHLCV for bonds/debentures | `(symbol, tradeDate, source)` unique |
| `market_vnstock_premium_records` | financial statements, ratios, shareholder structure | `(dataset, symbol, recordKey)` unique |
| `market_financial_metric_map` | code->label map per `(comTypeCode, section)` | `(comTypeCode, section, source)` unique |
| `market_company_profiles` | company master + analyst (details + search-bar) | `(symbol, source)` unique |
| `market_index_constituents` | index/group membership | `(group, source)` unique |
| `market_icb_sectors` | ICB sector dictionary | `(icbCode, source)` unique |

CW, futures, and bonds are deliberately kept out of `market_prices_eod` so the
canonical stock corpus stays clean for quant/screener reads.

## Decoding coded financial fields

Financial statement rows store the raw Vietcap document, where line items are
coded (`isa20` = profit after tax, `bsa53` = total assets, etc.). The decode
map lives in `market_financial_metric_map`, keyed by `comTypeCode` and `section`.
Join `market_vnstock_premium_records.raw[<field>]` against
`market_financial_metric_map.labels[<field>]` to get EN/VI labels.

Validated example (BVH, comTypeCode `IN` insurance):

- `isa16` (Profit before tax) FY2025 = `3,554,431,272,129`
- `isa20` (Profit after tax) FY2025 = `2,921,571,759,353`

These match the reverse-engineering report exactly.

## Running the backfill

Standalone scripts live in `apps/api/scripts/vietcap/`:

- `vietcap_client.py` — polite read-only HTTP client
- `vietcap_writers.py` — Mongo upsert writers + reconciliation
- `backfill_vietcap.py` — CLI orchestrator (dry-run by default)

Dry-run a few symbols (no writes):

```bash
python apps/api/scripts/vietcap/backfill_vietcap.py \
  --symbols VCB,BVH,FPT \
  --datasets ohlc,financials,ratios,company,shareholders
```

Apply with index creation and source reconciliation:

```bash
python apps/api/scripts/vietcap/backfill_vietcap.py \
  --symbols VCB,BVH,FPT \
  --datasets ohlc,financials,ratios,company,shareholders \
  --apply --ensure-indexes --reconcile
```

Universe selectors for `--symbols`:

- `ALL` — every instrument from `getAll`
- `STOCK` / `CW` / `FU` / `BOND` / `ETF` — filter by instrument type
- comma list (e.g. `VCB,SSI,FPT`)

Universe-level datasets (run once, ignore `--symbols`):

```bash
python apps/api/scripts/vietcap/backfill_vietcap.py --datasets indices,icb --apply --ensure-indexes
```

Always pair OHLC `--apply` with `--reconcile` to keep one bar per day.

## Full-universe rollout (recommended order)

1. `--datasets indices,icb --apply --ensure-indexes` (cheap, once)
2. `--symbols STOCK --datasets ohlc,financials,ratios,company,shareholders --apply --reconcile`
3. `--symbols ETF --datasets ohlc --apply --reconcile`
4. `--symbols CW --datasets ohlc --apply` (lands in `market_prices_cw`)
5. `--symbols FU --datasets ohlc --apply` (lands in `market_prices_derivatives`)
6. `--symbols BOND --datasets ohlc --apply` (lands in `market_prices_bond`)

At ~1 req/s with ~6 calls/stock for the full dataset, the full 1,744-stock pass
is multi-hour; run it in batches and resume by symbol slice. The script is
idempotent (upserts), so reruns are safe.

## Backup before large applies

Per `ops/n6v-stack/README.md`, take a `mongodump` archive on n6v before a large
write window:

```powershell
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
docker exec vnibb-mongo mongodump --uri="$MongoDumpUri" --archive --gzip > "C:\vnibb-mongo\backup\vnibb-market-$stamp.archive.gz"
```

## Ongoing maintenance

As of 2026-06-13, the scheduled Mongo EOD writer
(`MongoMarketDataService.bulk_upsert_eod_prices`) is Vietcap-aware:

1. It skips any vnstock daily bar where a `vietcap` row already exists for the
   same `(symbol, tradeDate)`, preventing duplicate bars.
2. It converts vnstock's thousand-VND OHLC values to raw VND before writing and
   marks rows with `priceUnit: "VND"` and `rescaledFromThousandVnd: true`.

The standalone maintenance pass remains as an ops repair tool after manual
imports, interrupted backfills, or older scheduler runs:

```bash
python apps/api/scripts/vietcap/maintain_vietcap_corpus.py --apply
```

It does two idempotent things:

1. Rescales any `vnstock-data` rows still in thousand-VND to raw VND
   (×1000, marked `rescaledFromThousandVnd: true`, `priceUnit: "VND"`). Rows
   already carrying `priceUnit: "VND"` are skipped, so it never double-scales.
2. Reconciles overlaps: for any `(symbol, tradeDate)` with a `vietcap` bar, it
   deletes the duplicate non-`vietcap` bar (archived first).

It should normally report zero pending changes after the fixed scheduler has
been deployed.

## Rollback

Deletions are reversible. The reconcile and cleanup steps archive the exact
deleted documents (with original `_id`) into:

- `market_prices_eod_reconcile_archive` (reconcile overrides)
- `market_prices_eod_cleanup_archive` (close<=0 cleanup)

Re-insert from an archive to restore.

## Relationship to other stacks

- MongoDB `vnibb-market` (n6v) is the canonical analytical/market corpus and the
  only target for this backfill.
- Supabase remains the SQL/auth/app-state platform; not written here.
- Appwrite writes stay frozen (`APPWRITE_WRITE_ENABLED=false`). A future
  controlled mirror can project these collections into the 26-collection Appwrite
  model; see the mapping table in `DATABASE_SCHEMA.md`.
