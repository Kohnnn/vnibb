# V38 Data Repair Playbook

This playbook documents the local-first repair flow added for Sprint V38 to address:
- missing financial statements for important symbols,
- sparse/nullable screener snapshot fields (`company_name`, `price`, `market_cap`),
- repeatable auditing for data completeness checks.

## What Changed

- Updated `apps/api/vnibb/services/data_pipeline.py`:
  - `sync_financials(...)` now uses `VnstockFinancialsFetcher` (handles modern row-based vnstock layouts).
  - `sync_screener_data(...)` now supports optional `symbols`, `exchanges`, and `limit` filters.
  - `sync_screener_data(...)` now enriches screener rows with fallback metadata (`company_name`, `exchange`, `industry`, `price`, `volume`, `market_cap`) from:
    1. current ratio payload,
    2. `stocks` table metadata,
    3. vnstock listing metadata,
    4. previous screener snapshot values.

- Added `apps/api/scripts/v38_data_audit.py`:
  - repeatable quality audit for active-symbol coverage,
  - 5Y threshold comparison (`1825`, `1820`, etc.),
  - screener null-field health checks,
  - top-symbol diagnostics and severe missing-score distribution.

- Added `apps/api/scripts/v38_repair_data_gaps.py`:
  - targeted repair runner for top symbols,
  - orchestrates profiles + financials + ratios + screener refresh,
  - optional news/events and quarterly toggles,
  - post-repair symbol-level audit summary.

## Recommended Run Order

Run from repo root (`vnibb/`):

```bash
python apps/api/scripts/v38_data_audit.py --output-json apps/api/scripts/v38_before_audit.json
python apps/api/scripts/v38_repair_data_gaps.py --symbols VNM,FPT,VCB,HPG,VIC,MSN,VHM,VRE,BVH,TCB --output-json apps/api/scripts/v38_repair_report.json
python apps/api/scripts/v38_data_audit.py --output-json apps/api/scripts/v38_after_audit.json
```

Optional broader screener refresh:

```bash
python apps/api/scripts/v38_repair_data_gaps.py --screener-scope all --screener-limit 400 --output-json apps/api/scripts/v38_repair_all_400.json
```

## Expected Validation Signals

- `v38_repair_report.json` shows non-zero step counts for financial and screener sync steps.
- Top symbols (`VNM`, `HPG`, `MSN`, `VHM`) should have non-zero rows in:
  - `income_statements`,
  - `balance_sheets`,
  - `cash_flows`.
- Screener latest snapshot should reduce nulls in:
  - `company_name`,
  - `price`,
  - `market_cap`.

## Notes

- Scripts fail fast with a clear error if DB is unreachable.
- This workflow is local-first and does not redeploy by default.
