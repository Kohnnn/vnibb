"""Fundamental valuation engine for the computed screener layer.

Pure computation over annual vnstock statement rows already stored in Mongo
(``market_vnstock_premium_records``). The only I/O lives in
:func:`load_fundamental_inputs`, which reads through a
``MongoMarketDataService``-shaped accessor. Everything else is deterministic
math over :class:`FundamentalInputs` so it can be unit-tested with synthetic
dicts. See ``docs/FUNDAMENTAL_SCREENER.md`` for the full contract.

Raw vnstock rows vary in key naming (snake_case English, camelCase, or
Vietnamese labels depending on source/version), so every concept is resolved
through an alias tuple via :func:`_pick`. Aliases marked "live-confirmed"
were verified against actual VNM documents in the corpus; the rest are
defensive fallbacks from known vnstock variants.
"""

from __future__ import annotations

import logging
import math
import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from typing import Any

from vnibb.core.price_units import persisted_price_record
from vnibb.providers.vnstock.financials import admitted_interest_expense
from vnibb.services import statement_admission

logger = logging.getLogger(__name__)

# Dataset/variant names live-confirmed against market_vnstock_premium_records:
# annual vs quarterly statement rows share a dataset and are split by the
# "datasetVariant" field (e.g. dataset "finance.ratio" has variants
# "finance.ratio.year" / "finance.ratio.quarter").
DATASET_INCOME_STATEMENT = "finance.income_statement"
DATASET_BALANCE_SHEET = "finance.balance_sheet"
DATASET_CASH_FLOW = "finance.cash_flow"
DATASET_RATIO = "finance.ratio"
DATASET_COMPANY_INFO = "company.info"
DATASET_LISTINGS = "reference.listings"
VARIANT_YEAR_SUFFIX = ".year"


ENGINE_SOURCE = "vnibb-fundamental-engine"
# v4: derived valuation/CAGR/FCF fields require admitted field evidence and
# disclosed fiscal coverage (#247, #248). Documents from v3 and earlier were
# produced under the "missing capex == 0" and "periods = nonnull count" rules,
# so their derived fields are not admissible.
SCHEMA_VERSION = 4
# A published "5Y" CAGR needs endpoints five fiscal years apart, i.e. six
# consecutive annual observations. Anything shorter is reported at its actual
# span in provenance and withheld from the 5Y fields.
CAGR_REQUIRED_SPAN_YEARS = 5
# Complete annual cash-flow rows required before the DCF averages a base FCF.
DCF_BASE_ROWS = 3

# --- key alias tuples (first non-null match wins) -------------------------

YEAR_ALIASES = ("yearReport", "year_report", "year")
PERIOD_ALIASES = ("period", "report_period", "lengthReport")
REVENUE_ALIASES = (
    "revenue",
    "net_sales",
    "total_operating_revenue",
    "net_revenue",
    "total_operating_income",
    "net_interest_income",  # live-confirmed bank income statements have no `revenue`
)
NPAT_ALIASES = (
    "net_profit_after_tax",  # live-confirmed
    "post_tax_profit",
    "share_holder_income",
    "net_income",
    "profit_after_tax",
)
GROSS_PROFIT_ALIASES = ("gross_profit", "grossProfit")
EBIT_ALIASES = ("ebit", "operating_profit", "operating_income", "profit_from_operating_activities")
INTEREST_EXPENSE_ALIASES = ("interest_expense", "interestExpense")
TOTAL_ASSETS_ALIASES = ("total_assets", "total_asset")  # live-confirmed
EQUITY_ALIASES = (
    "owners_equity",  # live-confirmed
    "equity",
    "shareholders_equity",
    "owner_equity",
    "b_owners_equity",  # live-confirmed section-prefixed variant
    "viii_capital_and_funds",  # live-confirmed bank balance sheets (VCB)
)
LIABILITIES_ALIASES = (
    "total_liabilities",
    "liabilities",
    "liability",
    "debt",
    "a_liabilities",  # present but often null in live rows
    "c. nợ phải trả",  # live-confirmed Vietnamese section label carries the value
)
OCF_ALIASES = (
    "net_cash_flows_from_operating_activities",
    "net_cash_inflows_outflows_from_operating_activities",
    "operating_cash_flow",
    "cash_from_operations",
    "lưu chuyển tiền thuần từ hoạt động kinh doanh",  # live-confirmed Vietnamese label
)
CAPEX_ALIASES = (
    "purchase_of_fixed_assets",
    "purchases_of_fixed_assets",
    "capex",
    "capital_expenditure",
    "payment_for_fixed_assets_constructions_and_other_long_term_assets",  # live-confirmed
)
DIVIDENDS_PAID_ALIASES = (
    "dividends_paid",
    "dividend_paid",
    "payment_of_dividends",
    "dividends_paid_profits_distributed_to_owners",  # live-confirmed
)
SHARES_ALIASES = (
    "issue_share",
    "issued_share",  # live-confirmed (company.info)
    "outstanding_share",
    "shares_outstanding",
)
SECTOR_ALIASES = ("sector", "icb_name2", "industry_name", "industry")
INDUSTRY_ALIASES = ("industry", "icb_name3", "icb_name2", "industry_name", "sector")
COMPANY_NAME_ALIASES = (
    "organ_name",  # live-confirmed (reference.listings)
    "name",  # live-confirmed (company.info)
    "company_name",
    "organ_short_name",
    "short_name",
)
EXCHANGE_ALIASES = ("exchange", "com_group_code", "exchange_name")
PE_ALIASES = ("price_to_earning", "pe")  # live-confirmed: "pe"
PB_ALIASES = ("price_to_book", "pb")  # live-confirmed: "pb"
PS_ALIASES = ("price_to_sale", "ps", "price_to_sales")  # live-confirmed: "ps"
EV_EBITDA_ALIASES = ("value_before_ebitda", "ev_ebitda", "ev_to_ebitda")  # live: "ev_ebitda"
RATIO_DIVIDEND_YIELD_ALIASES = ("dividend_yield", "dividend")  # live-confirmed
ROIC_ALIASES = ("roic", "return_on_invested_capital")

_FINANCIAL_KEYWORDS = (
    "ngân hàng",
    "bank",
    "bảo hiểm",
    "insurance",
    "chứng khoán",
    "securities",
    "financial services",
    "tài chính",
)

_YEAR_RE = re.compile(r"(\d{4})")

_STATEMENT_UNIT_FIELDS = {
    "revenue",
    "net_sales",
    "total_operating_revenue",
    "net_revenue",
    "total_operating_income",
    "net_interest_income",
    "net_profit_after_tax",
    "post_tax_profit",
    "share_holder_income",
    "net_income",
    "profit_after_tax",
    "total_assets",
    "total_asset",
    "owners_equity",
    "equity",
    "shareholders_equity",
    "owner_equity",
    "b_owners_equity",
    "viii_capital_and_funds",
    "total_liabilities",
    "liabilities",
    "liability",
    "debt",
    "a_liabilities",
    "c. nợ phải trả",
    "net_cash_flows_from_operating_activities",
    "net_cash_inflows_outflows_from_operating_activities",
    "operating_cash_flow",
    "cash_from_operations",
    "lưu chuyển tiền thuần từ hoạt động kinh doanh",
    "purchase_of_fixed_assets",
    "purchases_of_fixed_assets",
    "capex",
    "capital_expenditure",
    "payment_for_fixed_assets_constructions_and_other_long_term_assets",
    "dividends_paid",
    "dividend_paid",
    "payment_of_dividends",
    "dividends_paid_profits_distributed_to_owners",
}


@dataclass(frozen=True)
class ValuationConfig:
    """Tunable valuation parameters; no magic numbers inline elsewhere."""

    discount_rate_default: float = 0.12
    discount_rate_financial: float = 0.13
    terminal_growth: float = 0.03
    horizon_years: int = 10
    max_growth: float = 0.15
    sector_discount_overrides: dict[str, float] = field(default_factory=dict)


