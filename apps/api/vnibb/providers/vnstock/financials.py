"""
VnStock Financials Fetcher

Fetches financial statements (Income Statement, Balance Sheet, Cash Flow)
for Vietnam-listed companies via vnstock library.
"""

import asyncio
import logging
import math
import re
from datetime import datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from vnibb.core.config import settings
from vnibb.core.exceptions import ProviderError, ProviderTimeoutError
from vnibb.core.retry import circuit_breaker, vnstock_cb
from vnibb.providers.base import BaseFetcher

logger = logging.getLogger(__name__)


class StatementType(str, Enum):
    """Financial statement types."""

    INCOME = "income"
    BALANCE = "balance"
    CASHFLOW = "cashflow"


class FinancialsQueryParams(BaseModel):
    """Query parameters for financial statements."""

    symbol: str = Field(
        ...,
        min_length=1,
        max_length=10,
        description="Stock ticker symbol (e.g., VNM)",
    )
    statement_type: StatementType = Field(
        default=StatementType.INCOME,
        description="Type of financial statement",
    )
    period: Literal["year", "quarter"] = Field(
        default="year",
        description="Reporting period: year or quarter",
    )
    limit: int = Field(
        default=5,
        ge=1,
        le=20,
        description="Number of periods to return",
    )

    @field_validator("symbol")
    @classmethod
    def uppercase_symbol(cls, v: str) -> str:
        return v.upper().strip()

    model_config = {
        "json_schema_extra": {
            "example": {
                "symbol": "VNM",
                "statement_type": "income",
                "period": "year",
                "limit": 5,
            }
        }
    }


class FinancialStatementData(BaseModel):
    """
    Standardized financial statement data.

    Generic structure for income/balance/cashflow statements.
    """

    symbol: str = Field(..., description="Stock ticker symbol")
    period: str = Field(..., description="Reporting period (e.g., 2024, Q1-2024)")
    statement_type: str = Field(..., description="Statement type")

    # Common metrics (populated based on statement type)
    revenue: float | None = Field(None, description="Total Revenue")
    gross_profit: float | None = Field(None, description="Gross Profit")
    operating_income: float | None = Field(None, description="Operating Income")
    net_income: float | None = Field(None, description="Net Income")
    ebitda: float | None = Field(None, description="EBITDA")
    eps: float | None = Field(None, description="Earnings Per Share")
    eps_diluted: float | None = Field(None, description="Diluted EPS")
    cost_of_revenue: float | None = Field(None, description="Cost of Revenue")
    pre_tax_profit: float | None = Field(None, description="Profit Before Tax")
    tax_expense: float | None = Field(None, description="Tax Expense")
    interest_expense: float | None = Field(None, description="Interest Expense")
    depreciation: float | None = Field(None, description="Depreciation")
    selling_general_admin: float | None = Field(None, description="Selling, General & Admin")
    research_development: float | None = Field(None, description="Research & Development")
    other_income: float | None = Field(None, description="Other Income")

    # Balance Sheet specific
    total_assets: float | None = Field(None, description="Total Assets")
    total_liabilities: float | None = Field(None, description="Total Liabilities")
    total_equity: float | None = Field(None, description="Total Equity")
    cash_and_equivalents: float | None = Field(None, description="Cash & Equivalents")
    equity: float | None = Field(None, description="Equity")
    cash: float | None = Field(None, description="Cash")
    inventory: float | None = Field(None, description="Inventory")
    current_assets: float | None = Field(None, description="Current Assets")
    fixed_assets: float | None = Field(None, description="Fixed Assets")
    current_liabilities: float | None = Field(None, description="Current Liabilities")
    long_term_liabilities: float | None = Field(None, description="Long-term Liabilities")
    retained_earnings: float | None = Field(None, description="Retained Earnings")
    short_term_debt: float | None = Field(None, description="Short-term Debt")
    long_term_debt: float | None = Field(None, description="Long-term Debt")
    accounts_receivable: float | None = Field(None, description="Accounts Receivable")
    accounts_payable: float | None = Field(None, description="Accounts Payable")
    goodwill: float | None = Field(None, description="Goodwill")
    intangible_assets: float | None = Field(None, description="Intangible Assets")

    # Cash Flow specific
    operating_cash_flow: float | None = Field(None, description="Operating Cash Flow")
    investing_cash_flow: float | None = Field(None, description="Investing Cash Flow")
    financing_cash_flow: float | None = Field(None, description="Financing Cash Flow")
    free_cash_flow: float | None = Field(None, description="Free Cash Flow")
    net_change_in_cash: float | None = Field(None, description="Net Change in Cash")
    capex: float | None = Field(None, description="Capital Expenditure")
    capital_expenditure: float | None = Field(None, description="Capital Expenditure")
    dividends_paid: float | None = Field(None, description="Dividends Paid")
    stock_repurchased: float | None = Field(None, description="Stock Repurchased")
    debt_repayment: float | None = Field(None, description="Debt Repayment")

    # Backward-compatible aliases used by existing widgets
    profit_before_tax: float | None = Field(None, description="Alias of pre_tax_profit")
    net_cash_flow: float | None = Field(None, description="Alias of net_change_in_cash")

    # Raw data for flexibility
    raw_data: dict[str, Any] | None = Field(None, description="Full raw statement data")

    updated_at: datetime | None = Field(None, description="Data timestamp")


