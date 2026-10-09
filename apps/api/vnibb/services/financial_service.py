import logging
import math
import asyncio
import re
from datetime import UTC, datetime

from vnibb.core.config import settings
from vnibb.providers.vnstock.financials import (
    FinancialsQueryParams,
    FinancialStatementData,
    StatementType,
    VnstockFinancialsFetcher,
)

logger = logging.getLogger(__name__)

YEAR_PATTERN = re.compile(r"(20\d{2})")
QUARTER_PATTERN = re.compile(r"Q([1-4])")


def normalize_statement_period(
    period_value: str | None,
    *,
    fiscal_year: int | None = None,
    fiscal_quarter: int | None = None,
    period_type: str | None = None,
) -> str | None:
    text = str(period_value or "").strip().upper()
    normalized_period_type = str(period_type or "").strip().lower()

    year = fiscal_year if fiscal_year and 1900 <= fiscal_year <= 2100 else None
    quarter = fiscal_quarter if fiscal_quarter and 1 <= fiscal_quarter <= 4 else None
    prefers_quarter = normalized_period_type == "quarter" or quarter is not None

    if text:
        if text == "TTM" or "TTM" in text:
            if year is None:
                year_match = YEAR_PATTERN.search(text)
                year = int(year_match.group(1)) if year_match else None
            return f"TTM-{year}" if year is not None else "TTM"

        if text.endswith("YTD") or "YTD" in text:
            if year is None:
                year_match = YEAR_PATTERN.search(text)
                year = int(year_match.group(1)) if year_match else None
            return f"{year} YTD" if year is not None else "YTD"

        if re.match(r"^20\d{2}$", text):
            if year is None:
                year = int(text)
            if prefers_quarter and quarter is not None:
                return f"Q{quarter}-{year}"
            return str(year)

        quarter_first = re.match(r"^Q([1-4])[-_/ ]?(20\d{2})$", text)
        if quarter_first:
            return f"Q{quarter_first.group(1)}-{quarter_first.group(2)}"

        year_first = re.match(r"^(20\d{2})[-_/ ]?Q([1-4])$", text)
        if year_first:
            return f"Q{year_first.group(2)}-{year_first.group(1)}"

        alt_quarter = re.match(r"^([1-4])[/_-](20\d{2})$", text)
        if alt_quarter:
            return f"Q{alt_quarter.group(1)}-{alt_quarter.group(2)}"

        year_match = YEAR_PATTERN.search(text)
        quarter_match = QUARTER_PATTERN.search(text)
        if year_match:
            year = int(year_match.group(1))
        if quarter_match:
            quarter = int(quarter_match.group(1))

        if text.isdigit():
            numeric = int(text)
            if 1900 <= numeric <= 2100:
                if year is None:
                    year = numeric
                if prefers_quarter and quarter is not None:
                    return f"Q{quarter}-{year}"
                return str(year)
            if 1 <= numeric <= 4 and year is not None:
                quarter = numeric

    if year is None:
        return None

    if prefers_quarter and quarter is not None:
        return f"Q{quarter}-{year}"

    return str(year)


def _is_control_flow_exception(exc: BaseException) -> bool:
    return isinstance(exc, (asyncio.CancelledError, KeyboardInterrupt, GeneratorExit))


def _provider_timeout_budget(reserve_seconds: int = 5) -> float:
    vnstock_timeout = max(1, int(getattr(settings, "vnstock_timeout", 30) or 30))
    request_timeout = int(getattr(settings, "api_request_timeout_seconds", 0) or 0)
    if request_timeout <= 0:
        return float(vnstock_timeout)

    reserve = reserve_seconds if request_timeout > reserve_seconds + 1 else 1
    return float(max(1, min(vnstock_timeout, request_timeout - reserve)))


def _extract_period_year(period: str | None) -> int | None:
    normalized = normalize_statement_period(period)
    if not normalized:
        return None
    match = YEAR_PATTERN.search(normalized)
    return int(match.group(1)) if match else None


def _extract_period_quarter(period: str | None) -> int | None:
    normalized = normalize_statement_period(period)
    if not normalized:
        return None
    match = QUARTER_PATTERN.search(normalized)
    return int(match.group(1)) if match else None


