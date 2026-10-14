"""Acquire bounded, durable trading rotations during active market sessions."""

import asyncio
import logging
from datetime import datetime, time
from hashlib import sha256
from zoneinfo import ZoneInfo

from vnibb.core.config import settings
from vnibb.core.scheduler_lock import DistributedJobLock

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


async def run_intraday_sync(symbols: list[str] | None = None):
    """Continue a complete-Universe tick/current-depth cycle, never a ranked subset."""
    if not is_vietnam_market_open():
        return None
    from vnibb.services.sync_all_data import FullMarketSync, data_pipeline

    budget_seconds = 240
    lease = DistributedJobLock("trading_acquisition_rotation", budget_seconds)
    if await lease.acquire() != "acquired":
        return None
    try:
        sync = FullMarketSync()
        universe = sorted(set(await sync._get_seeded_symbols()))
        sync_type = "intraday_universe_rotation"
        if symbols is not None:
            requested = {str(symbol).strip().upper() for symbol in symbols}
            universe = [symbol for symbol in universe if symbol in requested]
            fingerprint = sha256(",".join(universe).encode()).hexdigest()[:12]
            sync_type = f"intraday_subset_rotation_{fingerprint}"
        stages = [
            ("intraday_trades", lambda symbol, progress: data_pipeline.sync_intraday_trades(
                symbols=[symbol], progress=progress, live_session=True, retain_ticks=True)),
            ("orderbook_snapshots", lambda symbol, progress: data_pipeline.sync_orderbook_snapshots(
                symbols=[symbol], progress=progress, live_session=True)),
        ]
        result = await sync.run_maintenance_cycle(
            sync_type, universe, stages, budget_seconds=210, refresh_days=0,
            max_attempts=max(1, settings.scheduler_live_symbols_per_run) * len(stages),
            allow_empty=True,
        )
        derivative_id = await data_pipeline._create_sync_record(
            "intraday_derivatives", "intraday-derivatives", 0,
        )
        derivative_progress: dict = {}
        try:
            async with asyncio.timeout(25):
                count = await data_pipeline.sync_derivatives_prices(progress=derivative_progress)
            failed = derivative_progress.get("error_count", 0)
            await data_pipeline._update_sync_record(
                derivative_id, status="failed" if failed else "completed", success_count=count,
                error_count=failed,
                additional_data={"scope": "derivatives_only", "rows": count, "acquisition": derivative_progress},
            )
        except Exception as exc:
            await data_pipeline._update_sync_record(
                derivative_id, status="failed", error_count=1,
                additional_data={"scope": "derivatives_only", "error": str(exc), "acquisition": derivative_progress},
            )
        return result
    finally:
        await lease.release()


class RealtimePipeline:
    """
    Market-session acquisition manager for genuine ticks and current depth.

    Coverage receipts survive restarts; snapshots are not historical depth replay.
    """


    def __init__(self, data_path: str = "./data"):
        self.data_path = data_path
        self.is_running = False
        self._task: asyncio.Task | None = None
        self._lease: DistributedJobLock | None = None
        self._lease_renewal_task: asyncio.Task | None = None
        self._session_guard_task: asyncio.Task | None = None
        self._control_lock = asyncio.Lock()
        self._pipeline_available = False
        self._coverage: dict = {
            "scope": "full_universe_rotation", "complete": False,
            "completion_basis": "symbol_dataset_acquisition_cycle",
            "tick_session_totals_verified": False, "historical_depth_replay": False,
        }

    async def start_streaming(
        self,
        data_types: list[str] | None = None,
        symbols: list[str] | None = None,
    ) -> bool:
        if data_types is None:
            data_types = ["stockps"]
        if "stockps" not in data_types:
            logger.info("Only market-session trading polling is available")
            return False
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

    async def _run_stream(self, symbols: list[str] | None) -> None:
        try:
            await self._polling_fallback(symbols)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error("Real-time streaming failed: %s", exc)
        finally:
            self.is_running = False
            await self._release_lease()


    async def _polling_fallback(self, symbols: list[str] | None):
        """Continue durable acquisition without treating quote boards as matched ticks."""
        self._coverage = {
            "scope": "full_universe_rotation" if symbols is None else "explicit_subset_rotation",
            "complete": False,
            "completion_basis": "symbol_dataset_acquisition_cycle",
            "tick_session_totals_verified": False,
            "historical_depth_replay": False,
        }
        while self.is_running:
            if not is_vietnam_market_open():
                await asyncio.sleep(60)
                continue
            try:
                result = await run_intraday_sync(symbols=symbols)
                if result is not None:
                    self._coverage.update(complete=result.complete, pending_pairs=result.pending_count)
            except Exception as exc:
                self._coverage["complete"] = False
                logger.error("Trading rotation failed: %s", exc)
            await asyncio.sleep(60)

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
            "coverage": dict(self._coverage),
        }


# Lazy-loaded singleton
_realtime_pipeline: RealtimePipeline | None = None

def get_realtime_pipeline(data_path: str = "./data") -> RealtimePipeline:
    """Lazy-load the RealtimePipeline to avoid import-time blocking."""
    global _realtime_pipeline
    if _realtime_pipeline is None:
        _realtime_pipeline = RealtimePipeline(data_path=data_path)
    return _realtime_pipeline

