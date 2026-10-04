"""Scheduler observations survive the in-process scheduler state."""

import asyncio
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from apscheduler.events import EVENT_JOB_ERROR, EVENT_JOB_EXECUTED
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker
from vnibb.api.v1 import data_sync
from vnibb.core import database, scheduler
from vnibb.models.scheduler_state import SchedulerWorkerState
from vnibb.services import prediction_market_catalogue_retention as catalogue_retention
from vnibb.services.data_pipeline import data_pipeline


@pytest.mark.asyncio
async def test_scheduled_mongo_sync_persists_failures_and_zero_write_recovery(test_engine, monkeypatch):
    from vnibb.models.scheduler_state import SchedulerJobState
    from vnibb.services import mongo_eod_sync

    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(scheduler, "async_session_factory", sessions)
    monkeypatch.setattr(scheduler, "_scheduler", AsyncIOScheduler(timezone="UTC"))
    monkeypatch.setattr(scheduler, "_job_guards", {})
    monkeypatch.setattr(scheduler.settings, "scheduler_lock_mode", "best_effort")

    class UnavailableLock:
        def __init__(self, *_):
            pass

        async def acquire(self):
            return "unavailable"

    monkeypatch.setattr(scheduler, "DistributedJobLock", UnavailableLock)
    sync = AsyncMock(side_effect=[
        {"symbols": 1, "rows": 2, "failures": 1},
        {"symbols": 0, "rows": 0, "failures": 3},
        {"symbols": 1, "rows": 0, "failures": 0},
    ])
    monkeypatch.setattr(mongo_eod_sync, "run_mongo_eod_sync", sync)
    scheduler.configure_scheduler()
    job = scheduler.get_scheduler().get_job("mongo_eod_sync")

    try:
        for expected_outcome, expected_count in [("failed", 1), ("failed", 2), ("ok", 0)]:
            await job.func()
            async with sessions() as session:
                state = await session.get(SchedulerJobState, "mongo_eod_sync")
                assert state.last_outcome == expected_outcome
                assert state.consecutive_failures == expected_count
                assert state.last_at is not None
    finally:
        async with sessions.begin() as session:
            await session.execute(
                SchedulerJobState.__table__.delete().where(SchedulerJobState.id == "mongo_eod_sync")
            )


@pytest.mark.asyncio
async def test_api_reads_worker_outcome_from_separate_session(test_engine, monkeypatch):
    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(scheduler, "async_session_factory", sessions)
    monkeypatch.setattr(data_sync.settings, "scheduler_role", "api")
    worker_scheduler = type("WorkerScheduler", (), {"get_jobs": lambda self: [
        type("Job", (), {"id": "intraday_sync", "name": "Intraday", "trigger": "interval",
                         "next_run_time": datetime.now(UTC) + timedelta(minutes=1)})()
    ]})()
    monkeypatch.setattr(scheduler, "get_scheduler", lambda: worker_scheduler)
    monkeypatch.setattr(database, "async_session_factory", sessions)

    await scheduler._record_job_outcome("intraday_sync", "failed", "ProviderError")
    await scheduler._publish_scheduler_state()
    status = await data_sync.get_sync_status()
    assert status["role"] == "api"
    assert status["worker_status"] == "running"
    assert status["failing_jobs"]["intraday_sync"]["last_outcome"] == "failed"
    assert status["jobs"][0]["last_detail"] == "ProviderError"
    assert status["jobs"][0]["next_run"]

    async with sessions.begin() as session:
        worker = await session.get(SchedulerWorkerState, 1)
        worker.heartbeat_at = datetime.utcnow() - timedelta(minutes=2)
    stale = await data_sync.get_sync_status()
    assert stale["worker_status"] == "unavailable"
    assert stale["running"] is False
    assert stale["jobs"]


@pytest.mark.asyncio
async def test_unavailable_database_never_looks_like_healthy_empty_scheduler(monkeypatch):

    def unavailable():
        raise RuntimeError("secret database URL")

    monkeypatch.setattr(database, "async_session_factory", unavailable)
    with pytest.raises(HTTPException) as exc:
        await data_sync.get_sync_status()
    assert exc.value.status_code == 503
    assert "secret" not in exc.value.detail