def _merge_statement_row_pair(
    primary: FinancialStatementData,
    secondary: FinancialStatementData,
) -> FinancialStatementData:
    payload = primary.model_dump(mode="json")
    secondary_payload = secondary.model_dump(mode="json")
    if any(payload.get(name) != secondary_payload.get(name)
           for name in FinancialStatementData.model_fields if name not in {"updated_at", "raw_data"}):
        payload.update({name: None for name in FinancialStatementData.model_fields
                        if isinstance(payload.get(name), (int, float))})
        payload["unavailable_reason"] = "conflicting_duplicate_period"
        payload["raw_data"] = {"conflicting_rows": [primary.raw_data, secondary.raw_data]}
    return FinancialStatementData.model_validate(payload)


def _normalize_statement_rows(
    rows: list[FinancialStatementData],
    *,
    period_type: str | None,
) -> list[FinancialStatementData]:
    normalized_rows: dict[str, FinancialStatementData] = {}

    for row in rows:
        normalized_period = normalize_statement_period(
            row.period,
            fiscal_year=getattr(row, "fiscal_year", None),
            fiscal_quarter=getattr(row, "fiscal_quarter", None),
            period_type=getattr(row, "period_type", None) or period_type,
        )
        if normalized_period is None:
            continue

        candidate = row.model_copy(update={"period": normalized_period})
        existing = normalized_rows.get(normalized_period)
        normalized_rows[normalized_period] = (
            candidate if existing is None else _merge_statement_row_pair(existing, candidate)
        )

    return sorted(
        normalized_rows.values(),
        key=lambda item: (_extract_period_year(item.period) or 0) * 10
        + (_extract_period_quarter(item.period) or 0),
        reverse=True,
    )


def _build_ytd_snapshot(
    symbol: str,
    statement_type: str,
    year: int,
    quarters: list[FinancialStatementData],
) -> FinancialStatementData | None:
    if not quarters:
        return None

    def _sanitize_optional(value: float | None) -> float | None:
        if value is None:
            return None
        try:
            number = float(value)
        except (TypeError, ValueError):
            return None
        if math.isnan(number) or math.isinf(number):
            return None
        return number

    latest = quarters[0]
    if latest.unavailable_reason or latest.value_unit != "VND":
        return None
    if statement_type == "balance":
        return latest.model_copy(update={"period": f"{year} (YTD)", "aggregation_basis": "latest_quarter_snapshot",
                                        "source_periods": [latest.period]})
    if latest.flow_basis == "cumulative_ytd":
        return latest.model_copy(update={"period": f"{year} (YTD)", "aggregation_basis": "reported_cumulative_ytd",
                                        "source_periods": [latest.period]})
    expected_quarters = list(range(_extract_period_quarter(latest.period) or 0, 0, -1))
    if [_extract_period_quarter(row.period) for row in quarters] != expected_quarters:
        return None
    if any(row.flow_basis != "single_quarter" or row.value_unit != "VND" or row.unavailable_reason
           or row.consolidation_basis != latest.consolidation_basis for row in quarters):
        return None
    ytd_data = FinancialStatementData(
        symbol=symbol.upper(),
        period=f"{year} (YTD)",
        statement_type=statement_type,
        updated_at=latest.updated_at or datetime.now(UTC),
        source=latest.source, currency=latest.currency, value_unit=latest.value_unit,
        consolidation_basis=latest.consolidation_basis, flow_basis="cumulative_ytd",
        aggregation_basis="year_to_date_flow_sum", source_periods=[row.period for row in quarters],
        raw_data={"source_rows": [row.model_dump(mode="json") for row in quarters]},
    )

    if statement_type == "income":
        metrics = (
            "revenue", "cost_of_revenue", "gross_profit", "operating_income",
            "net_income", "ebitda", "pre_tax_profit", "tax_expense",
            "interest_expense", "depreciation",
        )
    elif statement_type == "cashflow":
        metrics = (
            "operating_cash_flow", "investing_cash_flow", "financing_cash_flow",
            "free_cash_flow", "net_change_in_cash", "capex", "dividends_paid",
            "stock_repurchased", "debt_repayment",
        )
    else:
        metrics = ()

    for metric in metrics:
        values = (_sanitize_optional(getattr(row, metric)) for row in quarters)
        total = 0.0
        complete = True
        for value in values:
            if value is None:
                complete = False
                break
            total += value
        if complete:
            setattr(ytd_data, metric, total)

    if statement_type == "income":
        ytd_data.profit_before_tax = ytd_data.pre_tax_profit
    elif statement_type == "cashflow":
        ytd_data.net_cash_flow = ytd_data.net_change_in_cash
        ytd_data.capital_expenditure = ytd_data.capex
    elif statement_type == "balance":
        ytd_data.total_assets = _sanitize_optional(latest.total_assets)
        ytd_data.total_liabilities = _sanitize_optional(latest.total_liabilities)
        ytd_data.total_equity = _sanitize_optional(latest.total_equity)
        ytd_data.cash_and_equivalents = _sanitize_optional(latest.cash_and_equivalents)
        ytd_data.current_assets = _sanitize_optional(latest.current_assets)
        ytd_data.fixed_assets = _sanitize_optional(latest.fixed_assets)
        ytd_data.current_liabilities = _sanitize_optional(latest.current_liabilities)
        ytd_data.long_term_liabilities = _sanitize_optional(latest.long_term_liabilities)
        ytd_data.retained_earnings = _sanitize_optional(latest.retained_earnings)
        ytd_data.short_term_debt = _sanitize_optional(latest.short_term_debt)
        ytd_data.long_term_debt = _sanitize_optional(latest.long_term_debt)
        ytd_data.accounts_receivable = _sanitize_optional(latest.accounts_receivable)
        ytd_data.accounts_payable = _sanitize_optional(latest.accounts_payable)
        ytd_data.customer_deposits = _sanitize_optional(latest.customer_deposits)
        ytd_data.goodwill = _sanitize_optional(latest.goodwill)
        ytd_data.intangible_assets = _sanitize_optional(latest.intangible_assets)

    return ytd_data


