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

## Archived maintenance

`maintain_vietcap_corpus.py` and maintenance functions remain archived for separate controlled operations. The backfill CLI has no destructive reconciliation option or maintenance call path. Do not run maintenance as part of ingestion.

## Regression check

Not executed during this change:

```bash
python -m pytest tests/test_api/test_vietcap_backfill.py -q
```
