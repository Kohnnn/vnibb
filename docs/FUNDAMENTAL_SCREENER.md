# Computed Fundamental Screener Layer

Status tracker + contracts for the derived valuation/quality layer. Agents and humans: update the Progress table as work lands.

## Objective

Compute valuation + quality fields (intrinsic value, margin of safety, moat, dividend streak, FCF flag, growth CAGRs) from data already in Mongo (`market_vnstock_premium_records`, `market_prices_eod`), store snapshots in a new `market_fundamental_screener` collection, and serve them through `/api/v1/screener`. No runtime dependency on any third-party screener; all values computed from our own corpus.

## Progress

| # | Deliverable | Owner | Status |
|---|-------------|-------|--------|
| 1 | Valuation engine `apps/api/vnibb/services/fundamental_valuation.py` + unit tests | Agent A | pending |
| 2 | Backfill script `apps/api/scripts/build_fundamental_screener.py` | Agent B | pending |
| 3 | Endpoint extension `apps/api/vnibb/api/v1/screener.py` + `ScreenerData` fields | Agent C | pending |
| 4 | VN30 backfill run + end-to-end verification | main | pending |
| 5 | ruff + pytest gate | main | pending |

## Mongo collection: `market_fundamental_screener`

One doc per `{symbol, snapshotDate}` (upsert, idempotent). Flat fields for queryability:

```jsonc
{
  "symbol": "VNM",
  "snapshotDate": "2026-06-10",          // YYYY-MM-DD string
  "source": "vnibb-fundamental-engine",
  "schemaVersion": 1,
  "observedAt": ISODate, "updatedAt": ISODate,

  // read-through fields
  "companyName": "...", "exchange": "HOSE", "industry": "...",
  "price": 65000.0, "volume": 1234567.0, "marketCap": 1.36e14,
  "pe": 15.2, "pb": 4.1, "ps": 3.3, "evEbitda": 11.0,

  // computed fields (ratios as percent where competitor uses percent)
  "roe": 28.1, "roa": 19.5, "netMargin": 15.4, "debtToEquity": 0.42,
  "revenueCagr5y": 4.2, "profitCagr5y": 1.8,
  "dividendYield": 5.1, "dividendYears": 9, "fcfPositive": true,

  // valuation
  "intrinsicValue": 78200.0,             // VND per share
  "marginOfSafety": 16.9,                // percent, clamped to [-100, 100]
  "valuationMethod": "dcf",              // "dcf" | "rim" | null
  "moat": "narrow",                      // "wide" | "narrow" | "none" | "eroding" | null

  // provenance — every IV must be explainable
  "inputs": {
    "periodsUsed": [2021, 2022, 2023, 2024, 2025],
    "discountRate": 0.12, "terminalGrowth": 0.03,
    "baseFcf": 1.0e13, "growthRate": 0.05, "horizonYears": 10
  },
  "computedFields": ["roe", "roa", "..."]
}
```

Index: `{symbol: 1, snapshotDate: -1}` unique. Created by the backfill script.

## Valuation engine contract (`fundamental_valuation.py`)

Pure functions over dataclasses; no I/O except the loader.

```python
@dataclass
class FundamentalInputs:
    symbol: str
    sector: str | None              # from company.info / reference.listings
    industry: str | None
    price: float | None             # latest close, VND
    shares_outstanding: float | None
    market_cap: float | None
    ratios: dict[str, Any]          # latest finance.ratio year row (raw)
    income_statements: list[dict]   # annual, deduped by year, ascending
    balance_sheets: list[dict]
    cash_flows: list[dict]

async def load_fundamental_inputs(symbol: str, svc: MongoMarketDataService) -> FundamentalInputs
    # datasets: finance.income_statement / finance.balance_sheet / finance.cash_flow /
    # finance.ratio / company.info / reference.listings, via get_raw_dataset_records.
    # MUST dedup by (symbol, yearReport/period) keeping newest observedAt; sort ascending.
    # Price/market cap from get_eod_prices(limit small) + shares.

@dataclass
class FundamentalSnapshot:   # mirrors the Mongo doc computed fields, plus inputs provenance
    ...

def compute_fundamental_snapshot(inputs: FundamentalInputs, config: ValuationConfig | None = None) -> FundamentalSnapshot
```

Derivations (annual statements, latest year as TTM proxy):