class VnstockFinancialsFetcher(BaseFetcher[FinancialsQueryParams, FinancialStatementData]):
    """
    Fetcher for financial statements via vnstock library.

    Supports income statement, balance sheet, and cash flow statement.
    """

    provider_name = "vnstock"
    requires_credentials = False

    @staticmethod
    def transform_query(params: FinancialsQueryParams) -> dict[str, Any]:
        """Transform query params to vnstock-compatible format."""
        return {
            "symbol": params.symbol.upper(),
            "statement_type": params.statement_type.value,
            "period": params.period,
            "limit": params.limit,
        }

    @staticmethod
    @circuit_breaker(vnstock_cb)
    async def extract_data(
        query: dict[str, Any],
        credentials: dict[str, str] | None = None,
    ) -> list[dict[str, Any]]:
        """Fetch financial statement data from vnstock."""
        loop = asyncio.get_event_loop()

        def _fetch_sync() -> list[dict]:
            try:
                from vnstock import Vnstock

                stock = Vnstock().stock(symbol=query["symbol"], source=settings.vnstock_source)
                finance = stock.finance

                # Select statement type
                statement_type = query["statement_type"]
                period = query["period"]

                if statement_type == "income":
                    df = finance.income_statement(period=period)
                elif statement_type == "balance":
                    df = finance.balance_sheet(period=period)
                elif statement_type == "cashflow":
                    df = finance.cash_flow(period=period)
                else:
                    raise ValueError(f"Unknown statement type: {statement_type}")

                if df is None or df.empty:
                    logger.warning(f"No {statement_type} data for {query['symbol']}")
                    return []

                def _column_is_period(col: Any) -> bool:
                    col_str = str(col).strip().upper()
                    return bool(
                        re.match(r"^\d{4}$", col_str)
                        or re.match(r"^Q[1-4]-\d{4}$", col_str)
                        or re.match(r"^\d{4}-Q[1-4]$", col_str)
                        or re.match(r"^\d{4}Q[1-4]$", col_str)
                    )

                row_based = any(
                    c in df.columns for c in ["item", "item_id", "itemId", "item_name", "itemName"]
                ) and any(_column_is_period(c) for c in df.columns)

                # Limit records for period-based data only
                if not row_based:
                    df = df.head(query["limit"])

                # Preserve period from index when missing
                if "period" not in df.columns:
                    index_name = df.index.name or "index"
                    df = df.reset_index()
                    if "period" not in df.columns:
                        if index_name in df.columns:
                            df = df.rename(columns={index_name: "period"})
                        elif "index" in df.columns:
                            df = df.rename(columns={"index": "period"})

                records = df.to_dict("records")

                # Add metadata
                for record in records:
                    record["_statement_type"] = statement_type

                return records

            except Exception as e:
                logger.error(f"vnstock financials fetch error: {e}")
                raise ProviderError(
                    message=str(e),
                    provider="vnstock",
                    details={"symbol": query["symbol"]},
                ) from e

        try:
            return await asyncio.wait_for(
                loop.run_in_executor(None, _fetch_sync),
                timeout=settings.vnstock_timeout,
            )
        except TimeoutError as exc:
            raise ProviderTimeoutError(
                provider="vnstock",
                timeout=settings.vnstock_timeout,
            ) from exc

    @staticmethod
    def transform_data(
        params: FinancialsQueryParams,
        data: list[dict[str, Any]],
    ) -> list[FinancialStatementData]:
        """Transform raw financial data to standardized format."""
        results: list[FinancialStatementData] = []

        def _coerce_number(value: Any) -> float | None:
            if value is None:
                return None
            if isinstance(value, str) and value.strip().lower() in {"", "nan", "none", "null"}:
                return None
            try:
                number = float(value)
            except (TypeError, ValueError):
                return None
            if math.isnan(number):
                return None
            return number

        def _pick_number(*values: Any) -> float | None:
            for value in values:
                numeric = _coerce_number(value)
                if numeric is not None:
                    return numeric
            return None

        def _period_sort_key(period: str) -> int:
            if not period:
                return 0
            upper = period.upper()
            match_year = re.search(r"(20\d{2})", upper)
            year = int(match_year.group(1)) if match_year else 0
            match_quarter = re.search(r"Q([1-4])", upper)
            quarter = int(match_quarter.group(1)) if match_quarter else 0
            return year * 10 + quarter

        def _extract_period_columns(rows: list[dict[str, Any]]) -> list[str]:
            period_cols: set[str] = set()
            for row in rows:
                for key in row.keys():
                    key_str = str(key).strip().upper()
                    if (
                        re.match(r"^\d{4}$", key_str)
                        or re.match(r"^Q[1-4]-\d{4}$", key_str)
                        or re.match(r"^\d{4}-Q[1-4]$", key_str)
                        or re.match(r"^\d{4}Q[1-4]$", key_str)
                    ):
                        period_cols.add(key_str)
            return sorted(period_cols, key=_period_sort_key)

        def _normalize_item_key(raw_key: str) -> str:
            cleaned = raw_key.strip().lower().replace(" ", "_")
            cleaned = cleaned.split(".")[-1]
            cleaned = re.sub(r"[^a-z0-9_]", "", cleaned)
            return cleaned

        def _metric_mapping(statement: str) -> dict[str, str]:
            if statement == StatementType.INCOME.value:
                return {
                    "revenue": "revenue",
                    "net_revenue": "revenue",
                    "total_revenue": "revenue",
                    "sales_revenue": "revenue",
                    "revenue_from_sales": "revenue",
                    "revenue_from_sales_and_services": "revenue",
                    "net_sales": "revenue",
                    "interest_income_and_similar_income": "revenue",
                    "net_interest_income": "revenue",
                    "total_operating_revenue": "revenue",
                    "gross_profit": "gross_profit",
                    "grossprofit": "gross_profit",
                    "gross_profit_from_sales": "gross_profit",
                    "gross_profit_from_sale": "gross_profit",
                    "gross_profit_from_sales_and_services": "gross_profit",
                    "gross_profit_after_deduction": "gross_profit",
                    "operating_income": "operating_income",
                    "operating_profit": "operating_income",
                    "operating_profit_loss": "operating_income",
                    "profit_from_business_operations": "operating_income",
                    "operating_profit_from_sales": "operating_income",
                    "operatingincome": "operating_income",
                    "net_income": "net_income",
                    "profit_after_tax": "net_income",
                    "post_tax_profit": "net_income",
                    "profit_after_tax_of_parent_company": "net_income",
                    "profit_after_tax_of_parent_company_shareholders": "net_income",
                    "profit_after_tax_of_parent": "net_income",
                    "net_profit": "net_income",
                    "net_profit_after_tax": "net_income",
                    "net_profit_atttributable_to_the_equity_holders_of_the_bank": "net_income",
                    "ebitda": "ebitda",
                    "profit_before_tax_and_interest": "ebitda",
                    "eps": "eps",
                    "earning_per_share": "eps",
                    "earnings_per_share": "eps",
                    "basic_eps": "eps",
                    "eps_basic": "eps",
                    "earning_per_share_vnd": "eps",
                    "diluted_eps": "eps_diluted",
                    "eps_diluted": "eps_diluted",
                    "cost_of_goods_sold": "cost_of_revenue",
                    "cost_of_sales": "cost_of_revenue",
                    "cost_of_revenue": "cost_of_revenue",
                    "income_before_tax": "pre_tax_profit",
                    "profit_before_tax": "pre_tax_profit",
                    "pretax_income": "pre_tax_profit",
                    "income_tax": "tax_expense",
                    "income_tax_expense": "tax_expense",
                    "tax_expense": "tax_expense",
                    "corporate_income_tax": "tax_expense",
                    "interest_expense": "interest_expense",
                    "interest_cost": "interest_expense",
                    "depreciation": "depreciation",
                    "depreciation_and_amortization": "depreciation",
                    "selling_general_admin": "selling_general_admin",
                    "selling_expenses": "selling_general_admin",
                    "selling_and_admin_expenses": "selling_general_admin",
                    "research_and_development": "research_development",
                    "research_development": "research_development",
                    "rd_expense": "research_development",
                    "other_income": "other_income",
                }
            if statement == StatementType.BALANCE.value:
                return {
                    "total_assets": "total_assets",
                    "total_asset": "total_assets",
                    "assets_total": "total_assets",
                    "assets": "total_assets",
                    "total_liabilities": "total_liabilities",
                    "total_liability": "total_liabilities",
                    "liabilities_total": "total_liabilities",
                    "liabilities": "total_liabilities",
                    "total_equity": "total_equity",
                    "equity": "total_equity",
                    "shareholders_equity": "total_equity",
                    "owner_equity": "total_equity",
                    "owners_equity": "total_equity",
                    "equity_total": "total_equity",
                    "cash_and_equivalents": "cash_and_equivalents",
                    "cash_and_cash_equivalents": "cash_and_equivalents",
                    "cash": "cash_and_equivalents",
                    "cash_and_bank": "cash_and_equivalents",
                    "inventory": "inventory",
                    "inventories": "inventory",
                    "current_assets": "current_assets",
                    "fixed_assets": "fixed_assets",
                    "property_plant_and_equipment": "fixed_assets",
                    "current_liabilities": "current_liabilities",
                    "long_term_liabilities": "long_term_liabilities",
                    "non_current_liabilities": "long_term_liabilities",
                    "retained_earnings": "retained_earnings",
                    "short_term_debt": "short_term_debt",
                    "short_term_borrowings": "short_term_debt",
                    "long_term_debt": "long_term_debt",
                    "long_term_borrowings": "long_term_debt",
                    "accounts_receivable": "accounts_receivable",
                    "receivables": "accounts_receivable",
                    "accounts_payable": "accounts_payable",
                    "payables": "accounts_payable",
                    "goodwill": "goodwill",
                    "intangible_assets": "intangible_assets",
                }
            return {
                "operating_cash_flow": "operating_cash_flow",
                "net_cash_from_operating_activities": "operating_cash_flow",
                "cash_from_operating_activities": "operating_cash_flow",
                "net_cash_flow_from_operating_activities": "operating_cash_flow",
                "net_cash_flows_from_operating_activities": "operating_cash_flow",
                "cash_flows_from_operating_activities": "operating_cash_flow",
                "investing_cash_flow": "investing_cash_flow",
                "net_cash_from_investing_activities": "investing_cash_flow",
                "cash_from_investing_activities": "investing_cash_flow",
                "net_cash_flow_from_investing_activities": "investing_cash_flow",
                "net_cash_flows_from_investing_activities": "investing_cash_flow",
                "financing_cash_flow": "financing_cash_flow",
                "net_cash_from_financing_activities": "financing_cash_flow",
                "cash_from_financing_activities": "financing_cash_flow",
                "net_cash_flow_from_financing_activities": "financing_cash_flow",
                "net_cash_flows_from_financing_activities": "financing_cash_flow",
                "free_cash_flow": "free_cash_flow",
                "freecashflow": "free_cash_flow",
                "free_cashflow": "free_cash_flow",
                "net_cash_flows_during_the_period": "free_cash_flow",
                "net_change_in_cash": "net_change_in_cash",
                "net_cash_change": "net_change_in_cash",
                "capital_expenditure": "capex",
                "capex": "capex",
                "dividends_paid": "dividends_paid",
                "stock_repurchased": "stock_repurchased",
                "debt_repayment": "debt_repayment",
            }

        def _pivot_statement_rows(
            rows: list[dict[str, Any]],
        ) -> list[FinancialStatementData] | None:
            if not rows:
                return None
            period_cols = _extract_period_columns(rows)
            if not period_cols:
                return None
            item_rows = [
                r
                for r in rows
                if any(k in r for k in ["item", "item_id", "itemId", "item_name", "itemName"])
            ]
            if not item_rows:
                return None

            mapping = _metric_mapping(params.statement_type.value)
            period_values: dict[str, dict[str, float | None]] = {p: {} for p in period_cols}

            for row in item_rows:
                row_keys = {str(k).strip().upper(): k for k in row.keys()}
                raw_item = (
                    row.get("item_id")
                    or row.get("itemId")
                    or row.get("item")
                    or row.get("item_name")
                    or row.get("itemName")
                    or ""
                )
                item_key = _normalize_item_key(str(raw_item))
                metric_key = mapping.get(item_key)
                if not metric_key:
                    continue
                for period in period_cols:
                    raw_key = row_keys.get(period.upper())
                    value = row.get(raw_key) if raw_key is not None else None
                    numeric = _coerce_number(value)
                    if numeric is not None:
                        period_values[period][metric_key] = numeric

            # Keep latest periods by limit
            if params.limit:
                ordered_periods = sorted(period_cols, key=_period_sort_key)[-params.limit :]
            else:
                ordered_periods = sorted(period_cols, key=_period_sort_key)

            output: list[FinancialStatementData] = []
            for period in ordered_periods:
                metrics = period_values.get(period, {})
                total_equity = metrics.get("total_equity")
                cash_and_equivalents = metrics.get("cash_and_equivalents")
                output.append(
                    FinancialStatementData(
                        symbol=params.symbol.upper(),
                        period=str(period),
                        statement_type=params.statement_type.value,
                        revenue=metrics.get("revenue"),
                        gross_profit=metrics.get("gross_profit"),
                        operating_income=metrics.get("operating_income"),
                        net_income=metrics.get("net_income"),
                        ebitda=metrics.get("ebitda"),
                        eps=metrics.get("eps"),
                        eps_diluted=metrics.get("eps_diluted"),
                        cost_of_revenue=metrics.get("cost_of_revenue"),
                        pre_tax_profit=metrics.get("pre_tax_profit"),
                        tax_expense=metrics.get("tax_expense"),
                        interest_expense=metrics.get("interest_expense"),
                        depreciation=metrics.get("depreciation"),
                        selling_general_admin=metrics.get("selling_general_admin"),
                        research_development=metrics.get("research_development"),
                        other_income=metrics.get("other_income"),
                        profit_before_tax=metrics.get("pre_tax_profit"),
                        total_assets=metrics.get("total_assets"),
                        total_liabilities=metrics.get("total_liabilities"),
                        total_equity=total_equity,
                        cash_and_equivalents=cash_and_equivalents,
                        equity=total_equity,
                        cash=cash_and_equivalents,
                        inventory=metrics.get("inventory"),
                        current_assets=metrics.get("current_assets"),
                        fixed_assets=metrics.get("fixed_assets"),
                        current_liabilities=metrics.get("current_liabilities"),
                        long_term_liabilities=metrics.get("long_term_liabilities"),
                        retained_earnings=metrics.get("retained_earnings"),
                        short_term_debt=metrics.get("short_term_debt"),
                        long_term_debt=metrics.get("long_term_debt"),
                        accounts_receivable=metrics.get("accounts_receivable"),
                        accounts_payable=metrics.get("accounts_payable"),
                        goodwill=metrics.get("goodwill"),
                        intangible_assets=metrics.get("intangible_assets"),
                        operating_cash_flow=metrics.get("operating_cash_flow"),
                        investing_cash_flow=metrics.get("investing_cash_flow"),
                        financing_cash_flow=metrics.get("financing_cash_flow"),
                        free_cash_flow=metrics.get("free_cash_flow"),
                        net_change_in_cash=metrics.get("net_change_in_cash"),
                        net_cash_flow=metrics.get("net_change_in_cash"),
                        capex=metrics.get("capex"),
                        capital_expenditure=metrics.get("capex"),
                        dividends_paid=metrics.get("dividends_paid"),
                        stock_repurchased=metrics.get("stock_repurchased"),
                        debt_repayment=metrics.get("debt_repayment"),
                    )
                )
            return output

        pivoted = _pivot_statement_rows(data)
        if pivoted is not None:
            return pivoted

        for row in data:
            try:
                # Extract period identifier
                period = (
                    row.get("period")
                    or row.get("year")
                    or row.get("quarter")
                    or row.get("yearReport")
                    or row.get("fiscalYear")
                    or "Unknown"
                )
                if isinstance(period, (int, float)):
                    period = str(int(period))

                statement = FinancialStatementData(
                    symbol=params.symbol.upper(),
                    period=str(period),
                    statement_type=params.statement_type.value,
                    # Map common fields
                    revenue=_pick_number(row.get("revenue"), row.get("netRevenue")),
                    gross_profit=_pick_number(row.get("grossProfit")),
                    operating_income=_pick_number(
                        row.get("operatingProfit"), row.get("operatingIncome")
                    ),
                    net_income=_pick_number(row.get("netIncome"), row.get("postTaxProfit")),
                    ebitda=_pick_number(row.get("ebitda")),
                    eps=_pick_number(
                        row.get("eps"),
                        row.get("earningPerShare"),
                        row.get("earningsPerShare"),
                        row.get("earning_per_share"),
                        row.get("basicEps"),
                    ),
                    eps_diluted=_pick_number(row.get("epsDiluted"), row.get("dilutedEps")),
                    cost_of_revenue=_pick_number(
                        row.get("costOfRevenue"),
                        row.get("cost_of_revenue"),
                        row.get("costOfGoodsSold"),
                    ),
                    pre_tax_profit=_pick_number(
                        row.get("incomeBeforeTax"),
                        row.get("preTaxProfit"),
                        row.get("profitBeforeTax"),
                    ),
                    tax_expense=_pick_number(
                        row.get("incomeTax"), row.get("taxExpense"), row.get("incomeTaxExpense")
                    ),
                    interest_expense=_pick_number(
                        row.get("interestExpense"), row.get("interest_expense")
                    ),
                    depreciation=_pick_number(
                        row.get("depreciation"), row.get("depreciationAndAmortization")
                    ),
                    selling_general_admin=_pick_number(
                        row.get("sellingGeneralAdmin"), row.get("sellingExpenses")
                    ),
                    research_development=_pick_number(
                        row.get("researchDevelopment"), row.get("researchAndDevelopment")
                    ),
                    other_income=_pick_number(row.get("otherIncome"), row.get("other_income")),
                    profit_before_tax=_pick_number(
                        row.get("incomeBeforeTax"),
                        row.get("preTaxProfit"),
                        row.get("profitBeforeTax"),
                    ),
                    # Balance sheet
                    total_assets=_pick_number(row.get("totalAssets"), row.get("asset")),
                    total_liabilities=_pick_number(row.get("totalLiabilities"), row.get("debt")),
                    total_equity=_pick_number(row.get("totalEquity"), row.get("equity")),
                    cash_and_equivalents=_pick_number(
                        row.get("cash"), row.get("cashAndCashEquivalents")
                    ),
                    equity=_pick_number(row.get("totalEquity"), row.get("equity")),
                    cash=_pick_number(row.get("cash"), row.get("cashAndCashEquivalents")),
                    inventory=_pick_number(row.get("inventory"), row.get("inventories")),
                    current_assets=_pick_number(
                        row.get("currentAssets"), row.get("current_assets")
                    ),
                    fixed_assets=_pick_number(row.get("fixedAssets"), row.get("fixed_assets")),
                    current_liabilities=_pick_number(
                        row.get("currentLiabilities"), row.get("current_liabilities")
                    ),
                    long_term_liabilities=_pick_number(
                        row.get("longTermLiabilities"), row.get("long_term_liabilities")
                    ),
                    retained_earnings=_pick_number(
                        row.get("retainedEarnings"), row.get("retained_earnings")
                    ),
                    short_term_debt=_pick_number(
                        row.get("shortTermDebt"), row.get("short_term_debt")
                    ),
                    long_term_debt=_pick_number(row.get("longTermDebt"), row.get("long_term_debt")),
                    accounts_receivable=_pick_number(
                        row.get("accountsReceivable"), row.get("accounts_receivable")
                    ),
                    accounts_payable=_pick_number(
                        row.get("accountsPayable"), row.get("accounts_payable")
                    ),
                    goodwill=_pick_number(row.get("goodwill")),
                    intangible_assets=_pick_number(
                        row.get("intangibleAssets"), row.get("intangible_assets")
                    ),
                    # Cash flow
                    operating_cash_flow=_pick_number(
                        row.get("operatingCashFlow"), row.get("fromOperating")
                    ),
                    investing_cash_flow=_pick_number(
                        row.get("investingCashFlow"), row.get("fromInvesting")
                    ),
                    financing_cash_flow=_pick_number(
                        row.get("financingCashFlow"), row.get("fromFinancing")
                    ),
                    free_cash_flow=_pick_number(row.get("freeCashFlow")),
                    net_change_in_cash=_pick_number(
                        row.get("netChangeInCash"),
                        row.get("net_change_in_cash"),
                        row.get("netCashFlow"),
                    ),
                    net_cash_flow=_pick_number(
                        row.get("netChangeInCash"),
                        row.get("net_change_in_cash"),
                        row.get("netCashFlow"),
                    ),
                    capex=_pick_number(row.get("capex"), row.get("capitalExpenditure")),
                    capital_expenditure=_pick_number(
                        row.get("capex"), row.get("capitalExpenditure")
                    ),
                    dividends_paid=_pick_number(
                        row.get("dividendsPaid"), row.get("dividends_paid")
                    ),
                    stock_repurchased=_pick_number(
                        row.get("stockRepurchased"), row.get("stock_repurchased")
                    ),
                    debt_repayment=_pick_number(
                        row.get("debtRepayment"), row.get("debt_repayment")
                    ),
                    # Store raw data for flexibility
                    raw_data=None,
                    updated_at=datetime.utcnow(),
                )
                results.append(statement)

            except Exception as e:
                logger.warning(f"Skipping invalid financial row: {e}")
                continue

        return results
