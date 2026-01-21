"""
Equity API Endpoints with Graceful Degradation.
"""

from datetime import date, timedelta, datetime
from typing import List, Optional, Literal, Any

from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc

from vnibb.api.v1.schemas import StandardResponse, MetaData
from vnibb.core.database import get_db
from vnibb.core.exceptions import ProviderError, ProviderTimeoutError
from vnibb.core.cache import cached
from vnibb.services.cache_manager import CacheManager

# Providers
from vnibb.providers.vnstock.equity_historical import VnstockEquityHistoricalFetcher, EquityHistoricalQueryParams, EquityHistoricalData
from vnibb.providers.vnstock.equity_profile import VnstockEquityProfileFetcher, EquityProfileQueryParams, EquityProfileData
from vnibb.providers.vnstock.financials import VnstockFinancialsFetcher, FinancialsQueryParams, FinancialStatementData, StatementType
from vnibb.providers.vnstock.stock_quote import VnstockStockQuoteFetcher, StockQuoteData
from vnibb.providers.vnstock.company_news import VnstockCompanyNewsFetcher, CompanyNewsQueryParams
from vnibb.providers.vnstock.company_events import VnstockCompanyEventsFetcher, CompanyEventsQueryParams
from vnibb.providers.vnstock.shareholders import VnstockShareholdersFetcher, ShareholdersQueryParams
from vnibb.providers.vnstock.officers import VnstockOfficersFetcher, OfficersQueryParams
from vnibb.providers.vnstock.intraday import VnstockIntradayFetcher, IntradayQueryParams
from vnibb.providers.vnstock.financial_ratios import VnstockFinancialRatiosFetcher, FinancialRatiosQueryParams
from vnibb.providers.vnstock.foreign_trading import VnstockForeignTradingFetcher, ForeignTradingQueryParams
from vnibb.providers.vnstock.subsidiaries import VnstockSubsidiariesFetcher, SubsidiariesQueryParams
from vnibb.providers.vnstock.market_overview import VnstockMarketOverviewFetcher, MarketOverviewQueryParams
from vnibb.providers.vnstock.price_depth import VnstockPriceDepthFetcher
from vnibb.providers.vnstock.insider_deals import VnstockInsiderDealsFetcher
from vnibb.providers.vnstock.dividends import VnstockDividendsFetcher
from vnibb.providers.vnstock.trading_stats import VnstockTradingStatsFetcher
from vnibb.providers.vnstock.ownership import VnstockOwnershipFetcher
from vnibb.providers.vnstock.general_rating import VnstockGeneralRatingFetcher

# Models for Fallback
from vnibb.models.stock import StockPrice
from vnibb.models.financials import IncomeStatement, BalanceSheet, CashFlow

router = APIRouter()

@router.get("/historical", response_model=StandardResponse[List[EquityHistoricalData]])
@cached(ttl=300, key_prefix="historical")
async def get_historical_prices(
    symbol: str = Query(..., min_length=1, max_length=10),
    start_date: date = Query(default_factory=lambda: date.today() - timedelta(days=365)),
    end_date: date = Query(default_factory=date.today),
    interval: str = Query(default="1D", pattern=r"^(1m|5m|15m|30m|1H|1D|1W|1M)$"),
    source: str = Query(default="VCI", pattern=r"^(KBS|VCI|TCBS|DNSE)$"),
    db: AsyncSession = Depends(get_db)
):
    try:
        params = EquityHistoricalQueryParams(
            symbol=symbol, start_date=start_date, end_date=end_date, interval=interval, source=source
        )
        data = await VnstockEquityHistoricalFetcher.fetch(params)
        return StandardResponse(data=data, meta=MetaData(count=len(data)))
    except Exception as e:
        logger.warning(f"Live API failed for historical {symbol}, trying database fallback: {e}")
        # Database Fallback
        stmt = select(StockPrice).where(
            StockPrice.symbol == symbol.upper(),
            StockPrice.time >= start_date,
            StockPrice.time <= end_date
        ).order_by(StockPrice.time.asc())
        res = await db.execute(stmt)
        rows = res.scalars().all()
        if rows:
            data = [EquityHistoricalData(
                symbol=r.symbol, time=r.time, open=r.open, high=r.high, low=r.low, close=r.close, volume=r.volume
            ) for r in rows]
            return StandardResponse(data=data, meta=MetaData(count=len(data)))
        raise HTTPException(status_code=502, detail=f"Data unavailable: {str(e)}")

@router.get("/{symbol}/quote", response_model=StandardResponse[StockQuoteData])
@cached(ttl=30, key_prefix="quote")
async def get_quote(symbol: str, source: str = Query(default="VCI")):
    try:
        data, _ = await VnstockStockQuoteFetcher.fetch(symbol=symbol.upper(), source=source)
        return StandardResponse(data=data, meta=MetaData(count=1))
    except Exception as e:
        return StandardResponse(data=StockQuoteData(symbol=symbol.upper(), updated_at=datetime.utcnow()), error=str(e))