async def _inject_latest_ytd_row(
    symbol: str,
    statement_type: str,
    annual_rows: list[FinancialStatementData],
    limit: int,
) -> list[FinancialStatementData]:
    params = FinancialsQueryParams(
        symbol=symbol,
        statement_type=StatementType(statement_type),
        period="quarter",
        limit=20,
    )

    try:
        quarter_rows = await VnstockFinancialsFetcher.fetch(params)
    except Exception as exc:
        logger.debug("YTD quarter fetch skipped for %s (%s): %s", symbol, statement_type, exc)
        return annual_rows

    quarter_rows = _normalize_statement_rows(quarter_rows, period_type="quarter")

    latest_annual_year = max(
        (_extract_period_year(row.period) or 0 for row in annual_rows),
        default=0,
    )

    quarter_candidates = [
        row
        for row in quarter_rows
        if _extract_period_year(row.period) and _extract_period_quarter(row.period)
    ]
    if not quarter_candidates:
        return annual_rows

    latest_quarter_year = max(_extract_period_year(row.period) or 0 for row in quarter_candidates)
    if latest_quarter_year <= latest_annual_year:
        return annual_rows

    latest_year_rows = [
        row for row in quarter_candidates if _extract_period_year(row.period) == latest_quarter_year
    ]
    latest_year_rows.sort(
        key=lambda row: _extract_period_quarter(row.period) or 0,
        reverse=True,
    )

    ytd_row = _build_ytd_snapshot(
        symbol=symbol,
        statement_type=statement_type,
        year=latest_quarter_year,
        quarters=latest_year_rows,
    )
    if not ytd_row:
        return annual_rows

    return [ytd_row, *annual_rows][:limit]


