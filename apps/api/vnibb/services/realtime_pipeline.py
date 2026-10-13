"""Poll free vnstock stock prices during market sessions and store snapshots."""

import asyncio
import logging
from datetime import datetime, time
from zoneinfo import ZoneInfo

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.core.config import settings
from vnibb.core.database import async_session_maker
from vnibb.core.scheduler_lock import DistributedJobLock
from vnibb.models.trading import IntradayTrade

logger = logging.getLogger(__name__)


def is_vietnam_market_open(check_time: datetime | None = None) -> bool:
    try:
        timezone = ZoneInfo(settings.intraday_market_tz)
    except Exception:
        timezone = ZoneInfo("Asia/Ho_Chi_Minh")
    now = check_time.astimezone(timezone) if check_time else datetime.now(timezone)
    if now.weekday() >= 5:
        return False
    current_time = now.time()
    return time(9) <= current_time < time(11, 30) or time(13) <= current_time < time(14, 45)


class RealtimePipeline:
    """
    Market-session stock price polling manager.

    Stores stock price snapshots in PostgreSQL for historical analysis.
    WebSocket, index, and order book streaming are unavailable.
    """

    # Default symbols for real-time tracking
    DEFAULT_SYMBOLS = [
        "FPT", "VNM", "VCB", "MBB", "TCB", "HPG", "VIC", "VHM",
        "MSN", "VRE", "PLX", "GAS", "SAB", "BID", "CTG", "ACB",
        "STB", "SSI", "VCI", "HCM", "VND", "SHS", "MWG", "PNJ",
    ]

    def __init__(self, data_path: str = "./data"):
        self.data_path = data_path
        self.is_running = False
        self._task: asyncio.Task | None = None
        self._lease: DistributedJobLock | None = None
        self._lease_renewal_task: asyncio.Task | None = None
        self._session_guard_task: asyncio.Task | None = None
        self._control_lock = asyncio.Lock()
        self._pipeline_available = False

    async def start_streaming(
        self,
        data_types: list[str] | None = None,
        symbols: list[str] | None = None,
    ) -> bool:
        if data_types is None:
            data_types = ["stockps"]
        if "stockps" not in data_types:
            logger.info("Only stock price polling is available")
            return False
        if symbols is None:
            symbols = self.DEFAULT_SYMBOLS
        async with self._control_lock:
            if not is_vietnam_market_open():
                logger.info("Real-time streaming is unavailable outside active market sessions")
                return False
            if self.is_running:
                return True
            if not settings.scheduler_lock_enabled:
                logger.error("Real-time streaming requires Redis coordination")
                return False
            lease = DistributedJobLock("realtime_streaming", settings.realtime_streaming_lease_seconds)
            lease_state = await lease.acquire()
            if lease_state == "contended":
                logger.info("Real-time streaming is owned by another worker")
                return False
            if lease_state == "unavailable":
                logger.error("Real-time streaming requires Redis coordination")
                return False
            self._lease = lease if lease_state == "acquired" else None
            self.is_running = True
            self._task = asyncio.create_task(self._run_stream(symbols))
            self._session_guard_task = asyncio.create_task(self._stop_when_session_ends())
            if self._lease:
                self._lease_renewal_task = asyncio.create_task(self._renew_lease(self._lease))
            logger.info("Starting stock price polling")
            return True

    async def reconcile_streaming(self) -> bool:
        if not is_vietnam_market_open():
            if self.is_running:
                await self.stop_streaming()
            return False
        return await self.start_streaming()

    async def _run_stream(self, symbols: list[str]) -> None:
        try:
            await self._polling_fallback(symbols)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error("Real-time streaming failed: %s", exc)
        finally:
            self.is_running = False
            await self._release_lease()


    async def _store_stock_price(self, session: AsyncSession, data: dict):
        """Store real-time stock price snapshot."""
        symbol = data.get("symbol", data.get("code", ""))
        if not symbol:
            return

        stmt = pg_insert(IntradayTrade).values(
            symbol=symbol.upper(),
            trade_time=datetime.now(),
            price=float(data.get("price", data.get("close", 0))),
            volume=int(data.get("volume", data.get("vol", 0))),
            match_type=data.get("side", data.get("type", "unknown")),
        ).on_conflict_do_nothing()

        await session.execute(stmt)


    async def _polling_fallback(self, symbols: list[str]):
        """Poll stock price snapshots using the free vnstock trading provider."""
        from vnibb.providers.vnstock.runtime import get_trading_class, validate_source

        Trading = get_trading_class()

        logger.info(f"Starting stock price polling for {len(symbols)} symbols")

        while self.is_running:
            if not is_vietnam_market_open():
                await asyncio.sleep(60)
                continue
            try:
                trading = Trading(source=validate_source(settings.vnstock_source))
                df = trading.price_board(symbols_list=symbols)

                if df is not None and not df.empty:
                    async with async_session_maker() as session:
                        for _, row in df.iterrows():
                            await self._store_stock_price(session, row.to_dict())
                        await session.commit()

                    logger.debug(f"Polled {len(df)} price updates")

            except Exception as e:
                logger.error(f"Stock price polling error: {e}")

            await asyncio.sleep(5)

    async def _stop_when_session_ends(self) -> None:
        while self.is_running:
            await asyncio.sleep(1)
            if not is_vietnam_market_open():
                await self.stop_streaming()
                return

    async def _renew_lease(self, lease: DistributedJobLock) -> None:
        interval = min(max(30, lease.ttl_seconds // 3), 300)
        try:
            while self.is_running and self._lease is lease:
                await asyncio.sleep(interval)
                if self.is_running and not await lease.renew():
                    self.is_running = False
                    return
        except asyncio.CancelledError:
            raise


    async def _release_lease(self) -> None:
        lease, self._lease = self._lease, None
        renewal_task, self._lease_renewal_task = self._lease_renewal_task, None
        session_guard_task, self._session_guard_task = self._session_guard_task, None
        for task in (renewal_task, session_guard_task):
            if task and task is not asyncio.current_task():
                task.cancel()
                done, _ = await asyncio.wait(
                    (task,), timeout=settings.realtime_streaming_stop_timeout_seconds
                )
                if done:
                    try:
                        await task
                    except asyncio.CancelledError:
                        pass
                    except Exception as exc:
                        logger.error("Real-time cleanup task failed: %s", exc)
                else:
                    logger.error("Real-time cleanup task did not stop after cancellation")
        if lease:
            try:
                await lease.release()
            except Exception as exc:
                logger.error("Failed to release real-time streaming lease: %s", exc)

    async def stop_streaming(self) -> bool:
        current_task = asyncio.current_task()
        async with self._control_lock:
            self.is_running = False
            task = self._task
            if self._session_guard_task is current_task:
                self._session_guard_task = None
        if task is not current_task and task and not task.done():
            try:
                await asyncio.wait_for(
                    asyncio.shield(task),
                    timeout=settings.realtime_streaming_stop_timeout_seconds,
                )
            except TimeoutError:
                logger.error("Real-time streaming did not stop before timeout; cancelling task")
                task.cancel()
                done, _ = await asyncio.wait(
                    (task,), timeout=settings.realtime_streaming_stop_timeout_seconds
                )
                if done:
                    try:
                        await task
                    except asyncio.CancelledError:
                        pass
                else:
                    logger.error("Real-time streaming task did not clean up after cancellation")
                await self._release_lease()
                return False
        await self._release_lease()
        logger.info("Real-time streaming stopped")
        return True

    def get_status(self) -> dict:
        """Get current streaming status."""
        return {
            "is_running": self.is_running,
            "pipeline_available": self._pipeline_available,
            "data_path": self.data_path,
        }


# Lazy-loaded singleton
_realtime_pipeline: RealtimePipeline | None = None

def get_realtime_pipeline(data_path: str = "./data") -> RealtimePipeline:
    """Lazy-load the RealtimePipeline to avoid import-time blocking."""
    global _realtime_pipeline
    if _realtime_pipeline is None:
        _realtime_pipeline = RealtimePipeline(data_path=data_path)
    return _realtime_pipeline

