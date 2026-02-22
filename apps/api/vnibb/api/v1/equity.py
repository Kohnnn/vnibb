"""
Equity API Endpoints with Graceful Degradation.
"""

import asyncio
import logging
import re
from datetime import date, timedelta, datetime
from typing import List, Optional, Literal, Any, Callable, Awaitable

from fastapi import APIRouter, Query, Depends, Path
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, func

from vnibb.api.v1.schemas import StandardResponse, MetaData
from vnibb.core.database import get_db
from vnibb.core.exceptions import ProviderTimeoutError
from vnibb.core.cache import cached
from vnibb.core.config import settings
from vnibb.services.cache_manager import CacheManager

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
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models.trading import FinancialRatio
from vnibb.providers.vnstock.financials import (
    FinancialStatementData,
    StatementType,
)
from vnibb.services.financial_service import get_financials_with_ttm
from vnibb.providers.vnstock.stock_quote import VnstockStockQuoteFetcher, StockQuoteData
from vnibb.providers.vnstock.company_news import VnstockCompanyNewsFetcher, CompanyNewsQueryParams
from vnibb.providers.vnstock.company_events import (
    VnstockCompanyEventsFetcher,
    CompanyEventsQueryParams,
)
from vnibb.providers.vnstock.shareholders import VnstockShareholdersFetcher, ShareholdersQueryParams
from vnibb.providers.vnstock.officers import VnstockOfficersFetcher, OfficersQueryParams
from vnibb.providers.vnstock.intraday import VnstockIntradayFetcher, IntradayQueryParams
from vnibb.providers.vnstock.financial_ratios import (
    VnstockFinancialRatiosFetcher,
    FinancialRatiosQueryParams,
    FinancialRatioData,
)
from vnibb.providers.vnstock.foreign_trading import (
    VnstockForeignTradingFetcher,
    ForeignTradingQueryParams,
)
from vnibb.providers.vnstock.subsidiaries import VnstockSubsidiariesFetcher, SubsidiariesQueryParams
from vnibb.providers.vnstock.price_depth import VnstockPriceDepthFetcher
from vnibb.providers.vnstock.dividends import VnstockDividendsFetcher
from vnibb.providers.vnstock.trading_stats import VnstockTradingStatsFetcher
from vnibb.providers.vnstock.ownership import VnstockOwnershipFetcher
from vnibb.providers.vnstock.general_rating import VnstockGeneralRatingFetcher
from vnibb.services.comparison_service import comparison_service

# Models for Fallback
from vnibb.models.financials import IncomeStatement, BalanceSheet, CashFlow

router = APIRouter()
logger = logging.getLogger(__name__)

_REFRESH_LOCK = asyncio.Lock()
_REFRESH_IN_FLIGHT: set[str] = set()


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
    except Exception as e:
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
    if period_upper in {"QUARTER", "Q1", "Q2", "Q3", "Q4", "TTM"}:
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
    stmt = stmt.limit(limit)

    result = await db.execute(stmt)
    rows = result.scalars().all()

    return [
        FinancialStatementData(
            symbol=row.symbol,
            period=row.period,
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
        )
        for row in rows
    ]


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


