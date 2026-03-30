import logging
import math
import asyncio
import re
from datetime import datetime

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
    if not period:
        return None
    match = YEAR_PATTERN.search(period.upper())
    return int(match.group(1)) if match else None


def _extract_period_quarter(period: str | None) -> int | None:
    if not period:
        return None
    match = QUARTER_PATTERN.search(period.upper())
    return int(match.group(1)) if match else None


def _build_ytd_snapshot(
    symbol: str,
    statement_type: str,
    year: int,
    quarters: list[FinancialStatementData],
) -> FinancialStatementData | None:
    if not quarters:
        return None

    def _safe_number(value: float | None) -> float:
        if value is None:
            return 0
        try:
            number = float(value)
        except (TypeError, ValueError):
            return 0
        if math.isnan(number) or math.isinf(number):
            return 0
        return number

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
    ytd_data = FinancialStatementData(
        symbol=symbol.upper(),
        period=f"{year} (YTD)",
        statement_type=statement_type,
        updated_at=latest.updated_at or datetime.utcnow(),
    )

    if statement_type in ["income", "cashflow"]:
        metrics = [
            "revenue",
            "cost_of_revenue",
            "gross_profit",
            "operating_income",
            "net_income",
            "ebitda",
            "pre_tax_profit",
            "tax_expense",
            "interest_expense",
            "depreciation",
            "operating_cash_flow",
            "investing_cash_flow",
            "financing_cash_flow",
            "free_cash_flow",
            "net_change_in_cash",
            "capex",
            "dividends_paid",
            "stock_repurchased",
            "debt_repayment",
        ]
        for metric in metrics:
            total = sum(_safe_number(getattr(row, metric)) for row in quarters)
            setattr(ytd_data, metric, total)

        if statement_type == "income":
            ytd_data.profit_before_tax = ytd_data.pre_tax_profit
        if statement_type == "cashflow":
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
            return []

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

    if is_specific_quarter:
        # Filter for specific quarter across years
        q_num = normalized_period[1]

        def is_matching_quarter(period_value: str) -> bool:
            if not period_value:
                return False
            upper = period_value.upper()
            if f"Q{q_num}" in upper:
                return True
            return upper.startswith(f"{q_num}/") or upper.startswith(f"{q_num}-")

        filtered = [d for d in data if is_matching_quarter(d.period)]
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


async def calculate_ttm(symbol: str, statement_type: str) -> list[FinancialStatementData]:
    """
    Calculate Trailing Twelve Months (TTM) by summing last 4 quarters.
    """
    params = FinancialsQueryParams(
        symbol=symbol, statement_type=StatementType(statement_type), period="quarter", limit=4
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
        return []

    if len(quarters) < 4:
        logger.warning(f"Not enough quarterly data for TTM calculation for {symbol}")
        return quarters  # Return whatever we have or empty

    def _safe_number(value: float | None) -> float:
        if value is None:
            return 0
        try:
            number = float(value)
        except (TypeError, ValueError):
            return 0
        if math.isnan(number) or math.isinf(number):
            return 0
        return number

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

    # Combine last 4 quarters
    ttm_data = FinancialStatementData(
        symbol=symbol.upper(),
        period="TTM",
        statement_type=statement_type,
        updated_at=quarters[0].updated_at,
    )

    # Sum metrics for Income Statement and Cash Flow
    if statement_type in ["income", "cashflow"]:
        metrics = [
            "revenue",
            "cost_of_revenue",
            "gross_profit",
            "operating_income",
            "net_income",
            "ebitda",
            "pre_tax_profit",
            "tax_expense",
            "interest_expense",
            "depreciation",
            "operating_cash_flow",
            "investing_cash_flow",
            "financing_cash_flow",
            "free_cash_flow",
            "net_change_in_cash",
            "capex",
            "dividends_paid",
            "stock_repurchased",
            "debt_repayment",
        ]
        for metric in metrics:
            total = sum(_safe_number(getattr(q, metric)) for q in quarters)
            setattr(ttm_data, metric, total)

        if statement_type == "income":
            ttm_data.profit_before_tax = ttm_data.pre_tax_profit
        if statement_type == "cashflow":
            ttm_data.net_cash_flow = ttm_data.net_change_in_cash
            ttm_data.capital_expenditure = ttm_data.capex

    # For Balance Sheet, we usually take the most recent quarter instead of summing
    elif statement_type == "balance":
        most_recent = quarters[0]
        ttm_data.total_assets = _sanitize_optional(most_recent.total_assets)
        ttm_data.total_liabilities = _sanitize_optional(most_recent.total_liabilities)
        ttm_data.total_equity = _sanitize_optional(most_recent.total_equity)
        ttm_data.cash_and_equivalents = _sanitize_optional(most_recent.cash_and_equivalents)
        ttm_data.current_assets = _sanitize_optional(most_recent.current_assets)
        ttm_data.fixed_assets = _sanitize_optional(most_recent.fixed_assets)
        ttm_data.current_liabilities = _sanitize_optional(most_recent.current_liabilities)
        ttm_data.long_term_liabilities = _sanitize_optional(most_recent.long_term_liabilities)
        ttm_data.retained_earnings = _sanitize_optional(most_recent.retained_earnings)
        ttm_data.short_term_debt = _sanitize_optional(most_recent.short_term_debt)
        ttm_data.long_term_debt = _sanitize_optional(most_recent.long_term_debt)
        ttm_data.accounts_receivable = _sanitize_optional(most_recent.accounts_receivable)
        ttm_data.accounts_payable = _sanitize_optional(most_recent.accounts_payable)
        ttm_data.customer_deposits = _sanitize_optional(most_recent.customer_deposits)
        ttm_data.goodwill = _sanitize_optional(most_recent.goodwill)
        ttm_data.intangible_assets = _sanitize_optional(most_recent.intangible_assets)

    return [ttm_data]
