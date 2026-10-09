"""
VnStock Financials Fetcher

Fetches financial statements (Income Statement, Balance Sheet, Cash Flow)
for Vietnam-listed companies via vnstock library.
"""

import inspect
import logging
import math
import re
import unicodedata
from datetime import UTC, datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from vnibb.core.config import settings
from vnibb.core.exceptions import ProviderError, ProviderTimeoutError
from vnibb.core.retry import circuit_breaker, vnstock_cb
from vnibb.providers.base import BaseFetcher

logger = logging.getLogger(__name__)

# Metrics that may be reported across multiple item rows (e.g. current + deferred
# income tax, or split SG&A lines) and must be SUMMED rather than overwritten when
# building period values. Shared by both the pivot and non-pivot transform paths.
_ADDITIVE_PIVOT_METRICS = {"tax_expense", "selling_general_admin"}

# Per metric, the raw row keys the shared wide-row statement constructor reads after
# `mapped_metrics`, in the constructor's own argument order. A key is listed whenever it
# is not mapped for every statement type: those keys used to reach the statement without
# passing `_normalize_value` and without a lineage entry, so an empty lineage could
# certify a unitless row as VND, and a key mapped only for another statement type was
# skipped by that type's first pass while the constructor still read it raw. The alias
# pass below walks this order, so the selected value is the one the constructor would
# have selected, independent of input dict order (issue #106).
_WIDE_ROW_ALIAS_METRICS: dict[str, tuple[str, ...]] = {
    "revenue": ("revenue", "netRevenue"),
    "gross_profit": ("grossProfit",),
    "operating_income": ("operatingProfit", "operatingIncome"),
    "net_income": ("netIncome", "postTaxProfit"),
    "ebitda": ("ebitda",),
    "eps": ("eps", "earningPerShare", "earningsPerShare", "earning_per_share", "basicEps"),
    "eps_diluted": ("epsDiluted", "dilutedEps"),
    "cost_of_revenue": ("costOfRevenue", "cost_of_revenue", "costOfGoodsSold"),
    "pre_tax_profit": ("incomeBeforeTax", "preTaxProfit", "profitBeforeTax"),
    "tax_expense": ("incomeTax", "taxExpense", "incomeTaxExpense"),
    "interest_expense": ("interestExpense", "interest_expense"),
    "depreciation": ("depreciation", "depreciationAndAmortization"),
    "selling_general_admin": ("sellingGeneralAdmin", "sellingExpenses"),
    "research_development": ("researchDevelopment", "researchAndDevelopment"),
    "other_income": ("otherIncome", "other_income"),
    "total_assets": ("totalAssets", "asset"),
    "total_liabilities": ("totalLiabilities", "debt"),
    "total_equity": ("totalEquity", "equity"),
    "cash_and_equivalents": ("cash", "cashAndCashEquivalents"),
    "inventory": ("inventory", "inventories"),
    "current_assets": ("currentAssets", "current_assets"),
    "fixed_assets": ("fixedAssets", "fixed_assets"),
    "current_liabilities": ("currentLiabilities", "current_liabilities"),
    "long_term_liabilities": ("longTermLiabilities", "long_term_liabilities"),
    "retained_earnings": ("retainedEarnings", "retained_earnings"),
    "short_term_debt": ("shortTermDebt", "short_term_debt"),
    "long_term_debt": ("longTermDebt", "long_term_debt"),
    "accounts_receivable": ("accountsReceivable", "accounts_receivable"),
    "accounts_payable": ("accountsPayable", "accounts_payable"),
    "customer_deposits": ("customerDeposits", "customer_deposits"),
    "goodwill": ("goodwill",),
    "intangible_assets": ("intangibleAssets", "intangible_assets"),
    "operating_cash_flow": ("operatingCashFlow", "fromOperating"),
    "investing_cash_flow": ("investingCashFlow", "fromInvesting"),
    "financing_cash_flow": ("financingCashFlow", "fromFinancing"),
    "free_cash_flow": ("freeCashFlow",),
    "net_change_in_cash": ("netChangeInCash", "net_change_in_cash", "netCashFlow"),
    "capex": ("capex", "capitalExpenditure"),
    "dividends_paid": ("dividendsPaid", "dividends_paid"),
    "stock_repurchased": ("stockRepurchased", "stock_repurchased"),
    "debt_repayment": ("debtRepayment", "debt_repayment"),
}


def _detach_source_reports(row: dict[str, Any]) -> list[dict[str, Any]]:
    """Take captured provider reports off a row so raw lineage is kept once per statement."""
    attrs = row.get("_provider_attrs")
    if isinstance(attrs, dict):
        reports = attrs.pop("source_reports", None)
        if isinstance(reports, list):
            return reports
    return []