def _coerce_optional_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _to_ratio_data(row: FinancialRatio) -> FinancialRatioData:
    period_value = (row.period or "").strip()
    if period_value.isdigit() and int(period_value) < 1900 and row.fiscal_year >= 1900:
        if row.fiscal_quarter and 1 <= row.fiscal_quarter <= 4:
            period_value = f"Q{row.fiscal_quarter}-{row.fiscal_year}"
        else:
            period_value = str(row.fiscal_year)

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
        pe=row.pe_ratio,
        pb=row.pb_ratio,
        ps=row.ps_ratio,
        ev_ebitda=row.ev_ebitda,
        ev_sales=ev_sales,
        roe=row.roe,
        roa=row.roa,
        eps=row.eps,
        bvps=row.bvps,
        debt_equity=row.debt_to_equity,
        debt_assets=row.debt_to_assets,
        current_ratio=row.current_ratio,
        quick_ratio=row.quick_ratio,
        cash_ratio=row.cash_ratio,
        gross_margin=row.gross_margin,
        net_margin=row.net_margin,
        operating_margin=row.operating_margin,
        interest_coverage=row.interest_coverage,
        revenue_growth=row.revenue_growth,
        earnings_growth=row.earnings_growth,
        dps=getattr(row, "dps", _coerce_optional_float(raw_data.get("dps"))),
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
        dividend_yield=getattr(
            row,
            "dividend_yield",
            _coerce_optional_float(raw_data.get("dividend_yield")),
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
        item.roe,
        item.roa,
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
    period_text = str(period_value or "").strip().upper()
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


async def _enrich_missing_ratio_metrics(
    symbol: str,
    period: str,
    rows: List[FinancialRatioData],
    db: AsyncSession,
) -> List[FinancialRatioData]:
    if not rows:
        return rows

    normalized_period = "year" if period in {"year", "FY"} else "quarter"

    income_stmt = (
        select(
            IncomeStatement.fiscal_year,
            IncomeStatement.fiscal_quarter,
            IncomeStatement.revenue,
            IncomeStatement.operating_income,
            IncomeStatement.net_income,
            IncomeStatement.cost_of_revenue,
            IncomeStatement.eps,
        )
        .where(IncomeStatement.symbol == symbol, IncomeStatement.period_type == normalized_period)
        .order_by(desc(IncomeStatement.fiscal_year), desc(IncomeStatement.fiscal_quarter))
    )
    balance_stmt = (
        select(
            BalanceSheet.fiscal_year,
            BalanceSheet.fiscal_quarter,
            BalanceSheet.total_assets,
            BalanceSheet.total_liabilities,
            BalanceSheet.total_equity,
            BalanceSheet.inventory,
            BalanceSheet.accounts_receivable,
        )
        .where(BalanceSheet.symbol == symbol, BalanceSheet.period_type == normalized_period)
        .order_by(desc(BalanceSheet.fiscal_year), desc(BalanceSheet.fiscal_quarter))
    )

    income_rows = (await db.execute(income_stmt)).all()
    balance_rows = (await db.execute(balance_stmt)).all()

    income_lookup: dict[tuple[int, int], dict[str, float | None]] = {}
    prev_income_lookup: dict[tuple[int, int], tuple[float | None, float | None, float | None]] = {}
    for year, quarter, revenue, operating_income, net_income, cost_of_revenue, eps in income_rows:
        if year is None:
            continue
        key = (int(year), int(quarter or 0))
        income_lookup[key] = {
            "revenue": _coerce_optional_float(revenue),
            "operating_income": _coerce_optional_float(operating_income),
            "net_income": _coerce_optional_float(net_income),
            "cost_of_revenue": _coerce_optional_float(cost_of_revenue),
            "eps": _coerce_optional_float(eps),
        }

    for year, quarter, revenue, _operating_income, net_income, _cost_of_revenue, eps in income_rows:
        if year is None:
            continue
        y = int(year)
        q = int(quarter or 0)
        if normalized_period == "quarter" and 1 <= q <= 4:
            prev_key = (y - 1, q)
        else:
            prev_key = (y - 1, 0)
        prev_income_lookup[(y, q)] = (
            _coerce_optional_float(revenue),
            _coerce_optional_float(net_income),
            _coerce_optional_float(eps),
        )

    prev_income_values: dict[tuple[int, int], tuple[float | None, float | None, float | None]] = {}
    for key in list(prev_income_lookup.keys()):
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
        total_liabilities,
        total_equity,
        inventory,
        receivables,
    ) in balance_rows:
        if year is None:
            continue
        balance_lookup[(int(year), int(quarter or 0))] = {
            "total_assets": _coerce_optional_float(total_assets),
            "total_liabilities": _coerce_optional_float(total_liabilities),
            "total_equity": _coerce_optional_float(total_equity),
            "inventory": _coerce_optional_float(inventory),
            "accounts_receivable": _coerce_optional_float(receivables),
        }

    latest_price = None
    latest_price_stmt = (
        select(ScreenerSnapshot.price)
        .where(ScreenerSnapshot.symbol == symbol, ScreenerSnapshot.price.is_not(None))
        .order_by(ScreenerSnapshot.snapshot_date.desc())
        .limit(1)
    )
    latest_price = _coerce_optional_float(
        (await db.execute(latest_price_stmt)).scalar_one_or_none()
    )

    for item in rows:
        year, quarter = _extract_year_quarter(item.period or "")
        if year is None:
            continue
        key = (year, quarter or 0)
        income = income_lookup.get(key)
        balance = balance_lookup.get(key)
        if income is None and quarter is not None:
            income = income_lookup.get((year, 0))
        if balance is None and quarter is not None:
            balance = balance_lookup.get((year, 0))

        revenue = None if income is None else _coerce_optional_float(income.get("revenue"))
        operating_income = (
            None if income is None else _coerce_optional_float(income.get("operating_income"))
        )
        net_income = None if income is None else _coerce_optional_float(income.get("net_income"))
        cost_of_revenue = (
            None if income is None else _coerce_optional_float(income.get("cost_of_revenue"))
        )

        total_assets = (
            None if balance is None else _coerce_optional_float(balance.get("total_assets"))
        )
        total_liabilities = (
            None if balance is None else _coerce_optional_float(balance.get("total_liabilities"))
        )
        total_equity = (
            None if balance is None else _coerce_optional_float(balance.get("total_equity"))
        )
        inventory = None if balance is None else _coerce_optional_float(balance.get("inventory"))
        receivables = (
            None if balance is None else _coerce_optional_float(balance.get("accounts_receivable"))
        )

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
            and cost_of_revenue not in (None, 0)
            and inventory not in (None, 0)
        ):
            item.inventory_turnover = cost_of_revenue / inventory
        if (
            item.receivables_turnover is None
            and revenue not in (None, 0)
            and receivables not in (None, 0)
        ):
            item.receivables_turnover = revenue / receivables
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

        if item.dividend_yield is None and latest_price not in (None, 0):
            dps = _coerce_optional_float(getattr(item, "dps", None))
            if dps is not None:
                item.dividend_yield = (dps / latest_price) * 100

        if item.payout_ratio is None:
            dps = _coerce_optional_float(getattr(item, "dps", None))
            eps = _coerce_optional_float(item.eps)
            if dps is not None and eps not in (None, 0):
                item.payout_ratio = (dps / eps) * 100

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

    try:
        params = EquityHistoricalQueryParams(
            symbol=symbol,
            start_date=start_date,
            end_date=end_date,
            interval=interval,
            source=source,
        )
        data = await VnstockEquityHistoricalFetcher.fetch(params)
        return StandardResponse(data=data, meta=MetaData(count=len(data)))
    except Exception as e:
        logger.warning(f"Live API failed for historical {symbol}, trying database fallback: {e}")
        return StandardResponse(data=[], error=f"Data unavailable: {str(e)}")


