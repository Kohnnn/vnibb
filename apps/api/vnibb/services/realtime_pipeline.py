"""
Real-time Data Pipeline using vnstock_pipeline

Streams live market data via WebSocket and stores in database.
Supports: stockps (stock prices), index, board, boardps, etc.

Uses vnstock_pipeline premium package when available, falls back to polling.
"""

import asyncio
import importlib
import inspect
import logging
from datetime import datetime, time
from zoneinfo import ZoneInfo

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.core.config import settings
from vnibb.core.database import async_session_maker
from vnibb.core.scheduler_lock import DistributedJobLock
from vnibb.models.stock import StockIndex
from vnibb.models.trading import IntradayTrade, OrderbookSnapshot

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
    Real-time data streaming manager.

    Uses vnstock_pipeline WebSocket for live data during market hours.
    Stores snapshots in PostgreSQL for historical analysis.

    Data types supported:
    - stockps: Stock price updates
    - index: Market index updates (VNINDEX, HNXINDEX, etc.)
    - board: Order board data
    - boardps: Order board price updates
    - aggregatemarket: Market aggregate data
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
        self._stream_client = None
        self._control_lock = asyncio.Lock()
        self._pipeline_available = False
        self._check_pipeline()

    def _check_pipeline(self):
        """Check if vnstock_pipeline is available."""
        try:
            importlib.import_module("vnstock_pipeline.wss")
            self._pipeline_available = True
            logger.info("vnstock_pipeline premium package detected")
        except ImportError:
            logger.warning(
                "vnstock_pipeline not installed. Real-time will use polling fallback."
            )

    async def start_streaming(
        self,
        data_types: list[str] | None = None,
        symbols: list[str] | None = None,
    ) -> bool:
        if data_types is None:
            data_types = ["stockps", "index", "board"]
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
            self._task = asyncio.create_task(self._run_stream(data_types, symbols))
            self._session_guard_task = asyncio.create_task(self._stop_when_session_ends())
            if self._lease:
                self._lease_renewal_task = asyncio.create_task(self._renew_lease(self._lease))
            logger.info("Starting real-time streaming for: %s", data_types)
            return True

    async def reconcile_streaming(self) -> bool:
        if not is_vietnam_market_open():
            if self.is_running:
                await self.stop_streaming()
            return False
        return await self.start_streaming()

    async def _run_stream(self, data_types: list[str], symbols: list[str]) -> None:
        try:
            if self._pipeline_available:
                await self._start_websocket_streaming(data_types)
            else:
                await self._polling_fallback(symbols)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error("Real-time streaming failed: %s", exc)
        finally:
            self.is_running = False
            await self._release_lease()

    async def _start_websocket_streaming(self, data_types: list[str]) -> None:
        from vnstock_pipeline.wss import MarketStreamClient

        def _sync_stream() -> None:
            client = MarketStreamClient(data_path=self.data_path, data_types=data_types)
            self._stream_client = client
            if not self.is_running:
                return
            client.start()

        try:
            await asyncio.to_thread(_sync_stream)
        finally:
            self._stream_client = None

    async def _on_data_received(self, data_type: str, data: dict):
        """Callback for incoming WebSocket data."""
        try:
            async with async_session_maker() as session:
                if data_type == "stockps":
                    await self._store_stock_price(session, data)
                elif data_type == "index":
                    await self._store_index(session, data)
                elif data_type in ("board", "boardps"):
                    await self._store_orderbook(session, data)

                await session.commit()
        except Exception as e:
            logger.error(f"Failed to store {data_type} data: {e}")

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

    async def _store_index(self, session: AsyncSession, data: dict):
        """Store index data (VNINDEX, HNXINDEX, etc)."""
        index_code = data.get("code", data.get("symbol", ""))
        if not index_code:
            return

        stmt = pg_insert(StockIndex).values(
            index_code=index_code.upper(),
            time=datetime.now(),
            value=float(data.get("value", data.get("close", 0))),
            change=float(data.get("change", 0)),
            change_percent=float(data.get("changePct", data.get("change_pct", 0))),
            volume=int(data.get("volume", data.get("vol", 0))),
        ).on_conflict_do_nothing()

        await session.execute(stmt)

    async def _store_orderbook(self, session: AsyncSession, data: dict):
        """Store order book snapshot."""
        symbol = data.get("symbol", data.get("code", ""))
        if not symbol:
            return

        stmt = pg_insert(OrderbookSnapshot).values(
            symbol=symbol.upper(),
            snapshot_time=datetime.now(),
            bid1_price=float(data.get("bid1", data.get("bidPrice1", 0))),
            bid1_volume=int(data.get("bid1_vol", data.get("bidVol1", 0))),
            bid2_price=float(data.get("bid2", data.get("bidPrice2", 0))),
            bid2_volume=int(data.get("bid2_vol", data.get("bidVol2", 0))),
            bid3_price=float(data.get("bid3", data.get("bidPrice3", 0))),
            bid3_volume=int(data.get("bid3_vol", data.get("bidVol3", 0))),
            ask1_price=float(data.get("ask1", data.get("offerPrice1", 0))),
            ask1_volume=int(data.get("ask1_vol", data.get("offerVol1", 0))),
            ask2_price=float(data.get("ask2", data.get("offerPrice2", 0))),
            ask2_volume=int(data.get("ask2_vol", data.get("offerVol2", 0))),
            ask3_price=float(data.get("ask3", data.get("offerPrice3", 0))),
            ask3_volume=int(data.get("ask3_vol", data.get("offerVol3", 0))),
            price_depth=data,  # Store full order book as JSON
        ).on_conflict_do_nothing()

        await session.execute(stmt)

    async def _polling_fallback(self, symbols: list[str]):
        """Fallback to polling if WebSocket not available."""
        from vnibb.providers.vnstock.runtime import get_trading_class

        Trading = get_trading_class()

        logger.info(f"Starting polling fallback for {len(symbols)} symbols")

        while self.is_running:
            if not is_vietnam_market_open():
                await asyncio.sleep(60)
                continue
            try:
                trading = Trading()
                df = trading.price_board(symbols_list=symbols)

                if df is not None and not df.empty:
                    async with async_session_maker() as session:
                        for _, row in df.iterrows():
                            await self._store_stock_price(session, row.to_dict())
                        await session.commit()

                    logger.debug(f"Polled {len(df)} price updates")

            except Exception as e:
                logger.error(f"Polling fallback error: {e}")

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
                    await self._stop_stream_client()
                    return
        except asyncio.CancelledError:
            raise

    async def _stop_stream_client(self) -> None:
        client = self._stream_client
        if client is None:
            return
        for method_name in ("stop", "close"):
            method = getattr(client, method_name, None)
            if not callable(method):
                continue
            if inspect.iscoroutinefunction(method):
                await method()
            else:
                result = await asyncio.to_thread(method)
                if inspect.isawaitable(result):
                    await result
            self._stream_client = None
            return

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
            try:
                await asyncio.wait_for(
                    self._stop_stream_client(),
                    timeout=settings.realtime_streaming_stop_timeout_seconds,
                )
            except TimeoutError:
                logger.error("Real-time stream client did not stop before timeout")
            except Exception as exc:
                logger.error("Failed to stop real-time stream client: %s", exc)
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

