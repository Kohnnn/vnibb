"""
Equity API Endpoints with Graceful Degradation.
"""

import asyncio
from bisect import bisect_right
import logging
import re
import unicodedata
from datetime import date, timedelta, datetime
from typing import List, Optional, Literal, Any, Callable, Awaitable

from fastapi import APIRouter, Query, Depends, Path
import numpy as np
import pandas as pd
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, func

from vnibb.api.v1.schemas import StandardResponse, MetaData
from vnibb.core.database import get_db
from vnibb.core.exceptions import ProviderTimeoutError
from vnibb.core.cache import build_cache_key, cached, redis_client
from vnibb.core.config import settings
from vnibb.core.appwrite_client import get_appwrite_stock, get_appwrite_stock_prices
from vnibb.core.vn_sectors import VN_SECTORS
from vnibb.services.cache_manager import CacheManager
from vnibb.services.data_pipeline import CACHE_TTL_ORDERBOOK, CACHE_TTL_ORDERBOOK_DAILY

# Providers
from vnibb.providers.vnstock.equity_historical import (
    VnstockEquityHistoricalFetcher,
    EquityHistoricalQueryParams,
    EquityHistoricalData,
)
from vnibb.providers.vnstock.equity_profile import (
    VnstockEquityProfileFetcher,
    EquityProfileQueryParams,
    EquityProfileData,
)
from vnibb.models.stock import Stock, StockPrice
from vnibb.models.company import Company, Shareholder
from vnibb.models.news import CompanyEvent, Dividend
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models.trading import FinancialRatio, ForeignTrading, OrderFlowDaily, OrderbookSnapshot
from vnibb.providers.vnstock.financials import (
    FinancialStatementData,
    StatementType,
)
from vnibb.services.financial_service import get_financials_with_ttm, normalize_statement_period
from vnibb.providers.vnstock.stock_quote import VnstockStockQuoteFetcher, StockQuoteData
from vnibb.providers.vnstock.company_events import (
    VnstockCompanyEventsFetcher,
    CompanyEventsQueryParams,
)
from vnibb.providers.vnstock.shareholders import (
    VnstockShareholdersFetcher,
    ShareholdersQueryParams,
    ShareholderData,
)
from vnibb.providers.vnstock.officers import VnstockOfficersFetcher, OfficersQueryParams
from vnibb.providers.vnstock.intraday import VnstockIntradayFetcher, IntradayQueryParams
from vnibb.providers.vnstock.financial_ratios import (
    VnstockFinancialRatiosFetcher,
    FinancialRatiosQueryParams,
    FinancialRatioData,
)
from vnibb.providers.vnstock.equity_screener import VnstockScreenerFetcher, StockScreenerParams
from vnibb.providers.vnstock.foreign_trading import (
    VnstockForeignTradingFetcher,
    ForeignTradingQueryParams,
)
from vnibb.providers.vnstock.subsidiaries import VnstockSubsidiariesFetcher, SubsidiariesQueryParams
from vnibb.providers.vnstock.price_depth import VnstockPriceDepthFetcher
from vnibb.providers.vnstock.dividends import VnstockDividendsFetcher
from vnibb.providers.vnstock.trading_stats import TradingStatsData, VnstockTradingStatsFetcher
from vnibb.providers.vnstock.ownership import VnstockOwnershipFetcher
from vnibb.providers.vnstock.general_rating import VnstockGeneralRatingFetcher
from vnibb.services.comparison_service import comparison_service
from vnibb.services.news_service import get_company_news_rows

# Models for Fallback
from vnibb.models.financials import IncomeStatement, BalanceSheet, CashFlow

router = APIRouter()
logger = logging.getLogger(__name__)

VALID_RATIO_PERIOD_RE = re.compile(r"^(?:\d{4}|Q[1-4]-\d{4}|\d{4}-Q[1-4]|TTM)$")

_REFRESH_LOCK = asyncio.Lock()
_REFRESH_IN_FLIGHT: set[str] = set()
VN30_PRIORITY_SYMBOLS = {
    str(symbol).upper()
    for symbol in (VN_SECTORS.get("vn30").symbols if VN_SECTORS.get("vn30") else [])
    if symbol
}


class TransactionFlowPoint(BaseModel):
    date: str
    price: Optional[float] = None
    total_buy_value: Optional[float] = None
    total_sell_value: Optional[float] = None
    total_gross_value: Optional[float] = None
    total_net_value: Optional[float] = None
    total_buy_volume: Optional[int] = None
    total_sell_volume: Optional[int] = None
    total_volume: Optional[int] = None
    total_net_volume: Optional[int] = None
    foreign_net_value: Optional[float] = None
    foreign_net_volume: Optional[int] = None
    proprietary_net_value: Optional[float] = None
    proprietary_net_volume: Optional[int] = None
    domestic_net_value: Optional[float] = None
    domestic_net_volume: Optional[int] = None
    big_order_count: Optional[int] = None
    block_trade_count: Optional[int] = None


class TransactionFlowPayload(BaseModel):
    symbol: str
    days: int
    scopes: List[str]
    modes: List[str]
    note: Optional[str] = None
    data: List[TransactionFlowPoint]


class CorrelationMatrixCell(BaseModel):
    x: str
    y: str
    value: Optional[float] = None


class CorrelationMatrixPayload(BaseModel):
    symbol: str
    sector: Optional[str] = None
    days: int
    symbols: List[str]
    matrix: List[CorrelationMatrixCell]
    returns_count: int


async def _schedule_refresh(key: str, refresh_fn: Callable[[], Awaitable[None]]) -> None:
    async with _REFRESH_LOCK:
        if key in _REFRESH_IN_FLIGHT:
            return
        _REFRESH_IN_FLIGHT.add(key)

    async def runner() -> None:
        try:
            await refresh_fn()
        finally:
            async with _REFRESH_LOCK:
                _REFRESH_IN_FLIGHT.discard(key)

    asyncio.create_task(runner())


def _is_priority_symbol(symbol: str) -> bool:
    return str(symbol or "").upper() in VN30_PRIORITY_SYMBOLS


async def _schedule_critical_reinforcement(
    symbol: str,
    endpoint: str,
    domains: List[str],
) -> None:
    symbol_upper = str(symbol or "").upper()
    if not symbol_upper or not _is_priority_symbol(symbol_upper):
        return

    normalized_domains = sorted(
        {str(domain).strip().lower() for domain in domains if domain and str(domain).strip()}
    )
    if not normalized_domains:
        return

    async def _run_reinforcement() -> None:
        try:
            from vnibb.services.data_pipeline import data_pipeline

            result = await data_pipeline.run_reinforcement(
                symbols=[symbol_upper],
                domains=normalized_domains,
            )
            logger.info(
                "Critical empty payload reinforcement completed (endpoint=%s symbol=%s domains=%s status=%s)",
                endpoint,
                symbol_upper,
                ",".join(normalized_domains),
                result.get("status"),
            )
        except BaseException as exc:
            if _is_control_flow_exception(exc):
                raise
            logger.warning(
                "Critical empty payload reinforcement failed (endpoint=%s symbol=%s domains=%s): %s",
                endpoint,
                symbol_upper,
                ",".join(normalized_domains),
                exc,
            )

    refresh_key = f"reinforce:{endpoint}:{symbol_upper}:{'-'.join(normalized_domains)}"
    await _schedule_refresh(refresh_key, _run_reinforcement)


def _is_control_flow_exception(exc: BaseException) -> bool:
    return isinstance(exc, (asyncio.CancelledError, KeyboardInterrupt, GeneratorExit))


class MetricsHistoryResponse(BaseModel):
    symbol: str
    periods: List[str] = []
    roe: List[float] = []
    roa: List[float] = []
    pe_ratio: List[float] = []
    pb_ratio: List[float] = []


async def _refresh_profile_cache(symbol: str) -> None:
    cache_manager = CacheManager()
    try:
        params = EquityProfileQueryParams(symbol=symbol)
        data = await asyncio.wait_for(
            VnstockEquityProfileFetcher.fetch(params),
            timeout=10,
        )
        profile_data = data[0] if data else None
        if not profile_data:
            logger.warning(f"Profile refresh returned empty data (symbol={symbol})")
            return
        await cache_manager.store_profile_data(symbol, profile_data.model_dump(mode="json"))
        logger.info(f"Background profile refresh complete (symbol={symbol})")
    except BaseException as e:
        if _is_control_flow_exception(e):
            raise
        logger.warning(f"Background profile refresh failed (symbol={symbol}): {e}")


async def _load_financial_statement_fallback(
    db: AsyncSession,
    symbol: str,
    statement_type: str,
    period: str,
    limit: int,
) -> list[FinancialStatementData]:
    """Read financial statements from local DB when provider data is unavailable."""
    symbol_upper = symbol.upper()
    period_upper = (period or "").upper()

    type_map = {
        "income": IncomeStatement,
        "income_statement": IncomeStatement,
        "balance": BalanceSheet,
        "balance_sheet": BalanceSheet,
        "cashflow": CashFlow,
        "cash_flow": CashFlow,
    }
    model = type_map.get(statement_type)
    if model is None:
        return []

    normalized_period = "year"
    if period_upper in {"QUARTER", "Q", "Q1", "Q2", "Q3", "Q4", "TTM"}:
        normalized_period = "quarter"

    quarter_filter: Optional[int] = None
    if period_upper in {"Q1", "Q2", "Q3", "Q4"}:
        quarter_filter = int(period_upper[1])

    stmt = (
        select(model)
        .where(model.symbol == symbol_upper, model.period_type == normalized_period)
        .order_by(model.fiscal_year.desc(), model.fiscal_quarter.desc())
    )
    if quarter_filter is not None:
        stmt = stmt.where(model.fiscal_quarter == quarter_filter)
    stmt = stmt.limit(max(limit, 4) if period_upper == "TTM" else limit)

    result = await db.execute(stmt)
    rows = result.scalars().all()

    fallback_rows = [
        FinancialStatementData(
            symbol=row.symbol,
            period=(
                normalize_statement_period(
                    row.period,
                    fiscal_year=row.fiscal_year,
                    fiscal_quarter=row.fiscal_quarter,
                    period_type=row.period_type,
                )
                or row.period
            ),
            statement_type=statement_type,
            fiscal_year=row.fiscal_year,
            fiscal_quarter=row.fiscal_quarter,
            revenue=getattr(row, "revenue", None),
            cost_of_revenue=getattr(row, "cost_of_revenue", None),
            gross_profit=getattr(row, "gross_profit", None),
            operating_income=getattr(row, "operating_income", None),
            pre_tax_profit=getattr(
                row,
                "pre_tax_profit",
                getattr(row, "income_before_tax", None),
            ),
            profit_before_tax=getattr(
                row,
                "pre_tax_profit",
                getattr(row, "income_before_tax", None),
            ),
            tax_expense=getattr(row, "tax_expense", getattr(row, "income_tax", None)),
            interest_expense=getattr(row, "interest_expense", None),
            depreciation=getattr(row, "depreciation", None),
            selling_general_admin=getattr(row, "selling_general_admin", None),
            research_development=getattr(row, "research_development", None),
            other_income=getattr(row, "other_income", None),
            net_income=getattr(row, "net_income", None),
            ebitda=getattr(row, "ebitda", None),
            eps=getattr(row, "eps", None),
            eps_diluted=getattr(row, "eps_diluted", None),
            total_assets=getattr(row, "total_assets", None),
            total_liabilities=getattr(row, "total_liabilities", None),
            total_equity=getattr(row, "total_equity", None),
            cash_and_equivalents=getattr(row, "cash_and_equivalents", None),
            cash=getattr(row, "cash_and_equivalents", getattr(row, "cash", None)),
            inventory=getattr(row, "inventory", None),
            current_assets=getattr(row, "current_assets", None),
            fixed_assets=getattr(row, "fixed_assets", None),
            current_liabilities=getattr(row, "current_liabilities", None),
            long_term_liabilities=getattr(
                row,
                "long_term_liabilities",
                getattr(row, "non_current_liabilities", None),
            ),
            retained_earnings=getattr(row, "retained_earnings", None),
            short_term_debt=getattr(row, "short_term_debt", None),
            long_term_debt=getattr(row, "long_term_debt", None),
            accounts_receivable=getattr(row, "accounts_receivable", None),
            accounts_payable=getattr(row, "accounts_payable", None),
            customer_deposits=getattr(row, "customer_deposits", None),
            goodwill=getattr(row, "goodwill", None),
            intangible_assets=getattr(row, "intangible_assets", None),
            operating_cash_flow=getattr(row, "operating_cash_flow", None),
            investing_cash_flow=getattr(row, "investing_cash_flow", None),
            financing_cash_flow=getattr(row, "financing_cash_flow", None),
            free_cash_flow=getattr(row, "free_cash_flow", None),
            net_change_in_cash=getattr(row, "net_change_in_cash", None),
            net_cash_flow=getattr(row, "net_change_in_cash", None),
            capex=getattr(row, "capex", getattr(row, "capital_expenditure", None)),
            capital_expenditure=getattr(
                row,
                "capital_expenditure",
                getattr(row, "capex", None),
            ),
            dividends_paid=getattr(row, "dividends_paid", None),
            stock_repurchased=getattr(row, "stock_repurchased", None),
            debt_repayment=getattr(row, "debt_repayment", None),
            raw_data=getattr(row, "raw_data", None),
        )
        for row in rows
    ]

    if period_upper == "TTM":
        return _build_ttm_financial_statement_rows(fallback_rows, statement_type=statement_type)

    return fallback_rows


def _build_ttm_financial_statement_rows(
    rows: list[FinancialStatementData],
    *,
    statement_type: str,
) -> list[FinancialStatementData]:
    quarter_rows = [
        row for row in _sort_financial_statement_rows(rows) if "Q" in str(row.period or "").upper()
    ]
    if not quarter_rows:
        return []

    latest = quarter_rows[-1]
    if statement_type in {"balance", "balance_sheet"}:
        payload = latest.model_dump(mode="json")
        payload["period"] = "TTM"
        return [FinancialStatementData.model_validate(payload)]

    source_rows = quarter_rows[-4:]
    if len(source_rows) < 4:
        return []

    def sum_metric(field_name: str) -> float | None:
        values = []
        for row in source_rows:
            value = getattr(row, field_name, None)
            if isinstance(value, (int, float)):
                values.append(float(value))
        return sum(values) if values else None

    payload = latest.model_dump(mode="json")
    payload["period"] = "TTM"

    for field_name in [
        "revenue",
        "cost_of_revenue",
        "gross_profit",
        "operating_income",
        "pre_tax_profit",
        "profit_before_tax",
        "tax_expense",
        "interest_expense",
        "depreciation",
        "selling_general_admin",
        "research_development",
        "other_income",
        "net_income",
        "ebitda",
        "operating_cash_flow",
        "investing_cash_flow",
        "financing_cash_flow",
        "free_cash_flow",
        "net_change_in_cash",
        "net_cash_flow",
        "capex",
        "capital_expenditure",
        "dividends_paid",
        "stock_repurchased",
        "debt_repayment",
    ]:
        payload[field_name] = sum_metric(field_name)

    payload["raw_data"] = latest.raw_data
    return [FinancialStatementData.model_validate(payload)]


def _build_ratio_ttm_rows(rows: List[FinancialRatioData]) -> List[FinancialRatioData]:
    ordered_rows = sorted(rows, key=lambda item: _ratio_period_sort_key(item.period))
    latest = ordered_rows[-1] if ordered_rows else None
    if latest is None:
        return []

    payload = latest.model_dump(mode="json")
    payload["period"] = "TTM"
    return [FinancialRatioData.model_validate(payload)]


def _financial_statement_identity(item: FinancialStatementData) -> tuple[str, int, int]:
    period_text = normalize_statement_period(getattr(item, "period", "")) or str(
        getattr(item, "period", "") or ""
    )
    year_match = re.search(r"(20\d{2})", period_text.upper())
    quarter_match = re.search(r"Q([1-4])", period_text.upper())
    fiscal_year = getattr(item, "fiscal_year", None)
    fiscal_quarter = getattr(item, "fiscal_quarter", None)
    return (
        period_text,
        int(fiscal_year or (int(year_match.group(1)) if year_match else 0)),
        int(fiscal_quarter or (int(quarter_match.group(1)) if quarter_match else 0)),
    )


def _merge_financial_statement_rows(
    primary_rows: list[FinancialStatementData],
    fallback_rows: list[FinancialStatementData],
) -> list[FinancialStatementData]:
    if not primary_rows:
        return fallback_rows
    if not fallback_rows:
        return primary_rows

    fallback_lookup = {_financial_statement_identity(item): item for item in fallback_rows}
    merged: list[FinancialStatementData] = []
    seen: set[tuple[str, int, int]] = set()

    for item in primary_rows:
        identity = _financial_statement_identity(item)
        seen.add(identity)
        fallback = fallback_lookup.get(identity)
        if fallback is None:
            merged.append(item)
            continue

        payload = item.model_dump(mode="json")
        fallback_payload = fallback.model_dump(mode="json")
        for field_name in FinancialStatementData.model_fields:
            if payload.get(field_name) is None and fallback_payload.get(field_name) is not None:
                payload[field_name] = fallback_payload[field_name]
        merged.append(FinancialStatementData.model_validate(payload))

    for item in fallback_rows:
        identity = _financial_statement_identity(item)
        if identity not in seen:
            merged.append(item)

    return merged


def _normalize_financial_metric_key(raw_key: Any) -> str:
    cleaned = str(raw_key or "").strip().lower()
    if not cleaned:
        return ""
    cleaned = (
        cleaned.replace("&", " and ")
        .replace("%", " pct ")
        .replace(".", "_")
        .replace("/", "_")
        .replace("-", "_")
        .replace("(", " ")
        .replace(")", " ")
        .replace(" ", "_")
    )
    cleaned = unicodedata.normalize("NFKD", cleaned).encode("ascii", "ignore").decode("ascii")
    cleaned = re.sub(r"[^a-z0-9_]", "", cleaned)
    cleaned = re.sub(r"_+", "_", cleaned).strip("_")
    return cleaned


def _build_financial_metric_lookup(raw_payload: Any) -> dict[str, Any]:
    if not isinstance(raw_payload, dict):
        return {}

    lookup: dict[str, Any] = {}
    for key, value in raw_payload.items():
        normalized = _normalize_financial_metric_key(key)
        if normalized and normalized not in lookup:
            lookup[normalized] = value
    return lookup


def _lookup_financial_metric(raw_payload: Any, *aliases: str) -> Optional[float]:
    lookup = _build_financial_metric_lookup(raw_payload)
    for alias in aliases:
        normalized = _normalize_financial_metric_key(alias)
        if normalized in lookup:
            parsed = _coerce_optional_float(lookup.get(normalized))
            if parsed is not None:
                return parsed
    return None


def _sum_financial_metrics(raw_payload: Any, *aliases: str) -> Optional[float]:
    lookup = _build_financial_metric_lookup(raw_payload)
    values: list[float] = []
    for alias in aliases:
        normalized = _normalize_financial_metric_key(alias)
        if normalized not in lookup:
            continue
        parsed = _coerce_optional_float(lookup.get(normalized))
        if parsed is not None:
            values.append(parsed)
    if not values:
        return None
    return sum(values)


BANK_CLASSIFICATION_TERMS = (
    "bank",
    "banking",
    "commercial bank",
    "joint stock commercial bank",
    "ngan hang",
)

BANK_UNSUPPORTED_RATIO_FIELDS = (
    "ps",
    "ev_ebitda",
    "ev_sales",
    "ebitda",
    "roic",
    "current_ratio",
    "quick_ratio",
    "cash_ratio",
    "inventory_turnover",
    "gross_margin",
    "net_margin",
    "operating_margin",
    "debt_service_coverage",
    "ocf_debt",
    "ocf_sales",
    "fcf_yield",
    "debt_equity",
)

BANK_NATIVE_RATIO_FIELDS = (
    "loan_to_deposit",
    "casa_ratio",
    "deposit_growth",
    "nim",
    "equity_to_assets",
    "asset_yield",
    "credit_cost",
    "provision_coverage",
)


def _normalize_classification_text(value: Any) -> str:
    return _normalize_financial_metric_key(value).replace("_", " ")


def _is_bank_like_classification(*values: Any) -> bool:
    for value in values:
        normalized = _normalize_classification_text(value)
        if not normalized:
            continue
        if any(term in normalized for term in BANK_CLASSIFICATION_TERMS):
            return True
    return False


def _apply_bank_ratio_normalization(item: FinancialRatioData) -> FinancialRatioData:
    for field_name in BANK_UNSUPPORTED_RATIO_FIELDS:
        setattr(item, field_name, None)
    return item


def _statement_period_sort_key(period_value: Any) -> int:
    period_text = (
        str(normalize_statement_period(period_value) or period_value or "").strip().upper()
    )
    if not period_text:
        return 0

    year_match = re.search(r"(20\d{2})", period_text)
    year = int(year_match.group(1)) if year_match else 0
    quarter_match = re.search(r"Q([1-4])", period_text)
    quarter = int(quarter_match.group(1)) if quarter_match else 0

    if "TTM" in period_text:
        return year * 10 + 9
    if "YTD" in period_text:
        return year * 10 + 8
    if quarter:
        return year * 10 + quarter
    return year * 10


def _sort_financial_statement_rows(
    rows: list[FinancialStatementData],
) -> list[FinancialStatementData]:
    return sorted(rows, key=lambda item: _statement_period_sort_key(item.period))


async def _is_bank_like_symbol(db: AsyncSession, symbol: str) -> bool:
    stock_row = (
        await db.execute(
            select(Stock.industry, Stock.sector).where(Stock.symbol == symbol).limit(1)
        )
    ).one_or_none()
    if stock_row is not None and _is_bank_like_classification(stock_row.industry, stock_row.sector):
        return True

    screener_row = (
        await db.execute(
            select(ScreenerSnapshot.industry)
            .where(ScreenerSnapshot.symbol == symbol)
            .order_by(ScreenerSnapshot.snapshot_date.desc())
            .limit(1)
        )
    ).one_or_none()
    if screener_row is not None and _is_bank_like_classification(screener_row.industry):
        return True

    return False