@router.get("/{symbol}/quote", response_model=StandardResponse[StockQuoteData])
@cached(ttl=30, key_prefix="quote")
async def get_quote(
    symbol: str,
    source: str = Query(default="VCI"),
    refresh: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
):
    symbol_upper = symbol.upper()

    async def _get_db_quote() -> Optional[StockQuoteData]:
        try:
            price_stmt = (
                select(StockPrice)
                .where(StockPrice.symbol == symbol_upper)
                .order_by(StockPrice.time.desc())
                .limit(2)
            )
            price_rows = (await db.execute(price_stmt)).scalars().all()
            if price_rows:
                latest_row = price_rows[0]
                previous_row = price_rows[1] if len(price_rows) > 1 else None

                prev_close = (
                    float(previous_row.close)
                    if previous_row and previous_row.close is not None
                    else None
                )
                latest_close = float(latest_row.close) if latest_row.close is not None else None
                change = (
                    latest_close - prev_close
                    if latest_close is not None and prev_close is not None
                    else None
                )
                change_pct = (
                    (change / prev_close) * 100
                    if change is not None and prev_close not in (None, 0)
                    else None
                )

                return StockQuoteData(
                    symbol=symbol_upper,
                    price=latest_close,
                    open=float(latest_row.open) if latest_row.open is not None else None,
                    high=float(latest_row.high) if latest_row.high is not None else None,
                    low=float(latest_row.low) if latest_row.low is not None else None,
                    prev_close=prev_close,
                    change=change,
                    change_pct=round(change_pct, 2) if change_pct is not None else None,
                    volume=int(latest_row.volume) if latest_row.volume is not None else None,
                    updated_at=datetime.utcnow(),
                )

            snapshot_stmt = (
                select(ScreenerSnapshot)
                .where(ScreenerSnapshot.symbol == symbol_upper)
                .order_by(ScreenerSnapshot.snapshot_date.desc())
                .limit(1)
            )
            snapshot_row = (await db.execute(snapshot_stmt)).scalar_one_or_none()
            if snapshot_row and snapshot_row.price is not None:
                return StockQuoteData(
                    symbol=symbol_upper,
                    price=snapshot_row.price,
                    volume=int(snapshot_row.volume) if snapshot_row.volume is not None else None,
                    updated_at=datetime.utcnow(),
                )
        except Exception as db_err:
            logger.warning(f"Quote DB fallback failed for {symbol_upper}: {db_err}")
        return None

    if not refresh:
        cached_quote = await _get_db_quote()
        if cached_quote:
            return StandardResponse(data=cached_quote, meta=MetaData(count=1))

    try:
        data, _ = await asyncio.wait_for(
            VnstockStockQuoteFetcher.fetch(symbol=symbol_upper, source=source),
            timeout=10,
        )
        return StandardResponse(data=data, meta=MetaData(count=1))
    except Exception as e:
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
@cached(ttl=604800, key_prefix="profile")
async def get_profile(
    symbol: str = Path(..., min_length=1, max_length=10, pattern=r"^[A-Za-z0-9._-]+$"),
    refresh: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
):
    symbol_upper = symbol.upper()
    cache_manager = CacheManager(db=db)
    try:
        if not refresh:
            cache_result = await cache_manager.get_profile_data(symbol_upper)
            if cache_result.hit:
                company = cache_result.data
                exchange = company.exchange
                if not exchange:
                    result = await db.execute(
                        select(Stock.exchange).where(Stock.symbol == symbol_upper)
                    )
                    exchange = result.scalar_one_or_none()
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
                        industry=company.industry,
                        sector=company.sector,
                        website=company.website,
                        description=company.business_description,
                        outstanding_shares=company.outstanding_shares,
                        listed_shares=company.listed_shares,
                    ),
                    meta=MetaData(count=1),
                )

        fallback_profile: Optional[EquityProfileData] = None
        if not refresh:
            stock_result = await db.execute(select(Stock).where(Stock.symbol == symbol_upper))
            stock = stock_result.scalar_one_or_none()
            if stock:
                fallback_profile = EquityProfileData(
                    symbol=stock.symbol,
                    company_name=stock.company_name,
                    short_name=stock.short_name,
                    exchange=stock.exchange,
                    industry=stock.industry,
                    sector=stock.sector,
                )

        if fallback_profile and not refresh:
            await _schedule_refresh(
                f"profile:{symbol_upper}",
                lambda: _refresh_profile_cache(symbol_upper),
            )
            return StandardResponse(data=fallback_profile, meta=MetaData(count=1))

        params = EquityProfileQueryParams(symbol=symbol)
        data = await asyncio.wait_for(
            VnstockEquityProfileFetcher.fetch(params),
            timeout=10,
        )
        profile_data = data[0] if data else None
        if profile_data:
            if not profile_data.exchange:
                result = await db.execute(
                    select(Stock.exchange).where(Stock.symbol == symbol_upper)
                )
                exchange = result.scalar_one_or_none()
                if exchange:
                    profile_data.exchange = exchange
            await cache_manager.store_profile_data(
                symbol_upper, profile_data.model_dump(mode="json")
            )
            return StandardResponse(data=profile_data, meta=MetaData(count=1))

        # Return None data instead of 404
        return StandardResponse(data=None, error="Profile not found")
    except Exception as e:
        return StandardResponse(data=None, error=str(e))


