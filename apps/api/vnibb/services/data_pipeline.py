"""
Data Pipeline Service - Comprehensive VNStock Integration

Batch data synchronization from ALL vnstock Golden Sponsor APIs.
Uses APScheduler for scheduled jobs.
Supports both PostgreSQL and SQLite dialects.
"""

import asyncio
import os
import logging
import re
from contextvars import ContextVar
from uuid import uuid4
from datetime import date, datetime, timedelta, time
from typing import Optional, List, Dict, Any, Union, Tuple

import pandas as pd
from zoneinfo import ZoneInfo
from sqlalchemy import select, and_, or_, func, text, update, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError

from vnibb.core.database import async_session_maker, engine
from vnibb.core.cache import redis_client, build_cache_key
from vnibb.core.config import settings
from vnibb.models.stock import Stock, StockPrice, StockIndex
from vnibb.models.company import Company, Shareholder, Officer
from vnibb.models.financials import IncomeStatement, BalanceSheet, CashFlow
from vnibb.models.news import CompanyNews, CompanyEvent, Dividend, InsiderDeal
from vnibb.models.alerts import BlockTrade
from vnibb.models.trading import (
    ForeignTrading,
    FinancialRatio,
    IntradayTrade,
    OrderbookSnapshot,
    OrderFlowDaily,
)
from vnibb.models.derivatives import DerivativePrice
from vnibb.models.market import MarketSector, SectorPerformance, Subsidiary
from vnibb.models.technical_indicator import TechnicalIndicator
from vnibb.models.market_news import MarketNews
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models.sync_status import SyncStatus
from vnibb.core.retry import with_retry
from vnibb.providers.vnstock.financial_ratios import (
    FinancialRatiosQueryParams,
    VnstockFinancialRatiosFetcher,
)
from vnibb.providers.vnstock.financials import (
    FinancialsQueryParams,
    StatementType,
    VnstockFinancialsFetcher,
)

logger = logging.getLogger(__name__)

SYNC_PROGRESS_KEY = "vnibb:sync:full:progress"
SYNC_PROGRESS_TTL = 7 * 24 * 60 * 60
DAILY_TRADING_PROGRESS_KEY = "vnibb:sync:daily_trading:progress"
DAILY_TRADING_PROGRESS_TTL = 3 * 24 * 60 * 60

CACHE_TTL_LISTING = 24 * 60 * 60
CACHE_TTL_PROFILE = 7 * 24 * 60 * 60
CACHE_TTL_SCREENER = 6 * 60 * 60
CACHE_TTL_PRICE_LATEST = 60 * 60
CACHE_TTL_PRICE_RECENT = 6 * 60 * 60
CACHE_TTL_FINANCIALS = 7 * 24 * 60 * 60
CACHE_TTL_FOREIGN_TRADING = 24 * 60 * 60
CACHE_TTL_ORDER_FLOW = 24 * 60 * 60
CACHE_TTL_INTRADAY = 60 * 60
CACHE_TTL_ORDERBOOK = 10 * 60
CACHE_TTL_ORDERBOOK_DAILY = 24 * 60 * 60
CACHE_TTL_BLOCK_TRADES = 24 * 60 * 60
CACHE_TTL_DERIVATIVES_LATEST = 6 * 60 * 60
CACHE_TTL_DERIVATIVES_RECENT = 24 * 60 * 60

RECENT_PRICE_DAYS = 60
RECENT_DERIVATIVE_DAYS = 60

STAGE_ORDER = ["stock_list", "screener", "profiles", "prices", "financials"]
DAILY_TRADING_STAGES = [
    "foreign_trading",
    "intraday_trades",
    "orderbook_snapshots",
    "block_trades",
    "derivatives",
    "warrants",
]

RATE_MODE_NORMAL = "normal"
RATE_MODE_REINFORCEMENT = "reinforcement"
RATE_MODE_CONTEXT: ContextVar[str] = ContextVar("vnibb_rate_mode", default=RATE_MODE_NORMAL)


def get_upsert_stmt(model, index_elements, values):
    """
    Generate a dialect-specific upsert statement.
    """
    if engine.dialect.name == "postgresql":
        from sqlalchemy.dialects.postgresql import insert as pg_insert

        stmt = pg_insert(model).values(values)
        return stmt.on_conflict_do_update(
            index_elements=index_elements,
            set_={
                c.name: stmt.excluded[c.name]
                for c in model.__table__.columns
                if c.name not in index_elements and not c.primary_key
            },
        )
    else:
        from sqlalchemy.dialects.sqlite import insert as sqlite_insert

        stmt = sqlite_insert(model).values(values)
        return stmt.on_conflict_do_update(
            index_elements=index_elements,
            set_={
                c.name: stmt.excluded[c.name]
                for c in model.__table__.columns
                if c.name not in index_elements and not c.primary_key
            },
        )


class RateLimiter:
    def __init__(self, calls_per_minute: float):
        self.delay = 60.0 / calls_per_minute if calls_per_minute and calls_per_minute > 0 else 0.0
        self.last_request = 0.0

    async def wait(self):
        if self.delay <= 0:
            return
        now = asyncio.get_event_loop().time()
        time_since_last = now - self.last_request
        if time_since_last < self.delay:
            await asyncio.sleep(self.delay - time_since_last)
        self.last_request = asyncio.get_event_loop().time()


