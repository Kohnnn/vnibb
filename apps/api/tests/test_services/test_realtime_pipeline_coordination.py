import asyncio
import sys
from datetime import datetime
from types import ModuleType
from unittest.mock import AsyncMock, Mock
from zoneinfo import ZoneInfo

import pytest

from vnibb import scheduler_worker
from vnibb.api.v1 import realtime as realtime_api
from vnibb.core import scheduler
from vnibb.core.config import settings
from vnibb.services import data_pipeline, realtime_pipeline


class FakeLease:
    owners: dict[str, "FakeLease"] = {}

    def __init__(self, job_name, timeout_seconds):
        self.job_name = job_name
        self.timeout_seconds = timeout_seconds
        self.ttl_seconds = timeout_seconds
        self.acquired = False
        self.released = False

    async def acquire(self):
        if self.job_name in self.owners:
            return "contended"
        self.owners[self.job_name] = self
        self.acquired = True
        return "acquired"

    async def renew(self):
        return self.owners.get(self.job_name) is self

    async def release(self):
        if self.owners.get(self.job_name) is not self:
            return False
        del self.owners[self.job_name]
        self.released = True
        return True


@pytest.fixture(autouse=True)
def clear_fake_leases():
    FakeLease.owners.clear()


@pytest.mark.asyncio
async def test_realtime_lease_prevents_contention_and_releases_only_after_stop(monkeypatch):
    monkeypatch.setattr(realtime_pipeline, "DistributedJobLock", FakeLease)
    monkeypatch.setattr(realtime_pipeline, "is_vietnam_market_open", lambda: True)
    first = realtime_pipeline.RealtimePipeline()
    second = realtime_pipeline.RealtimePipeline()

    async def hold(_symbols):
        while first.is_running:
            await asyncio.sleep(0)

    monkeypatch.setattr(first, "_polling_fallback", hold)

    assert await first.start_streaming()
    await asyncio.sleep(0)
    lease = first._lease
    assert lease is FakeLease.owners["realtime_streaming"]
    assert not await second.start_streaming()
    assert FakeLease.owners["realtime_streaming"] is lease

    assert await first.stop_streaming()
    assert lease.released
    assert "realtime_streaming" not in FakeLease.owners


@pytest.mark.asyncio
async def test_failed_stream_start_releases_its_lease(monkeypatch):
    monkeypatch.setattr(realtime_pipeline, "DistributedJobLock", FakeLease)
    monkeypatch.setattr(realtime_pipeline, "is_vietnam_market_open", lambda: True)
    pipeline = realtime_pipeline.RealtimePipeline()

    async def fail(_symbols):
        raise RuntimeError("stream unavailable")

    monkeypatch.setattr(pipeline, "_polling_fallback", fail)

    assert await pipeline.start_streaming()
    await pipeline._task

    assert not pipeline.is_running
    assert "realtime_streaming" not in FakeLease.owners


@pytest.mark.asyncio
async def test_automatic_session_end_stops_stream_and_releases_lease(monkeypatch):
    original_sleep = asyncio.sleep
    market_open = True

    async def sleep(seconds):
        nonlocal market_open
        if seconds == 1:
            market_open = False
        await original_sleep(0)

    async def hold(_symbols):
        while pipeline.is_running:
            await original_sleep(0)

    monkeypatch.setattr(realtime_pipeline, "DistributedJobLock", FakeLease)
    monkeypatch.setattr(realtime_pipeline, "is_vietnam_market_open", lambda: market_open)
    monkeypatch.setattr(realtime_pipeline.asyncio, "sleep", sleep)
    pipeline = realtime_pipeline.RealtimePipeline()
    monkeypatch.setattr(pipeline, "_polling_fallback", hold)

    assert await pipeline.start_streaming()
    lease = pipeline._lease
    renewal_task = pipeline._lease_renewal_task
    session_guard_task = pipeline._session_guard_task

    await asyncio.wait_for(session_guard_task, timeout=1)

    assert not pipeline.is_running
    assert pipeline._task.done()
    assert pipeline._lease is None
    assert pipeline._lease_renewal_task is None
    assert renewal_task.done()
    assert "realtime_streaming" not in FakeLease.owners
    assert lease.released


