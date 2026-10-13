# Vietcap Backfill Scripts

Bounded public Vietcap IQ/trading ingestion into MongoDB `vnibb-market`. Vietcap is primary; only free vnstock VCI is an eligible fallback. VCI uses the same upstream and is not an independent outage fallback.

## Quick start

Run from `vnibb/apps/api`; dry-run fetches data but writes nothing:

```bash
python scripts/vietcap/backfill_vietcap.py --symbols VCB,BVH,FPT --limit 3 \
  --datasets financials,company,listing
```

Apply the same bounded slice (requires `MONGODB_URL`):

```bash
python scripts/vietcap/backfill_vietcap.py --symbols VCB,BVH,FPT --limit 3 \
  --datasets financials,company,listing --apply
```

Rerunning the same slice upserts the existing natural keys. Apply also awaits descriptor-supported financial persistence through the existing cache/database bridge. Unsupported fields remain unavailable; raw data remains preserved. Neither command deletes, reconciles, rescales, or repairs existing data.

## Flags

| Flag | Meaning |
|---|---|
| `--symbols` | `ALL`, an instrument type, or comma-separated symbols |
| `--datasets` | `ohlc,financials,ratios,company,shareholders,listing,indices,icb` or `all`; unknown names are rejected |
| `--limit` | Maximum selected symbols; zero means no cap |
| `--count-back` | Positive OHLC history bound; default 10000 |
| `--apply` | Enable upserts; default is dry-run |
| `--ensure-indexes` | Create supporting indexes during apply; existing data is retained |
| `--skip-fresh-through` | Skip OHLC already reaching the specified YYYY-MM-DD; other datasets still run |

`financials` includes all three statement sections plus raw ratios. `listing` (singular) joins selected trading instrument metadata with IQ search metadata under `reference.listings`. Dry-run reports supported structured fields and unavailable groups without requiring SQL admission. Apply preserves raw rows and returns status 1 when a requested structured group has no supported fields; reachable groups still persist. Any caught error or unavailable requested raw data also returns status 1. Invalid flags/datasets return status 2. All apply persistence shares one event loop; the database engine is disposed before that loop closes.

## Financial contract

- Runtime implementations live in `vnibb/services/vietcap_client.py` and `vnibb/services/vietcap_ingestion.py`; recurring ingestion and this CLI reuse them.
- Annual/quarter variants are `{dataset}.year` and `{dataset}.quarter`. Existing financial `recordKey` and dataset/symbol/key upsert filters remain unchanged.
- Company classification comes from the actual symbol's IQ `comTypeCode`, never its trading instrument type. Missing classification stays unknown.
- Descriptors are fetched once per symbol and retained as original section lists, including hierarchy, repeated fields, nulls and unknown properties. The existing metric-map natural key is retained with lossless `symbolDescriptors` evidence per symbol.
- `observedAt` and `receivedAt` are receipt timestamps, not fabricated fiscal publication dates. `rawFiscalBasis` retains supplied fiscal/basis fields; parsed `publicDate` is preserved as `sourceDate`.
- Statement and ratio values stay raw. Units are unknown unless actual payload/descriptor evidence establishes them. No magnitude-based scaling or guessed metric mapping is allowed.
- Structured fields require the symbol/section descriptor evidence consumed by `vietcap_financials`; unsupported units, labels or ambiguous fields remain unavailable.
- IQ application failures, including `successful=false`, raise even on HTTP 200. Required OHLC arrays must have equal lengths.
- `sourceResponse` preserves the original IQ status/code/success/trace metadata; descriptor response metadata is retained separately in `descriptorEvidence.sourceResponse`.
- Equity/ETF/warrant endpoint prices retain source-backed VND units; indices/futures retain points. Unsupported instrument units remain unknown and prevent numerical ingestion claims.
- Apply bridges confirmed stock OHLC to the existing PostgreSQL price store and reports `structured_price_rows`. Financial/source conflicts retain raw Mongo records, report partial committed counts and conflicting natural keys, and return nonzero rather than overwrite non-IQ SQL data.
- Listing upserts run before dependent stock prices. An applied stock OHLC slice also fetches and persists its bounded IQ/trading listing prerequisite when `listing` is not explicitly selected, so a first-run database can admit those prices.

An applied stock OHLC slice reports its admission outcome under `price_admission`: `source_rows`, `admitted_rows`, `rejected_rows`, `rejected_reasons` (for example `invalid_ohlc_bounds`, `missing_negative_or_nonfinite_ohlcv`, `noninteger_volume`, `invalid_date`), `persisted_rows` and the actual admitted/persisted first/last bounds, plus a `classification`. A mixed window is `partial_source_invalid` and the pair is still receipted `failed` behind a strict guard that requires the full returned window to reach SQL (`Returned OHLC window incomplete: <rejected> source rows unadmitted; <persisted>/<returned> SQL rows persisted`); a rejected SQL conflict instead classifies `sql_source_conflict` with `conflicting_keys` and also returns nonzero. A real new-process apply observed this end to end: AAA returned 4,049 source rows, persisted 4,048, and rejected exactly one `invalid_ohlc_bounds` row as `partial_source_invalid`. Rejections are source-invalid rows, not writer loss: every raw Mongo row is retained unrepaired, `history_complete` stays `null`, and re-running `resume` under the same contract retries the pair rather than silently certifying a short window.

## Archived maintenance

`maintain_vietcap_corpus.py` and maintenance functions remain archived for separate controlled operations. The backfill CLI has no destructive reconciliation option or maintenance call path. Do not run maintenance as part of ingestion.

## Read-only coverage inventory

Run from `apps/api`, supplying an already captured Trading `getAll` response (JSON list or an object with `instruments`/`data`). No universe/provider request is repeated:

```bash
python scripts/verify_database.py --inventory --universe-json /path/to/universe.json \
  --env-file /home/compute_01/.config/vnibb/data.local.env
python scripts/verify_database_selfcheck.py
```

The opt-in JSON report separates physical SQL and Mongo datasets, stock-type/currently-listed/active-SQL universes, expected/present/missing symbols, retained time/fiscal-period bounds, SQL null/nonnull/descriptor-unit-admitted fields, and raw Mongo admission-unavailable reasons. It discovers the current premium allowlist without importing MCP or invoking providers. SQL statements run in a rolled-back read-only transaction; Mongo uses only read queries. Missing collections/tables are `unavailable`, not failed reads or proof of full-session replay. Query failures return a sanitized exception type and exit 1; valid empty/unavailable inventories return 0. No payloads, credentials or database URLs are printed.

Refresh/history declarations cite existing ingestion owners; unknown scopes remain explicit rather than inventing a symbol denominator. SQL flows, SQL ticks, Mongo raw ticks, typed ticks and depth are separate inventories. Bounds and ingestion times are not exchange-session completeness or source freshness. IQ field admission uses retained scoped descriptors/unit evidence; free VCI and legacy fields remain counted but unverified by this inventory. QA contract IDs refer to the authoritative #111 extension index; inventory does not certify ticket outcomes or authenticated Matrix acceptance. The legacy no-argument invocation remains unchanged, including its VCI connectivity call; use `--inventory` for provider-free operation. Neither command above was executed during this change.


## Regression check

Not executed during this change:

```bash
python -m pytest tests/test_api/test_vietcap_backfill.py -q
```