class DataPipeline:
    def __init__(self):
        self._vnstock = None
        self.cache_writes_enabled = True
        self._redis_disabled_until = 0.0
        rps_budget = max(float(getattr(settings, "vnstock_rate_limit_rps", 0) or 0), 0.0)
        reinforcement_rps = max(
            float(getattr(settings, "vnstock_reinforcement_rps", 0) or 0),
            0.0,
        )
        self.global_vnstock_limiter = RateLimiter(calls_per_minute=rps_budget * 60)
        self.reinforcement_vnstock_limiter = RateLimiter(calls_per_minute=reinforcement_rps * 60)
        self._normal_budget_per_minute = 500
        reinforcement_budget = int(reinforcement_rps * 60)
        self._reinforcement_budget_per_minute = (
            min(50, reinforcement_budget) if reinforcement_budget > 0 else 0
        )
        self._rate_log_window_start = 0.0
        self._rate_log_normal_calls = 0
        self._rate_log_reinforcement_calls = 0
        self._rate_log_lock = asyncio.Lock()
        base_limits = {
            "listing": 10,
            "screener": 20,
            "profiles": 20,
            "prices": 30,
            "financials": 15,
            "price_board": 20,
            "intraday": 10,
            "orderbook": 20,
            "derivatives": 15,
        }
        if settings.vnstock_calls_per_minute:
            base_limits = {k: settings.vnstock_calls_per_minute for k in base_limits}
        self.rate_limiters = {
            key: RateLimiter(calls_per_minute=value) for key, value in base_limits.items()
        }
        if settings.vnstock_api_key:
            os.environ["VNSTOCK_API_KEY"] = settings.vnstock_api_key
            logger.info("VNStock API key configured (registration handled at startup)")

    async def _record_rate_usage(self, mode: str) -> None:
        now = asyncio.get_event_loop().time()
        async with self._rate_log_lock:
            if self._rate_log_window_start <= 0:
                self._rate_log_window_start = now

            if mode == RATE_MODE_REINFORCEMENT:
                self._rate_log_reinforcement_calls += 1
            else:
                self._rate_log_normal_calls += 1

            elapsed = now - self._rate_log_window_start
            if elapsed < 60:
                return

            logger.info(
                "[RateLimit] %d/%d requests consumed in last 60s window (reinforcement %d/%d)",
                self._rate_log_normal_calls,
                self._normal_budget_per_minute,
                self._rate_log_reinforcement_calls,
                self._reinforcement_budget_per_minute,
            )
            self._rate_log_window_start = now
            self._rate_log_normal_calls = 0
            self._rate_log_reinforcement_calls = 0

    async def _wait_for_rate_limit(self, bucket: str) -> None:
        mode = RATE_MODE_CONTEXT.get()
        await self.global_vnstock_limiter.wait()
        if mode == RATE_MODE_REINFORCEMENT:
            await self.reinforcement_vnstock_limiter.wait()
        limiter = self.rate_limiters.get(bucket)
        if limiter:
            await limiter.wait()
        await self._record_rate_usage(mode)

    @property
    def vnstock(self):
        from vnstock import Vnstock

        return Vnstock()

    async def _ensure_redis(self) -> bool:
        if not settings.redis_url:
            return False
        now = asyncio.get_event_loop().time()
        if self._redis_disabled_until and now < self._redis_disabled_until:
            return False
        try:
            await redis_client.connect()
            try:
                await redis_client.client.ping()
            except Exception as exc:
                self._redis_disabled_until = now + 60
                logger.warning(f"Redis unavailable: {exc}")
                return False
            return True
        except Exception as exc:
            self._redis_disabled_until = now + 60
            logger.warning(f"Redis unavailable: {exc}")
            return False

    async def _cache_set_json(self, key: str, value: Any, ttl: int, force: bool = False) -> None:
        if not self.cache_writes_enabled and not force:
            return
        if not await self._ensure_redis():
            return
        try:
            await redis_client.set_json(key, value, ttl=ttl)
        except Exception as exc:
            logger.debug(f"Cache set failed for {key}: {exc}")

    async def _load_progress(self, key: str = SYNC_PROGRESS_KEY) -> Optional[Dict[str, Any]]:
        if not await self._ensure_redis():
            return None
        try:
            data = await redis_client.get_json(key)
            if not data:
                return None
            if data.get("status") in {"completed", "failed"}:
                return None
            return data
        except Exception as exc:
            logger.debug(f"Progress read failed: {exc}")
            return None

    async def _save_progress(
        self,
        data: Dict[str, Any],
        key: str = SYNC_PROGRESS_KEY,
        ttl: int = SYNC_PROGRESS_TTL,
    ) -> None:
        if not await self._ensure_redis():
            return
        data["updated_at"] = datetime.utcnow().isoformat()
        await self._cache_set_json(key, data, ttl=ttl, force=True)

    async def _clear_progress(self, key: str = SYNC_PROGRESS_KEY) -> None:
        if not await self._ensure_redis():
            return
        try:
            await redis_client.delete(key)
        except Exception:
            return

    async def _create_sync_record(self, sync_type: str, job_id: str, days: int) -> int:
        async with async_session_maker() as session:
            record = SyncStatus(
                sync_type=sync_type,
                status="running",
                started_at=datetime.utcnow(),
                success_count=0,
                error_count=0,
                additional_data={"job_id": job_id, "days": days},
            )
            session.add(record)
            await session.commit()
            await session.refresh(record)
            return record.id

    async def _update_sync_record(
        self,
        sync_id: int,
        status: Optional[str] = None,
        success_count: Optional[int] = None,
        error_count: Optional[int] = None,
        additional_data: Optional[Dict[str, Any]] = None,
        errors: Optional[Dict[str, Any]] = None,
    ) -> None:
        async with async_session_maker() as session:
            record = await session.get(SyncStatus, sync_id)
            if not record:
                return
            if status:
                record.status = status
                if status in {"completed", "failed", "partial"}:
                    record.completed_at = datetime.utcnow()
            if success_count is not None:
                record.success_count = success_count
            if error_count is not None:
                record.error_count = error_count
            if errors is not None:
                record.errors = errors
            if additional_data is not None:
                record.additional_data = additional_data
            await session.commit()

    async def _checkpoint(
        self,
        progress: Dict[str, Any],
        sync_id: int,
        key: str = SYNC_PROGRESS_KEY,
        ttl: int = SYNC_PROGRESS_TTL,
    ) -> None:
        await self._save_progress(progress, key=key, ttl=ttl)
        await self._update_sync_record(
            sync_id,
            success_count=progress.get("success_count", 0),
            error_count=progress.get("error_count", 0),
            additional_data=progress,
        )

    def _parse_time_value(self, value: Optional[str], default_value: str) -> time:
        raw = value or default_value
        try:
            hour, minute = raw.split(":")
            return time(hour=int(hour), minute=int(minute))
        except Exception:
            return time(hour=9, minute=0)

    def _is_market_hours(self, check_time: Optional[datetime] = None) -> bool:
        try:
            tz = ZoneInfo(settings.intraday_market_tz)
        except Exception:
            tz = ZoneInfo("Asia/Ho_Chi_Minh")

        now = check_time.astimezone(tz) if check_time else datetime.now(tz)
        if now.weekday() >= 5:
            return False

        market_open = self._parse_time_value(settings.intraday_market_open, "09:00")
        market_close = self._parse_time_value(settings.intraday_market_close, "15:00")
        break_start = (
            self._parse_time_value(settings.intraday_break_start, "11:30")
            if settings.intraday_break_start
            else None
        )
        break_end = (
            self._parse_time_value(settings.intraday_break_end, "13:00")
            if settings.intraday_break_end
            else None
        )

        current_time = now.time()
        if current_time < market_open or current_time > market_close:
            return False

        if break_start and break_end and break_start <= current_time <= break_end:
            return False

        return True

    def _is_after_market_close(self, check_time: Optional[datetime] = None) -> bool:
        try:
            tz = ZoneInfo(settings.intraday_market_tz)
        except Exception:
            tz = ZoneInfo("Asia/Ho_Chi_Minh")

        now = check_time.astimezone(tz) if check_time else datetime.now(tz)
        market_close = self._parse_time_value(settings.intraday_market_close, "15:00")
        return now.time() >= market_close

    def _get_market_date(self, check_time: Optional[datetime] = None) -> date:
        try:
            tz = ZoneInfo(settings.intraday_market_tz)
        except Exception:
            tz = ZoneInfo("Asia/Ho_Chi_Minh")

        now = check_time.astimezone(tz) if check_time else datetime.now(tz)
        return now.date()

    def _parse_date_value(self, value: Any) -> Optional[date]:
        if value is None:
            return None
        if isinstance(value, datetime):
            return value.date()
        if isinstance(value, date):
            return value
        if hasattr(pd, "Timestamp") and isinstance(value, pd.Timestamp):
            return value.to_pydatetime().date()
        raw = str(value).strip()
        if not raw:
            return None
        try:
            return datetime.fromisoformat(raw.replace("Z", "+00:00")).date()
        except ValueError:
            pass
        for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%Y/%m/%d", "%d-%m-%Y", "%Y%m%d"):
            try:
                return datetime.strptime(raw, fmt).date()
            except ValueError:
                continue
        return None

    def _parse_datetime_value(self, value: Any) -> Optional[datetime]:
        if value is None:
            return None
        if isinstance(value, datetime):
            return value
        if isinstance(value, date):
            return datetime.combine(value, time.min)
        if hasattr(pd, "Timestamp") and isinstance(value, pd.Timestamp):
            return value.to_pydatetime()
        raw = str(value).strip()
        if not raw:
            return None
        try:
            return datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            pass
        for fmt in (
            "%Y-%m-%d %H:%M:%S",
            "%Y-%m-%d %H:%M",
            "%d/%m/%Y %H:%M:%S",
            "%d/%m/%Y %H:%M",
            "%Y-%m-%d",
            "%d/%m/%Y",
        ):
            try:
                return datetime.strptime(raw, fmt)
            except ValueError:
                continue
        return None

    async def _get_or_create_company_id(self, session: AsyncSession, symbol: str) -> Optional[int]:
        result = await session.execute(select(Company.id).where(Company.symbol == symbol))
        company_id = result.scalar_one_or_none()
        if company_id:
            return company_id

        values = {
            "symbol": symbol,
            "updated_at": datetime.utcnow(),
        }
        stmt = get_upsert_stmt(Company, ["symbol"], values)
        await session.execute(stmt)
        await session.commit()

        result = await session.execute(select(Company.id).where(Company.symbol == symbol))
        return result.scalar_one_or_none()

    def _should_checkpoint(self, index: int, total: int) -> bool:
        every = max(1, settings.progress_checkpoint_every)
        return (index + 1) % every == 0 or index == total - 1

    def _normalize_exchange(self, exchange: Optional[str]) -> str:
        if not exchange:
            return "UNKNOWN"
        normalized = str(exchange).strip().upper()
        return normalized or "UNKNOWN"

    async def _get_exchange_and_chunk_index(
        self,
        symbols: List[str],
        chunk_size: int,
    ) -> Tuple[Dict[str, str], Dict[str, int]]:
        if not symbols:
            return {}, {}

        normalized_symbols = [str(symbol).upper() for symbol in symbols if symbol]
        if not normalized_symbols:
            return {}, {}

        async with async_session_maker() as session:
            result = await session.execute(
                select(Stock.symbol, Stock.exchange).where(Stock.symbol.in_(normalized_symbols))
            )
            exchange_map = {
                symbol: self._normalize_exchange(exchange) for symbol, exchange in result.fetchall()
            }

        exchange_groups: Dict[str, List[str]] = {}
        for symbol in normalized_symbols:
            exchange = exchange_map.get(symbol) or "UNKNOWN"
            exchange_groups.setdefault(exchange, []).append(symbol)

        chunk_index_map: Dict[str, int] = {}
        safe_chunk_size = max(1, chunk_size)
        for exchange, exchange_symbols in exchange_groups.items():
            for idx, symbol in enumerate(sorted(set(exchange_symbols))):
                chunk_index_map[symbol] = idx // safe_chunk_size

        return exchange_map, chunk_index_map

    async def _cache_chunked_records(
        self,
        key_prefix_parts: List[Union[str, int]],
        trade_date: date,
        records: List[Dict[str, Any]],
        symbol_exchange: Dict[str, str],
        symbol_chunk_index: Dict[str, int],
        ttl: int,
    ) -> None:
        if not records:
            return

        chunked: Dict[str, List[Dict[str, Any]]] = {}
        for record in records:
            symbol = record.get("symbol")
            if not symbol:
                continue
            symbol = str(symbol).upper()
            exchange = symbol_exchange.get(symbol) or "UNKNOWN"
            chunk_index = symbol_chunk_index.get(symbol, 0)
            cache_key = build_cache_key(
                *key_prefix_parts,
                trade_date.isoformat(),
                exchange,
                chunk_index,
            )
            chunked.setdefault(cache_key, []).append(record)

        for cache_key, payload in chunked.items():
            await self._cache_set_json(cache_key, payload, ttl)

    async def _upsert_chunked_record(
        self,
        key_prefix_parts: List[Union[str, int]],
        trade_date: date,
        record: Dict[str, Any],
        exchange: str,
        chunk_index: int,
        ttl: int,
    ) -> None:
        if not await self._ensure_redis():
            return

        cache_key = build_cache_key(
            *key_prefix_parts,
            trade_date.isoformat(),
            exchange,
            chunk_index,
        )

        existing = None
        try:
            existing = await redis_client.get_json(cache_key)
        except Exception as exc:
            logger.debug(f"Chunked cache read failed for {cache_key}: {exc}")

        payload: List[Dict[str, Any]] = []
        if isinstance(existing, list):
            payload = existing
            updated = False
            record_symbol = record.get("symbol")
            for idx, item in enumerate(payload):
                if isinstance(item, dict) and item.get("symbol") == record_symbol:
                    payload[idx] = record
                    updated = True
                    break
            if not updated:
                payload.append(record)
        else:
            payload = [record]

        await self._cache_set_json(cache_key, payload, ttl)

    @with_retry(max_retries=3)
    async def sync_stock_list(
        self,
        progress: Optional[Dict[str, Any]] = None,
        sync_id: Optional[int] = None,
    ) -> int:
        """Sync all stock symbols."""
        from vnstock import Listing

        logger.info("Syncing stock list...")
        listing_source = settings.vnstock_source or "KBS"
        try:
            listing = Listing(source=listing_source)
            df = listing.all_symbols()
            exchange_df = listing.symbols_by_exchange()
            industry_df = listing.symbols_by_industries()
        except SystemExit as exc:
            logger.warning(f"Listing source {listing_source} aborted: {exc}")
            return 0
        except Exception as e:
            logger.warning(f"Listing source {listing_source} failed: {e}.")
            return 0
        if df is None or df.empty:
            return 0

        def normalize_text(value: Any) -> Optional[str]:
            if value is None:
                return None
            if isinstance(value, float) and pd.isna(value):
                return None
            if isinstance(value, str):
                cleaned = value.strip()
                return cleaned or None
            return str(value)

        exchange_map: Dict[str, str] = {}
        if exchange_df is not None and not exchange_df.empty:
            for _, row in exchange_df.iterrows():
                symbol_value = normalize_text(row.get("symbol") or row.get("ticker"))
                exchange_value = normalize_text(row.get("exchange") or row.get("comGroupCode"))
                if symbol_value and exchange_value:
                    exchange_map[symbol_value.upper()] = exchange_value

        industry_map: Dict[str, str] = {}
        if industry_df is not None and not industry_df.empty:
            for _, row in industry_df.iterrows():
                symbol_value = normalize_text(row.get("symbol") or row.get("ticker"))
                industry_value = normalize_text(
                    row.get("industry")
                    or row.get("industry_name")
                    or row.get("industryName")
                    or row.get("icb_name3")
                )
                if symbol_value and industry_value:
                    industry_map[symbol_value.upper()] = industry_value

        start_index = 0
        symbols = df["symbol"].tolist() if "symbol" in df.columns else []
        if progress and progress.get("stage") == "stock_list":
            last_index = progress.get("last_index")
            last_symbol = progress.get("last_symbol")
            if isinstance(last_index, int) and last_index >= 0:
                start_index = last_index + 1
            elif last_symbol and last_symbol in symbols:
                start_index = symbols.index(last_symbol) + 1

        batch_size = 200
        cache_batch: List[Dict[str, Any]] = []

        if progress is not None:
            progress.setdefault("stage_stats", {})
            progress["stage"] = "stock_list"
            progress["stage_index"] = STAGE_ORDER.index("stock_list")
            progress["stage_stats"].setdefault(
                "stock_list",
                {"success": 0, "errors": 0, "total": len(df)},
            )

        async with async_session_maker() as session:
            count = 0
            for idx in range(start_index, len(df)):
                row = df.iloc[idx]
                symbol = str(row.get("symbol", row.get("ticker", ""))).upper()
                if not symbol:
                    continue

                exchange_value = normalize_text(
                    row.get("comGroupCode") or row.get("exchange")
                ) or exchange_map.get(symbol)
                industry_value = normalize_text(
                    row.get("industryName") or row.get("industry")
                ) or industry_map.get(symbol)

                values = {
                    "symbol": symbol,
                    "company_name": normalize_text(row.get("organName") or row.get("organ_name")),
                    "exchange": exchange_value or "UNKNOWN",
                    "industry": industry_value,
                    "is_active": 1,
                    "updated_at": datetime.utcnow(),
                }
                try:
                    stmt = get_upsert_stmt(Stock, ["symbol"], values)
                    await session.execute(stmt)
                    count += 1
                    cache_batch.append(
                        {
                            "symbol": symbol,
                            "company_name": values["company_name"],
                            "exchange": values["exchange"],
                            "industry": values["industry"],
                        }
                    )
                    if progress is not None:
                        progress["success_count"] = progress.get("success_count", 0) + 1
                        progress["stage_stats"]["stock_list"]["success"] += 1
                except Exception as exc:
                    logger.debug(f"Failed to upsert {symbol}: {exc}")
                    if progress is not None:
                        progress["error_count"] = progress.get("error_count", 0) + 1
                        progress["stage_stats"]["stock_list"]["errors"] += 1

                if count > 0 and count % batch_size == 0:
                    await session.commit()
                    for item in cache_batch:
                        cache_key = build_cache_key("vnibb", "listing", "symbol", item["symbol"])
                        await self._cache_set_json(cache_key, item, CACHE_TTL_LISTING)
                    cache_batch = []
                    if progress is not None and sync_id is not None:
                        progress["last_symbol"] = symbol
                        progress["last_index"] = idx
                        await self._checkpoint(progress, sync_id)

            await session.commit()
            for item in cache_batch:
                cache_key = build_cache_key("vnibb", "listing", "symbol", item["symbol"])
                await self._cache_set_json(cache_key, item, CACHE_TTL_LISTING)

            listing_cache = [
                {
                    "symbol": str(row.get("symbol", row.get("ticker", ""))).upper(),
                    "organ_name": row.get("organName") or row.get("organ_name"),
                    "exchange": (
                        row.get("comGroupCode")
                        or row.get("exchange")
                        or exchange_map.get(str(row.get("symbol", row.get("ticker", ""))).upper())
                    ),
                }
                for _, row in df.iterrows()
            ]
            list_cache_key = build_cache_key("vnibb", "listing", "symbols", listing_source)
            await self._cache_set_json(list_cache_key, listing_cache, CACHE_TTL_LISTING)

            if progress is not None and sync_id is not None:
                progress["last_symbol"] = None
                progress["last_index"] = None
                await self._checkpoint(progress, sync_id)

            logger.info(f"Synced {count} stocks.")
            return count

    @with_retry(max_retries=3)
    async def sync_screener_data(
        self,
        symbols: Optional[List[str]] = None,
        exchanges: Optional[List[str]] = None,
        limit: Optional[int] = None,
        progress: Optional[Dict[str, Any]] = None,
        sync_id: Optional[int] = None,
    ) -> int:
        """Sync comprehensive metrics for stocks using vnstock finance.ratio."""
        from vnstock import Listing, Vnstock

        logger.info("Syncing screener data...")
        loop = asyncio.get_running_loop()

        def _normalize_text(value: Any) -> Optional[str]:
            if value is None:
                return None
            if isinstance(value, float) and pd.isna(value):
                return None
            raw = str(value).strip()
            return raw or None

        def _parse_float(value: Any) -> Optional[float]:
            if value is None:
                return None
            if isinstance(value, float) and pd.isna(value):
                return None
            try:
                parsed = float(value)
                if pd.isna(parsed):
                    return None
                return parsed
            except (TypeError, ValueError):
                return None

        def _pick_float(*values: Any) -> Optional[float]:
            for value in values:
                parsed = _parse_float(value)
                if parsed is not None:
                    return parsed
            return None

        def _normalize_dividend_yield(value: Any) -> Optional[float]:
            parsed = _parse_float(value)
            if parsed is None:
                return None

            normalized = parsed
            while abs(normalized) > 100:
                normalized /= 100

            return normalized

        def _extract_listing_metadata(src: str) -> Dict[str, Dict[str, Any]]:
            metadata: Dict[str, Dict[str, Any]] = {}
            try:
                listing = Listing(source=src)
                df = listing.all_symbols()
                exchange_df = listing.symbols_by_exchange()
                industry_df = listing.symbols_by_industries()
            except Exception as listing_error:
                logger.debug("Listing metadata fetch failed: %s", listing_error)
                return metadata

            if df is None or df.empty:
                return metadata

            exchange_map: Dict[str, str] = {}
            if exchange_df is not None and not exchange_df.empty:
                for _, row in exchange_df.iterrows():
                    symbol_value = _normalize_text(row.get("symbol") or row.get("ticker"))
                    exchange_value = _normalize_text(row.get("exchange") or row.get("comGroupCode"))
                    if symbol_value and exchange_value:
                        exchange_map[symbol_value.upper()] = exchange_value

            industry_map: Dict[str, str] = {}
            if industry_df is not None and not industry_df.empty:
                for _, row in industry_df.iterrows():
                    symbol_value = _normalize_text(row.get("symbol") or row.get("ticker"))
                    industry_value = _normalize_text(
                        row.get("industry")
                        or row.get("industry_name")
                        or row.get("industryName")
                        or row.get("icb_name3")
                    )
                    if symbol_value and industry_value:
                        industry_map[symbol_value.upper()] = industry_value

            for _, row in df.iterrows():
                symbol_value = row.get("symbol", row.get("ticker"))
                symbol_key = _normalize_text(symbol_value)
                if not symbol_key:
                    continue

                symbol_upper = symbol_key.upper()
                company_name = _normalize_text(row.get("organ_name") or row.get("organName"))
                exchange_value = _normalize_text(
                    row.get("comGroupCode") or row.get("exchange") or row.get("com_group_code")
                ) or exchange_map.get(symbol_upper)
                industry_value = _normalize_text(
                    row.get("industryName") or row.get("industry")
                ) or industry_map.get(symbol_upper)
                market_cap_value = (
                    _parse_float(row.get("market_cap"))
                    or _parse_float(row.get("marketCap"))
                    or _parse_float(row.get("charter_capital"))
                )

                metadata[symbol_upper] = {
                    "company_name": company_name,
                    "exchange": exchange_value,
                    "industry": industry_value,
                    "market_cap": market_cap_value,
                }

            # Include exchange/industry entries not present in all_symbols payload.
            for symbol_upper, exchange_value in exchange_map.items():
                item = metadata.setdefault(
                    symbol_upper,
                    {
                        "company_name": None,
                        "exchange": None,
                        "industry": None,
                        "market_cap": None,
                    },
                )
                if not item.get("exchange"):
                    item["exchange"] = exchange_value

            for symbol_upper, industry_value in industry_map.items():
                item = metadata.setdefault(
                    symbol_upper,
                    {
                        "company_name": None,
                        "exchange": None,
                        "industry": None,
                        "market_cap": None,
                    },
                )
                if not item.get("industry"):
                    item["industry"] = industry_value

            return metadata

        normalized_exchanges: List[str] = []
        if exchanges:
            normalized_exchanges = [
                exchange.strip().upper()
                for exchange in exchanges
                if isinstance(exchange, str) and exchange.strip()
            ]

        if symbols:
            symbol_list = [
                symbol.strip().upper()
                for symbol in symbols
                if isinstance(symbol, str) and symbol.strip()
            ]
            deduped_symbols = list(dict.fromkeys(symbol_list))
        else:
            async with async_session_maker() as session:
                stmt = select(Stock.symbol).where(Stock.is_active == 1)
                if normalized_exchanges:
                    stmt = stmt.where(func.upper(Stock.exchange).in_(normalized_exchanges))
                result = await session.execute(stmt)
                deduped_symbols = [str(row[0]).upper() for row in result.fetchall() if row[0]]

        if limit is not None and limit > 0:
            deduped_symbols = deduped_symbols[:limit]

        if not deduped_symbols:
            logger.warning("No symbols found in database for screener sync.")
            return 0

        stock_metadata: Dict[str, Dict[str, Any]] = {}
        company_metadata: Dict[str, Dict[str, Any]] = {}
        async with async_session_maker() as session:
            rows = await session.execute(
                select(Stock.symbol, Stock.company_name, Stock.exchange, Stock.industry).where(
                    Stock.symbol.in_(deduped_symbols)
                )
            )
            for symbol, company_name, exchange_value, industry_value in rows.fetchall():
                stock_metadata[str(symbol).upper()] = {
                    "company_name": _normalize_text(company_name),
                    "exchange": _normalize_text(exchange_value),
                    "industry": _normalize_text(industry_value),
                }

            company_rows = await session.execute(
                select(
                    Company.symbol,
                    Company.company_name,
                    Company.exchange,
                    Company.industry,
                    Company.outstanding_shares,
                    Company.listed_shares,
                ).where(Company.symbol.in_(deduped_symbols))
            )
            for (
                symbol,
                company_name,
                exchange_value,
                industry_value,
                outstanding_shares,
                listed_shares,
            ) in company_rows.fetchall():
                company_metadata[str(symbol).upper()] = {
                    "company_name": _normalize_text(company_name),
                    "exchange": _normalize_text(exchange_value),
                    "industry": _normalize_text(industry_value),
                    "outstanding_shares": _parse_float(outstanding_shares),
                    "listed_shares": _parse_float(listed_shares),
                }

        primary_source = (settings.vnstock_source or "KBS").upper()
        listing_metadata = await loop.run_in_executor(
            None, _extract_listing_metadata, primary_source
        )

        start_index = 0
        if progress and progress.get("stage") == "screener":
            last_index = progress.get("last_index")
            last_symbol = progress.get("last_symbol")
            if isinstance(last_index, int) and last_index >= 0:
                start_index = last_index + 1
            elif last_symbol and last_symbol in deduped_symbols:
                start_index = deduped_symbols.index(last_symbol) + 1

        ratio_sources = [primary_source]
        batch_size = 20
        cache_batch: List[Dict[str, Any]] = []
        today = date.today()

        previous_snapshot_fallback: Dict[str, Dict[str, Any]] = {}
        latest_price_fallback: Dict[str, Dict[str, Optional[float]]] = {}
        async with async_session_maker() as session:
            previous_date_result = await session.execute(
                select(func.max(ScreenerSnapshot.snapshot_date)).where(
                    ScreenerSnapshot.snapshot_date < today
                )
            )
            previous_snapshot_date = previous_date_result.scalar()
            if previous_snapshot_date:
                previous_rows = await session.execute(
                    select(
                        ScreenerSnapshot.symbol,
                        ScreenerSnapshot.company_name,
                        ScreenerSnapshot.exchange,
                        ScreenerSnapshot.industry,
                        ScreenerSnapshot.price,
                        ScreenerSnapshot.volume,
                        ScreenerSnapshot.market_cap,
                    ).where(
                        ScreenerSnapshot.snapshot_date == previous_snapshot_date,
                        ScreenerSnapshot.symbol.in_(deduped_symbols),
                    )
                )
                for row in previous_rows.fetchall():
                    previous_snapshot_fallback[str(row.symbol).upper()] = {
                        "company_name": row.company_name,
                        "exchange": row.exchange,
                        "industry": row.industry,
                        "price": row.price,
                        "volume": row.volume,
                        "market_cap": row.market_cap,
                    }

            latest_price_subquery = (
                select(
                    StockPrice.symbol.label("symbol"),
                    func.max(StockPrice.time).label("latest_time"),
                )
                .where(
                    StockPrice.interval == "1D",
                    StockPrice.symbol.in_(deduped_symbols),
                )
                .group_by(StockPrice.symbol)
                .subquery()
            )
            latest_price_rows = await session.execute(
                select(StockPrice.symbol, StockPrice.close, StockPrice.volume).join(
                    latest_price_subquery,
                    and_(
                        StockPrice.symbol == latest_price_subquery.c.symbol,
                        StockPrice.time == latest_price_subquery.c.latest_time,
                        StockPrice.interval == "1D",
                    ),
                )
            )
            for row in latest_price_rows.fetchall():
                latest_price_fallback[str(row.symbol).upper()] = {
                    "price": _parse_float(row.close),
                    "volume": _parse_float(row.volume),
                }

        if progress is not None:
            progress.setdefault("stage_stats", {})
            progress["stage"] = "screener"
            progress["stage_index"] = STAGE_ORDER.index("screener")
            progress["stage_stats"].setdefault(
                "screener",
                {"success": 0, "errors": 0, "total": len(deduped_symbols)},
            )

        async with async_session_maker() as session:
            count = 0
            for idx in range(start_index, len(deduped_symbols)):
                symbol = deduped_symbols[idx]
                await self._wait_for_rate_limit("screener")
                try:
                    ratio_df = None
                    for ratio_source in ratio_sources:
                        try:

                            def _fetch_ratio_snapshot(sym: str, src: str):
                                stock = Vnstock().stock(symbol=sym, source=src)
                                df = stock.finance.ratio(period="year")
                                if df is None or df.empty:
                                    return None

                                # Row-based format (item/item_id/year columns)
                                if "item_id" in df.columns:
                                    records = df.to_dict("records")
                                    year_cols = sorted(
                                        [
                                            str(column)
                                            for column in df.columns
                                            if re.fullmatch(r"20\d{2}", str(column))
                                        ],
                                        reverse=True,
                                    )
                                    if not year_cols:
                                        return None
                                    latest_year = year_cols[0]
                                    ratio_row: Dict[str, Any] = {"year_report": int(latest_year)}
                                    metric_map = {
                                        "p_e": "pe",
                                        "p_b": "pb",
                                        "p_s": "ps",
                                        "roe": "roe",
                                        "roa": "roa",
                                        "trailing_eps": "eps",
                                    }
                                    liabilities = None
                                    owners_equity = None
                                    for record in records:
                                        item_id = record.get("item_id")
                                        if not item_id:
                                            continue
                                        value = record.get(latest_year)
                                        if value is None:
                                            continue
                                        if item_id in metric_map:
                                            ratio_row[metric_map[item_id]] = value
                                        elif item_id == "liabilities":
                                            liabilities = value
                                        elif item_id == "owners_equity":
                                            owners_equity = value
                                    if liabilities is not None and owners_equity not in (None, 0):
                                        ratio_row["de"] = liabilities / owners_equity
                                else:
                                    # Legacy format
                                    ratio_row = df.iloc[0].to_dict()

                                try:
                                    end_date = datetime.now()
                                    start_date = end_date - timedelta(days=10)
                                    history = stock.quote.history(
                                        start=start_date.strftime("%Y-%m-%d"),
                                        end=end_date.strftime("%Y-%m-%d"),
                                    )
                                    if history is not None and not history.empty:
                                        latest = history.iloc[-1]
                                        ratio_row["price"] = latest.get("close")
                                        ratio_row["volume"] = latest.get("volume")
                                except Exception:
                                    # Price enrichment is best-effort only
                                    pass

                                return ratio_row

                            ratio_df = await asyncio.wait_for(
                                loop.run_in_executor(
                                    None, _fetch_ratio_snapshot, symbol, ratio_source
                                ),
                                timeout=settings.vnstock_timeout,
                            )
                            if ratio_df:
                                break
                        except asyncio.TimeoutError:
                            logger.warning(f"Ratio summary timed out for {symbol} ({ratio_source})")
                        except SystemExit as exc:
                            logger.warning(
                                f"Ratio summary aborted for {symbol} ({ratio_source}): {exc}"
                            )
                        except Exception as ratio_error:
                            logger.debug(
                                f"Ratio summary failed for {symbol} with {ratio_source}: {ratio_error}"
                            )

                    row = ratio_df or {}
                    stock_row = stock_metadata.get(symbol, {})
                    company_row = company_metadata.get(symbol, {})
                    listing_row = listing_metadata.get(symbol, {})
                    previous_row = previous_snapshot_fallback.get(symbol, {})
                    latest_price_row = latest_price_fallback.get(symbol, {})

                    price_value = (
                        _parse_float(row.get("price"))
                        or _parse_float(previous_row.get("price"))
                        or _parse_float(latest_price_row.get("price"))
                    )
                    volume_value = (
                        _parse_float(row.get("volume"))
                        or _parse_float(previous_row.get("volume"))
                        or _parse_float(latest_price_row.get("volume"))
                    )
                    market_cap_value = (
                        _parse_float(row.get("market_cap"))
                        or _parse_float(row.get("marketCap"))
                        or _parse_float(row.get("charter_capital"))
                        or _parse_float(listing_row.get("market_cap"))
                        or _parse_float(previous_row.get("market_cap"))
                    )

                    shares_for_market_cap = company_row.get("outstanding_shares")
                    if not shares_for_market_cap:
                        shares_for_market_cap = company_row.get("listed_shares")
                    if not shares_for_market_cap:
                        shares_for_market_cap = _parse_float(row.get("shares_outstanding"))

                    if not market_cap_value and shares_for_market_cap and price_value:
                        market_cap_value = float(shares_for_market_cap) * float(price_value)

                    extended_metrics = {
                        "debt_to_asset": _parse_float(
                            row.get("debt_to_asset")
                            or row.get("debtOnAsset")
                            or row.get("debt_on_asset")
                        ),
                        "days_receivable": _parse_float(
                            row.get("days_receivable")
                            or row.get("daysReceivable")
                            or row.get("dso")
                        ),
                        "days_payable": _parse_float(
                            row.get("days_payable") or row.get("daysPayable") or row.get("dpo")
                        ),
                        "equity_on_total_asset": _parse_float(
                            row.get("equity_on_total_asset") or row.get("equityOnTotalAsset")
                        ),
                        "revenue_on_asset": _parse_float(
                            row.get("revenue_on_asset")
                            or row.get("revenueOnAsset")
                            or row.get("asset_turnover")
                            or row.get("at")
                        ),
                    }
                    extended_metrics = {
                        key: value for key, value in extended_metrics.items() if value is not None
                    }

                    values = {
                        "symbol": symbol,
                        "snapshot_date": today,
                        "company_name": (
                            _normalize_text(
                                row.get("company_name")
                                or row.get("organ_name")
                                or row.get("organName")
                            )
                            or stock_row.get("company_name")
                            or company_row.get("company_name")
                            or listing_row.get("company_name")
                            or previous_row.get("company_name")
                        ),
                        "exchange": (
                            _normalize_text(row.get("exchange"))
                            or stock_row.get("exchange")
                            or company_row.get("exchange")
                            or listing_row.get("exchange")
                            or previous_row.get("exchange")
                        ),
                        "industry": (
                            _normalize_text(
                                row.get("industry")
                                or row.get("industry_name")
                                or row.get("industryName")
                            )
                            or stock_row.get("industry")
                            or company_row.get("industry")
                            or listing_row.get("industry")
                            or previous_row.get("industry")
                        ),
                        "price": price_value,
                        "volume": volume_value,
                        "market_cap": market_cap_value,
                        "pe": _parse_float(
                            row.get("pe") or row.get("pe_ratio") or row.get("priceToEarning")
                        ),
                        "pb": _parse_float(row.get("pb") or row.get("priceToBook")),
                        "ps": _parse_float(row.get("ps") or row.get("priceToSales")),
                        "ev_ebitda": _parse_float(
                            row.get("ev_ebitda")
                            or row.get("value_before_ebitda")
                            or row.get("evToEbitda")
                        ),
                        "roe": _parse_float(row.get("roe")),
                        "roa": _parse_float(row.get("roa")),
                        "roic": _parse_float(row.get("roic")),
                        "gross_margin": _parse_float(
                            row.get("gross_margin") or row.get("grossProfitMargin")
                        ),
                        "net_margin": _parse_float(
                            row.get("net_margin")
                            or row.get("netProfitMargin")
                            or row.get("postTaxMargin")
                        ),
                        "operating_margin": _parse_float(
                            row.get("operating_margin")
                            or row.get("operatingMargin")
                            or row.get("operatingProfitMargin")
                        ),
                        "revenue_growth": _parse_float(
                            row.get("revenue_growth") or row.get("revenueGrowth")
                        ),
                        "earnings_growth": _parse_float(
                            row.get("earnings_growth")
                            or row.get("earningsGrowth")
                            or row.get("net_profit_growth")
                            or row.get("netProfitGrowth")
                        ),
                        "dividend_yield": _normalize_dividend_yield(
                            row.get("dividend_yield")
                            or row.get("dividendYield")
                            or row.get("dividend")
                        ),
                        "debt_to_equity": _parse_float(row.get("de") or row.get("debt_to_equity")),
                        "current_ratio": _parse_float(row.get("current_ratio")),
                        "quick_ratio": _parse_float(row.get("quick_ratio")),
                        "eps": _parse_float(row.get("eps")),
                        "bvps": _parse_float(row.get("bvps") or row.get("book_value_per_share")),
                        "foreign_ownership": _parse_float(
                            row.get("foreign_ownership") or row.get("foreignOwnership")
                        ),
                        "extended_metrics": extended_metrics or None,
                        "source": "vnstock_ratio",
                        "created_at": datetime.utcnow(),
                    }
                    stmt = get_upsert_stmt(ScreenerSnapshot, ["symbol", "snapshot_date"], values)
                    await session.execute(stmt)
                    count += 1

                    previous_snapshot_fallback[symbol] = {
                        "company_name": values.get("company_name"),
                        "exchange": values.get("exchange"),
                        "industry": values.get("industry"),
                        "price": values.get("price"),
                        "volume": values.get("volume"),
                        "market_cap": values.get("market_cap"),
                    }

                    cache_batch.append(
                        {
                            "symbol": symbol,
                            "snapshot_date": today.isoformat(),
                            "company_name": values.get("company_name"),
                            "price": values.get("price"),
                            "market_cap": values.get("market_cap"),
                            "pe": values.get("pe"),
                            "pb": values.get("pb"),
                            "roe": values.get("roe"),
                            "roa": values.get("roa"),
                            "roic": values.get("roic"),
                            "gross_margin": values.get("gross_margin"),
                            "net_margin": values.get("net_margin"),
                            "operating_margin": values.get("operating_margin"),
                            "revenue_growth": values.get("revenue_growth"),
                            "earnings_growth": values.get("earnings_growth"),
                            "dividend_yield": values.get("dividend_yield"),
                            "industry": values.get("industry"),
                            "eps": values.get("eps"),
                            "bvps": values.get("bvps"),
                        }
                    )
                    if progress is not None:
                        progress["success_count"] = progress.get("success_count", 0) + 1
                        progress["stage_stats"]["screener"]["success"] += 1
                except Exception as ratio_error:
                    logger.debug(f"Ratio summary failed for {symbol}: {ratio_error}")
                    if progress is not None:
                        progress["error_count"] = progress.get("error_count", 0) + 1
                        progress["stage_stats"]["screener"]["errors"] += 1

                if count % batch_size == 0:
                    await session.commit()
                    for item in cache_batch:
                        cache_key = build_cache_key("vnibb", "screener", "latest", item["symbol"])
                        await self._cache_set_json(cache_key, item, CACHE_TTL_SCREENER)
                    cache_batch = []
                    if progress is not None and sync_id is not None:
                        progress["last_symbol"] = symbol
                        progress["last_index"] = idx
                        await self._checkpoint(progress, sync_id)

            await session.commit()
            for item in cache_batch:
                cache_key = build_cache_key("vnibb", "screener", "latest", item["symbol"])
                await self._cache_set_json(cache_key, item, CACHE_TTL_SCREENER)

            backfilled_rows = 0
            pending_rows = (
                (
                    await session.execute(
                        select(ScreenerSnapshot)
                        .where(
                            ScreenerSnapshot.snapshot_date == today,
                            or_(
                                ScreenerSnapshot.revenue_growth.is_(None),
                                ScreenerSnapshot.earnings_growth.is_(None),
                                ScreenerSnapshot.operating_margin.is_(None),
                                ScreenerSnapshot.dividend_yield.is_(None),
                                ScreenerSnapshot.ev_ebitda.is_(None),
                            ),
                        )
                        .limit(500)
                    )
                )
                .scalars()
                .all()
            )

            for screener_row in pending_rows:
                ratio = (
                    await session.execute(
                        select(FinancialRatio)
                        .where(FinancialRatio.symbol == screener_row.symbol)
                        .order_by(
                            FinancialRatio.fiscal_year.desc(),
                            FinancialRatio.fiscal_quarter.desc(),
                        )
                        .limit(1)
                    )
                ).scalar_one_or_none()
                if ratio is None:
                    continue

                ratio_payload = ratio.raw_data if isinstance(ratio.raw_data, dict) else {}
                changed = False

                if screener_row.revenue_growth is None:
                    revenue_growth_value = _pick_float(
                        ratio.revenue_growth,
                        ratio_payload.get("revenue_growth"),
                        ratio_payload.get("revenueGrowth"),
                    )
                    if revenue_growth_value is not None:
                        screener_row.revenue_growth = revenue_growth_value
                        changed = True

                if screener_row.earnings_growth is None:
                    earnings_growth_value = _pick_float(
                        ratio.earnings_growth,
                        ratio_payload.get("earnings_growth"),
                        ratio_payload.get("earningsGrowth"),
                    )
                    if earnings_growth_value is not None:
                        screener_row.earnings_growth = earnings_growth_value
                        changed = True

                if screener_row.operating_margin is None:
                    operating_margin_value = _pick_float(
                        ratio.operating_margin,
                        ratio_payload.get("operating_margin"),
                        ratio_payload.get("operatingMargin"),
                    )
                    if operating_margin_value is not None:
                        screener_row.operating_margin = operating_margin_value
                        changed = True

                if screener_row.dividend_yield is None:
                    dividend_yield_value = _normalize_dividend_yield(
                        _pick_float(
                            ratio_payload.get("dividend_yield"),
                            ratio_payload.get("dividendYield"),
                        )
                    )
                    if dividend_yield_value is None:
                        dps_value = _pick_float(
                            ratio.dps,
                            ratio_payload.get("dps"),
                            ratio_payload.get("dividends_per_share"),
                        )
                        price_value = _pick_float(screener_row.price)
                        if dps_value is not None and price_value not in (None, 0):
                            dividend_yield_value = _normalize_dividend_yield(
                                (dps_value / price_value) * 100
                            )

                    if dividend_yield_value is not None:
                        screener_row.dividend_yield = dividend_yield_value
                        changed = True

                if screener_row.ev_ebitda is None:
                    ev_ebitda_value = _pick_float(
                        ratio.ev_ebitda,
                        ratio_payload.get("ev_ebitda"),
                        ratio_payload.get("evToEbitda"),
                    )
                    if ev_ebitda_value is not None:
                        screener_row.ev_ebitda = ev_ebitda_value
                        changed = True

                if screener_row.debt_to_equity is None:
                    debt_to_equity_value = _pick_float(
                        ratio.debt_to_equity,
                        ratio_payload.get("debt_to_equity"),
                        ratio_payload.get("de"),
                    )
                    if debt_to_equity_value is not None:
                        screener_row.debt_to_equity = debt_to_equity_value
                        changed = True

                debt_to_asset_value = _pick_float(
                    ratio.debt_to_assets,
                    ratio_payload.get("debt_assets"),
                    ratio_payload.get("debt_to_assets"),
                    ratio_payload.get("debt_to_asset"),
                )
                extended_metrics = dict(screener_row.extended_metrics or {})

                def _set_extended_metric(key: str, value: Optional[float]) -> None:
                    nonlocal changed
                    if value is None:
                        return
                    if extended_metrics.get(key) is not None:
                        return
                    extended_metrics[key] = value
                    changed = True

                _set_extended_metric("debt_to_asset", debt_to_asset_value)
                _set_extended_metric(
                    "days_receivable",
                    _pick_float(
                        ratio_payload.get("days_receivable"),
                        ratio_payload.get("daysReceivable"),
                        ratio_payload.get("dso"),
                    ),
                )
                _set_extended_metric(
                    "days_payable",
                    _pick_float(
                        ratio_payload.get("days_payable"),
                        ratio_payload.get("daysPayable"),
                        ratio_payload.get("dpo"),
                    ),
                )
                _set_extended_metric(
                    "equity_on_total_asset",
                    _pick_float(
                        ratio_payload.get("equity_on_total_asset"),
                        ratio_payload.get("equityOnTotalAsset"),
                    ),
                )
                _set_extended_metric(
                    "revenue_on_asset",
                    _pick_float(
                        ratio_payload.get("revenue_on_asset"),
                        ratio_payload.get("revenueOnAsset"),
                        ratio_payload.get("asset_turnover"),
                        ratio_payload.get("at"),
                    ),
                )

                if extended_metrics:
                    screener_row.extended_metrics = extended_metrics

                if changed:
                    backfilled_rows += 1

            if backfilled_rows:
                await session.commit()
                logger.info("Back-filled %d screener rows from financial ratios", backfilled_rows)

            if progress is not None and sync_id is not None:
                progress["last_symbol"] = None
                progress["last_index"] = None
                await self._checkpoint(progress, sync_id)

            logger.info(f"Synced {count} screener snapshots via ratio summary")
            return count

    async def sync_daily_prices(
        self,
        symbols: List[str] = None,
        days: int = 30,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        progress: Optional[Dict[str, Any]] = None,
        sync_id: Optional[int] = None,
        cache_recent: bool = True,
    ) -> int:
        """Sync historical prices for specified symbols."""
        if not symbols:
            async with async_session_maker() as session:
                result = await session.execute(select(Stock.symbol).where(Stock.is_active == 1))
                symbols = [r[0] for r in result.fetchall()]

        resolved_end = end_date or date.today()
        resolved_start = start_date or (resolved_end - timedelta(days=days))
        if resolved_start > resolved_end:
            resolved_start, resolved_end = resolved_end, resolved_start

        start_date_str = resolved_start.strftime("%Y-%m-%d")
        end_date_str = resolved_end.strftime("%Y-%m-%d")
        effective_days = max((resolved_end - resolved_start).days, 0)
        logger.info(
            f"Syncing prices for {len(symbols)} symbols over {effective_days} days "
            f"({start_date_str} to {end_date_str})..."
        )

        start_index = 0
        if progress and progress.get("stage") == "prices":
            last_symbol = progress.get("last_symbol")
            if last_symbol and last_symbol in symbols:
                start_index = symbols.index(last_symbol) + 1

        if progress is not None:
            progress.setdefault("stage_stats", {})
            progress["stage"] = "prices"
            progress["stage_index"] = STAGE_ORDER.index("prices")
            progress["stage_stats"].setdefault(
                "prices",
                {"success": 0, "errors": 0, "total": len(symbols)},
            )

        total_synced = 0
        for idx in range(start_index, len(symbols)):
            symbol = symbols[idx]
            await self._wait_for_rate_limit("prices")
            try:
                from vnstock import Vnstock

                stock = Vnstock().stock(symbol=symbol, source=settings.vnstock_source)
                df = stock.quote.history(start=start_date_str, end=end_date_str)
                if df is not None and not df.empty:
                    async with async_session_maker() as session:
                        # Get stock ID for foreign key
                        res = await session.execute(select(Stock.id).where(Stock.symbol == symbol))
                        stock_id = res.scalar()
                        if not stock_id:
                            continue

                        for _, row in df.iterrows():
                            val = {
                                "stock_id": stock_id,
                                "symbol": symbol,
                                "time": row["time"].date()
                                if hasattr(row["time"], "date")
                                else row["time"],
                                "open": float(row["open"]),
                                "high": float(row["high"]),
                                "low": float(row["low"]),
                                "close": float(row["close"]),
                                "volume": int(row["volume"]),
                                "interval": "1D",
                                "source": "vnstock",
                            }
                            stmt = get_upsert_stmt(StockPrice, ["symbol", "time", "interval"], val)
                            await session.execute(stmt)
                        await session.commit()
                        total_synced += len(df)

                    latest = df.iloc[-1].to_dict()
                    latest_payload = {
                        "symbol": symbol,
                        "time": str(latest.get("time")),
                        "open": float(latest.get("open")),
                        "high": float(latest.get("high")),
                        "low": float(latest.get("low")),
                        "close": float(latest.get("close")),
                        "volume": int(latest.get("volume")),
                        "interval": "1D",
                    }
                    latest_key = build_cache_key("vnibb", "price", "latest", symbol)
                    await self._cache_set_json(latest_key, latest_payload, CACHE_TTL_PRICE_LATEST)

                    if cache_recent:
                        recent_rows = df.tail(RECENT_PRICE_DAYS).to_dict(orient="records")
                        recent_key = build_cache_key("vnibb", "price", "recent", symbol)
                        await self._cache_set_json(recent_key, recent_rows, CACHE_TTL_PRICE_RECENT)

                    if progress is not None:
                        progress["success_count"] = progress.get("success_count", 0) + 1
                        progress["stage_stats"]["prices"]["success"] += 1
            except SystemExit as exc:
                logger.warning(f"Price sync aborted for {symbol}: {exc}")
                if progress is not None:
                    progress["error_count"] = progress.get("error_count", 0) + 1
                    progress["stage_stats"]["prices"]["errors"] += 1
                continue
            except Exception as e:
                logger.error(f"Failed to sync prices for {symbol}: {e}")
                if progress is not None:
                    progress["error_count"] = progress.get("error_count", 0) + 1
                    progress["stage_stats"]["prices"]["errors"] += 1
                continue

            if progress is not None and sync_id is not None:
                progress["last_symbol"] = symbol
                if self._should_checkpoint(idx, len(symbols)):
                    await self._checkpoint(progress, sync_id)

        return total_synced

    async def cleanup_price_history(self, retain_years: Optional[int] = None) -> int:
        retain_years = retain_years or settings.price_history_years
        cutoff = date.today() - timedelta(days=retain_years * 365)
        async with async_session_maker() as session:
            result = await session.execute(
                text("DELETE FROM stock_prices WHERE time < :cutoff"),
                {"cutoff": cutoff},
            )
            await session.commit()
            return result.rowcount or 0

    async def cleanup_screener_snapshots(self, retain_days: Optional[int] = None) -> int:
        retain_days = retain_days if retain_days is not None else settings.screener_retention_days
        if retain_days <= 0:
            return 0
        cutoff = self._get_market_date() - timedelta(days=retain_days)
        async with async_session_maker() as session:
            result = await session.execute(
                delete(ScreenerSnapshot).where(ScreenerSnapshot.snapshot_date < cutoff)
            )
            await session.commit()
            return result.rowcount or 0

    async def cleanup_company_news(self, retain_days: Optional[int] = None) -> int:
        retain_days = retain_days if retain_days is not None else settings.news_retention_days
        if retain_days <= 0:
            return 0
        cutoff_date = self._get_market_date() - timedelta(days=retain_days)
        cutoff_dt = datetime.combine(cutoff_date, time.min)
        async with async_session_maker() as session:
            result = await session.execute(
                delete(CompanyNews).where(
                    func.coalesce(CompanyNews.published_date, CompanyNews.created_at) < cutoff_dt
                )
            )
            await session.commit()
            return result.rowcount or 0

    async def cleanup_intraday_trades(self, retain_days: Optional[int] = None) -> int:
        retain_days = retain_days if retain_days is not None else settings.intraday_retention_days
        if retain_days <= 0:
            return 0
        cutoff_date = self._get_market_date() - timedelta(days=retain_days)
        cutoff_dt = datetime.combine(cutoff_date, time.min)
        async with async_session_maker() as session:
            result = await session.execute(
                delete(IntradayTrade).where(IntradayTrade.trade_time < cutoff_dt)
            )
            await session.commit()
            return result.rowcount or 0

    async def cleanup_orderbook_snapshots(self, retain_days: Optional[int] = None) -> int:
        retain_days = retain_days if retain_days is not None else settings.orderbook_retention_days
        if retain_days <= 0:
            return 0
        cutoff_date = self._get_market_date() - timedelta(days=retain_days)
        cutoff_dt = datetime.combine(cutoff_date, time.min)
        async with async_session_maker() as session:
            result = await session.execute(
                delete(OrderbookSnapshot).where(OrderbookSnapshot.snapshot_time < cutoff_dt)
            )
            await session.commit()
            return result.rowcount or 0

    async def cleanup_block_trades(self, retain_days: Optional[int] = None) -> int:
        retain_days = (
            retain_days if retain_days is not None else settings.block_trades_retention_days
        )
        if retain_days <= 0:
            return 0
        cutoff_date = self._get_market_date() - timedelta(days=retain_days)
        cutoff_dt = datetime.combine(cutoff_date, time.min)
        async with async_session_maker() as session:
            result = await session.execute(
                delete(BlockTrade).where(BlockTrade.trade_time < cutoff_dt)
            )
            await session.commit()
            return result.rowcount or 0

    async def cleanup_foreign_trading(self, retain_years: Optional[int] = None) -> int:
        retain_years = retain_years or settings.foreign_trading_retention_years
        if retain_years <= 0:
            return 0
        cutoff = self._get_market_date() - timedelta(days=retain_years * 365)
        async with async_session_maker() as session:
            result = await session.execute(
                delete(ForeignTrading).where(ForeignTrading.trade_date < cutoff)
            )
            await session.commit()
            return result.rowcount or 0

    async def cleanup_order_flow_daily(self, retain_years: Optional[int] = None) -> int:
        retain_years = retain_years or settings.order_flow_retention_years
        if retain_years <= 0:
            return 0
        cutoff = self._get_market_date() - timedelta(days=retain_years * 365)
        async with async_session_maker() as session:
            result = await session.execute(
                delete(OrderFlowDaily).where(OrderFlowDaily.trade_date < cutoff)
            )
            await session.commit()
            return result.rowcount or 0

    async def run_retention_cleanup(self, include_price_history: bool = True) -> Dict[str, int]:
        results: Dict[str, int] = {}

        cleanup_actions: List[Tuple[str, Any]] = [
            ("screener_snapshots", self.cleanup_screener_snapshots),
            ("company_news", self.cleanup_company_news),
            ("intraday_trades", self.cleanup_intraday_trades),
            ("orderbook_snapshots", self.cleanup_orderbook_snapshots),
            ("block_trades", self.cleanup_block_trades),
            ("foreign_trading", self.cleanup_foreign_trading),
            ("order_flow_daily", self.cleanup_order_flow_daily),
        ]

        if include_price_history:
            cleanup_actions.insert(0, ("stock_prices", self.cleanup_price_history))

        for label, action in cleanup_actions:
            try:
                removed = await action()
                if removed:
                    results[label] = removed
            except Exception as exc:
                logger.warning(f"Retention cleanup failed for {label}: {exc}")

        return results

    async def sync_company_profiles(
        self,
        symbols: List[str] = None,
        progress: Optional[Dict[str, Any]] = None,
        sync_id: Optional[int] = None,
    ) -> int:
        """Sync company basic info for specified symbols."""
        if not symbols:
            async with async_session_maker() as session:
                result = await session.execute(select(Stock.symbol).where(Stock.is_active == 1))
                symbols = [r[0] for r in result.fetchall()]

        logger.info(f"Syncing company profiles for {len(symbols)} symbols...")
        start_index = 0
        if progress and progress.get("stage") == "profiles":
            last_symbol = progress.get("last_symbol")
            if last_symbol and last_symbol in symbols:
                start_index = symbols.index(last_symbol) + 1

        if progress is not None:
            progress.setdefault("stage_stats", {})
            progress["stage"] = "profiles"
            progress["stage_index"] = STAGE_ORDER.index("profiles")
            progress["stage_stats"].setdefault(
                "profiles",
                {"success": 0, "errors": 0, "total": len(symbols)},
            )

        def _normalize_text(value: Any) -> Optional[str]:
            if value is None:
                return None
            if isinstance(value, float) and pd.isna(value):
                return None
            raw = str(value).strip()
            return raw or None

        def _parse_float(value: Any) -> Optional[float]:
            if value is None:
                return None
            if isinstance(value, float) and pd.isna(value):
                return None
            try:
                parsed = float(value)
                if pd.isna(parsed):
                    return None
                return parsed
            except (TypeError, ValueError):
                return None

        def _parse_date(value: Any) -> Optional[date]:
            if value is None:
                return None
            if isinstance(value, date) and not isinstance(value, datetime):
                return value
            if isinstance(value, datetime):
                return value.date()

            raw = str(value).strip()
            if not raw:
                return None

            for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%Y/%m/%d"):
                try:
                    return datetime.strptime(raw, fmt).date()
                except ValueError:
                    continue

            try:
                return datetime.fromisoformat(raw.replace("Z", "+00:00")).date()
            except ValueError:
                return None

        total = 0
        for idx in range(start_index, len(symbols)):
            symbol = symbols[idx]
            await self._wait_for_rate_limit("profiles")
            try:
                from vnstock import Vnstock

                stock = Vnstock().stock(symbol=symbol, source=settings.vnstock_source)

                overview_row: Dict[str, Any] = {}
                profile_row: Dict[str, Any] = {}

                try:
                    overview_df = stock.company.overview()
                    if overview_df is not None and not overview_df.empty:
                        overview_row = overview_df.iloc[0].to_dict()
                except Exception as overview_error:
                    logger.debug("Overview fetch failed for %s: %s", symbol, overview_error)

                try:
                    profile_df = stock.company.profile()
                    if profile_df is not None and not profile_df.empty:
                        profile_row = profile_df.iloc[0].to_dict()
                except Exception as profile_error:
                    logger.debug("Profile fetch failed for %s: %s", symbol, profile_error)

                merged_row = {**profile_row, **overview_row}
                if not merged_row:
                    if progress is not None:
                        progress["error_count"] = progress.get("error_count", 0) + 1
                        progress["stage_stats"]["profiles"]["errors"] += 1
                    continue

                values = {
                    "symbol": symbol,
                    "company_name": _normalize_text(
                        merged_row.get("company_name")
                        or merged_row.get("organ_name")
                        or merged_row.get("organName")
                        or merged_row.get("companyName")
                    ),
                    "short_name": _normalize_text(
                        merged_row.get("short_name")
                        or merged_row.get("organ_short_name")
                        or merged_row.get("organShortName")
                        or merged_row.get("shortName")
                    ),
                    "english_name": _normalize_text(
                        merged_row.get("english_name")
                        or merged_row.get("en_organ_name")
                        or merged_row.get("enOrganName")
                    ),
                    "exchange": _normalize_text(
                        merged_row.get("exchange") or merged_row.get("comGroupCode")
                    ),
                    "industry": _normalize_text(
                        merged_row.get("industry")
                        or merged_row.get("industry_name")
                        or merged_row.get("industryName")
                        or merged_row.get("icb_name3")
                    ),
                    "sector": _normalize_text(
                        merged_row.get("sector")
                        or merged_row.get("icb_name2")
                        or merged_row.get("icbName2")
                        or merged_row.get("icb_name1")
                        or merged_row.get("icbName1")
                    ),
                    "subsector": _normalize_text(
                        merged_row.get("subsector")
                        or merged_row.get("icb_name4")
                        or merged_row.get("icbName4")
                    ),
                    "established_date": _parse_date(
                        merged_row.get("founded_date")
                        or merged_row.get("established_date")
                        or merged_row.get("foundedDate")
                    ),
                    "listing_date": _parse_date(
                        merged_row.get("listing_date") or merged_row.get("listingDate")
                    ),
                    "outstanding_shares": _parse_float(
                        merged_row.get("outstanding_shares")
                        or merged_row.get("issue_share")
                        or merged_row.get("financial_ratio_issue_share")
                    ),
                    "listed_shares": _parse_float(
                        merged_row.get("listed_shares")
                        or merged_row.get("listed_volume")
                        or merged_row.get("issue_share")
                    ),
                    "website": _normalize_text(merged_row.get("website")),
                    "email": _normalize_text(merged_row.get("email")),
                    "phone": _normalize_text(merged_row.get("phone")),
                    "fax": _normalize_text(merged_row.get("fax")),
                    "address": _normalize_text(merged_row.get("address")),
                    "business_description": _normalize_text(
                        merged_row.get("business_description")
                        or merged_row.get("businessDescription")
                        or merged_row.get("business_model")
                        or merged_row.get("history")
                    ),
                    "raw_data": merged_row,
                    "updated_at": datetime.utcnow(),
                }

                async with async_session_maker() as session:
                    existing_company = await session.scalar(
                        select(Company).where(Company.symbol == symbol)
                    )
                    existing_stock = await session.scalar(
                        select(Stock).where(Stock.symbol == symbol)
                    )

                    if not values.get("company_name") and existing_stock is not None:
                        values["company_name"] = _normalize_text(existing_stock.company_name)
                    if not values.get("exchange") and existing_stock is not None:
                        values["exchange"] = _normalize_text(existing_stock.exchange)
                    if not values.get("industry") and existing_stock is not None:
                        values["industry"] = _normalize_text(existing_stock.industry)
                    if not values.get("sector") and existing_stock is not None:
                        values["sector"] = _normalize_text(existing_stock.sector)

                    if existing_company is not None:
                        for field_name in (
                            "company_name",
                            "short_name",
                            "english_name",
                            "exchange",
                            "industry",
                            "sector",
                            "subsector",
                            "established_date",
                            "listing_date",
                            "outstanding_shares",
                            "listed_shares",
                            "website",
                            "email",
                            "phone",
                            "fax",
                            "address",
                            "business_description",
                            "raw_data",
                        ):
                            if values.get(field_name) is None:
                                values[field_name] = getattr(existing_company, field_name)

                    stmt = get_upsert_stmt(Company, ["symbol"], values)
                    await session.execute(stmt)

                    # Keep stock classification fields in sync when profile metadata is available.
                    stock_updates = {
                        "updated_at": datetime.utcnow(),
                    }
                    if values.get("company_name"):
                        stock_updates["company_name"] = values["company_name"]
                    if values.get("exchange"):
                        stock_updates["exchange"] = values["exchange"]
                    if values.get("industry"):
                        stock_updates["industry"] = values["industry"]
                    if values.get("sector"):
                        stock_updates["sector"] = values["sector"]

                    await session.execute(
                        update(Stock).where(Stock.symbol == symbol).values(**stock_updates)
                    )

                    await session.commit()

                total += 1
                cache_key = build_cache_key("vnibb", "profile", symbol)
                await self._cache_set_json(cache_key, values, CACHE_TTL_PROFILE)
                if progress is not None:
                    progress["success_count"] = progress.get("success_count", 0) + 1
                    progress["stage_stats"]["profiles"]["success"] += 1
            except SystemExit as exc:
                logger.warning(f"Profile sync aborted for {symbol}: {exc}")
                if progress is not None:
                    progress["error_count"] = progress.get("error_count", 0) + 1
                    progress["stage_stats"]["profiles"]["errors"] += 1
                continue
            except Exception as e:
                logger.debug(f"Failed to sync profile for {symbol}: {e}")
                if progress is not None:
                    progress["error_count"] = progress.get("error_count", 0) + 1
                    progress["stage_stats"]["profiles"]["errors"] += 1
                continue
            if progress is not None and sync_id is not None:
                progress["last_symbol"] = symbol
                if self._should_checkpoint(idx, len(symbols)):
                    await self._checkpoint(progress, sync_id)
        return total

    async def sync_financials(
        self,
        symbols: List[str] = None,
        period: str = "year",
        progress: Optional[Dict[str, Any]] = None,
        sync_id: Optional[int] = None,
        statement_types: Optional[List[StatementType | str]] = None,
    ) -> int:
        """Sync income, balance, and cashflow for specified symbols."""
        if not symbols:
            async with async_session_maker() as session:
                result = await session.execute(select(Stock.symbol).where(Stock.is_active == 1))
                symbols = [r[0] for r in result.fetchall()]

        logger.info(f"Syncing financials ({period}) for {len(symbols)} symbols...")
        start_index = 0
        if progress and progress.get("stage") == "financials":
            last_symbol = progress.get("last_symbol")
            if last_symbol and last_symbol in symbols:
                start_index = symbols.index(last_symbol) + 1

        if progress is not None:
            progress.setdefault("stage_stats", {})
            progress["stage"] = "financials"
            progress["stage_index"] = STAGE_ORDER.index("financials")
            progress["stage_stats"].setdefault(
                "financials",
                {"success": 0, "errors": 0, "total": len(symbols)},
            )
        total = 0

        normalized_period = "quarter" if period in {"quarter", "Q", "QTR"} else "year"
        fetch_limit = 8 if normalized_period == "quarter" else 6

        def _parse_period_fields(
            raw_period: Any,
            raw_payload: Optional[Dict[str, Any]] = None,
        ) -> Tuple[str, int, Optional[int]]:
            payload = raw_payload if isinstance(raw_payload, dict) else {}

            year_hint: Optional[int] = None
            for key in ("yearReport", "fiscalYear", "year_report", "year"):
                value = payload.get(key)
                if value is None:
                    continue
                try:
                    parsed_year = int(float(value))
                except (TypeError, ValueError):
                    continue
                if 1900 <= parsed_year <= 2100:
                    year_hint = parsed_year
                    break

            raw_text = str(raw_period or "").strip().upper()
            year_match = re.search(r"(20\d{2})", raw_text)
            fiscal_year = (
                int(year_match.group(1)) if year_match else (year_hint or datetime.utcnow().year)
            )

            quarter_match = re.search(r"Q([1-4])", raw_text)
            fiscal_quarter = int(quarter_match.group(1)) if quarter_match else None
            if fiscal_quarter is None and normalized_period == "quarter":
                for key in ("quarter", "period"):
                    value = payload.get(key)
                    if value is None:
                        continue
                    try:
                        parsed_quarter = int(float(value))
                    except (TypeError, ValueError):
                        continue
                    if 1 <= parsed_quarter <= 4:
                        fiscal_quarter = parsed_quarter
                        break

            if normalized_period == "quarter" and fiscal_quarter is not None:
                return f"Q{fiscal_quarter}-{fiscal_year}", fiscal_year, fiscal_quarter

            return str(fiscal_year), fiscal_year, None

        def _coerce_float(value: Any) -> Optional[float]:
            if value is None:
                return None
            try:
                parsed = float(value)
            except (TypeError, ValueError):
                return None
            if pd.isna(parsed):
                return None
            return parsed

        def _pick_float(*values: Any) -> Optional[float]:
            for value in values:
                parsed = _coerce_float(value)
                if parsed is not None:
                    return parsed
            return None

        def _extract_raw_float(payload: Dict[str, Any], *keys: str) -> Optional[float]:
            if not payload:
                return None
            for key in keys:
                if key in payload:
                    parsed = _coerce_float(payload.get(key))
                    if parsed is not None:
                        return parsed
            return None

        for idx in range(start_index, len(symbols)):
            symbol = symbols[idx]
            await self._wait_for_rate_limit("financials")
            try:
                default_statement_specs = [
                    (StatementType.INCOME, IncomeStatement, "income"),
                    (StatementType.BALANCE, BalanceSheet, "balance"),
                    (StatementType.CASHFLOW, CashFlow, "cashflow"),
                ]
                if statement_types:
                    requested_types = {
                        (
                            item.value
                            if isinstance(item, StatementType)
                            else str(item).strip().lower()
                        )
                        for item in statement_types
                        if item is not None
                    }
                    statement_specs = [
                        spec for spec in default_statement_specs if spec[0].value in requested_types
                    ]
                else:
                    statement_specs = default_statement_specs

                if not statement_specs:
                    logger.warning(
                        "No valid statement types requested for financial sync: %s",
                        statement_types,
                    )
                    continue

                symbol_synced = False
                income_depreciation_lookup: Dict[Tuple[int, int], float] = {}
                annual_income_depreciation: Dict[int, float] = {}
                for statement_type, model, cache_slug in statement_specs:
                    params = FinancialsQueryParams(
                        symbol=symbol,
                        statement_type=statement_type,
                        period=normalized_period,
                        limit=fetch_limit,
                    )
                    items = await VnstockFinancialsFetcher.fetch(params)
                    if not items:
                        continue

                    latest_cache_payload: List[Dict[str, Any]] = []
                    async with async_session_maker() as session:
                        for entry in items:
                            payload = entry.model_dump(mode="json")
                            if isinstance(entry.raw_data, dict):
                                raw_payload = dict(entry.raw_data)
                            else:
                                raw_payload = dict(payload)

                            period_value, fiscal_year, fiscal_quarter = _parse_period_fields(
                                entry.period,
                                raw_payload,
                            )

                            common = {
                                "symbol": symbol,
                                "period": period_value,
                                "period_type": normalized_period,
                                "fiscal_year": fiscal_year,
                                "fiscal_quarter": fiscal_quarter,
                                "source": "vnstock",
                                "updated_at": datetime.utcnow(),
                            }

                            if statement_type == StatementType.INCOME:
                                operating_expenses = _pick_float(
                                    _extract_raw_float(
                                        payload,
                                        "operating_expenses",
                                        "operatingExpenses",
                                    ),
                                    _extract_raw_float(
                                        raw_payload,
                                        "operating_expenses",
                                        "operatingExpenses",
                                    ),
                                )
                                if operating_expenses is None:
                                    sga = _coerce_float(entry.selling_general_admin)
                                    rnd = _coerce_float(entry.research_development)
                                    if sga is not None or rnd is not None:
                                        operating_expenses = (sga or 0.0) + (rnd or 0.0)

                                income_depreciation = _pick_float(
                                    entry.depreciation,
                                    _extract_raw_float(
                                        payload,
                                        "depreciation",
                                        "depreciation_and_amortization",
                                        "depreciation_and_amortisation",
                                        "khau_hao_tai_san_co_dinh",
                                        "chi_phi_khau_hao",
                                        "khau_hao_tscd",
                                    ),
                                    _extract_raw_float(
                                        raw_payload,
                                        "depreciation",
                                        "depreciation_and_amortization",
                                        "depreciation_and_amortisation",
                                        "khau_hao_tai_san_co_dinh",
                                        "chi_phi_khau_hao",
                                        "khau_hao_tscd",
                                    ),
                                )

                                lookup_key = (fiscal_year, fiscal_quarter or 0)
                                if income_depreciation is not None:
                                    income_depreciation_lookup[lookup_key] = income_depreciation
                                    annual_income_depreciation[fiscal_year] = income_depreciation

                                operating_income_value = _coerce_float(entry.operating_income)
                                ebitda_value = _coerce_float(entry.ebitda)
                                if ebitda_value is None:
                                    if (
                                        operating_income_value is not None
                                        and income_depreciation is not None
                                    ):
                                        ebitda_value = operating_income_value + abs(
                                            income_depreciation
                                        )
                                        raw_payload["_ebitda_computed_from_operating_income"] = True

                                values = {
                                    **common,
                                    "revenue": _coerce_float(entry.revenue),
                                    "cost_of_revenue": _coerce_float(entry.cost_of_revenue),
                                    "gross_profit": _coerce_float(entry.gross_profit),
                                    "operating_expenses": operating_expenses,
                                    "operating_income": operating_income_value,
                                    "interest_expense": _coerce_float(entry.interest_expense),
                                    "other_income": _coerce_float(entry.other_income),
                                    "income_before_tax": _pick_float(
                                        entry.pre_tax_profit,
                                        entry.profit_before_tax,
                                        _extract_raw_float(
                                            payload,
                                            "pre_tax_profit",
                                            "profit_before_tax",
                                            "income_before_tax",
                                        ),
                                        _extract_raw_float(
                                            raw_payload,
                                            "pre_tax_profit",
                                            "profit_before_tax",
                                            "income_before_tax",
                                        ),
                                    ),
                                    "income_tax": _pick_float(
                                        entry.tax_expense,
                                        _extract_raw_float(payload, "tax_expense", "income_tax"),
                                        _extract_raw_float(
                                            raw_payload, "tax_expense", "income_tax"
                                        ),
                                    ),
                                    "net_income": _coerce_float(entry.net_income),
                                    "ebitda": ebitda_value,
                                    "eps": _coerce_float(entry.eps),
                                    "eps_diluted": _coerce_float(entry.eps_diluted),
                                    "raw_data": raw_payload,
                                }
                            elif statement_type == StatementType.BALANCE:
                                values = {
                                    **common,
                                    "total_assets": _coerce_float(entry.total_assets),
                                    "current_assets": _coerce_float(entry.current_assets),
                                    "cash_and_equivalents": _pick_float(
                                        entry.cash_and_equivalents,
                                        entry.cash,
                                    ),
                                    "short_term_investments": _pick_float(
                                        _extract_raw_float(
                                            payload,
                                            "short_term_investments",
                                            "shortTermInvestments",
                                        ),
                                        _extract_raw_float(
                                            raw_payload,
                                            "short_term_investments",
                                            "shortTermInvestments",
                                        ),
                                    ),
                                    "accounts_receivable": _coerce_float(entry.accounts_receivable),
                                    "inventory": _coerce_float(entry.inventory),
                                    "non_current_assets": _pick_float(
                                        _extract_raw_float(
                                            payload,
                                            "non_current_assets",
                                            "nonCurrentAssets",
                                        ),
                                        _extract_raw_float(
                                            raw_payload,
                                            "non_current_assets",
                                            "nonCurrentAssets",
                                        ),
                                    ),
                                    "fixed_assets": _coerce_float(entry.fixed_assets),
                                    "total_liabilities": _coerce_float(entry.total_liabilities),
                                    "current_liabilities": _coerce_float(entry.current_liabilities),
                                    "accounts_payable": _coerce_float(entry.accounts_payable),
                                    "short_term_debt": _coerce_float(entry.short_term_debt),
                                    "non_current_liabilities": _coerce_float(
                                        entry.long_term_liabilities
                                    ),
                                    "long_term_debt": _coerce_float(entry.long_term_debt),
                                    "total_equity": _pick_float(entry.total_equity, entry.equity),
                                    "retained_earnings": _coerce_float(entry.retained_earnings),
                                    "book_value_per_share": _pick_float(
                                        _extract_raw_float(
                                            payload,
                                            "book_value_per_share",
                                            "bookValuePerShare",
                                            "bvps",
                                        ),
                                        _extract_raw_float(
                                            raw_payload,
                                            "book_value_per_share",
                                            "bookValuePerShare",
                                            "bvps",
                                        ),
                                    ),
                                    "raw_data": raw_payload,
                                }
                            else:
                                net_change = None
                                if (
                                    entry.operating_cash_flow is not None
                                    and entry.investing_cash_flow is not None
                                    and entry.financing_cash_flow is not None
                                ):
                                    net_change = (
                                        entry.operating_cash_flow
                                        + entry.investing_cash_flow
                                        + entry.financing_cash_flow
                                    )

                                lookup_key = (fiscal_year, fiscal_quarter or 0)
                                depreciation_value = _pick_float(
                                    entry.depreciation,
                                    _extract_raw_float(
                                        payload,
                                        "depreciation",
                                        "depreciation_and_amortization",
                                        "depreciation_and_amortisation",
                                    ),
                                    _extract_raw_float(
                                        raw_payload,
                                        "depreciation",
                                        "depreciation_and_amortization",
                                        "depreciation_and_amortisation",
                                    ),
                                )
                                if depreciation_value is None:
                                    depreciation_value = income_depreciation_lookup.get(lookup_key)
                                    if depreciation_value is None and fiscal_quarter is not None:
                                        depreciation_value = annual_income_depreciation.get(
                                            fiscal_year
                                        )
                                    if depreciation_value is not None:
                                        raw_payload["_depreciation_cross_fill"] = "income_statement"

                                investing_cash_flow_value = _coerce_float(entry.investing_cash_flow)
                                capital_expenditure_value = _pick_float(
                                    entry.capital_expenditure,
                                    entry.capex,
                                    _extract_raw_float(
                                        payload,
                                        "capital_expenditure",
                                        "capex",
                                    ),
                                    _extract_raw_float(
                                        raw_payload,
                                        "capital_expenditure",
                                        "capex",
                                    ),
                                )
                                if (
                                    capital_expenditure_value is None
                                    and investing_cash_flow_value is not None
                                ):
                                    capital_expenditure_value = investing_cash_flow_value
                                    raw_payload["_capital_expenditure_proxy"] = (
                                        "investing_cash_flow"
                                    )

                                values = {
                                    **common,
                                    "operating_cash_flow": _coerce_float(entry.operating_cash_flow),
                                    "depreciation": depreciation_value,
                                    "investing_cash_flow": investing_cash_flow_value,
                                    "capital_expenditure": capital_expenditure_value,
                                    "financing_cash_flow": _coerce_float(entry.financing_cash_flow),
                                    "dividends_paid": _coerce_float(entry.dividends_paid),
                                    "debt_repayment": _coerce_float(entry.debt_repayment),
                                    "free_cash_flow": _coerce_float(entry.free_cash_flow),
                                    "net_change_in_cash": _pick_float(
                                        entry.net_change_in_cash,
                                        net_change,
                                    ),
                                    "raw_data": raw_payload,
                                }

                            stmt = get_upsert_stmt(
                                model, ["symbol", "period", "period_type"], values
                            )
                            await session.execute(stmt)

                            latest_cache_payload.append(payload)

                        await session.commit()

                    cache_key = build_cache_key(
                        "vnibb", "financials", cache_slug, symbol, normalized_period
                    )
                    await self._cache_set_json(
                        cache_key, latest_cache_payload, CACHE_TTL_FINANCIALS
                    )
                    symbol_synced = True

                if symbol_synced:
                    total += 1
                    if progress is not None:
                        progress["success_count"] = progress.get("success_count", 0) + 1
                        progress["stage_stats"]["financials"]["success"] += 1
                elif progress is not None:
                    progress["error_count"] = progress.get("error_count", 0) + 1
                    progress["stage_stats"]["financials"]["errors"] += 1
            except SystemExit as exc:
                logger.warning(f"Financials sync aborted for {symbol}: {exc}")
                if progress is not None:
                    progress["error_count"] = progress.get("error_count", 0) + 1
                    progress["stage_stats"]["financials"]["errors"] += 1
                continue
            except Exception as e:
                logger.debug(f"Financials failed for {symbol}: {e}")
                if progress is not None:
                    progress["error_count"] = progress.get("error_count", 0) + 1
                    progress["stage_stats"]["financials"]["errors"] += 1
                continue
            if progress is not None and sync_id is not None:
                progress["last_symbol"] = symbol
                if self._should_checkpoint(idx, len(symbols)):
                    await self._checkpoint(progress, sync_id)
        return total

    async def sync_financial_ratios(
        self,
        symbols: List[str] = None,
        period: str = "quarter",
        progress: Optional[Dict[str, Any]] = None,
        sync_id: Optional[int] = None,
    ) -> int:
        """Sync financial ratios for specified symbols."""
        if not symbols:
            async with async_session_maker() as session:
                result = await session.execute(select(Stock.symbol).where(Stock.is_active == 1))
                symbols = [r[0] for r in result.fetchall()]

        if not symbols:
            return 0

        logger.info(f"Syncing financial ratios ({period}) for {len(symbols)} symbols...")
        start_index = 0
        if progress and progress.get("stage") == "financial_ratios":
            last_symbol = progress.get("last_symbol")
            if last_symbol and last_symbol in symbols:
                start_index = symbols.index(last_symbol) + 1

        if progress is not None:
            progress.setdefault("stage_stats", {})
            progress["stage"] = "financial_ratios"
            progress["stage_index"] = STAGE_ORDER.index("financials")
            progress["stage_stats"].setdefault(
                "financial_ratios",
                {"success": 0, "errors": 0, "total": len(symbols)},
            )

        total = 0
        normalized_period = "year" if period in {"year", "FY"} else "quarter"

        def _coerce_float(value: Any) -> Optional[float]:
            if value is None:
                return None
            try:
                parsed = float(value)
            except (TypeError, ValueError):
                return None
            if pd.isna(parsed):
                return None
            return parsed

        def _pick_float(*values: Any) -> Optional[float]:
            for value in values:
                parsed = _coerce_float(value)
                if parsed is not None:
                    return parsed
            return None

        def _resolve_lookup(
            keyed: Dict[Tuple[int, int], Dict[str, Optional[float]]],
            annual: Dict[int, Dict[str, Optional[float]]],
            year: int,
            quarter: Optional[int],
        ) -> Dict[str, Optional[float]] | None:
            key = (year, quarter or 0)
            row = keyed.get(key)
            if row is None and quarter not in (None, 0):
                row = keyed.get((year, 0))
            if row is None:
                row = annual.get(year)
            return row

        async def _enrich_ratio_rows(session: AsyncSession, symbol_value: str) -> int:
            ratio_rows = (
                (
                    await session.execute(
                        select(FinancialRatio)
                        .where(
                            FinancialRatio.symbol == symbol_value,
                            FinancialRatio.period_type == normalized_period,
                        )
                        .order_by(
                            FinancialRatio.fiscal_year.desc(), FinancialRatio.fiscal_quarter.desc()
                        )
                    )
                )
                .scalars()
                .all()
            )
            if not ratio_rows:
                return 0

            income_rows = (
                await session.execute(
                    select(
                        IncomeStatement.fiscal_year,
                        IncomeStatement.fiscal_quarter,
                        IncomeStatement.revenue,
                        IncomeStatement.operating_income,
                        IncomeStatement.net_income,
                        IncomeStatement.cost_of_revenue,
                        IncomeStatement.interest_expense,
                    )
                    .where(
                        IncomeStatement.symbol == symbol_value,
                        IncomeStatement.period_type == normalized_period,
                    )
                    .order_by(
                        IncomeStatement.fiscal_year.desc(), IncomeStatement.fiscal_quarter.desc()
                    )
                )
            ).all()

            balance_rows = (
                await session.execute(
                    select(
                        BalanceSheet.fiscal_year,
                        BalanceSheet.fiscal_quarter,
                        BalanceSheet.inventory,
                        BalanceSheet.accounts_receivable,
                        BalanceSheet.total_liabilities,
                        BalanceSheet.total_assets,
                        BalanceSheet.total_equity,
                    )
                    .where(
                        BalanceSheet.symbol == symbol_value,
                        BalanceSheet.period_type == normalized_period,
                    )
                    .order_by(BalanceSheet.fiscal_year.desc(), BalanceSheet.fiscal_quarter.desc())
                )
            ).all()

            cashflow_rows = (
                await session.execute(
                    select(
                        CashFlow.fiscal_year,
                        CashFlow.fiscal_quarter,
                        CashFlow.operating_cash_flow,
                        CashFlow.free_cash_flow,
                        CashFlow.dividends_paid,
                        CashFlow.debt_repayment,
                    )
                    .where(
                        CashFlow.symbol == symbol_value,
                        CashFlow.period_type == normalized_period,
                    )
                    .order_by(CashFlow.fiscal_year.desc(), CashFlow.fiscal_quarter.desc())
                )
            ).all()

            income_lookup: Dict[Tuple[int, int], Dict[str, Optional[float]]] = {}
            income_annual: Dict[int, Dict[str, Optional[float]]] = {}
            for (
                year,
                quarter,
                revenue,
                op_income,
                net_income,
                cogs,
                interest_expense,
            ) in income_rows:
                if year is None:
                    continue
                period_key = (int(year), int(quarter or 0))
                row_value = {
                    "revenue": _coerce_float(revenue),
                    "operating_income": _coerce_float(op_income),
                    "net_income": _coerce_float(net_income),
                    "cost_of_revenue": _coerce_float(cogs),
                    "interest_expense": _coerce_float(interest_expense),
                }
                income_lookup[period_key] = row_value
                income_annual.setdefault(int(year), row_value)

            balance_lookup: Dict[Tuple[int, int], Dict[str, Optional[float]]] = {}
            balance_annual: Dict[int, Dict[str, Optional[float]]] = {}
            for (
                year,
                quarter,
                inventory,
                receivables,
                total_liabilities,
                total_assets,
                total_equity,
            ) in balance_rows:
                if year is None:
                    continue
                period_key = (int(year), int(quarter or 0))
                row_value = {
                    "inventory": _coerce_float(inventory),
                    "accounts_receivable": _coerce_float(receivables),
                    "total_liabilities": _coerce_float(total_liabilities),
                    "total_assets": _coerce_float(total_assets),
                    "total_equity": _coerce_float(total_equity),
                }
                balance_lookup[period_key] = row_value
                balance_annual.setdefault(int(year), row_value)

            cashflow_lookup: Dict[Tuple[int, int], Dict[str, Optional[float]]] = {}
            cashflow_annual: Dict[int, Dict[str, Optional[float]]] = {}
            for year, quarter, ocf, fcf, dividends_paid, debt_repayment in cashflow_rows:
                if year is None:
                    continue
                period_key = (int(year), int(quarter or 0))
                row_value = {
                    "operating_cash_flow": _coerce_float(ocf),
                    "free_cash_flow": _coerce_float(fcf),
                    "dividends_paid": _coerce_float(dividends_paid),
                    "debt_repayment": _coerce_float(debt_repayment),
                }
                cashflow_lookup[period_key] = row_value
                cashflow_annual.setdefault(int(year), row_value)

            company_row = (
                await session.execute(
                    select(
                        Company.outstanding_shares, Company.listed_shares, Company.raw_data
                    ).where(Company.symbol == symbol_value)
                )
            ).first()
            outstanding_shares = None
            if company_row:
                company_raw = company_row[2] if isinstance(company_row[2], dict) else {}
                outstanding_shares = _pick_float(
                    company_row[0],
                    company_row[1],
                    company_raw.get("outstanding_shares"),
                    company_raw.get("issue_share"),
                )

            latest_price = _coerce_float(
                (
                    await session.execute(
                        select(StockPrice.close)
                        .where(StockPrice.symbol == symbol_value)
                        .order_by(StockPrice.time.desc())
                        .limit(1)
                    )
                ).scalar_one_or_none()
            )
            if latest_price in (None, 0):
                latest_price = _coerce_float(
                    (
                        await session.execute(
                            select(ScreenerSnapshot.price)
                            .where(
                                ScreenerSnapshot.symbol == symbol_value,
                                ScreenerSnapshot.price.is_not(None),
                            )
                            .order_by(ScreenerSnapshot.snapshot_date.desc())
                            .limit(1)
                        )
                    ).scalar_one_or_none()
                )

            market_cap = None
            if outstanding_shares not in (None, 0) and latest_price not in (None, 0):
                market_cap = outstanding_shares * latest_price
            if market_cap in (None, 0):
                market_cap = _coerce_float(
                    (
                        await session.execute(
                            select(ScreenerSnapshot.market_cap)
                            .where(
                                ScreenerSnapshot.symbol == symbol_value,
                                ScreenerSnapshot.market_cap.is_not(None),
                            )
                            .order_by(ScreenerSnapshot.snapshot_date.desc())
                            .limit(1)
                        )
                    ).scalar_one_or_none()
                )

            changed_count = 0
            for ratio_row in ratio_rows:
                year = int(ratio_row.fiscal_year)
                quarter = (
                    int(ratio_row.fiscal_quarter or 0) if normalized_period == "quarter" else 0
                )

                income = _resolve_lookup(
                    income_lookup,
                    income_annual,
                    year,
                    quarter if quarter else None,
                )
                balance = _resolve_lookup(
                    balance_lookup,
                    balance_annual,
                    year,
                    quarter if quarter else None,
                )
                cashflow = _resolve_lookup(
                    cashflow_lookup,
                    cashflow_annual,
                    year,
                    quarter if quarter else None,
                )

                prev_quarter = quarter if normalized_period == "quarter" and quarter else 0
                balance_prev = _resolve_lookup(
                    balance_lookup, balance_annual, year - 1, prev_quarter
                )

                raw_payload = dict(ratio_row.raw_data or {})
                changed = False

                revenue = _pick_float(None if income is None else income.get("revenue"))
                operating_income = _pick_float(
                    None if income is None else income.get("operating_income")
                )
                net_income = _pick_float(None if income is None else income.get("net_income"))
                cost_of_revenue = _pick_float(
                    None if income is None else income.get("cost_of_revenue")
                )
                interest_expense = _pick_float(
                    None if income is None else income.get("interest_expense")
                )

                inventory_current = _pick_float(
                    None if balance is None else balance.get("inventory")
                )
                inventory_prev = _pick_float(
                    None if balance_prev is None else balance_prev.get("inventory")
                )
                receivables_current = _pick_float(
                    None if balance is None else balance.get("accounts_receivable")
                )
                receivables_prev = _pick_float(
                    None if balance_prev is None else balance_prev.get("accounts_receivable")
                )
                total_liabilities = _pick_float(
                    None if balance is None else balance.get("total_liabilities")
                )

                operating_cash_flow = _pick_float(
                    None if cashflow is None else cashflow.get("operating_cash_flow")
                )
                free_cash_flow = _pick_float(
                    None if cashflow is None else cashflow.get("free_cash_flow")
                )
                dividends_paid = _pick_float(
                    None if cashflow is None else cashflow.get("dividends_paid")
                )
                debt_repayment = _pick_float(
                    None if cashflow is None else cashflow.get("debt_repayment")
                )

                if _pick_float(raw_payload.get("inventory_turnover")) is None:
                    if cost_of_revenue not in (None, 0) and inventory_current not in (None, 0):
                        avg_inventory = (
                            inventory_current + (inventory_prev or inventory_current)
                        ) / 2
                        if avg_inventory > 0:
                            raw_payload["inventory_turnover"] = round(
                                cost_of_revenue / avg_inventory, 4
                            )
                            changed = True

                if _pick_float(raw_payload.get("receivables_turnover")) is None:
                    if revenue not in (None, 0) and receivables_current not in (None, 0):
                        avg_receivables = (
                            receivables_current + (receivables_prev or receivables_current)
                        ) / 2
                        if avg_receivables > 0:
                            raw_payload["receivables_turnover"] = round(
                                revenue / avg_receivables,
                                4,
                            )
                            changed = True

                if _pick_float(raw_payload.get("debt_service_coverage")) is None:
                    denominator = 0.0
                    if interest_expense is not None:
                        denominator += abs(interest_expense)
                    if debt_repayment is not None:
                        denominator += abs(debt_repayment)
                    if operating_income is not None and denominator > 0:
                        raw_payload["debt_service_coverage"] = round(
                            operating_income / denominator,
                            4,
                        )
                        changed = True

                if _pick_float(raw_payload.get("ocf_debt")) is None:
                    if operating_cash_flow is not None and total_liabilities not in (None, 0):
                        raw_payload["ocf_debt"] = round(operating_cash_flow / total_liabilities, 4)
                        changed = True

                if _pick_float(raw_payload.get("ocf_sales")) is None:
                    if operating_cash_flow is not None and revenue not in (None, 0):
                        raw_payload["ocf_sales"] = round(operating_cash_flow / revenue, 4)
                        changed = True

                if _pick_float(raw_payload.get("fcf_yield")) is None:
                    if free_cash_flow is not None and market_cap not in (None, 0):
                        raw_payload["fcf_yield"] = round(free_cash_flow / market_cap, 4)
                        changed = True

                if ratio_row.dps is None:
                    if dividends_paid is not None and outstanding_shares not in (None, 0):
                        shares_denominator = (
                            outstanding_shares
                            if outstanding_shares >= 1_000_000
                            else outstanding_shares * 1_000_000
                        )
                        ratio_row.dps = round(abs(dividends_paid) / shares_denominator, 4)
                        raw_payload["dps"] = ratio_row.dps
                        changed = True

                dps_value = _pick_float(ratio_row.dps, raw_payload.get("dps"))
                if _pick_float(raw_payload.get("dividend_yield")) is None:
                    if dps_value is not None and latest_price not in (None, 0):
                        raw_payload["dividend_yield"] = round(
                            _normalize_dividend_yield((dps_value / latest_price) * 100),
                            4,
                        )
                        changed = True
                else:
                    existing_yield = _pick_float(raw_payload.get("dividend_yield"))
                    if existing_yield is not None and abs(existing_yield) > 100:
                        while abs(existing_yield) > 100:
                            existing_yield /= 100
                        raw_payload["dividend_yield"] = round(existing_yield, 4)
                        changed = True

                payout_ratio_value = _pick_float(raw_payload.get("payout_ratio"))
                eps_value = _pick_float(ratio_row.eps, raw_payload.get("eps"))

                if (
                    payout_ratio_value is None
                    and dps_value not in (None, 0)
                    and eps_value not in (None, 0)
                ):
                    payout_ratio_value = (dps_value / eps_value) * 100
                    raw_payload["payout_ratio"] = round(payout_ratio_value, 4)
                    changed = True

                if (
                    ratio_row.dps is None
                    and payout_ratio_value not in (None, 0)
                    and eps_value not in (None, 0)
                ):
                    payout_ratio_base = payout_ratio_value
                    while abs(payout_ratio_base) > 100:
                        payout_ratio_base /= 100

                    derived_dps = eps_value * (payout_ratio_base / 100)
                    ratio_row.dps = round(derived_dps, 4)
                    raw_payload["dps"] = ratio_row.dps
                    dps_value = ratio_row.dps
                    changed = True

                if _pick_float(raw_payload.get("payout_ratio")) is None:
                    if dividends_paid is not None and net_income not in (None, 0):
                        if net_income > 0:
                            raw_payload["payout_ratio"] = round(
                                (abs(dividends_paid) / net_income) * 100,
                                4,
                            )
                            changed = True

                if ratio_row.peg_ratio is None:
                    pe_value = _pick_float(ratio_row.pe_ratio, raw_payload.get("pe"))
                    earnings_growth = _pick_float(
                        ratio_row.earnings_growth,
                        raw_payload.get("earnings_growth"),
                        raw_payload.get("earningsGrowth"),
                    )
                    if pe_value is not None and earnings_growth not in (None, 0):
                        growth_base = (
                            earnings_growth if abs(earnings_growth) > 1 else earnings_growth * 100
                        )
                        if growth_base > 0:
                            ratio_row.peg_ratio = round(pe_value / growth_base, 4)
                            raw_payload["peg_ratio"] = ratio_row.peg_ratio
                            changed = True

                if changed:
                    ratio_row.raw_data = raw_payload
                    changed_count += 1

            return changed_count

        for idx in range(start_index, len(symbols)):
            symbol = symbols[idx]
            await self._wait_for_rate_limit("financials")
            try:
                params = FinancialRatiosQueryParams(symbol=symbol, period=normalized_period)
                ratio_items = await VnstockFinancialRatiosFetcher.fetch(params)
                if not ratio_items:
                    if progress is not None:
                        progress["error_count"] = progress.get("error_count", 0) + 1
                        progress["stage_stats"]["financial_ratios"]["errors"] += 1
                    continue

                async with async_session_maker() as session:
                    for ratio in ratio_items:
                        period_str = str(ratio.period or "").strip()
                        period_upper = period_str.upper()
                        fiscal_year = datetime.utcnow().year
                        fiscal_quarter = None

                        year_match = re.search(r"(20\d{2})", period_upper)
                        if year_match:
                            fiscal_year = int(year_match.group(1))
                        elif period_upper.isdigit() and int(period_upper) >= 1900:
                            fiscal_year = int(period_upper)

                        quarter_match = re.search(r"Q([1-4])", period_upper)
                        if quarter_match:
                            fiscal_quarter = int(quarter_match.group(1))
                        elif normalized_period == "quarter":
                            alt_quarter_match = re.match(r"([1-4])[/_-](20\d{2})", period_upper)
                            if alt_quarter_match:
                                fiscal_quarter = int(alt_quarter_match.group(1))
                                fiscal_year = int(alt_quarter_match.group(2))

                        if not period_str:
                            period_str = (
                                f"Q{fiscal_quarter}-{fiscal_year}"
                                if fiscal_quarter
                                else str(fiscal_year)
                            )

                        ratio_payload = ratio.model_dump(mode="json")

                        values = {
                            "symbol": symbol,
                            "period": period_str,
                            "period_type": normalized_period,
                            "fiscal_year": fiscal_year,
                            "fiscal_quarter": fiscal_quarter,
                            "pe_ratio": _pick_float(ratio.pe, ratio_payload.get("pe")),
                            "pb_ratio": _pick_float(ratio.pb, ratio_payload.get("pb")),
                            "ps_ratio": _pick_float(ratio.ps, ratio_payload.get("ps")),
                            "peg_ratio": _pick_float(
                                ratio.peg_ratio,
                                ratio_payload.get("peg_ratio"),
                                ratio_payload.get("pegRatio"),
                            ),
                            "ev_ebitda": _pick_float(
                                ratio.ev_ebitda, ratio_payload.get("ev_ebitda")
                            ),
                            "ev_sales": _pick_float(ratio.ev_sales, ratio_payload.get("ev_sales")),
                            "roe": _pick_float(ratio.roe, ratio_payload.get("roe")),
                            "roa": _pick_float(ratio.roa, ratio_payload.get("roa")),
                            "roic": _pick_float(ratio.roic, ratio_payload.get("roic")),
                            "gross_margin": _pick_float(
                                ratio.gross_margin,
                                ratio_payload.get("gross_margin"),
                                ratio_payload.get("grossProfitMargin"),
                            ),
                            "operating_margin": _pick_float(
                                ratio.operating_margin,
                                ratio_payload.get("operating_margin"),
                                ratio_payload.get("operatingMargin"),
                            ),
                            "net_margin": _pick_float(
                                ratio.net_margin,
                                ratio_payload.get("net_margin"),
                                ratio_payload.get("netMargin"),
                            ),
                            "current_ratio": _pick_float(
                                ratio.current_ratio,
                                ratio_payload.get("current_ratio"),
                            ),
                            "quick_ratio": _pick_float(
                                ratio.quick_ratio,
                                ratio_payload.get("quick_ratio"),
                            ),
                            "cash_ratio": _pick_float(
                                ratio.cash_ratio,
                                ratio_payload.get("cash_ratio"),
                            ),
                            "debt_to_equity": _pick_float(
                                ratio.debt_equity,
                                ratio_payload.get("debt_equity"),
                                ratio_payload.get("de"),
                            ),
                            "debt_to_assets": _pick_float(
                                ratio.debt_assets,
                                ratio_payload.get("debt_assets"),
                            ),
                            "interest_coverage": _pick_float(
                                ratio.interest_coverage,
                                ratio_payload.get("interest_coverage"),
                            ),
                            "eps": _pick_float(ratio.eps, ratio_payload.get("eps")),
                            "bvps": _pick_float(ratio.bvps, ratio_payload.get("bvps")),
                            "dps": _pick_float(
                                ratio.dps,
                                ratio_payload.get("dps"),
                                ratio_payload.get("dividends_per_share"),
                                ratio_payload.get("dividendPerShare"),
                            ),
                            "revenue_growth": _pick_float(
                                ratio.revenue_growth,
                                ratio_payload.get("revenue_growth"),
                                ratio_payload.get("revenueGrowth"),
                            ),
                            "earnings_growth": _pick_float(
                                ratio.earnings_growth,
                                ratio_payload.get("earnings_growth"),
                                ratio_payload.get("earningsGrowth"),
                            ),
                            "raw_data": ratio_payload,
                            "source": "vnstock",
                            "updated_at": datetime.utcnow(),
                        }
                        stmt = get_upsert_stmt(
                            FinancialRatio, ["symbol", "period", "period_type"], values
                        )
                        await session.execute(stmt)

                    await session.flush()
                    enriched_rows = await _enrich_ratio_rows(session, symbol)
                    await session.commit()
                    if enriched_rows:
                        logger.info(
                            "Enriched %d computed ratio rows for %s",
                            enriched_rows,
                            symbol,
                        )

                total += 1
                if progress is not None:
                    progress["success_count"] = progress.get("success_count", 0) + 1
                    progress["stage_stats"]["financial_ratios"]["success"] += 1
            except SystemExit as exc:
                logger.warning(f"Financial ratios sync aborted for {symbol}: {exc}")
                if progress is not None:
                    progress["error_count"] = progress.get("error_count", 0) + 1
                    progress["stage_stats"]["financial_ratios"]["errors"] += 1
                continue
            except Exception as exc:
                logger.debug(f"Financial ratios failed for {symbol}: {exc}")
                if progress is not None:
                    progress["error_count"] = progress.get("error_count", 0) + 1
                    progress["stage_stats"]["financial_ratios"]["errors"] += 1
                continue

            if progress is not None and sync_id is not None:
                progress["last_symbol"] = symbol
                if self._should_checkpoint(idx, len(symbols)):
                    await self._checkpoint(progress, sync_id)

        return total

    async def sync_company_news(
        self,
        symbols: List[str] = None,
        limit: int = 20,
        progress: Optional[Dict[str, Any]] = None,
        sync_id: Optional[int] = None,
    ) -> int:
        """Sync company news for specified symbols."""
        from vnibb.providers.vnstock.company_news import (
            VnstockCompanyNewsFetcher,
            CompanyNewsQueryParams,
        )

        if not symbols:
            async with async_session_maker() as session:
                result = await session.execute(select(Stock.symbol).where(Stock.is_active == 1))
                symbols = [r[0] for r in result.fetchall()]

        if not symbols:
            return 0

        total = 0
        if progress is not None:
            progress.setdefault("stage_stats", {})
            progress["stage"] = "company_news"
            progress["stage_stats"].setdefault(
                "company_news",
                {"success": 0, "errors": 0, "total": len(symbols)},
            )

        for idx, symbol in enumerate(symbols):
            await self._wait_for_rate_limit("profiles")
            try:
                params = CompanyNewsQueryParams(symbol=symbol, limit=limit)
                items = await VnstockCompanyNewsFetcher.fetch(params)
                if not items:
                    continue

                async with async_session_maker() as session:
                    for item in items:
                        payload = item.model_dump()
                        published_dt = self._parse_datetime_value(payload.get("published_at"))
                        if not published_dt:
                            published_dt = datetime.combine(self._get_market_date(), time.min)
                        values = {
                            "symbol": symbol,
                            "title": payload.get("title") or "Untitled",
                            "summary": payload.get("summary"),
                            "source": payload.get("source") or settings.vnstock_source,
                            "url": payload.get("url"),
                            "published_date": published_dt,
                            "created_at": datetime.utcnow(),
                        }
                        stmt = get_upsert_stmt(
                            CompanyNews,
                            ["symbol", "title", "published_date"],
                            values,
                        )
                        await session.execute(stmt)
                        total += 1
                    await session.commit()

                if progress is not None:
                    progress["success_count"] = progress.get("success_count", 0) + 1
                    progress["stage_stats"]["company_news"]["success"] += 1
            except Exception as exc:
                logger.debug(f"Company news sync failed for {symbol}: {exc}")
                if progress is not None:
                    progress["error_count"] = progress.get("error_count", 0) + 1
                    progress["stage_stats"]["company_news"]["errors"] += 1

            if progress is not None and sync_id is not None:
                progress["last_symbol"] = symbol
                if self._should_checkpoint(idx, len(symbols)):
                    await self._checkpoint(progress, sync_id)

        return total

    async def sync_company_events(
        self,
        symbols: List[str] = None,
        limit: int = 30,
        progress: Optional[Dict[str, Any]] = None,
        sync_id: Optional[int] = None,
    ) -> int:
        """Sync company events for specified symbols."""
        from vnibb.providers.vnstock.company_events import (
            VnstockCompanyEventsFetcher,
            CompanyEventsQueryParams,
        )
        from vnibb.providers.vnstock.dividends import VnstockDividendsFetcher

        def _parse_float(value: Any) -> Optional[float]:
            if value is None:
                return None
            if isinstance(value, (int, float)):
                return float(value)
            raw = str(value).strip()
            if not raw:
                return None
            match = re.search(r"-?\d+(?:\.\d+)?", raw.replace(",", ""))
            return float(match.group(0)) if match else None

        if not symbols:
            async with async_session_maker() as session:
                result = await session.execute(select(Stock.symbol).where(Stock.is_active == 1))
                symbols = [r[0] for r in result.fetchall()]

        if not symbols:
            return 0

        total = 0
        if progress is not None:
            progress.setdefault("stage_stats", {})
            progress["stage"] = "company_events"
            progress["stage_stats"].setdefault(
                "company_events",
                {"success": 0, "errors": 0, "total": len(symbols)},
            )

        for idx, symbol in enumerate(symbols):
            await self._wait_for_rate_limit("profiles")
            try:
                params = CompanyEventsQueryParams(symbol=symbol, limit=limit)
                items = await VnstockCompanyEventsFetcher.fetch(params)
                payloads: List[Dict[str, Any]] = []

                if items:
                    payloads = [item.model_dump() for item in items]
                else:
                    dividend_items = await VnstockDividendsFetcher.fetch(symbol)
                    for dividend in dividend_items[:limit]:
                        div_payload = dividend.model_dump()
                        payloads.append(
                            {
                                "event_type": "dividend",
                                "event_name": div_payload.get("dividend_type") or "Dividend",
                                "event_date": div_payload.get("ex_date")
                                or div_payload.get("record_date")
                                or div_payload.get("payment_date"),
                                "ex_date": div_payload.get("ex_date"),
                                "record_date": div_payload.get("record_date"),
                                "payment_date": div_payload.get("payment_date"),
                                "value": div_payload.get("cash_dividend")
                                or div_payload.get("dividend_ratio"),
                                "description": div_payload.get("content")
                                or "Dividend event synthesized from dividend history",
                                "raw_data": div_payload,
                            }
                        )

                if not payloads:
                    logger.info(f"No events data for {symbol}")
                    continue

                async with async_session_maker() as session:
                    for payload in payloads:
                        event_type = str(payload.get("event_type") or "event").strip()
                        event_name = str(payload.get("event_name") or "").strip()
                        event_date = self._parse_date_value(payload.get("event_date"))
                        ex_date = self._parse_date_value(payload.get("ex_date"))
                        record_date = self._parse_date_value(payload.get("record_date"))
                        payment_date = self._parse_date_value(payload.get("payment_date"))
                        if event_date is None:
                            event_date = ex_date or record_date or payment_date

                        description = payload.get("description")
                        if event_name:
                            if description and event_name.lower() not in str(description).lower():
                                description = f"{event_name}: {description}"
                            elif not description:
                                description = event_name

                        values = {
                            "symbol": symbol,
                            "event_type": event_type,
                            "event_date": event_date,
                            "ex_date": ex_date,
                            "record_date": record_date,
                            "payment_date": payment_date,
                            "value": _parse_float(payload.get("value")),
                            "description": description,
                            "raw_data": payload.get("raw_data") or payload,
                            "updated_at": datetime.utcnow(),
                        }
                        stmt = get_upsert_stmt(
                            CompanyEvent,
                            ["symbol", "event_type", "event_date"],
                            values,
                        )
                        await session.execute(stmt)
                        total += 1
                    await session.commit()

                if progress is not None:
                    progress["success_count"] = progress.get("success_count", 0) + 1
                    progress["stage_stats"]["company_events"]["success"] += 1
            except Exception as exc:
                logger.warning(f"Company events sync failed for {symbol}: {exc}")
                if progress is not None:
                    progress["error_count"] = progress.get("error_count", 0) + 1
                    progress["stage_stats"]["company_events"]["errors"] += 1

            if progress is not None and sync_id is not None:
                progress["last_symbol"] = symbol
                if self._should_checkpoint(idx, len(symbols)):
                    await self._checkpoint(progress, sync_id)

        return total

    async def sync_dividends(
        self,
        symbols: List[str] = None,
        progress: Optional[Dict[str, Any]] = None,
        sync_id: Optional[int] = None,
    ) -> int:
        """Sync dividend history for specified symbols."""
        from vnibb.providers.vnstock.dividends import VnstockDividendsFetcher

        def _parse_ratio(value: Any) -> Optional[float]:
            if value is None:
                return None
            if isinstance(value, (int, float)):
                return float(value)
            raw = str(value).strip()
            if not raw:
                return None
            raw = raw.replace("%", "")
            match = re.search(r"-?\d+(?:\.\d+)?", raw.replace(",", ""))
            return float(match.group(0)) if match else None

        if not symbols:
            async with async_session_maker() as session:
                result = await session.execute(select(Stock.symbol).where(Stock.is_active == 1))
                symbols = [r[0] for r in result.fetchall()]

        if not symbols:
            return 0

        total = 0
        if progress is not None:
            progress.setdefault("stage_stats", {})
            progress["stage"] = "dividends"
            progress["stage_stats"].setdefault(
                "dividends",
                {"success": 0, "errors": 0, "total": len(symbols)},
            )

        for idx, symbol in enumerate(symbols):
            await self._wait_for_rate_limit("profiles")
            try:
                items = await VnstockDividendsFetcher.fetch(symbol)
                if not items:
                    continue

                async with async_session_maker() as session:
                    for item in items:
                        payload = item.model_dump()
                        exercise_date = self._parse_date_value(payload.get("ex_date"))
                        cash_year = payload.get("fiscal_year") or payload.get("issue_year")
                        values = {
                            "symbol": symbol,
                            "exercise_date": exercise_date,
                            "cash_year": cash_year,
                            "dividend_rate": _parse_ratio(payload.get("dividend_ratio")),
                            "dividend_value": payload.get("cash_dividend"),
                            "issue_method": payload.get("dividend_type"),
                            "record_date": self._parse_date_value(payload.get("record_date")),
                            "payment_date": self._parse_date_value(payload.get("payment_date")),
                            "raw_data": payload,
                            "created_at": datetime.utcnow(),
                        }
                        stmt = get_upsert_stmt(
                            Dividend,
                            ["symbol", "exercise_date", "cash_year"],
                            values,
                        )
                        await session.execute(stmt)
                        total += 1
                    await session.commit()

                if progress is not None:
                    progress["success_count"] = progress.get("success_count", 0) + 1
                    progress["stage_stats"]["dividends"]["success"] += 1
            except Exception as exc:
                logger.debug(f"Dividend sync failed for {symbol}: {exc}")
                if progress is not None:
                    progress["error_count"] = progress.get("error_count", 0) + 1
                    progress["stage_stats"]["dividends"]["errors"] += 1

            if progress is not None and sync_id is not None:
                progress["last_symbol"] = symbol
                if self._should_checkpoint(idx, len(symbols)):
                    await self._checkpoint(progress, sync_id)

        return total

    async def sync_insider_deals(
        self,
        symbols: List[str] = None,
        limit: int = 20,
        progress: Optional[Dict[str, Any]] = None,
        sync_id: Optional[int] = None,
    ) -> int:
        """Sync insider deals for specified symbols."""
        from vnibb.providers.vnstock.insider_deals import VnstockInsiderDealsFetcher

        if not symbols:
            async with async_session_maker() as session:
                result = await session.execute(select(Stock.symbol).where(Stock.is_active == 1))
                symbols = [r[0] for r in result.fetchall()]

        if not symbols:
            return 0

        total = 0
        if progress is not None:
            progress.setdefault("stage_stats", {})
            progress["stage"] = "insider_deals"
            progress["stage_stats"].setdefault(
                "insider_deals",
                {"success": 0, "errors": 0, "total": len(symbols)},
            )

        for idx, symbol in enumerate(symbols):
            await self._wait_for_rate_limit("profiles")
            try:
                items = await VnstockInsiderDealsFetcher.fetch(symbol, limit=limit)
                if not items:
                    continue

                async with async_session_maker() as session:
                    await session.execute(delete(InsiderDeal).where(InsiderDeal.symbol == symbol))
                    for item in items:
                        payload = item.model_dump()
                        announce_date = self._parse_date_value(
                            payload.get("transaction_date") or payload.get("registration_date")
                        )
                        if not announce_date:
                            announce_date = self._get_market_date()
                        ownership_before = payload.get("ownership_before")
                        ownership_after = payload.get("ownership_after")
                        deal_ratio = None
                        if ownership_before is not None and ownership_after is not None:
                            try:
                                deal_ratio = float(ownership_after) - float(ownership_before)
                            except (TypeError, ValueError):
                                deal_ratio = None

                        deal_quantity = payload.get("shares_executed") or payload.get(
                            "shares_registered"
                        )
                        values = {
                            "symbol": symbol,
                            "announce_date": announce_date,
                            "deal_method": payload.get("transaction_type"),
                            "deal_action": None,
                            "deal_quantity": deal_quantity,
                            "deal_price": None,
                            "deal_value": None,
                            "deal_ratio": deal_ratio,
                            "insider_name": payload.get("insider_name"),
                            "insider_position": payload.get("insider_position"),
                            "raw_data": payload,
                            "created_at": datetime.utcnow(),
                        }
                        await session.execute(InsiderDeal.__table__.insert().values(values))
                        total += 1
                    await session.commit()

                if progress is not None:
                    progress["success_count"] = progress.get("success_count", 0) + 1
                    progress["stage_stats"]["insider_deals"]["success"] += 1
            except Exception as exc:
                logger.debug(f"Insider deals sync failed for {symbol}: {exc}")
                if progress is not None:
                    progress["error_count"] = progress.get("error_count", 0) + 1
                    progress["stage_stats"]["insider_deals"]["errors"] += 1

            if progress is not None and sync_id is not None:
                progress["last_symbol"] = symbol
                if self._should_checkpoint(idx, len(symbols)):
                    await self._checkpoint(progress, sync_id)

        return total

    async def sync_shareholders(
        self,
        symbols: List[str] = None,
        progress: Optional[Dict[str, Any]] = None,
        sync_id: Optional[int] = None,
    ) -> int:
        """Sync major shareholders for specified symbols."""
        from vnibb.providers.vnstock.shareholders import (
            VnstockShareholdersFetcher,
            ShareholdersQueryParams,
        )

        if not symbols:
            async with async_session_maker() as session:
                result = await session.execute(select(Stock.symbol).where(Stock.is_active == 1))
                symbols = [r[0] for r in result.fetchall()]

        if not symbols:
            return 0

        total = 0
        if progress is not None:
            progress.setdefault("stage_stats", {})
            progress["stage"] = "shareholders"
            progress["stage_stats"].setdefault(
                "shareholders",
                {"success": 0, "errors": 0, "total": len(symbols)},
            )

        for idx, symbol in enumerate(symbols):
            await self._wait_for_rate_limit("profiles")
            try:
                params = ShareholdersQueryParams(symbol=symbol)
                items = await VnstockShareholdersFetcher.fetch(params)
                if not items:
                    continue

                async with async_session_maker() as session:
                    company_id = await self._get_or_create_company_id(session, symbol)
                    if not company_id:
                        continue
                    await session.execute(delete(Shareholder).where(Shareholder.symbol == symbol))
                    for item in items:
                        payload = item.model_dump()
                        values = {
                            "company_id": company_id,
                            "symbol": symbol,
                            "name": payload.get("shareholder_name") or "Unknown",
                            "shareholder_type": payload.get("shareholder_type"),
                            "shares_held": payload.get("shares_owned"),
                            "ownership_pct": payload.get("ownership_pct"),
                            "as_of_date": self._get_market_date(),
                            "updated_at": datetime.utcnow(),
                        }
                        await session.execute(Shareholder.__table__.insert().values(values))
                        total += 1
                    await session.commit()

                if progress is not None:
                    progress["success_count"] = progress.get("success_count", 0) + 1
                    progress["stage_stats"]["shareholders"]["success"] += 1
            except Exception as exc:
                logger.debug(f"Shareholder sync failed for {symbol}: {exc}")
                if progress is not None:
                    progress["error_count"] = progress.get("error_count", 0) + 1
                    progress["stage_stats"]["shareholders"]["errors"] += 1

            if progress is not None and sync_id is not None:
                progress["last_symbol"] = symbol
                if self._should_checkpoint(idx, len(symbols)):
                    await self._checkpoint(progress, sync_id)

        return total

    async def sync_officers(
        self,
        symbols: List[str] = None,
        progress: Optional[Dict[str, Any]] = None,
        sync_id: Optional[int] = None,
    ) -> int:
        """Sync company officers for specified symbols."""
        from vnibb.providers.vnstock.officers import (
            VnstockOfficersFetcher,
            OfficersQueryParams,
        )

        if not symbols:
            async with async_session_maker() as session:
                result = await session.execute(select(Stock.symbol).where(Stock.is_active == 1))
                symbols = [r[0] for r in result.fetchall()]

        if not symbols:
            return 0

        total = 0
        if progress is not None:
            progress.setdefault("stage_stats", {})
            progress["stage"] = "officers"
            progress["stage_stats"].setdefault(
                "officers",
                {"success": 0, "errors": 0, "total": len(symbols)},
            )

        for idx, symbol in enumerate(symbols):
            await self._wait_for_rate_limit("profiles")
            try:
                params = OfficersQueryParams(symbol=symbol)
                items = await VnstockOfficersFetcher.fetch(params)
                if not items:
                    continue

                async with async_session_maker() as session:
                    company_id = await self._get_or_create_company_id(session, symbol)
                    if not company_id:
                        continue
                    await session.execute(delete(Officer).where(Officer.symbol == symbol))
                    for item in items:
                        payload = item.model_dump()
                        values = {
                            "company_id": company_id,
                            "symbol": symbol,
                            "name": payload.get("name") or "Unknown",
                            "title": payload.get("position"),
                            "position_type": None,
                            "shares_held": payload.get("shares_owned"),
                            "ownership_pct": payload.get("ownership_pct"),
                            "updated_at": datetime.utcnow(),
                        }
                        await session.execute(Officer.__table__.insert().values(values))
                        total += 1
                    await session.commit()

                if progress is not None:
                    progress["success_count"] = progress.get("success_count", 0) + 1
                    progress["stage_stats"]["officers"]["success"] += 1
            except Exception as exc:
                logger.debug(f"Officer sync failed for {symbol}: {exc}")
                if progress is not None:
                    progress["error_count"] = progress.get("error_count", 0) + 1
                    progress["stage_stats"]["officers"]["errors"] += 1

            if progress is not None and sync_id is not None:
                progress["last_symbol"] = symbol
                if self._should_checkpoint(idx, len(symbols)):
                    await self._checkpoint(progress, sync_id)

        return total

    async def sync_subsidiaries(
        self,
        symbols: List[str] = None,
        progress: Optional[Dict[str, Any]] = None,
        sync_id: Optional[int] = None,
    ) -> int:
        """Sync subsidiaries for specified symbols."""
        from vnibb.providers.vnstock.subsidiaries import (
            VnstockSubsidiariesFetcher,
            SubsidiariesQueryParams,
        )

        if not symbols:
            async with async_session_maker() as session:
                result = await session.execute(select(Stock.symbol).where(Stock.is_active == 1))
                symbols = [r[0] for r in result.fetchall()]

        if not symbols:
            return 0

        total = 0
        if progress is not None:
            progress.setdefault("stage_stats", {})
            progress["stage"] = "subsidiaries"
            progress["stage_stats"].setdefault(
                "subsidiaries",
                {"success": 0, "errors": 0, "total": len(symbols)},
            )

        for idx, symbol in enumerate(symbols):
            await self._wait_for_rate_limit("profiles")
            try:
                params = SubsidiariesQueryParams(symbol=symbol)
                items = await VnstockSubsidiariesFetcher.fetch(params)
                if not items:
                    continue

                async with async_session_maker() as session:
                    await session.execute(delete(Subsidiary).where(Subsidiary.symbol == symbol))
                    for item in items:
                        payload = item.model_dump()
                        values = {
                            "symbol": symbol,
                            "subsidiary_name": payload.get("company_name") or "Unknown",
                            "subsidiary_symbol": None,
                            "ownership_pct": payload.get("ownership_pct"),
                            "charter_capital": payload.get("charter_capital"),
                            "relationship_type": None,
                            "business_description": None,
                            "updated_at": datetime.utcnow(),
                        }
                        await session.execute(Subsidiary.__table__.insert().values(values))
                        total += 1
                    await session.commit()

                if progress is not None:
                    progress["success_count"] = progress.get("success_count", 0) + 1
                    progress["stage_stats"]["subsidiaries"]["success"] += 1
            except Exception as exc:
                logger.debug(f"Subsidiaries sync failed for {symbol}: {exc}")
                if progress is not None:
                    progress["error_count"] = progress.get("error_count", 0) + 1
                    progress["stage_stats"]["subsidiaries"]["errors"] += 1

            if progress is not None and sync_id is not None:
                progress["last_symbol"] = symbol
                if self._should_checkpoint(idx, len(symbols)):
                    await self._checkpoint(progress, sync_id)

        return total

    async def sync_market_sectors(self) -> int:
        """Seed market sector master data from VN_SECTORS."""
        from vnibb.core.vn_sectors import get_all_sectors

        sectors = get_all_sectors()
        if not sectors:
            return 0

        total = 0
        async with async_session_maker() as session:
            for sector_code, cfg in sectors.items():
                safe_sector_code = str(sector_code)[:20]
                icb_code = ",".join(cfg.icb_codes) if cfg.icb_codes else None
                if icb_code:
                    icb_code = icb_code[:20]
                values = {
                    "sector_code": safe_sector_code,
                    "sector_name": cfg.name,
                    "sector_name_en": cfg.name_en,
                    "parent_code": None,
                    "level": 1,
                    "icb_code": icb_code,
                    "updated_at": datetime.utcnow(),
                }
                stmt = get_upsert_stmt(MarketSector, ["sector_code"], values)
                await session.execute(stmt)
                total += 1
            await session.commit()

        return total

    async def sync_foreign_trading(
        self,
        trade_date: Optional[date] = None,
        symbols: Optional[List[str]] = None,
        progress: Optional[Dict[str, Any]] = None,
        sync_id: Optional[int] = None,
    ) -> int:
        """Sync foreign trading data using price board batches."""
        from vnibb.providers.vnstock.price_board import VnstockPriceBoardFetcher

        trade_date = trade_date or self._get_market_date()

        if not symbols:
            async with async_session_maker() as session:
                result = await session.execute(select(Stock.symbol).where(Stock.is_active == 1))
                symbols = [r[0] for r in result.fetchall()]

        if not symbols:
            return 0

        if (
            settings.intraday_symbols_per_run > 0
            and len(symbols) > settings.intraday_symbols_per_run
        ):
            symbols = symbols[: settings.intraday_symbols_per_run]

        symbol_exchange: Dict[str, str] = {}
        symbol_chunk_index: Dict[str, int] = {}
        if settings.cache_foreign_trading_chunked:
            symbol_exchange, symbol_chunk_index = await self._get_exchange_and_chunk_index(
                symbols,
                settings.cache_chunk_size,
            )

        chunked_cache_records: List[Dict[str, Any]] = []

        start_index = 0
        if progress and progress.get("stage") == "foreign_trading":
            last_index = progress.get("last_index")
            if isinstance(last_index, int) and last_index >= 0:
                start_index = last_index + 1

        if progress is not None:
            progress.setdefault("stage_stats", {})
            progress["stage"] = "foreign_trading"
            progress["stage_index"] = DAILY_TRADING_STAGES.index("foreign_trading")
            progress["stage_stats"].setdefault(
                "foreign_trading",
                {"success": 0, "errors": 0, "total": len(symbols)},
            )

        batch_size = 50
        total = 0
        source = settings.vnstock_source or "KBS"
        for idx in range(start_index, len(symbols), batch_size):
            batch = symbols[idx : idx + batch_size]
            await self._wait_for_rate_limit("price_board")

            records = []
            try:
                records = await VnstockPriceBoardFetcher.fetch(
                    symbols=batch,
                    source=source,
                )
            except Exception as exc:
                logger.warning(f"Price board fetch failed ({source}): {exc}")

            if not records:
                if progress is not None:
                    progress["error_count"] = progress.get("error_count", 0) + len(batch)
                    progress["stage_stats"]["foreign_trading"]["errors"] += len(batch)
                continue

            async with async_session_maker() as session:
                for record in records:
                    payload = record.model_dump()
                    symbol = payload.get("symbol")
                    if not symbol:
                        continue
                    buy_vol = payload.get("foreign_buy_vol")
                    sell_vol = payload.get("foreign_sell_vol")
                    values = {
                        "symbol": symbol,
                        "trade_date": trade_date,
                        "buy_volume": buy_vol,
                        "sell_volume": sell_vol,
                        "net_volume": (buy_vol - sell_vol)
                        if buy_vol is not None and sell_vol is not None
                        else None,
                        "buy_value": None,
                        "sell_value": None,
                        "net_value": None,
                        "created_at": datetime.utcnow(),
                        "updated_at": datetime.utcnow(),
                    }
                    stmt = get_upsert_stmt(ForeignTrading, ["symbol", "trade_date"], values)
                    await session.execute(stmt)
                    total += 1

                    cache_payload = {
                        **values,
                        "trade_date": trade_date.isoformat(),
                    }
                    if settings.cache_foreign_trading_per_symbol:
                        cache_key = build_cache_key(
                            "vnibb",
                            "foreign_trading",
                            symbol,
                            trade_date.isoformat(),
                        )
                        await self._cache_set_json(
                            cache_key,
                            cache_payload,
                            CACHE_TTL_FOREIGN_TRADING,
                        )

                    if settings.cache_foreign_trading_chunked:
                        chunked_cache_records.append(cache_payload)

                    if progress is not None:
                        progress["success_count"] = progress.get("success_count", 0) + 1
                        progress["stage_stats"]["foreign_trading"]["success"] += 1

                await session.commit()

            if progress is not None and sync_id is not None:
                progress["last_index"] = idx + len(batch) - 1
                await self._checkpoint(
                    progress,
                    sync_id,
                    key=DAILY_TRADING_PROGRESS_KEY,
                    ttl=DAILY_TRADING_PROGRESS_TTL,
                )

        if settings.cache_foreign_trading_chunked and chunked_cache_records:
            await self._cache_chunked_records(
                ["vnibb", "foreign_trading"],
                trade_date,
                chunked_cache_records,
                symbol_exchange,
                symbol_chunk_index,
                CACHE_TTL_FOREIGN_TRADING,
            )

        return total

    async def sync_intraday_trades(
        self,
        trade_date: Optional[date] = None,
        symbols: Optional[List[str]] = None,
        progress: Optional[Dict[str, Any]] = None,
        sync_id: Optional[int] = None,
        limit: Optional[int] = None,
    ) -> int:
        """Sync intraday trades and compute daily order flow."""
        trade_date = trade_date or self._get_market_date()
        limit = limit or settings.intraday_limit

        if (
            settings.environment == "production"
            and not settings.intraday_allow_out_of_hours_in_prod
        ):
            if not self._is_market_hours() and not (
                settings.orderflow_at_close_only and self._is_after_market_close()
            ):
                logger.info("Intraday sync skipped outside market hours (production)")
                if progress is not None:
                    progress.setdefault("stage_stats", {})
                    progress["stage"] = "intraday_trades"
                    progress["stage_index"] = DAILY_TRADING_STAGES.index("intraday_trades")
                    progress["stage_stats"]["intraday_trades"] = {
                        "success": 0,
                        "errors": 0,
                        "total": 0,
                        "skipped": True,
                        "reason": "outside_market_hours_prod",
                    }
                    if sync_id is not None:
                        await self._checkpoint(
                            progress,
                            sync_id,
                            key=DAILY_TRADING_PROGRESS_KEY,
                            ttl=DAILY_TRADING_PROGRESS_TTL,
                        )
                return 0

        if settings.orderflow_at_close_only and not self._is_after_market_close():
            logger.info("Intraday sync skipped before market close")
            if progress is not None:
                progress.setdefault("stage_stats", {})
                progress["stage"] = "intraday_trades"
                progress["stage_index"] = DAILY_TRADING_STAGES.index("intraday_trades")
                progress["stage_stats"]["intraday_trades"] = {
                    "success": 0,
                    "errors": 0,
                    "total": 0,
                    "skipped": True,
                    "reason": "before_market_close",
                }
                if sync_id is not None:
                    await self._checkpoint(
                        progress,
                        sync_id,
                        key=DAILY_TRADING_PROGRESS_KEY,
                        ttl=DAILY_TRADING_PROGRESS_TTL,
                    )
            return 0

        if settings.intraday_require_market_hours and not self._is_market_hours():
            if not (settings.orderflow_at_close_only and self._is_after_market_close()):
                logger.info("Intraday sync skipped outside market hours")
                if progress is not None:
                    progress.setdefault("stage_stats", {})
                    progress["stage"] = "intraday_trades"
                    progress["stage_index"] = DAILY_TRADING_STAGES.index("intraday_trades")
                    progress["stage_stats"]["intraday_trades"] = {
                        "success": 0,
                        "errors": 0,
                        "total": 0,
                        "skipped": True,
                        "reason": "outside_market_hours",
                    }
                    if sync_id is not None:
                        await self._checkpoint(
                            progress,
                            sync_id,
                            key=DAILY_TRADING_PROGRESS_KEY,
                            ttl=DAILY_TRADING_PROGRESS_TTL,
                        )
                return 0

        if not symbols:
            async with async_session_maker() as session:
                result = await session.execute(select(Stock.symbol).where(Stock.is_active == 1))
                symbols = [r[0] for r in result.fetchall()]

        if not symbols:
            return 0

        if (
            settings.intraday_symbols_per_run > 0
            and len(symbols) > settings.intraday_symbols_per_run
        ):
            symbols = symbols[: settings.intraday_symbols_per_run]

        symbol_exchange: Dict[str, str] = {}
        symbol_chunk_index: Dict[str, int] = {}
        if settings.cache_order_flow_chunked:
            symbol_exchange, symbol_chunk_index = await self._get_exchange_and_chunk_index(
                symbols,
                settings.cache_chunk_size,
            )

        order_flow_cache_records: List[Dict[str, Any]] = []

        foreign_lookup: Dict[str, Dict[str, Any]] = {}
        async with async_session_maker() as session:
            result = await session.execute(
                select(ForeignTrading).where(ForeignTrading.trade_date == trade_date)
            )
            for row in result.scalars().all():
                foreign_lookup[row.symbol] = {
                    "foreign_buy_volume": row.buy_volume,
                    "foreign_sell_volume": row.sell_volume,
                    "foreign_net_volume": row.net_volume,
                }

        start_index = 0
        if progress and progress.get("stage") == "intraday_trades":
            last_symbol = progress.get("last_symbol")
            if last_symbol and last_symbol in symbols:
                start_index = symbols.index(last_symbol) + 1

        if progress is not None:
            progress.setdefault("stage_stats", {})
            progress["stage"] = "intraday_trades"
            progress["stage_index"] = DAILY_TRADING_STAGES.index("intraday_trades")
            progress["stage_stats"].setdefault(
                "intraday_trades",
                {"success": 0, "errors": 0, "total": len(symbols)},
            )

        total = 0
        consecutive_429 = 0
        store_intraday = settings.store_intraday_trades
        error_counts: Dict[str, int] = {}
        error_samples: List[str] = []
        for idx in range(start_index, len(symbols)):
            symbol = symbols[idx]
            await self._wait_for_rate_limit("intraday")
            try:
                source = settings.vnstock_source if settings.vnstock_source != "TCBS" else "VCI"

                async def _fetch_intraday() -> List[Dict[str, Any]]:
                    def _sync_fetch() -> List[Dict[str, Any]]:
                        from vnstock import Vnstock

                        stock = Vnstock().stock(symbol=symbol, source=source)
                        df = stock.quote.intraday()
                        if df is None or df.empty:
                            return []
                        return df.tail(limit).to_dict("records")

                    loop = asyncio.get_event_loop()
                    return await asyncio.wait_for(
                        loop.run_in_executor(None, _sync_fetch),
                        timeout=settings.vnstock_timeout,
                    )

                raw_rows = await _fetch_intraday()
                if not raw_rows:
                    continue

                rows: List[Dict[str, Any]] = [] if store_intraday else []
                buy_volume = 0
                sell_volume = 0
                buy_value = 0.0
                sell_value = 0.0
                big_order_count = 0

                for raw in raw_rows:
                    if not isinstance(raw, dict):
                        continue
                    time_val = raw.get("time") or raw.get("thoiGian") or raw.get("datetime")
                    trade_time = None
                    if isinstance(time_val, datetime):
                        trade_time = time_val
                    elif hasattr(pd, "Timestamp") and isinstance(time_val, pd.Timestamp):
                        trade_time = time_val.to_pydatetime()
                    elif isinstance(time_val, date):
                        trade_time = datetime.combine(time_val, datetime.min.time())
                    elif time_val is not None:
                        time_str = str(time_val)
                        try:
                            trade_time = datetime.fromisoformat(time_str.replace("Z", "+00:00"))
                        except ValueError:
                            try:
                                parsed_time = datetime.strptime(time_str, "%H:%M:%S").time()
                                trade_time = datetime.combine(trade_date, parsed_time)
                            except ValueError:
                                trade_time = None

                    if not trade_time:
                        continue

                    price = raw.get("price") or raw.get("close") or raw.get("gia")
                    volume = raw.get("volume") or raw.get("khoiLuong")
                    if price is None or volume is None:
                        continue

                    try:
                        price = float(price)
                        volume = int(volume)
                    except (TypeError, ValueError):
                        continue
                    match_type = (
                        raw.get("matchType") or raw.get("action") or raw.get("loaiGiaoDich") or ""
                    ).upper()

                    if match_type.startswith("B"):
                        buy_volume += volume
                        buy_value += price * volume
                    elif match_type.startswith("S"):
                        sell_volume += volume
                        sell_value += price * volume

                    if price * volume >= settings.big_order_threshold_vnd:
                        big_order_count += 1

                    if store_intraday:
                        rows.append(
                            {
                                "symbol": symbol,
                                "trade_time": trade_time,
                                "price": price,
                                "volume": volume,
                                "match_type": match_type or None,
                                "created_at": datetime.utcnow(),
                            }
                        )

                if store_intraday and rows:
                    async with async_session_maker() as session:
                        await session.execute(IntradayTrade.__table__.insert(), rows)
                        await session.commit()
                        total += len(rows)

                    cache_key = build_cache_key("vnibb", "intraday", "latest", symbol)
                    cache_payload = [row for row in rows[-100:]]
                    await self._cache_set_json(cache_key, cache_payload, CACHE_TTL_INTRADAY)

                order_flow_values = {
                    "symbol": symbol,
                    "trade_date": trade_date,
                    "buy_volume": buy_volume or None,
                    "sell_volume": sell_volume or None,
                    "buy_value": buy_value or None,
                    "sell_value": sell_value or None,
                    "net_volume": (buy_volume - sell_volume) if buy_volume or sell_volume else None,
                    "net_value": (buy_value - sell_value) if buy_value or sell_value else None,
                    "big_order_count": big_order_count or None,
                    "block_trade_count": None,
                    "foreign_buy_volume": foreign_lookup.get(symbol, {}).get("foreign_buy_volume"),
                    "foreign_sell_volume": foreign_lookup.get(symbol, {}).get(
                        "foreign_sell_volume"
                    ),
                    "foreign_net_volume": foreign_lookup.get(symbol, {}).get("foreign_net_volume"),
                    "proprietary_buy_volume": None,
                    "proprietary_sell_volume": None,
                    "proprietary_net_volume": None,
                    "created_at": datetime.utcnow(),
                    "updated_at": datetime.utcnow(),
                }
                async with async_session_maker() as session:
                    stmt = get_upsert_stmt(
                        OrderFlowDaily, ["symbol", "trade_date"], order_flow_values
                    )
                    await session.execute(stmt)
                    await session.commit()

                order_flow_payload = {
                    **order_flow_values,
                    "trade_date": trade_date.isoformat(),
                }

                if settings.cache_order_flow_per_symbol:
                    order_flow_key = build_cache_key(
                        "vnibb",
                        "order_flow",
                        "daily",
                        symbol,
                        trade_date.isoformat(),
                    )
                    await self._cache_set_json(
                        order_flow_key,
                        order_flow_payload,
                        CACHE_TTL_ORDER_FLOW,
                    )

                if settings.cache_order_flow_chunked:
                    order_flow_cache_records.append(order_flow_payload)

                if progress is not None:
                    progress["success_count"] = progress.get("success_count", 0) + 1
                    progress["stage_stats"]["intraday_trades"]["success"] += 1
                consecutive_429 = 0
            except Exception as exc:
                message = str(exc)
                error_key = type(exc).__name__
                if "RetryError" in message:
                    error_key = "RetryError"
                error_counts[error_key] = error_counts.get(error_key, 0) + 1
                if len(error_samples) < 5:
                    error_samples.append(f"{symbol}:{error_key}")
                logger.debug(f"Intraday sync failed for {symbol}: {message}")
                if progress is not None:
                    progress["error_count"] = progress.get("error_count", 0) + 1
                    progress["stage_stats"]["intraday_trades"]["errors"] += 1
                if "429" in message:
                    consecutive_429 += 1
                    backoff = min(
                        settings.intraday_backoff_max_seconds,
                        settings.intraday_backoff_seconds * max(1, consecutive_429),
                    )
                    logger.warning(f"Intraday rate limited; backing off {backoff}s")
                    await asyncio.sleep(backoff)

            if progress is not None and sync_id is not None:
                progress["last_symbol"] = symbol
                if self._should_checkpoint(idx, len(symbols)):
                    await self._checkpoint(
                        progress,
                        sync_id,
                        key=DAILY_TRADING_PROGRESS_KEY,
                        ttl=DAILY_TRADING_PROGRESS_TTL,
                    )

        if error_counts:
            total_errors = sum(error_counts.values())
            logger.warning(
                "Intraday sync completed with errors",
                extra={
                    "errors": total_errors,
                    "error_breakdown": error_counts,
                    "error_samples": error_samples,
                },
            )

        if settings.cache_order_flow_chunked and order_flow_cache_records:
            await self._cache_chunked_records(
                ["vnibb", "order_flow", "daily"],
                trade_date,
                order_flow_cache_records,
                symbol_exchange,
                symbol_chunk_index,
                CACHE_TTL_ORDER_FLOW,
            )

        return total

    async def sync_orderbook_snapshots(
        self,
        symbols: Optional[List[str]] = None,
        progress: Optional[Dict[str, Any]] = None,
        sync_id: Optional[int] = None,
    ) -> int:
        """Capture order book snapshots for symbols."""
        from vnibb.providers.vnstock.price_depth import VnstockPriceDepthFetcher

        if settings.orderbook_at_close_only and not self._is_after_market_close():
            logger.info("Orderbook snapshot skipped before market close")
            if progress is not None:
                progress.setdefault("stage_stats", {})
                progress["stage"] = "orderbook_snapshots"
                progress["stage_index"] = DAILY_TRADING_STAGES.index("orderbook_snapshots")
                progress["stage_stats"]["orderbook_snapshots"] = {
                    "success": 0,
                    "errors": 0,
                    "total": 0,
                    "skipped": True,
                    "reason": "before_market_close",
                }
                if sync_id is not None:
                    await self._checkpoint(
                        progress,
                        sync_id,
                        key=DAILY_TRADING_PROGRESS_KEY,
                        ttl=DAILY_TRADING_PROGRESS_TTL,
                    )
            return 0

        if settings.intraday_require_market_hours and not self._is_market_hours():
            if not (settings.orderbook_at_close_only and self._is_after_market_close()):
                logger.info("Orderbook snapshot skipped outside market hours")
                if progress is not None:
                    progress.setdefault("stage_stats", {})
                    progress["stage"] = "orderbook_snapshots"
                    progress["stage_index"] = DAILY_TRADING_STAGES.index("orderbook_snapshots")
                    progress["stage_stats"]["orderbook_snapshots"] = {
                        "success": 0,
                        "errors": 0,
                        "total": 0,
                        "skipped": True,
                        "reason": "outside_market_hours",
                    }
                    if sync_id is not None:
                        await self._checkpoint(
                            progress,
                            sync_id,
                            key=DAILY_TRADING_PROGRESS_KEY,
                            ttl=DAILY_TRADING_PROGRESS_TTL,
                        )
                return 0

        if not symbols:
            async with async_session_maker() as session:
                result = await session.execute(select(Stock.symbol).where(Stock.is_active == 1))
                symbols = [r[0] for r in result.fetchall()]

        if not symbols:
            return 0

        start_index = 0
        if progress and progress.get("stage") == "orderbook_snapshots":
            last_symbol = progress.get("last_symbol")
            if last_symbol and last_symbol in symbols:
                start_index = symbols.index(last_symbol) + 1

        if progress is not None:
            progress.setdefault("stage_stats", {})
            progress["stage"] = "orderbook_snapshots"
            progress["stage_index"] = DAILY_TRADING_STAGES.index("orderbook_snapshots")
            progress["stage_stats"].setdefault(
                "orderbook_snapshots",
                {"success": 0, "errors": 0, "total": len(symbols)},
            )

        total = 0
        snapshot_time = datetime.utcnow()
        trade_date = snapshot_time.date()
        source = settings.vnstock_source or "KBS"

        async with async_session_maker() as session:
            existing = await session.execute(
                select(func.count(OrderbookSnapshot.id)).where(
                    func.date(OrderbookSnapshot.snapshot_time) == trade_date
                )
            )
            if (existing.scalar() or 0) > 0:
                logger.info("Orderbook snapshot already captured for today; skipping")
                if progress is not None:
                    progress.setdefault("stage_stats", {})
                    progress["stage"] = "orderbook_snapshots"
                    progress["stage_index"] = DAILY_TRADING_STAGES.index("orderbook_snapshots")
                    progress["stage_stats"]["orderbook_snapshots"] = {
                        "success": 0,
                        "errors": 0,
                        "total": 0,
                        "skipped": True,
                        "reason": "already_captured",
                    }
                    if sync_id is not None:
                        await self._checkpoint(
                            progress,
                            sync_id,
                            key=DAILY_TRADING_PROGRESS_KEY,
                            ttl=DAILY_TRADING_PROGRESS_TTL,
                        )
                return 0

        for idx in range(start_index, len(symbols)):
            symbol = symbols[idx]
            await self._wait_for_rate_limit("orderbook")
            try:
                depth = await VnstockPriceDepthFetcher.fetch(
                    symbol=symbol,
                    source=source,
                )
                payload = depth.model_dump()
                values = {
                    "symbol": symbol,
                    "snapshot_time": snapshot_time,
                    "price_depth": payload,
                    "bid1_price": payload.get("bid_1", {}).get("price")
                    if payload.get("bid_1")
                    else None,
                    "bid1_volume": payload.get("bid_1", {}).get("volume")
                    if payload.get("bid_1")
                    else None,
                    "bid2_price": payload.get("bid_2", {}).get("price")
                    if payload.get("bid_2")
                    else None,
                    "bid2_volume": payload.get("bid_2", {}).get("volume")
                    if payload.get("bid_2")
                    else None,
                    "bid3_price": payload.get("bid_3", {}).get("price")
                    if payload.get("bid_3")
                    else None,
                    "bid3_volume": payload.get("bid_3", {}).get("volume")
                    if payload.get("bid_3")
                    else None,
                    "ask1_price": payload.get("ask_1", {}).get("price")
                    if payload.get("ask_1")
                    else None,
                    "ask1_volume": payload.get("ask_1", {}).get("volume")
                    if payload.get("ask_1")
                    else None,
                    "ask2_price": payload.get("ask_2", {}).get("price")
                    if payload.get("ask_2")
                    else None,
                    "ask2_volume": payload.get("ask_2", {}).get("volume")
                    if payload.get("ask_2")
                    else None,
                    "ask3_price": payload.get("ask_3", {}).get("price")
                    if payload.get("ask_3")
                    else None,
                    "ask3_volume": payload.get("ask_3", {}).get("volume")
                    if payload.get("ask_3")
                    else None,
                    "total_bid_volume": payload.get("total_bid_volume"),
                    "total_ask_volume": payload.get("total_ask_volume"),
                    "created_at": datetime.utcnow(),
                }
                async with async_session_maker() as session:
                    await session.execute(OrderbookSnapshot.__table__.insert(), values)
                    await session.commit()
                    total += 1

                latest_key = build_cache_key("vnibb", "orderbook", "latest", symbol)
                await self._cache_set_json(latest_key, payload, CACHE_TTL_ORDERBOOK)

                daily_key = build_cache_key(
                    "vnibb",
                    "orderbook",
                    "daily",
                    symbol,
                    trade_date.isoformat(),
                )
                await self._cache_set_json(daily_key, payload, CACHE_TTL_ORDERBOOK_DAILY)

                if progress is not None:
                    progress["success_count"] = progress.get("success_count", 0) + 1
                    progress["stage_stats"]["orderbook_snapshots"]["success"] += 1
            except Exception as exc:
                logger.warning(f"Orderbook snapshot failed for {symbol}: {exc}")
                if progress is not None:
                    progress["error_count"] = progress.get("error_count", 0) + 1
                    progress["stage_stats"]["orderbook_snapshots"]["errors"] += 1

            if progress is not None and sync_id is not None:
                progress["last_symbol"] = symbol
                if self._should_checkpoint(idx, len(symbols)):
                    await self._checkpoint(
                        progress,
                        sync_id,
                        key=DAILY_TRADING_PROGRESS_KEY,
                        ttl=DAILY_TRADING_PROGRESS_TTL,
                    )

        return total

    async def sync_block_trades(
        self,
        trade_date: Optional[date] = None,
        symbols: Optional[List[str]] = None,
        progress: Optional[Dict[str, Any]] = None,
        sync_id: Optional[int] = None,
    ) -> int:
        """Detect block trades from intraday data."""
        from vnibb.services.insider_tracking import InsiderTrackingService

        trade_date = trade_date or self._get_market_date()

        if not settings.store_intraday_trades:
            logger.info("Block trade detection skipped (intraday storage disabled)")
            if progress is not None:
                progress.setdefault("stage_stats", {})
                progress["stage"] = "block_trades"
                progress["stage_index"] = DAILY_TRADING_STAGES.index("block_trades")
                progress["stage_stats"]["block_trades"] = {
                    "success": 0,
                    "errors": 0,
                    "total": 0,
                    "skipped": True,
                    "reason": "intraday_storage_disabled",
                }
                if sync_id is not None:
                    await self._checkpoint(
                        progress,
                        sync_id,
                        key=DAILY_TRADING_PROGRESS_KEY,
                        ttl=DAILY_TRADING_PROGRESS_TTL,
                    )
            return 0

        if settings.orderflow_at_close_only and not self._is_after_market_close():
            logger.info("Block trade detection skipped before market close")
            if progress is not None:
                progress.setdefault("stage_stats", {})
                progress["stage"] = "block_trades"
                progress["stage_index"] = DAILY_TRADING_STAGES.index("block_trades")
                progress["stage_stats"]["block_trades"] = {
                    "success": 0,
                    "errors": 0,
                    "total": 0,
                    "skipped": True,
                    "reason": "before_market_close",
                }
                if sync_id is not None:
                    await self._checkpoint(
                        progress,
                        sync_id,
                        key=DAILY_TRADING_PROGRESS_KEY,
                        ttl=DAILY_TRADING_PROGRESS_TTL,
                    )
            return 0

        if settings.intraday_require_market_hours and not self._is_market_hours():
            if not (settings.orderflow_at_close_only and self._is_after_market_close()):
                logger.info("Block trade detection skipped outside market hours")
                if progress is not None:
                    progress.setdefault("stage_stats", {})
                    progress["stage"] = "block_trades"
                    progress["stage_index"] = DAILY_TRADING_STAGES.index("block_trades")
                    progress["stage_stats"]["block_trades"] = {
                        "success": 0,
                        "errors": 0,
                        "total": 0,
                        "skipped": True,
                        "reason": "outside_market_hours",
                    }
                    if sync_id is not None:
                        await self._checkpoint(
                            progress,
                            sync_id,
                            key=DAILY_TRADING_PROGRESS_KEY,
                            ttl=DAILY_TRADING_PROGRESS_TTL,
                        )
                return 0

        if not symbols:
            async with async_session_maker() as session:
                result = await session.execute(select(Stock.symbol).where(Stock.is_active == 1))
                symbols = [r[0] for r in result.fetchall()]

        if not symbols:
            return 0

        start_index = 0
        if progress and progress.get("stage") == "block_trades":
            last_symbol = progress.get("last_symbol")
            if last_symbol and last_symbol in symbols:
                start_index = symbols.index(last_symbol) + 1

        if progress is not None:
            progress.setdefault("stage_stats", {})
            progress["stage"] = "block_trades"
            progress["stage_index"] = DAILY_TRADING_STAGES.index("block_trades")
            progress["stage_stats"].setdefault(
                "block_trades",
                {"success": 0, "errors": 0, "total": len(symbols)},
            )

        total = 0
        async with async_session_maker() as session:
            service = InsiderTrackingService(session)
            for idx in range(start_index, len(symbols)):
                symbol = symbols[idx]
                try:
                    trades = await service.detect_block_trades(
                        symbol=symbol,
                        threshold=settings.big_order_threshold_vnd,
                    )
                    total += len(trades)

                    if trades:
                        payload = [
                            {
                                "symbol": t.symbol,
                                "side": t.side,
                                "quantity": t.quantity,
                                "price": t.price,
                                "value": t.value,
                                "trade_time": t.trade_time.isoformat(),
                            }
                            for t in trades
                        ]
                        cache_key = build_cache_key(
                            "vnibb",
                            "block_trades",
                            "daily",
                            symbol,
                            trade_date.isoformat(),
                        )
                        await self._cache_set_json(cache_key, payload, CACHE_TTL_BLOCK_TRADES)

                        await session.execute(
                            update(OrderFlowDaily)
                            .where(
                                OrderFlowDaily.symbol == symbol,
                                OrderFlowDaily.trade_date == trade_date,
                            )
                            .values(
                                block_trade_count=len(trades),
                                updated_at=datetime.utcnow(),
                            )
                        )
                        await session.commit()

                        result = await session.execute(
                            select(OrderFlowDaily).where(
                                OrderFlowDaily.symbol == symbol,
                                OrderFlowDaily.trade_date == trade_date,
                            )
                        )
                        flow_row = result.scalar_one_or_none()
                        if flow_row:
                            flow_payload = {
                                "symbol": flow_row.symbol,
                                "trade_date": flow_row.trade_date.isoformat(),
                                "buy_volume": flow_row.buy_volume,
                                "sell_volume": flow_row.sell_volume,
                                "buy_value": flow_row.buy_value,
                                "sell_value": flow_row.sell_value,
                                "net_volume": flow_row.net_volume,
                                "net_value": flow_row.net_value,
                                "big_order_count": flow_row.big_order_count,
                                "block_trade_count": flow_row.block_trade_count,
                                "foreign_buy_volume": flow_row.foreign_buy_volume,
                                "foreign_sell_volume": flow_row.foreign_sell_volume,
                                "foreign_net_volume": flow_row.foreign_net_volume,
                                "proprietary_buy_volume": flow_row.proprietary_buy_volume,
                                "proprietary_sell_volume": flow_row.proprietary_sell_volume,
                                "proprietary_net_volume": flow_row.proprietary_net_volume,
                            }

                            if settings.cache_order_flow_per_symbol:
                                flow_key = build_cache_key(
                                    "vnibb",
                                    "order_flow",
                                    "daily",
                                    symbol,
                                    trade_date.isoformat(),
                                )
                                await self._cache_set_json(
                                    flow_key,
                                    flow_payload,
                                    CACHE_TTL_ORDER_FLOW,
                                )

                            if settings.cache_order_flow_chunked:
                                exchange = symbol_exchange.get(symbol, "UNKNOWN")
                                chunk_index = symbol_chunk_index.get(symbol, 0)
                                await self._upsert_chunked_record(
                                    ["vnibb", "order_flow", "daily"],
                                    trade_date,
                                    flow_payload,
                                    exchange,
                                    chunk_index,
                                    CACHE_TTL_ORDER_FLOW,
                                )

                    if progress is not None:
                        progress["success_count"] = progress.get("success_count", 0) + 1
                        progress["stage_stats"]["block_trades"]["success"] += 1
                except Exception as exc:
                    logger.warning(f"Block trade detection failed for {symbol}: {exc}")
                    if progress is not None:
                        progress["error_count"] = progress.get("error_count", 0) + 1
                        progress["stage_stats"]["block_trades"]["errors"] += 1

                if progress is not None and sync_id is not None:
                    progress["last_symbol"] = symbol
                    if self._should_checkpoint(idx, len(symbols)):
                        await self._checkpoint(
                            progress,
                            sync_id,
                            key=DAILY_TRADING_PROGRESS_KEY,
                            ttl=DAILY_TRADING_PROGRESS_TTL,
                        )

        return total

    async def sync_derivatives_prices(
        self,
        trade_date: Optional[date] = None,
        progress: Optional[Dict[str, Any]] = None,
        sync_id: Optional[int] = None,
    ) -> int:
        """Sync derivatives/futures price data."""
        from vnibb.providers.vnstock.derivatives import VnstockDerivativesFetcher

        trade_date = trade_date or self._get_market_date()
        start_date = trade_date - timedelta(days=7)

        if settings.derivatives_symbols:
            symbols = [
                s.strip().upper() for s in settings.derivatives_symbols.split(",") if s.strip()
            ]
        else:
            symbols = await VnstockDerivativesFetcher.list_contracts()

        if not symbols:
            return 0

        start_index = 0
        if progress and progress.get("stage") == "derivatives":
            last_symbol = progress.get("last_symbol")
            if last_symbol and last_symbol in symbols:
                start_index = symbols.index(last_symbol) + 1

        if progress is not None:
            progress.setdefault("stage_stats", {})
            progress["stage"] = "derivatives"
            progress["stage_index"] = DAILY_TRADING_STAGES.index("derivatives")
            progress["stage_stats"].setdefault(
                "derivatives",
                {"success": 0, "errors": 0, "total": len(symbols)},
            )

        total = 0
        for idx in range(start_index, len(symbols)):
            symbol = symbols[idx]
            await self._wait_for_rate_limit("derivatives")
            try:
                data = await VnstockDerivativesFetcher.fetch(
                    symbol=symbol,
                    start_date=start_date,
                    end_date=trade_date,
                    interval="1D",
                )
                if not data:
                    continue

                async with async_session_maker() as session:
                    for row in data:
                        try:
                            row_date = row.time
                            parsed_date = None
                            if row_date:
                                if "T" in row_date or " " in row_date:
                                    parsed_date = datetime.fromisoformat(
                                        row_date.replace("Z", "+00:00")
                                    ).date()
                                else:
                                    parsed_date = datetime.fromisoformat(row_date).date()
                            if not parsed_date:
                                continue
                            values = {
                                "symbol": symbol,
                                "trade_date": parsed_date,
                                "open": row.open,
                                "high": row.high,
                                "low": row.low,
                                "close": row.close,
                                "volume": row.volume,
                                "open_interest": row.open_interest,
                                "interval": "1D",
                                "created_at": datetime.utcnow(),
                            }
                            stmt = get_upsert_stmt(
                                DerivativePrice,
                                ["symbol", "trade_date", "interval"],
                                values,
                            )
                            await session.execute(stmt)
                            total += 1
                        except Exception as row_exc:
                            logger.debug(f"Derivative row skipped for {symbol}: {row_exc}")
                    await session.commit()

                latest = data[-1]
                latest_key = build_cache_key("vnibb", "derivatives", "latest", symbol)
                await self._cache_set_json(
                    latest_key,
                    latest.model_dump(),
                    CACHE_TTL_DERIVATIVES_LATEST,
                )

                recent = [row.model_dump() for row in data[-RECENT_DERIVATIVE_DAYS:]]
                recent_key = build_cache_key("vnibb", "derivatives", "recent", symbol)
                await self._cache_set_json(
                    recent_key,
                    recent,
                    CACHE_TTL_DERIVATIVES_RECENT,
                )

                if progress is not None:
                    progress["success_count"] = progress.get("success_count", 0) + 1
                    progress["stage_stats"]["derivatives"]["success"] += 1
            except Exception as exc:
                logger.warning(f"Derivatives sync failed for {symbol}: {exc}")
                if progress is not None:
                    progress["error_count"] = progress.get("error_count", 0) + 1
                    progress["stage_stats"]["derivatives"]["errors"] += 1

            if progress is not None and sync_id is not None:
                progress["last_symbol"] = symbol
                await self._checkpoint(
                    progress,
                    sync_id,
                    key=DAILY_TRADING_PROGRESS_KEY,
                    ttl=DAILY_TRADING_PROGRESS_TTL,
                )

        return total

    async def sync_warrant_prices(
        self,
        trade_date: Optional[date] = None,
        progress: Optional[Dict[str, Any]] = None,
        sync_id: Optional[int] = None,
    ) -> int:
        """Sync warrant prices for configured symbols."""
        trade_date = trade_date or self._get_market_date()
        if not settings.warrant_symbols:
            logger.info("No warrant symbols configured; skipping warrant sync.")
            return 0

        symbols = [s.strip().upper() for s in settings.warrant_symbols if s.strip()]
        if not symbols:
            return 0

        if progress is not None:
            progress.setdefault("stage_stats", {})
            progress["stage"] = "warrants"
            progress["stage_index"] = DAILY_TRADING_STAGES.index("warrants")
            progress["stage_stats"].setdefault(
                "warrants",
                {"success": 0, "errors": 0, "total": len(symbols)},
            )

        async with async_session_maker() as session:
            for symbol in symbols:
                values = {
                    "symbol": symbol,
                    "company_name": symbol,
                    "exchange": "WARRANT",
                    "is_active": 1,
                    "created_at": datetime.utcnow(),
                    "updated_at": datetime.utcnow(),
                }
                stmt = get_upsert_stmt(Stock, ["symbol"], values)
                await session.execute(stmt)
            await session.commit()

        await self.sync_daily_prices(symbols=symbols, days=1)

        if progress is not None:
            progress["success_count"] = progress.get("success_count", 0) + len(symbols)
            progress["stage_stats"]["warrants"]["success"] += len(symbols)
            if sync_id is not None:
                await self._checkpoint(
                    progress,
                    sync_id,
                    key=DAILY_TRADING_PROGRESS_KEY,
                    ttl=DAILY_TRADING_PROGRESS_TTL,
                )

        return len(symbols)

    async def run_daily_trading_updates(
        self,
        trade_date: Optional[date] = None,
        resume: bool = True,
        job_id: Optional[str] = None,
    ) -> None:
        """Run daily updater for trading flow and derivatives."""
        trade_date = trade_date or self._get_market_date()
        progress = None

        if resume:
            progress = await self._load_progress(key=DAILY_TRADING_PROGRESS_KEY)

        if progress is None:
            job_id = job_id or f"daily-trading-{uuid4().hex[:8]}"
            progress = {
                "job_id": job_id,
                "status": "running",
                "stage": DAILY_TRADING_STAGES[0],
                "stage_index": 0,
                "success_count": 0,
                "error_count": 0,
                "stage_stats": {},
                "trade_date": trade_date.isoformat(),
            }
        else:
            progress.setdefault("success_count", 0)
            progress.setdefault("error_count", 0)
            progress.setdefault("stage_stats", {})
            if progress.get("trade_date"):
                try:
                    trade_date = date.fromisoformat(progress["trade_date"])
                except ValueError:
                    pass

        sync_id = progress.get("sync_id")
        if not sync_id:
            sync_id = await self._create_sync_record("daily_trading", progress["job_id"], 1)
            progress["sync_id"] = sync_id
            await self._checkpoint(
                progress,
                sync_id,
                key=DAILY_TRADING_PROGRESS_KEY,
                ttl=DAILY_TRADING_PROGRESS_TTL,
            )

        start_index = progress.get("stage_index", 0)

        try:
            for stage in DAILY_TRADING_STAGES[start_index:]:
                progress["stage"] = stage
                progress["stage_index"] = DAILY_TRADING_STAGES.index(stage)
                await self._checkpoint(
                    progress,
                    sync_id,
                    key=DAILY_TRADING_PROGRESS_KEY,
                    ttl=DAILY_TRADING_PROGRESS_TTL,
                )

                if stage == "foreign_trading":
                    await self.sync_foreign_trading(
                        trade_date=trade_date,
                        progress=progress,
                        sync_id=sync_id,
                    )
                elif stage == "intraday_trades":
                    await self.sync_intraday_trades(
                        trade_date=trade_date,
                        progress=progress,
                        sync_id=sync_id,
                    )
                elif stage == "orderbook_snapshots":
                    await self.sync_orderbook_snapshots(
                        progress=progress,
                        sync_id=sync_id,
                    )
                elif stage == "block_trades":
                    await self.sync_block_trades(
                        trade_date=trade_date,
                        progress=progress,
                        sync_id=sync_id,
                    )
                elif stage == "derivatives":
                    await self.sync_derivatives_prices(
                        trade_date=trade_date,
                        progress=progress,
                        sync_id=sync_id,
                    )
                elif stage == "warrants":
                    await self.sync_warrant_prices(
                        trade_date=trade_date,
                        progress=progress,
                        sync_id=sync_id,
                    )

            cleanup_results: Dict[str, int] = {}
            for label, action in (
                ("intraday_trades", self.cleanup_intraday_trades),
                ("orderbook_snapshots", self.cleanup_orderbook_snapshots),
                ("block_trades", self.cleanup_block_trades),
                ("foreign_trading", self.cleanup_foreign_trading),
                ("order_flow_daily", self.cleanup_order_flow_daily),
            ):
                try:
                    removed = await action()
                    if removed:
                        cleanup_results[label] = removed
                except Exception as exc:
                    logger.warning(f"Retention cleanup failed for {label}: {exc}")

            if cleanup_results:
                logger.info(f"Retention cleanup results: {cleanup_results}")

            progress["status"] = "completed"
            await self._update_sync_record(sync_id, status="completed", additional_data=progress)
            await self._clear_progress(key=DAILY_TRADING_PROGRESS_KEY)
            logger.info("✅ Daily trading updates completed successfully.")
        except Exception as exc:
            progress["status"] = "failed"
            await self._update_sync_record(sync_id, status="failed", additional_data=progress)
            logger.error(f"Daily trading updates failed: {exc}")
            raise

    async def run_reinforcement(
        self,
        symbols: List[str],
        domains: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """Run targeted symbol reinforcement using reserved low-throughput budget."""
        normalized_symbols = sorted(
            {
                str(symbol).upper().strip()
                for symbol in (symbols or [])
                if symbol and str(symbol).strip()
            }
        )
        if not normalized_symbols:
            return {
                "status": "skipped",
                "reason": "no_symbols",
                "symbols_count": 0,
                "domains": [],
                "domain_results": [],
            }

        allowed_domains = {"prices", "financials", "ratios", "shareholders", "officers"}
        requested_domains = [
            domain
            for domain in (domains or ["prices", "financials", "ratios", "shareholders"])
            if domain in allowed_domains
        ]

        token = RATE_MODE_CONTEXT.set(RATE_MODE_REINFORCEMENT)
        started_at = datetime.utcnow()
        domain_results: List[Dict[str, Any]] = []
        try:
            for domain in requested_domains:
                domain_started = datetime.utcnow()
                try:
                    if domain == "prices":
                        await self.sync_daily_prices(symbols=normalized_symbols, days=40)
                    elif domain == "financials":
                        await self.sync_financials(symbols=normalized_symbols, period="quarter")
                        await self.sync_financials(symbols=normalized_symbols, period="year")
                    elif domain == "ratios":
                        await self.sync_financial_ratios(
                            symbols=normalized_symbols, period="quarter"
                        )
                        await self.sync_financial_ratios(symbols=normalized_symbols, period="year")
                    elif domain == "shareholders":
                        await self.sync_shareholders(symbols=normalized_symbols)
                    elif domain == "officers":
                        await self.sync_officers(symbols=normalized_symbols)

                    domain_results.append(
                        {
                            "domain": domain,
                            "status": "completed",
                            "elapsed_seconds": round(
                                (datetime.utcnow() - domain_started).total_seconds(), 2
                            ),
                        }
                    )
                except Exception as exc:
                    logger.warning("Reinforcement domain failed (%s): %s", domain, exc)
                    domain_results.append(
                        {
                            "domain": domain,
                            "status": "failed",
                            "error": str(exc),
                            "elapsed_seconds": round(
                                (datetime.utcnow() - domain_started).total_seconds(), 2
                            ),
                        }
                    )

            failed_domains = [
                result for result in domain_results if result.get("status") == "failed"
            ]
            return {
                "status": "partial" if failed_domains else "completed",
                "started_at": started_at.isoformat(),
                "finished_at": datetime.utcnow().isoformat(),
                "symbols_count": len(normalized_symbols),
                "domains": requested_domains,
                "domain_results": domain_results,
                "failed_domains": len(failed_domains),
            }
        finally:
            RATE_MODE_CONTEXT.reset(token)

    async def run_full_seeding(
        self,
        days: int = settings.price_history_years * 365,
        include_prices: bool = True,
        resume: bool = True,
        job_id: Optional[str] = None,
        stages: Optional[List[str]] = None,
        cache_writes: bool = False,
    ):
        """Run complete data seeding pipeline with resume support."""
        logger.info(f"🚀 Starting FULL DATA SEEDING ({days} days history)...")

        progress = None
        if resume:
            progress = await self._load_progress()

        if progress is None:
            job_id = job_id or f"full-{uuid4().hex[:8]}"
            progress = {
                "job_id": job_id,
                "status": "running",
                "stage": STAGE_ORDER[0],
                "stage_index": 0,
                "success_count": 0,
                "error_count": 0,
                "stage_stats": {},
                "days": days,
            }
        else:
            progress.setdefault("success_count", 0)
            progress.setdefault("error_count", 0)
            progress.setdefault("stage_stats", {})

        if stages is None:
            stages = STAGE_ORDER

        sync_id = progress.get("sync_id")
        if not sync_id:
            sync_id = await self._create_sync_record("full", progress["job_id"], days)
            progress["sync_id"] = sync_id
            await self._checkpoint(progress, sync_id)

        start_index = progress.get("stage_index", 0)

        previous_cache_state = self.cache_writes_enabled
        if cache_writes is False:
            self.cache_writes_enabled = False

        try:
            for stage in stages[start_index:]:
                progress["stage"] = stage
                progress["stage_index"] = STAGE_ORDER.index(stage)
                await self._checkpoint(progress, sync_id)

                if stage == "stock_list":
                    try:
                        await self.sync_stock_list(progress=progress, sync_id=sync_id)
                    except Exception as e:
                        logger.warning(f"Stock list sync failed: {e}")
                elif stage == "screener":
                    try:
                        await self.sync_screener_data(progress=progress, sync_id=sync_id)
                        removed = await self.cleanup_screener_snapshots()
                        if removed:
                            logger.info(
                                f"Pruned {removed} old screener snapshots beyond retention window"
                            )
                    except Exception as e:
                        logger.warning(f"Screener sync failed: {e}")
                elif stage == "profiles":
                    try:
                        await self.sync_company_profiles(progress=progress, sync_id=sync_id)
                    except Exception as e:
                        logger.warning(f"Profile sync failed: {e}")
                elif stage == "prices":
                    if include_prices:
                        try:
                            await self.sync_daily_prices(
                                days=days,
                                progress=progress,
                                sync_id=sync_id,
                                cache_recent=False,
                            )
                            removed = await self.cleanup_price_history()
                            if removed:
                                logger.info(
                                    f"Pruned {removed} old price rows beyond retention window"
                                )
                        except Exception as e:
                            logger.warning(f"Price sync failed: {e}")
                elif stage == "financials":
                    try:
                        await self.sync_financials(
                            period="year", progress=progress, sync_id=sync_id
                        )
                        await self.sync_financials(period="quarter")
                        await self.sync_financial_ratios(period="year")
                        await self.sync_financial_ratios(period="quarter")
                    except Exception as e:
                        logger.warning(f"Financials sync failed: {e}")

            try:
                removed_news = await self.cleanup_company_news()
                if removed_news:
                    logger.info(f"Pruned {removed_news} old news rows beyond retention window")
            except Exception as e:
                logger.warning(f"News cleanup failed: {e}")

            progress["status"] = "completed"
            await self._update_sync_record(sync_id, status="completed", additional_data=progress)
            await self._clear_progress()
            logger.info("✅ Full seeding completed successfully.")
        except Exception as e:
            progress["status"] = "failed"
            await self._update_sync_record(sync_id, status="failed", additional_data=progress)
            logger.error(f"Full seeding failed: {e}")
            raise
        finally:
            self.cache_writes_enabled = previous_cache_state


# Standalone functions for scheduler
async def run_daily_sync():
    """Wrapper for scheduler to run daily sync."""
    await data_pipeline.run_full_seeding(days=1, resume=False)


async def run_daily_trading_sync():
    """Wrapper for scheduler to run daily trading updates."""
    await data_pipeline.run_daily_trading_updates()


async def run_hourly_news_sync():
    """Wrapper for scheduler to run hourly news sync."""
    from vnibb.services.news_crawler import news_crawler

    count = await news_crawler.crawl_market_news(sources=None, limit=30, analyze_sentiment=True)
    if count == 0:
        fallback_symbols = ["VNM", "FPT", "VCB", "HPG", "VIC"]
        count = await news_crawler.seed_from_company_news(fallback_symbols, limit_per_symbol=5)

    logger.info(f"Hourly news sync completed with {count} articles")


async def run_intraday_sync():
    """Wrapper for scheduler to run intraday sync."""
    # TODO: Implement intraday sync in DataPipeline class
    logger.info("Intraday sync placeholder")
    pass


data_pipeline = DataPipeline()
