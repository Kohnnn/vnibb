import logging
import math

from vnibb.providers.vnstock.financials import (
    FinancialsQueryParams,
    FinancialStatementData,
    StatementType,
    VnstockFinancialsFetcher,
)

logger = logging.getLogger(__name__)


async def get_financials_with_ttm(
    symbol: str, statement_type: str = "income", period: str = "year", limit: int = 5
) -> list[FinancialStatementData]:
    """
    Fetch financials with support for TTM.
    """
    normalized_period = (period or "").upper()
    if normalized_period == "FY":
        period = "year"
    if normalized_period == "TTM":
        return await calculate_ttm(symbol, statement_type)

    # Map periods like Q1, Q2, Q3, Q4 to quarter and filter
    actual_period = "quarter" if normalized_period.startswith("Q") else period

    params = FinancialsQueryParams(
        symbol=symbol,
        statement_type=StatementType(statement_type),
        period=actual_period,
        limit=limit if not normalized_period.startswith("Q") else 20,
    )

    data = await VnstockFinancialsFetcher.fetch(params)

    if normalized_period.startswith("Q"):
        # Filter for specific quarter across years
        q_num = normalized_period[1]

        def is_matching_quarter(period_value: str) -> bool:
            if not period_value:
                return False
            upper = period_value.upper()
            if f"Q{q_num}" in upper:
                return True
            return upper.startswith(f"{q_num}/") or upper.startswith(f"{q_num}-")

        data = [d for d in data if is_matching_quarter(d.period)][-limit:]

    return data


async def calculate_ttm(symbol: str, statement_type: str) -> list[FinancialStatementData]:
    """
    Calculate Trailing Twelve Months (TTM) by summing last 4 quarters.
    """
    params = FinancialsQueryParams(
        symbol=symbol, statement_type=StatementType(statement_type), period="quarter", limit=4
    )

    quarters = await VnstockFinancialsFetcher.fetch(params)

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
            "gross_profit",
            "operating_income",
            "net_income",
            "ebitda",
            "operating_cash_flow",
            "investing_cash_flow",
            "financing_cash_flow",
            "free_cash_flow",
        ]
        for metric in metrics:
            total = sum(_safe_number(getattr(q, metric)) for q in quarters)
            setattr(ttm_data, metric, total)

    # For Balance Sheet, we usually take the most recent quarter instead of summing
    elif statement_type == "balance":
        most_recent = quarters[0]
        ttm_data.total_assets = _sanitize_optional(most_recent.total_assets)
        ttm_data.total_liabilities = _sanitize_optional(most_recent.total_liabilities)
        ttm_data.total_equity = _sanitize_optional(most_recent.total_equity)
        ttm_data.cash_and_equivalents = _sanitize_optional(most_recent.cash_and_equivalents)

    return [ttm_data]