@dataclass
class FundamentalInputs:
    """Annual inputs; monetary comparisons require declared VND and share-count units.

    Direct callers may declare canonical ``statement_unit='VND'``. Loaded raw
    rows instead retain field-specific units and source lineage; absent units
    never imply a currency scale.
    """

    symbol: str
    sector: str | None = None
    industry: str | None = None
    price: float | None = None
    shares_outstanding: float | None = None
    market_cap: float | None = None
    ratios: dict[str, Any] = field(default_factory=dict)
    income_statements: list[dict[str, Any]] = field(default_factory=list)
    balance_sheets: list[dict[str, Any]] = field(default_factory=list)
    cash_flows: list[dict[str, Any]] = field(default_factory=list)
    company_name: str | None = None
    exchange: str | None = None
    volume: float | None = None
    price_unit: str | None = None
    shares_unit: str | None = None
    statement_unit: str | None = None
    unit_lineage: dict[str, Any] = field(default_factory=dict)


@dataclass
class FundamentalSnapshot:
    """Computed valuation/quality snapshot mirroring the Mongo doc contract."""

    symbol: str
    sector: str | None = None
    industry: str | None = None
    company_name: str | None = None
    exchange: str | None = None
    price: float | None = None
    market_cap: float | None = None
    shares_outstanding: float | None = None
    volume: float | None = None
    pe: float | None = None
    pb: float | None = None
    ps: float | None = None
    ev_ebitda: float | None = None
    roe: float | None = None
    roa: float | None = None
    net_margin: float | None = None
    debt_to_equity: float | None = None
    revenue_cagr_5y: float | None = None
    profit_cagr_5y: float | None = None
    dividend_yield: float | None = None
    dividend_years: int | None = None
    fcf_positive: bool | None = None
    intrinsic_value: float | None = None
    margin_of_safety: float | None = None
    valuation_method: str | None = None
    valuation_verdict: str | None = None
    moat: str | None = None
    moat_score: float | None = None
    moat_factors: dict[str, Any] = field(default_factory=dict)
    inputs: dict[str, Any] = field(default_factory=dict)
    computed_fields: list[str] = field(default_factory=list)


# --- low-level helpers -----------------------------------------------------


def _pick(row: Any, *aliases: str) -> Any:
    """Return the first non-null value for any alias, matching case-insensitively.

    Row keys are normalized by lowercasing and replacing spaces with
    underscores so snake_case, camelCase-lowered, and spaced labels all match.
    """

    if not isinstance(row, dict):
        return None
    normalized: dict[str, Any] = {}
    for key, value in row.items():
        lowered = str(key).strip().lower()
        for candidate in (lowered, lowered.replace(" ", "_")):
            if candidate not in normalized or normalized[candidate] is None:
                normalized[candidate] = value
    for alias in aliases:
        lowered = alias.strip().lower()
        for candidate in (lowered, lowered.replace(" ", "_"), lowered.replace("_", " ")):
            value = normalized.get(candidate)
            if value is not None:
                return value
    return None


def _to_float(value: Any) -> float | None:
    """Coerce numbers that may arrive as strings (live cash-flow rows do)."""

    if value is None or isinstance(value, bool):
        return None
    try:
        result = float(str(value).replace(",", "")) if isinstance(value, str) else float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(result) or math.isinf(result):
        return None
    return result

_CURRENCY_SCALES = {"vnd": 1, "thousand vnd": 1000, "million vnd": 1_000_000,
                    "billion vnd": 1_000_000_000, "bn vnd": 1_000_000_000}


def _declared_unit(row: dict[str, Any], key: str) -> Any:
    units = row.get("units")
    return units.get(key) if isinstance(units, dict) and key in units else row.get("currency_unit") or row.get("unit")