@router.get("/{symbol}/financials", response_model=StandardResponse[List[FinancialStatementData]])
async def get_financials(
    symbol: str,
    statement_type: Literal["income", "balance", "cashflow"] = Query("income"),
    period: Literal["year", "quarter", "FY", "Q1", "Q2", "Q3", "Q4", "TTM"] = Query("year"),
    limit: int = Query(5, ge=1, le=20),
    db: AsyncSession = Depends(get_db),
):
    try:
        data = await get_financials_with_ttm(
            symbol=symbol,
            statement_type=statement_type,
            period=period,
            limit=limit,
        )
        if data:
            return StandardResponse(data=data, meta=MetaData(count=len(data)))

        fallback_data = await _load_financial_statement_fallback(
            db=db,
            symbol=symbol,
            statement_type=statement_type,
            period=period,
            limit=limit,
        )
        if fallback_data:
            return StandardResponse(data=fallback_data, meta=MetaData(count=len(fallback_data)))

        return StandardResponse(data=[], meta=MetaData(count=0))
    except Exception as e:
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
                return StandardResponse(data=fallback_data, meta=MetaData(count=len(fallback_data)))
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
        data = await VnstockCompanyNewsFetcher.fetch(
            CompanyNewsQueryParams(symbol=symbol, limit=limit)
        )
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