@pytest.mark.asyncio
async def test_concurrent_skip_does_not_cancel_active_run(test_engine, monkeypatch):

    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(scheduler, "async_session_factory", sessions)
    monkeypatch.setattr(database, "async_session_factory", sessions)
    monkeypatch.setattr(scheduler.settings, "scheduler_lock_mode", "best_effort")

    class UnavailableLock:
        def __init__(self, *_):
            pass

        async def acquire(self):
            return "unavailable"

    monkeypatch.setattr(scheduler, "DistributedJobLock", UnavailableLock)
    scheduler._job_guards.clear()
    started = asyncio.Event()
    release = asyncio.Event()

    async def runner():
        started.set()
        await release.wait()

    active = asyncio.create_task(scheduler._run_guarded_job("concurrent", runner, 10))
    await started.wait()
    await scheduler._run_guarded_job("concurrent", runner, 10)
    async with sessions() as session:
        skipped = await scheduler.get_job_status(session)
    assert skipped["jobs"][0]["last_outcome"] == "skipped"
    release.set()
    await active
    async with sessions() as session:
        completed = await scheduler.get_job_status(session)
    assert completed["jobs"][0]["last_outcome"] == "ok"


@pytest.mark.asyncio
async def test_cancelled_run_is_recorded_and_releases_guard(test_engine, monkeypatch):
    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(scheduler, "async_session_factory", sessions)
    monkeypatch.setattr(scheduler.settings, "scheduler_lock_mode", "best_effort")

    class UnavailableLock:
        def __init__(self, *_):
            pass

        async def acquire(self):
            return "unavailable"

    monkeypatch.setattr(scheduler, "DistributedJobLock", UnavailableLock)
    scheduler._job_guards.clear()
    started = asyncio.Event()

    async def runner():
        started.set()
        await asyncio.Event().wait()

    active = asyncio.create_task(scheduler._run_guarded_job("cancelled", runner, 10))
    await started.wait()
    active.cancel()
    with pytest.raises(asyncio.CancelledError):
        await active
    assert not scheduler._job_guards["cancelled"].locked()
    async with sessions() as session:
        outcome = await scheduler.get_job_status(session)
    assert outcome["failing_jobs"]["cancelled"]["last_detail"] == "worker cancelled"

@pytest.mark.asyncio
@pytest.mark.parametrize("job_id", ["retention_cleanup", "prediction_market_catalogue_retention"])
async def test_scheduled_cleanup_executes_guarded_runner(job_id, monkeypatch):
    class UnavailableLock:
        def __init__(self, *_):
            pass

        async def acquire(self):
            return "unavailable"

    @asynccontextmanager
    async def session_maker():
        yield object()

    scheduled = AsyncIOScheduler(timezone="UTC")
    monkeypatch.setattr(scheduler, "_scheduler", scheduled)
    monkeypatch.setattr(scheduler, "DistributedJobLock", UnavailableLock)
    monkeypatch.setattr(scheduler.settings, "scheduler_lock_mode", "best_effort")
    monkeypatch.setattr(database, "async_session_maker", session_maker)
    outcome = AsyncMock()
    monkeypatch.setattr(scheduler, "_record_job_outcome", outcome)
    retention = AsyncMock(return_value={"expired_rows": 2})
    purge = AsyncMock(return_value={"candidates": 0, "deleted": 2})
    monkeypatch.setattr(data_pipeline, "run_retention_cleanup", retention)
    monkeypatch.setattr(catalogue_retention, "purge_catalogue_debris", purge)

    if job_id == "retention_cleanup":
        scheduler.schedule_retention_cleanup()
    else:
        scheduler.schedule_prediction_market_catalogue_retention()

    completed = asyncio.Event()
    events = []
    loop = asyncio.get_running_loop()

    def on_job_finished(event):
        events.append(event)
        loop.call_soon_threadsafe(completed.set)

    scheduled.add_listener(on_job_finished, EVENT_JOB_EXECUTED | EVENT_JOB_ERROR)
    scheduled.start(paused=True)
    try:
        scheduled.modify_job(job_id, next_run_time=datetime.now(UTC) + timedelta(milliseconds=50))
        scheduled.resume()
        await asyncio.wait_for(completed.wait(), timeout=5)
        assert events[0].code == EVENT_JOB_EXECUTED
        if job_id == "retention_cleanup":
            retention.assert_awaited_once_with(include_price_history=True)
        else:
            assert purge.await_count == 1
            assert purge.await_args.kwargs == {"apply": True}
        outcome.assert_awaited_once()
        assert outcome.await_args.args[:2] == (job_id, "ok")
    finally:
        scheduled.shutdown(wait=True)