@pytest.mark.asyncio
async def test_scheduler_worker_reconciles_realtime_streaming_at_boot(monkeypatch):
    pipeline = Mock(reconcile_streaming=AsyncMock(return_value=True))
    connect = AsyncMock()
    start_scheduler = Mock()
    monkeypatch.setattr(settings, "scheduler_role", "scheduler")
    monkeypatch.setattr(scheduler_worker.redis_client, "connect", connect)
    monkeypatch.setattr(scheduler_worker, "start_scheduler", start_scheduler)
    monkeypatch.setattr(scheduler_worker, "get_realtime_pipeline", Mock(return_value=pipeline))

    await scheduler_worker.start()

    connect.assert_awaited_once()
    start_scheduler.assert_called_once()
    pipeline.reconcile_streaming.assert_awaited_once()


@pytest.mark.asyncio
async def test_reconcile_starts_only_during_market_hours(monkeypatch):
    pipeline = realtime_pipeline.RealtimePipeline()
    start_streaming = AsyncMock(return_value=True)
    monkeypatch.setattr(pipeline, "start_streaming", start_streaming)
    monkeypatch.setattr(realtime_pipeline, "is_vietnam_market_open", lambda: False)

    assert not await pipeline.reconcile_streaming()
    start_streaming.assert_not_awaited()

    monkeypatch.setattr(realtime_pipeline, "is_vietnam_market_open", lambda: True)
    assert await pipeline.reconcile_streaming()
    start_streaming.assert_awaited_once()


@pytest.mark.parametrize(
    ("hour", "minute", "expected"),
    [
        (11, 29, True),
        (11, 30, False),
        (12, 0, False),
        (12, 59, False),
        (13, 0, True),
        (14, 44, True),
        (14, 45, False),
        (14, 59, False),
    ],
)
def test_realtime_active_sessions_are_exact(hour, minute, expected):
    check_time = datetime(2026, 7, 13, hour, minute, tzinfo=ZoneInfo("Asia/Ho_Chi_Minh"))
    assert realtime_pipeline.is_vietnam_market_open(check_time) is expected


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("hour", "minute", "active"),
    [
        (11, 29, True),
        (11, 30, False),
        (12, 0, False),
        (12, 59, False),
        (13, 0, True),
        (14, 44, True),
        (14, 45, False),
        (14, 59, False),
    ],
)
async def test_intraday_scheduler_wrapper_only_calls_provider_during_active_sessions(
    monkeypatch, hour, minute, active
):
    check_time = datetime(2026, 7, 13, hour, minute, tzinfo=ZoneInfo("Asia/Ho_Chi_Minh"))
    from vnibb.services.sync_all_data import FullMarketSync

    provider = AsyncMock(return_value=["FPT"])
    cycle = AsyncMock(return_value=Mock(complete=True, pending_count=0))
    market_open = realtime_pipeline.is_vietnam_market_open
    monkeypatch.setattr(realtime_pipeline, "is_vietnam_market_open", lambda: market_open(check_time))
    monkeypatch.setattr(realtime_pipeline, "DistributedJobLock", FakeLease)
    monkeypatch.setattr(FullMarketSync, "_get_seeded_symbols", provider)
    monkeypatch.setattr(FullMarketSync, "run_maintenance_cycle", cycle)
    monkeypatch.setattr(data_pipeline.data_pipeline, "sync_derivatives_prices", AsyncMock(return_value=1))
    monkeypatch.setattr(data_pipeline.data_pipeline, "_create_sync_record", AsyncMock(return_value=1))
    monkeypatch.setattr(data_pipeline.data_pipeline, "_update_sync_record", AsyncMock())
    await realtime_pipeline.run_intraday_sync()

    assert provider.await_count == int(active)
    assert cycle.await_count == int(active)