@router.get("/{symbol}/shareholders", response_model=StandardResponse[List[Any]])
async def get_shareholders(symbol: str):
    try:
        data = await VnstockShareholdersFetcher.fetch(ShareholdersQueryParams(symbol=symbol))
        return StandardResponse(data=data, meta=MetaData(count=len(data)))
    except Exception as e:
        return StandardResponse(data=[], error=str(e))


@router.get("/{symbol}/officers", response_model=StandardResponse[List[Any]])
async def get_officers(symbol: str):
    try:
        data = await VnstockOfficersFetcher.fetch(OfficersQueryParams(symbol=symbol))
        return StandardResponse(data=data, meta=MetaData(count=len(data)))
    except Exception as e:
        return StandardResponse(data=[], error=str(e))


def _normalize_orderbook_entries(depth_data: Any) -> List[dict[str, Any]]:
    entries: List[dict[str, Any]] = []

    for level in range(1, 4):
        bid_level = getattr(depth_data, f"bid_{level}", None)
        ask_level = getattr(depth_data, f"ask_{level}", None)

        bid_price = getattr(bid_level, "price", None) if bid_level else None
        ask_price = getattr(ask_level, "price", None) if ask_level else None
        bid_vol = getattr(bid_level, "volume", None) if bid_level else None
        ask_vol = getattr(ask_level, "volume", None) if ask_level else None
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

    raw_levels = getattr(depth_data, "raw_levels", None) or []
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


async def _get_orderbook_payload(symbol: str) -> dict[str, Any]:
    depth = await asyncio.wait_for(
        VnstockPriceDepthFetcher.fetch(symbol=symbol.upper(), source=settings.vnstock_source),
        timeout=30,
    )
    entries = _normalize_orderbook_entries(depth)

    return {
        "symbol": symbol.upper(),
        "entries": entries,
        "total_bid_volume": getattr(depth, "total_bid_volume", None),
        "total_ask_volume": getattr(depth, "total_ask_volume", None),
        "last_price": getattr(depth, "last_price", None),
        "last_volume": getattr(depth, "last_volume", None),
    }