def _collect_source_reports(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    reports: list[dict[str, Any]] = []
    seen: set[int] = set()
    for row in rows:
        for report in _detach_source_reports(row):
            if id(report) not in seen:
                seen.add(id(report))
                reports.append(report)
    return reports


def _reports_for_period(reports: list[dict[str, Any]], period: str) -> list[dict[str, Any]]:
    """Keep only the captured reports whose Head describes this period.

    A provider response carries one Head per period; retaining every page on every
    period row repeats the same payload once per metric and blows up the response.
    """
    normalized = str(period).upper()
    year = re.search(r"(20\d{2})", normalized)
    quarter = re.search(r"Q([1-4])", normalized)
    matched = []
    for report in reports:
        for head in report.get("Head") or[]:
            if year and str(head.get("YearPeriod")) != year.group(1):
                continue
            term = str(head.get("TermCode") or head.get("TermNameEN") or "").upper()
            if quarter and term not in {f"Q{quarter.group(1)}", f"QUARTER {quarter.group(1)}"}:
                continue
            matched.append(report)
            break
    return matched


_PERIOD_COLUMN_PATTERN = re.compile(r"^(?:Q[1-4]-\d{4}|\d{4}(?:-Q[1-4]|Q[1-4])?)$")


def _period_provider_rows(rows: list[dict[str, Any]], period: str) -> list[dict[str, Any]]:
    """Project provider rows down to this period's raw cells.

    The raw table is a full provider response: every period, every metric. Serving it
    whole on each period row repeats the same table once per period.
    """
    period_key = str(period).strip().upper()
    projected = []
    for row in rows:
        cells = {
            key: value
            for key, value in row.items()
            if key != "_provider_attrs"
            and (
                str(key).strip().upper() == period_key
                or not _PERIOD_COLUMN_PATTERN.match(str(key).strip().upper())
            )
        }
        projected.append(cells)
    return projected


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
        le=40,
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
    customer_deposits: float | None = Field(None, description="Customer Deposits")
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
    source: str | None = None
    currency: str | None = None
    value_unit: str | None = None
    unit_metadata: dict[str, Any] = Field(default_factory=dict)
    aggregation_basis: str | None = None
    source_periods: list[str] = Field(default_factory=list)
    unavailable_reason: str | None = None
    consolidation_basis: str | None = None
    flow_basis: str | None = None

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
        from vnibb.providers.vnstock.runtime import run_financial_provider

        def _fetch_sync() -> list[dict]:
            try:
                from vnibb.providers.vnstock.runtime import (
                    create_finance,
                    finance_method_kwargs,
                    get_finance_class,
                )

                Finance = get_finance_class()

                statement_type = query["statement_type"]
                period = query["period"]
                candidate_sources: list[str] = []
                # KBS is the default runtime source on vnstock 3.5.x, but VCI still
                # exposes richer financial statement labels/values for many symbols.
                for source in ["VCI", settings.vnstock_source, "KBS"]:
                    if source and source not in candidate_sources:
                        candidate_sources.append(source)
                if getattr(Finance, "supports_source", True) is False:
                    candidate_sources = ["default"]

                def _get_statement_method(finance: Any):
                    if statement_type == "income":
                        return finance.income_statement
                    if statement_type == "balance":
                        return finance.balance_sheet
                    if statement_type == "cashflow":
                        return finance.cash_flow

                    raise ValueError(f"Unknown statement type: {statement_type}")

                def _fetch_df(finance: Any, lang: str | None):
                    provider = getattr(finance, "_provider", finance)
                    provider_method = _get_statement_method(provider)
                    parameters = inspect.signature(provider_method, follow_wrapped=False).parameters
                    accepts_kwargs = any(item.kind == inspect.Parameter.VAR_KEYWORD for item in parameters.values())
                    if accepts_kwargs:
                        parameters = inspect.signature(provider_method).parameters
                    kwargs = finance_method_kwargs(provider_method, period)
                    kwargs = {key: value for key, value in kwargs.items() if key in parameters or accepts_kwargs}
                    if lang is None:
                        kwargs.pop("lang", None)
                    elif "lang" in kwargs:
                        kwargs["lang"] = lang
                    if "display_mode" in parameters:
                        kwargs["display_mode"] = "all"
                    if "dropna" in parameters:
                        kwargs["dropna"] = False
                    source_reports = []
                    parser = None
                    if type(provider).__module__ == "vnstock.explorer.kbs.financial":
                        parser = provider._parse_financial_response
                        def capture_response(response, *args, **kwargs):
                            source_reports.append(response)
                            return parser(response, *args, **kwargs)
                        provider._parse_financial_response = capture_response
                    try:
                        df = provider_method(**kwargs)
                    finally:
                        if parser is not None:
                            provider._parse_financial_response = parser
                    if df is not None and parser is not None:
                        df.attrs["value_unit"] = "VND"
                        df.attrs["provider_value_multiplier"] = 1000.0
                        df.attrs["normalization_contract"] = "vnstock.kbs._fetch_series_data: request unit=1000; ValueN * 1000"
                        df.attrs["source_reports"] = source_reports
                    return df

                def _score_statement_payload(rows: list[dict[str, Any]]) -> int:
                    if not rows:
                        return 0

                    def _normalize_metric_key(raw_key: Any) -> str:
                        cleaned = (
                            str(raw_key or "").strip().lower().replace("đ", "d").replace("Đ", "D")
                        )
                        cleaned = (
                            cleaned.replace("&", " and ")
                            .replace("%", " pct ")
                            .replace(".", "_")
                            .replace("/", "_")
                            .replace("-", "_")
                            .replace(" ", "_")
                        )
                        cleaned = (
                            unicodedata.normalize("NFKD", cleaned)
                            .encode("ascii", "ignore")
                            .decode("ascii")
                        )
                        cleaned = re.sub(r"[^a-z0-9_]", "", cleaned)
                        cleaned = re.sub(r"_+", "_", cleaned).strip("_")
                        return cleaned

                    period_columns = [
                        key
                        for key in rows[0].keys()
                        if re.match(
                            r"^(?:Q[1-4]-\d{4}|\d{4}-Q[1-4]|\d{4}Q[1-4]|\d{4})$", str(key).upper()
                        )
                    ]
                    available_items: set[str] = set()

                    for row in rows:
                        if not period_columns:
                            for key, value in row.items():
                                if key in {
                                    "period",
                                    "item",
                                    "item_id",
                                    "itemId",
                                    "item_name",
                                    "itemName",
                                    "_statement_type",
                                    "_source",
                                }:
                                    continue
                                try:
                                    numeric = float(value)
                                except (TypeError, ValueError):
                                    continue
                                if math.isnan(numeric):
                                    continue
                                available_items.add(_normalize_metric_key(key))
                            continue

                        item_key = _normalize_metric_key(
                            str(
                                row.get("item_id")
                                or row.get("itemId")
                                or row.get("item")
                                or row.get("item_name")
                                or row.get("itemName")
                                or ""
                            )
                        )
                        if not item_key:
                            continue
                        has_value = False
                        for period_column in period_columns:
                            value = row.get(period_column)
                            if value is None:
                                continue
                            try:
                                numeric = float(value)
                            except (TypeError, ValueError):
                                continue
                            if not math.isnan(numeric):
                                has_value = True
                                break
                        if has_value:
                            available_items.add(item_key)

                    score_targets = {
                        "income": (
                            {"revenue", "net_sales", "sales"},
                            {"cost_of_sales", "cost_of_revenue", "operating_expenses_21_33"},
                            {"operating_income", "operating_profit_loss"},
                            {"pre_tax_profit", "profit_before_tax", "income_before_tax"},
                            {"tax_expense", "income_tax", "business_income_tax_current"},
                            {
                                "selling_general_admin",
                                "selling_expenses",
                                "general_and_administrative_expenses",
                            },
                            {
                                "depreciation",
                                "depreciation_and_amortization",
                                "depreciation_and_amortisation",
                            },
                            {"research_development", "research_and_development", "rd_expense"},
                            {"ebitda"},
                            {
                                "net_income",
                                "net_profit_for_the_year",
                                "attribute_to_parent_company_bn_vnd",
                            },
                        ),
                        "balance": (
                            {"total_assets"},
                            {"total_liabilities"},
                            {"total_equity", "equity"},
                            {"current_assets"},
                            {"current_liabilities"},
                            {
                                "accounts_payable",
                                "trade_accounts_payable",
                                "short_term_trade_accounts_payable",
                            },
                            {"goodwill", "good_will_bn_vnd"},
                            {"intangible_assets", "intangible_fixed_assets"},
                        ),
                        "cashflow": (
                            {
                                "operating_cash_flow",
                                "net_cash_inflows_outflows_from_operating_activities",
                            },
                            {"investing_cash_flow", "net_cash_flows_from_investing_activities"},
                            {"financing_cash_flow", "cash_flows_from_financial_activities"},
                            {"capex", "capital_expenditure", "purchase_of_fixed_assets"},
                            {"free_cash_flow", "freecashflow", "free_cashflow"},
                            {"dividends_paid", "payments_of_dividends"},
                            {"depreciation", "depreciation_and_amortisation"},
                        ),
                    }

                    target_groups = score_targets.get(statement_type, ())
                    return sum(1 for group in target_groups if available_items.intersection(group))

                best_rows: list[dict[str, Any]] = []
                best_score = -1
                best_source: str | None = None
                best_lang: str | None = None
                candidate_payloads: list[tuple[str, str | None, list[dict[str, Any]], int]] = []
                last_error: Exception | None = None

                for source in candidate_sources:
                    try:
                        finance = create_finance(query["symbol"], source, period)
                    except Exception as source_init_error:
                        last_error = source_init_error
                        logger.debug(
                            "vnstock source init failed for %s source=%s: %s",
                            query["symbol"],
                            source,
                            source_init_error,
                        )
                        continue

                    try:
                        supports_lang = (
                            "lang" in inspect.signature(_get_statement_method(getattr(finance, "_provider", finance)), follow_wrapped=False).parameters
                        )
                    except (TypeError, ValueError):
                        supports_lang = False

                    lang_candidates: list[str | None] = (
                        ["en", None, "vi"] if supports_lang else [None]
                    )

                    for lang in lang_candidates:
                        if lang is None and any(candidate[0] == source for candidate in candidate_payloads):
                            continue
                        try:
                            df = _fetch_df(finance, lang)
                        except Exception as source_error:
                            last_error = source_error
                            logger.debug(
                                "vnstock %s fetch failed for %s source=%s lang=%s: %s",
                                statement_type,
                                query["symbol"],
                                source,
                                lang,
                                source_error,
                            )
                            continue

                        if df is not None and not df.empty:
                            normalized_rows = _normalize_financial_frame(
                                df,
                                query["limit"],
                                statement_type,
                                source,
                            )
                            params_model = FinancialsQueryParams(symbol=query["symbol"], statement_type=StatementType(statement_type), period=period, limit=query["limit"])
                            parsed = VnstockFinancialsFetcher.transform_data(params_model, normalized_rows)
                            score = _score_statement_payload([item.model_dump(mode="json") for item in parsed if not item.unavailable_reason])
                            candidate_payloads.append((source, lang, normalized_rows, score))
                            if score > best_score:
                                best_rows = normalized_rows
                                best_score = score
                                best_source = source
                                best_lang = lang
                            supplemental = {
                                "income": {"selling_general_admin", "depreciation", "research_development", "ebitda"},
                                "balance": {"accounts_payable", "goodwill", "intangible_assets"},
                                "cashflow": {"depreciation", "free_cash_flow", "capex", "capital_expenditure"},
                            }.get(statement_type, set())
                            parsed = VnstockFinancialsFetcher.transform_data(
                                FinancialsQueryParams(symbol=query["symbol"], statement_type=StatementType(statement_type),
                                    period=period, limit=query["limit"]), normalized_rows
                            )
                            if parsed and all(all(getattr(item, field, None) is not None for field in supplemental) for item in parsed):
                                break

                if best_rows:
                    params_model = FinancialsQueryParams(
                        symbol=query["symbol"],
                        statement_type=StatementType(statement_type),
                        period=query["period"],
                        limit=query["limit"],
                    )
                    merged_rows = VnstockFinancialsFetcher.transform_data(params_model, best_rows)

                    supplemental_fields = {
                        "income": {
                            "selling_general_admin",
                            "depreciation",
                            "research_development",
                            "ebitda",
                        },
                        "balance": {"accounts_payable", "goodwill", "intangible_assets"},
                        "cashflow": {
                            "depreciation",
                            "free_cash_flow",
                            "capex",
                            "capital_expenditure",
                        },
                    }.get(statement_type, set())

                    if supplemental_fields:

                        def _merged_period_sort_key(period_value: str) -> int:
                            upper = str(period_value or "").upper()
                            year_match = re.search(r"(20\d{2})", upper)
                            year = int(year_match.group(1)) if year_match else 0
                            quarter_match = re.search(r"Q([1-4])", upper)
                            quarter = int(quarter_match.group(1)) if quarter_match else 0
                            return year * 10 + quarter

                        def _period_identity(item: FinancialStatementData) -> str:
                            return str(item.period or "").strip().upper()

                        merged_by_period = {
                            _period_identity(item): item
                            for item in merged_rows
                            if _period_identity(item)
                        }

                        for source, lang, rows, score in candidate_payloads:
                            if source == best_source and lang == best_lang and score == best_score:
                                continue

                            alt_rows = VnstockFinancialsFetcher.transform_data(params_model, rows)
                            for alt_item in alt_rows:
                                identity = _period_identity(alt_item)
                                if not identity:
                                    continue
                                base_item = merged_by_period.get(identity)
                                if base_item is None:
                                    merged_by_period[identity] = alt_item
                                    continue
                                base_basis = {str(item.get("consolidation_basis")) for item in base_item.unit_metadata.values()}
                                alternate_basis = {str(item.get("consolidation_basis")) for item in alt_item.unit_metadata.values()}
                                if base_item.value_unit != "VND" or alt_item.value_unit != "VND" or base_basis != alternate_basis:
                                    continue

                                for field_name in supplemental_fields:
                                    if (
                                        getattr(base_item, field_name, None) is None
                                        and getattr(alt_item, field_name, None) is not None
                                    ):
                                        setattr(
                                            base_item, field_name, getattr(alt_item, field_name)
                                        )
                                        base_item.unit_metadata[field_name] = alt_item.unit_metadata.get(field_name, {})

                                base_item.raw_data = {"primary": base_item.raw_data, "supplemental": alt_item.raw_data}

                        merged_rows = sorted(
                            merged_by_period.values(),
                            key=lambda item: _merged_period_sort_key(str(item.period or "")),
                            reverse=True,
                        )

                    if best_source and best_source != settings.vnstock_source:
                        logger.info(
                            "Using richer fallback vnstock source for %s %s: %s (lang=%s score=%s)",
                            query["symbol"],
                            statement_type,
                            best_source,
                            best_lang,
                            best_score,
                        )
                    return [item.model_dump(mode="json") for item in merged_rows]

                if last_error is not None and not candidate_payloads:
                    raise last_error
                logger.warning(f"No {statement_type} data for {query['symbol']}")
                return []

            except Exception as e:
                logger.error(f"vnstock financials fetch error: {e}")
                raise ProviderError(
                    message=str(e),
                    provider="vnstock",
                    details={"symbol": query["symbol"]},
                ) from e

        def _normalize_financial_frame(
            df: Any, limit: int, statement_type: str, source: str
        ) -> list[dict[str, Any]]:
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
                df = df.head(limit)

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

            fetched_at = datetime.now(UTC).isoformat()
            # Add metadata
            for record in records:
                record["_statement_type"] = statement_type
                record["_source"] = source
                record["_fetched_at"] = fetched_at
                record["_provider_attrs"] = dict(getattr(df, "attrs", {}))
                record["_provider_value_multiplier"] = df.attrs.get("provider_value_multiplier", 1.0)
                record["_value_unit"] = df.attrs.get("value_unit")
                record["_normalization_contract"] = df.attrs.get("normalization_contract")

            return records

        try:
            return await run_financial_provider(_fetch_sync, settings.vnstock_timeout)
        except TimeoutError as exc:
            raise ProviderTimeoutError(
                provider="vnstock",
                timeout_seconds=settings.vnstock_timeout,
            ) from exc

    @staticmethod
    def transform_data(
        params: FinancialsQueryParams,
        data: list[dict[str, Any]],
    ) -> list[FinancialStatementData]:
        """Transform raw financial data to standardized format."""
        results: list[FinancialStatementData] = []
        if data and all(row.get("statement_type") and "unit_metadata" in row for row in data):
            return [FinancialStatementData.model_validate(row) for row in data]

        def _coerce_number(value: Any) -> float | None:
            if value is None:
                return None
            if isinstance(value, str) and value.strip().lower() in {"", "nan", "none", "null"}:
                return None
            try:
                number = float(value)
            except (TypeError, ValueError):
                return None
            if not math.isfinite(number):
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
            raw_key = re.sub(r"\s*\((?:Bn\.?\s*VND|VND|đồng)\)\s*$", "", raw_key, flags=re.IGNORECASE)
            cleaned = raw_key.strip().lower().replace("đ", "d").replace("Đ", "D")
            cleaned = (
                cleaned.replace("&", " and ")
                .replace("%", " pct ")
                .replace(".", "_")
                .replace("/", "_")
                .replace("-", "_")
                .replace(" ", "_")
            )
            cleaned = (
                unicodedata.normalize("NFKD", cleaned).encode("ascii", "ignore").decode("ascii")
            )
            cleaned = re.sub(r"[^a-z0-9_]", "", cleaned)
            cleaned = re.sub(r"_+", "_", cleaned).strip("_")
            while True:
                stripped = re.sub(r"^(?:n(?:_\d+)+|[ivxlcdm]+|[a-z])_", "", cleaned)
                if stripped == cleaned:
                    break
                cleaned = stripped
            return cleaned

        def _report_basis(row: dict[str, Any], period: str) -> dict[str, Any]:
            normalized = str(period).upper()
            year = re.search(r"(20\d{2})", normalized)
            quarter = re.search(r"Q([1-4])", normalized)
            for report in (row.get("_provider_attrs") or {}).get("source_reports", []):
                for head in report.get("Head", []):
                    if not year or str(head.get("YearPeriod")) != year.group(1):
                        continue
                    term = str(head.get("TermCode") or head.get("TermNameEN") or "").upper()
                    if quarter and term not in {f"Q{quarter.group(1)}", f"QUARTER {quarter.group(1)}"}:
                        continue
                    scope = next((unit.get("UnitedNameEN") or unit.get("UnitedName") for unit in report.get("Unit", [])
                                  if unit.get("UnitedCode") == head.get("United")), head.get("United"))
                    result = {"consolidation_basis": scope, "source_head": head}
                    if quarter:
                        q = int(quarter.group(1))
                        begin = f"{year.group(1)}{(q - 1) * 3 + 1:02d}"
                        end = f"{year.group(1)}{q * 3:02d}"
                        if str(head.get("PeriodBegin")) == begin and str(head.get("PeriodEnd")) == end:
                            result["flow_basis"] = "single_quarter"
                        elif str(head.get("PeriodBegin")) == f"{year.group(1)}01" and str(head.get("PeriodEnd")) == end:
                            result["flow_basis"] = "cumulative_ytd"
                    return result
            return {"consolidation_basis": row.get("consolidation_basis"), "flow_basis": row.get("flow_basis")}

        def _normalize_value(value: Any, row: dict[str, Any], label: str, metric: str, period: str):
            source = str(row.get("_source") or "").upper()
            unit = row.get("_value_unit") or row.get("unit")
            provider_multiplier = float(row.get("_provider_value_multiplier") or 1)
            descriptor = str(unit or "").strip().lower()
            descriptor = unicodedata.normalize("NFKD", descriptor.replace("đ", "d"))
            descriptor = "".join(char for char in descriptor if not unicodedata.combining(char))
            factors = {"vnd": 1, "dong": 1, "nghin dong": 1000, "ngan dong": 1000,
                       "thousand vnd": 1000, "trieu dong": 1_000_000, "million vnd": 1_000_000,
                       "ty dong": 1_000_000_000, "bn. vnd": 1_000_000_000, "billion vnd": 1_000_000_000}
            source_factor = factors.get(descriptor)
            if not source and not unit:
                source_factor = 1
                unit = "VND"
            metadata = {"source": source or None, "label": label, "source_unit": unit,
                        "provider_value": value, "provider_multiplier": provider_multiplier,
                        "value_unit": "VND/share" if metric in {"eps", "eps_diluted"} else "VND"}
            metadata.update(_report_basis(row, period))
            metadata["normalization_contract"] = row.get("_normalization_contract")
            metadata["source_label"] = row.get("item_en") or row.get("item") or label
            metadata["fetched_at"] = row.get("_fetched_at")
            reports = (row.get("_provider_attrs") or {}).get("source_reports", [])
            head = metadata.get("source_head")
            if head is not None:
                for report in reports:
                    if head not in report.get("Head", []):
                        continue
                    for source_rows in report.get("Content", {}).values():
                        source_row = next((item for item in source_rows if item.get("NameEn") == row.get("item_en")
                            or item.get("Name") == row.get("item")), None)
                        if source_row is not None:
                            metadata["source_record"] = source_row
                            metadata["raw_value"] = source_row.get(f"Value{head.get('ID')}")
                            metadata["raw_unit"] = source_row.get("Unit") or "thousand VND (request unit=1000)"
                            break
            numeric = _coerce_number(value)
            if source_factor is None:
                metadata["unavailable_reason"] = "unknown_source_unit"
                return None, metadata
            multiplier = (1 / provider_multiplier if metric in {"eps", "eps_diluted"} else 1.0) if row.get("_normalization_contract") else source_factor / provider_multiplier
            metadata["normalization_multiplier"] = multiplier
            metadata.setdefault("raw_value", numeric / provider_multiplier if numeric is not None else None)
            return numeric * multiplier if numeric is not None else None, metadata


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
                    "revenue_from_securities_business_01_11": "revenue",
                    "interest_income_and_similar_income": "revenue",
                    "interest_and_similar_income": "revenue",
                    "net_interest_income": "revenue",
                    "total_operating_revenue": "revenue",
                    "tong_thu_nhap_hoat_dong": "revenue",
                    "gross_profit": "gross_profit",
                    "grossprofit": "gross_profit",
                    "gross_profit_from_sales": "gross_profit",
                    "gross_profit_from_sale": "gross_profit",
                    "gross_profit_from_sales_and_services": "gross_profit",
                    "gross_profit_after_deduction": "gross_profit",
                    "thu_nhap_lai_thuan": "gross_profit",
                    "operating_income": "operating_income",
                    "operating_profit": "operating_income",
                    "operating_profit_loss": "operating_income",
                    "profit_from_business_operations": "operating_income",
                    "operating_profit_from_sales": "operating_income",
                    "operating_profit_before_provision": "operating_income",
                    "ln_tu_hdkd_truoc_cf_du_phong": "operating_income",
                    "operatingincome": "operating_income",
                    "net_income": "net_income",
                    "profit_after_tax": "net_income",
                    "post_tax_profit": "net_income",
                    "profit_after_tax_of_parent_company": "net_income",
                    "profit_after_tax_of_parent_company_shareholders": "net_income",
                    "profit_after_tax_of_parent": "net_income",
                    "loi_nhuan_sau_thue_cua_co_dong_cong_ty_me_dong": "net_income",
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
                    "lai_co_ban_tren_co_phieu": "eps",
                    "eps_basis": "eps",
                    "diluted_eps": "eps_diluted",
                    "eps_diluted": "eps_diluted",
                    "diluted_earning_per_share": "eps_diluted",
                    "cost_of_goods_sold": "cost_of_revenue",
                    "cost_of_sales": "cost_of_revenue",
                    "cost_of_revenue": "cost_of_revenue",
                    "operating_expenses_21_33": "cost_of_revenue",
                    "income_before_tax": "pre_tax_profit",
                    "profit_before_tax": "pre_tax_profit",
                    "pretax_income": "pre_tax_profit",
                    "income_tax": "tax_expense",
                    "income_tax_expense": "tax_expense",
                    "tax_expense": "tax_expense",
                    "tax_for_the_year": "tax_expense",
                    "corporate_income_tax": "tax_expense",
                    "thue_tndn": "tax_expense",
                    "interest_expense": "interest_expense",
                    "interest_expenses": "interest_expense",
                    "interest_cost": "interest_expense",
                    "interest_and_similar_expenses": "interest_expense",
                    "borrowing_costs": "interest_expense",
                    "interest_expenses_losses_from_loans_and_receivables": "interest_expense",
                    "depreciation": "depreciation",
                    "depreciation_and_amortization": "depreciation",
                    "selling_general_admin": "selling_general_admin",
                    "selling_expenses": "selling_general_admin",
                    "selling_and_admin_expenses": "selling_general_admin",
                    "general_and_administrative_expenses": "selling_general_admin",
                    "research_and_development": "research_development",
                    "research_development": "research_development",
                    "rd_expense": "research_development",
                    "other_income": "other_income",
                    "other_profit": "other_income",
                    # VCI wide-frame English aliases
                    "revenue_bn_vnd": "revenue",
                    "sales": "revenue",
                    "sales_deductions": "revenue",
                    "financial_income": "other_income",
                    "financial_expenses": "interest_expense",
                    "general_and_admin_expenses": "selling_general_admin",
                    "other_income_expenses": "other_income",
                    "net_other_income_expenses": "other_income",
                    "business_income_tax_current": "tax_expense",
                    "business_income_tax_deferred": "tax_expense",
                    "current_corporate_income_tax_expenses": "tax_expense",
                    "deferred_income_tax_expenses": "tax_expense",
                    "net_profit_for_the_year": "net_income",
                    "attributable_to_parent_company": "net_income",
                    "profit_after_tax_for_shareholders_of_the_parents_company": "net_income",
                    "attribute_to_parent_company_bn_vnd": "net_income",
                    # VCI wide-frame Vietnamese aliases
                    "doanh_thu_dong": "revenue",
                    "doanh_thu_ban_hang_va_cung_cap_dich_vu": "revenue",
                    "doanh_thu_thuan": "revenue",
                    "gia_von_hang_ban": "cost_of_revenue",
                    "lai_gop": "gross_profit",
                    "chi_phi_tien_lai_vay": "interest_expense",
                    "chi_phi_tai_chinh": "interest_expense",
                    "chi_phi_ban_hang": "selling_general_admin",
                    "chi_phi_quan_ly_dn": "selling_general_admin",
                    "chi_phi_quan_ly_doanh_nghiep": "selling_general_admin",
                    "management_expense": "selling_general_admin",
                    "lai_lo_tu_hoat_dong_kinh_doanh": "operating_income",
                    "ln_truoc_thue": "pre_tax_profit",
                    "chi_phi_thue_tndn": "tax_expense",
                    "chi_phi_thue_tndn_hien_hanh": "tax_expense",
                    "chi_phi_thue_tndn_hoan_lai": "tax_expense",
                    "corporate_income_tax_current": "tax_expense",
                    "corporate_income_tax_deferred": "tax_expense",
                    "thu_nhap_lai_va_cac_khoan_tuong_tu": "revenue",
                    "chi_phi_lai_va_cac_khoan_tuong_tu": "interest_expense",
                    "loi_nhuan_thuan": "net_income",
                    "co_dong_cua_cong_ty_me_dong": "net_income",
                    "co_dong_cua_cong_ty_me": "net_income",
                    "thu_nhap_khac": "other_income",
                    "loi_nhuan_khac": "other_income",
                    # Requested compatibility aliases
                    "chi_phi_lai_vay": "interest_expense",
                    "interest_and_similar_expense": "interest_expense",
                    "chi_phi_khau_hao": "depreciation",
                    "khau_hao_tai_san_co_dinh": "depreciation",
                    "depreciation_of_fixed_assets": "depreciation",
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
                    "owners_equity_bn_vnd": "total_equity",
                    "owners_equitybn_vnd": "total_equity",
                    "equity_total": "total_equity",
                    "total_owners_equity_and_liabilities": "total_assets",
                    "cash_and_equivalents": "cash_and_equivalents",
                    "cash_and_cash_equivalents": "cash_and_equivalents",
                    "cash": "cash_and_equivalents",
                    "cash_and_bank": "cash_and_equivalents",
                    "inventory": "inventory",
                    "inventories": "inventory",
                    "current_assets": "current_assets",
                    "short_term_assets": "current_assets",
                    "fixed_assets": "fixed_assets",
                    "property_plant_and_equipment": "fixed_assets",
                    "current_liabilities": "current_liabilities",
                    "long_term_liabilities": "long_term_liabilities",
                    "non_current_liabilities": "long_term_liabilities",
                    "retained_earnings": "retained_earnings",
                    "undistributed_earnings_after_tax": "retained_earnings",
                    "short_term_debt": "short_term_debt",
                    "short_term_borrowings": "short_term_debt",
                    "long_term_debt": "long_term_debt",
                    "long_term_borrowings": "long_term_debt",
                    "accounts_receivable": "accounts_receivable",
                    "trade_accounts_receivable": "accounts_receivable",
                    "loans_and_advances_to_customers": "accounts_receivable",
                    "loans_and_advances_to_customers_net": "accounts_receivable",
                    "receivables": "accounts_receivable",
                    "accounts_payable": "accounts_payable",
                    "trade_accounts_payable": "accounts_payable",
                    "short_term_trade_accounts_payable": "accounts_payable",
                    "long_term_trade_payables": "accounts_payable",
                    "payables": "accounts_payable",
                    "customer_deposits": "customer_deposits",
                    "deposits_from_customers": "customer_deposits",
                    "goodwill": "goodwill",
                    "intangible_assets": "intangible_assets",
                    "intagible_fixed_assets": "intangible_assets",
                    # VCI wide-frame English aliases
                    "total_assets_bn_vnd": "total_assets",
                    "total_resources_bn_vnd": "total_assets",
                    "current_assets_bn_vnd": "current_assets",
                    "cash_and_cash_equivalents_bn_vnd": "cash_and_equivalents",
                    "accounts_receivable_bn_vnd": "accounts_receivable",
                    "net_inventories": "inventory",
                    "inventories_net_bn_vnd": "inventory",
                    "fixed_assets_bn_vnd": "fixed_assets",
                    "liabilities_bn_vnd": "total_liabilities",
                    "current_liabilities_bn_vnd": "current_liabilities",
                    "long_term_liabilities_bn_vnd": "long_term_liabilities",
                    "owners_equitybnvnd": "total_equity",
                    "capital_and_reserves_bn_vnd": "total_equity",
                    "undistributed_earnings_bn_vnd": "retained_earnings",
                    "short_term_borrowings_bn_vnd": "short_term_debt",
                    "long_term_borrowings_bn_vnd": "long_term_debt",
                    "good_will_bn_vnd": "goodwill",
                    "long_term_trade_receivables_bn_vnd": "accounts_receivable",
                    # VCI wide-frame Vietnamese aliases
                    "tong_cong_tai_san_dong": "total_assets",
                    "tong_cong_nguon_von_dong": "total_assets",
                    "tai_san_ngan_han": "current_assets",
                    "tai_san_ngan_han_dong": "current_assets",
                    "short_term_asset": "current_assets",
                    "short_term_assets": "current_assets",
                    "tien_va_tuong_duong_tien_dong": "cash_and_equivalents",
                    "cac_khoan_phai_thu_ngan_han_dong": "accounts_receivable",
                    "phai_thu_ngan_han": "accounts_receivable",
                    "short_term_trade_receivable": "accounts_receivable",
                    "short_term_receivables": "accounts_receivable",
                    "hang_ton_kho_rong": "inventory",
                    "hang_ton_kho_rong_dong": "inventory",
                    "tai_san_co_dinh_dong": "fixed_assets",
                    "no_phai_tra_dong": "total_liabilities",
                    "no_ngan_han": "current_liabilities",
                    "no_ngan_han_dong": "current_liabilities",
                    "short_term_liability": "current_liabilities",
                    "short_term_liabilities": "current_liabilities",
                    "no_dai_han_dong": "long_term_liabilities",
                    "von_chu_so_huu_dong": "total_equity",
                    "von_chu_so_huu": "total_equity",
                    "von_va_cac_quy_dong": "total_equity",
                    "lai_chua_phan_phoi_dong": "retained_earnings",
                    "loi_nhuan_chua_phan_phoi": "retained_earnings",
                    "undistributed_earnings": "retained_earnings",
                    "retained_profit": "retained_earnings",
                    "vay_ngan_han": "short_term_debt",
                    "vay_va_no_thue_tai_chinh_ngan_han_dong": "short_term_debt",
                    "vay_dai_han": "long_term_debt",
                    "vay_va_no_thue_tai_chinh_dai_han_dong": "long_term_debt",
                    "phai_tra_nguoi_ban": "accounts_payable",
                    "tien_gui_cua_khach_hang": "customer_deposits",
                    "short_term_trade_payable": "accounts_payable",
                    "loi_the_thuong_mai": "goodwill",
                    "loi_the_thuong_mai_dong": "goodwill",
                    "tai_san_vo_hinh": "intangible_assets",
                    "intangible_fixed_assets": "intangible_assets",
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
                "net_cash_flows_during_the_period": "net_change_in_cash",
                "net_change_in_cash": "net_change_in_cash",
                "net_cash_change": "net_change_in_cash",
                "capital_expenditure": "capex",
                "capex": "capex",
                "dividends_paid": "dividends_paid",
                "stock_repurchased": "stock_repurchased",
                "debt_repayment": "debt_repayment",
                # VCI wide-frame English aliases
                "net_cash_flows_from_securities_trading_activities": "operating_cash_flow",
                "net_cash_inflows_outflows_from_operating_activities": "operating_cash_flow",
                "cash_flows_from_financial_activities": "financing_cash_flow",
                "net_increase_decrease_in_cash_and_cash_equivalents": "net_change_in_cash",
                "purchase_of_fixed_assets": "capex",
                "payments_for_purchase_of_fixed_assets": "capex",
                "payment_for_fixed_assets_constructions_and_other_long_term_assets": "capex",
                "payments_of_dividends": "dividends_paid",
                "dividends_paid_profits_distributed_to_owners": "dividends_paid",
                "repayment_of_borrowings": "debt_repayment",
                "principal_payments_of_borrowings": "debt_repayment",
                "principal_repayments": "debt_repayment",
                "principal_repayments_to_settlement_assistance_fund": "debt_repayment",
                "principal_repayments_to_financial_assets": "debt_repayment",
                "other_principal_repayments": "debt_repayment",
                "depreciation_and_amortisation": "depreciation",
                # VCI wide-frame Vietnamese aliases
                "luu_chuyen_tien_te_rong_tu_cac_hoat_dong_sxkd": "operating_cash_flow",
                "luu_chuyen_tu_hoat_dong_dau_tu": "investing_cash_flow",
                "luu_chuyen_tien_tu_hoat_dong_tai_chinh": "financing_cash_flow",
                "luu_chuyen_tien_thuan_trong_ky": "net_change_in_cash",
                "tang_giam_tien_thuan": "net_change_in_cash",
                "net_increase_decrease_in_cash": "net_change_in_cash",
                "mua_sam_tai_san_co_dinh": "capex",
                "mua_sam_tscd": "capex",
                "chi_phi_dau_tu_tai_san_co_dinh": "capex",
                "chi_tra_co_tuc": "dividends_paid",
                "co_tuc_da_tra": "dividends_paid",
                "dividends_interest_paid": "dividends_paid",
                "tra_no_goc_vay": "debt_repayment",
                "tien_tra_cac_khoan_di_vay": "debt_repayment",
                "khau_hao_tscd": "depreciation",
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
            period_metadata: dict[str, dict[str, Any]] = {p: {} for p in period_cols}

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
                # KBS cash is the cash-only component, not cash plus equivalents.
                if item_key == "cash" and str(row.get("_source") or "").upper() == "KBS":
                    continue
                metric_key = mapping.get(item_key)
                if not metric_key:
                    continue
                for period in period_cols:
                    raw_key = row_keys.get(period.upper())
                    if raw_key is None:
                        continue
                    value = row.get(raw_key) if raw_key is not None else None
                    numeric, metadata = _normalize_value(value, row, str(raw_item), metric_key, period)
                    if numeric is None and _coerce_number(value) is None:
                        continue
                    previous_metadata = period_metadata[period].get(metric_key)
                    if previous_metadata and previous_metadata.get("unavailable_reason") == "conflicting_metric_rows":
                        continue
                    if previous_metadata and metric_key not in _ADDITIVE_PIVOT_METRICS and previous_metadata.get("provider_value") != value:
                        period_values[period][metric_key] = None
                        period_metadata[period][metric_key] = {"unavailable_reason": "conflicting_metric_rows",
                                                              "components": [previous_metadata, metadata]}
                        continue
                    period_metadata[period][metric_key] = metadata
                    if numeric is not None:
                        if (
                            metric_key in _ADDITIVE_PIVOT_METRICS
                            and metric_key in period_values[period]
                            and period_values[period][metric_key] is not None
                        ):
                            period_values[period][metric_key] += numeric
                            metadata["components"] = (previous_metadata.get("components") or [previous_metadata]) + [dict(metadata)]
                        else:
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
                lineage = period_metadata[period]
                basis = _report_basis(item_rows[0], period)
                output.append(
                    FinancialStatementData(
                        symbol=params.symbol.upper(),
                        period=str(period),
                        statement_type=params.statement_type.value,
                        source=str(item_rows[0].get("_source") or "") or None,
                        currency="VND",
                        value_unit="VND" if all(item.get("unavailable_reason") != "unknown_source_unit" for item in lineage.values()) else None,
                        unit_metadata=lineage,
                        consolidation_basis=basis.get("consolidation_basis"),
                        flow_basis=basis.get("flow_basis"),
                        unavailable_reason="unknown_source_unit" if any(item.get("unavailable_reason") == "unknown_source_unit" for item in lineage.values()) else None,
                        raw_data={"provider_rows": item_rows, "period": period},
                        updated_at=datetime.now(UTC),
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
                        customer_deposits=metrics.get("customer_deposits"),
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
            # The captured HTTP payload is provenance, not a per-period value: project
            # only this period's raw cells and matching report instead of repeating the
            # whole provider response inside every metric of every period.
            source_reports = _collect_source_reports(item_rows)
            for statement in output:
                statement.raw_data = {
                    "provider_rows": _period_provider_rows(item_rows, statement.period),
                    "period": statement.period,
                }
                reports = _reports_for_period(source_reports, statement.period)
                if reports:
                    statement.raw_data["source_reports"] = reports
            return output

        pivoted = _pivot_statement_rows(data)
        if pivoted is not None:
            return pivoted

        statement_mapping = _metric_mapping(params.statement_type.value)
        additive_metrics = _ADDITIVE_PIVOT_METRICS

        for row in data:
            try:
                normalized_row: dict[str, Any] = {}
                mapped_metrics: dict[str, float] = {}
                lineage: dict[str, Any] = {}
                for key, value in row.items():
                    normalized_key = _normalize_item_key(str(key))
                    if not normalized_key:
                        continue
                    normalized_row[normalized_key] = value
                    metric_key = statement_mapping.get(normalized_key)
                    if not metric_key:
                        continue
                    numeric, metadata = _normalize_value(value, row, str(key), metric_key, str(row.get("period") or row.get("yearReport") or row.get("year") or ""))
                    lineage[metric_key] = metadata
                    if numeric is None:
                        continue
                    if metric_key in additive_metrics and metric_key in mapped_metrics:
                        mapped_metrics[metric_key] = mapped_metrics[metric_key] + numeric
                    else:
                        mapped_metrics[metric_key] = numeric

                # Extract period identifier
                year_hint = (
                    row.get("yearReport")
                    or row.get("fiscalYear")
                    or normalized_row.get("yearreport")
                    or normalized_row.get("nam")
                )
                raw_period = row.get("period") or row.get("quarter") or row.get("year")
                period: Any = year_hint or raw_period or "Unknown"

                if params.period == "quarter" and year_hint is not None:
                    quarter_hint = (
                        row.get("quarter")
                        or row.get("fiscalQuarter")
                        or row.get("lengthReport")
                        or row.get("length_report")
                        or row.get("period")
                    )
                    try:
                        quarter_value = int(float(quarter_hint))
                    except (TypeError, ValueError):
                        quarter_value = None
                    if quarter_value is not None and 1 <= quarter_value <= 4:
                        period = f"Q{quarter_value}-{int(float(year_hint))}"

                if isinstance(period, (int, float)):
                    period = str(int(period))

                # The constructor below also reads the row keys in
                # `_WIDE_ROW_ALIAS_METRICS`. Walk them in the constructor's own order so
                # the selected value does not depend on input dict order, normalize it on
                # the same unit contract, and record lineage for it, so no populated
                # metric is certified without unit evidence. The first present alias is
                # final: a unit-rejected one is not silently replaced by a lower-priority
                # alias. A metric already supplied by a mapped key keeps its value and
                # lineage.
                for alias_metric, alias_keys in _WIDE_ROW_ALIAS_METRICS.items():
                    if alias_metric in mapped_metrics:
                        continue
                    for alias_key in alias_keys:
                        alias_value = row.get(alias_key)
                        if _coerce_number(alias_value) is None:
                            continue
                        alias_numeric, alias_metadata = _normalize_value(
                            alias_value, row, alias_key, alias_metric, str(period)
                        )
                        lineage[alias_metric] = alias_metadata
                        if alias_numeric is not None:
                            mapped_metrics[alias_metric] = alias_numeric
                        break

                statement = FinancialStatementData(
                    symbol=params.symbol.upper(),
                    period=str(period),
                    statement_type=params.statement_type.value,
                    # Map common fields
                    revenue=_pick_number(
                        mapped_metrics.get("revenue"),
                        row.get("revenue"),
                        row.get("netRevenue"),
                    ),
                    gross_profit=_pick_number(
                        mapped_metrics.get("gross_profit"), row.get("grossProfit")
                    ),
                    operating_income=_pick_number(
                        mapped_metrics.get("operating_income"),
                        row.get("operatingProfit"),
                        row.get("operatingIncome"),
                    ),
                    net_income=_pick_number(
                        mapped_metrics.get("net_income"),
                        row.get("netIncome"),
                        row.get("postTaxProfit"),
                    ),
                    ebitda=_pick_number(mapped_metrics.get("ebitda"), row.get("ebitda")),
                    eps=_pick_number(
                        mapped_metrics.get("eps"),
                        row.get("eps"),
                        row.get("earningPerShare"),
                        row.get("earningsPerShare"),
                        row.get("earning_per_share"),
                        row.get("basicEps"),
                    ),
                    eps_diluted=_pick_number(
                        mapped_metrics.get("eps_diluted"),
                        row.get("epsDiluted"),
                        row.get("dilutedEps"),
                    ),
                    cost_of_revenue=_pick_number(
                        mapped_metrics.get("cost_of_revenue"),
                        row.get("costOfRevenue"),
                        row.get("cost_of_revenue"),
                        row.get("costOfGoodsSold"),
                    ),
                    pre_tax_profit=_pick_number(
                        mapped_metrics.get("pre_tax_profit"),
                        row.get("incomeBeforeTax"),
                        row.get("preTaxProfit"),
                        row.get("profitBeforeTax"),
                    ),
                    tax_expense=_pick_number(
                        mapped_metrics.get("tax_expense"),
                        row.get("incomeTax"),
                        row.get("taxExpense"),
                        row.get("incomeTaxExpense"),
                    ),
                    interest_expense=_pick_number(
                        mapped_metrics.get("interest_expense"),
                        row.get("interestExpense"),
                        row.get("interest_expense"),
                    ),
                    depreciation=_pick_number(
                        mapped_metrics.get("depreciation"),
                        row.get("depreciation"),
                        row.get("depreciationAndAmortization"),
                    ),
                    selling_general_admin=_pick_number(
                        mapped_metrics.get("selling_general_admin"),
                        row.get("sellingGeneralAdmin"),
                        row.get("sellingExpenses"),
                    ),
                    research_development=_pick_number(
                        mapped_metrics.get("research_development"),
                        row.get("researchDevelopment"),
                        row.get("researchAndDevelopment"),
                    ),
                    other_income=_pick_number(
                        mapped_metrics.get("other_income"),
                        row.get("otherIncome"),
                        row.get("other_income"),
                    ),
                    profit_before_tax=_pick_number(
                        mapped_metrics.get("pre_tax_profit"),
                        row.get("incomeBeforeTax"),
                        row.get("preTaxProfit"),
                        row.get("profitBeforeTax"),
                    ),
                    # Balance sheet
                    total_assets=_pick_number(
                        mapped_metrics.get("total_assets"), row.get("totalAssets"), row.get("asset")
                    ),
                    total_liabilities=_pick_number(
                        mapped_metrics.get("total_liabilities"),
                        row.get("totalLiabilities"),
                        row.get("debt"),
                    ),
                    total_equity=_pick_number(
                        mapped_metrics.get("total_equity"),
                        row.get("totalEquity"),
                        row.get("equity"),
                    ),
                    cash_and_equivalents=_pick_number(
                        mapped_metrics.get("cash_and_equivalents"),
                        row.get("cash"),
                        row.get("cashAndCashEquivalents"),
                    ),
                    equity=_pick_number(
                        mapped_metrics.get("total_equity"),
                        row.get("totalEquity"),
                        row.get("equity"),
                    ),
                    cash=_pick_number(
                        mapped_metrics.get("cash_and_equivalents"),
                        row.get("cash"),
                        row.get("cashAndCashEquivalents"),
                    ),
                    inventory=_pick_number(
                        mapped_metrics.get("inventory"),
                        row.get("inventory"),
                        row.get("inventories"),
                    ),
                    current_assets=_pick_number(
                        mapped_metrics.get("current_assets"),
                        row.get("currentAssets"),
                        row.get("current_assets"),
                    ),
                    fixed_assets=_pick_number(
                        mapped_metrics.get("fixed_assets"),
                        row.get("fixedAssets"),
                        row.get("fixed_assets"),
                    ),
                    current_liabilities=_pick_number(
                        mapped_metrics.get("current_liabilities"),
                        row.get("currentLiabilities"),
                        row.get("current_liabilities"),
                    ),
                    long_term_liabilities=_pick_number(
                        mapped_metrics.get("long_term_liabilities"),
                        row.get("longTermLiabilities"),
                        row.get("long_term_liabilities"),
                    ),
                    retained_earnings=_pick_number(
                        mapped_metrics.get("retained_earnings"),
                        row.get("retainedEarnings"),
                        row.get("retained_earnings"),
                    ),
                    short_term_debt=_pick_number(
                        mapped_metrics.get("short_term_debt"),
                        row.get("shortTermDebt"),
                        row.get("short_term_debt"),
                    ),
                    long_term_debt=_pick_number(
                        mapped_metrics.get("long_term_debt"),
                        row.get("longTermDebt"),
                        row.get("long_term_debt"),
                    ),
                    accounts_receivable=_pick_number(
                        mapped_metrics.get("accounts_receivable"),
                        row.get("accountsReceivable"),
                        row.get("accounts_receivable"),
                    ),
                    accounts_payable=_pick_number(
                        mapped_metrics.get("accounts_payable"),
                        row.get("accountsPayable"),
                        row.get("accounts_payable"),
                    ),
                    customer_deposits=_pick_number(
                        mapped_metrics.get("customer_deposits"),
                        row.get("customerDeposits"),
                        row.get("customer_deposits"),
                    ),
                    goodwill=_pick_number(mapped_metrics.get("goodwill"), row.get("goodwill")),
                    intangible_assets=_pick_number(
                        mapped_metrics.get("intangible_assets"),
                        row.get("intangibleAssets"),
                        row.get("intangible_assets"),
                    ),
                    # Cash flow
                    operating_cash_flow=_pick_number(
                        mapped_metrics.get("operating_cash_flow"),
                        row.get("operatingCashFlow"),
                        row.get("fromOperating"),
                    ),
                    investing_cash_flow=_pick_number(
                        mapped_metrics.get("investing_cash_flow"),
                        row.get("investingCashFlow"),
                        row.get("fromInvesting"),
                    ),
                    financing_cash_flow=_pick_number(
                        mapped_metrics.get("financing_cash_flow"),
                        row.get("financingCashFlow"),
                        row.get("fromFinancing"),
                    ),
                    free_cash_flow=_pick_number(
                        mapped_metrics.get("free_cash_flow"), row.get("freeCashFlow")
                    ),
                    net_change_in_cash=_pick_number(
                        mapped_metrics.get("net_change_in_cash"),
                        row.get("netChangeInCash"),
                        row.get("net_change_in_cash"),
                        row.get("netCashFlow"),
                    ),
                    net_cash_flow=_pick_number(
                        mapped_metrics.get("net_change_in_cash"),
                        row.get("netChangeInCash"),
                        row.get("net_change_in_cash"),
                        row.get("netCashFlow"),
                    ),
                    capex=_pick_number(
                        mapped_metrics.get("capex"), row.get("capex"), row.get("capitalExpenditure")
                    ),
                    capital_expenditure=_pick_number(
                        mapped_metrics.get("capex"),
                        row.get("capex"),
                        row.get("capitalExpenditure"),
                    ),
                    dividends_paid=_pick_number(
                        mapped_metrics.get("dividends_paid"),
                        row.get("dividendsPaid"),
                        row.get("dividends_paid"),
                    ),
                    stock_repurchased=_pick_number(
                        mapped_metrics.get("stock_repurchased"),
                        row.get("stockRepurchased"),
                        row.get("stock_repurchased"),
                    ),
                    debt_repayment=_pick_number(
                        mapped_metrics.get("debt_repayment"),
                        row.get("debtRepayment"),
                        row.get("debt_repayment"),
                    ),
                    # Captured provider reports are provenance, not per-row values; the
                    # statement keeps them once, after basis extraction below.
                    raw_data=None,
                    updated_at=datetime.now(UTC),
                )
                statement.source = str(row.get("_source") or "") or None
                statement.currency = "VND"
                statement.unit_metadata = lineage
                for metric in lineage:
                    setattr(statement, metric, mapped_metrics.get(metric))
                # A populated metric with no lineage entry has no unit evidence, so an
                # empty or partial `lineage` must not certify the row as VND by vacuous
                # truth: withhold the value instead (issue #106).
                for metric in set(statement_mapping.values()):
                    if getattr(statement, metric, None) is None or metric in lineage:
                        continue
                    setattr(statement, metric, None)
                    lineage[metric] = {"unavailable_reason": "missing_unit_evidence"}
                statement.value_unit = (
                    "VND"
                    if all(not item.get("unavailable_reason") for item in lineage.values())
                    else None
                )
                statement.equity = statement.total_equity
                statement.cash = statement.cash_and_equivalents
                statement.profit_before_tax = statement.pre_tax_profit
                statement.net_cash_flow = statement.net_change_in_cash
                statement.capital_expenditure = statement.capex
                basis = _report_basis(row, str(period))
                statement.consolidation_basis = basis.get("consolidation_basis")
                statement.flow_basis = basis.get("flow_basis")
                if any(item.get("unavailable_reason") for item in lineage.values()):
                    statement.unavailable_reason = "unknown_source_unit"
                    for metric, metadata in lineage.items():
                        if metadata.get("unavailable_reason"):
                            setattr(statement, metric, None)
                    statement.equity = statement.total_equity
                    statement.cash = statement.cash_and_equivalents
                    statement.profit_before_tax = statement.pre_tax_profit
                    statement.net_cash_flow = statement.net_change_in_cash
                    statement.capital_expenditure = statement.capex
                # Captured provider reports are provenance, not per-row values: keep them
                # once for the statement instead of inside every metric of every row.
                statement.raw_data = {
                    key: value for key, value in row.items() if key != "_provider_attrs"
                }
                results.append(statement)

            except Exception as e:
                logger.warning(f"Skipping invalid financial row: {e}")
                continue

        statement_reports = _collect_source_reports(data)
        if statement_reports:
            for statement in results:
                statement.raw_data["source_reports"] = statement_reports

        if params.period == "quarter":
            quarter_rows = [
                row
                for row in results
                if re.search(r"Q[1-4]", str(row.period or "").upper()) is not None
            ]

            grouped: dict[str, list[FinancialStatementData]] = {}
            for row in quarter_rows:
                grouped.setdefault(str(row.period).upper(), []).append(row)
            deduped_rows = []
            for candidates in grouped.values():
                comparable = [item.model_dump(exclude={"updated_at", "raw_data"}) for item in candidates]
                if all(item == comparable[0] for item in comparable):
                    deduped_rows.append(candidates[0])
                else:
                    deduped_rows.append(FinancialStatementData(symbol=params.symbol, period=candidates[0].period,
                        statement_type=params.statement_type.value, unavailable_reason="conflicting_duplicate_period",
                        raw_data={"conflicting_rows": [item.model_dump(mode="json") for item in candidates]}))

            deduped_rows.sort(key=lambda row: _period_sort_key(str(row.period or "")), reverse=True)
            return deduped_rows[: params.limit]

        results.sort(key=lambda row: _period_sort_key(str(row.period or "")), reverse=True)
        if params.limit:
            return results[: params.limit]

        return results