def test_scheduler_realtime_jobs_follow_active_sessions(monkeypatch):
    scheduler._scheduler = None
    monkeypatch.setattr(scheduler, "DistributedJobLock", FakeLease)
    scheduler.configure_scheduler()
    jobs = {job.id: job for job in scheduler.get_scheduler().get_jobs()}

    assert {"realtime_start", "realtime_lunch_stop", "realtime_afternoon_start", "realtime_stop"} <= jobs.keys()
    assert "hour='2', minute='0'" in str(jobs["realtime_start"].trigger)
    assert "hour='4', minute='30'" in str(jobs["realtime_lunch_stop"].trigger)
    assert "hour='6', minute='0'" in str(jobs["realtime_afternoon_start"].trigger)
    assert "hour='7', minute='45'" in str(jobs["realtime_stop"].trigger)
    assert {"mongo_eod_sync", "mongo_eod_catchup"} <= jobs.keys()


@pytest.mark.asyncio
async def test_manual_start_is_noop_outside_active_session(monkeypatch):
    pipeline = Mock(is_running=False, _pipeline_available=False, start_streaming=AsyncMock())
    monkeypatch.setattr(realtime_api, "get_realtime_pipeline", Mock(return_value=pipeline))
    monkeypatch.setattr(realtime_api, "is_vietnam_market_open", lambda: False)

    response = await realtime_api.start_streaming()

    assert not response.is_running
    assert response.message == "Streaming is unavailable outside active market sessions"
    pipeline.start_streaming.assert_not_awaited()


@pytest.mark.asyncio
async def test_polling_waits_without_acquisition_calls_outside_active_session(monkeypatch):
    rotation = AsyncMock()
    pipeline = realtime_pipeline.RealtimePipeline()
    pipeline.is_running = True
    sleep = AsyncMock(side_effect=lambda _: setattr(pipeline, "is_running", False))
    monkeypatch.setattr(realtime_pipeline, "is_vietnam_market_open", lambda: False)
    monkeypatch.setattr(realtime_pipeline.asyncio, "sleep", sleep)
    monkeypatch.setattr(realtime_pipeline, "run_intraday_sync", rotation)

    await pipeline._polling_fallback(["FPT"])

    rotation.assert_not_awaited()
    sleep.assert_awaited_once_with(60)


@pytest.mark.asyncio
async def test_active_session_acquires_ticks_and_current_depth(monkeypatch):
    from vnibb.services import sync_all_data
    from vnibb.providers.vnstock import runtime

    class Session:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return False

        async def scalars(self, _):
            return Mock(first=Mock(return_value=None))


    calls = []

    async def ticks(*, symbols, progress, live_session, retain_ticks):
        calls.append((symbols[0], live_session, retain_ticks))
        progress["acquisition_outcomes"] = {"sql": "persisted"}
        return 4

    async def depth(*, symbols, progress, live_session):
        calls.append((symbols[0], live_session))
        progress["acquisition_outcomes"] = {"sql": "persisted", "mongo": "persisted"}
        return 1

    monkeypatch.setattr(realtime_pipeline, "is_vietnam_market_open", lambda: True)
    monkeypatch.setattr(sync_all_data, "async_session_maker", Session)
    monkeypatch.setattr(runtime, "financial_provider_busy", lambda: False)
    lease = Mock()
    lease.acquire = AsyncMock(return_value="acquired")
    lease.release = AsyncMock(return_value=True)
    monkeypatch.setattr(realtime_pipeline, "DistributedJobLock", lambda *_: lease)
    monkeypatch.setattr(sync_all_data.FullMarketSync, "_get_seeded_symbols", AsyncMock(return_value=["FPT"]))
    monkeypatch.setattr(sync_all_data.data_pipeline, "sync_intraday_trades", ticks)
    monkeypatch.setattr(sync_all_data.data_pipeline, "sync_orderbook_snapshots", depth)
    monkeypatch.setattr(sync_all_data.data_pipeline, "sync_derivatives_prices", AsyncMock(return_value=0))
    monkeypatch.setattr(sync_all_data.data_pipeline, "_create_sync_record", AsyncMock(return_value=1))
    monkeypatch.setattr(sync_all_data.data_pipeline, "_update_sync_record", AsyncMock())

    result = await realtime_pipeline.run_intraday_sync()

    assert calls == [("FPT", True, True), ("FPT", True)]
    assert result.complete is True