- `roe` = NPAT / avg(equity_t, equity_t-1); `roa` = NPAT / avg total assets — percent.
- `netMargin` = NPAT / revenue (percent); `debtToEquity` = total liabilities / owners' equity (ratio).
- `revenueCagr5y` / `profitCagr5y` = CAGR over up to 5 most recent annual periods (need >= 3 periods, else null; guard sign flips: null if endpoint values have opposite signs or base <= 0).
- `dividendYield` = abs(dividends_paid from cash flow) / market_cap * 100, fallback to ratio row's dividend field.
- `dividendYears` = consecutive most-recent years with dividends_paid < 0 (cash outflow convention).
- `fcfPositive` = (operating CF − |capex|) > 0 for latest year.

Intrinsic value:

- Financials (bank/insurance/securities, detected from sector/industry strings, e.g. "Ngân hàng", "Bảo hiểm", "Chứng khoán", "Bank", "Insurance", "Financial Services") → **RIM**: IV/share = BVPS + Σ_{t=1..H} BVPS·(ROE − r)·(1+g)^{t-1}/(1+r)^t, ROE faded toward r over horizon.
- Everyone else → **FCFE DCF**: base FCF = avg of last up-to-3 years of (OCF − |capex|); growth = clamp(historical profit/revenue CAGR, [0, 0.15]) fading linearly to terminal 3% over 10y; Gordon terminal value; equity value / shares = IV per share.
- Discount rates from `ValuationConfig` (dataclass, documented defaults): base 12%, financials 13%, tunable per sector. No magic numbers inline.
- `marginOfSafety` = (IV − price) / IV × 100, clamped to [−100, 100]; null if IV or price missing/<= 0.

Moat heuristic (model-derived, must be labeled as such in API docs/description):

- `wide`: ROE ≥ 15% in ≥ 4 of last 5 years AND net margin ≥ 10% latest AND margin trend not declining > 20% relative over 5y.
- `narrow`: ROE ≥ 10% in ≥ 3 of last 5 years AND net margin ≥ 5%.
- `eroding`: was narrow/wide on first 3 of 5 years but latest-year ROE < 60% of 5y peak.
- else `none`; null if < 3 annual periods.

## Backfill script contract (`build_fundamental_screener.py`)

- Args: `--symbols VNM,FPT`, `--symbols-group VN30|VN100|ALL` (resolve via existing group helpers or `reference.listings` records; ALL = distinct symbols in `market_vnstock_premium_records`), `--snapshot-date YYYY-MM-DD` (default today), `--dry-run`, `--limit N`.
- Env loading: same pattern as sibling scripts (`MONGODB_URL`, `MONGODB_DATABASE` default `vnibb-market`), workspace `.env` via dotenv if present.
- Per symbol: `load_fundamental_inputs` → `compute_fundamental_snapshot` → upsert doc. Errors collected, not fatal. Idempotent re-runs.
- Ensures the unique index exists. Prints JSON summary: `{succeeded, failed, ivCoverage, moatCoverage, mosCoverage, errors: [...]}`.

## Endpoint contract (`/api/v1/screener`)

- New query params (all optional, backward compatible): `moat` (csv of labels), `margin_of_safety_min`, `margin_of_safety_max`, `dividend_years_min`, `fcf_positive` (bool), plus `include_fundamental` (bool, default true when any of these filters present, else merge is best-effort/cheap).
- New optional `ScreenerData` fields (providers/vnstock/equity_screener.py): `intrinsic_value` (alias `intrinsicValue`), `margin_of_safety` (alias `marginOfSafety`), `moat`, `dividend_years` (alias `dividendYears`), `fcf_positive` (alias `fcfPositive`), `valuation_method` (alias `valuationMethod`), `fundamental_as_of` (alias `fundamentalAsOf`).
- Merge: read latest snapshot per symbol from `market_fundamental_screener` (one query, `$sort snapshotDate desc` + group or distinct-on equivalent), attach onto rows after existing hydration; filters applied post-merge. Mongo down/empty → fields null, no errors.
- Field descriptions must mark `moat` and `intrinsicValue` as model-derived reference estimates (method + as-of), not advice.

## Validation

- Unit tests: `apps/api/tests/test_services/test_fundamental_valuation.py` — synthetic statements covering DCF, RIM, CAGR guards, dividend streak, moat tiers, MoS clamping, missing-data nulls.
- Gate: `python -m ruff check apps/api` and targeted pytest.
- E2E: backfill VN30 → hit `/api/v1/screener?fcf_positive=true&margin_of_safety_min=0` → confirm new columns.

## Notes / risks

- `market_vnstock_premium_records` has duplicate period rows (VNM 142 → ~71 after dedup) — loader dedup is mandatory.
- Discount rates drive IV: keep them in `ValuationConfig`, echo them in `inputs` provenance.
- vnstock raw rows may use Vietnamese or snake_case English keys depending on source; loader must try multiple key aliases per concept (document the alias lists in code).
