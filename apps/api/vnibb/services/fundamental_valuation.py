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

# market_prices_eod stores closes in thousand VND (vnstock convention:
# VNM close 58.4 == 58,400 VND), while statements are in VND. Live-confirmed
# via BVPS cross-check (equity / issued_share matches the ratio row's
# book_value_per_share in VND).
EOD_PRICE_MULTIPLIER = 1000.0

ENGINE_SOURCE = "vnibb-fundamental-engine"
SCHEMA_VERSION = 1

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
    """Raw material for one symbol; statements are annual, deduped, ascending by year."""

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
    moat: str | None = None
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
        current = best.get(year)
        if current is None or observed >= current[0]:
            best[year] = (observed, raw)
    return [raw for _, (_, raw) in sorted(best.items())]


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


def compute_cagr(values: Sequence[float | None]) -> float | None:
    """CAGR in percent over an ascending annual series.

    Returns None with fewer than 3 usable periods, a non-positive base, or a
    sign flip between endpoints (growth rates are meaningless across zero).
    """

    cleaned = [v for v in values if v is not None]
    if len(cleaned) < 3:
        return None
    base, last = cleaned[0], cleaned[-1]
    if base <= 0 or last <= 0:
        return None
    periods = len(cleaned) - 1
    try:
        return ((last / base) ** (1.0 / periods) - 1.0) * 100.0
    except (OverflowError, ValueError, ZeroDivisionError):
        return None


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
    """Whether latest-year FCF (OCF - |capex|) is positive; missing capex counts as 0."""

    if not cash_flows:
        return None
    latest = cash_flows[-1]
    ocf = _pick_float(latest, *OCF_ALIASES)
    if ocf is None:
        return None
    capex = _pick_float(latest, *CAPEX_ALIASES) or 0.0
    return (ocf - abs(capex)) > 0


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

    recent_income = income[-5:]
    revenue_cagr = _safe(
        compute_cagr, [_pick_float(row, *REVENUE_ALIASES) for row in recent_income]
    )
    profit_cagr = _safe(
        compute_cagr, [_pick_float(row, *NPAT_ALIASES) for row in recent_income]
    )

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
    fcf_positive = _safe(compute_fcf_positive, cash)
    moat = _safe(compute_moat, income, balance)

    financial = _is_financial(inputs.sector, inputs.industry)
    discount_rate = _resolve_discount_rate(cfg, inputs.sector, inputs.industry, financial)

    base_fcf: float | None = None
    growth_rate: float | None = None
    intrinsic_value: float | None = None
    valuation_method: str | None = None

    if financial:
        bvps: float | None = None
        if balance and inputs.shares_outstanding is not None and inputs.shares_outstanding > 0:
            equity = _pick_float(balance[-1], *EQUITY_ALIASES)
            if equity is not None and equity > 0:
                bvps = equity / inputs.shares_outstanding
        current_roe_fraction = roe / 100.0 if roe is not None else None
        growth_rate = current_roe_fraction
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
        fcf_values: list[float] = []
        for row in cash[-3:]:
            ocf = _pick_float(row, *OCF_ALIASES)
            if ocf is None:
                continue
            capex = _pick_float(row, *CAPEX_ALIASES) or 0.0
            fcf_values.append(ocf - abs(capex))
        if fcf_values:
            base_fcf = sum(fcf_values) / len(fcf_values)
        cagr_source = profit_cagr if profit_cagr is not None else revenue_cagr
        growth_rate = min(
            max((cagr_source or 0.0) / 100.0, 0.0), cfg.max_growth
        )
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

    margin_of_safety = _safe(compute_margin_of_safety, intrinsic_value, inputs.price)

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
        moat=moat,
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
            "moat",
        )
        if getattr(snapshot, name) is not None
    ]
    return snapshot


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
        "moat": snapshot.moat,
        "inputs": {
            "periodsUsed": snapshot.inputs.get("periods_used", []),
            "discountRate": snapshot.inputs.get("discount_rate"),
            "terminalGrowth": snapshot.inputs.get("terminal_growth"),
            "baseFcf": snapshot.inputs.get("base_fcf"),
            "growthRate": snapshot.inputs.get("growth_rate"),
            "horizonYears": snapshot.inputs.get("horizon_years"),
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

    income_statements = _dedup_annual_rows(income_records)
    balance_sheets = _dedup_annual_rows(balance_records)
    cash_flows = _dedup_annual_rows(cash_records)
    ratio_rows = _dedup_annual_rows(ratio_records)
    ratios = ratio_rows[-1] if ratio_rows else {}

    def _first_raw(records: list[dict[str, Any]]) -> dict[str, Any]:
        for record in records or []:
            raw = record.get("raw") if isinstance(record, dict) else None
            if isinstance(raw, dict):
                return raw
        return {}

    info = _first_raw(info_records)
    listing = _first_raw(listing_records)

    sector = _pick(info, *SECTOR_ALIASES) or _pick(listing, *SECTOR_ALIASES)
    industry = _pick(info, *INDUSTRY_ALIASES) or _pick(listing, *INDUSTRY_ALIASES)
    company_name = _pick(listing, *COMPANY_NAME_ALIASES) or _pick(info, *COMPANY_NAME_ALIASES)
    exchange = _pick(info, *EXCHANGE_ALIASES) or _pick(listing, *EXCHANGE_ALIASES)
    shares = _pick_float(info, *SHARES_ALIASES) or _pick_float(listing, *SHARES_ALIASES)
    if shares is None:
        shares = _pick_float(ratios, *SHARES_ALIASES)

    price: float | None = None
    volume: float | None = None
    eod_rows = await svc.get_eod_prices(symbol_upper, lookback_days=45, limit=60)
    for row in reversed(eod_rows or []):
        close = _to_float(row.get("close")) if isinstance(row, dict) else None
        if close is not None:
            price = close * EOD_PRICE_MULTIPLIER
            volume = _to_float(row.get("volume"))
            break

    market_cap = price * shares if price is not None and shares is not None else None

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
    )
