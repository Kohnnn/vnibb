"""
Data Pipeline Service - Comprehensive VNStock Integration

Batch data synchronization from ALL vnstock Golden Sponsor APIs.
Uses APScheduler for scheduled jobs.
Supports both PostgreSQL and SQLite dialects.
"""

import asyncio
import logging
from datetime import date, datetime, timedelta
from typing import Optional, List, Dict, Any, Union

import pandas as pd
from sqlalchemy import select, and_, func, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError

from vnibb.core.database import async_session_maker, engine
from vnibb.core.config import settings
from vnibb.models.stock import Stock, StockPrice, StockIndex
from vnibb.models.company import Company, Shareholder, Officer
from vnibb.models.financials import IncomeStatement, BalanceSheet, CashFlow
from vnibb.models.news import CompanyNews, CompanyEvent, Dividend, InsiderDeal
from vnibb.models.trading import ForeignTrading, FinancialRatio
from vnibb.models.market import MarketSector, SectorPerformance, Subsidiary
from vnibb.models.technical_indicator import TechnicalIndicator
from vnibb.models.market_news import MarketNews
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models.sync_status import SyncStatus
from vnibb.core.retry import with_retry

logger = logging.getLogger(__name__)

def get_upsert_stmt(model, index_elements, values):
    """
    Generate a dialect-specific upsert statement.
    """
    if engine.dialect.name == "postgresql":
        from sqlalchemy.dialects.postgresql import insert as pg_insert
        stmt = pg_insert(model).values(values)
        return stmt.on_conflict_do_update(
            index_elements=index_elements,
            set_={c.name: stmt.excluded[c.name] for c in model.__table__.columns if c.name not in index_elements and not c.primary_key}
        )
    else:
        from sqlalchemy.dialects.sqlite import insert as sqlite_insert
        stmt = sqlite_insert(model).values(values)
        return stmt.on_conflict_do_update(
            index_elements=index_elements,
            set_={c.name: stmt.excluded[c.name] for c in model.__table__.columns if c.name not in index_elements and not c.primary_key}
        )

class RateLimiter:
    def __init__(self, requests_per_second: float = 5.0):
        self.delay = 1.0 / requests_per_second
        self.last_request = 0.0
    
    async def wait(self):
        now = asyncio.get_event_loop().time()
        time_since_last = now - self.last_request
        if time_since_last < self.delay:
            await asyncio.sleep(self.delay - time_since_last)
        self.last_request = asyncio.get_event_loop().time()

