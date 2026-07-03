"""
Base Pipeline Classes

Contains:
- BasePipeline: Abstract base class for all pipelines
- PipelineStage: Enum for pipeline stages
- RateLimiter: Rate limiting utility
- Common utilities for all pipelines
"""

import asyncio
import logging
from contextvars import ContextVar
from datetime import date, datetime, timedelta, time
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4

import pandas as pd
from zoneinfo import ZoneInfo
from sqlalchemy import select, func, update
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.core.database import async_session_maker, engine
from vnibb.core.cache import redis_client, build_cache_key
from vnibb.core.config import settings
from vnibb.core.cache_constants import (
    PIPELINE_TTL_LISTING,
    PIPELINE_TTL_PROFILE,
    PIPELINE_TTL_SCREENER,
    PIPELINE_TTL_PRICE_LATEST,
    PIPELINE_TTL_PRICE_RECENT,
    RECENT_PRICE_DAYS,
)
from vnibb.models.stock import Stock
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models.sync_status import SyncStatus

logger = logging.getLogger(__name__)


class PipelineStage(str, Enum):
    """Pipeline execution stages in order."""
    STOCK_LIST = "stock_list"
    SCREENER = "screener"
    PROFILES = "profiles"
    PRICES = "prices"
    INDICES = "indices"
    FINANCIALS = "financials"


STAGE_ORDER = [stage.value for stage in PipelineStage]


class RateLimiter:
    """Rate limiter for API calls."""

    def __init__(self, calls_per_minute: float):
        self.delay = 60.0 / calls_per_minute if calls_per_minute and calls_per_minute > 0 else 0.0
        self.last_request = 0.0

    async def wait(self) -> None:
        if self.delay <= 0:
            return
        now = asyncio.get_event_loop().time()
        time_since_last = now - self.last_request
        if time_since_last < self.delay:
            await asyncio.sleep(self.delay - time_since_last)
        self.last_request = asyncio.get_event_loop().time()


class BasePipeline:
    """
    Base class for data pipelines.

    Provides common utilities for:
    - Rate limiting
    - Progress tracking
    - Redis cache operations
    - Sync record management
    """

    RATE_MODE_NORMAL = "normal"
    RATE_MODE_REINFORCEMENT = "reinforcement"
    RATE_MODE_CONTEXT: ContextVar[str] = ContextVar("vnibb_rate_mode", default=RATE_MODE_NORMAL)

    SYNC_PROGRESS_KEY = "vnibb:sync:full:progress"
    SYNC_PROGRESS_TTL = 7 * 24 * 60 * 60

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

    async def _wait_for_rate_limit(self, bucket: str) -> None:
        mode = self.RATE_MODE_CONTEXT.get()
        await self.global_vnstock_limiter.wait()
        if mode == self.RATE_MODE_REINFORCEMENT:
            await self.reinforcement_vnstock_limiter.wait()
        limiter = self.rate_limiters.get(bucket)
        if limiter:
            await limiter.wait()

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

    def _iter_weekdays(self, start_date: date, end_date: date):
        current = start_date
        while current <= end_date:
            if current.weekday() < 5:
                yield current
            current += timedelta(days=1)

    def _build_missing_date_ranges(
        self,
        existing_dates: set[date],
        start_date: date,
        end_date: date,
        max_range_days: int = 30,
    ) -> List[Tuple[date, date]]:
        if start_date > end_date:
            return []

        missing_dates = [
            day for day in self._iter_weekdays(start_date, end_date) if day not in existing_dates
        ]
        if not missing_dates:
            return []

        ranges: List[Tuple[date, date]] = []
        range_start = missing_dates[0]
        range_end = missing_dates[0]

        for day in missing_dates[1:]:
            day_gap = (day - range_end).days
            contiguous = True
            for offset in range(1, day_gap):
                if (range_end + timedelta(days=offset)).weekday() < 5:
                    contiguous = False
                    break
            if contiguous and (day - range_start).days < max_range_days:
                range_end = day
                continue

            ranges.append((range_start, range_end))
            range_start = day
            range_end = day

        ranges.append((range_start, range_end))
        return ranges

    def _should_checkpoint(self, index: int, total: int) -> bool:
        every = max(1, settings.progress_checkpoint_every)
        return (index + 1) % every == 0 or index == total - 1


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
