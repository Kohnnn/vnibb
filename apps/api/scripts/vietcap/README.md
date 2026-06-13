# Vietcap Backfill Scripts

Standalone, read-only ingestion of public Vietcap data into the canonical
MongoDB `vnibb-market` corpus on n6v. Vietcap is the PRIMARY market-data source.

Full data contract and rollout guide: `vnibb/docs/VIETCAP_DATA_SOURCE.md`.

## Files

- `vietcap_client.py` — polite read-only HTTP client (1 req/s, backoff, breaker).
- `vietcap_writers.py` — Mongo upsert writers + source reconciliation.
- `backfill_vietcap.py` — CLI orchestrator. Dry-run by default; `--apply` writes.
- `maintain_vietcap_corpus.py` — ops repair pass that rescales legacy vnstock
  tail rows and re-runs overlap reconciliation when needed.

## Quick start

Dry-run (no writes):

```bash
python backfill_vietcap.py --symbols VCB,BVH,FPT \
  --datasets ohlc,financials,ratios,company,shareholders
```

Apply with reconciliation (Vietcap overrides overlapping vnstock bars):

```bash
python backfill_vietcap.py --symbols VCB,BVH,FPT \
  --datasets ohlc,financials,ratios,company,shareholders \
  --apply --ensure-indexes --reconcile
```

Universe-level reference data (run once):

```bash
python backfill_vietcap.py --datasets indices,icb --apply --ensure-indexes
```

## Flags

| Flag | Meaning |
|---|---|
| `--symbols` | `ALL`, an instrument type (`STOCK`/`CW`/`FU`/`BOND`/`ETF`), or comma list |
| `--datasets` | any of `ohlc,financials,ratios,company,shareholders,indices,icb` or `all` |
| `--count-back` | OHLC bars to request per symbol (default 10000 = full history) |
| `--apply` | write to Mongo (default is dry-run) |
| `--ensure-indexes` | create supporting indexes (tolerates existing ones) |
| `--reconcile` | after OHLC apply, drop overlapping `vnstock-data` bars |
| `--limit` | cap symbol count (0 = no cap) |

## Rules

- Always pair OHLC `--apply` with `--reconcile` (reads ignore `source`; one bar/day).
- Prices are stored raw VND. The scheduled Mongo EOD writer now converts new
  vnstock fallback rows from thousand-VND to raw VND and skips rows where a
  Vietcap bar already exists.
- Requires `MONGODB_URL` (+ `MONGODB_DATABASE`, default `vnibb-market`) in the
  workspace `.env`. Take a `mongodump` backup before large applies.
- Idempotent: reruns upsert, safe to resume by symbol slice.