async def get_financials_with_ttm(
    symbol: str, statement_type: str = "income", period: str = "year", limit: int = 5
) -> list[FinancialStatementData]:
    """
    Fetch financials with support for TTM.
    """
    normalized_period = (period or "").upper()
    is_specific_quarter = normalized_period in {"Q1", "Q2", "Q3", "Q4"}
    if normalized_period == "FY":
        period = "year"
    if normalized_period in {"Q", "QUARTER"}:
        period = "quarter"
    if normalized_period == "TTM":
        try:
            return await calculate_ttm(symbol, statement_type)
        except BaseException as exc:
            if _is_control_flow_exception(exc):
                raise
            logger.warning(
                "TTM calculation aborted for %s (%s): %s",
                symbol.upper(),
                statement_type,
                exc,
            )
            return [
                FinancialStatementData(
                    symbol=symbol.upper(),
                    period="TTM",
                    statement_type=statement_type,
                    unavailable_reason="ttm_calculation_failed",
                )
            ]

    # Map periods like Q1, Q2, Q3, Q4 to quarter and filter
    actual_period = "quarter" if is_specific_quarter else period

    params = FinancialsQueryParams(
        symbol=symbol,
        statement_type=StatementType(statement_type),
        period=actual_period,
        limit=limit if not is_specific_quarter else 20,
    )

    try:
        data = await asyncio.wait_for(
            VnstockFinancialsFetcher.fetch(params),
            timeout=_provider_timeout_budget(),
        )
    except BaseException as exc:
        if _is_control_flow_exception(exc):
            raise
        logger.warning(
            "Financial fetch aborted for %s (%s/%s): %s",
            symbol.upper(),
            statement_type,
            period,
            exc,
        )
        return []

    data = _normalize_statement_rows(data, period_type=actual_period)

    if is_specific_quarter:
        q_num = int(normalized_period[1])
        filtered = [d for d in data if _extract_period_quarter(d.period) == q_num]
        filtered.sort(
            key=lambda row: (_extract_period_year(row.period) or 0) * 10
            + (_extract_period_quarter(row.period) or 0),
            reverse=True,
        )
        data = filtered[:limit]

    if actual_period == "year" and not is_specific_quarter:
        data = await _inject_latest_ytd_row(
            symbol=symbol,
            statement_type=statement_type,
            annual_rows=data,
            limit=limit,
        )

    return data