@router.get("/{symbol}/price-depth", response_model=StandardResponse[dict[str, Any]])
async def get_price_depth(symbol: str):
    try:
        payload = await _get_orderbook_payload(symbol)
        return StandardResponse(data=payload, meta=MetaData(count=len(payload.get("entries", []))))
    except asyncio.TimeoutError:
        return StandardResponse(
            data={"symbol": symbol.upper(), "entries": []}, error="Request timed out"
        )
    except Exception as e:
        return StandardResponse(data={"symbol": symbol.upper(), "entries": []}, error=str(e))


@router.get("/{symbol}/orderbook", response_model=StandardResponse[dict[str, Any]])
async def get_orderbook(symbol: str):
    try:
        payload = await _get_orderbook_payload(symbol)
        return StandardResponse(data=payload, meta=MetaData(count=len(payload.get("entries", []))))
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
async def get_trading_stats(symbol: str):
    try:
        data = await asyncio.wait_for(
            VnstockTradingStatsFetcher.fetch(symbol=symbol.upper()),
            timeout=30,
        )
        return StandardResponse(data=data, meta=MetaData(count=1 if data else 0))
    except (asyncio.TimeoutError, ProviderTimeoutError):
        return StandardResponse(data=None, error="Request timed out")
    except Exception as e:
        return StandardResponse(data=None, error=str(e))


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


@router.get("/{symbol}/ratios", response_model=StandardResponse[List[FinancialRatioData]])
@cached(ttl=86400, key_prefix="ratios")
async def get_financial_ratios(
    symbol: str,
    period: Literal["year", "quarter", "FY", "Q1", "Q2", "Q3", "Q4", "TTM"] = "year",
    db: AsyncSession = Depends(get_db),
):
    symbol_upper = symbol.upper()
    normalized_period = "year" if period in {"year", "FY"} else "quarter"
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
            data = [_to_ratio_data(row) for row in rows]
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
            )
            usable_data = [item for item in data if _ratio_has_metric_value(item)]
            if usable_data:
                return StandardResponse(data=usable_data, meta=MetaData(count=len(usable_data)))

            logger.warning(
                "Ratio DB rows for %s are empty placeholders; falling back to provider",
                symbol_upper,
            )
    except Exception as db_error:
        logger.warning(f"Ratio DB lookup failed for {symbol_upper}: {db_error}")

    try:
        data = await VnstockFinancialRatiosFetcher.fetch(
            FinancialRatiosQueryParams(symbol=symbol_upper, period=normalized_period)
        )
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
        )
        usable_data = [item for item in data if _ratio_has_metric_value(item)]
        payload = usable_data if usable_data else data
        return StandardResponse(data=payload, meta=MetaData(count=len(payload)))
    except Exception as e:
        return StandardResponse(data=[], error=str(e))


@router.get("/{symbol}/ratios/history", response_model=StandardResponse[List[dict[str, Any]]])
@cached(ttl=86400, key_prefix="ratios_history")
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

        rows = sorted(rows, key=lambda r: period_sort_key(str(r.get("period", ""))), reverse=True)
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
@cached(ttl=86400, key_prefix="income_statement")
async def get_income_statement(
    symbol: str,
    period: Literal["year", "quarter", "FY", "Q1", "Q2", "Q3", "Q4", "TTM"] = Query("year"),
    limit: int = Query(5, ge=1, le=20),
    db: AsyncSession = Depends(get_db),
):
    symbol_upper = symbol.upper()
    try:
        data = await get_financials_with_ttm(
            symbol=symbol,
            statement_type=StatementType.INCOME.value,
            period=period,
            limit=limit,
        )
        if not data:
            data = await _load_financial_statement_fallback(
                db=db,
                symbol=symbol,
                statement_type=StatementType.INCOME.value,
                period=period,
                limit=limit,
            )
        data = await _enrich_income_eps_from_ratios(
            symbol=symbol_upper,
            period=period,
            rows=data,
            db=db,
        )
        return StandardResponse(data=data, meta=MetaData(count=len(data)))
    except Exception as e:
        try:
            fallback_data = await _load_financial_statement_fallback(
                db=db,
                symbol=symbol,
                statement_type=StatementType.INCOME.value,
                period=period,
                limit=limit,
            )
            fallback_data = await _enrich_income_eps_from_ratios(
                symbol=symbol_upper,
                period=period,
                rows=fallback_data,
                db=db,
            )
            if fallback_data:
                return StandardResponse(data=fallback_data, meta=MetaData(count=len(fallback_data)))
        except Exception:
            pass
        return StandardResponse(data=[], error=str(e))