class DataPipeline:
    def __init__(self):
        self._vnstock = None
        self.rate_limiter = RateLimiter(requests_per_second=settings.vnstock_timeout / 2 if settings.vnstock_timeout else 5.0)
    
    @property
    def vnstock(self):
        from vnstock import Vnstock
        return Vnstock()

    @with_retry(max_retries=3)
    async def sync_stock_list(self) -> int:
        """Sync all stock symbols."""
        from vnstock import Listing
        logger.info("Syncing stock list...")
        listing = Listing(source="VCI") # VCI is more reliable for listing
        df = listing.all_symbols()
        if df is None or df.empty:
            return 0
        
        async with async_session_maker() as session:
            count = 0
            for _, row in df.iterrows():
                symbol = str(row.get('symbol', row.get('ticker', ''))).upper()
                if not symbol: continue
                
                values = {
                    'symbol': symbol,
                    'company_name': row.get('organName') or row.get('organ_name'),
                    'exchange': row.get('comGroupCode') or row.get('exchange') or 'HOSE',
                    'industry': row.get('industryName') or row.get('industry'),
                    'is_active': 1,
                    'updated_at': datetime.utcnow()
                }
                stmt = get_upsert_stmt(Stock, ['symbol'], values)
                await session.execute(stmt)
                count += 1
            await session.commit()
            logger.info(f"Synced {count} stocks.")
            return count

    @with_retry(max_retries=3)
    async def sync_screener_data(self) -> int:
        """Sync comprehensive metrics for all stocks."""
        from vnstock import Screener
        logger.info("Syncing screener data...")
        screener = Screener()
        df = screener.stock(params={"exchangeName": "HOSE,HNX,UPCOM"}, limit=2000)
        if df is None or df.empty:
            return 0
        
        async with async_session_maker() as session:
            count = 0
            today = date.today()
            for _, row in df.iterrows():
                symbol = row.get('ticker')
                if not symbol: continue
                
                data_dict = row.to_dict()
                values = {
                    'symbol': symbol,
                    'snapshot_date': today,
                    'price': data_dict.get('close'),
                    'volume': data_dict.get('volume'),
                    'market_cap': data_dict.get('marketCap'),
                    'pe': data_dict.get('priceToEarning'),
                    'pb': data_dict.get('priceToBook'),
                    'roe': data_dict.get('roe'),
                    'roa': data_dict.get('roa'),
                    'industry': data_dict.get('industryName'),
                    'source': 'vnstock',
                    'created_at': datetime.utcnow()
                }
                stmt = get_upsert_stmt(ScreenerSnapshot, ['symbol', 'snapshot_date'], values)
                await session.execute(stmt)
                count += 1
            await session.commit()
            logger.info(f"Synced {count} screener snapshots.")
            return count

    async def sync_daily_prices(self, symbols: List[str] = None, days: int = 30) -> int:
        """Sync historical prices for specified symbols."""
        if not symbols:
            async with async_session_maker() as session:
                result = await session.execute(select(Stock.symbol).where(Stock.is_active == 1))
                symbols = [r[0] for r in result.fetchall()]
        
        logger.info(f"Syncing prices for {len(symbols)} symbols over {days} days...")
        start_date = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')
        end_date = datetime.now().strftime('%Y-%m-%d')
        
        total_synced = 0
        for symbol in symbols:
            await self.rate_limiter.wait()
            try:
                from vnstock import Vnstock
                stock = Vnstock().stock(symbol=symbol, source=settings.vnstock_source)
                df = stock.quote.history(start=start_date, end=end_date)
                if df is not None and not df.empty:
                    async with async_session_maker() as session:
                        # Get stock ID for foreign key
                        res = await session.execute(select(Stock.id).where(Stock.symbol == symbol))
                        stock_id = res.scalar()
                        if not stock_id: continue
                        
                        for _, row in df.iterrows():
                            val = {
                                'stock_id': stock_id,
                                'symbol': symbol,
                                'time': row['time'].date() if hasattr(row['time'], 'date') else row['time'],
                                'open': float(row['open']),
                                'high': float(row['high']),
                                'low': float(row['low']),
                                'close': float(row['close']),
                                'volume': int(row['volume']),
                                'interval': '1D',
                                'source': 'vnstock'
                            }
                            stmt = get_upsert_stmt(StockPrice, ['symbol', 'time', 'interval'], val)
                            await session.execute(stmt)
                        await session.commit()
                        total_synced += len(df)
            except Exception as e:
                logger.error(f"Failed to sync prices for {symbol}: {e}")
                continue
        
        return total_synced

    async def sync_company_profiles(self, symbols: List[str] = None) -> int:
        """Sync company basic info for specified symbols."""
        if not symbols:
            async with async_session_maker() as session:
                result = await session.execute(select(Stock.symbol).where(Stock.is_active == 1))
                symbols = [r[0] for r in result.fetchall()]
        
        logger.info(f"Syncing company profiles for {len(symbols)} symbols...")
        total = 0
        for symbol in symbols:
            await self.rate_limiter.wait()
            try:
                from vnstock import Vnstock
                stock = Vnstock().stock(symbol=symbol, source=settings.vnstock_source)
                df = stock.company.profile()
                if df is not None and not df.empty:
                    async with async_session_maker() as session:
                        row = df.iloc[0].to_dict()
                        values = {
                            'symbol': symbol,
                            'company_name': row.get('organName') or row.get('companyName'),
                            'short_name': row.get('organShortName') or row.get('shortName'),
                            'industry': row.get('industryName') or row.get('industry'),
                            'sector': row.get('icbName1'),
                            'business_description': row.get('businessDescription') or row.get('business_description'),
                            'website': row.get('website'),
                            'updated_at': datetime.utcnow()
                        }
                        stmt = get_upsert_stmt(Company, ['symbol'], values)
                        await session.execute(stmt)
                        await session.commit()
                        total += 1
            except Exception as e:
                logger.debug(f"Failed to sync profile for {symbol}: {e}")
                continue
        return total

    async def sync_financials(self, symbols: List[str] = None, period: str = 'year') -> int:
        """Sync income, balance, and cashflow for specified symbols."""
        if not symbols:
            async with async_session_maker() as session:
                result = await session.execute(select(Stock.symbol).where(Stock.is_active == 1))
                symbols = [r[0] for r in result.fetchall()]
        
        logger.info(f"Syncing financials ({period}) for {len(symbols)} symbols...")
        total = 0
        for symbol in symbols:
            await self.rate_limiter.wait()
            try:
                from vnstock import Vnstock
                stock = Vnstock().stock(symbol=symbol, source=settings.vnstock_source)
                
                # Income Statement
                df_inc = stock.finance.income_statement(period=period, lang='en')
                if df_inc is not None and not df_inc.empty:
                    async with async_session_maker() as session:
                        for _, row in df_inc.iterrows():
                            # Extract period info
                            period_str = str(row.get('period', row.name))
                            val = {
                                'symbol': symbol,
                                'period': period_str,
                                'period_type': period,
                                'fiscal_year': int(period_str.split('-')[-1]) if '-' in period_str else int(period_str),
                                'revenue': float(row.get('revenue', 0)),
                                'net_income': float(row.get('netIncome', 0)),
                                'source': 'vnstock',
                                'updated_at': datetime.utcnow()
                            }
                            stmt = get_upsert_stmt(IncomeStatement, ['symbol', 'period', 'period_type'], val)
                            await session.execute(stmt)
                        await session.commit()
                
                # Balance Sheet
                df_bal = stock.finance.balance_sheet(period=period, lang='en')
                if df_bal is not None and not df_bal.empty:
                    async with async_session_maker() as session:
                        for _, row in df_bal.iterrows():
                            period_str = str(row.get('period', row.name))
                            val = {
                                'symbol': symbol,
                                'period': period_str,
                                'period_type': period,
                                'fiscal_year': int(period_str.split('-')[-1]) if '-' in period_str else int(period_str),
                                'total_assets': float(row.get('totalAssets', 0)),
                                'total_equity': float(row.get('totalEquity', 0)),
                                'source': 'vnstock',
                                'updated_at': datetime.utcnow()
                            }
                            stmt = get_upsert_stmt(BalanceSheet, ['symbol', 'period', 'period_type'], val)
                            await session.execute(stmt)
                        await session.commit()

                # Cash Flow
                df_cf = stock.finance.cash_flow(period=period, lang='en')
                if df_cf is not None and not df_cf.empty:
                    async with async_session_maker() as session:
                        for _, row in df_cf.iterrows():
                            period_str = str(row.get('period', row.name))
                            val = {
                                'symbol': symbol,
                                'period': period_str,
                                'period_type': period,
                                'fiscal_year': int(period_str.split('-')[-1]) if '-' in period_str else int(period_str),
                                'operating_cash_flow': float(row.get('operatingCashFlow', 0)),
                                'free_cash_flow': float(row.get('freeCashFlow', 0)),
                                'source': 'vnstock',
                                'updated_at': datetime.utcnow()
                            }
                            stmt = get_upsert_stmt(CashFlow, ['symbol', 'period', 'period_type'], val)
                            await session.execute(stmt)
                        await session.commit()
                
                total += 1
            except Exception as e:
                logger.debug(f"Financials failed for {symbol}: {e}")
                continue
        return total

    async def run_full_seeding(self, days: int = 30):
        """Run complete data seeding pipeline."""
        logger.info(f"🚀 Starting FULL DATA SEEDING ({days} days history)...")
        try:
            # 1. Core Stock List
            await self.sync_stock_list()
            
            # 2. Screener Snapshots
            await self.sync_screener_data()
            
            # 3. Get top symbols for deep seeding
            async with async_session_maker() as session:
                res = await session.execute(
                    select(Stock.symbol).join(ScreenerSnapshot, Stock.symbol == ScreenerSnapshot.symbol)
                    .order_by(ScreenerSnapshot.market_cap.desc()).limit(100)
                )
                top_symbols = [r[0] for r in res.fetchall()]
            
            if not top_symbols:
                # Fallback if screener failed
                async with async_session_maker() as session:
                    res = await session.execute(select(Stock.symbol).limit(100))
                    top_symbols = [r[0] for r in res.fetchall()]

            if top_symbols:
                # 4. Profiles
                await self.sync_company_profiles(symbols=top_symbols)
                # 5. Prices
                await self.sync_daily_prices(symbols=top_symbols, days=days)
                # 6. Financials
                await self.sync_financials(symbols=top_symbols, period='year')
            
            logger.info("✅ Full seeding completed successfully.")
        except Exception as e:
            logger.error(f"Full seeding failed: {e}")
            raise


# Standalone functions for scheduler
async def run_daily_sync():
    """Wrapper for scheduler to run daily sync."""
    await data_pipeline.run_full_seeding(days=1)

async def run_hourly_news_sync():
    """Wrapper for scheduler to run hourly news sync."""
    # TODO: Implement news sync in DataPipeline class
    logger.info("Hourly news sync placeholder")
    pass

async def run_intraday_sync():
    """Wrapper for scheduler to run intraday sync."""
    # TODO: Implement intraday sync in DataPipeline class
    logger.info("Intraday sync placeholder")
    pass