def build_ttm_statement_rows(
    rows: list[FinancialStatementData], statement_type: str
) -> list[FinancialStatementData]:
    quarters = _normalize_statement_rows(rows, period_type="quarter")
    quarters = [row for row in quarters if _extract_period_quarter(row.period) is not None]
    if not quarters:
        return []
    latest = quarters[0]
    def unavailable(reason: str) -> list[FinancialStatementData]:
        return [FinancialStatementData(symbol=latest.symbol, period="TTM", statement_type=statement_type,
            unavailable_reason=reason, source_periods=[row.period for row in quarters],
            raw_data={"source_rows": [row.model_dump(mode="json") for row in quarters]})]
    if latest.unavailable_reason:
        return unavailable(latest.unavailable_reason)
    if latest.value_unit != "VND":
        return unavailable("unknown_source_unit")
    if statement_type in {"balance", "balance_sheet"}:
        return [latest.model_copy(update={"period": "TTM", "aggregation_basis": "latest_quarter_snapshot",
                                          "source_periods": [latest.period]})]
    metrics = ("revenue", "cost_of_revenue", "gross_profit", "operating_income", "net_income", "ebitda",
               "pre_tax_profit", "tax_expense", "interest_expense", "depreciation", "selling_general_admin",
               "research_development", "other_income") if statement_type == "income" else (
               "operating_cash_flow", "investing_cash_flow", "financing_cash_flow", "free_cash_flow",
               "net_change_in_cash", "capex", "dividends_paid", "stock_repurchased", "debt_repayment", "depreciation")
    period_lookup = {row.period: row for row in quarters}
    flows = []
    for row in quarters[:4]:
        if row.flow_basis == "single_quarter":
            flows.append(row)
            continue
        if row.flow_basis != "cumulative_ytd":
            return unavailable("unknown_quarterly_flow_basis")
        quarter = _extract_period_quarter(row.period)
        if quarter == 1:
            flows.append(row.model_copy(update={"flow_basis": "single_quarter"}))
            continue
        prior = period_lookup.get(f"Q{quarter - 1}-{_extract_period_year(row.period)}")
        if prior is None or prior.flow_basis != "cumulative_ytd":
            return unavailable("missing_prior_cumulative_quarter")
        if (row.value_unit, row.consolidation_basis, row.source) != (prior.value_unit, prior.consolidation_basis, prior.source):
            return unavailable("incompatible_quarterly_basis")
        delta = row.model_copy(deep=True, update={"flow_basis": "single_quarter"})
        for metric in metrics:
            value, previous = getattr(row, metric), getattr(prior, metric)
            setattr(delta, metric, value - previous if value is not None and previous is not None else None)
        delta.raw_data = {"transformation": "cumulative_ytd_difference", "current": row.model_dump(mode="json"),
                          "previous": prior.model_dump(mode="json")}
        flows.append(delta)
    source_rows = flows
    ordinal = [(_extract_period_year(row.period) or 0) * 4 + (_extract_period_quarter(row.period) or 0)
               for row in source_rows]
    if len(source_rows) != 4 or ordinal != list(range(ordinal[0], ordinal[0] - 4, -1)):
        return unavailable("missing_consecutive_quarters")
    if any(row.unavailable_reason for row in source_rows):
        return unavailable("unavailable_quarter_value")
    bases = {(row.source, row.value_unit, row.consolidation_basis, row.flow_basis) for row in source_rows}
    if len(bases) != 1 or any(row.consolidation_basis is None for row in source_rows):
        return unavailable("incompatible_or_unknown_quarterly_basis")
    result = FinancialStatementData(symbol=latest.symbol, period="TTM", statement_type=statement_type,
        updated_at=latest.updated_at, source=latest.source, currency=latest.currency, value_unit=latest.value_unit,
        consolidation_basis=latest.consolidation_basis, flow_basis="trailing_twelve_months",
        aggregation_basis="four_quarter_flow_sum", source_periods=[row.period for row in source_rows],
        raw_data={"source_rows": [row.model_dump(mode="json") for row in source_rows]})
    for metric in metrics:
        values = [getattr(row, metric) for row in source_rows]
        if all(value is not None and math.isfinite(value) for value in values):
            setattr(result, metric, sum(values))
        result.unit_metadata[metric] = {"aggregation_basis": result.aggregation_basis,
            "source_periods": result.source_periods, "components": [row.unit_metadata.get(metric) for row in source_rows],
            "unavailable_reason": "missing_quarter_value" if getattr(result, metric) is None else None}
    result.profit_before_tax = result.pre_tax_profit
    result.net_cash_flow = result.net_change_in_cash
    result.capital_expenditure = result.capex
    result.unit_metadata["eps"] = {"unavailable_reason": "ttm_eps_requires_weighted_share_basis"}
    return [result]

async def calculate_ttm(symbol: str, statement_type: str) -> list[FinancialStatementData]:
    """
    Build a latest balance snapshot or four consecutive quarterly flows.
    """
    params = FinancialsQueryParams(
        symbol=symbol, statement_type=StatementType(statement_type), period="quarter", limit=8
    )

    try:
        quarters = await asyncio.wait_for(
            VnstockFinancialsFetcher.fetch(params),
            timeout=_provider_timeout_budget(),
        )
    except BaseException as exc:
        if _is_control_flow_exception(exc):
            raise
        logger.warning(
            "TTM source fetch aborted for %s (%s): %s",
            symbol.upper(),
            statement_type,
            exc,
        )
        return [FinancialStatementData(symbol=symbol.upper(), period="TTM", statement_type=statement_type,
            unavailable_reason=f"financial_source_fetch_failed: {exc}")]

    rows = build_ttm_statement_rows(quarters, statement_type)
    if rows:
        return rows
    # #101: the provider returned no usable quarterly rows, so the reason is
    # carried on the requested symbol/type/period instead of an empty list.
    return [
        FinancialStatementData(
            symbol=symbol.upper(),
            period="TTM",
            statement_type=statement_type,
            unavailable_reason="missing_quarterly_source_data",
        )
    ]