@router.get(
    "/{symbol}/balance-sheet", response_model=StandardResponse[List[FinancialStatementData]]
)
@cached(ttl=86400, key_prefix="balance_sheet")
async def get_balance_sheet(
    symbol: str,
    period: Literal["year", "quarter", "FY", "Q1", "Q2", "Q3", "Q4", "TTM"] = Query("year"),
    limit: int = Query(5, ge=1, le=20),
    db: AsyncSession = Depends(get_db),
):
    try:
        data = await get_financials_with_ttm(
            symbol=symbol,
            statement_type=StatementType.BALANCE.value,
            period=period,
            limit=limit,
        )
        if not data:
            data = await _load_financial_statement_fallback(
                db=db,
                symbol=symbol,
                statement_type=StatementType.BALANCE.value,
                period=period,
                limit=limit,
            )
        return StandardResponse(data=data, meta=MetaData(count=len(data)))
    except Exception as e:
        try:
            fallback_data = await _load_financial_statement_fallback(
                db=db,
                symbol=symbol,
                statement_type=StatementType.BALANCE.value,
                period=period,
                limit=limit,
            )
            if fallback_data:
                return StandardResponse(data=fallback_data, meta=MetaData(count=len(fallback_data)))
        except Exception:
            pass
        return StandardResponse(data=[], error=str(e))


@router.get("/{symbol}/cash-flow", response_model=StandardResponse[List[FinancialStatementData]])
@cached(ttl=86400, key_prefix="cash_flow")
async def get_cash_flow(
    symbol: str,
    period: Literal["year", "quarter", "FY", "Q1", "Q2", "Q3", "Q4", "TTM"] = Query("year"),
    limit: int = Query(5, ge=1, le=20),
    db: AsyncSession = Depends(get_db),
):
    try:
        data = await get_financials_with_ttm(
            symbol=symbol,
            statement_type=StatementType.CASHFLOW.value,
            period=period,
            limit=limit,
        )
        if not data:
            data = await _load_financial_statement_fallback(
                db=db,
                symbol=symbol,
                statement_type=StatementType.CASHFLOW.value,
                period=period,
                limit=limit,
            )
        return StandardResponse(data=data, meta=MetaData(count=len(data)))
    except Exception as e:
        try:
            fallback_data = await _load_financial_statement_fallback(
                db=db,
                symbol=symbol,
                statement_type=StatementType.CASHFLOW.value,
                period=period,
                limit=limit,
            )
            if fallback_data:
                return StandardResponse(data=fallback_data, meta=MetaData(count=len(fallback_data)))
        except Exception:
            pass
        return StandardResponse(data=[], error=str(e))


@router.get("/{symbol}/dividends", response_model=StandardResponse[List[Any]])
async def get_dividends(symbol: str):
    try:
        data = await VnstockDividendsFetcher.fetch(symbol=symbol.upper())
        return StandardResponse(data=data, meta=MetaData(count=len(data)))
    except Exception as e:
        return StandardResponse(data=[], error=str(e))


@router.get("/{symbol}/ownership", response_model=StandardResponse[List[Any]])
async def get_ownership(symbol: str):
    try:
        data = await VnstockOwnershipFetcher.fetch(symbol=symbol.upper())
        return StandardResponse(data=data, meta=MetaData(count=len(data)))
    except Exception as e:
        return StandardResponse(data=[], error=str(e))