@router.get("/{symbol}/profile", response_model=StandardResponse[EquityProfileData])
@cached(ttl=3600, key_prefix="profile")
async def get_profile(symbol: str, db: AsyncSession = Depends(get_db)):
    symbol_upper = symbol.upper()
    cache_manager = CacheManager(db=db)
    try:
        cache_result = await cache_manager.get_profile_data(symbol_upper)
        if cache_result.hit: # Return even if stale if we want maximum availability
            company = cache_result.data
            return StandardResponse(data=EquityProfileData(
                symbol=company.symbol, company_name=company.company_name, short_name=company.short_name,
                exchange=company.exchange, industry=company.industry, sector=company.sector,
                website=company.website, description=company.business_description,
                outstanding_shares=company.outstanding_shares, listed_shares=company.listed_shares
            ), meta=MetaData(count=1))
        
        params = EquityProfileQueryParams(symbol=symbol)
        data = await VnstockEquityProfileFetcher.fetch(params)
        profile_data = data[0] if data else None
        if profile_data:
            await cache_manager.store_profile_data(symbol_upper, profile_data.model_dump(mode="json"))
            return StandardResponse(data=profile_data, meta=MetaData(count=1))
        raise HTTPException(status_code=404, detail="Profile not found")
    except Exception as e:
        if isinstance(e, HTTPException): raise e
        raise HTTPException(status_code=502, detail=str(e))

@router.get("/{symbol}/financials", response_model=StandardResponse[List[FinancialStatementData]])
async def get_financials(
    symbol: str,
    statement_type: Literal["income", "balance", "cashflow"] = Query("income"),
    period: Literal["year", "quarter"] = Query("year"),
    limit: int = Query(5, ge=1, le=20),
    db: AsyncSession = Depends(get_db)
):
    try:
        params = FinancialsQueryParams(
            symbol=symbol, statement_type=StatementType(statement_type), period=period, limit=limit
        )
        data = await VnstockFinancialsFetcher.fetch(params)
        return StandardResponse(data=data, meta=MetaData(count=len(data)))
    except Exception as e:
        logger.warning(f"Live API failed for financials {symbol}, trying database fallback: {e}")
        # Database Fallback
        model = {"income": IncomeStatement, "balance": BalanceSheet, "cashflow": CashFlow}.get(statement_type)
        stmt = select(model).where(model.symbol == symbol.upper(), model.period_type == period).order_by(model.fiscal_year.desc()).limit(limit)
        res = await db.execute(stmt)
        rows = res.scalars().all()
        if rows:
            data = [FinancialStatementData(
                symbol=r.symbol, period=r.period, fiscal_year=r.fiscal_year, fiscal_quarter=r.fiscal_quarter,
                revenue=getattr(r, 'revenue', None), net_income=getattr(r, 'net_income', None)
                # ... mapping more fields would be better but this is a start
            ) for r in rows]
            return StandardResponse(data=data, meta=MetaData(count=len(data)))
        raise HTTPException(status_code=502, detail=str(e))

# ... existing endpoints remain same or with similar try/except logic ...
import logging
logger = logging.getLogger(__name__)

# Re-adding missing endpoints for completeness
@router.get("/{symbol}/news", response_model=StandardResponse[List[Any]])
async def get_company_news(symbol: str, limit: int = Query(20)):
    try:
        data = await VnstockCompanyNewsFetcher.fetch(CompanyNewsQueryParams(symbol=symbol, limit=limit))
        return StandardResponse(data=data, meta=MetaData(count=len(data)))
    except Exception as e: return StandardResponse(data=[], error=str(e))

@router.get("/{symbol}/shareholders", response_model=StandardResponse[List[Any]])
async def get_shareholders(symbol: str):
    try:
        data = await VnstockShareholdersFetcher.fetch(ShareholdersQueryParams(symbol=symbol))
        return StandardResponse(data=data, meta=MetaData(count=len(data)))
    except Exception as e: return StandardResponse(data=[], error=str(e))

@router.get("/{symbol}/officers", response_model=StandardResponse[List[Any]])
async def get_officers(symbol: str):
    try:
        data = await VnstockOfficersFetcher.fetch(OfficersQueryParams(symbol=symbol))
        return StandardResponse(data=data, meta=MetaData(count=len(data)))
    except Exception as e: return StandardResponse(data=[], error=str(e))

@router.get("/{symbol}/ratios", response_model=StandardResponse[List[Any]])
async def get_financial_ratios(symbol: str, period: str = "year"):
    try:
        data = await VnstockFinancialRatiosFetcher.fetch(FinancialRatiosQueryParams(symbol=symbol, period=period))
        return StandardResponse(data=data, meta=MetaData(count=len(data)))
    except Exception as e: return StandardResponse(data=[], error=str(e))

@router.get("/{symbol}/dividends", response_model=StandardResponse[List[Any]])
async def get_dividends(symbol: str):
    try:
        data = await VnstockDividendsFetcher.fetch(symbol=symbol.upper())
        return StandardResponse(data=data, meta=MetaData(count=len(data)))
    except Exception as e: return StandardResponse(data=[], error=str(e))

@router.get("/{symbol}/ownership", response_model=StandardResponse[List[Any]])
async def get_ownership(symbol: str):
    try:
        data = await VnstockOwnershipFetcher.fetch(symbol=symbol.upper())
        return StandardResponse(data=data, meta=MetaData(count=len(data)))
    except Exception as e: return StandardResponse(data=[], error=str(e))