def _enrich_financial_statement_rows(
    rows: list[FinancialStatementData],
) -> list[FinancialStatementData]:
    if not rows:
        return rows

    rows_by_period = {
        str(item.period or "").upper(): item for item in rows if str(item.period or "").strip()
    }

    for item in rows:
        raw_data = item.raw_data if isinstance(item.raw_data, dict) else {}

        if item.total_equity is None:
            item.total_equity = _pick_optional_float(
                item.total_equity,
                _lookup_financial_metric(
                    raw_data,
                    "total_equity",
                    "equity",
                    "shareholders_equity",
                    "owners_equity_bn_vnd",
                    "owners_equitybn_vnd",
                    "capital_and_reserves_bn_vnd",
                    "owner_s_equity_bn_vnd",
                    "owner_s_equity",
                ),
            )
            if (
                item.total_equity is None
                and item.total_assets not in (None, 0)
                and item.total_liabilities not in (None, 0)
            ):
                item.total_equity = item.total_assets - item.total_liabilities

        if item.cash_and_equivalents is None:
            item.cash_and_equivalents = _lookup_financial_metric(
                raw_data,
                "cash_and_equivalents",
                "cash_and_cash_equivalents",
                "cash_and_cash_equivalents_bn_vnd",
                "cash",
                "balances_with_the_sbv",
            )
        if item.cash is None:
            item.cash = item.cash_and_equivalents
        if item.equity is None:
            item.equity = item.total_equity

        if item.customer_deposits is None:
            item.customer_deposits = _lookup_financial_metric(
                raw_data,
                "customer_deposits",
                "deposits_from_customers",
                "tien_gui_cua_khach_hang",
            )

        if item.selling_general_admin is None:
            selling_expense = _lookup_financial_metric(
                raw_data, "selling_expenses", "chi_phi_ban_hang"
            )
            admin_expense = _lookup_financial_metric(
                raw_data,
                "general_and_administrative_expenses",
                "general_and_admin_expenses",
                "chi_phi_quan_ly_dn",
                "chi_phi_quan_ly_doanh_nghiep",
            )
            item.selling_general_admin = _sum_financial_metrics(
                raw_data,
                "selling_general_admin",
                "selling_expenses",
                "general_and_administrative_expenses",
                "general_and_admin_expenses",
                "chi_phi_ban_hang",
                "chi_phi_quan_ly_dn",
                "chi_phi_quan_ly_doanh_nghiep",
            )
            if item.selling_general_admin is None:
                if selling_expense is not None or admin_expense is not None:
                    item.selling_general_admin = (selling_expense or 0.0) + (admin_expense or 0.0)

        if item.research_development is None:
            item.research_development = _lookup_financial_metric(
                raw_data,
                "research_development",
                "research_and_development",
                "rd_expense",
            )

        if item.depreciation is None:
            item.depreciation = _lookup_financial_metric(
                raw_data,
                "depreciation",
                "depreciation_and_amortization",
                "depreciation_and_amortisation",
                "depreciation_of_fixed_assets",
                "depreciation_of_fixed_assets_and_properties_investment",
                "chi_phi_khau_hao",
                "khau_hao_tscd",
                "khau_hao_tai_san_co_dinh",
            )

        if item.accounts_payable is None:
            item.accounts_payable = _lookup_financial_metric(
                raw_data,
                "accounts_payable",
                "trade_accounts_payable",
                "short_term_trade_accounts_payable",
                "short_term_trade_payable",
                "long_term_trade_payables",
                "phai_tra_nguoi_ban",
                "n_1_short_term_trade_accounts_payable",
                "n_8_trade_accounts_payable",
                "n_5_long_term_trade_payables",
            )

        if item.goodwill is None:
            item.goodwill = _lookup_financial_metric(
                raw_data,
                "goodwill",
                "good_will_bn_vnd",
                "loi_the_thuong_mai",
                "loi_the_thuong_mai_dong",
                "n_5_goodwill",
                "n_6_goodwill",
                "vii_goodwill_before_2015",
            )

        if item.intangible_assets is None:
            item.intangible_assets = _lookup_financial_metric(
                raw_data,
                "intangible_assets",
                "intangible_fixed_assets",
                "tai_san_vo_hinh",
                "n_3_intangible_fixed_assets",
            )

        capex_value = _pick_optional_float(item.capex, item.capital_expenditure)
        if capex_value is None:
            capex_value = _lookup_financial_metric(
                raw_data,
                "capex",
                "capital_expenditure",
                "purchase_of_fixed_assets",
                "payments_for_purchase_of_fixed_assets",
                "payment_for_fixed_assets_constructions_and_other_long_term_assets",
                "mua_sam_tai_san_co_dinh",
                "mua_sam_tscd",
                "chi_phi_dau_tu_tai_san_co_dinh",
            )
        if item.capex is None:
            item.capex = capex_value
        if item.capital_expenditure is None:
            item.capital_expenditure = capex_value

        if item.free_cash_flow is None:
            item.free_cash_flow = _lookup_financial_metric(
                raw_data,
                "free_cash_flow",
                "free_cashflow",
            )
        if (
            item.free_cash_flow is None
            and item.operating_cash_flow is not None
            and capex_value is not None
        ):
            item.free_cash_flow = item.operating_cash_flow + capex_value

        if item.statement_type == StatementType.INCOME.value and item.depreciation is None:
            cashflow_match = rows_by_period.get(str(item.period or "").upper())
            if cashflow_match is not None and cashflow_match is not item:
                item.depreciation = _pick_optional_float(
                    item.depreciation,
                    cashflow_match.depreciation,
                    _lookup_financial_metric(
                        cashflow_match.raw_data, "depreciation", "depreciation_and_amortisation"
                    ),
                )

        if item.ebitda is None:
            item.ebitda = _lookup_financial_metric(raw_data, "ebitda", "ebitda_bn_vnd")
        if (
            item.ebitda is None
            and item.operating_income is not None
            and item.depreciation is not None
        ):
            item.ebitda = item.operating_income + abs(item.depreciation)

    return _sort_financial_statement_rows(rows)


async def _cross_fill_income_statement_rows(
    db: AsyncSession,
    symbol: str,
    period: str,
    limit: int,
    rows: list[FinancialStatementData],
) -> list[FinancialStatementData]:
    if not rows:
        return rows

    cashflow_rows = _enrich_financial_statement_rows(
        await _load_financial_statement_fallback(
            db=db,
            symbol=symbol,
            statement_type=StatementType.CASHFLOW.value,
            period=period,
            limit=max(limit, len(rows)),
        )
    )
    cashflow_by_period = {
        str(item.period or "").upper(): item
        for item in cashflow_rows
        if str(item.period or "").strip()
    }

    for item in rows:
        cashflow_row = cashflow_by_period.get(str(item.period or "").upper())
        if cashflow_row is None:
            continue
        if item.depreciation is None:
            item.depreciation = _pick_optional_float(item.depreciation, cashflow_row.depreciation)
        if (
            item.ebitda is None
            and item.operating_income is not None
            and item.depreciation is not None
        ):
            item.ebitda = item.operating_income + abs(item.depreciation)

    return _sort_financial_statement_rows(rows)


def _coerce_iso_timestamp(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()

    raw = str(value).strip()
    if not raw:
        return None

    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).isoformat()
    except ValueError:
        return _coerce_iso_date(raw)


def _pick_latest_iso_date_from_rows(rows: list[dict[str, Any]], *keys: str) -> Optional[str]:
    latest_value: date | None = None
    for row in rows:
        for key in keys:
            iso_value = _coerce_iso_date(row.get(key))
            if not iso_value:
                continue
            try:
                parsed = date.fromisoformat(iso_value)
            except ValueError:
                continue
            if latest_value is None or parsed > latest_value:
                latest_value = parsed
    return latest_value.isoformat() if latest_value else None


async def _get_model_last_updated(
    db: AsyncSession,
    model: Any,
    symbol: str,
) -> Optional[str]:
    result = await db.execute(
        select(func.max(model.updated_at)).where(model.symbol == symbol.upper())
    )
    return _coerce_iso_timestamp(result.scalar())


async def _get_profile_last_data_date(db: AsyncSession, symbol: str) -> Optional[str]:
    symbol_upper = symbol.upper()
    company_result = await db.execute(
        select(func.max(Company.updated_at)).where(Company.symbol == symbol_upper)
    )
    stock_result = await db.execute(
        select(func.max(Stock.updated_at)).where(Stock.symbol == symbol_upper)
    )

    company_last_updated = _coerce_iso_timestamp(company_result.scalar())
    if company_last_updated:
        return company_last_updated

    return _coerce_iso_timestamp(stock_result.scalar())


def _to_historical_data(row: StockPrice) -> EquityHistoricalData:
    return EquityHistoricalData(
        symbol=row.symbol,
        time=row.time,
        open=row.open,
        high=row.high,
        low=row.low,
        close=row.close,
        volume=row.volume,
    )


async def _load_historical_from_db(
    db: AsyncSession,
    symbol: str,
    start_date: date,
    end_date: date,
    interval: str,
) -> List[EquityHistoricalData]:
    interval_value = interval or "1D"
    stmt = (
        select(StockPrice)
        .where(
            StockPrice.symbol == symbol,
            StockPrice.interval == interval_value,
            StockPrice.time >= start_date,
            StockPrice.time <= end_date,
        )
        .order_by(StockPrice.time.asc())
    )

    rows = (await db.execute(stmt)).scalars().all()
    return [_to_historical_data(row) for row in rows]


def _appwrite_optional_int(value: Any) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _appwrite_time_to_date(value: Any) -> Optional[date]:
    iso_value = _coerce_iso_date(value)
    if not iso_value:
        return None
    try:
        return date.fromisoformat(iso_value)
    except ValueError:
        return None


def _to_historical_data_from_appwrite(doc: dict[str, Any]) -> Optional[EquityHistoricalData]:
    time_value = _appwrite_time_to_date(doc.get("time"))
    open_value = _coerce_optional_float(doc.get("open"))
    high_value = _coerce_optional_float(doc.get("high"))
    low_value = _coerce_optional_float(doc.get("low"))
    close_value = _coerce_optional_float(doc.get("close"))
    volume_value = _appwrite_optional_int(doc.get("volume"))

    if not time_value or None in {open_value, high_value, low_value, close_value, volume_value}:
        return None

    return EquityHistoricalData(
        symbol=str(doc.get("symbol") or "").upper(),
        time=time_value,
        open=open_value,
        high=high_value,
        low=low_value,
        close=close_value,
        volume=volume_value,
        value=_coerce_optional_float(doc.get("value")),
    )


async def _load_historical_from_appwrite(
    symbol: str,
    start_date: date,
    end_date: date,
    interval: str,
) -> List[EquityHistoricalData]:
    docs = await get_appwrite_stock_prices(
        symbol,
        interval=interval or "1D",
        start_date=start_date,
        end_date=end_date,
        limit=5000,
        descending=False,
    )
    rows: List[EquityHistoricalData] = []
    for doc in docs:
        item = _to_historical_data_from_appwrite(doc)
        if item is not None:
            rows.append(item)
    return rows


async def _load_rolling_price_window(
    db: AsyncSession,
    symbol: str,
    *,
    trading_days: int = 252,
) -> List[EquityHistoricalData]:
    end_date = date.today()
    start_date = end_date - timedelta(days=max(380, trading_days + 30))

    rows = await _load_historical_from_db(db, symbol, start_date, end_date, "1D")
    if (
        not rows
        and settings.is_appwrite_configured
        and settings.resolved_data_backend in {"appwrite", "hybrid"}
    ):
        rows = await _load_historical_from_appwrite(symbol, start_date, end_date, "1D")

    if len(rows) > trading_days:
        rows = rows[-trading_days:]

    return rows


async def _compute_rolling_high_low(
    db: AsyncSession,
    symbol: str,
    *,
    trading_days: int = 252,
) -> tuple[Optional[float], Optional[float]]:
    rows = await _load_rolling_price_window(db, symbol, trading_days=trading_days)
    highs = [row.high for row in rows if row.high is not None]
    lows = [row.low for row in rows if row.low is not None]
    return (max(highs) if highs else None, min(lows) if lows else None)


async def _load_historical_from_recent_cache(
    symbol: str,
    start_date: date,
    end_date: date,
    interval: str,
) -> List[EquityHistoricalData]:
    if (interval or "1D").upper() != "1D":
        return []
    if (end_date - start_date).days > 90:
        return []

    cache_key = build_cache_key("vnibb", "price", "recent", symbol.upper())
    try:
        cached_rows = await redis_client.get_json(cache_key)
    except Exception:
        return []

    if not isinstance(cached_rows, list) or not cached_rows:
        return []

    rows: List[EquityHistoricalData] = []
    for row in cached_rows:
        if not isinstance(row, dict):
            continue
        item = _to_historical_data_from_appwrite(
            {
                "symbol": symbol.upper(),
                "interval": "1D",
                **row,
            }
        )
        if item is None:
            continue
        if start_date <= item.time <= end_date:
            rows.append(item)

    rows.sort(key=lambda item: item.time)
    return rows


async def _load_quote_from_price_cache(symbol: str) -> Optional[StockQuoteData]:
    latest_key = build_cache_key("vnibb", "price", "latest", symbol.upper())
    recent_key = build_cache_key("vnibb", "price", "recent", symbol.upper())

    try:
        latest_payload = await redis_client.get_json(latest_key)
        recent_rows = await redis_client.get_json(recent_key)
    except Exception:
        return None

    if not isinstance(latest_payload, dict):
        return None

    latest_close = _coerce_optional_float(latest_payload.get("close"))
    if latest_close is None:
        return None

    normalized_recent = (
        [row for row in recent_rows if isinstance(row, dict)]
        if isinstance(recent_rows, list)
        else []
    )
    normalized_recent.sort(key=lambda row: str(row.get("time") or ""))

    prev_close: Optional[float] = None
    for row in reversed(normalized_recent[:-1] if len(normalized_recent) > 1 else []):
        prev_close = _coerce_optional_float(row.get("close"))
        if prev_close is not None:
            break

    change = latest_close - prev_close if prev_close is not None else None
    change_pct = (
        ((change / prev_close) * 100)
        if change is not None and prev_close not in (None, 0)
        else None
    )

    updated_at = _coerce_meta_datetime(
        latest_payload.get("updated_at")
        or latest_payload.get("time")
        or latest_payload.get("$updatedAt")
    )

    return StockQuoteData(
        symbol=symbol.upper(),
        price=latest_close,
        open=_coerce_optional_float(latest_payload.get("open")),
        high=_coerce_optional_float(latest_payload.get("high")),
        low=_coerce_optional_float(latest_payload.get("low")),
        prev_close=prev_close,
        change=change,
        change_pct=round(change_pct, 2) if change_pct is not None else None,
        volume=_appwrite_optional_int(latest_payload.get("volume")),
        updated_at=updated_at,
    )


async def _load_profile_from_appwrite(
    symbol: str,
    db: AsyncSession | None = None,
) -> Optional[EquityProfileData]:
    doc = await get_appwrite_stock(symbol)
    if not doc:
        return None

    company_row: Company | None = None
    stock_row: Stock | None = None
    if db is not None:
        company_row = (
            await db.execute(select(Company).where(Company.symbol == symbol.upper()))
        ).scalar_one_or_none()
        stock_row = (
            await db.execute(select(Stock).where(Stock.symbol == symbol.upper()))
        ).scalar_one_or_none()

    industry = _pick_optional_text(
        doc.get("industry"),
        doc.get("icb_name3"),
        doc.get("icb_name4"),
        company_row.industry if company_row else None,
        stock_row.industry if stock_row else None,
    )
    sector = _pick_optional_text(
        doc.get("sector"),
        doc.get("icb_name2"),
        company_row.sector if company_row else None,
        stock_row.sector if stock_row else None,
        industry,
    )
    listing_date = (
        _coerce_iso_date(doc.get("listing_date"))
        or _coerce_iso_date(company_row.listing_date if company_row else None)
        or _coerce_iso_date(stock_row.listing_date if stock_row else None)
    )
    established_date = _coerce_iso_date(company_row.established_date if company_row else None)

    outstanding_shares = _pick_optional_share_count(
        doc.get("outstanding_shares"),
        doc.get("issue_share"),
        company_row.outstanding_shares if company_row else None,
        company_row.listed_shares if company_row else None,
        stock_row.outstanding_shares
        if stock_row and hasattr(stock_row, "outstanding_shares")
        else None,
        await _get_outstanding_shares(db, symbol.upper()) if db is not None else None,
    )
    listed_shares = _resolve_listed_share_count(
        doc.get("listed_shares"),
        doc.get("listed_volume"),
        company_row.listed_shares if company_row else None,
        company_row.outstanding_shares if company_row else None,
        outstanding_shares=outstanding_shares,
    )
    market_cap = (
        await _resolve_profile_market_cap(
            db=db,
            symbol=symbol.upper(),
            outstanding_shares=outstanding_shares,
            fallback_market_cap=doc.get("market_cap"),
        )
        if db is not None
        else _coerce_optional_float(doc.get("market_cap"))
    )

    return EquityProfileData(
        symbol=str(doc.get("symbol") or symbol).upper(),
        company_name=_pick_optional_text(
            doc.get("company_name"),
            company_row.company_name if company_row else None,
            stock_row.company_name if stock_row else None,
        ),
        short_name=_pick_optional_text(
            doc.get("short_name"),
            company_row.short_name if company_row else None,
            stock_row.short_name if stock_row else None,
        ),
        exchange=_pick_optional_text(
            doc.get("exchange"),
            company_row.exchange if company_row else None,
            stock_row.exchange if stock_row else None,
        ),
        industry=industry,
        sector=sector,
        listing_date=listing_date,
        established_date=established_date,
        website=_pick_optional_text(
            doc.get("website"), company_row.website if company_row else None
        ),
        description=_pick_optional_text(
            doc.get("company_profile"),
            doc.get("description"),
            company_row.business_description if company_row else None,
        ),
        outstanding_shares=outstanding_shares,
        listed_shares=listed_shares,
        market_cap=market_cap,
        address=_pick_optional_text(
            doc.get("address"), company_row.address if company_row else None
        ),
        phone=_pick_optional_text(doc.get("phone"), company_row.phone if company_row else None),
        email=_pick_optional_text(doc.get("email"), company_row.email if company_row else None),
        updated_at=None,
    )


async def _load_quote_from_appwrite(symbol: str) -> Optional[StockQuoteData]:
    docs = await get_appwrite_stock_prices(
        symbol,
        interval="1D",
        limit=2,
        descending=True,
    )
    rows = [doc for doc in docs if _coerce_optional_float(doc.get("close")) is not None]
    if not rows:
        return None

    latest_doc = rows[0]
    previous_doc = rows[1] if len(rows) > 1 else None

    latest_close = _coerce_optional_float(latest_doc.get("close"))
    prev_close = _coerce_optional_float(previous_doc.get("close")) if previous_doc else None
    if latest_close is None:
        return None

    change = latest_close - prev_close if prev_close is not None else None
    change_pct = (
        ((change / prev_close) * 100)
        if change is not None and prev_close not in (None, 0)
        else None
    )

    document_timestamp = _coerce_meta_datetime(
        latest_doc.get("updated_at")
        or latest_doc.get("$updatedAt")
        or latest_doc.get("time")
        or latest_doc.get("$createdAt")
    )

    return StockQuoteData(
        symbol=str(latest_doc.get("symbol") or symbol).upper(),
        price=latest_close,
        open=_coerce_optional_float(latest_doc.get("open")),
        high=_coerce_optional_float(latest_doc.get("high")),
        low=_coerce_optional_float(latest_doc.get("low")),
        prev_close=prev_close,
        change=change,
        change_pct=round(change_pct, 2) if change_pct is not None else None,
        volume=_appwrite_optional_int(latest_doc.get("volume")),
        value=_coerce_optional_float(latest_doc.get("value")),
        updated_at=document_timestamp,
    )


def _normalize_symbol_input(symbol: str) -> str:
    raw = (symbol or "").strip().upper()
    if not raw:
        return ""

    tokens = [token for token in re.split(r"[^A-Z0-9]+", raw) if token]
    return tokens[0] if tokens else raw


def _coerce_optional_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _coerce_optional_int(value: Any) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _pick_optional_float(*values: Any) -> Optional[float]:
    for value in values:
        parsed = _coerce_optional_float(value)
        if parsed is not None:
            return parsed
    return None


def _pick_optional_text(*values: Any) -> Optional[str]:
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return None


def _normalize_share_count(value: Any) -> Optional[float]:
    numeric = _coerce_optional_float(value)
    if numeric in (None, 0):
        return None
    if abs(numeric) < 1_000_000:
        return numeric * 1_000_000.0
    return numeric


def _pick_optional_share_count(*values: Any) -> Optional[float]:
    for value in values:
        normalized = _normalize_share_count(value)
        if normalized is not None:
            return normalized
    return None


def _resolve_listed_share_count(
    *listed_values: Any,
    outstanding_shares: Any = None,
) -> Optional[float]:
    listed_shares = _pick_optional_share_count(*listed_values)
    outstanding_value = _normalize_share_count(outstanding_shares)
    if listed_shares is None:
        return outstanding_value
    if outstanding_value is None:
        return listed_shares

    gap_ratio = abs(outstanding_value - listed_shares) / max(outstanding_value, 1.0)
    if listed_shares < outstanding_value and gap_ratio <= 0.02:
        return outstanding_value
    return listed_shares


def _price_to_vnd_units(price: Any, dps_hint: Any = None) -> Optional[float]:
    """
    Normalize quote/snapshot price to VND units.

    Local datasets can store price in thousands of VND (e.g. 68.2 for 68,200 VND).
    Dividend and DPS metrics are in VND, so price must be scaled before yield math.
    """
    numeric = _coerce_optional_float(price)
    if numeric in (None, 0):
        return None

    if abs(numeric) >= 1000:
        return numeric

    dps_value = _coerce_optional_float(dps_hint)
    if dps_value is None or abs(dps_value) >= 1:
        return numeric * 1000.0

    return numeric