def _normalize_statement_rows(records: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = _dedup_annual_rows(records)
    normalized = []
    fields = _STATEMENT_UNIT_FIELDS | set(GROSS_PROFIT_ALIASES + EBIT_ALIASES + INTEREST_EXPENSE_ALIASES)
    for raw in rows:
        row = dict(raw)
        lineage = {}
        for key in fields & raw.keys():
            value = _to_float(raw[key])
            if value is None:
                continue
            unit = _declared_unit(raw, key)
            scale = _CURRENCY_SCALES.get(str(unit or "").strip().lower().replace("_", " "))
            lineage[key] = {"rawValue": raw[key], "rawUnit": unit, "scaleToVnd": scale}
            if scale is not None:
                row[key] = value * scale
        interest_key = next((key for key in INTEREST_EXPENSE_ALIASES if raw.get(key) is not None), None)
        if interest_key is not None:
            row["interest_expense"] = row[interest_key]
            financial_lineage = (raw.get("raw_data") or {}).get("_financial_lineage") or {}
            metadata_sources = (
                raw.get("unit_metadata") or {},
                (financial_lineage.get("canonical_data") or {}).get("unit_metadata") or {},
                financial_lineage.get("unit_metadata") or {},
            )
            if not any("interest_expense" in metadata for metadata in metadata_sources):
                evidence = lineage.get(interest_key, {})
                if evidence.get("scaleToVnd") is not None:
                    row["unit_metadata"] = {**(raw.get("unit_metadata") or {}), "interest_expense": {
                        "label": interest_key, "source_unit": evidence["rawUnit"], "value_unit": "VND",
                    }}
        row["_valuation_unit_lineage"] = lineage
        normalized.append(row)
    return normalized


def _has_vnd_field(row: dict[str, Any], aliases: tuple[str, ...], declared: str | None) -> bool:
    if _pick_float(row, *aliases) is None:
        return True
    if declared == "VND":
        return True
    lineage = row.get("_valuation_unit_lineage", {})
    for alias in aliases:
        if _pick(row, alias) is not None:
            return lineage.get(alias, {}).get("scaleToVnd") is not None
    return False


def _valuation_unit_reason(inputs: FundamentalInputs, financial: bool) -> str | None:
    relevant_rows = inputs.income_statements + inputs.balance_sheets + inputs.cash_flows
    if any(row.get("_valuation_conflicting_observations") for row in relevant_rows):
        return "Conflicting annual statement observations have no established revision order; intrinsic comparison is unavailable."
    if inputs.shares_unit != "shares":
        return "Share-count unit is unknown; equity/cash flow per share cannot be established."
    if financial:
        groups = [(inputs.income_statements[-1:], NPAT_ALIASES), (inputs.balance_sheets[-2:], EQUITY_ALIASES)]
    else:
        groups = [(inputs.income_statements[-5:], NPAT_ALIASES), (inputs.income_statements[-5:], REVENUE_ALIASES),
                  (inputs.cash_flows[-3:], OCF_ALIASES), (inputs.cash_flows[-3:], CAPEX_ALIASES)]
    for rows, aliases in groups:
        for row in rows:
            if not _has_vnd_field(row, aliases, inputs.statement_unit):
                return f"Statement currency/scale is unknown for {aliases[0]} ({_report_year(row)}); intrinsic value in VND cannot be established."
    return None



def _pick_float(row: Any, *aliases: str) -> float | None:
    return _to_float(_pick(row, *aliases))


def _report_year(row: Any) -> int | None:
    value = _to_float(_pick(row, *YEAR_ALIASES))
    if value is not None and 1900 <= value <= 2200:
        return int(value)
    period = _pick(row, *PERIOD_ALIASES)
    if period is not None:
        match = _YEAR_RE.search(str(period))
        if match:
            year = int(match.group(1))
            if 1900 <= year <= 2200:
                return year
    return None


def _observed_sort_key(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value if value.tzinfo is not None else value.replace(tzinfo=UTC)
    return datetime.min.replace(tzinfo=UTC)


def _dedup_annual_rows(records: Sequence[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Dedup raw dataset records by report year, keeping the newest observedAt.

    The corpus is known to contain duplicate period rows, so this step is
    mandatory before any derivation. Returns raw rows sorted ascending by year.
    """
    observations: dict[int, list[dict[str, Any]]] = {}

    best: dict[int, tuple[datetime, dict[str, Any]]] = {}
    for record in records or []:
        if not isinstance(record, dict):
            continue
        raw = record.get("raw")
        if not isinstance(raw, dict):
            continue
        year = _report_year(raw)
        if year is None:
            continue
        observed = _observed_sort_key(record.get("observedAt") or record.get("updatedAt"))
        observations.setdefault(year, []).append(raw)
        current = best.get(year)
        if current is None or observed >= current[0]:
            raw = dict(raw)
            for key in ("units", "unit", "currency_unit"):
                if key not in raw and record.get(key) is not None:
                    raw[key] = record[key]
            raw["_valuation_source"] = {
                "dataset": record.get("dataset"), "variant": record.get("datasetVariant"),
                "source": record.get("source"), "provider": record.get("provider"),
                "observedAt": record.get("observedAt"), "updatedAt": record.get("updatedAt"),
            }
            best[year] = (observed, raw)
    result = []
    for year, (_, raw) in sorted(best.items()):
        conflicting = []
        for field_name in _STATEMENT_UNIT_FIELDS:
            values = {(_to_float(row.get(field_name)), str(_declared_unit(row, field_name)))
                      for row in observations[year] if _to_float(row.get(field_name)) is not None}
            if len(values) > 1:
                conflicting.append(field_name)
        if conflicting:
            raw["_valuation_observations"] = observations[year]
            raw["_valuation_conflicting_observations"] = conflicting
        result.append(raw)
    return result


def _is_financial(sector: str | None, industry: str | None) -> bool:
    for text in (sector, industry):
        if not text:
            continue
        lowered = str(text).lower()
        if any(keyword in lowered for keyword in _FINANCIAL_KEYWORDS):
            return True
    return False


def _resolve_discount_rate(
    config: ValuationConfig, sector: str | None, industry: str | None, financial: bool
) -> float:
    for label in (sector, industry):
        if not label:
            continue
        lowered = str(label).strip().lower()
        for key, rate in config.sector_discount_overrides.items():
            if str(key).strip().lower() == lowered:
                return rate
    return config.discount_rate_financial if financial else config.discount_rate_default


# --- pure metric functions ---------------------------------------------------


def compute_roe_roa(
    income_statements: Sequence[dict[str, Any]],
    balance_sheets: Sequence[dict[str, Any]],
) -> tuple[float | None, float | None]:
    """Latest-year ROE/ROA in percent, using average balances when two years exist."""

    if not income_statements or not balance_sheets:
        return None, None
    npat = _pick_float(income_statements[-1], *NPAT_ALIASES)
    if npat is None:
        return None, None

    latest = balance_sheets[-1]
    previous = balance_sheets[-2] if len(balance_sheets) >= 2 else None

    def _avg(*aliases: str) -> float | None:
        current = _pick_float(latest, *aliases)
        if current is None:
            return None
        prior = _pick_float(previous, *aliases) if previous is not None else None
        return (current + prior) / 2.0 if prior is not None else current

    avg_equity = _avg(*EQUITY_ALIASES)
    avg_assets = _avg(*TOTAL_ASSETS_ALIASES)
    roe = (npat / avg_equity) * 100.0 if avg_equity is not None and avg_equity > 0 else None
    roa = (npat / avg_assets) * 100.0 if avg_assets is not None and avg_assets > 0 else None
    return roe, roa


def compute_cagr_over_years(points: Sequence[tuple[int, float]]) -> float | None:
    """Calendar-true CAGR in percent between two fiscal-year endpoints.

    ``points`` are ``(fiscal_year, value)`` pairs. The exponent is the actual
    elapsed year count, so missing intermediate years never shorten the period.
    Returns None with fewer than two points, a non-positive endpoint (growth
    across zero is meaningless), or a zero span.
    """

    ordered = sorted(points, key=lambda item: item[0])
    if len(ordered) < 2:
        return None
    (start_year, base), (end_year, last) = ordered[0], ordered[-1]
    span = end_year - start_year
    if span < 1 or base <= 0 or last <= 0:
        return None
    try:
        return ((last / base) ** (1.0 / span) - 1.0) * 100.0
    except (OverflowError, ValueError, ZeroDivisionError):
        return None



def _row_year(row: Any) -> int | None:
    return _report_year(row) if isinstance(row, dict) else None


def _annual_field_series(
    rows: Sequence[dict[str, Any]],
    field: str,
    *,
    declared_statement_unit: str | None = None,
) -> dict[str, Any]:
    """Ascending (year, value) points plus years that could not be admitted.

    Duplicate fiscal years with different values are a restatement without
    revision authority, so that year is withheld instead of using whichever
    row happened to sort last. The production loader collapses duplicate rows
    and records the collapsed conflict in ``_valuation_conflicting_observations``;
    a field named there is withheld for that year as well, because the surviving
    value is one of several with no established order.
    """

    aliases = {field, *statement_admission.FIELD_ALIASES.get(field, ())}
    by_year: dict[int, list[float]] = {}
    excluded: list[dict[str, Any]] = []
    conflicted: set[int] = set()
    for row in rows or []:
        year = _row_year(row)
        if year is None:
            continue
        if isinstance(row, dict) and aliases & set(
            row.get("_valuation_conflicting_observations") or ()
        ):
            conflicted.add(year)
            excluded.append({
                "year": year, "field": field, "reason": "conflicting_observations",
            })
            continue
        value, reason = statement_admission.admit_valuation_field(
            row, field, declared_statement_unit=declared_statement_unit
        )
        if value is None:
            excluded.append({"year": year, "field": field, "reason": reason})
            continue
        by_year.setdefault(year, []).append(value)
    ambiguous = sorted(
        year for year, values in by_year.items()
        if year in conflicted or len(set(values)) > 1
    )
    points = [
        (year, values[0]) for year, values in sorted(by_year.items()) if year not in ambiguous
    ]
    excluded.extend(
        {"year": year, "field": field, "reason": "ambiguous_restatement"}
        for year in ambiguous if year not in conflicted
    )
    return {
        "points": points,
        "excluded": excluded,
        "ambiguous_years": ambiguous,
        "conflicting_years": sorted(conflicted),
    }


def assess_cagr_coverage(
    rows: Sequence[dict[str, Any]],
    field: str,
    *,
    declared_statement_unit: str | None = None,
    required_span_years: int = CAGR_REQUIRED_SPAN_YEARS,
) -> dict[str, Any]:
    """CAGR with explicit fiscal coverage, for 5Y fields and DCF growth.

    ``published`` is what the ``5Y``-named fields may carry: it exists only
    when two admitted endpoints are exactly ``required_span_years`` fiscal
    years apart *and* every intermediate year is present. ``value`` is the
    calendar-true CAGR over whatever span the admitted endpoints cover, so a
    sparse or short history is disclosed at its actual interval instead of
    being labelled 5Y or annualised from a nonnull count (#248).
    """

    series = _annual_field_series(
        rows, field, declared_statement_unit=declared_statement_unit
    )
    points = series["points"]
    years = [year for year, _ in points]
    result: dict[str, Any] = {
        "field": field,
        "status": "unavailable",
        "published": None,
        "value": None,
        "startYear": years[0] if years else None,
        "endYear": years[-1] if years else None,
        "spanYears": (years[-1] - years[0]) if len(years) >= 2 else None,
        "coverage": "insufficient",
        "reason": None,
        "points": [{"year": year, "value": value} for year, value in points],
        "excluded": series["excluded"],
    }
    if len(points) < 2:
        result["reason"] = "insufficient_observations"
        return result
    # Publish from the newest window of exactly `required_span_years` intervals,
    # so a longer history still yields a truthful five-year figure and a short
    # or gapped one yields a reason instead of a mislabelled number.
    end_year = years[-1]
    window_years = list(range(end_year - required_span_years, end_year + 1))
    by_year = dict(points)
    window = [year for year in window_years if year in by_year]
    result["windowStartYear"] = window_years[0]
    result["windowEndYear"] = end_year
    result["windowComplete"] = len(window) == len(window_years)
    # startYear/endYear/spanYears identify the interval the reported value is
    # actually computed over, not the extent of the retained history, so a long
    # history never lends a 5Y claim to a shorter selected window.
    if window:
        result["startYear"] = window[0]
        result["endYear"] = window[-1]
        result["spanYears"] = window[-1] - window[0]
        result["historyStartYear"] = years[0]
        result["historyEndYear"] = years[-1]
    if window:
        result["coverage"] = "complete" if result["windowComplete"] else "gapped"
    if not window:
        result["reason"] = "insufficient_span:0y"
        return result
    base, last = by_year[window[0]], by_year[window[-1]]
    if base <= 0 or last <= 0:
        result["reason"] = "nonpositive_endpoint"
        return result
    actual = compute_cagr_over_years([(year, by_year[year]) for year in window])
    result["value"] = actual
    if actual is None:
        result["reason"] = "not_computable"
        return result
    if result["windowComplete"]:
        result["status"] = "complete"
        result["published"] = actual
        return result
    # No published five-year interval. Distinguish a history too short to hold
    # one from a present span with an interior hole: the first is a coverage
    # limit, the second is missing evidence inside an otherwise sufficient span.
    admitted_span = years[-1] - years[0]
    if admitted_span < required_span_years:
        result["reason"] = f"insufficient_span:{admitted_span}y"
    else:
        result["reason"] = "incomplete_intermediate_coverage"
        result["missingYears"] = [year for year in window_years if year not in by_year]
    return result


def assess_fcf_coverage(
    cash_flows: Sequence[dict[str, Any]],
    *,
    declared_statement_unit: str | None = None,
    base_rows: int = DCF_BASE_ROWS,
) -> dict[str, Any]:
    """Free cash flow with capex completeness disclosed, never assumed (#247).

    Capex is a required component: absent, blank or rejected capex makes that
    year's FCF unknown rather than equal to operating cash flow. A reported
    ``0`` is an admitted observation.

    ``base_fcf`` is the mean of the newest ``base_rows`` dated annual rows, and
    requires every one of them to carry admitted OCF and capex. The window is
    chosen before completeness is known, so an unknown newest year makes the
    base unavailable instead of being bridged with older complete years.
    """

    by_year: dict[int, dict[str, Any] | None] = {}
    excluded: list[dict[str, Any]] = []
    for row in cash_flows or []:
        year = _row_year(row)
        if year is None:
            continue
        conflicts = set(row.get("_valuation_conflicting_observations") or ()) if isinstance(row, dict) else set()
        incomplete = []
        ocf = capex = None
        if {"operating_cash_flow", *OCF_ALIASES} & conflicts:
            incomplete.append({"component": "operating_cash_flow", "reason": "conflicting_observations"})
        else:
            ocf, ocf_reason = statement_admission.admit_valuation_field(
                row, "operating_cash_flow", declared_statement_unit=declared_statement_unit
            )
            if ocf is None:
                incomplete.append({"component": "operating_cash_flow", "reason": ocf_reason})
        if {"capex", *CAPEX_ALIASES} & conflicts:
            incomplete.append({"component": "capex", "reason": "conflicting_observations"})
        else:
            capex, capex_reason = statement_admission.admit_valuation_field(
                row, "capex", declared_statement_unit=declared_statement_unit
            )
            if capex is None:
                incomplete.append({"component": "capex", "reason": capex_reason})
        if incomplete:
            excluded.append({"year": year, "incomplete": incomplete})
            by_year[year] = None
            continue
        by_year[year] = {"year": year, "ocf": ocf, "capex": capex, "fcf": ocf - abs(capex)}

    dated_years = sorted(by_year)
    newest_year = dated_years[-1] if dated_years else None
    latest_positive: bool | None = None
    latest_reason: str | None = None
    if newest_year is None:
        latest_reason = "no_dated_annual_cash_flow_row"
    elif by_year[newest_year] is not None:
        latest_positive = bool(by_year[newest_year]["fcf"] > 0)
    else:
        incomplete = next(item for item in excluded if item["year"] == newest_year)
        latest_reason = "latest_year_incomplete:" + ",".join(
            f"{part['component']}={part['reason']}" for part in incomplete["incomplete"]
        )

    window_years = dated_years[-base_rows:]
    window = [by_year[year] for year in window_years]
    missing_years = [year for year, item in zip(window_years, window) if item is None]
    status = "complete" if len(window) == base_rows and not missing_years else "partial"
    base_fcf: float | None = None
    reason: str | None = None
    if status == "complete":
        base_fcf = sum(item["fcf"] for item in window) / len(window)
    else:
        detail = f"; incomplete {', '.join(str(year) for year in missing_years)}" if missing_years else ""
        reason = (
            f"insufficient_complete_cash_flow_years:{len(window) - len(missing_years)}/{base_rows}"
            f" newest dated rows{detail}"
        )
    return {
        "status": status,
        "positive": latest_positive,
        "positiveReason": latest_reason,
        "latestYear": newest_year,
        "baseFcf": base_fcf,
        "baseYears": [item["year"] for item in window if item is not None],
        "baseRows": base_rows,
        "incompleteWindowYears": missing_years,
        "excluded": excluded,
        "reason": reason,
    }


def compute_dividend_years(cash_flows: Sequence[dict[str, Any]]) -> int | None:
    """Consecutive most-recent years with dividends paid (cash outflow, < 0)."""

    if not cash_flows:
        return None
    streak = 0
    for row in reversed(cash_flows):
        paid = _pick_float(row, *DIVIDENDS_PAID_ALIASES)
        if paid is not None and paid < 0:
            streak += 1
        else:
            break
    return streak


def compute_fcf_positive(cash_flows: Sequence[dict[str, Any]]) -> bool | None:
    """Whether latest-year FCF (OCF - |capex|) is positive.

    Capex is required, so a row without an admitted capex observation yields
    None (unknown) instead of treating OCF as FCF. Callers needing the full
    excluded-row disclosure use :func:`assess_fcf_coverage` (#247).
    """

    if not cash_flows:
        return None
    return assess_fcf_coverage(cash_flows)["positive"]


def compute_moat(
    income_statements: Sequence[dict[str, Any]],
    balance_sheets: Sequence[dict[str, Any]],
) -> str | None:
    """Heuristic moat label from ROE persistence and net-margin level/trend.

    Model-derived classification, not advice. Rules (last up-to-5 years):
    wide  — ROE >= 15% in >= 4 years AND latest margin >= 10% AND margin not
            down more than 20% relative vs the start of the window;
    narrow — ROE >= 10% in >= 3 years AND latest margin >= 5%;
    eroding — first 3 years of the window all had ROE >= 10% but the latest
            ROE fell below 60% of the window peak;
    none — otherwise. None (null) with fewer than 3 annual periods.
    """

    income_by_year = {
        year: row
        for row in income_statements
        if (year := _report_year(row)) is not None
    }
    balance_by_year = {
        year: row
        for row in balance_sheets
        if (year := _report_year(row)) is not None
    }
    years = sorted(set(income_by_year) & set(balance_by_year))[-5:]
    if len(years) < 3:
        return None

    roes: list[float | None] = []
    margins: list[float | None] = []
    for index, year in enumerate(years):
        npat = _pick_float(income_by_year[year], *NPAT_ALIASES)
        revenue = _pick_float(income_by_year[year], *REVENUE_ALIASES)
        equity = _pick_float(balance_by_year[year], *EQUITY_ALIASES)
        prior_equity = (
            _pick_float(balance_by_year[years[index - 1]], *EQUITY_ALIASES) if index > 0 else None
        )
        avg_equity = (
            (equity + prior_equity) / 2.0
            if equity is not None and prior_equity is not None
            else equity
        )
        roes.append(
            (npat / avg_equity) * 100.0
            if npat is not None and avg_equity is not None and avg_equity > 0
            else None
        )
        margins.append(
            (npat / revenue) * 100.0
            if npat is not None and revenue is not None and revenue != 0
            else None
        )

    latest_roe = roes[-1]
    latest_margin = margins[-1]
    first_margin = margins[0]
    roe_at_least = lambda threshold: sum(  # noqa: E731
        1 for value in roes if value is not None and value >= threshold
    )

    margin_trend_ok = True
    if first_margin is not None and latest_margin is not None and first_margin > 0:
        margin_trend_ok = latest_margin >= first_margin * 0.8

    if (
        roe_at_least(15.0) >= 4
        and latest_margin is not None
        and latest_margin >= 10.0
        and margin_trend_ok
    ):
        return "wide"
    if roe_at_least(10.0) >= 3 and latest_margin is not None and latest_margin >= 5.0:
        return "narrow"
    early = roes[:3]
    known = [value for value in roes if value is not None]
    if (
        all(value is not None and value >= 10.0 for value in early)
        and known
        and latest_roe is not None
        and latest_roe < 0.6 * max(known)
    ):
        return "eroding"
    return "none"


def compute_valuation_verdict(margin_of_safety: float | None) -> str | None:
    """Rules-based label for the model margin of safety."""

    if margin_of_safety is None:
        return None
    if margin_of_safety >= 30.0:
        return "undervalued"
    if margin_of_safety >= 10.0:
        return "fair_plus"
    if margin_of_safety > -10.0:
        return "fair"
    if margin_of_safety > -30.0:
        return "expensive"
    return "stretched"


def compute_moat_factors(
    income_statements: Sequence[dict[str, Any]],
    balance_sheets: Sequence[dict[str, Any]],
    ratios: dict[str, Any] | None = None,
    *,
    discount_rate: float | None = None,
) -> tuple[float | None, dict[str, Any]]:
    """Multi-factor moat evidence from profitability, margins, leverage and ROIC."""

    income_by_year = {
        year: row
        for row in income_statements
        if (year := _report_year(row)) is not None
    }
    balance_by_year = {
        year: row
        for row in balance_sheets
        if (year := _report_year(row)) is not None
    }
    years = sorted(set(income_by_year) & set(balance_by_year))[-5:]
    if len(years) < 3:
        return None, {}

    gross_margins: list[float] = []
    roes: list[float] = []
    for index, year in enumerate(years):
        income = income_by_year[year]
        balance = balance_by_year[year]
        revenue = _pick_float(income, *REVENUE_ALIASES)
        gross_profit = _pick_float(income, *GROSS_PROFIT_ALIASES)
        if gross_profit is not None and revenue is not None and revenue != 0:
            gross_margins.append(gross_profit / revenue * 100.0)
        npat = _pick_float(income, *NPAT_ALIASES)
        equity = _pick_float(balance, *EQUITY_ALIASES)
        prior_equity = (
            _pick_float(balance_by_year[years[index - 1]], *EQUITY_ALIASES) if index > 0 else None
        )
        avg_equity = (equity + prior_equity) / 2.0 if equity is not None and prior_equity is not None else equity
        if npat is not None and avg_equity is not None and avg_equity > 0:
            roes.append(npat / avg_equity * 100.0)

    gross_margin_avg = sum(gross_margins) / len(gross_margins) if gross_margins else None
    gross_margin_range = max(gross_margins) - min(gross_margins) if len(gross_margins) >= 2 else None
    gross_margin_stability = None
    if gross_margin_avg is not None and gross_margin_range is not None:
        gross_margin_stability = max(0.0, min(100.0, 100.0 - gross_margin_range * 4.0))

    latest_income = income_by_year[years[-1]]
    ebit = _pick_float(latest_income, *EBIT_ALIASES)
    interest_expense = admitted_interest_expense(latest_income)
    interest_coverage = None
    if ebit is not None and interest_expense not in (None, 0):
        interest_coverage = ebit / abs(float(interest_expense))

    roic = _pick_float(ratios or {}, *ROIC_ALIASES)
    roic_pct = roic * 100.0 if roic is not None and abs(roic) <= 1.0 else roic
    roic_spread = None
    if roic_pct is not None and discount_rate is not None:
        roic_spread = roic_pct - discount_rate * 100.0

    roe_avg = sum(roes) / len(roes) if roes else None
    sector_rank_score = None
    if roe_avg is not None:
        sector_rank_score = max(0.0, min(100.0, (roe_avg / 20.0) * 100.0))

    scores: list[float] = []
    if gross_margin_stability is not None:
        scores.append(gross_margin_stability)
    if interest_coverage is not None:
        scores.append(max(0.0, min(100.0, (interest_coverage / 8.0) * 100.0)))
    if roic_spread is not None:
        scores.append(max(0.0, min(100.0, 50.0 + roic_spread * 5.0)))
    if sector_rank_score is not None:
        scores.append(sector_rank_score)

    score = sum(scores) / len(scores) if scores else None
    factors = {
        "gross_margin_avg": gross_margin_avg,
        "gross_margin_range": gross_margin_range,
        "gross_margin_stability": gross_margin_stability,
        "interest_coverage": interest_coverage,
        "roic": roic_pct,
        "roic_spread": roic_spread,
        "roe_avg": roe_avg,
        "sector_rank_score": sector_rank_score,
        "periods_used": years,
    }
    return score, {key: value for key, value in factors.items() if value is not None}


def compute_intrinsic_value_dcf(
    base_fcf: float | None,
    growth_rate: float | None,
    shares_outstanding: float | None,
    *,
    discount_rate: float,
    config: ValuationConfig | None = None,
) -> float | None:
    """FCFE DCF intrinsic value per share.

    ``growth_rate`` is a fraction clamped to [0, max_growth] and faded
    linearly to ``terminal_growth`` across the horizon (year 1 grows at the
    starting rate, year H at the terminal rate). Gordon terminal value at the
    horizon. Requires positive base FCF, positive share count, and
    discount_rate > terminal_growth.
    """

    cfg = config or ValuationConfig()
    if base_fcf is None or base_fcf <= 0:
        return None
    if shares_outstanding is None or shares_outstanding <= 0:
        return None
    if discount_rate <= cfg.terminal_growth:
        return None
    horizon = max(1, int(cfg.horizon_years))
    start_growth = min(max(growth_rate or 0.0, 0.0), cfg.max_growth)

    present_value = 0.0
    fcf = base_fcf
    for year in range(1, horizon + 1):
        if horizon > 1:
            growth = start_growth + (cfg.terminal_growth - start_growth) * (year - 1) / (
                horizon - 1
            )
        else:
            growth = start_growth
        fcf *= 1.0 + growth
        present_value += fcf / (1.0 + discount_rate) ** year

    terminal_value = (
        fcf * (1.0 + cfg.terminal_growth) / (discount_rate - cfg.terminal_growth)
    ) / (1.0 + discount_rate) ** horizon
    return (present_value + terminal_value) / shares_outstanding


def compute_intrinsic_value_rim(
    book_value_per_share: float | None,
    current_roe: float | None,
    *,
    discount_rate: float,
    config: ValuationConfig | None = None,
) -> float | None:
    """Residual income model intrinsic value per share for financials.

    IV/share = BVPS + sum_{t=1..H} BVPS * (ROE_t - r) / (1 + r)^t, where ROE
    (a fraction) fades linearly from the current value to r over the horizon
    (year 1 uses the current ROE, year H equals r). Simplification: BVPS is
    held constant over the horizon rather than compounded with retained
    residual earnings; this keeps the model explainable from two inputs at
    the cost of understating IV for high-retention banks.
    """

    cfg = config or ValuationConfig()
    if book_value_per_share is None or book_value_per_share <= 0:
        return None
    if current_roe is None:
        return None
    if discount_rate <= 0:
        return None
    horizon = max(1, int(cfg.horizon_years))

    residual_pv = 0.0
    for year in range(1, horizon + 1):
        if horizon > 1:
            roe = current_roe + (discount_rate - current_roe) * (year - 1) / (horizon - 1)
        else:
            roe = current_roe
        residual_pv += (
            book_value_per_share * (roe - discount_rate) / (1.0 + discount_rate) ** year
        )
    return book_value_per_share + residual_pv


def compute_margin_of_safety(
    intrinsic_value: float | None, price: float | None
) -> float | None:
    """(IV - price) / IV in percent, clamped to [-100, 100]; None on bad inputs."""

    if intrinsic_value is None or intrinsic_value <= 0:
        return None
    if price is None or price <= 0:
        return None
    margin = (intrinsic_value - price) / intrinsic_value * 100.0
    return max(-100.0, min(100.0, margin))


# --- snapshot assembly -------------------------------------------------------


def _safe(func: Callable[..., Any], *args: Any, default: Any = None, **kwargs: Any) -> Any:
    try:
        return func(*args, **kwargs)
    except Exception as exc:
        logger.debug("fundamental computation %s failed: %s", func.__name__, exc)
        return default


def compute_fundamental_snapshot(
    inputs: FundamentalInputs, config: ValuationConfig | None = None
) -> FundamentalSnapshot:
    """Derive the full snapshot from loaded inputs. Never raises.

    Missing or garbage inputs degrade to None outputs field by field; the
    provenance dict always records the parameters the valuation would use.
    """

    cfg = config or ValuationConfig()
    income = inputs.income_statements or []
    balance = inputs.balance_sheets or []
    cash = inputs.cash_flows or []
    ratios = inputs.ratios or {}

    roe, roa = _safe(compute_roe_roa, income, balance, default=(None, None))

    net_margin: float | None = None
    if income:
        npat = _pick_float(income[-1], *NPAT_ALIASES)
        revenue = _pick_float(income[-1], *REVENUE_ALIASES)
        if npat is not None and revenue is not None and revenue != 0:
            net_margin = npat / revenue * 100.0

    debt_to_equity: float | None = None
    if balance:
        liabilities = _pick_float(balance[-1], *LIABILITIES_ALIASES)
        equity = _pick_float(balance[-1], *EQUITY_ALIASES)
        if liabilities is not None and equity is not None and equity > 0:
            debt_to_equity = liabilities / equity

    recent_income = income[-6:]
    revenue_coverage = _safe(
        assess_cagr_coverage,
        income,
        "revenue",
        declared_statement_unit=inputs.statement_unit,
        default={},
    )
    profit_coverage = _safe(
        assess_cagr_coverage,
        income,
        "net_income",
        declared_statement_unit=inputs.statement_unit,
        default={},
    )
    revenue_cagr = revenue_coverage.get("published")
    profit_cagr = profit_coverage.get("published")

    dividend_yield: float | None = None
    if cash and inputs.market_cap is not None and inputs.market_cap > 0:
        paid = _pick_float(cash[-1], *DIVIDENDS_PAID_ALIASES)
        if paid is not None and paid < 0:
            dividend_yield = abs(paid) / inputs.market_cap * 100.0
    if dividend_yield is None:
        ratio_yield = _pick_float(ratios, *RATIO_DIVIDEND_YIELD_ALIASES)
        if ratio_yield is not None:
            # The live ratio row stores a fraction (0.02 == 2%); larger values
            # are assumed to already be percentages.
            dividend_yield = ratio_yield * 100.0 if abs(ratio_yield) <= 1.0 else ratio_yield

    dividend_years = _safe(compute_dividend_years, cash)
    fcf_coverage = _safe(
        assess_fcf_coverage,
        cash,
        declared_statement_unit=inputs.statement_unit,
        default={},
    )
    fcf_positive = fcf_coverage.get("positive")
    financial = _is_financial(inputs.sector, inputs.industry)
    discount_rate = _resolve_discount_rate(cfg, inputs.sector, inputs.industry, financial)
    moat = _safe(compute_moat, income, balance)
    moat_score, moat_factors = _safe(
        compute_moat_factors,
        income,
        balance,
        ratios,
        discount_rate=discount_rate,
        default=(None, {}),
    )

    base_fcf: float | None = None
    growth_rate: float | None = None
    intrinsic_value: float | None = None
    valuation_method: str | None = None
    derived_reason: str | None = None
    growth_assumption: dict[str, Any] = {
        "source": None, "value": None, "valuePct": None, "clampedToMax": None,
    }
    unit_reason = _valuation_unit_reason(inputs, financial)

    if financial and unit_reason is None:
        bvps: float | None = None
        if balance and inputs.shares_outstanding is not None and inputs.shares_outstanding > 0:
            equity = _pick_float(balance[-1], *EQUITY_ALIASES)
            if equity is not None and equity > 0:
                bvps = equity / inputs.shares_outstanding
        current_roe_fraction = roe / 100.0 if roe is not None else None
        growth_rate = current_roe_fraction
        if current_roe_fraction is not None:
            growth_assumption = {
                "source": "current_roe",
                "value": current_roe_fraction,
                "valuePct": current_roe_fraction * 100.0,
                "clampedToMax": False,
            }
        intrinsic_value = _safe(
            compute_intrinsic_value_rim,
            bvps,
            current_roe_fraction,
            discount_rate=discount_rate,
            config=cfg,
        )
        if intrinsic_value is not None:
            valuation_method = "rim"
        else:
            derived_reason = (
                "Residual income intrinsic value is unavailable: the model needs "
                "positive book value per share and a current ROE from admitted statements."
            )
    elif not financial and unit_reason is None:
        if fcf_coverage.get("status") == "complete":
            base_fcf = fcf_coverage.get("baseFcf")
        else:
            derived_reason = (
                "Free cash flow is unavailable: "
                f"{fcf_coverage.get('reason') or 'incomplete annual cash-flow rows'}. "
                "Capex is required for every modelled year; a missing component is not zero."
            )
        # Growth may only come from a fully disclosed CAGR block. A short or
        # gapped history is not annualised into a 10-year fade (#248).
        guidance = next(
            (
                block
                for block in (profit_coverage, revenue_coverage)
                if block.get("published") is not None
            ),
            None,
        )
        if guidance is not None:
            raw_growth = float(guidance["published"]) / 100.0
            growth_rate = min(max(raw_growth, 0.0), cfg.max_growth)
            growth_assumption = {
                "source": f"{guidance['field']}_cagr",
                "value": growth_rate,
                "valuePct": growth_rate * 100.0,
                "rawValuePct": raw_growth * 100.0,
                "startYear": guidance.get("startYear"),
                "endYear": guidance.get("endYear"),
                "spanYears": guidance.get("spanYears"),
                "clampedToMax": growth_rate != raw_growth,
            }
        else:
            growth_rate = 0.0
            growth_assumption = {
                "source": "none",
                "value": 0.0,
                "valuePct": 0.0,
                "clampedToMax": False,
            }
        intrinsic_value = _safe(
            compute_intrinsic_value_dcf,
            base_fcf,
            growth_rate,
            inputs.shares_outstanding,
            discount_rate=discount_rate,
            config=cfg,
        )
        if intrinsic_value is not None:
            valuation_method = "dcf"
        elif derived_reason is None:
            derived_reason = (
                "DCF intrinsic value is unavailable: the model needs positive average FCF "
                "from complete annual rows and a verified share count."
            )
    comparison_reason = unit_reason
    if comparison_reason is None and inputs.price_unit != "VND":
        comparison_reason = "Price currency/scale is unknown; margin of safety cannot be compared in VND."

    margin_of_safety = None if comparison_reason else _safe(compute_margin_of_safety, intrinsic_value, inputs.price)
    valuation_verdict = compute_valuation_verdict(margin_of_safety)

    periods_used = sorted(
        {year for row in recent_income if (year := _report_year(row)) is not None}
    )
    provenance: dict[str, Any] = {
        "periods_used": periods_used,
        "discount_rate": discount_rate,
        "terminal_growth": cfg.terminal_growth,
        "base_fcf": base_fcf,
        "growth_rate": growth_rate,
        "horizon_years": cfg.horizon_years,
        "unit_quality": "unknown" if comparison_reason else "verified",
        "comparison_unavailable_reason": comparison_reason,
        "unit_lineage": inputs.unit_lineage or {
            "price": {"unit": inputs.price_unit}, "shares": {"unit": inputs.shares_unit},
            "statements": {"unit": inputs.statement_unit},
        },
        # Derived-value admission (v4): coverage and reasons travel with every
        # derived field so a consumer can never read a number without knowing
        # what it is anchored to (#247, #248).
        "derived_unavailable_reason": derived_reason,
        "derived_coverage": {
            "cagr": {"revenue": revenue_coverage, "profit": profit_coverage},
            "fcf": {
                "status": fcf_coverage.get("status"),
                "positive": fcf_coverage.get("positive"),
                "positiveReason": fcf_coverage.get("positiveReason"),
                "latestYear": fcf_coverage.get("latestYear"),
                "baseFcf": fcf_coverage.get("baseFcf"),
                "baseYears": fcf_coverage.get("baseYears"),
                "baseRows": fcf_coverage.get("baseRows"),
                "incompleteWindowYears": fcf_coverage.get("incompleteWindowYears"),
                "excluded": fcf_coverage.get("excluded"),
                "reason": fcf_coverage.get("reason"),
            },
            "growth": growth_assumption,
            "cagrRule": {
                "requiredSpanYears": CAGR_REQUIRED_SPAN_YEARS,
                "requiredAnnualPoints": CAGR_REQUIRED_SPAN_YEARS + 1,
                "gapPolicy": "endpoints may span a gap for the disclosed actual-interval value, but a gapped or short series never publishes the 5Y fields and never seeds DCF growth",
            },
        },
    }

    snapshot = FundamentalSnapshot(
        symbol=inputs.symbol,
        sector=inputs.sector,
        industry=inputs.industry,
        company_name=inputs.company_name,
        exchange=inputs.exchange,
        price=inputs.price,
        market_cap=inputs.market_cap,
        shares_outstanding=inputs.shares_outstanding,
        volume=inputs.volume,
        pe=_pick_float(ratios, *PE_ALIASES),
        pb=_pick_float(ratios, *PB_ALIASES),
        ps=_pick_float(ratios, *PS_ALIASES),
        ev_ebitda=_pick_float(ratios, *EV_EBITDA_ALIASES),
        roe=roe,
        roa=roa,
        net_margin=net_margin,
        debt_to_equity=debt_to_equity,
        revenue_cagr_5y=revenue_cagr,
        profit_cagr_5y=profit_cagr,
        dividend_yield=dividend_yield,
        dividend_years=dividend_years,
        fcf_positive=fcf_positive,
        intrinsic_value=intrinsic_value,
        margin_of_safety=margin_of_safety,
        valuation_method=valuation_method,
        valuation_verdict=valuation_verdict,
        moat=moat,
        moat_score=moat_score,
        moat_factors=moat_factors or {},
        inputs=provenance,
    )
    snapshot.computed_fields = [
        name
        for name in (
            "roe",
            "roa",
            "net_margin",
            "debt_to_equity",
            "revenue_cagr_5y",
            "profit_cagr_5y",
            "dividend_yield",
            "dividend_years",
            "fcf_positive",
            "intrinsic_value",
            "margin_of_safety",
            "valuation_verdict",
            "moat",
            "moat_score",
        )
        if getattr(snapshot, name) is not None
    ]
    return snapshot


def fundamental_valuation_unavailable_reason(snapshot: dict[str, Any] | None) -> str | None:
    """Why a retained snapshot's intrinsic value/margin of safety may not publish.

    Returns None only for a v4 document whose valuation inputs are admitted and
    whose price lineage is declared VND.
    """

    if not snapshot:
        return None
    inputs = snapshot.get("inputs")
    inputs = inputs if isinstance(inputs, dict) else {}
    reason = inputs.get("comparisonUnavailableReason")
    if reason:
        return str(reason)
    if snapshot.get("schemaVersion") != SCHEMA_VERSION:
        return (
            "Retained snapshot was produced under a superseded valuation formula "
            f"(schema version {snapshot.get('schemaVersion')!r}, current {SCHEMA_VERSION}); "
            "derived values must be recomputed before publication."
        )
    if inputs.get("derivedUnavailableReason"):
        return str(inputs["derivedUnavailableReason"])
    lineage = inputs.get("unitLineage")
    price = lineage.get("price") if isinstance(lineage, dict) else None
    if inputs.get("unitQuality") != "verified" or not isinstance(price, dict) or price.get("unit") != "VND":
        return "Retained snapshot valuation basis is unverified; verified input units and declared VND price lineage are required."
    return None


# Derived fields whose old-formula values must never reach a consumer.
_DERIVED_PUBLISHED_FIELDS = (
    "intrinsicValue",
    "marginOfSafety",
    "valuationMethod",
    "valuationVerdict",
    "revenueCagr5y",
    "profitCagr5y",
    "fcfPositive",
)


def admit_fundamental_snapshot(doc: dict[str, Any] | None) -> dict[str, Any] | None:
    """Withhold derived values produced under a superseded formula.

    Any retained document that is not current-schema, or that lacks the v4
    coverage blocks, still carries numbers computed with "missing capex == 0"
    and "periods = nonnull count". Those values are nulled here instead of
    being republished, with a reason attached; every unrelated field is
    preserved. Idempotent on a current v4 document (returned unchanged).
    """

    if not isinstance(doc, dict):
        return doc
    inputs = doc.get("inputs")
    inputs = dict(inputs) if isinstance(inputs, dict) else {}
    coverage = inputs.get("derivedCoverage")
    admitted = doc.get("schemaVersion") == SCHEMA_VERSION and isinstance(coverage, dict)
    if admitted:
        return doc
    result = dict(doc)
    reason = inputs.get("derivedUnavailableReason") or (
        "Retained snapshot predates formula schema "
        f"{SCHEMA_VERSION} (found {doc.get('schemaVersion')!r}); derived valuation, "
        "CAGR and FCF values are withheld until recomputed."
    )
    withheld = [
        name for name in _DERIVED_PUBLISHED_FIELDS
        if doc.get(name) is not None or name in (inputs.get("derivedWithheldFields") or ())
    ]
    for name in withheld:
        result[name] = None
    inputs["derivedUnavailableReason"] = str(reason)
    inputs["derivedWithheldFields"] = withheld
    result["inputs"] = inputs
    return result


def to_document(snapshot: FundamentalSnapshot, snapshot_date: date) -> dict[str, Any]:
    """Render the snapshot as the camelCase Mongo document from the contract."""

    now = datetime.now(UTC)
    return {
        "symbol": snapshot.symbol,
        "snapshotDate": snapshot_date.isoformat(),
        "source": ENGINE_SOURCE,
        "schemaVersion": SCHEMA_VERSION,
        "observedAt": now,
        "updatedAt": now,
        "companyName": snapshot.company_name,
        "exchange": snapshot.exchange,
        "sector": snapshot.sector,
        "industry": snapshot.industry,
        "price": snapshot.price,
        "volume": snapshot.volume,
        "marketCap": snapshot.market_cap,
        "sharesOutstanding": snapshot.shares_outstanding,
        "pe": snapshot.pe,
        "pb": snapshot.pb,
        "ps": snapshot.ps,
        "evEbitda": snapshot.ev_ebitda,
        "roe": snapshot.roe,
        "roa": snapshot.roa,
        "netMargin": snapshot.net_margin,
        "debtToEquity": snapshot.debt_to_equity,
        "revenueCagr5y": snapshot.revenue_cagr_5y,
        "profitCagr5y": snapshot.profit_cagr_5y,
        "dividendYield": snapshot.dividend_yield,
        "dividendYears": snapshot.dividend_years,
        "fcfPositive": snapshot.fcf_positive,
        "intrinsicValue": snapshot.intrinsic_value,
        "marginOfSafety": snapshot.margin_of_safety,
        "valuationMethod": snapshot.valuation_method,
        "valuationVerdict": snapshot.valuation_verdict,
        "moat": snapshot.moat,
        "moatScore": snapshot.moat_score,
        "moatFactors": dict(snapshot.moat_factors),
        "inputs": {
            "periodsUsed": snapshot.inputs.get("periods_used", []),
            "discountRate": snapshot.inputs.get("discount_rate"),
            "terminalGrowth": snapshot.inputs.get("terminal_growth"),
            "baseFcf": snapshot.inputs.get("base_fcf"),
            "growthRate": snapshot.inputs.get("growth_rate"),
            "horizonYears": snapshot.inputs.get("horizon_years"),
            "unitQuality": snapshot.inputs.get("unit_quality"),
            "comparisonUnavailableReason": snapshot.inputs.get("comparison_unavailable_reason"),
            "derivedUnavailableReason": snapshot.inputs.get("derived_unavailable_reason"),
            "derivedCoverage": snapshot.inputs.get("derived_coverage", {}),
            "unitLineage": snapshot.inputs.get("unit_lineage", {}),
        },
        "computedFields": list(snapshot.computed_fields),
    }


# --- loader (the only I/O in this module) ------------------------------------


async def load_fundamental_inputs(symbol: str, svc: Any) -> FundamentalInputs:
    """Load and normalize everything the engine needs for one symbol.

    ``svc`` is a ``MongoMarketDataService``-shaped accessor providing
    ``get_raw_dataset_records`` and ``get_eod_prices``; both already swallow
    Mongo errors and return empty lists, so this loader stays total.
    """

    symbol_upper = symbol.upper()

    income_records = await svc.get_raw_dataset_records(
        symbol_upper,
        dataset=DATASET_INCOME_STATEMENT,
        variant=DATASET_INCOME_STATEMENT + VARIANT_YEAR_SUFFIX,
        limit=400,
    )
    balance_records = await svc.get_raw_dataset_records(
        symbol_upper,
        dataset=DATASET_BALANCE_SHEET,
        variant=DATASET_BALANCE_SHEET + VARIANT_YEAR_SUFFIX,
        limit=400,
    )
    cash_records = await svc.get_raw_dataset_records(
        symbol_upper,
        dataset=DATASET_CASH_FLOW,
        variant=DATASET_CASH_FLOW + VARIANT_YEAR_SUFFIX,
        limit=400,
    )
    ratio_records = await svc.get_raw_dataset_records(
        symbol_upper,
        dataset=DATASET_RATIO,
        variant=DATASET_RATIO + VARIANT_YEAR_SUFFIX,
        limit=400,
    )
    info_records = await svc.get_raw_dataset_records(
        symbol_upper, dataset=DATASET_COMPANY_INFO, limit=5
    )
    listing_records = await svc.get_raw_dataset_records(
        symbol_upper, dataset=DATASET_LISTINGS, limit=5
    )

    income_statements = _normalize_statement_rows(income_records)
    balance_sheets = _normalize_statement_rows(balance_records)
    cash_flows = _normalize_statement_rows(cash_records)
    ratio_rows = _dedup_annual_rows(ratio_records)
    ratios = ratio_rows[-1] if ratio_rows else {}

    def _first_raw(records: list[dict[str, Any]]) -> dict[str, Any]:
        for record in records or []:
            raw = record.get("raw") if isinstance(record, dict) else None
            if isinstance(raw, dict):
                result = dict(raw)
                for key in ("units", "shares_unit"):
                    if key not in result and record.get(key) is not None:
                        result[key] = record[key]
                result["_valuation_source"] = {key: record.get(key) for key in ("source", "provider", "observedAt", "updatedAt")}
                return result
        return {}

    info = _first_raw(info_records)
    listing = _first_raw(listing_records)

    sector = _pick(info, *SECTOR_ALIASES) or _pick(listing, *SECTOR_ALIASES)
    industry = _pick(info, *INDUSTRY_ALIASES) or _pick(listing, *INDUSTRY_ALIASES)
    company_name = _pick(listing, *COMPANY_NAME_ALIASES) or _pick(info, *COMPANY_NAME_ALIASES)
    exchange = _pick(info, *EXCHANGE_ALIASES) or _pick(listing, *EXCHANGE_ALIASES)
    shares = None
    share_unit = None
    share_lineage = {}
    for raw, dataset in ((info, DATASET_COMPANY_INFO), (listing, DATASET_LISTINGS), (ratios, DATASET_RATIO)):
        for key in SHARES_ALIASES:
            value = _pick_float(raw, key)
            if value is None or value <= 0:
                continue
            units = raw.get("units")
            unit = units.get(key, raw.get("shares_unit")) if isinstance(units, dict) else raw.get("shares_unit")
            share_unit = "shares" if str(unit or "").lower() == "shares" else None
            shares = value
            share_lineage = {"dataset": dataset, "field": key, "rawValue": value, "rawUnit": unit,
                             "source": raw.get("_valuation_source", {})}
            break
        if shares is not None:
            break

    price: float | None = None
    volume: float | None = None
    price_lineage = {}
    eod_rows = await svc.get_eod_prices(symbol_upper, lookback_days=45, limit=60)
    for row in reversed(eod_rows or []):
        if not isinstance(row, dict):
            continue
        record = persisted_price_record(row)
        if record["price_unit"] != "VND":
            continue
        close = _to_float(record.get("close"))
        if close is not None and close > 0:
            price = close
            volume = _to_float(record.get("volume"))
            price_lineage = {"dataset": "market_prices_eod", "field": "close", "rawValue": row.get("close"),
                             "rawUnit": row.get("price_unit") or row.get("priceUnit"),
                             "source": row.get("price_source") or row.get("source"),
                             "observationDate": row.get("time") or row.get("date"), "unit": "VND"}
            break

    market_cap = price * shares if price is not None and shares is not None and share_unit == "shares" else None

    return FundamentalInputs(
        symbol=symbol_upper,
        sector=str(sector) if sector is not None else None,
        industry=str(industry) if industry is not None else None,
        price=price,
        shares_outstanding=shares,
        market_cap=market_cap,
        ratios=ratios,
        income_statements=income_statements,
        balance_sheets=balance_sheets,
        cash_flows=cash_flows,
        company_name=str(company_name) if company_name is not None else None,
        exchange=str(exchange) if exchange is not None else None,
        volume=volume,
        price_unit="VND" if price is not None else None,
        shares_unit=share_unit,
        unit_lineage={"price": price_lineage, "shares": share_lineage,
                      "statements": [{"period": _report_year(row), "source": row.get("_valuation_source", {}),
                                      "fields": row.get("_valuation_unit_lineage", {}),
                                      "conflictingFields": row.get("_valuation_conflicting_observations", []),
                                      "observations": row.get("_valuation_observations", [])}
                                     for row in income_statements + balance_sheets + cash_flows]},
    )
