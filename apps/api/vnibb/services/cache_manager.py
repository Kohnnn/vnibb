"""
Cache Manager Service

Provides database caching for vnstock API responses with TTL support.
Checks database for cached data before calling upstream APIs and
falls back to stale cache when API calls fail.
"""

import logging
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any, Generic, List, Optional, TypeVar

from sqlalchemy import and_, select, func

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.core.database import async_session_factory
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models.company import Company
from vnibb.models.stock import Stock

logger = logging.getLogger(__name__)

T = TypeVar("T")


@dataclass
class CacheResult(Generic[T]):
    """Result wrapper containing cached data and metadata."""

    data: Optional[T]
    is_stale: bool
    cached_at: Optional[datetime]
    hit: bool

    @property
    def is_fresh(self) -> bool:
        """Returns True if cache was hit and data is not stale."""
        return self.hit and not self.is_stale


class CacheManager:
    """
    Database cache layer for vnstock API responses.

    Provides methods to check for cached data before calling upstream APIs,
    store successful responses, and fall back to stale cache on failures.

    TTL Configuration (in minutes):
    - Real-time data (price_board, price_depth): 0.5-1 minute
    - Screener/trading data: 5 minutes
    - Profile/company data: 60 minutes (1 hour)
    - Static data (listing, dividends): 1440 minutes (24 hours)
    """

    # Centralized TTL configuration (in minutes)
    TTL_CONFIG = {
        # Real-time data - very short TTL
        "price_board": 1,  # 1 minute (real-time prices)
        "price_depth": 0.5,  # 30 seconds (order book)
        "intraday": 1,  # 1 minute
        # Market data - short TTL
        "screener": 60,  # 60 minutes
        "trading_stats": 60,  # 60 minutes
        "foreign_trading": 60,  # 60 minutes
        # Company data - medium TTL
        "profile": 10080,  # 7 days
        "financial_ratios": 1440,  # 24 hours
        "officers": 1440,  # 24 hours
        "shareholders": 1440,  # 24 hours
        "insider_deals": 1440,  # 24 hours
        # Static data - long TTL
        "listing": 1440,  # 24 hours
        "industries": 1440,  # 24 hours
        "dividends": 1440,  # 24 hours
        "balance_sheet": 1440,  # 24 hours
        "income_statement": 1440,  # 24 hours
        "cash_flow": 1440,  # 24 hours
        "derivatives": 5,  # 5 minutes (market data)
    }

    # Legacy constants (for backward compatibility)
    SCREENER_TTL_MINUTES = 60
    PROFILE_TTL_HOURS = 168

    def __init__(self, db: Optional[AsyncSession] = None):
        """
        Initialize cache manager.

        Args:
            db: Optional database session. If not provided, will create
                sessions internally using async_session_factory.
        """
        self._db = db

    async def _get_session(self) -> AsyncSession:
        """Get or create a database session."""
        if self._db:
            return self._db
        return async_session_factory()

    # ========================================================================
    # SCREENER DATA CACHING
    # ========================================================================

    async def get_screener_data(
        self,
        symbol: Optional[str] = None,
        source: Optional[str] = "VCI",
        allow_stale: bool = True,
    ) -> CacheResult[List[ScreenerSnapshot]]:
        """
        Get cached screener data from database.

        Args:
            symbol: Optional ticker symbol. If None, returns all symbols.
            source: Data source filter (VCI, DNSE)
            allow_stale: If True, returns stale data when fresh cache is unavailable.

        Returns:
            CacheResult containing list of ScreenerSnapshot records.
        """
        session = await self._get_session()
        own_session = self._db is None

        try:
            now = datetime.utcnow()
            today = date.today()
            fresh_threshold = now - timedelta(minutes=self.SCREENER_TTL_MINUTES)

            # Build query conditions
            # If allow_stale is True, we don't strictly require snapshot_date == today
            conditions = []
            if source:
                conditions.append(ScreenerSnapshot.source == source)
            if not allow_stale:
                conditions.append(ScreenerSnapshot.snapshot_date == today)

            if symbol:
                conditions.append(ScreenerSnapshot.symbol == symbol.upper())

            # Query for cached data
            query = select(ScreenerSnapshot).where(and_(*conditions))

            if allow_stale:
                # If allowing stale, we should only take the most recent snapshots
                # First find the latest date
                latest_date_query = select(func.max(ScreenerSnapshot.snapshot_date))
                if source:
                    latest_date_query = latest_date_query.where(ScreenerSnapshot.source == source)
                latest_date_result = await session.execute(latest_date_query)
                latest_date = latest_date_result.scalar()

                if latest_date:
                    query = query.where(ScreenerSnapshot.snapshot_date == latest_date)
                else:
                    return CacheResult(data=None, is_stale=False, cached_at=None, hit=False)

            result = await session.execute(query)

            snapshots = list(result.scalars().all())

            if not snapshots:
                logger.debug(f"Cache miss for screener data (symbol={symbol}, source={source})")
                return CacheResult(data=None, is_stale=False, cached_at=None, hit=False)

            # Check if data is fresh
            latest_created = max(s.created_at for s in snapshots)
            is_stale = latest_created < fresh_threshold

            if is_stale and not allow_stale:
                logger.debug(f"Cache stale for screener data, age={now - latest_created}")
                return CacheResult(data=None, is_stale=True, cached_at=latest_created, hit=False)

            logger.info(
                f"Cache hit for screener data: {len(snapshots)} records, "
                f"stale={is_stale}, age={now - latest_created}"
            )
            return CacheResult(
                data=snapshots,
                is_stale=is_stale,
                cached_at=latest_created,
                hit=True,
            )

        except Exception as e:
            logger.error(f"Cache lookup error for screener: {e}")
            return CacheResult(data=None, is_stale=False, cached_at=None, hit=False)
        finally:
            if own_session:
                await session.close()

    async def store_screener_data(
        self,
        data: List[dict[str, Any]],
        source: str = "VCI",
    ) -> int:
        """
        Store screener data in database cache.

        Uses upsert to update existing records for the same symbol+date.

        Args:
            data: List of screener data records (from vnstock transform)
            source: Data source identifier

        Returns:
            Number of records stored/updated
        """
        if not data:
            return 0

        session = await self._get_session()
        own_session = self._db is None

        try:
            today = date.today()
            now = datetime.utcnow()

            prep_data = []
            for record in data:
                # Map record fields to model columns
                symbol = record.get("symbol") or record.get("ticker")
                if not symbol:
                    continue

                values = {
                    "symbol": symbol.upper(),
                    "snapshot_date": today,
                    "company_name": record.get("organ_name") or record.get("organName"),
                    "exchange": record.get("exchange"),
                    "industry": record.get("industry_name") or record.get("industryName"),
                    "price": record.get("price"),
                    "volume": record.get("volume"),
                    "market_cap": record.get("market_cap") or record.get("marketCap"),
                    "pe": record.get("pe"),
                    "pb": record.get("pb"),
                    "ps": record.get("ps"),
                    "ev_ebitda": record.get("ev_ebitda") or record.get("evEbitda"),
                    "roe": record.get("roe"),
                    "roa": record.get("roa"),
                    "roic": record.get("roic"),
                    "gross_margin": record.get("gross_margin") or record.get("grossMargin"),
                    "net_margin": record.get("net_margin") or record.get("netMargin"),
                    "operating_margin": record.get("operating_margin")
                    or record.get("operatingMargin"),
                    "revenue_growth": record.get("revenue_growth") or record.get("revenueGrowth"),
                    "earnings_growth": record.get("earnings_growth")
                    or record.get("earningsGrowth"),
                    "dividend_yield": record.get("dividend_yield") or record.get("dividendYield"),
                    "debt_to_equity": record.get("debt_to_equity") or record.get("debtToEquity"),
                    "current_ratio": record.get("current_ratio") or record.get("currentRatio"),
                    "quick_ratio": record.get("quick_ratio") or record.get("quickRatio"),
                    "eps": record.get("eps"),
                    "bvps": record.get("bvps"),
                    "foreign_ownership": record.get("foreign_ownership")
                    or record.get("foreignOwnership"),
                    "source": source,
                    "created_at": now,
                }
                prep_data.append(values)

            if not prep_data:
                return 0

            # PostgreSQL bulk upsert (INSERT ... ON CONFLICT)
            stmt = insert(ScreenerSnapshot).values(prep_data)

            # Identify columns to update (all except symbol and date which are keys)
            update_cols = {
                k: stmt.excluded[k]
                for k in prep_data[0].keys()
                if k not in ["symbol", "snapshot_date"]
            }

            stmt = stmt.on_conflict_do_update(
                index_elements=["symbol", "snapshot_date"], set_=update_cols
            )

            await session.execute(stmt)
            await session.commit()

            logger.info(f"Stored {len(prep_data)} screener records (source={source})")
            return len(prep_data)

        except Exception as e:
            logger.error(f"Cache store error for screener: {e}")
            await session.rollback()
            return 0
        finally:
            if own_session:
                await session.close()

    # ========================================================================
    # COMPANY PROFILE CACHING
    # ========================================================================

    async def get_profile_data(
        self,
        symbol: str,
        allow_stale: bool = True,
    ) -> CacheResult[Company]:
        """
        Get cached company profile from database.

        Args:
            symbol: Stock ticker symbol
            allow_stale: If True, returns stale data when fresh cache is unavailable.

        Returns:
            CacheResult containing Company record if found.
        """
        session = await self._get_session()
        own_session = self._db is None

        try:
            now = datetime.utcnow()
            fresh_threshold = now - timedelta(hours=self.PROFILE_TTL_HOURS)

            result = await session.execute(select(Company).where(Company.symbol == symbol.upper()))
            company = result.scalar_one_or_none()

            if not company:
                logger.debug(f"Cache miss for profile: {symbol}")
                return CacheResult(data=None, is_stale=False, cached_at=None, hit=False)

            # Check if data is fresh
            is_stale = company.updated_at < fresh_threshold

            if is_stale and not allow_stale:
                logger.debug(f"Cache stale for profile: {symbol}, age={now - company.updated_at}")
                return CacheResult(
                    data=None, is_stale=True, cached_at=company.updated_at, hit=False
                )

            logger.info(f"Cache hit for profile: {symbol}, stale={is_stale}")
            return CacheResult(
                data=company,
                is_stale=is_stale,
                cached_at=company.updated_at,
                hit=True,
            )

        except Exception as e:
            logger.error(f"Cache lookup error for profile {symbol}: {e}")
            return CacheResult(data=None, is_stale=False, cached_at=None, hit=False)
        finally:
            if own_session:
                await session.close()

    async def store_profile_data(
        self,
        symbol: str,
        data: dict[str, Any],
    ) -> bool:
        """
        Store company profile in database cache.

        Args:
            symbol: Stock ticker symbol
            data: Profile data record (from vnstock transform)

        Returns:
            True if stored successfully
        """
        session = await self._get_session()
        own_session = self._db is None

        try:
            now = datetime.utcnow()
            symbol = symbol.upper()

            # Check if company exists
            result = await session.execute(select(Company).where(Company.symbol == symbol))
            company = result.scalar_one_or_none()

            if company:
                # Update existing record
                company.company_name = data.get("company_name") or company.company_name
                company.short_name = data.get("short_name") or company.short_name
                company.english_name = data.get("english_name") or company.english_name
                company.exchange = data.get("exchange") or company.exchange
                company.industry = data.get("industry") or company.industry
                company.sector = data.get("sector") or company.sector
                company.website = data.get("website") or company.website
                company.business_description = (
                    data.get("description") or company.business_description
                )
                company.outstanding_shares = (
                    data.get("outstanding_shares") or company.outstanding_shares
                )
                company.listed_shares = data.get("listed_shares") or company.listed_shares
                company.address = data.get("address") or company.address
                company.phone = data.get("phone") or company.phone
                company.email = data.get("email") or company.email
                company.raw_data = data
                company.updated_at = now
            else:
                # Create new record
                company = Company(
                    symbol=symbol,
                    company_name=data.get("company_name"),
                    short_name=data.get("short_name"),
                    english_name=data.get("english_name"),
                    exchange=data.get("exchange"),
                    industry=data.get("industry"),
                    sector=data.get("sector"),
                    website=data.get("website"),
                    business_description=data.get("description"),
                    outstanding_shares=data.get("outstanding_shares"),
                    listed_shares=data.get("listed_shares"),
                    address=data.get("address"),
                    phone=data.get("phone"),
                    email=data.get("email"),
                    raw_data=data,
                    created_at=now,
                    updated_at=now,
                )
                session.add(company)

            await session.commit()
            logger.info(f"Stored profile in cache: {symbol}")
            return True

        except Exception as e:
            logger.error(f"Cache store error for profile {symbol}: {e}")
            await session.rollback()
            return False
        finally:
            if own_session:
                await session.close()

    # ========================================================================
    # LISTING DATA CACHING
    # ========================================================================

    async def get_listing_data(
        self,
        source: str = "VCI",
        allow_stale: bool = True,
    ) -> CacheResult[List[Stock]]:
        """
        Get cached listing data from database.

        Args:
            source: Data source filter (VCI, VND, etc.)
            allow_stale: If True, returns stale data when fresh cache is unavailable.

        Returns:
            CacheResult containing list of Stock records.
        """
        session = await self._get_session()
        own_session = self._db is None

        try:
            now = datetime.utcnow()
            ttl_minutes = self.TTL_CONFIG.get("listing", 1440)  # 24 hours default
            fresh_threshold = now - timedelta(minutes=ttl_minutes)

            # Query for all active stocks
            result = await session.execute(select(Stock).where(Stock.is_active == 1))
            stocks = list(result.scalars().all())

            if not stocks:
                logger.debug(f"Cache miss for listing data (source={source})")
                return CacheResult(data=None, is_stale=False, cached_at=None, hit=False)

            # Check if data is fresh based on most recent update
            latest_updated = max(s.updated_at for s in stocks)
            is_stale = latest_updated < fresh_threshold

            if is_stale and not allow_stale:
                logger.debug(f"Cache stale for listing data, age={now - latest_updated}")
                return CacheResult(data=None, is_stale=True, cached_at=latest_updated, hit=False)

            logger.info(
                f"Cache hit for listing data: {len(stocks)} records, "
                f"stale={is_stale}, age={now - latest_updated}"
            )
            return CacheResult(
                data=stocks,
                is_stale=is_stale,
                cached_at=latest_updated,
                hit=True,
            )

        except Exception as e:
            logger.error(f"Cache lookup error for listing: {e}")
            return CacheResult(data=None, is_stale=False, cached_at=None, hit=False)
        finally:
            if own_session:
                await session.close()

    async def store_listing_data(
        self,
        data: List[dict[str, Any]],
        source: str = "VCI",
    ) -> int:
        """
        Store listing data in database cache.

        Uses upsert to update existing records or insert new ones.

        Args:
            data: List of symbol/stock data records
            source: Data source identifier

        Returns:
            Number of records stored/updated
        """
        if not data:
            return 0

        session = await self._get_session()
        own_session = self._db is None

        try:
            now = datetime.utcnow()
            count = 0

            for record in data:
                # Get symbol from record (could be 'symbol' or 'ticker')
                symbol = record.get("symbol") or record.get("ticker")
                if not symbol:
                    continue

                symbol = symbol.upper()

                # Check if stock exists
                result = await session.execute(select(Stock).where(Stock.symbol == symbol))
                stock = result.scalar_one_or_none()

                if stock:
                    # Update existing record
                    stock.company_name = (
                        record.get("company_name") or record.get("organ_name") or stock.company_name
                    )
                    stock.short_name = record.get("short_name") or stock.short_name
                    stock.exchange = record.get("exchange") or stock.exchange
                    stock.industry = (
                        record.get("industry") or record.get("industry_name") or stock.industry
                    )
                    stock.sector = record.get("sector") or stock.sector
                    stock.is_active = 1
                    stock.updated_at = now
                else:
                    # Create new record
                    stock = Stock(
                        symbol=symbol,
                        company_name=record.get("company_name") or record.get("organ_name"),
                        short_name=record.get("short_name"),
                        exchange=record.get("exchange", "HOSE"),
                        industry=record.get("industry") or record.get("industry_name"),
                        sector=record.get("sector"),
                        is_active=1,
                        created_at=now,
                        updated_at=now,
                    )
                    session.add(stock)

                count += 1

            await session.commit()
            logger.info(f"Stored {count} listing records in cache (source={source})")
            return count

        except Exception as e:
            logger.error(f"Cache store error for listing: {e}")
            await session.rollback()
            return 0
        finally:
            if own_session:
                await session.close()

    async def get_industries_data(
        self,
        source: str = "VCI",
        allow_stale: bool = True,
    ) -> CacheResult[List[Stock]]:
        """
        Get cached industry classifications from database.

        Queries distinct industries from the Stock table.

        Args:
            source: Data source filter
            allow_stale: If True, returns stale data when fresh cache is unavailable.

        Returns:
            CacheResult containing list of stocks with industry data.
        """
        # Industries are derived from listing data, use same method
        return await self.get_listing_data(source=source, allow_stale=allow_stale)

    # ========================================================================
    # UTILITY METHODS
    # ========================================================================

    async def invalidate_screener_cache(
        self,
        symbol: Optional[str] = None,
        source: Optional[str] = None,
    ) -> int:
        """
        Invalidate screener cache for cleanup or forced refresh.

        Args:
            symbol: Optional symbol to invalidate (None = all)
            source: Optional source to invalidate (None = all)

        Returns:
            Number of records deleted
        """
        session = await self._get_session()
        own_session = self._db is None

        try:
            from sqlalchemy import delete

            conditions = []
            if symbol:
                conditions.append(ScreenerSnapshot.symbol == symbol.upper())
            if source:
                conditions.append(ScreenerSnapshot.source == source)

            if conditions:
                stmt = delete(ScreenerSnapshot).where(and_(*conditions))
            else:
                stmt = delete(ScreenerSnapshot)

            result = await session.execute(stmt)
            await session.commit()

            count = result.rowcount
            logger.info(f"Invalidated {count} screener cache records")
            return count

        except Exception as e:
            logger.error(f"Cache invalidation error: {e}")
            await session.rollback()
            return 0
        finally:
            if own_session:
                await session.close()

    # ========================================================================
    # FINANCIAL DATA CACHING
    # ========================================================================

    async def get_financial_data(
        self,
        symbol: str,
        statement_type: str,  # 'income', 'balance', 'cashflow'
        period: str = "year",
        allow_stale: bool = True,
    ) -> CacheResult[List[Any]]:
        """
        Get cached financial statement data from database.

        Args:
            symbol: Stock ticker symbol
            statement_type: Type of statement (income, balance, cashflow)
            period: Reporting period (year, quarter)
            allow_stale: If True, returns stale data when fresh cache is unavailable.

        Returns:
            CacheResult containing list of financial records.
        """
        from vnibb.models import IncomeStatement, BalanceSheet, CashFlow

        model_map = {
            "income": IncomeStatement,
            "balance": BalanceSheet,
            "cashflow": CashFlow,
        }

        model = model_map.get(statement_type)
        if not model:
            return CacheResult(data=None, is_stale=False, cached_at=None, hit=False)

        session = await self._get_session()
        own_session = self._db is None

        try:
            now = datetime.utcnow()
            ttl_minutes = self.TTL_CONFIG.get(statement_type, 1440)  # 24 hours default
            fresh_threshold = now - timedelta(minutes=ttl_minutes)

            result = await session.execute(
                select(model)
                .where(
                    and_(
                        model.symbol == symbol.upper(),
                        model.period == period,
                    )
                )
                .order_by(model.fiscal_year.desc())
            )
            records = list(result.scalars().all())

            if not records:
                logger.debug(f"Cache miss for {statement_type}: {symbol}")
                return CacheResult(data=None, is_stale=False, cached_at=None, hit=False)

            # Check freshness based on most recent update
            latest_updated = max(r.updated_at for r in records if r.updated_at)
            is_stale = latest_updated < fresh_threshold if latest_updated else True

            if is_stale and not allow_stale:
                return CacheResult(data=None, is_stale=True, cached_at=latest_updated, hit=False)

            logger.info(f"Cache hit for {statement_type}: {symbol}, records={len(records)}")
            return CacheResult(
                data=records,
                is_stale=is_stale,
                cached_at=latest_updated,
                hit=True,
            )

        except Exception as e:
            logger.error(f"Cache lookup error for {statement_type} {symbol}: {e}")
            return CacheResult(data=None, is_stale=False, cached_at=None, hit=False)
        finally:
            if own_session:
                await session.close()

    async def get_historical_prices(
        self,
        symbol: str,
        start_date: date,
        end_date: date,
        interval: str = "1D",
        allow_stale: bool = True,
    ) -> CacheResult[List[Any]]:
        """
        Get cached historical price data from database.

        Args:
            symbol: Stock ticker symbol
            start_date: Start date for price range
            end_date: End date for price range
            interval: Price interval (1D, 1W, 1M)
            allow_stale: If True, returns stale data when fresh cache is unavailable.

        Returns:
            CacheResult containing list of StockPrice records.
        """
        from vnibb.models import StockPrice

        session = await self._get_session()
        own_session = self._db is None

        try:
            now = datetime.utcnow()
            # Daily prices are fresh for 1 day after market close
            ttl_minutes = 1440 if interval == "1D" else 10080  # 1 day or 1 week
            fresh_threshold = now - timedelta(minutes=ttl_minutes)

            result = await session.execute(
                select(StockPrice)
                .where(
                    and_(
                        StockPrice.symbol == symbol.upper(),
                        StockPrice.time >= start_date,
                        StockPrice.time <= end_date,
                        StockPrice.interval == interval,
                    )
                )
                .order_by(StockPrice.time.asc())
            )
            prices = list(result.scalars().all())

            if not prices:
                logger.debug(f"Cache miss for prices: {symbol} ({start_date} to {end_date})")
                return CacheResult(data=None, is_stale=False, cached_at=None, hit=False)

            # Check if we have complete data for the range
            # For daily data, check if latest price is recent enough
            latest_price = prices[-1]
            latest_time = latest_price.time if hasattr(latest_price, "time") else None

            # Data is stale if the latest price is older than expected
            is_stale = False
            if latest_time:
                expected_latest = end_date
                is_stale = latest_time < expected_latest

            logger.info(f"Cache hit for prices: {symbol}, records={len(prices)}, stale={is_stale}")
            return CacheResult(
                data=prices,
                is_stale=is_stale,
                cached_at=now,
                hit=True,
            )

        except Exception as e:
            logger.error(f"Cache lookup error for prices {symbol}: {e}")
            return CacheResult(data=None, is_stale=False, cached_at=None, hit=False)
        finally:
            if own_session:
                await session.close()

    # ========================================================================
    # GENERIC CACHE HELPERS
    # ========================================================================

    def get_ttl_minutes(self, data_type: str) -> int:
        """Get TTL in minutes for a data type."""
        return self.TTL_CONFIG.get(data_type, 60)  # Default 1 hour

    def is_data_fresh(
        self,
        updated_at: Optional[datetime],
        data_type: str,
    ) -> bool:
        """
        Check if data is fresh based on its type's TTL.

        Args:
            updated_at: When the data was last updated
            data_type: Type of data (for TTL lookup)

        Returns:
            True if data is within TTL window
        """
        if not updated_at:
            return False

        ttl_minutes = self.get_ttl_minutes(data_type)
        now = datetime.utcnow()

        # Handle timezone-aware datetimes
        if updated_at.tzinfo is not None:
            updated_at = updated_at.replace(tzinfo=None)

        return (now - updated_at) < timedelta(minutes=ttl_minutes)