def _serialize_meta_datetime(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return datetime.combine(value, datetime.min.time()).isoformat()

    text = str(value).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = f"{text[:-1]}+00:00"

    for parser in (
        lambda raw: datetime.fromisoformat(raw),
        lambda raw: datetime.strptime(raw, "%Y-%m-%d %H:%M:%S"),
        lambda raw: datetime.strptime(raw, "%Y-%m-%d"),
    ):
        try:
            return parser(text).isoformat()
        except ValueError:
            continue

    return None


def _coerce_meta_datetime(value: Any) -> Optional[datetime]:
    serialized = _serialize_meta_datetime(value)
    if not serialized:
        return None
    try:
        return datetime.fromisoformat(serialized)
    except ValueError:
        return None


def _provider_timeout_budget(reserve_seconds: int = 5) -> float:
    vnstock_timeout = max(1, int(getattr(settings, "vnstock_timeout", 30) or 30))
    request_timeout = int(getattr(settings, "api_request_timeout_seconds", 0) or 0)
    if request_timeout <= 0:
        return float(vnstock_timeout)

    reserve = reserve_seconds if request_timeout > reserve_seconds + 1 else 1
    return float(max(1, min(vnstock_timeout, request_timeout - reserve)))


def _build_quote_from_screener_snapshot(
    snapshot_row: ScreenerSnapshot,
    latest_row: Optional[StockPrice] = None,
) -> Optional[StockQuoteData]:
    if snapshot_row.price is None:
        return None

    snapshot_metrics = (
        snapshot_row.extended_metrics if isinstance(snapshot_row.extended_metrics, dict) else {}
    )
    snapshot_change_pct = _pick_optional_float(
        snapshot_metrics.get("change_1d"),
        snapshot_metrics.get("price_change_1d_pct"),
        snapshot_metrics.get("change_pct"),
    )

    snapshot_prev_close = None
    snapshot_change = None
    if snapshot_change_pct not in (None, -100):
        snapshot_prev_close = snapshot_row.price / (1 + (snapshot_change_pct / 100))
        snapshot_change = snapshot_row.price - snapshot_prev_close

    snapshot_updated_at = (
        _coerce_meta_datetime(snapshot_metrics.get("updated_at"))
        or getattr(snapshot_row, "created_at", None)
        or datetime.combine(snapshot_row.snapshot_date, datetime.min.time())
    )
    latest_row_is_current = bool(
        latest_row and latest_row.time is not None and latest_row.time >= snapshot_row.snapshot_date
    )

    return StockQuoteData(
        symbol=str(snapshot_row.symbol or "").upper(),
        price=snapshot_row.price,
        open=(
            float(latest_row.open)
            if latest_row_is_current and latest_row.open is not None
            else None
        ),
        high=(
            float(latest_row.high)
            if latest_row_is_current and latest_row.high is not None
            else None
        ),
        low=(
            float(latest_row.low) if latest_row_is_current and latest_row.low is not None else None
        ),
        prev_close=snapshot_prev_close,
        change=snapshot_change,
        change_pct=round(snapshot_change_pct, 2) if snapshot_change_pct is not None else None,
        volume=int(snapshot_row.volume) if snapshot_row.volume is not None else None,
        updated_at=snapshot_updated_at,
    )


async def _load_latest_screener_snapshot_quote(
    db: AsyncSession,
    symbol: str,
) -> Optional[StockQuoteData]:
    snapshot_stmt = (
        select(ScreenerSnapshot)
        .where(ScreenerSnapshot.symbol == symbol)
        .order_by(ScreenerSnapshot.snapshot_date.desc(), ScreenerSnapshot.created_at.desc())
        .limit(1)
    )
    snapshot_row = (await db.execute(snapshot_stmt)).scalar_one_or_none()
    if not snapshot_row:
        return None

    latest_row = (
        await db.execute(
            select(StockPrice)
            .where(StockPrice.symbol == symbol)
            .order_by(StockPrice.time.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    return _build_quote_from_screener_snapshot(snapshot_row, latest_row)


def _quote_effective_timestamp(quote: Optional[StockQuoteData]) -> Optional[datetime]:
    if quote is None:
        return None
    return _coerce_meta_datetime(getattr(quote, "updated_at", None))


def _should_prefer_screener_quote(
    primary_quote: Optional[StockQuoteData],
    screener_quote: Optional[StockQuoteData],
) -> bool:
    if screener_quote is None:
        return False
    if primary_quote is None:
        return True

    primary_timestamp = _quote_effective_timestamp(primary_quote)
    screener_timestamp = _quote_effective_timestamp(screener_quote)
    if screener_timestamp is None:
        return False
    if primary_timestamp is None:
        return True

    if primary_timestamp.date() < screener_timestamp.date():
        return True

    if (
        getattr(primary_quote, "change_pct", None) is None
        and getattr(screener_quote, "change_pct", None) is not None
    ):
        return True

    if (
        getattr(primary_quote, "prev_close", None) is None
        and getattr(screener_quote, "prev_close", None) is not None
    ):
        return True

    return screener_timestamp > primary_timestamp


async def _load_shareholders_fallback(
    db: AsyncSession,
    symbol: str,
    limit: int = 20,
) -> List[ShareholderData]:
    rows = (
        (
            await db.execute(
                select(Shareholder)
                .where(Shareholder.symbol == symbol)
                .order_by(
                    Shareholder.as_of_date.desc(),
                    Shareholder.updated_at.desc(),
                    Shareholder.ownership_pct.desc(),
                    Shareholder.shares_held.desc(),
                    Shareholder.name.asc(),
                )
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )

    return [
        ShareholderData(
            symbol=row.symbol,
            shareholder_name=row.name,
            shares_owned=row.shares_held,
            ownership_pct=row.ownership_pct,
            shareholder_type=row.shareholder_type,
        )
        for row in rows
    ]


def _normalize_dividend_yield_percent(value: Any) -> Optional[float]:
    numeric = _coerce_optional_float(value)
    if numeric is None:
        return None

    normalized = numeric
    if 0 < abs(normalized) < 1:
        normalized *= 100

    while abs(normalized) > 100:
        normalized /= 100

    if abs(normalized) > 50:
        normalized = 50.0 if normalized > 0 else -50.0

    return normalized


def _normalize_ratio_period(
    period_value: Any,
    *,
    fiscal_year: Any = None,
    fiscal_quarter: Any = None,
    period_type: Any = None,
) -> Optional[str]:
    text = str(period_value or "").strip().upper()
    year = _coerce_optional_float(fiscal_year)
    quarter = _coerce_optional_float(fiscal_quarter)
    year_int = int(year) if year is not None else None
    quarter_int = int(quarter) if quarter is not None else None
    normalized_period_type = str(period_type or "").strip().lower()

    if year_int is not None and not (1900 <= year_int <= 2100):
        year_int = None
    if quarter_int is not None and not (1 <= quarter_int <= 4):
        quarter_int = None

    if text:
        if re.match(r"^\d{4}$", text):
            return text
        q_year = re.match(r"^Q([1-4])-(20\d{2})$", text)
        if q_year:
            return text
        year_q = re.match(r"^(20\d{2})-Q([1-4])$", text)
        if year_q:
            return f"Q{year_q.group(2)}-{year_q.group(1)}"

        year_match = re.search(r"(20\d{2})", text)
        quarter_match = re.search(r"Q([1-4])", text)
        if year_match and quarter_match:
            return f"Q{quarter_match.group(1)}-{year_match.group(1)}"

        alt_quarter = re.match(r"^([1-4])[\/_-](20\d{2})$", text)
        if alt_quarter:
            return f"Q{alt_quarter.group(1)}-{alt_quarter.group(2)}"

        if text.isdigit():
            numeric = int(text)
            if 1900 <= numeric <= 2100:
                return str(numeric)
            if 1 <= numeric <= 4 and year_int is not None:
                return f"Q{numeric}-{year_int}"

    if year_int is None:
        return None

    if normalized_period_type == "quarter" and quarter_int is not None:
        return f"Q{quarter_int}-{year_int}"

    if quarter_int is not None and normalized_period_type != "year":
        return f"Q{quarter_int}-{year_int}"

    return str(year_int)


def _ratio_period_sort_key(period_value: Any) -> int:
    period_text = str(period_value or "").upper()
    year_match = re.search(r"(20\d{2})", period_text)
    year = int(year_match.group(1)) if year_match else 0
    quarter_match = re.search(r"Q([1-4])", period_text)
    quarter = int(quarter_match.group(1)) if quarter_match else 0
    return year * 10 + quarter


def _dedupe_ratio_rows(rows: List[FinancialRatioData]) -> List[FinancialRatioData]:
    seen: dict[str, FinancialRatioData] = {}
    for row in rows:
        period_text = str(row.period or "").strip()
        if not period_text or period_text in seen:
            continue
        seen[period_text] = row

    return sorted(
        seen.values(),
        key=lambda item: _ratio_period_sort_key(item.period),
    )


def _filter_ratio_rows_for_period(
    rows: List[FinancialRatioData],
    requested_period: str,
) -> List[FinancialRatioData]:
    period_upper = str(requested_period or "year").strip().upper()
    if period_upper in {"YEAR", "FY"}:
        return [row for row in rows if "Q" not in str(row.period or "").upper()]

    if period_upper in {"QUARTER", "Q"}:
        return [row for row in rows if "Q" in str(row.period or "").upper()]

    if period_upper in {"Q1", "Q2", "Q3", "Q4"}:
        return [row for row in rows if period_upper in str(row.period or "").upper()]

    if period_upper == "TTM":
        ttm_rows = [row for row in rows if "TTM" in str(row.period or "").upper()]
        return ttm_rows if ttm_rows else _build_ratio_ttm_rows(rows)

    return rows


def _ratio_metric_count(item: FinancialRatioData) -> int:
    return sum(
        1
        for value in item.model_dump(mode="json", exclude={"symbol", "period"}).values()
        if value is not None
    )


def _merge_ratio_rows(
    preferred: FinancialRatioData,
    fallback: FinancialRatioData,
) -> FinancialRatioData:
    payload = fallback.model_dump(mode="json")
    for key, value in preferred.model_dump(mode="json").items():
        if value is not None:
            payload[key] = value
    return FinancialRatioData.model_validate(payload)


def _merge_ratio_row_collections(
    preferred_rows: List[FinancialRatioData],
    fallback_rows: List[FinancialRatioData],
) -> List[FinancialRatioData]:
    merged: dict[str, FinancialRatioData] = {}

    for row in fallback_rows:
        period_value = _normalize_ratio_period(row.period) or str(row.period or "").strip()
        if not period_value:
            continue
        merged[period_value] = row.model_copy(update={"period": period_value})

    for row in preferred_rows:
        period_value = _normalize_ratio_period(row.period) or str(row.period or "").strip()
        if not period_value:
            continue
        normalized_row = row.model_copy(update={"period": period_value})
        existing = merged.get(period_value)
        merged[period_value] = (
            _merge_ratio_rows(normalized_row, existing) if existing is not None else normalized_row
        )

    return sorted(merged.values(), key=lambda item: _ratio_period_sort_key(item.period))


def _derive_dividend_yield_from_dps(dps: Any, latest_price: Any) -> Optional[float]:
    dps_value = _coerce_optional_float(dps)
    price_vnd = _price_to_vnd_units(latest_price, dps_hint=dps_value)
    if dps_value is None or price_vnd in (None, 0):
        return None
    return (dps_value / price_vnd) * 100


def _resolve_dividend_yield_percent(
    raw_yield: Any,
    dps: Any,
    latest_price: Any,
) -> Optional[float]:
    normalized_raw = _normalize_dividend_yield_percent(raw_yield)
    derived = _derive_dividend_yield_from_dps(dps=dps, latest_price=latest_price)

    if derived is None:
        return normalized_raw
    if normalized_raw is None:
        return derived

    if abs(normalized_raw) > 30 >= abs(derived):
        return _normalize_dividend_yield_percent(derived)

    if abs(normalized_raw - derived) >= 10:
        return _normalize_dividend_yield_percent(derived)

    return _normalize_dividend_yield_percent(normalized_raw)


def _coerce_iso_date(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()

    raw = str(value).strip()
    if not raw:
        return None

    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(raw, fmt).date().isoformat()
        except ValueError:
            continue

    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).date().isoformat()
    except ValueError:
        return None


def _extract_calendar_year(*values: Any) -> Optional[int]:
    for value in values:
        numeric = _coerce_optional_float(value)
        if numeric is not None:
            year = int(numeric)
            if 1900 <= year <= 2100:
                return year

        iso_date = _coerce_iso_date(value)
        if iso_date:
            try:
                year = int(iso_date[:4])
                if 1900 <= year <= 2100:
                    return year
            except ValueError:
                continue

    return None


def _classify_dividend_type(
    raw_type: Any,
    cash_dividend: Optional[float],
    stock_dividend: Optional[float],
    dividend_ratio: Any,
    description: Any,
) -> str:
    text_parts = [
        str(raw_type).strip().lower() if raw_type is not None else "",
        str(dividend_ratio).strip().lower() if dividend_ratio is not None else "",
        str(description).strip().lower() if description is not None else "",
    ]
    combined = " ".join(part for part in text_parts if part)

    cash_keywords = ("cash", "tiền", "tien", "tm")
    stock_keywords = (
        "stock",
        "share",
        "cổ phiếu",
        "co phieu",
        "cp",
        "cổ tức bằng cổ phiếu",
        "co tuc bang co phieu",
    )

    has_cash = cash_dividend not in (None, 0)
    has_stock = stock_dividend not in (None, 0)

    if any(keyword in combined for keyword in cash_keywords):
        has_cash = True
    if any(keyword in combined for keyword in stock_keywords):
        has_stock = True

    if has_cash and has_stock:
        return "mixed"
    if has_cash:
        return "cash"
    if has_stock:
        return "stock"
    return "other"


def _build_dividend_row_from_payload(
    symbol: str, payload: dict[str, Any]
) -> Optional[dict[str, Any]]:
    cash_dividend = _coerce_optional_float(
        payload.get("cash_dividend") or payload.get("cashDividend") or payload.get("value")
    )
    stock_dividend = _coerce_optional_float(
        payload.get("stock_dividend") or payload.get("stockDividend")
    )
    dividend_ratio = payload.get("dividend_ratio") or payload.get("ratio")
    if isinstance(dividend_ratio, str):
        dividend_ratio = dividend_ratio.strip() or None

    if cash_dividend is None and stock_dividend is None and dividend_ratio is None:
        return None

    ex_date = _coerce_iso_date(payload.get("ex_date") or payload.get("exDate"))
    record_date = _coerce_iso_date(payload.get("record_date") or payload.get("recordDate"))
    payment_date = _coerce_iso_date(payload.get("payment_date") or payload.get("paymentDate"))
    fiscal_year = _extract_calendar_year(
        payload.get("fiscal_year"),
        payload.get("fiscalYear"),
    )
    issue_year = _extract_calendar_year(
        payload.get("issue_year"),
        payload.get("issueYear"),
    )
    event_year = _extract_calendar_year(
        fiscal_year,
        issue_year,
        ex_date,
        record_date,
        payment_date,
    )
    raw_type = payload.get("dividend_type") or payload.get("type") or payload.get("issue_method")
    description = payload.get("description")
    dividend_type = _classify_dividend_type(
        raw_type=raw_type,
        cash_dividend=cash_dividend,
        stock_dividend=stock_dividend,
        dividend_ratio=dividend_ratio,
        description=description,
    )

    return {
        "symbol": symbol.upper(),
        "ex_date": ex_date,
        "record_date": record_date,
        "payment_date": payment_date,
        "type": dividend_type,
        "dividend_type": dividend_type,
        "raw_dividend_type": raw_type,
        "cash_dividend": cash_dividend,
        "stock_dividend": stock_dividend,
        "dividend_ratio": dividend_ratio,
        "value": cash_dividend if cash_dividend is not None else stock_dividend,
        "fiscal_year": fiscal_year,
        "issue_year": issue_year,
        "year": event_year,
        "annual_dps": None,
        "dividend_yield": None,
        "description": description,
    }


async def _resolve_profile_market_cap(
    db: AsyncSession,
    symbol: str,
    outstanding_shares: Optional[float],
    fallback_market_cap: Optional[float] = None,
) -> Optional[float]:
    shares_value = _coerce_optional_float(outstanding_shares)
    latest_price = await _get_latest_price(db, symbol)

    if latest_price in (None, 0):
        try:
            quote_data, _ = await VnstockStockQuoteFetcher.fetch(
                symbol=symbol,
                source=settings.vnstock_source,
            )
            latest_price = _pick_optional_float(
                latest_price, quote_data.price, quote_data.prev_close
            )
        except BaseException as exc:
            if _is_control_flow_exception(exc):
                raise
            logger.warning(
                "Quote fallback failed while resolving market cap for %s: %s", symbol, exc
            )

    latest_price_vnd = _price_to_vnd_units(latest_price, dps_hint=1.0)

    if shares_value not in (None, 0) and latest_price_vnd not in (None, 0):
        multiplier = 1.0 if shares_value >= 1_000_000 else 1_000_000.0
        return shares_value * multiplier * latest_price_vnd

    direct_market_cap = _coerce_optional_float(fallback_market_cap)
    if direct_market_cap not in (None, 0):
        return direct_market_cap

    latest_snapshot_market_cap = (
        await db.execute(
            select(ScreenerSnapshot.market_cap)
            .where(
                ScreenerSnapshot.symbol == symbol,
                ScreenerSnapshot.market_cap.is_not(None),
            )
            .order_by(ScreenerSnapshot.snapshot_date.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    latest_snapshot_market_cap_value = _coerce_optional_float(latest_snapshot_market_cap)
    if latest_snapshot_market_cap_value not in (None, 0):
        return latest_snapshot_market_cap_value

    try:
        screener_rows = await VnstockScreenerFetcher.fetch(
            StockScreenerParams(symbol=symbol, limit=1, source=settings.vnstock_source)
        )
        if screener_rows:
            screener_market_cap = _coerce_optional_float(
                getattr(screener_rows[0], "market_cap", None)
            )
            if screener_market_cap not in (None, 0):
                return screener_market_cap
    except BaseException as exc:
        if _is_control_flow_exception(exc):
            raise
        logger.warning(
            "Screener fallback failed while resolving market cap for %s: %s", symbol, exc
        )

    return None


async def _get_outstanding_shares(db: AsyncSession, symbol: str) -> Optional[float]:
    company_row = (
        await db.execute(
            select(Company.outstanding_shares, Company.listed_shares, Company.raw_data).where(
                Company.symbol == symbol
            )
        )
    ).first()
    if not company_row:
        return None

    raw_payload = company_row[2] if isinstance(company_row[2], dict) else {}
    return _pick_optional_share_count(
        company_row[0],
        company_row[1],
        raw_payload.get("outstanding_shares"),
        raw_payload.get("listed_shares"),
        raw_payload.get("issue_share"),
        raw_payload.get("financial_ratio_issue_share"),
        raw_payload.get("listed_volume"),
    )


async def _get_latest_price(db: AsyncSession, symbol: str) -> Optional[float]:
    latest_close = (
        await db.execute(
            select(StockPrice.close)
            .where(StockPrice.symbol == symbol)
            .order_by(StockPrice.time.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    latest_price = _coerce_optional_float(latest_close)
    if latest_price not in (None, 0):
        return latest_price

    latest_snapshot_price = (
        await db.execute(
            select(ScreenerSnapshot.price)
            .where(ScreenerSnapshot.symbol == symbol, ScreenerSnapshot.price.is_not(None))
            .order_by(ScreenerSnapshot.snapshot_date.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    return _coerce_optional_float(latest_snapshot_price)


async def _get_latest_financial_row(
    db: AsyncSession,
    symbol: str,
    model: Any,
    period: str,
) -> Any | None:
    result = await db.execute(
        select(model)
        .where(model.symbol == symbol, model.period_type == period)
        .order_by(desc(model.fiscal_year), desc(model.fiscal_quarter))
        .limit(1)
    )
    return result.scalar_one_or_none()


def _to_ratio_data(row: FinancialRatio) -> FinancialRatioData:
    period_value = (
        _normalize_ratio_period(
            row.period,
            fiscal_year=row.fiscal_year,
            fiscal_quarter=row.fiscal_quarter,
            period_type=getattr(row, "period_type", None),
        )
        or ""
    )

    raw_payload = getattr(row, "raw_data", None)
    raw_data = raw_payload if isinstance(raw_payload, dict) else {}

    ev_sales = _coerce_optional_float(getattr(row, "ev_sales", None))
    if ev_sales is None:
        ev_sales = _coerce_optional_float(raw_data.get("ev_sales"))
    if ev_sales is None:
        ev_sales = _coerce_optional_float(raw_data.get("evToSales"))
    if ev_sales is None:
        ev_sales = _coerce_optional_float(raw_data.get("evSales"))
    if ev_sales is None:
        ev_sales = _coerce_optional_float(raw_data.get("enterpriseValueToSales"))

    return FinancialRatioData(
        symbol=row.symbol,
        period=period_value,
        pe=_pick_optional_float(row.pe_ratio, raw_data.get("pe"), raw_data.get("priceToEarning")),
        pb=_pick_optional_float(row.pb_ratio, raw_data.get("pb"), raw_data.get("priceToBook")),
        ps=_pick_optional_float(row.ps_ratio, raw_data.get("ps"), raw_data.get("priceToSales")),
        ev_ebitda=_pick_optional_float(row.ev_ebitda, raw_data.get("ev_ebitda")),
        ev_sales=ev_sales,
        ebitda=_pick_optional_float(raw_data.get("ebitda"), raw_data.get("ebitdaTtm")),
        roe=_pick_optional_float(row.roe, raw_data.get("roe")),
        roa=_pick_optional_float(row.roa, raw_data.get("roa")),
        roic=_pick_optional_float(getattr(row, "roic", None), raw_data.get("roic")),
        eps=_pick_optional_float(row.eps, raw_data.get("eps"), raw_data.get("earningPerShare")),
        bvps=_pick_optional_float(
            row.bvps, raw_data.get("bvps"), raw_data.get("bookValuePerShare")
        ),
        debt_equity=_pick_optional_float(
            row.debt_to_equity,
            raw_data.get("debt_equity"),
            raw_data.get("de"),
        ),
        debt_assets=_pick_optional_float(row.debt_to_assets, raw_data.get("debt_assets")),
        current_ratio=_pick_optional_float(row.current_ratio, raw_data.get("current_ratio")),
        quick_ratio=_pick_optional_float(row.quick_ratio, raw_data.get("quick_ratio")),
        cash_ratio=_pick_optional_float(row.cash_ratio, raw_data.get("cash_ratio")),
        gross_margin=_pick_optional_float(row.gross_margin, raw_data.get("gross_margin")),
        net_margin=_pick_optional_float(row.net_margin, raw_data.get("net_margin")),
        operating_margin=_pick_optional_float(
            row.operating_margin,
            raw_data.get("operating_margin"),
            raw_data.get("operatingMargin"),
        ),
        interest_coverage=_pick_optional_float(
            row.interest_coverage,
            raw_data.get("interest_coverage"),
        ),
        debt_service_coverage=_pick_optional_float(raw_data.get("debt_service_coverage")),
        ocf_debt=_pick_optional_float(raw_data.get("ocf_debt"), raw_data.get("ocf_to_debt")),
        fcf_yield=_pick_optional_float(raw_data.get("fcf_yield")),
        ocf_sales=_pick_optional_float(raw_data.get("ocf_sales")),
        revenue_growth=_pick_optional_float(
            row.revenue_growth,
            raw_data.get("revenue_growth"),
            raw_data.get("revenueGrowth"),
        ),
        earnings_growth=_pick_optional_float(
            row.earnings_growth,
            raw_data.get("earnings_growth"),
            raw_data.get("earningsGrowth"),
        ),
        dps=_pick_optional_float(
            getattr(row, "dps", None),
            raw_data.get("dps"),
            raw_data.get("dividends_per_share"),
            raw_data.get("dividendPerShare"),
        ),
        asset_turnover=getattr(
            row, "asset_turnover", _coerce_optional_float(raw_data.get("asset_turnover"))
        ),
        inventory_turnover=getattr(
            row,
            "inventory_turnover",
            _coerce_optional_float(raw_data.get("inventory_turnover")),
        ),
        receivables_turnover=getattr(
            row,
            "receivables_turnover",
            _coerce_optional_float(raw_data.get("receivables_turnover")),
        ),
        equity_multiplier=getattr(
            row,
            "equity_multiplier",
            _coerce_optional_float(raw_data.get("equity_multiplier")),
        ),
        dividend_yield=_normalize_dividend_yield_percent(
            getattr(
                row,
                "dividend_yield",
                _coerce_optional_float(raw_data.get("dividend_yield")),
            )
        ),
        payout_ratio=getattr(
            row,
            "payout_ratio",
            _coerce_optional_float(raw_data.get("payout_ratio")),
        ),
        peg_ratio=getattr(row, "peg_ratio", _coerce_optional_float(raw_data.get("peg_ratio"))),
    )


def _ratio_has_metric_value(item: FinancialRatioData) -> bool:
    metric_values = (
        item.pe,
        item.pb,
        item.ps,
        item.ev_ebitda,
        item.ev_sales,
        item.ebitda,
        item.roe,
        item.roa,
        item.roic,
        item.eps,
        item.bvps,
        item.debt_equity,
        item.debt_assets,
        item.equity_multiplier,
        item.current_ratio,
        item.quick_ratio,
        item.cash_ratio,
        item.asset_turnover,
        item.inventory_turnover,
        item.receivables_turnover,
        item.gross_margin,
        item.net_margin,
        item.operating_margin,
        item.interest_coverage,
        item.debt_service_coverage,
        item.ocf_debt,
        item.fcf_yield,
        item.ocf_sales,
        item.dividend_yield,
        item.payout_ratio,
        item.peg_ratio,
    )
    return any(value is not None for value in metric_values)


def _extract_year_quarter(period_value: str) -> tuple[Optional[int], Optional[int]]:
    period_text = (
        str(normalize_statement_period(period_value) or period_value or "").strip().upper()
    )
    if not period_text:
        return None, None

    year_match = re.search(r"(20\d{2})", period_text)
    year = int(year_match.group(1)) if year_match else None

    quarter_match = re.search(r"Q([1-4])", period_text)
    quarter = int(quarter_match.group(1)) if quarter_match else None
    if quarter is None:
        alt_quarter_match = re.match(r"([1-4])[/_-](20\d{2})", period_text)
        if alt_quarter_match:
            quarter = int(alt_quarter_match.group(1))
            year = int(alt_quarter_match.group(2))

    return year, quarter


def _resolve_period_end_date(
    year: int | None, quarter: int | None, normalized_period: str
) -> date | None:
    if year is None:
        return None

    if normalized_period == "quarter" and quarter in {1, 2, 3, 4}:
        month_day_map = {
            1: (3, 31),
            2: (6, 30),
            3: (9, 30),
            4: (12, 31),
        }
        month, day = month_day_map[int(quarter)]
        return date(int(year), month, day)

    return date(int(year), 12, 31)


def _build_ratio_eps_lookups(
    ratio_rows: List[FinancialRatioData],
) -> tuple[dict[tuple[int, int], float], dict[int, float]]:
    eps_by_year_quarter: dict[tuple[int, int], float] = {}
    eps_by_year: dict[int, float] = {}

    for item in ratio_rows:
        eps_value = _coerce_optional_float(item.eps)
        if eps_value is None:
            continue

        year, quarter = _extract_year_quarter(item.period or "")
        if year is None:
            continue

        if year not in eps_by_year:
            eps_by_year[year] = eps_value

        if quarter is not None and (year, quarter) not in eps_by_year_quarter:
            eps_by_year_quarter[(year, quarter)] = eps_value

    return eps_by_year_quarter, eps_by_year


async def _enrich_income_eps_from_ratios(
    symbol: str,
    period: str,
    rows: List[FinancialStatementData],
    db: AsyncSession,
) -> List[FinancialStatementData]:
    if not rows:
        return rows

    missing_eps_rows = [row for row in rows if row.eps is None]
    if not missing_eps_rows:
        return rows

    period_upper = (period or "").upper()
    normalized_period = "year" if period_upper in {"YEAR", "FY"} else "quarter"

    ratio_data: List[FinancialRatioData] = []

    try:
        stmt = (
            select(FinancialRatio)
            .where(
                FinancialRatio.symbol == symbol,
                FinancialRatio.period_type == normalized_period,
            )
            .order_by(desc(FinancialRatio.fiscal_year), desc(FinancialRatio.fiscal_quarter))
        )
        db_rows = (await db.execute(stmt)).scalars().all()
        ratio_data = [_to_ratio_data(item) for item in db_rows]
    except Exception as db_error:
        logger.warning("EPS enrichment ratio DB lookup failed for %s: %s", symbol, db_error)

    if not ratio_data:
        return rows

    eps_by_year_quarter, eps_by_year = _build_ratio_eps_lookups(ratio_data)
    if not eps_by_year_quarter and not eps_by_year:
        return rows

    for row in rows:
        if row.eps is not None:
            continue

        year, quarter = _extract_year_quarter(row.period)
        if year is None:
            continue

        eps_value: Optional[float] = None
        if quarter is not None:
            eps_value = eps_by_year_quarter.get((year, quarter))
        if eps_value is None:
            eps_value = eps_by_year.get(year)

        if eps_value is not None:
            row.eps = eps_value

    return rows


async def _enrich_ratio_ev_sales_from_income(
    symbol: str,
    period: str,
    rows: List[FinancialRatioData],
    db: AsyncSession,
) -> List[FinancialRatioData]:
    if not rows:
        return rows

    missing_rows = [item for item in rows if item.ev_sales is None]
    if not missing_rows:
        return rows

    normalized_period = "year" if period in {"year", "FY"} else "quarter"

    stmt = (
        select(
            IncomeStatement.fiscal_year,
            IncomeStatement.fiscal_quarter,
            IncomeStatement.revenue,
            IncomeStatement.ebitda,
        )
        .where(
            IncomeStatement.symbol == symbol,
            IncomeStatement.period_type == normalized_period,
            IncomeStatement.revenue.is_not(None),
        )
        .order_by(desc(IncomeStatement.fiscal_year), desc(IncomeStatement.fiscal_quarter))
    )
    income_rows = (await db.execute(stmt)).all()
    if not income_rows:
        income_rows = []

    latest_snapshot_date = (
        await db.execute(select(func.max(ScreenerSnapshot.snapshot_date)))
    ).scalar()
    latest_market_cap = None
    if latest_snapshot_date is not None:
        latest_market_cap = (
            await db.execute(
                select(ScreenerSnapshot.market_cap).where(
                    ScreenerSnapshot.symbol == symbol,
                    ScreenerSnapshot.snapshot_date == latest_snapshot_date,
                    ScreenerSnapshot.market_cap.is_not(None),
                )
            )
        ).scalar_one_or_none()
    latest_market_cap_value = _coerce_optional_float(latest_market_cap)

    quarterly_metrics: dict[tuple[int, int], tuple[float, float | None]] = {}
    annual_metrics: dict[int, tuple[float, float | None]] = {}
    for year, quarter, revenue, ebitda in income_rows:
        revenue_value = _coerce_optional_float(revenue)
        if revenue_value in (None, 0):
            continue
        ebitda_value = _coerce_optional_float(ebitda)
        if year is None:
            continue
        if quarter is not None and 1 <= int(quarter) <= 4:
            quarterly_metrics[(int(year), int(quarter))] = (revenue_value, ebitda_value)
        if int(year) not in annual_metrics:
            annual_metrics[int(year)] = (revenue_value, ebitda_value)

    for item in rows:
        if item.ev_sales is not None:
            continue

        ev_ebitda = _coerce_optional_float(item.ev_ebitda)

        year, quarter = _extract_year_quarter(item.period or "")
        if year is None:
            continue

        metrics = None
        if quarter is not None:
            metrics = quarterly_metrics.get((year, quarter))
        if metrics is None:
            metrics = annual_metrics.get(year)
        if metrics is None:
            continue

        revenue_value, ebitda_value = metrics
        if revenue_value in (None, 0):
            continue

        computed_ev_sales = None
        if ev_ebitda is not None and ebitda_value not in (None, 0):
            computed_ev_sales = (ev_ebitda * ebitda_value) / revenue_value
        elif latest_market_cap_value not in (None, 0):
            computed_ev_sales = latest_market_cap_value / revenue_value

        if computed_ev_sales is not None:
            item.ev_sales = computed_ev_sales

    return rows


def _build_placeholder_ratio_rows_from_support(
    symbol: str,
    *support_groups: List[FinancialStatementData],
) -> List[FinancialRatioData]:
    periods = {
        _normalize_ratio_period(statement_row.period)
        for support_group in support_groups
        for statement_row in support_group
    }
    return [
        FinancialRatioData(symbol=symbol, period=period_value)
        for period_value in sorted(filter(None, periods), key=_ratio_period_sort_key)
    ]


async def _load_ratio_statement_support(
    *,
    db: AsyncSession,
    symbol: str,
    period: str,
    limit: int,
) -> dict[str, List[FinancialStatementData]]:
    support: dict[str, List[FinancialStatementData]] = {
        StatementType.INCOME.value: [],
        StatementType.BALANCE.value: [],
        StatementType.CASHFLOW.value: [],
    }

    for statement_type in (
        StatementType.INCOME.value,
        StatementType.BALANCE.value,
        StatementType.CASHFLOW.value,
    ):
        provider_rows: List[FinancialStatementData] = []
        try:
            provider_rows = await get_financials_with_ttm(
                symbol=symbol,
                statement_type=statement_type,
                period=period,
                limit=limit,
            )
        except Exception as exc:
            logger.warning(
                "Ratio support statement fetch failed for %s (%s/%s): %s",
                symbol,
                statement_type,
                period,
                exc,
            )

        fallback_rows = await _load_financial_statement_fallback(
            db=db,
            symbol=symbol,
            statement_type=statement_type,
            period=period,
            limit=limit,
        )
        merged_rows = (
            _merge_financial_statement_rows(provider_rows, fallback_rows)
            if provider_rows
            else fallback_rows
        )
        merged_rows = _enrich_financial_statement_rows(merged_rows)
        if statement_type == StatementType.INCOME.value:
            merged_rows = await _cross_fill_income_statement_rows(
                db=db,
                symbol=symbol,
                period=period,
                limit=limit,
                rows=merged_rows,
            )
        support[statement_type] = merged_rows

    return support


async def _enrich_missing_ratio_metrics(
    symbol: str,
    period: str,
    rows: List[FinancialRatioData],
    db: AsyncSession,
    income_support_rows: List[FinancialStatementData] | None = None,
    balance_support_rows: List[FinancialStatementData] | None = None,
    cashflow_support_rows: List[FinancialStatementData] | None = None,
) -> List[FinancialRatioData]:
    if not rows:
        return rows

    normalized_period = "year" if period in {"year", "FY"} else "quarter"
    is_bank_like = await _is_bank_like_symbol(db, symbol)

    income_stmt = (
        select(
            IncomeStatement.fiscal_year,
            IncomeStatement.fiscal_quarter,
            IncomeStatement.revenue,
            IncomeStatement.operating_income,
            IncomeStatement.net_income,
            IncomeStatement.cost_of_revenue,
            IncomeStatement.eps,
            IncomeStatement.interest_expense,
            IncomeStatement.ebitda,
            IncomeStatement.income_tax,
            IncomeStatement.raw_data,
        )
        .where(IncomeStatement.symbol == symbol, IncomeStatement.period_type == normalized_period)
        .order_by(desc(IncomeStatement.fiscal_year), desc(IncomeStatement.fiscal_quarter))
    )
    balance_stmt = (
        select(
            BalanceSheet.fiscal_year,
            BalanceSheet.fiscal_quarter,
            BalanceSheet.total_assets,
            BalanceSheet.current_assets,
            BalanceSheet.cash_and_equivalents,
            BalanceSheet.total_liabilities,
            BalanceSheet.current_liabilities,
            BalanceSheet.total_equity,
            BalanceSheet.book_value_per_share,
            BalanceSheet.inventory,
            BalanceSheet.accounts_receivable,
            BalanceSheet.short_term_debt,
            BalanceSheet.long_term_debt,
            BalanceSheet.raw_data,
        )
        .where(BalanceSheet.symbol == symbol, BalanceSheet.period_type == normalized_period)
        .order_by(desc(BalanceSheet.fiscal_year), desc(BalanceSheet.fiscal_quarter))
    )
    cashflow_stmt = (
        select(
            CashFlow.fiscal_year,
            CashFlow.fiscal_quarter,
            CashFlow.operating_cash_flow,
            CashFlow.free_cash_flow,
            CashFlow.capital_expenditure,
            CashFlow.dividends_paid,
            CashFlow.debt_repayment,
            CashFlow.depreciation,
        )
        .where(CashFlow.symbol == symbol, CashFlow.period_type == normalized_period)
        .order_by(desc(CashFlow.fiscal_year), desc(CashFlow.fiscal_quarter))
    )

    income_rows = (await db.execute(income_stmt)).all()
    balance_rows = (await db.execute(balance_stmt)).all()
    cashflow_rows = (await db.execute(cashflow_stmt)).all()

    existing_periods = {
        str(item.period or "").upper() for item in rows if str(item.period or "").strip()
    }

    def _serialize_ratio_period(year: int | None, quarter: int | None) -> str | None:
        if year is None:
            return None
        normalized_year = int(year)
        normalized_quarter = int(quarter or 0)
        if normalized_period == "quarter":
            if normalized_quarter not in {1, 2, 3, 4}:
                return None
            return f"{normalized_year}-Q{normalized_quarter}"
        return str(normalized_year)

    def _support_period(statement_row: FinancialStatementData) -> str | None:
        year, quarter = _extract_year_quarter(statement_row.period or "")
        return _serialize_ratio_period(year, quarter)

    derived_periods = {
        _serialize_ratio_period(year, quarter)
        for year, quarter, *_rest in [*income_rows, *balance_rows, *cashflow_rows]
    }
    derived_periods.update(
        filter(
            None, (_support_period(statement_row) for statement_row in income_support_rows or [])
        )
    )
    derived_periods.update(
        filter(
            None, (_support_period(statement_row) for statement_row in balance_support_rows or [])
        )
    )
    derived_periods.update(
        filter(
            None, (_support_period(statement_row) for statement_row in cashflow_support_rows or [])
        )
    )

    missing_periods = [
        period_value
        for period_value in derived_periods
        if period_value and period_value.upper() not in existing_periods
    ]
    if missing_periods:
        rows.extend(
            FinancialRatioData(symbol=symbol, period=period_value)
            for period_value in sorted(missing_periods, key=_ratio_period_sort_key)
        )
        existing_periods.update(period_value.upper() for period_value in missing_periods)

    def _merge_metric_maps(
        base: dict[str, float | None],
        supplement: dict[str, float | None],
    ) -> dict[str, float | None]:
        merged_metrics = dict(base)
        for metric_key, metric_value in supplement.items():
            if merged_metrics.get(metric_key) is None and metric_value is not None:
                merged_metrics[metric_key] = metric_value
        return merged_metrics

    income_lookup: dict[tuple[int, int], dict[str, float | None]] = {}
    for (
        year,
        quarter,
        revenue,
        operating_income,
        net_income,
        cost_of_revenue,
        eps,
        interest_expense,
        ebitda,
        income_tax,
        raw_data,
    ) in income_rows:
        if year is None:
            continue
        key = (int(year), int(quarter or 0))
        raw_payload = raw_data if isinstance(raw_data, dict) else {}
        income_lookup[key] = {
            "revenue": _coerce_optional_float(revenue),
            "operating_income": _coerce_optional_float(operating_income),
            "net_income": _coerce_optional_float(net_income),
            "cost_of_revenue": _coerce_optional_float(cost_of_revenue),
            "eps": _coerce_optional_float(eps),
            "interest_expense": _coerce_optional_float(interest_expense),
            "ebitda": _coerce_optional_float(ebitda),
            "tax_expense": _coerce_optional_float(income_tax),
            "net_interest_income": _pick_optional_float(
                _lookup_financial_metric(raw_payload, "net_interest_income")
            ),
            "provision_for_credit_losses": _pick_optional_float(
                _lookup_financial_metric(
                    raw_payload,
                    "provision_for_credit_losses",
                    "credit_loss_provision",
                )
            ),
        }

    for statement_row in income_support_rows or []:
        year, quarter = _extract_year_quarter(statement_row.period or "")
        serialized_period = _serialize_ratio_period(year, quarter)
        if serialized_period is None or year is None:
            continue
        key = (int(year), int(quarter or 0))
        support_metrics = {
            "revenue": _coerce_optional_float(statement_row.revenue),
            "operating_income": _coerce_optional_float(statement_row.operating_income),
            "net_income": _coerce_optional_float(statement_row.net_income),
            "cost_of_revenue": _coerce_optional_float(statement_row.cost_of_revenue),
            "eps": _coerce_optional_float(statement_row.eps),
            "interest_expense": _coerce_optional_float(statement_row.interest_expense),
            "ebitda": _coerce_optional_float(statement_row.ebitda),
            "tax_expense": _coerce_optional_float(statement_row.tax_expense),
            "net_interest_income": _pick_optional_float(
                _lookup_financial_metric(statement_row.raw_data or {}, "net_interest_income")
            ),
            "provision_for_credit_losses": _pick_optional_float(
                _lookup_financial_metric(
                    statement_row.raw_data or {},
                    "provision_for_credit_losses",
                    "credit_loss_provision",
                )
            ),
        }
        income_lookup[key] = (
            _merge_metric_maps(income_lookup[key], support_metrics)
            if key in income_lookup
            else support_metrics
        )

    prev_income_values: dict[tuple[int, int], tuple[float | None, float | None, float | None]] = {}
    for key in list(income_lookup.keys()):
        year, quarter = key
        prev_key = (year - 1, quarter if normalized_period == "quarter" else 0)
        prev = income_lookup.get(prev_key)
        prev_income_values[key] = (
            None if prev is None else _coerce_optional_float(prev.get("revenue")),
            None if prev is None else _coerce_optional_float(prev.get("net_income")),
            None if prev is None else _coerce_optional_float(prev.get("eps")),
        )

    balance_lookup: dict[tuple[int, int], dict[str, float | None]] = {}
    for (
        year,
        quarter,
        total_assets,
        current_assets,
        cash_and_equivalents,
        total_liabilities,
        current_liabilities,
        total_equity,
        book_value_per_share,
        inventory,
        receivables,
        short_term_debt,
        long_term_debt,
        raw_data,
    ) in balance_rows:
        if year is None:
            continue
        raw_payload = raw_data if isinstance(raw_data, dict) else {}
        balance_lookup[(int(year), int(quarter or 0))] = {
            "total_assets": _coerce_optional_float(total_assets),
            "current_assets": _coerce_optional_float(current_assets),
            "cash_and_equivalents": _pick_optional_float(
                _coerce_optional_float(cash_and_equivalents),
                _lookup_financial_metric(
                    raw_payload,
                    "cash_and_equivalents",
                    "cash_and_cash_equivalents",
                    "cash_and_cash_equivalents_bn_vnd",
                    "cash",
                    "balances_with_the_sbv",
                ),
            ),
            "total_liabilities": _coerce_optional_float(total_liabilities),
            "current_liabilities": _coerce_optional_float(current_liabilities),
            "total_equity": _pick_optional_float(
                _coerce_optional_float(total_equity),
                _lookup_financial_metric(
                    raw_payload,
                    "total_equity",
                    "equity",
                    "shareholders_equity",
                    "owners_equity_bn_vnd",
                    "owners_equitybn_vnd",
                    "owner_s_equity_bn_vnd",
                    "owner_s_equity",
                    "capital_and_reserves_bn_vnd",
                ),
            ),
            "book_value_per_share": _coerce_optional_float(book_value_per_share),
            "inventory": _coerce_optional_float(inventory),
            "accounts_receivable": _coerce_optional_float(receivables),
            "customer_deposits": _pick_optional_float(
                _lookup_financial_metric(
                    raw_payload,
                    "customer_deposits",
                    "deposits_from_customers",
                    "tien_gui_cua_khach_hang",
                )
            ),
            "current_account_deposits": _pick_optional_float(
                _lookup_financial_metric(
                    raw_payload,
                    "current_account_deposits",
                    "current_accounts",
                    "demand_deposits",
                    "non_term_deposits",
                    "casa",
                )
            ),
            "gross_loans": _pick_optional_float(
                _lookup_financial_metric(
                    raw_payload,
                    "loans_and_advances_to_customers",
                    "loans_advances_and_finance_leases_to_customers",
                    "gross_loans",
                ),
                _coerce_optional_float(receivables),
            ),
            "loan_loss_reserve": _pick_optional_float(
                _lookup_financial_metric(
                    raw_payload,
                    "provisions_for_losses_on_loans_advances_and_finance_leases_to_customers",
                    "less_provision_for_losses_on_loans_and_advances_to_customers",
                    "provision_for_loan_losses",
                    "loan_loss_reserve",
                )
            ),
            "placements_with_banks": _pick_optional_float(
                _lookup_financial_metric(
                    raw_payload,
                    "placements_at_and_loans_to_other_credit_institutions",
                    "placements_with_and_loans_to_other_credit_institutions",
                    "placements_at_other_credit_institutions",
                    "loans_to_other_credit_institutions",
                )
            ),
            "investment_securities_total": _pick_optional_float(
                _lookup_financial_metric(
                    raw_payload,
                    "investment_securities",
                    "available_for_sales_securities",
                    "held_to_maturity_securities",
                )
            ),
            "short_term_debt": _coerce_optional_float(short_term_debt),
            "long_term_debt": _coerce_optional_float(long_term_debt),
        }

    for statement_row in balance_support_rows or []:
        year, quarter = _extract_year_quarter(statement_row.period or "")
        serialized_period = _serialize_ratio_period(year, quarter)
        if serialized_period is None or year is None:
            continue
        key = (int(year), int(quarter or 0))
        support_metrics = {
            "total_assets": _coerce_optional_float(statement_row.total_assets),
            "current_assets": _coerce_optional_float(statement_row.current_assets),
            "cash_and_equivalents": _pick_optional_float(
                _coerce_optional_float(statement_row.cash_and_equivalents),
                _coerce_optional_float(statement_row.cash),
            ),
            "total_liabilities": _coerce_optional_float(statement_row.total_liabilities),
            "current_liabilities": _coerce_optional_float(statement_row.current_liabilities),
            "total_equity": _pick_optional_float(
                _coerce_optional_float(statement_row.total_equity),
                _coerce_optional_float(statement_row.equity),
            ),
            "book_value_per_share": _coerce_optional_float(
                statement_row.raw_data.get("book_value_per_share")
            )
            if isinstance(statement_row.raw_data, dict)
            else None,
            "inventory": _coerce_optional_float(statement_row.inventory),
            "accounts_receivable": _coerce_optional_float(statement_row.accounts_receivable),
            "customer_deposits": _coerce_optional_float(statement_row.customer_deposits),
            "current_account_deposits": _pick_optional_float(
                _lookup_financial_metric(
                    statement_row.raw_data or {},
                    "current_account_deposits",
                    "current_accounts",
                    "demand_deposits",
                    "non_term_deposits",
                    "casa",
                )
            ),
            "gross_loans": _pick_optional_float(
                _lookup_financial_metric(
                    statement_row.raw_data or {}, "gross_loans", "loans_and_advances_to_customers"
                ),
                _coerce_optional_float(statement_row.accounts_receivable),
            ),
            "loan_loss_reserve": _pick_optional_float(
                _lookup_financial_metric(
                    statement_row.raw_data or {}, "loan_loss_reserve", "provision_for_loan_losses"
                )
            ),
            "placements_with_banks": _pick_optional_float(
                _lookup_financial_metric(
                    statement_row.raw_data or {},
                    "placements_with_banks",
                    "placements_at_other_credit_institutions",
                )
            ),
            "investment_securities_total": _pick_optional_float(
                _lookup_financial_metric(
                    statement_row.raw_data or {},
                    "investment_securities_total",
                    "investment_securities",
                )
            ),
            "short_term_debt": _coerce_optional_float(statement_row.short_term_debt),
            "long_term_debt": _coerce_optional_float(statement_row.long_term_debt),
        }
        balance_lookup[key] = (
            _merge_metric_maps(balance_lookup[key], support_metrics)
            if key in balance_lookup
            else support_metrics
        )

    prev_balance_values: dict[tuple[int, int], dict[str, float | None]] = {}
    for key in list(balance_lookup.keys()):
        year, quarter = key
        prev_key = (year - 1, quarter if normalized_period == "quarter" else 0)
        prev_balance_values[key] = balance_lookup.get(prev_key) or {}

    cashflow_lookup: dict[tuple[int, int], dict[str, float | None]] = {}
    for (
        year,
        quarter,
        operating_cash_flow,
        free_cash_flow,
        capital_expenditure,
        dividends_paid,
        debt_repayment,
        depreciation,
    ) in cashflow_rows:
        if year is None:
            continue
        cashflow_lookup[(int(year), int(quarter or 0))] = {
            "operating_cash_flow": _coerce_optional_float(operating_cash_flow),
            "free_cash_flow": _coerce_optional_float(free_cash_flow),
            "capital_expenditure": _coerce_optional_float(capital_expenditure),
            "dividends_paid": _coerce_optional_float(dividends_paid),
            "debt_repayment": _coerce_optional_float(debt_repayment),
            "depreciation": _coerce_optional_float(depreciation),
        }

    for statement_row in cashflow_support_rows or []:
        year, quarter = _extract_year_quarter(statement_row.period or "")
        serialized_period = _serialize_ratio_period(year, quarter)
        if serialized_period is None or year is None:
            continue
        key = (int(year), int(quarter or 0))
        support_metrics = {
            "operating_cash_flow": _coerce_optional_float(statement_row.operating_cash_flow),
            "free_cash_flow": _coerce_optional_float(statement_row.free_cash_flow),
            "capital_expenditure": _pick_optional_float(
                _coerce_optional_float(statement_row.capital_expenditure),
                _coerce_optional_float(statement_row.capex),
            ),
            "dividends_paid": _coerce_optional_float(statement_row.dividends_paid),
            "debt_repayment": _coerce_optional_float(statement_row.debt_repayment),
            "depreciation": _coerce_optional_float(statement_row.depreciation),
        }
        cashflow_lookup[key] = (
            _merge_metric_maps(cashflow_lookup[key], support_metrics)
            if key in cashflow_lookup
            else support_metrics
        )

    latest_price_stmt = (
        select(ScreenerSnapshot.price)
        .where(ScreenerSnapshot.symbol == symbol, ScreenerSnapshot.price.is_not(None))
        .order_by(ScreenerSnapshot.snapshot_date.desc())
        .limit(1)
    )
    latest_price = _coerce_optional_float(
        (await db.execute(latest_price_stmt)).scalar_one_or_none()
    )
    outstanding_shares = await _get_outstanding_shares(db, symbol)
    market_cap_stmt = (
        select(ScreenerSnapshot.market_cap)
        .where(ScreenerSnapshot.symbol == symbol, ScreenerSnapshot.market_cap.is_not(None))
        .order_by(ScreenerSnapshot.snapshot_date.desc())
        .limit(1)
    )
    market_cap = _coerce_optional_float((await db.execute(market_cap_stmt)).scalar_one_or_none())
    if (
        market_cap in (None, 0)
        and outstanding_shares not in (None, 0)
        and latest_price not in (None, 0)
    ):
        multiplier = 1.0 if outstanding_shares >= 1_000_000 else 1_000_000.0
        market_cap = outstanding_shares * multiplier * latest_price
    if market_cap in (None, 0):
        market_cap = await _resolve_profile_market_cap(
            db=db,
            symbol=symbol,
            outstanding_shares=outstanding_shares,
            fallback_market_cap=market_cap,
        )

    period_end_targets = {
        (year, quarter or 0): _resolve_period_end_date(year, quarter, normalized_period)
        for item in rows
        for year, quarter in [_extract_year_quarter(item.period or "")]
        if year is not None
    }
    period_end_targets = {
        key: target for key, target in period_end_targets.items() if target is not None
    }
    period_price_lookup: dict[tuple[int, int], float | None] = {}
    period_market_cap_lookup: dict[tuple[int, int], float | None] = {}

    if period_end_targets:
        max_target = max(period_end_targets.values())
        price_history_stmt = (
            select(StockPrice.time, StockPrice.close)
            .where(
                StockPrice.symbol == symbol,
                StockPrice.interval == "1D",
                StockPrice.time <= max_target,
            )
            .order_by(StockPrice.time.asc())
        )
        price_history_rows = (await db.execute(price_history_stmt)).all()
        price_dates = [row.time for row in price_history_rows if row.time is not None]
        price_closes = [
            _coerce_optional_float(row.close) for row in price_history_rows if row.time is not None
        ]

        if price_dates and price_closes:
            share_multiplier = (
                1.0
                if outstanding_shares is not None and outstanding_shares >= 1_000_000
                else 1_000_000.0
            )
            for key, target_date in period_end_targets.items():
                index = bisect_right(price_dates, target_date) - 1
                if index < 0:
                    continue
                close_value = price_closes[index]
                period_price_lookup[key] = close_value
                if close_value not in (None, 0) and outstanding_shares not in (None, 0):
                    period_market_cap_lookup[key] = (
                        outstanding_shares * share_multiplier * close_value
                    )

    for item in rows:
        year, quarter = _extract_year_quarter(item.period or "")
        if year is None:
            continue
        key = (year, quarter or 0)
        income = income_lookup.get(key)
        balance = balance_lookup.get(key)
        cashflow = cashflow_lookup.get(key)
        if income is None and quarter is not None:
            income = income_lookup.get((year, 0))
        if balance is None and quarter is not None:
            balance = balance_lookup.get((year, 0))
        if cashflow is None and quarter is not None:
            cashflow = cashflow_lookup.get((year, 0))

        balance_prev = None
        if normalized_period == "quarter" and quarter is not None and 1 <= quarter <= 4:
            balance_prev = balance_lookup.get((year - 1, quarter))
        if balance_prev is None:
            balance_prev = balance_lookup.get((year - 1, 0))

        revenue = None if income is None else _coerce_optional_float(income.get("revenue"))
        operating_income = (
            None if income is None else _coerce_optional_float(income.get("operating_income"))
        )
        net_income = None if income is None else _coerce_optional_float(income.get("net_income"))
        cost_of_revenue = (
            None if income is None else _coerce_optional_float(income.get("cost_of_revenue"))
        )
        interest_expense = (
            None if income is None else _coerce_optional_float(income.get("interest_expense"))
        )
        net_interest_income = (
            None if income is None else _coerce_optional_float(income.get("net_interest_income"))
        )
        provision_for_credit_losses = (
            None
            if income is None
            else _coerce_optional_float(income.get("provision_for_credit_losses"))
        )
        ebitda_reported = None if income is None else _coerce_optional_float(income.get("ebitda"))
        tax_expense = None if income is None else _coerce_optional_float(income.get("tax_expense"))

        total_assets = (
            None if balance is None else _coerce_optional_float(balance.get("total_assets"))
        )
        current_assets = (
            None if balance is None else _coerce_optional_float(balance.get("current_assets"))
        )
        cash_and_equivalents = (
            None if balance is None else _coerce_optional_float(balance.get("cash_and_equivalents"))
        )
        total_liabilities = (
            None if balance is None else _coerce_optional_float(balance.get("total_liabilities"))
        )
        current_liabilities = (
            None if balance is None else _coerce_optional_float(balance.get("current_liabilities"))
        )
        total_equity = (
            None if balance is None else _coerce_optional_float(balance.get("total_equity"))
        )
        book_value_per_share = (
            None if balance is None else _coerce_optional_float(balance.get("book_value_per_share"))
        )
        inventory = None if balance is None else _coerce_optional_float(balance.get("inventory"))
        receivables = (
            None if balance is None else _coerce_optional_float(balance.get("accounts_receivable"))
        )
        customer_deposits = (
            None if balance is None else _coerce_optional_float(balance.get("customer_deposits"))
        )
        current_account_deposits = (
            None
            if balance is None
            else _coerce_optional_float(balance.get("current_account_deposits"))
        )
        gross_loans = (
            None if balance is None else _coerce_optional_float(balance.get("gross_loans"))
        )
        loan_loss_reserve = (
            None if balance is None else _coerce_optional_float(balance.get("loan_loss_reserve"))
        )
        placements_with_banks = (
            None
            if balance is None
            else _coerce_optional_float(balance.get("placements_with_banks"))
        )
        investment_securities_total = (
            None
            if balance is None
            else _coerce_optional_float(balance.get("investment_securities_total"))
        )
        short_term_debt = (
            None if balance is None else _coerce_optional_float(balance.get("short_term_debt"))
        )
        long_term_debt = (
            None if balance is None else _coerce_optional_float(balance.get("long_term_debt"))
        )
        inventory_prev = (
            None if balance_prev is None else _coerce_optional_float(balance_prev.get("inventory"))
        )
        receivables_prev = (
            None
            if balance_prev is None
            else _coerce_optional_float(balance_prev.get("accounts_receivable"))
        )
        customer_deposits_prev = _coerce_optional_float(
            (prev_balance_values.get(key) or {}).get("customer_deposits")
        )
        current_account_deposits_prev = _coerce_optional_float(
            (prev_balance_values.get(key) or {}).get("current_account_deposits")
        )
        gross_loans_prev = _coerce_optional_float(
            (prev_balance_values.get(key) or {}).get("gross_loans")
        )
        placements_prev = _coerce_optional_float(
            (prev_balance_values.get(key) or {}).get("placements_with_banks")
        )
        investments_prev = _coerce_optional_float(
            (prev_balance_values.get(key) or {}).get("investment_securities_total")
        )

        operating_cash_flow = (
            None
            if cashflow is None
            else _coerce_optional_float(cashflow.get("operating_cash_flow"))
        )
        free_cash_flow = (
            None if cashflow is None else _coerce_optional_float(cashflow.get("free_cash_flow"))
        )
        capital_expenditure = (
            None
            if cashflow is None
            else _coerce_optional_float(cashflow.get("capital_expenditure"))
        )
        dividends_paid = (
            None if cashflow is None else _coerce_optional_float(cashflow.get("dividends_paid"))
        )
        debt_repayment = (
            None if cashflow is None else _coerce_optional_float(cashflow.get("debt_repayment"))
        )
        depreciation_cashflow = (
            None if cashflow is None else _coerce_optional_float(cashflow.get("depreciation"))
        )
        depreciation = depreciation_cashflow

        if (
            free_cash_flow is None
            and operating_cash_flow is not None
            and capital_expenditure is not None
        ):
            free_cash_flow = operating_cash_flow + capital_expenditure

        turnover_base = cost_of_revenue if cost_of_revenue not in (None, 0) else revenue

        if item.roe is None and net_income is not None and total_equity not in (None, 0):
            item.roe = (net_income / total_equity) * 100
        if item.roa is None and net_income is not None and total_assets not in (None, 0):
            item.roa = (net_income / total_assets) * 100
        if (
            not is_bank_like
            and item.roic is None
            and net_income is not None
            and total_equity not in (None, 0)
        ):
            invested_capital = total_equity + (long_term_debt or 0.0)
            if invested_capital not in (None, 0):
                item.roic = (net_income / invested_capital) * 100
        if (
            item.current_ratio is None
            and current_assets not in (None, 0)
            and current_liabilities not in (None, 0)
        ):
            item.current_ratio = current_assets / current_liabilities
        if item.quick_ratio is None and current_liabilities not in (None, 0):
            quick_assets = current_assets
            if quick_assets is not None and inventory is not None:
                quick_assets = quick_assets - inventory
            if quick_assets not in (None, 0):
                item.quick_ratio = quick_assets / current_liabilities
        if (
            item.cash_ratio is None
            and cash_and_equivalents not in (None, 0)
            and current_liabilities not in (None, 0)
        ):
            item.cash_ratio = cash_and_equivalents / current_liabilities
        if item.eps is None and net_income is not None and outstanding_shares not in (None, 0):
            item.eps = net_income / outstanding_shares
        if item.bvps is None:
            if book_value_per_share not in (None, 0):
                item.bvps = book_value_per_share
            elif total_equity is not None and outstanding_shares not in (None, 0):
                item.bvps = total_equity / outstanding_shares
        period_price = period_price_lookup.get(key)
        valuation_price = _pick_optional_float(period_price, latest_price)
        valuation_market_cap = _pick_optional_float(period_market_cap_lookup.get(key), market_cap)
        price_vnd = _price_to_vnd_units(valuation_price, dps_hint=item.dps or item.eps)
        if item.pe is None and price_vnd not in (None, 0) and item.eps not in (None, 0):
            item.pe = price_vnd / item.eps
        if item.pb is None and price_vnd not in (None, 0) and item.bvps not in (None, 0):
            item.pb = price_vnd / item.bvps
        if (
            not is_bank_like
            and item.ps is None
            and valuation_market_cap not in (None, 0)
            and revenue not in (None, 0)
        ):
            item.ps = valuation_market_cap / revenue
        if (
            not is_bank_like
            and item.ev_sales is None
            and revenue not in (None, 0)
            and valuation_market_cap not in (None, 0)
        ):
            total_debt = None
            if short_term_debt is not None or long_term_debt is not None:
                total_debt = (short_term_debt or 0.0) + (long_term_debt or 0.0)
            elif total_liabilities is not None:
                total_debt = total_liabilities

            enterprise_value = valuation_market_cap
            if total_debt is not None:
                enterprise_value += total_debt
            if cash_and_equivalents is not None:
                enterprise_value -= cash_and_equivalents

            if revenue not in (None, 0):
                item.ev_sales = enterprise_value / revenue
        if (
            item.operating_margin is None
            and revenue not in (None, 0)
            and operating_income is not None
        ):
            item.operating_margin = (operating_income / revenue) * 100
        if (
            item.asset_turnover is None
            and revenue not in (None, 0)
            and total_assets not in (None, 0)
        ):
            item.asset_turnover = revenue / total_assets
        if (
            item.inventory_turnover is None
            and turnover_base not in (None, 0)
            and inventory not in (None, 0)
        ):
            avg_inventory = (inventory + (inventory_prev or inventory)) / 2
            if avg_inventory not in (None, 0):
                item.inventory_turnover = turnover_base / avg_inventory
        if (
            item.receivables_turnover is None
            and revenue not in (None, 0)
            and receivables not in (None, 0)
        ):
            avg_receivables = (receivables + (receivables_prev or receivables)) / 2
            if avg_receivables not in (None, 0):
                item.receivables_turnover = revenue / avg_receivables
        if (
            item.debt_assets is None
            and total_liabilities not in (None, 0)
            and total_assets not in (None, 0)
        ):
            item.debt_assets = total_liabilities / total_assets
        if (
            item.equity_multiplier is None
            and total_assets not in (None, 0)
            and total_equity not in (None, 0)
        ):
            item.equity_multiplier = total_assets / total_equity
        if is_bank_like and total_assets not in (None, 0) and total_equity not in (None, 0):
            item.equity_to_assets = (total_equity / total_assets) * 100

        earning_assets = None
        if is_bank_like:
            current_earning_assets = sum(
                value or 0.0
                for value in (gross_loans, placements_with_banks, investment_securities_total)
                if value is not None
            )
            prev_earning_assets_raw = [gross_loans_prev, placements_prev, investments_prev]
            prev_earning_assets = sum(
                value or 0.0 for value in prev_earning_assets_raw if value is not None
            )
            if current_earning_assets > 0 and prev_earning_assets > 0:
                earning_assets = (current_earning_assets + prev_earning_assets) / 2
            elif current_earning_assets > 0:
                earning_assets = current_earning_assets

        if is_bank_like and gross_loans not in (None, 0) and customer_deposits not in (None, 0):
            item.loan_to_deposit = gross_loans / customer_deposits
        if (
            is_bank_like
            and current_account_deposits not in (None, 0)
            and customer_deposits not in (None, 0)
        ):
            item.casa_ratio = (current_account_deposits / customer_deposits) * 100
        if (
            is_bank_like
            and customer_deposits not in (None, 0)
            and customer_deposits_prev not in (None, 0)
        ):
            item.deposit_growth = (
                (customer_deposits - customer_deposits_prev) / customer_deposits_prev
            ) * 100
        if is_bank_like and revenue not in (None, 0) and earning_assets not in (None, 0):
            item.asset_yield = (revenue / earning_assets) * 100
        if (
            is_bank_like
            and net_interest_income not in (None, 0)
            and earning_assets not in (None, 0)
        ):
            item.nim = (net_interest_income / earning_assets) * 100
        average_gross_loans = None
        if gross_loans not in (None, 0) and gross_loans_prev not in (None, 0):
            average_gross_loans = (gross_loans + gross_loans_prev) / 2
        elif gross_loans not in (None, 0):
            average_gross_loans = gross_loans
        if (
            is_bank_like
            and provision_for_credit_losses not in (None, 0)
            and average_gross_loans not in (None, 0)
        ):
            item.credit_cost = (abs(provision_for_credit_losses) / average_gross_loans) * 100
        if is_bank_like and loan_loss_reserve not in (None, 0) and gross_loans not in (None, 0):
            item.provision_coverage = (abs(loan_loss_reserve) / gross_loans) * 100

        prev_revenue, prev_net_income, _prev_eps = prev_income_values.get(key, (None, None, None))
        if (
            item.revenue_growth is None
            and revenue not in (None, 0)
            and prev_revenue not in (None, 0)
        ):
            item.revenue_growth = ((revenue - prev_revenue) / prev_revenue) * 100
        if (
            item.earnings_growth is None
            and net_income not in (None, 0)
            and prev_net_income not in (None, 0)
        ):
            item.earnings_growth = ((net_income - prev_net_income) / prev_net_income) * 100

        if item.ebitda is None:
            ebitda_value = ebitda_reported
            if ebitda_value is None and operating_income is not None and depreciation is not None:
                ebitda_value = operating_income + abs(depreciation)
            if ebitda_value is None and net_income is not None:
                addbacks = 0.0
                has_addback = False
                if tax_expense is not None:
                    addbacks += abs(tax_expense)
                    has_addback = True
                if interest_expense is not None:
                    addbacks += abs(interest_expense)
                    has_addback = True
                if depreciation is not None:
                    addbacks += abs(depreciation)
                    has_addback = True
                if has_addback:
                    ebitda_value = net_income + addbacks
            if ebitda_value is not None:
                item.ebitda = ebitda_value

        if item.debt_service_coverage is None and operating_income is not None:
            debt_service = 0.0
            if interest_expense is not None:
                debt_service += abs(interest_expense)
            if debt_repayment is not None:
                debt_service += abs(debt_repayment)
            if debt_service > 0:
                item.debt_service_coverage = operating_income / debt_service
        if (
            item.debt_service_coverage is None
            and operating_cash_flow is not None
            and debt_repayment not in (None, 0)
        ):
            item.debt_service_coverage = operating_cash_flow / abs(debt_repayment)

        if (
            item.ocf_debt is None
            and operating_cash_flow is not None
            and total_liabilities not in (None, 0)
        ):
            item.ocf_debt = operating_cash_flow / total_liabilities

        if item.ocf_sales is None and operating_cash_flow is not None and revenue not in (None, 0):
            item.ocf_sales = operating_cash_flow / revenue

        if (
            not is_bank_like
            and item.fcf_yield is None
            and free_cash_flow is not None
            and valuation_market_cap not in (None, 0)
        ):
            item.fcf_yield = free_cash_flow / valuation_market_cap

        if item.dps is None and dividends_paid is not None and outstanding_shares not in (None, 0):
            item.dps = abs(dividends_paid) / outstanding_shares

        item.dividend_yield = _resolve_dividend_yield_percent(
            raw_yield=item.dividend_yield,
            dps=item.dps,
            latest_price=valuation_price,
        )

        if item.dps is None and item.dividend_yield is not None:
            price_vnd = _price_to_vnd_units(valuation_price, dps_hint=1.0)
            if price_vnd not in (None, 0):
                item.dps = (item.dividend_yield / 100) * price_vnd

        if item.dividend_yield is None:
            item.dividend_yield = _resolve_dividend_yield_percent(
                raw_yield=None,
                dps=item.dps,
                latest_price=valuation_price,
            )

        if item.payout_ratio is None:
            if dividends_paid is not None and net_income not in (None, 0) and net_income > 0:
                item.payout_ratio = (abs(dividends_paid) / net_income) * 100
            else:
                dps = _coerce_optional_float(getattr(item, "dps", None))
                eps = _coerce_optional_float(item.eps)
                if dps is not None and eps not in (None, 0):
                    item.payout_ratio = (dps / eps) * 100

        if item.peg_ratio is None:
            pe_value = _coerce_optional_float(item.pe)
            growth_value = _coerce_optional_float(item.earnings_growth)
            if pe_value is not None and growth_value not in (None, 0):
                growth_base = growth_value if abs(growth_value) > 1 else growth_value * 100
                if growth_base > 0:
                    item.peg_ratio = pe_value / growth_base

        if is_bank_like:
            _apply_bank_ratio_normalization(item)

    return rows


@router.get("/historical", response_model=StandardResponse[List[EquityHistoricalData]])
@cached(ttl=300, key_prefix="historical")
async def get_historical_prices(
    symbol: str = Query(..., min_length=1, max_length=10),
    start_date: date = Query(default_factory=lambda: date.today() - timedelta(days=365)),
    end_date: date = Query(default_factory=date.today),
    interval: str = Query(default="1D", pattern=r"^(1m|5m|15m|30m|1H|1D|1W|1M)$"),
    source: str = Query(default="VCI", pattern=r"^(KBS|VCI|DNSE)$"),
    db: AsyncSession = Depends(get_db),
):
    symbol_upper = symbol.upper()
    cache_manager = CacheManager(db=db)
    use_appwrite_data = settings.is_appwrite_configured and settings.resolved_data_backend in {
        "appwrite",
        "hybrid",
    }
    cache_result = await cache_manager.get_historical_prices(
        symbol=symbol_upper,
        start_date=start_date,
        end_date=end_date,
        interval=interval,
        allow_stale=True,
    )
    if cache_result.hit and cache_result.data:
        data = [_to_historical_data(r) for r in cache_result.data]
        return StandardResponse(data=data, meta=MetaData(count=len(data)))

    recent_cache_data = await _load_historical_from_recent_cache(
        symbol=symbol_upper,
        start_date=start_date,
        end_date=end_date,
        interval=interval,
    )
    if recent_cache_data:
        return StandardResponse(data=recent_cache_data, meta=MetaData(count=len(recent_cache_data)))

    if settings.resolved_data_backend == "appwrite" and use_appwrite_data:
        appwrite_data = await _load_historical_from_appwrite(
            symbol=symbol_upper,
            start_date=start_date,
            end_date=end_date,
            interval=interval,
        )
        if appwrite_data:
            return StandardResponse(data=appwrite_data, meta=MetaData(count=len(appwrite_data)))

    try:
        params = EquityHistoricalQueryParams(
            symbol=symbol,
            start_date=start_date,
            end_date=end_date,
            interval=interval,
            source=source,
        )
        data = await VnstockEquityHistoricalFetcher.fetch(params)
        if data:
            return StandardResponse(data=data, meta=MetaData(count=len(data)))

        if use_appwrite_data:
            appwrite_data = await _load_historical_from_appwrite(
                symbol=symbol_upper,
                start_date=start_date,
                end_date=end_date,
                interval=interval,
            )
            if appwrite_data:
                logger.info(
                    "Historical endpoint served Appwrite fallback after empty provider payload (symbol=%s interval=%s)",
                    symbol_upper,
                    interval,
                )
                return StandardResponse(data=appwrite_data, meta=MetaData(count=len(appwrite_data)))

        fallback_data = await _load_historical_from_db(
            db=db,
            symbol=symbol_upper,
            start_date=start_date,
            end_date=end_date,
            interval=interval,
        )
        if fallback_data:
            logger.info(
                "Historical endpoint served DB fallback after empty provider payload (symbol=%s interval=%s)",
                symbol_upper,
                interval,
            )
            return StandardResponse(data=fallback_data, meta=MetaData(count=len(fallback_data)))

        await _schedule_critical_reinforcement(
            symbol=symbol_upper,
            endpoint="equity.historical",
            domains=["prices"],
        )
        return StandardResponse(data=[], meta=MetaData(count=0))
    except Exception as e:
        logger.warning(
            "Historical endpoint provider failed (symbol=%s interval=%s): %s",
            symbol_upper,
            interval,
            e,
        )

        if use_appwrite_data:
            appwrite_data = await _load_historical_from_appwrite(
                symbol=symbol_upper,
                start_date=start_date,
                end_date=end_date,
                interval=interval,
            )
            if appwrite_data:
                logger.info(
                    "Historical endpoint recovered via Appwrite fallback after provider error (symbol=%s interval=%s)",
                    symbol_upper,
                    interval,
                )
                return StandardResponse(data=appwrite_data, meta=MetaData(count=len(appwrite_data)))

        fallback_data = await _load_historical_from_db(
            db=db,
            symbol=symbol_upper,
            start_date=start_date,
            end_date=end_date,
            interval=interval,
        )
        if fallback_data:
            logger.info(
                "Historical endpoint recovered via DB fallback after provider error (symbol=%s interval=%s)",
                symbol_upper,
                interval,
            )
            return StandardResponse(data=fallback_data, meta=MetaData(count=len(fallback_data)))

        await _schedule_critical_reinforcement(
            symbol=symbol_upper,
            endpoint="equity.historical",
            domains=["prices"],
        )
        return StandardResponse(data=[], error=f"Data unavailable: {str(e)}")


@router.get("/{symbol}/quote", response_model=StandardResponse[StockQuoteData])
@cached(ttl=30, key_prefix="quote")
async def get_quote(
    symbol: str,
    source: str = Query(default="VCI"),
    refresh: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
):
    symbol_upper = _normalize_symbol_input(symbol)
    if not re.fullmatch(r"[A-Z0-9]{3}", symbol_upper):
        logger.warning(f"Rejected invalid quote symbol: '{symbol}' -> '{symbol_upper}'")
        return StandardResponse(
            data=StockQuoteData(
                symbol=symbol_upper or symbol.upper(),
                price=0,
                change=0,
                change_pct=0,
                high=0,
                low=0,
                open=0,
                volume=0,
                updated_at=datetime.utcnow(),
            ),
            error="Invalid symbol format. Expected a 3-character ticker.",
        )

    use_appwrite_data = settings.is_appwrite_configured and settings.resolved_data_backend in {
        "appwrite",
        "hybrid",
    }

    async def _get_db_quote() -> Optional[StockQuoteData]:
        try:
            price_stmt = (
                select(StockPrice)
                .where(StockPrice.symbol == symbol_upper)
                .order_by(StockPrice.time.desc())
                .limit(2)
            )
            price_rows = (await db.execute(price_stmt)).scalars().all()

            snapshot_stmt = (
                select(ScreenerSnapshot)
                .where(ScreenerSnapshot.symbol == symbol_upper)
                .order_by(ScreenerSnapshot.snapshot_date.desc())
                .limit(1)
            )
            snapshot_row = (await db.execute(snapshot_stmt)).scalar_one_or_none()

            latest_row = price_rows[0] if price_rows else None
            previous_row = price_rows[1] if len(price_rows) > 1 else None

            latest_close = (
                float(latest_row.close) if latest_row and latest_row.close is not None else None
            )
            prev_close = (
                float(previous_row.close)
                if previous_row and previous_row.close is not None
                else None
            )
            db_change = (
                latest_close - prev_close
                if latest_close is not None and prev_close is not None
                else None
            )
            db_change_pct = (
                (db_change / prev_close) * 100
                if db_change is not None and prev_close not in (None, 0)
                else None
            )

            latest_price_date = latest_row.time if latest_row else None
            snapshot_date = snapshot_row.snapshot_date if snapshot_row else None
            snapshot_is_fresher = bool(
                snapshot_row
                and snapshot_row.price is not None
                and snapshot_date is not None
                and (latest_price_date is None or snapshot_date > latest_price_date)
            )

            if snapshot_is_fresher and snapshot_row and snapshot_row.price is not None:
                return _build_quote_from_screener_snapshot(snapshot_row, latest_row)

            if latest_row:
                return StockQuoteData(
                    symbol=symbol_upper,
                    price=latest_close,
                    open=float(latest_row.open) if latest_row.open is not None else None,
                    high=float(latest_row.high) if latest_row.high is not None else None,
                    low=float(latest_row.low) if latest_row.low is not None else None,
                    prev_close=prev_close,
                    change=db_change,
                    change_pct=round(db_change_pct, 2) if db_change_pct is not None else None,
                    volume=int(latest_row.volume) if latest_row.volume is not None else None,
                    updated_at=datetime.utcnow(),
                )

            if snapshot_row and snapshot_row.price is not None:
                return _build_quote_from_screener_snapshot(snapshot_row)
        except Exception as db_err:
            logger.warning(f"Quote DB fallback failed for {symbol_upper}: {db_err}")
        return None

    screener_snapshot_quote: Optional[StockQuoteData] = None

    async def _get_screener_snapshot_quote() -> Optional[StockQuoteData]:
        nonlocal screener_snapshot_quote
        if screener_snapshot_quote is None:
            screener_snapshot_quote = await _load_latest_screener_snapshot_quote(db, symbol_upper)
        return screener_snapshot_quote

    if not refresh:
        cached_price_quote = await _load_quote_from_price_cache(symbol_upper)
        if cached_price_quote:
            return StandardResponse(data=cached_price_quote, meta=MetaData(count=1))

        cached_quote = await _get_db_quote()
        if cached_quote:
            return StandardResponse(data=cached_quote, meta=MetaData(count=1))

        if settings.resolved_data_backend == "appwrite" and use_appwrite_data:
            appwrite_quote = await _load_quote_from_appwrite(symbol_upper)
            if appwrite_quote:
                screener_quote = await _get_screener_snapshot_quote()
                if _should_prefer_screener_quote(appwrite_quote, screener_quote):
                    return StandardResponse(data=screener_quote, meta=MetaData(count=1))
                return StandardResponse(data=appwrite_quote, meta=MetaData(count=1))

    try:
        data, _ = await asyncio.wait_for(
            VnstockStockQuoteFetcher.fetch(symbol=symbol_upper, source=source),
            timeout=10,
        )
        screener_quote = await _get_screener_snapshot_quote()
        if _should_prefer_screener_quote(data, screener_quote):
            data = screener_quote
        return StandardResponse(data=data, meta=MetaData(count=1))
    except Exception as e:
        if use_appwrite_data:
            appwrite_quote = await _load_quote_from_appwrite(symbol_upper)
            if appwrite_quote:
                screener_quote = await _get_screener_snapshot_quote()
                if _should_prefer_screener_quote(appwrite_quote, screener_quote):
                    return StandardResponse(
                        data=screener_quote, meta=MetaData(count=1), error=str(e)
                    )
                return StandardResponse(data=appwrite_quote, meta=MetaData(count=1), error=str(e))

        fallback = await _get_db_quote()
        if fallback:
            return StandardResponse(data=fallback, meta=MetaData(count=1), error=str(e))

        # Return mock/empty quote structure to keep UI alive
        return StandardResponse(
            data=StockQuoteData(
                symbol=symbol_upper,
                price=0,
                change=0,
                change_pct=0,
                high=0,
                low=0,
                open=0,
                volume=0,
                updated_at=datetime.utcnow(),
            ),
            error=str(e),
        )


@router.get("/{symbol}/profile", response_model=StandardResponse[Optional[EquityProfileData]])
async def get_profile(
    symbol: str = Path(..., min_length=1, max_length=10, pattern=r"^[A-Za-z0-9._-]+$"),
    refresh: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
):
    symbol_upper = symbol.upper()
    cache_manager = CacheManager(db=db)
    use_appwrite_data = settings.is_appwrite_configured and settings.resolved_data_backend in {
        "appwrite",
        "hybrid",
    }
    try:
        if not refresh:
            cache_result = await cache_manager.get_profile_data(symbol_upper)
            if cache_result.hit:
                company = cache_result.data
                raw_profile = company.raw_data if isinstance(company.raw_data, dict) else {}
                stock_row = (
                    await db.execute(
                        select(
                            Stock.exchange, Stock.listing_date, Stock.industry, Stock.sector
                        ).where(Stock.symbol == symbol_upper)
                    )
                ).first()

                exchange = company.exchange or (stock_row[0] if stock_row else None)
                industry = _pick_optional_text(
                    company.industry,
                    raw_profile.get("industry"),
                    raw_profile.get("icb_name3"),
                    raw_profile.get("icb_name4"),
                    stock_row[2] if stock_row else None,
                )
                sector = _pick_optional_text(
                    company.sector,
                    raw_profile.get("sector"),
                    raw_profile.get("icb_name2"),
                    raw_profile.get("company_type"),
                    stock_row[3] if stock_row else None,
                    industry,
                )
                listing_date = (
                    _coerce_iso_date(company.listing_date)
                    or _coerce_iso_date(raw_profile.get("listing_date"))
                    or _coerce_iso_date(raw_profile.get("listed_date"))
                    or _coerce_iso_date(raw_profile.get("ipo_date"))
                    or _coerce_iso_date(stock_row[1] if stock_row else None)
                )

                established_date = (
                    _coerce_iso_date(company.established_date)
                    or _coerce_iso_date(raw_profile.get("established_date"))
                    or _coerce_iso_date(raw_profile.get("founded_date"))
                    or _coerce_iso_date(raw_profile.get("founded"))
                )

                outstanding_shares = _pick_optional_share_count(
                    company.outstanding_shares,
                    company.listed_shares,
                    raw_profile.get("outstanding_shares"),
                    raw_profile.get("listed_shares"),
                    raw_profile.get("issue_share"),
                    raw_profile.get("financial_ratio_issue_share"),
                    raw_profile.get("listed_volume"),
                    await _get_outstanding_shares(db, symbol_upper),
                )
                listed_shares = _resolve_listed_share_count(
                    company.listed_shares,
                    company.outstanding_shares,
                    raw_profile.get("listed_shares"),
                    raw_profile.get("listed_volume"),
                    raw_profile.get("issue_share"),
                    raw_profile.get("financial_ratio_issue_share"),
                    outstanding_shares=outstanding_shares,
                )
                market_cap = await _resolve_profile_market_cap(
                    db=db,
                    symbol=symbol_upper,
                    outstanding_shares=outstanding_shares,
                    fallback_market_cap=raw_profile.get("market_cap"),
                )

                website = company.website
                if not website:
                    website = raw_profile.get("website") or raw_profile.get("web_site")

                description = company.business_description or raw_profile.get("company_profile")
                if not description:
                    description = raw_profile.get("description")

                address = company.address or raw_profile.get("address")
                phone = company.phone or raw_profile.get("phone") or raw_profile.get("telephone")
                email = company.email or raw_profile.get("email")

                if cache_result.is_stale:
                    await _schedule_refresh(
                        f"profile:{symbol_upper}",
                        lambda: _refresh_profile_cache(symbol_upper),
                    )
                return StandardResponse(
                    data=EquityProfileData(
                        symbol=company.symbol,
                        company_name=company.company_name,
                        short_name=company.short_name,
                        exchange=exchange,
                        industry=industry,
                        sector=sector,
                        established_date=established_date,
                        listing_date=listing_date,
                        website=website,
                        description=description,
                        outstanding_shares=outstanding_shares,
                        listed_shares=listed_shares,
                        market_cap=market_cap,
                        address=address,
                        phone=phone,
                        email=email,
                    ),
                    meta=MetaData(
                        count=1,
                        last_data_date=await _get_profile_last_data_date(db, symbol_upper),
                    ),
                )

        if not refresh and settings.resolved_data_backend == "appwrite" and use_appwrite_data:
            appwrite_profile = await _load_profile_from_appwrite(symbol_upper, db)
            if appwrite_profile:
                return StandardResponse(
                    data=appwrite_profile,
                    meta=MetaData(
                        count=1,
                        last_data_date=await _get_profile_last_data_date(db, symbol_upper),
                    ),
                )

        fallback_profile: Optional[EquityProfileData] = None
        if not refresh:
            stock_result = await db.execute(select(Stock).where(Stock.symbol == symbol_upper))
            stock = stock_result.scalar_one_or_none()
            if stock:
                market_cap = await _resolve_profile_market_cap(
                    db=db,
                    symbol=symbol_upper,
                    outstanding_shares=None,
                    fallback_market_cap=None,
                )
                fallback_profile = EquityProfileData(
                    symbol=stock.symbol,
                    company_name=stock.company_name,
                    short_name=stock.short_name,
                    exchange=stock.exchange,
                    industry=stock.industry,
                    sector=stock.sector or stock.industry,
                    listing_date=_coerce_iso_date(stock.listing_date),
                    market_cap=market_cap,
                )

        if fallback_profile and not refresh:
            await _schedule_refresh(
                f"profile:{symbol_upper}",
                lambda: _refresh_profile_cache(symbol_upper),
            )
            return StandardResponse(
                data=fallback_profile,
                meta=MetaData(
                    count=1,
                    last_data_date=await _get_profile_last_data_date(db, symbol_upper),
                ),
            )

        if not refresh and use_appwrite_data:
            appwrite_profile = await _load_profile_from_appwrite(symbol_upper, db)
            if appwrite_profile:
                return StandardResponse(
                    data=appwrite_profile,
                    meta=MetaData(
                        count=1,
                        last_data_date=await _get_profile_last_data_date(db, symbol_upper),
                    ),
                )

        params = EquityProfileQueryParams(symbol=symbol)
        data = await asyncio.wait_for(
            VnstockEquityProfileFetcher.fetch(params),
            timeout=10,
        )
        profile_data = data[0] if data else None
        if profile_data:
            raw_profile = {}
            if hasattr(profile_data, "model_extra") and isinstance(profile_data.model_extra, dict):
                raw_profile = profile_data.model_extra

            stock_row = (
                await db.execute(
                    select(Stock.exchange, Stock.listing_date, Stock.industry, Stock.sector).where(
                        Stock.symbol == symbol_upper
                    )
                )
            ).first()
            if not profile_data.exchange and stock_row and stock_row[0]:
                profile_data.exchange = stock_row[0]

            if not profile_data.listing_date and stock_row:
                profile_data.listing_date = _coerce_iso_date(stock_row[1])

            if not profile_data.listing_date:
                profile_data.listing_date = (
                    _coerce_iso_date(raw_profile.get("listing_date"))
                    or _coerce_iso_date(raw_profile.get("listed_date"))
                    or _coerce_iso_date(raw_profile.get("ipo_date"))
                )

            if profile_data.established_date:
                profile_data.established_date = _coerce_iso_date(profile_data.established_date)
            else:
                profile_data.established_date = (
                    _coerce_iso_date(raw_profile.get("established_date"))
                    or _coerce_iso_date(raw_profile.get("founded_date"))
                    or _coerce_iso_date(raw_profile.get("founded"))
                )

            if not profile_data.website:
                profile_data.website = raw_profile.get("website") or raw_profile.get("web_site")

            if not profile_data.description:
                profile_data.description = raw_profile.get("company_profile") or raw_profile.get(
                    "description"
                )

            if not profile_data.address:
                profile_data.address = raw_profile.get("address")
            if not profile_data.phone:
                profile_data.phone = raw_profile.get("phone") or raw_profile.get("telephone")
            if not profile_data.email:
                profile_data.email = raw_profile.get("email")

            profile_data.industry = _pick_optional_text(
                profile_data.industry,
                raw_profile.get("industry"),
                raw_profile.get("icb_name3"),
                raw_profile.get("icb_name4"),
                stock_row[2] if stock_row else None,
            )
            profile_data.sector = _pick_optional_text(
                profile_data.sector,
                raw_profile.get("sector"),
                raw_profile.get("icb_name2"),
                raw_profile.get("company_type"),
                stock_row[3] if stock_row else None,
                profile_data.industry,
            )

            profile_data.outstanding_shares = _pick_optional_share_count(
                profile_data.outstanding_shares,
                profile_data.listed_shares,
                raw_profile.get("outstanding_shares"),
                raw_profile.get("listed_shares"),
                raw_profile.get("issue_share"),
                raw_profile.get("financial_ratio_issue_share"),
                raw_profile.get("listed_volume"),
                await _get_outstanding_shares(db, symbol_upper),
            )
            profile_data.listed_shares = _resolve_listed_share_count(
                profile_data.listed_shares,
                raw_profile.get("listed_shares"),
                raw_profile.get("listed_volume"),
                raw_profile.get("issue_share"),
                raw_profile.get("financial_ratio_issue_share"),
                outstanding_shares=profile_data.outstanding_shares,
            )

            profile_data.market_cap = await _resolve_profile_market_cap(
                db=db,
                symbol=symbol_upper,
                outstanding_shares=profile_data.outstanding_shares,
                fallback_market_cap=profile_data.market_cap,
            )

            await cache_manager.store_profile_data(
                symbol_upper, profile_data.model_dump(mode="json")
            )
            return StandardResponse(
                data=profile_data,
                meta=MetaData(
                    count=1,
                    last_data_date=await _get_profile_last_data_date(db, symbol_upper),
                ),
            )

        # Return None data instead of 404
        return StandardResponse(data=None, error="Profile not found")
    except BaseException as e:
        if _is_control_flow_exception(e):
            raise
        logger.warning("Profile endpoint failed open for %s: %s", symbol_upper, e)

        if use_appwrite_data:
            appwrite_profile = await _load_profile_from_appwrite(symbol_upper, db)
            if appwrite_profile:
                return StandardResponse(
                    data=appwrite_profile,
                    meta=MetaData(
                        count=1,
                        last_data_date=await _get_profile_last_data_date(db, symbol_upper),
                    ),
                    error=str(e),
                )

        return StandardResponse(data=None, error=str(e))


@router.get("/{symbol}/financials", response_model=StandardResponse[List[FinancialStatementData]])
async def get_financials(
    symbol: str,
    statement_type: Literal["income", "balance", "cashflow"] = Query("income"),
    period: Literal["year", "quarter", "FY", "Q1", "Q2", "Q3", "Q4", "TTM"] = Query("year"),
    limit: int = Query(5, ge=1, le=20),
    db: AsyncSession = Depends(get_db),
):
    statement_model = {
        "income": IncomeStatement,
        "balance": BalanceSheet,
        "cashflow": CashFlow,
    }.get(statement_type)
    last_data_date = (
        await _get_model_last_updated(db, statement_model, symbol)
        if statement_model is not None
        else None
    )
    try:
        data = await get_financials_with_ttm(
            symbol=symbol,
            statement_type=statement_type,
            period=period,
            limit=limit,
        )
        fallback_data = await _load_financial_statement_fallback(
            db=db,
            symbol=symbol,
            statement_type=statement_type,
            period=period,
            limit=limit,
        )
        if data:
            data = _merge_financial_statement_rows(data, fallback_data)
            data = _enrich_financial_statement_rows(data)
            if statement_type == StatementType.INCOME.value:
                data = await _cross_fill_income_statement_rows(
                    db=db,
                    symbol=symbol,
                    period=period,
                    limit=limit,
                    rows=data,
                )
            return StandardResponse(
                data=data,
                meta=MetaData(count=len(data), last_data_date=last_data_date),
            )

        if fallback_data:
            fallback_data = _enrich_financial_statement_rows(fallback_data)
            if statement_type == StatementType.INCOME.value:
                fallback_data = await _cross_fill_income_statement_rows(
                    db=db,
                    symbol=symbol,
                    period=period,
                    limit=limit,
                    rows=fallback_data,
                )
            return StandardResponse(
                data=fallback_data,
                meta=MetaData(count=len(fallback_data), last_data_date=last_data_date),
            )

        return StandardResponse(data=[], meta=MetaData(count=0, last_data_date=last_data_date))
    except BaseException as e:
        if _is_control_flow_exception(e):
            raise
        logger.warning(f"Live API failed for financials {symbol}, trying database fallback: {e}")
        try:
            fallback_data = await _load_financial_statement_fallback(
                db=db,
                symbol=symbol,
                statement_type=statement_type,
                period=period,
                limit=limit,
            )
            if fallback_data:
                fallback_data = _enrich_financial_statement_rows(fallback_data)
                if statement_type == StatementType.INCOME.value:
                    fallback_data = await _cross_fill_income_statement_rows(
                        db=db,
                        symbol=symbol,
                        period=period,
                        limit=limit,
                        rows=fallback_data,
                    )
                return StandardResponse(
                    data=fallback_data,
                    meta=MetaData(count=len(fallback_data), last_data_date=last_data_date),
                )
        except Exception as fallback_error:
            logger.warning(f"DB fallback failed for financials {symbol}: {fallback_error}")

        return StandardResponse(data=[], error=f"Data unavailable: {str(e)}")


@router.get("/{symbol}/peers")
@cached(ttl=900, key_prefix="equity_peers")
async def get_equity_peers(
    symbol: str,
    limit: int = Query(default=10, ge=1, le=20),
):
    peers = await comparison_service.get_peers(symbol=symbol.upper(), limit=limit)
    payload = peers.model_dump(mode="json") if hasattr(peers, "model_dump") else dict(peers)
    return payload


@router.get(
    "/{symbol}/correlation-matrix", response_model=StandardResponse[CorrelationMatrixPayload]
)
@cached(ttl=900, key_prefix="correlation_matrix")
async def get_correlation_matrix(
    symbol: str,
    days: int = Query(default=60, ge=20, le=252),
    top_n: int = Query(default=10, ge=5, le=20),
    db: AsyncSession = Depends(get_db),
):
    symbol_upper = symbol.upper().strip()
    peers = await comparison_service.get_peers(symbol=symbol_upper, limit=max(1, top_n - 1))
    peer_symbols = [
        str(item.symbol).upper() for item in peers.peers if getattr(item, "symbol", None)
    ]
    universe_symbols = [symbol_upper, *peer_symbols]
    universe_symbols = list(dict.fromkeys(universe_symbols))[:top_n]

    end_date = date.today()
    start_date = end_date - timedelta(days=max(days * 2, days + 30))

    prices_result = await db.execute(
        select(StockPrice.symbol, StockPrice.time, StockPrice.close)
        .where(
            StockPrice.symbol.in_(universe_symbols),
            StockPrice.interval == "1D",
            StockPrice.time >= start_date,
            StockPrice.time <= end_date,
        )
        .order_by(StockPrice.symbol, StockPrice.time)
    )
    rows = prices_result.all()
    if not rows:
        return StandardResponse(
            data=CorrelationMatrixPayload(
                symbol=symbol_upper,
                sector=peers.industry,
                days=days,
                symbols=universe_symbols,
                matrix=[],
                returns_count=0,
            ),
            meta=MetaData(count=0, symbol=symbol_upper),
        )

    frame = pd.DataFrame(rows, columns=["symbol", "time", "close"])
    frame["time"] = pd.to_datetime(frame["time"], errors="coerce").dt.date
    frame["close"] = pd.to_numeric(frame["close"], errors="coerce")
    frame = frame.dropna(subset=["time", "close"])
    if frame.empty:
        return StandardResponse(
            data=CorrelationMatrixPayload(
                symbol=symbol_upper,
                sector=peers.industry,
                days=days,
                symbols=universe_symbols,
                matrix=[],
                returns_count=0,
            ),
            meta=MetaData(count=0, symbol=symbol_upper),
        )

    pivot = frame.pivot_table(index="time", columns="symbol", values="close", aggfunc="last")
    pivot = pivot.sort_index().ffill().tail(days + 1)
    returns = pivot.pct_change().replace([np.inf, -np.inf], np.nan).dropna(how="all")

    valid_symbols = [
        ticker
        for ticker in universe_symbols
        if ticker in returns.columns and returns[ticker].count() >= max(10, days // 3)
    ]
    if (
        symbol_upper not in valid_symbols
        and symbol_upper in returns.columns
        and returns[symbol_upper].count() >= 5
    ):
        valid_symbols.insert(0, symbol_upper)
    valid_symbols = list(dict.fromkeys(valid_symbols))

    if not valid_symbols:
        return StandardResponse(
            data=CorrelationMatrixPayload(
                symbol=symbol_upper,
                sector=peers.industry,
                days=days,
                symbols=universe_symbols,
                matrix=[],
                returns_count=0,
            ),
            meta=MetaData(count=0, symbol=symbol_upper),
        )

    corr = returns[valid_symbols].corr(min_periods=max(10, days // 3))
    matrix: List[CorrelationMatrixCell] = []
    for row_symbol in valid_symbols:
        for col_symbol in valid_symbols:
            value = (
                corr.loc[row_symbol, col_symbol]
                if row_symbol in corr.index and col_symbol in corr.columns
                else np.nan
            )
            matrix.append(
                CorrelationMatrixCell(
                    x=row_symbol,
                    y=col_symbol,
                    value=None if pd.isna(value) else round(float(value), 4),
                )
            )

    return StandardResponse(
        data=CorrelationMatrixPayload(
            symbol=symbol_upper,
            sector=peers.industry,
            days=days,
            symbols=valid_symbols,
            matrix=matrix,
            returns_count=int(len(returns.index)),
        ),
        meta=MetaData(
            count=len(matrix),
            symbol=symbol_upper,
            last_data_date=str(returns.index.max()) if len(returns.index) else None,
        ),
    )


@router.get("/{symbol}/ttm", response_model=StandardResponse[dict[str, Any]])
@cached(ttl=3600, key_prefix="equity_ttm")
async def get_ttm_snapshot(
    symbol: str,
):
    income_rows = await get_financials_with_ttm(
        symbol=symbol,
        statement_type=StatementType.INCOME.value,
        period="TTM",
        limit=1,
    )
    balance_rows = await get_financials_with_ttm(
        symbol=symbol,
        statement_type=StatementType.BALANCE.value,
        period="TTM",
        limit=1,
    )
    cashflow_rows = await get_financials_with_ttm(
        symbol=symbol,
        statement_type=StatementType.CASHFLOW.value,
        period="TTM",
        limit=1,
    )

    payload = {
        "symbol": symbol.upper(),
        "income": income_rows[0].model_dump(mode="json") if income_rows else None,
        "balance": balance_rows[0].model_dump(mode="json") if balance_rows else None,
        "cash_flow": cashflow_rows[0].model_dump(mode="json") if cashflow_rows else None,
    }
    return StandardResponse(data=payload, meta=MetaData(count=1))


def _growth_rate(current: Optional[float], previous: Optional[float]) -> Optional[float]:
    if current is None or previous in (None, 0):
        return None
    return ((current - previous) / previous) * 100


@router.get("/{symbol}/growth", response_model=StandardResponse[dict[str, Any]])
@cached(ttl=3600, key_prefix="equity_growth")
async def get_growth_rates(
    symbol: str,
    db: AsyncSession = Depends(get_db),
):
    symbol_upper = symbol.upper()

    annual_income_stmt = (
        select(IncomeStatement)
        .where(IncomeStatement.symbol == symbol_upper, IncomeStatement.period_type == "year")
        .order_by(desc(IncomeStatement.fiscal_year))
        .limit(2)
    )
    annual_balance_stmt = (
        select(BalanceSheet)
        .where(BalanceSheet.symbol == symbol_upper, BalanceSheet.period_type == "year")
        .order_by(desc(BalanceSheet.fiscal_year))
        .limit(2)
    )
    quarterly_income_stmt = (
        select(IncomeStatement)
        .where(IncomeStatement.symbol == symbol_upper, IncomeStatement.period_type == "quarter")
        .order_by(desc(IncomeStatement.fiscal_year), desc(IncomeStatement.fiscal_quarter))
        .limit(8)
    )

    annual_income = (await db.execute(annual_income_stmt)).scalars().all()
    annual_balance = (await db.execute(annual_balance_stmt)).scalars().all()
    quarterly_income = (await db.execute(quarterly_income_stmt)).scalars().all()

    yoy: dict[str, Optional[float]] = {
        "revenue_growth": None,
        "earnings_growth": None,
        "eps_growth": None,
        "ebitda_growth": None,
        "asset_growth": None,
    }
    qoq: dict[str, Optional[float]] = {
        "revenue_growth": None,
        "earnings_growth": None,
        "eps_growth": None,
        "ebitda_growth": None,
    }

    if len(annual_income) >= 2:
        current, previous = annual_income[0], annual_income[1]
        yoy["revenue_growth"] = _growth_rate(current.revenue, previous.revenue)
        yoy["earnings_growth"] = _growth_rate(current.net_income, previous.net_income)
        yoy["eps_growth"] = _growth_rate(current.eps, previous.eps)
        yoy["ebitda_growth"] = _growth_rate(current.ebitda, previous.ebitda)

    if len(annual_balance) >= 2:
        current, previous = annual_balance[0], annual_balance[1]
        yoy["asset_growth"] = _growth_rate(current.total_assets, previous.total_assets)

    latest_quarter = quarterly_income[0] if quarterly_income else None
    if latest_quarter and latest_quarter.fiscal_quarter:
        comparison_stmt = (
            select(IncomeStatement)
            .where(
                IncomeStatement.symbol == symbol_upper,
                IncomeStatement.period_type == "quarter",
                IncomeStatement.fiscal_year == latest_quarter.fiscal_year - 1,
                IncomeStatement.fiscal_quarter == latest_quarter.fiscal_quarter,
            )
            .limit(1)
        )
        same_quarter_prev_year = (await db.execute(comparison_stmt)).scalar_one_or_none()
        if same_quarter_prev_year:
            qoq["revenue_growth"] = _growth_rate(
                latest_quarter.revenue,
                same_quarter_prev_year.revenue,
            )
            qoq["earnings_growth"] = _growth_rate(
                latest_quarter.net_income,
                same_quarter_prev_year.net_income,
            )
            qoq["eps_growth"] = _growth_rate(latest_quarter.eps, same_quarter_prev_year.eps)
            qoq["ebitda_growth"] = _growth_rate(
                latest_quarter.ebitda, same_quarter_prev_year.ebitda
            )

    payload = {
        "symbol": symbol_upper,
        "yoy": yoy,
        "qoq": qoq,
        "as_of": {
            "annual": annual_income[0].period if annual_income else None,
            "quarter": latest_quarter.period if latest_quarter else None,
        },
    }
    return StandardResponse(data=payload, meta=MetaData(count=1))


# Re-adding missing endpoints for completeness
@router.get("/{symbol}/news", response_model=StandardResponse[List[Any]])
@cached(ttl=settings.news_retention_days * 86400, key_prefix="company_news_v26")
async def get_company_news(symbol: str, limit: int = Query(20)):
    try:
        data = await get_company_news_rows(symbol, limit=limit)
        return StandardResponse(data=data, meta=MetaData(count=len(data)))
    except Exception as e:
        return StandardResponse(data=[], error=str(e))


@router.get("/{symbol}/events", response_model=StandardResponse[List[Any]])
@cached(ttl=settings.news_retention_days * 86400, key_prefix="company_events_v26")
async def get_company_events(symbol: str, limit: int = Query(20, ge=1, le=100)):
    try:
        data = await VnstockCompanyEventsFetcher.fetch(
            CompanyEventsQueryParams(symbol=symbol, limit=limit)
        )
        return StandardResponse(data=data, meta=MetaData(count=len(data)))
    except Exception as e:
        return StandardResponse(data=[], error=str(e))


@router.get("/{symbol}/calendar", response_model=StandardResponse[dict[str, Any]])
@cached(ttl=settings.news_retention_days * 86400, key_prefix="company_calendar_v26")
async def get_company_calendar(symbol: str, limit: int = Query(20, ge=1, le=100)):
    symbol_upper = symbol.upper()
    try:
        events = await VnstockCompanyEventsFetcher.fetch(
            CompanyEventsQueryParams(symbol=symbol_upper, limit=limit)
        )
        payload = {
            "symbol": symbol_upper,
            "source": "company_events",
            "message": "Upcoming company calendar events",
            "data": events,
        }
        return StandardResponse(data=payload, meta=MetaData(count=len(events)))
    except Exception as e:
        payload = {
            "symbol": symbol_upper,
            "source": "unavailable",
            "message": "Company calendar data not yet available.",
            "data": [],
        }
        return StandardResponse(data=payload, meta=MetaData(count=0), error=str(e))


@router.get("/{symbol}/estimates", response_model=StandardResponse[dict[str, Any]])
async def get_analyst_estimates(symbol: str):
    symbol_upper = symbol.upper()
    payload = {
        "symbol": symbol_upper,
        "source": "unavailable",
        "message": "VN market analyst consensus data not yet available.",
        "data": [],
    }
    return StandardResponse(data=payload, meta=MetaData(count=0))


@router.get("/{symbol}/shareholders", response_model=StandardResponse[List[Any]])
async def get_shareholders(symbol: str, db: AsyncSession = Depends(get_db)):
    symbol_upper = symbol.upper()
    try:
        data = await asyncio.wait_for(
            VnstockShareholdersFetcher.fetch(ShareholdersQueryParams(symbol=symbol_upper)),
            timeout=_provider_timeout_budget(),
        )
        if not data:
            fallback_data = await _load_shareholders_fallback(db=db, symbol=symbol_upper)
            if fallback_data:
                return StandardResponse(data=fallback_data, meta=MetaData(count=len(fallback_data)))
            await _schedule_critical_reinforcement(
                symbol=symbol_upper,
                endpoint="equity.shareholders",
                domains=["shareholders"],
            )
        return StandardResponse(data=data, meta=MetaData(count=len(data)))
    except BaseException as e:
        if _is_control_flow_exception(e):
            raise
        logger.warning("Shareholders endpoint failed (symbol=%s): %s", symbol_upper, e)
        fallback_data = await _load_shareholders_fallback(db=db, symbol=symbol_upper)
        if fallback_data:
            return StandardResponse(
                data=fallback_data,
                meta=MetaData(count=len(fallback_data)),
                error=str(e),
            )
        await _schedule_critical_reinforcement(
            symbol=symbol_upper,
            endpoint="equity.shareholders",
            domains=["shareholders"],
        )
        return StandardResponse(data=[], error=str(e))


@router.get("/{symbol}/officers", response_model=StandardResponse[List[Any]])
async def get_officers(symbol: str):
    try:
        data = await VnstockOfficersFetcher.fetch(OfficersQueryParams(symbol=symbol))
        return StandardResponse(data=data, meta=MetaData(count=len(data)))
    except Exception as e:
        return StandardResponse(data=[], error=str(e))


def _depth_value(depth_data: Any, key: str) -> Any:
    if isinstance(depth_data, dict):
        if key in depth_data:
            return depth_data.get(key)
        camel_key = re.sub(r"_([a-z])", lambda match: match.group(1).upper(), key)
        return depth_data.get(camel_key)
    return getattr(depth_data, key, None)


def _normalize_orderbook_entries(depth_data: Any) -> List[dict[str, Any]]:
    entries: List[dict[str, Any]] = []

    for level in range(1, 4):
        bid_level = _depth_value(depth_data, f"bid_{level}")
        ask_level = _depth_value(depth_data, f"ask_{level}")

        bid_price = _depth_value(bid_level, "price") if bid_level else None
        ask_price = _depth_value(ask_level, "price") if ask_level else None
        bid_vol = _depth_value(bid_level, "volume") if bid_level else None
        ask_vol = _depth_value(ask_level, "volume") if ask_level else None
        price = bid_price if bid_price is not None else ask_price

        if any(value is not None for value in (price, bid_vol, ask_vol)):
            entries.append(
                {
                    "level": level,
                    "price": price,
                    "bid_vol": bid_vol,
                    "ask_vol": ask_vol,
                }
            )

    raw_levels = _depth_value(depth_data, "raw_levels") or []
    if entries or not raw_levels:
        return entries

    for row in raw_levels[:10]:
        bid_price = row.get("bidPrice1") or row.get("bid1")
        ask_price = row.get("offerPrice1") or row.get("askPrice1") or row.get("ask1")
        bid_vol = row.get("bidVol1") or row.get("bidVolume1") or row.get("buyVol")
        ask_vol = row.get("offerVol1") or row.get("askVolume1") or row.get("sellVol")
        price = bid_price if bid_price is not None else ask_price

        if any(value is not None for value in (price, bid_vol, ask_vol)):
            entries.append(
                {
                    "level": len(entries) + 1,
                    "price": price,
                    "bid_vol": bid_vol,
                    "ask_vol": ask_vol,
                }
            )

    return entries


def _build_orderbook_payload(
    symbol: str,
    depth_data: Any,
    *,
    snapshot_time: str | None = None,
) -> dict[str, Any]:
    cached_entries = depth_data.get("entries") if isinstance(depth_data, dict) else None
    entries = (
        cached_entries
        if isinstance(cached_entries, list) and cached_entries
        else _normalize_orderbook_entries(depth_data)
    )
    return {
        "symbol": symbol.upper(),
        "entries": entries,
        "total_bid_volume": _depth_value(depth_data, "total_bid_volume"),
        "total_ask_volume": _depth_value(depth_data, "total_ask_volume"),
        "last_price": _depth_value(depth_data, "last_price"),
        "last_volume": _depth_value(depth_data, "last_volume"),
        "snapshot_time": snapshot_time,
    }


def _build_orderbook_payload_from_snapshot(snapshot: OrderbookSnapshot) -> dict[str, Any]:
    payload = _build_orderbook_payload(
        snapshot.symbol,
        snapshot.price_depth or {},
        snapshot_time=_serialize_meta_datetime(snapshot.snapshot_time),
    )
    if payload.get("entries"):
        return payload

    entries: List[dict[str, Any]] = []
    for level in range(1, 4):
        bid_price = getattr(snapshot, f"bid{level}_price")
        ask_price = getattr(snapshot, f"ask{level}_price")
        bid_volume = getattr(snapshot, f"bid{level}_volume")
        ask_volume = getattr(snapshot, f"ask{level}_volume")
        price = bid_price if bid_price is not None else ask_price
        if any(value is not None for value in (price, bid_volume, ask_volume)):
            entries.append(
                {
                    "level": level,
                    "price": price,
                    "bid_vol": bid_volume,
                    "ask_vol": ask_volume,
                }
            )

    payload["entries"] = entries
    payload["total_bid_volume"] = snapshot.total_bid_volume
    payload["total_ask_volume"] = snapshot.total_ask_volume
    return payload


async def _load_cached_orderbook_payload(symbol: str) -> dict[str, Any] | None:
    cache_key = build_cache_key("vnibb", "orderbook", "latest", symbol.upper())
    try:
        cached = await redis_client.get_json(cache_key)
    except Exception:
        return None

    if not isinstance(cached, dict):
        return None

    payload = _build_orderbook_payload(
        symbol,
        cached,
        snapshot_time=_pick_optional_text(cached.get("snapshot_time"), cached.get("cached_at")),
    )
    if payload.get("entries") or payload.get("total_bid_volume") is not None:
        return payload
    return None


async def _load_orderbook_snapshot_from_db(
    db: AsyncSession,
    symbol: str,
) -> dict[str, Any] | None:
    result = await db.execute(
        select(OrderbookSnapshot)
        .where(OrderbookSnapshot.symbol == symbol.upper())
        .order_by(desc(OrderbookSnapshot.snapshot_time))
        .limit(1)
    )
    snapshot = result.scalar_one_or_none()
    if snapshot is None:
        return None
    return _build_orderbook_payload_from_snapshot(snapshot)


async def _cache_orderbook_payload(symbol: str, payload: dict[str, Any]) -> None:
    snapshot_time = (
        _pick_optional_text(payload.get("snapshot_time")) or datetime.utcnow().isoformat()
    )
    trade_date = str(snapshot_time)[:10]

    latest_key = build_cache_key("vnibb", "orderbook", "latest", symbol.upper())
    daily_key = build_cache_key("vnibb", "orderbook", "daily", symbol.upper(), trade_date)

    try:
        await redis_client.set_json(latest_key, payload, ttl=CACHE_TTL_ORDERBOOK)
        await redis_client.set_json(daily_key, payload, ttl=CACHE_TTL_ORDERBOOK_DAILY)
    except Exception:
        return


async def _get_orderbook_payload(symbol: str, db: AsyncSession) -> dict[str, Any]:
    cached_payload = await _load_cached_orderbook_payload(symbol)
    if cached_payload is not None:
        return cached_payload

    try:
        depth = await asyncio.wait_for(
            VnstockPriceDepthFetcher.fetch(symbol=symbol.upper(), source=settings.vnstock_source),
            timeout=30,
        )
    except Exception:
        snapshot_payload = await _load_orderbook_snapshot_from_db(db, symbol)
        if snapshot_payload is not None:
            return snapshot_payload
        raise

    payload = _build_orderbook_payload(
        symbol,
        depth,
        snapshot_time=datetime.utcnow().isoformat(),
    )
    await _cache_orderbook_payload(symbol, payload)
    return payload


@router.get("/{symbol}/price-depth", response_model=StandardResponse[dict[str, Any]])
async def get_price_depth(symbol: str, db: AsyncSession = Depends(get_db)):
    try:
        payload = await _get_orderbook_payload(symbol, db)
        return StandardResponse(
            data=payload,
            meta=MetaData(
                count=len(payload.get("entries", [])),
                last_data_date=_pick_optional_text(payload.get("snapshot_time")),
            ),
        )
    except asyncio.TimeoutError:
        return StandardResponse(
            data={"symbol": symbol.upper(), "entries": []}, error="Request timed out"
        )
    except Exception as e:
        return StandardResponse(data={"symbol": symbol.upper(), "entries": []}, error=str(e))


@router.get("/{symbol}/orderbook", response_model=StandardResponse[dict[str, Any]])
async def get_orderbook(symbol: str, db: AsyncSession = Depends(get_db)):
    try:
        payload = await _get_orderbook_payload(symbol, db)
        return StandardResponse(
            data=payload,
            meta=MetaData(
                count=len(payload.get("entries", [])),
                last_data_date=_pick_optional_text(payload.get("snapshot_time")),
            ),
        )
    except asyncio.TimeoutError:
        return StandardResponse(
            data={"symbol": symbol.upper(), "entries": []}, error="Request timed out"
        )
    except Exception as e:
        return StandardResponse(data={"symbol": symbol.upper(), "entries": []}, error=str(e))


@router.get("/{symbol}/intraday", response_model=StandardResponse[List[Any]])
async def get_intraday(symbol: str, limit: int = Query(200, ge=1, le=1000)):
    try:
        data = await asyncio.wait_for(
            VnstockIntradayFetcher.fetch(IntradayQueryParams(symbol=symbol.upper(), limit=limit)),
            timeout=30,
        )
        return StandardResponse(data=data, meta=MetaData(count=len(data)))
    except (asyncio.TimeoutError, ProviderTimeoutError):
        return StandardResponse(data=[], error="Request timed out")
    except Exception as e:
        return StandardResponse(data=[], error=str(e))


@router.get(
    "/{symbol}/transaction-flow",
    response_model=StandardResponse[TransactionFlowPayload],
)
@cached(ttl=300, key_prefix="transaction_flow")
async def get_transaction_flow(
    symbol: str,
    days: int = Query(30, ge=5, le=90),
    db: AsyncSession = Depends(get_db),
):
    symbol_upper = symbol.upper()

    flow_result = await db.execute(
        select(OrderFlowDaily)
        .where(OrderFlowDaily.symbol == symbol_upper)
        .order_by(desc(OrderFlowDaily.trade_date))
        .limit(days)
    )
    flow_rows = list(reversed(flow_result.scalars().all()))

    if not flow_rows:
        return StandardResponse(
            data=TransactionFlowPayload(
                symbol=symbol_upper,
                days=days,
                scopes=["total", "domestic", "foreign", "proprietary"],
                modes=["value", "volume"],
                note="Domestic flow is derived as total minus foreign minus proprietary.",
                data=[],
            ),
            meta=MetaData(count=0, symbol=symbol_upper),
        )

    trade_dates = [row.trade_date for row in flow_rows]

    foreign_result = await db.execute(
        select(ForeignTrading).where(
            ForeignTrading.symbol == symbol_upper,
            ForeignTrading.trade_date.in_(trade_dates),
        )
    )
    foreign_map = {row.trade_date: row for row in foreign_result.scalars().all()}

    price_result = await db.execute(
        select(StockPrice).where(
            StockPrice.symbol == symbol_upper,
            StockPrice.interval == "1D",
            StockPrice.time.in_(trade_dates),
        )
    )
    price_map = {row.time: row for row in price_result.scalars().all()}

    def _estimate_value(net_volume: Optional[int], price_value: Optional[float]) -> Optional[float]:
        if net_volume is None or price_value in (None, 0):
            return None
        return float(net_volume) * float(price_value)

    points: List[TransactionFlowPoint] = []
    for row in flow_rows:
        price_row = price_map.get(row.trade_date)
        foreign_row = foreign_map.get(row.trade_date)

        price_value = _pick_optional_float(None if price_row is None else price_row.close)
        total_buy_value = _pick_optional_float(row.buy_value)
        total_sell_value = _pick_optional_float(row.sell_value)
        total_net_value = _pick_optional_float(row.net_value)
        if total_net_value is None and total_buy_value is not None and total_sell_value is not None:
            total_net_value = total_buy_value - total_sell_value

        total_buy_volume = _coerce_optional_int(row.buy_volume)
        total_sell_volume = _coerce_optional_int(row.sell_volume)
        total_net_volume = _coerce_optional_int(row.net_volume)
        if (
            total_net_volume is None
            and total_buy_volume is not None
            and total_sell_volume is not None
        ):
            total_net_volume = total_buy_volume - total_sell_volume

        foreign_net_volume = _coerce_optional_int(
            row.foreign_net_volume
            if row.foreign_net_volume is not None
            else (None if foreign_row is None else foreign_row.net_volume)
        )
        foreign_net_value = _pick_optional_float(
            None if foreign_row is None else foreign_row.net_value,
            _estimate_value(foreign_net_volume, price_value),
        )

        proprietary_net_volume = _coerce_optional_int(row.proprietary_net_volume)
        proprietary_net_value = _pick_optional_float(
            _estimate_value(proprietary_net_volume, price_value)
        )

        domestic_net_volume = None
        if total_net_volume is not None:
            domestic_net_volume = (
                total_net_volume - (foreign_net_volume or 0) - (proprietary_net_volume or 0)
            )

        domestic_net_value = None
        if total_net_value is not None:
            domestic_net_value = (
                total_net_value - (foreign_net_value or 0.0) - (proprietary_net_value or 0.0)
            )

        points.append(
            TransactionFlowPoint(
                date=row.trade_date.isoformat(),
                price=price_value,
                total_buy_value=total_buy_value,
                total_sell_value=total_sell_value,
                total_gross_value=(total_buy_value or 0.0) + (total_sell_value or 0.0)
                if total_buy_value is not None or total_sell_value is not None
                else None,
                total_net_value=total_net_value,
                total_buy_volume=total_buy_volume,
                total_sell_volume=total_sell_volume,
                total_volume=(total_buy_volume or 0) + (total_sell_volume or 0)
                if total_buy_volume is not None or total_sell_volume is not None
                else None,
                total_net_volume=total_net_volume,
                foreign_net_value=foreign_net_value,
                foreign_net_volume=foreign_net_volume,
                proprietary_net_value=proprietary_net_value,
                proprietary_net_volume=proprietary_net_volume,
                domestic_net_value=domestic_net_value,
                domestic_net_volume=domestic_net_volume,
                big_order_count=_coerce_optional_int(row.big_order_count),
                block_trade_count=_coerce_optional_int(row.block_trade_count),
            )
        )

    payload = TransactionFlowPayload(
        symbol=symbol_upper,
        days=days,
        scopes=["total", "domestic", "foreign", "proprietary"],
        modes=["value", "volume"],
        note="Domestic flow is derived as total minus foreign minus proprietary.",
        data=points,
    )
    last_data_date = points[-1].date if points else None
    return StandardResponse(
        data=payload,
        meta=MetaData(count=len(points), symbol=symbol_upper, last_data_date=last_data_date),
    )


@router.get("/{symbol}/foreign-trading", response_model=StandardResponse[List[Any]])
async def get_foreign_trading(symbol: str, limit: int = Query(60, ge=1, le=365)):
    try:
        data = await asyncio.wait_for(
            VnstockForeignTradingFetcher.fetch(
                ForeignTradingQueryParams(symbol=symbol.upper(), limit=limit)
            ),
            timeout=30,
        )
        return StandardResponse(data=data, meta=MetaData(count=len(data)))
    except (asyncio.TimeoutError, ProviderTimeoutError):
        return StandardResponse(data=[], error="Request timed out")
    except Exception as e:
        return StandardResponse(data=[], error=str(e))


@router.get("/{symbol}/subsidiaries", response_model=StandardResponse[List[Any]])
async def get_subsidiaries(symbol: str):
    try:
        data = await asyncio.wait_for(
            VnstockSubsidiariesFetcher.fetch(SubsidiariesQueryParams(symbol=symbol.upper())),
            timeout=30,
        )
        return StandardResponse(data=data, meta=MetaData(count=len(data)))
    except (asyncio.TimeoutError, ProviderTimeoutError):
        return StandardResponse(data=[], error="Request timed out")
    except Exception as e:
        return StandardResponse(data=[], error=str(e))


@router.get("/{symbol}/trading-stats", response_model=StandardResponse[Any])
async def get_trading_stats(symbol: str, db: AsyncSession = Depends(get_db)):
    symbol_upper = symbol.upper()

    async def _hydrate_range(data: Optional[TradingStatsData]) -> Optional[TradingStatsData]:
        computed_high, computed_low = await _compute_rolling_high_low(
            db, symbol_upper, trading_days=252
        )

        if data is None:
            if computed_high is None and computed_low is None:
                return None
            return TradingStatsData(
                symbol=symbol_upper, high_52w=computed_high, low_52w=computed_low
            )

        updates: dict[str, Any] = {}
        if data.high_52w is None and computed_high is not None:
            updates["high_52w"] = computed_high
        if data.low_52w is None and computed_low is not None:
            updates["low_52w"] = computed_low

        return data.model_copy(update=updates) if updates else data

    try:
        data = await asyncio.wait_for(
            VnstockTradingStatsFetcher.fetch(symbol=symbol_upper), timeout=30
        )
        data = await _hydrate_range(data)
        return StandardResponse(data=data, meta=MetaData(count=1 if data else 0))
    except (asyncio.TimeoutError, ProviderTimeoutError):
        fallback = await _hydrate_range(None)
        return StandardResponse(
            data=fallback,
            meta=MetaData(count=1 if fallback else 0),
            error="Request timed out",
        )
    except Exception as e:
        fallback = await _hydrate_range(None)
        return StandardResponse(
            data=fallback,
            meta=MetaData(count=1 if fallback else 0),
            error=str(e),
        )


@router.get("/{symbol}/rating", response_model=StandardResponse[Any])
async def get_rating(symbol: str):
    try:
        data = await asyncio.wait_for(
            VnstockGeneralRatingFetcher.fetch(symbol=symbol.upper()),
            timeout=30,
        )
        return StandardResponse(data=data, meta=MetaData(count=1 if data else 0))
    except (asyncio.TimeoutError, ProviderTimeoutError):
        return StandardResponse(data=None, error="Request timed out")
    except Exception as e:
        return StandardResponse(data=None, error=str(e))


@router.get("/{symbol}/financial-ratios", response_model=StandardResponse[List[FinancialRatioData]])
@router.get("/{symbol}/ratios", response_model=StandardResponse[List[FinancialRatioData]])
@cached(ttl=86400, key_prefix="ratios_v3")
async def get_financial_ratios(
    symbol: str,
    period: Literal["year", "quarter", "Q", "FY", "Q1", "Q2", "Q3", "Q4", "TTM"] = "year",
    db: AsyncSession = Depends(get_db),
):
    symbol_upper = symbol.upper()
    normalized_period = "year" if period in {"year", "FY"} else "quarter"
    latest_price_time = (
        await db.execute(
            select(func.max(StockPrice.time)).where(
                StockPrice.symbol == symbol_upper,
                StockPrice.interval == "1D",
            )
        )
    ).scalar_one_or_none()
    meta_kwargs = {
        "symbol": symbol_upper,
        "last_data_date": _serialize_meta_datetime(latest_price_time),
    }
    db_ratio_rows: List[FinancialRatioData] = []
    provider_ratio_rows: List[FinancialRatioData] = []
    provider_error: Exception | None = None
    support_rows = {
        StatementType.INCOME.value: [],
        StatementType.BALANCE.value: [],
        StatementType.CASHFLOW.value: [],
    }

    if normalized_period == "quarter":
        support_rows = await _load_ratio_statement_support(
            db=db,
            symbol=symbol_upper,
            period=normalized_period,
            limit=24,
        )

    try:
        stmt = (
            select(FinancialRatio)
            .where(
                FinancialRatio.symbol == symbol_upper,
                FinancialRatio.period_type == normalized_period,
            )
            .order_by(desc(FinancialRatio.fiscal_year), desc(FinancialRatio.fiscal_quarter))
        )
        result = await db.execute(stmt)
        rows = result.scalars().all()
        if rows:
            db_ratio_rows = [_to_ratio_data(row) for row in rows]
    except Exception as db_error:
        logger.warning(f"Ratio DB lookup failed for {symbol_upper}: {db_error}")

    should_fetch_provider = (
        not db_ratio_rows
        or normalized_period == "quarter"
        or str(period or "").strip().upper() == "TTM"
    )
    if should_fetch_provider:
        try:
            provider_ratio_rows = await VnstockFinancialRatiosFetcher.fetch(
                FinancialRatiosQueryParams(symbol=symbol_upper, period=normalized_period)
            )
        except Exception as exc:
            provider_error = exc
            logger.warning("Provider ratio fetch failed for %s: %s", symbol_upper, exc)

    data = _merge_ratio_row_collections(provider_ratio_rows, db_ratio_rows)
    if not data:
        data = db_ratio_rows or provider_ratio_rows
    if not data:
        data = _build_placeholder_ratio_rows_from_support(
            symbol_upper,
            support_rows.get(StatementType.INCOME.value, []),
            support_rows.get(StatementType.BALANCE.value, []),
            support_rows.get(StatementType.CASHFLOW.value, []),
        )

    if data:
        data = await _enrich_ratio_ev_sales_from_income(
            symbol=symbol_upper,
            period=normalized_period,
            rows=data,
            db=db,
        )
        data = await _enrich_missing_ratio_metrics(
            symbol=symbol_upper,
            period=normalized_period,
            rows=data,
            db=db,
            income_support_rows=support_rows.get(StatementType.INCOME.value),
            balance_support_rows=support_rows.get(StatementType.BALANCE.value),
            cashflow_support_rows=support_rows.get(StatementType.CASHFLOW.value),
        )
        data = [item for item in data if VALID_RATIO_PERIOD_RE.match(str(item.period or ""))]
        data = _dedupe_ratio_rows(data)
        data = _filter_ratio_rows_for_period(data, period)
        usable_data = [item for item in data if _ratio_has_metric_value(item)]
        payload = usable_data if usable_data else data
        if payload:
            return StandardResponse(
                data=payload,
                meta=MetaData(
                    count=len(payload),
                    data_points=len(payload),
                    **meta_kwargs,
                ),
            )

    await _schedule_critical_reinforcement(
        symbol=symbol_upper,
        endpoint="equity.ratios",
        domains=["ratios"],
    )
    return StandardResponse(data=[], error=str(provider_error) if provider_error else None)


@router.get("/{symbol}/ratios/history", response_model=StandardResponse[List[dict[str, Any]]])
@cached(ttl=86400, key_prefix="ratios_history_v2")
async def get_ratio_history(
    symbol: str,
    ratios: str = Query("pe,pb,ps", description="Comma-separated ratio keys"),
    period: Literal["year", "quarter"] = Query("year"),
    limit: int = Query(20, ge=1, le=60),
):
    ratio_list = [r.strip() for r in ratios.split(",") if r.strip()]
    if not ratio_list:
        ratio_list = ["pe", "pb", "ps"]

    def period_sort_key(value: str) -> int:
        if not value:
            return 0
        upper = value.upper()
        year_match = re.search(r"(20\d{2})", upper)
        year = int(year_match.group(1)) if year_match else 0
        quarter_match = re.search(r"Q([1-4])", upper)
        quarter = int(quarter_match.group(1)) if quarter_match else 0
        return year * 10 + quarter

    try:
        data = await VnstockFinancialRatiosFetcher.fetch(
            FinancialRatiosQueryParams(symbol=symbol, period=period)
        )
        rows: List[dict[str, Any]] = []
        for item in data:
            row: dict[str, Any] = {"period": item.period or ""}
            for key in ratio_list:
                row[key] = getattr(item, key, None)
            rows.append(row)

        rows = sorted(rows, key=lambda r: period_sort_key(str(r.get("period", ""))))
        return StandardResponse(data=rows[:limit], meta=MetaData(count=min(len(rows), limit)))
    except Exception as e:
        return StandardResponse(data=[], error=str(e))


@router.get("/{symbol}/metrics/history", response_model=MetricsHistoryResponse)
@cached(ttl=3600, key_prefix="metrics_history")
async def get_metrics_history(
    symbol: str,
    days: int = Query(30, ge=1, le=3650),
    metrics: str = Query("roe,roa,pe_ratio,pb_ratio"),
    period: Literal["year", "quarter"] = Query("year"),
    db: AsyncSession = Depends(get_db),
) -> MetricsHistoryResponse:
    metrics_list = [m.strip() for m in metrics.split(",") if m.strip()]
    include_all = not metrics_list
    symbol_upper = symbol.upper()
    start_date = date.today() - timedelta(days=days)

    def build_series_from_rows(rows: List[Any], metric_key: str, attr: str) -> List[float]:
        if not (include_all or metric_key in metrics_list):
            return []
        return [float(getattr(r, attr) or 0) for r in rows]

    try:
        from vnibb.models.screener import ScreenerSnapshot

        stmt = (
            select(ScreenerSnapshot)
            .where(
                ScreenerSnapshot.symbol == symbol_upper,
                ScreenerSnapshot.snapshot_date >= start_date,
            )
            .order_by(ScreenerSnapshot.snapshot_date.asc())
        )
        res = await db.execute(stmt)
        rows = res.scalars().all()
        if rows:
            periods = [r.snapshot_date.isoformat() for r in rows]
            return MetricsHistoryResponse(
                symbol=symbol_upper,
                periods=periods,
                roe=build_series_from_rows(rows, "roe", "roe"),
                roa=build_series_from_rows(rows, "roa", "roa"),
                pe_ratio=build_series_from_rows(rows, "pe_ratio", "pe"),
                pb_ratio=build_series_from_rows(rows, "pb_ratio", "pb"),
            )

        fallback_stmt = (
            select(ScreenerSnapshot)
            .where(ScreenerSnapshot.symbol == symbol_upper)
            .order_by(ScreenerSnapshot.snapshot_date.desc())
            .limit(30)
        )
        fallback_res = await db.execute(fallback_stmt)
        fallback_rows = list(reversed(fallback_res.scalars().all()))
        if fallback_rows:
            periods = [r.snapshot_date.isoformat() for r in fallback_rows]
            return MetricsHistoryResponse(
                symbol=symbol_upper,
                periods=periods,
                roe=build_series_from_rows(fallback_rows, "roe", "roe"),
                roa=build_series_from_rows(fallback_rows, "roa", "roa"),
                pe_ratio=build_series_from_rows(fallback_rows, "pe_ratio", "pe"),
                pb_ratio=build_series_from_rows(fallback_rows, "pb_ratio", "pb"),
            )
    except Exception as e:
        logger.warning(f"Metrics history DB lookup failed for {symbol_upper}: {e}")

    try:
        data = await VnstockFinancialRatiosFetcher.fetch(
            FinancialRatiosQueryParams(symbol=symbol_upper, period=period)
        )
    except Exception:
        data = []

    if not data:
        return MetricsHistoryResponse(symbol=symbol_upper)

    ordered = list(reversed(data))
    periods = [r.period or "" for r in ordered]

    def build_series(metric_key: str, attr: str) -> List[float]:
        if not (include_all or metric_key in metrics_list):
            return []
        return [float(getattr(r, attr) or 0) for r in ordered]

    return MetricsHistoryResponse(
        symbol=symbol_upper,
        periods=periods,
        roe=build_series("roe", "roe"),
        roa=build_series("roa", "roa"),
        pe_ratio=build_series("pe_ratio", "pe"),
        pb_ratio=build_series("pb_ratio", "pb"),
    )


@router.get(
    "/{symbol}/income-statement", response_model=StandardResponse[List[FinancialStatementData]]
)
@cached(ttl=86400, key_prefix="income_statement_v2")
async def get_income_statement(
    symbol: str,
    period: Literal["year", "quarter", "Q", "FY", "Q1", "Q2", "Q3", "Q4", "TTM"] = Query("year"),
    limit: int = Query(5, ge=1, le=40),
    db: AsyncSession = Depends(get_db),
):
    symbol_upper = symbol.upper()
    last_data_date = await _get_model_last_updated(db, IncomeStatement, symbol_upper)
    try:
        data = await get_financials_with_ttm(
            symbol=symbol,
            statement_type=StatementType.INCOME.value,
            period=period,
            limit=limit,
        )
        fallback_data = await _load_financial_statement_fallback(
            db=db,
            symbol=symbol,
            statement_type=StatementType.INCOME.value,
            period=period,
            limit=limit,
        )
        if data:
            data = _merge_financial_statement_rows(data, fallback_data)
        else:
            data = fallback_data
        data = _enrich_financial_statement_rows(data)
        data = await _cross_fill_income_statement_rows(
            db=db,
            symbol=symbol,
            period=period,
            limit=limit,
            rows=data,
        )
        data = await _enrich_income_eps_from_ratios(
            symbol=symbol_upper,
            period=period,
            rows=data,
            db=db,
        )
        return StandardResponse(
            data=data,
            meta=MetaData(count=len(data), last_data_date=last_data_date),
        )
    except BaseException as e:
        if _is_control_flow_exception(e):
            raise
        try:
            fallback_data = await _load_financial_statement_fallback(
                db=db,
                symbol=symbol,
                statement_type=StatementType.INCOME.value,
                period=period,
                limit=limit,
            )
            fallback_data = _enrich_financial_statement_rows(fallback_data)
            fallback_data = await _cross_fill_income_statement_rows(
                db=db,
                symbol=symbol,
                period=period,
                limit=limit,
                rows=fallback_data,
            )
            fallback_data = await _enrich_income_eps_from_ratios(
                symbol=symbol_upper,
                period=period,
                rows=fallback_data,
                db=db,
            )
            if fallback_data:
                return StandardResponse(
                    data=fallback_data,
                    meta=MetaData(count=len(fallback_data), last_data_date=last_data_date),
                )
        except Exception:
            pass
        return StandardResponse(data=[], error=str(e))


@router.get(
    "/{symbol}/balance-sheet", response_model=StandardResponse[List[FinancialStatementData]]
)
@cached(ttl=86400, key_prefix="balance_sheet_v2")
async def get_balance_sheet(
    symbol: str,
    period: Literal["year", "quarter", "Q", "FY", "Q1", "Q2", "Q3", "Q4", "TTM"] = Query("year"),
    limit: int = Query(5, ge=1, le=40),
    db: AsyncSession = Depends(get_db),
):
    last_data_date = await _get_model_last_updated(db, BalanceSheet, symbol)
    try:
        data = await get_financials_with_ttm(
            symbol=symbol,
            statement_type=StatementType.BALANCE.value,
            period=period,
            limit=limit,
        )
        fallback_data = await _load_financial_statement_fallback(
            db=db,
            symbol=symbol,
            statement_type=StatementType.BALANCE.value,
            period=period,
            limit=limit,
        )
        if data:
            data = _merge_financial_statement_rows(data, fallback_data)
        else:
            data = fallback_data
        data = _enrich_financial_statement_rows(data)
        return StandardResponse(
            data=data,
            meta=MetaData(count=len(data), last_data_date=last_data_date),
        )
    except BaseException as e:
        if _is_control_flow_exception(e):
            raise
        try:
            fallback_data = await _load_financial_statement_fallback(
                db=db,
                symbol=symbol,
                statement_type=StatementType.BALANCE.value,
                period=period,
                limit=limit,
            )
            if fallback_data:
                fallback_data = _enrich_financial_statement_rows(fallback_data)
                return StandardResponse(
                    data=fallback_data,
                    meta=MetaData(count=len(fallback_data), last_data_date=last_data_date),
                )
        except Exception:
            pass
        return StandardResponse(data=[], error=str(e))


@router.get("/{symbol}/cash-flow", response_model=StandardResponse[List[FinancialStatementData]])
@cached(ttl=86400, key_prefix="cash_flow_v2")
async def get_cash_flow(
    symbol: str,
    period: Literal["year", "quarter", "Q", "FY", "Q1", "Q2", "Q3", "Q4", "TTM"] = Query("year"),
    limit: int = Query(5, ge=1, le=40),
    db: AsyncSession = Depends(get_db),
):
    last_data_date = await _get_model_last_updated(db, CashFlow, symbol)
    try:
        data = await get_financials_with_ttm(
            symbol=symbol,
            statement_type=StatementType.CASHFLOW.value,
            period=period,
            limit=limit,
        )
        fallback_data = await _load_financial_statement_fallback(
            db=db,
            symbol=symbol,
            statement_type=StatementType.CASHFLOW.value,
            period=period,
            limit=limit,
        )
        if data:
            data = _merge_financial_statement_rows(data, fallback_data)
        else:
            data = fallback_data
        data = _enrich_financial_statement_rows(data)
        return StandardResponse(
            data=data,
            meta=MetaData(count=len(data), last_data_date=last_data_date),
        )
    except BaseException as e:
        if _is_control_flow_exception(e):
            raise
        try:
            fallback_data = await _load_financial_statement_fallback(
                db=db,
                symbol=symbol,
                statement_type=StatementType.CASHFLOW.value,
                period=period,
                limit=limit,
            )
            if fallback_data:
                fallback_data = _enrich_financial_statement_rows(fallback_data)
                return StandardResponse(
                    data=fallback_data,
                    meta=MetaData(count=len(fallback_data), last_data_date=last_data_date),
                )
        except Exception:
            pass
        return StandardResponse(data=[], error=str(e))


@router.get("/{symbol}/dividends", response_model=StandardResponse[List[Any]])
@cached(ttl=86400, key_prefix="dividends")
async def get_dividends(
    symbol: str,
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    try:
        symbol_upper = symbol.upper()
        raw_items = await VnstockDividendsFetcher.fetch(symbol=symbol_upper)
        latest_price = await _get_latest_price(db, symbol_upper)

        rows: list[dict[str, Any]] = []
        for item in raw_items:
            payload = item.model_dump(mode="json", by_alias=False)
            row = _build_dividend_row_from_payload(symbol_upper, payload)
            if row:
                rows.append(row)

        if not rows:
            fallback_dividends = (
                (
                    await db.execute(
                        select(Dividend)
                        .where(Dividend.symbol == symbol_upper)
                        .order_by(desc(Dividend.exercise_date), desc(Dividend.cash_year))
                        .limit(limit * 4)
                    )
                )
                .scalars()
                .all()
            )
            for item in fallback_dividends:
                payload = item.raw_data if isinstance(item.raw_data, dict) else {}
                row = _build_dividend_row_from_payload(
                    symbol_upper,
                    {
                        "ex_date": item.exercise_date,
                        "record_date": item.record_date,
                        "payment_date": item.payment_date,
                        "cash_dividend": item.dividend_value,
                        "dividend_ratio": item.dividend_rate,
                        "dividend_type": item.issue_method,
                        "fiscal_year": item.cash_year,
                        "description": payload.get("description"),
                    },
                )
                if row:
                    rows.append(row)

        if not rows:
            fallback_events = (
                (
                    await db.execute(
                        select(CompanyEvent)
                        .where(CompanyEvent.symbol == symbol_upper)
                        .order_by(desc(CompanyEvent.event_date), desc(CompanyEvent.ex_date))
                        .limit(limit * 4)
                    )
                )
                .scalars()
                .all()
            )
            for item in fallback_events:
                event_type = str(item.event_type or "").strip().lower()
                description = item.description if isinstance(item.description, str) else None
                if "div" not in event_type and "cổ tức" not in (description or "").lower():
                    continue
                payload = item.raw_data if isinstance(item.raw_data, dict) else {}
                row = _build_dividend_row_from_payload(
                    symbol_upper,
                    {
                        "ex_date": item.ex_date or item.event_date,
                        "record_date": item.record_date,
                        "payment_date": item.payment_date,
                        "cash_dividend": payload.get("cash_dividend") or item.value,
                        "stock_dividend": payload.get("stock_dividend"),
                        "dividend_ratio": payload.get("dividend_ratio"),
                        "dividend_type": item.event_type,
                        "description": item.description,
                        "fiscal_year": payload.get("fiscal_year"),
                        "issue_year": payload.get("issue_year"),
                    },
                )
                if row:
                    rows.append(row)

        rows.sort(
            key=lambda row: row.get("ex_date")
            or row.get("record_date")
            or row.get("payment_date")
            or "",
            reverse=True,
        )

        annual_cash_by_year: dict[int, float] = {}
        for row in rows:
            year = row.get("year")
            cash_value = row.get("cash_dividend")
            if isinstance(year, int) and cash_value is not None:
                annual_cash_by_year[year] = annual_cash_by_year.get(year, 0.0) + float(cash_value)

        if latest_price not in (None, 0):
            for row in rows:
                year = row.get("year")
                annual_dps = annual_cash_by_year.get(year) if isinstance(year, int) else None
                if annual_dps is None:
                    continue
                row["annual_dps"] = round(annual_dps, 4)
                normalized_yield = _resolve_dividend_yield_percent(
                    raw_yield=None,
                    dps=annual_dps,
                    latest_price=latest_price,
                )
                row["dividend_yield"] = (
                    round(float(normalized_yield), 4) if normalized_yield is not None else None
                )

        data = rows[:limit]
        return StandardResponse(
            data=data,
            meta=MetaData(
                count=len(data),
                last_data_date=_pick_latest_iso_date_from_rows(
                    data,
                    "ex_date",
                    "record_date",
                    "payment_date",
                ),
            ),
        )
    except Exception as e:
        return StandardResponse(data=[], error=str(e))


@router.get("/{symbol}/ownership", response_model=StandardResponse[List[Any]])
async def get_ownership(symbol: str):
    try:
        data = await VnstockOwnershipFetcher.fetch(symbol=symbol.upper())
        return StandardResponse(data=data, meta=MetaData(count=len(data)))
    except Exception as e:
        return StandardResponse(data=[], error=str(e))
