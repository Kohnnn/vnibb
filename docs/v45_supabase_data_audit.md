# V45 Supabase Data Audit + Repair

Date: 2026-02-16

## Scope

- Audited Supabase production project: `cbatjktmwtbhelgtweoi`.
- Focused on data completeness for:
  - financial statements (`income_statements`, `balance_sheets`, `cash_flows`)
  - fundamentals (`financial_ratios`, `screener_snapshots` market cap/industry)
  - company profile metadata (`companies`)
- Ran repair jobs from local backend scripts against production DB.

## Baseline vs Current (Global)

Initial baseline (before this pass) had major gaps in fundamentals/profile data, including near-zero usable market cap and industry coverage in screener snapshots.

Current snapshot after repair:

- `stocks_total`: 1738
- `price_symbols`: 1647
- `income_symbols`: 1738
- `balance_symbols`: 1738
- `cash_symbols`: 1738
- `ratio_symbols`: 1736
- `latest_screener_symbols`: 1737
- `latest_with_market_cap`: 1047
- `latest_with_industry`: 530
- `companies_with_name`: 1700
- `companies_with_outstanding`: 1544
- `companies_with_industry`: 694
- `companies_with_exchange`: 1727

## Liquidity Universe Coverage

### Top 500 (by liquidity)

- Statements: 500/500 (income/balance/cash)
- Ratios: 500/500
- Screener market cap: 495/500
- Screener industry: 317/500
- Company names: 497/500
- Company outstanding shares: 495/500

### Broad universe (up to 1700, effectively 1647 symbols with price history)

- Statements: 1647/1647 (income/balance/cash)
- Ratios: 1646/1647 (`DVT` remains missing ratio periods from provider)
- Screener market cap: 836/1647
- Screener industry: 492/1647

### Full active universe (1738 symbols)

- Statements: 1738/1738 (income/balance/cash)
- Ratios: 1736/1738 (`BLU`, `DVT` still missing valid ratio periods from provider)
- Latest screener rows with market cap: 1047/1737
- Latest screener rows with industry: 530/1737

### Continuation pass (same date, later execution)

- Re-audited ratio quality using usable-metric detection (not raw row presence only).
- Usable ratios corrected from `1144/1738` to `1736/1738` after two targeted ratio repair passes.
- Ran latest-snapshot enrichment update in production to backfill screener metadata from:
  - `companies` (`company_name`, `exchange`, `industry`, shares)
  - `stocks` (`company_name`, `exchange`, `industry`)
  - latest `stock_prices` (`price`, `volume`)
- Post-enrichment active-universe screener quality:
  - company name: `1710/1738`
  - exchange: `1738/1738`
  - industry: `700/1738`
  - price: `1647/1738`
  - market cap: `1636/1738`

## Key Findings

1. Financial statement coverage is now complete across all active symbols, and ratio coverage is near-complete.
2. Main remaining gap is metadata quality from upstream feeds:
   - Screener `industry` sparsity remains high.
   - Screener `market_cap` still missing for many long-tail symbols.
3. Company profiles are substantially improved, but a long-tail subset still has missing fundamentals (name/outstanding/industry) from provider response.
4. Top symbols (VNM/FPT/VCB/HPG/VIC) now have populated statements + fundamentals (market cap, shares-derived metrics, industry).

## Repairs Applied in Code

- `apps/api/vnibb/services/data_pipeline.py`
  - Stock-list sync now enriches `exchange`/`industry` from `Listing.symbols_by_exchange()` and `Listing.symbols_by_industries()`.
  - Screener sync now merges metadata from `stocks`, `companies`, listing maps, and previous snapshots.
  - Screener `market_cap` can be derived from `company.outstanding_shares * price` when direct field is absent.
  - Screener sync now keeps fallback metadata write path active even when ratio snapshot fetch fails.
  - Screener sync now uses latest 1D price/volume from `stock_prices` as fallback for missing price fields.
  - Screener market-cap derivation now uses `outstanding_shares`, then `listed_shares`, then `shares_outstanding`.
  - Company profile sync now merges `company.overview()` + `company.profile()` fields, persists richer metadata, and updates `stocks` classification fields.
- `apps/api/scripts/v45_supabase_repair.py`
  - Added audit+repair runner with targeted repair modes.
  - Added scoped screener repair using only symbols missing screener market cap/industry.
  - Coverage now uses latest snapshot per symbol (not only global max date), preventing false regressions after partial refreshes.
  - Added ratio quality checks for usable metrics and valid periods (`with_financial_ratios_raw` vs `with_financial_ratios_usable`).

## Evidence Artifacts

- `apps/api/scripts/v45_supabase_audit_before.json`
- `apps/api/scripts/v45_supabase_repair_run.json`
- `apps/api/scripts/v45_supabase_repair_followup.json`
- `apps/api/scripts/v45_supabase_repair_fullpass.json`
- `apps/api/scripts/v45_supabase_repair_top350.json`
- `apps/api/scripts/v45_supabase_repair_top350_ratios.json`
- `apps/api/scripts/v45_supabase_audit_top500_before.json`
- `apps/api/scripts/v45_supabase_audit_top1000_before.json`
- `apps/api/scripts/v45_supabase_audit_top1000_afterfix.json`
- `apps/api/scripts/v45_supabase_audit_top1700.json`
- `apps/api/scripts/v45_supabase_repair_top1700_pass1.json`
- `apps/api/scripts/v45_supabase_audit_top1700_after_pass2_timeout.json`
- `apps/api/scripts/v45_supabase_repair_top1700_targeted_small.json`
- `apps/api/scripts/v45_supabase_repair_top1700_profile_screener_pass.json`
- `apps/api/scripts/v45_supabase_audit_active_all_before.json`
- `apps/api/scripts/v45_supabase_audit_active_all_after_pass1_timeout.json`
- `apps/api/scripts/v45_supabase_repair_active_ratio_last.json`
- `apps/api/scripts/v45_supabase_audit_active_all_recheck_usable.json`
- `apps/api/scripts/v45_supabase_repair_active_usable_ratios_pass1.json`
- `apps/api/scripts/v45_supabase_repair_active_usable_ratios_pass2.json`
- `apps/api/scripts/v45_supabase_audit_active_all_after_screener_partial.json`
- `apps/api/scripts/v45_supabase_repair_active_screener_pass2_enriched.json`
- `apps/api/scripts/v45_supabase_audit_active_all_final_enriched.json`

## Recommended Next Operations

1. Schedule daily targeted repair for metadata-heavy gaps:
   - `--sync-profiles --sync-screener` over top-liquidity universe.
2. Keep weekly broad financial refresh to guard against provider drift:
   - `--sync-financials --sync-ratios` on top-1700 universe.
3. Add a backend dashboard alert if any of these drop below thresholds:
   - statements < 99% for priced symbols,
   - ratios < 99% for priced symbols,
   - screener market cap < 70% for priced symbols.
