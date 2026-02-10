"""
Equity API Endpoints with Graceful Degradation.
"""

import asyncio
import logging
import re
from datetime import date, timedelta, datetime
from typing import List, Optional, Literal, Any, Callable, Awaitable

from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc

from vnibb.api.v1.schemas import StandardResponse, MetaData
from vnibb.core.database import get_db
from vnibb.core.exceptions import ProviderError, ProviderTimeoutError
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
from vnibb.providers.vnstock.market_overview import (
    VnstockMarketOverviewFetcher,
    MarketOverviewQueryParams,
)
from vnibb.providers.vnstock.price_depth import VnstockPriceDepthFetcher
from vnibb.providers.vnstock.insider_deals import VnstockInsiderDealsFetcher
from vnibb.providers.vnstock.dividends import VnstockDividendsFetcher
from vnibb.providers.vnstock.trading_stats import VnstockTradingStatsFetcher
from vnibb.providers.vnstock.ownership import VnstockOwnershipFetcher
from vnibb.providers.vnstock.general_rating import VnstockGeneralRatingFetcher

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


def _to_ratio_data(row: FinancialRatio) -> FinancialRatioData:
    return FinancialRatioData(
        symbol=row.symbol,
        period=row.period,
        pe=row.pe_ratio,
        pb=row.pb_ratio,
        ps=row.ps_ratio,
        ev_ebitda=row.ev_ebitda,
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
    )


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
@cached(ttl=60, key_prefix="quote")
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
                .limit(1)
            )
            price_row = (await db.execute(price_stmt)).scalar_one_or_none()
            if price_row:
                return StockQuoteData(
                    symbol=symbol_upper,
                    price=price_row.close,
                    open=price_row.open,
                    high=price_row.high,
                    low=price_row.low,
                    volume=price_row.volume,
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
    symbol: str,
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
        return StandardResponse(data=data, meta=MetaData(count=len(data)))
    except Exception as e:
        logger.warning(f"Live API failed for financials {symbol}, trying database fallback: {e}")
        try:
            normalized_period = "year"
            if period in {"quarter", "Q1", "Q2", "Q3", "Q4", "TTM"}:
                normalized_period = "quarter"
            # Database Fallback
            model = {"income": IncomeStatement, "balance": BalanceSheet, "cashflow": CashFlow}.get(
                statement_type
            )
            stmt = (
                select(model)
                .where(model.symbol == symbol.upper(), model.period_type == normalized_period)
                .order_by(model.fiscal_year.desc())
                .limit(limit)
            )
            res = await db.execute(stmt)
            rows = res.scalars().all()
            if rows:
                data = [
                    FinancialStatementData(
                        symbol=r.symbol,
                        period=r.period,
                        fiscal_year=r.fiscal_year,
                        fiscal_quarter=r.fiscal_quarter,
                        revenue=getattr(r, "revenue", None),
                        net_income=getattr(r, "net_income", None),
                        eps=getattr(r, "eps", None),
                        total_assets=getattr(r, "total_assets", None),
                        total_liabilities=getattr(r, "total_liabilities", None),
                        total_equity=getattr(r, "total_equity", None),
                        cash_and_equivalents=getattr(r, "cash_and_equivalents", None),
                        equity=getattr(r, "total_equity", None),
                        cash=getattr(r, "cash_and_equivalents", None),
                        inventory=getattr(r, "inventory", None),
                    )
                    for r in rows
                ]
                return StandardResponse(data=data, meta=MetaData(count=len(data)))
        except Exception:
            pass

        return StandardResponse(data=[], error=f"Data unavailable: {str(e)}")


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
            return StandardResponse(data=data, meta=MetaData(count=len(data)))
    except Exception as db_error:
        logger.warning(f"Ratio DB lookup failed for {symbol_upper}: {db_error}")

    try:
        data = await VnstockFinancialRatiosFetcher.fetch(
            FinancialRatiosQueryParams(symbol=symbol_upper, period=normalized_period)
        )
        return StandardResponse(data=data, meta=MetaData(count=len(data)))
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
):
    try:
        data = await get_financials_with_ttm(
            symbol=symbol,
            statement_type=StatementType.INCOME.value,
            period=period,
            limit=limit,
        )
        return StandardResponse(data=data, meta=MetaData(count=len(data)))
    except Exception as e:
        return StandardResponse(data=[], error=str(e))


@router.get(
    "/{symbol}/balance-sheet", response_model=StandardResponse[List[FinancialStatementData]]
)
@cached(ttl=86400, key_prefix="balance_sheet")
async def get_balance_sheet(
    symbol: str,
    period: Literal["year", "quarter", "FY", "Q1", "Q2", "Q3", "Q4", "TTM"] = Query("year"),
    limit: int = Query(5, ge=1, le=20),
):
    try:
        data = await get_financials_with_ttm(
            symbol=symbol,
            statement_type=StatementType.BALANCE.value,
            period=period,
            limit=limit,
        )
        return StandardResponse(data=data, meta=MetaData(count=len(data)))
    except Exception as e:
        return StandardResponse(data=[], error=str(e))


@router.get("/{symbol}/cash-flow", response_model=StandardResponse[List[FinancialStatementData]])
@cached(ttl=86400, key_prefix="cash_flow")
async def get_cash_flow(
    symbol: str,
    period: Literal["year", "quarter", "FY", "Q1", "Q2", "Q3", "Q4", "TTM"] = Query("year"),
    limit: int = Query(5, ge=1, le=20),
):
    try:
        data = await get_financials_with_ttm(
            symbol=symbol,
            statement_type=StatementType.CASHFLOW.value,
            period=period,
            limit=limit,
        )
        return StandardResponse(data=data, meta=MetaData(count=len(data)))
    except Exception as e:
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