@pytest.mark.asyncio
async def test_stop_timeout_cancels_task_and_releases_lease(monkeypatch):
    pipeline = realtime_pipeline.RealtimePipeline()
    lease = FakeLease("realtime_streaming", 60)
    await lease.acquire()
    pipeline.is_running = True
    pipeline._lease = lease
    stopped = asyncio.Event()

    async def stream():
        try:
            await stopped.wait()
        except asyncio.CancelledError:
            raise

    pipeline._task = asyncio.create_task(stream())
    await asyncio.sleep(0)
    monkeypatch.setattr(settings, "realtime_streaming_stop_timeout_seconds", 0)

    assert not await pipeline.stop_streaming()
    assert pipeline._task.done()
    assert pipeline._task.cancelled()
    assert lease.released


@pytest.mark.asyncio
async def test_scheduler_shutdown_does_not_wait_after_realtime_cleanup_failure(monkeypatch):
    pipeline = Mock(stop_streaming=AsyncMock(return_value=False))
    scheduler_instance = Mock(running=True)
    monkeypatch.setattr(realtime_pipeline, "get_realtime_pipeline", Mock(return_value=pipeline))
    monkeypatch.setattr(scheduler, "get_scheduler", Mock(return_value=scheduler_instance))

    assert not await scheduler.shutdown_scheduler()
    pipeline.stop_streaming.assert_awaited_once()
    scheduler_instance.shutdown.assert_called_once_with(wait=False)


@pytest.mark.asyncio
async def test_installed_paid_pipeline_is_never_selected(monkeypatch):
    module = ModuleType("vnstock_pipeline")
    websocket = ModuleType("vnstock_pipeline.wss")
    websocket.MarketStreamClient = Mock(side_effect=AssertionError("Paid WebSocket executed"))
    monkeypatch.setitem(sys.modules, "vnstock_pipeline", module)
    monkeypatch.setitem(sys.modules, "vnstock_pipeline.wss", websocket)
    pipeline = realtime_pipeline.RealtimePipeline()
    poll = AsyncMock()
    monkeypatch.setattr(pipeline, "_polling_fallback", poll)

    await pipeline._run_stream(["FPT"])

    assert pipeline.get_status()["pipeline_available"] is False
    poll.assert_awaited_once_with(["FPT"])
    websocket.MarketStreamClient.assert_not_called()


@pytest.mark.asyncio
async def test_realtime_api_reports_only_stock_price_polling(monkeypatch):
    pipeline = realtime_pipeline.RealtimePipeline()
    start = AsyncMock(return_value=True)
    monkeypatch.setattr(pipeline, "start_streaming", start)
    monkeypatch.setattr(realtime_api, "get_realtime_pipeline", lambda: pipeline)
    monkeypatch.setattr(realtime_api, "is_vietnam_market_open", lambda: True)

    response = await realtime_api.start_streaming(
        realtime_api.StreamingRequest(data_types=["stockps", "index", "board"])
    )

    assert response.is_running
    assert response.pipeline_available is False
    assert response.data_types == ["stockps"]


@pytest.mark.asyncio
async def test_realtime_api_declares_premium_only_data_types_unavailable(monkeypatch):
    pipeline = realtime_pipeline.RealtimePipeline()
    start = AsyncMock()
    monkeypatch.setattr(pipeline, "start_streaming", start)
    monkeypatch.setattr(realtime_api, "get_realtime_pipeline", lambda: pipeline)
    monkeypatch.setattr(realtime_api, "is_vietnam_market_open", lambda: True)

    response = await realtime_api.start_streaming(
        realtime_api.StreamingRequest(data_types=["index", "board"])
    )

    assert not response.is_running
    assert response.data_types == []
    assert "unavailable" in response.message
    start.assert_not_awaited()


