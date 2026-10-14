import pytest
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy.ext.asyncio import async_sessionmaker
from vnibb.core import scheduler
from vnibb.models.scheduler_state import SchedulerJobState
from vnibb.services import mongo_eod_sync, sync_all_data


@pytest.mark.asyncio
async def test_registered_catchup_retains_partial_and_failed_outcomes(test_engine, monkeypatch):
    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(scheduler, "async_session_factory", sessions)
    monkeypatch.setattr(scheduler, "_scheduler", AsyncIOScheduler(timezone="UTC"))
    monkeypatch.setattr(scheduler, "_job_guards", {})
    monkeypatch.setattr(scheduler.settings, "scheduler_lock_mode", "best_effort")

    class NoLock:
        def __init__(self, *_):
            pass

        async def acquire(self):
            return "unavailable"

    summary = {"expected": 800, "attempted": 50, "succeeded": 50, "empty": 0, "failed": 0, "pending": 750, "complete": False}

    async def catchup(**kwargs):
        assert kwargs == {"max_symbols": 50, "window_days": 30}
        return summary

    monkeypatch.setattr(scheduler, "DistributedJobLock", NoLock)
    monkeypatch.setattr(mongo_eod_sync, "run_mongo_eod_catchup", catchup)

    async def reference():
        return sync_all_data.SyncResult(True, 50, 0, 0, [], False, 1550)

    monkeypatch.setattr(sync_all_data, "run_iq_reference_sync", reference)
    scheduler.configure_scheduler()
    job = scheduler.get_scheduler().get_job("mongo_eod_catchup")
    assert job is not None
    await job.func()
    async with sessions() as session:
        state = await session.get(SchedulerJobState, "mongo_eod_catchup")
        assert state.last_outcome == "partial"
    summary.update(failed=1, succeeded=49)
    await job.func()
    async with sessions() as session:
        state = await session.get(SchedulerJobState, "mongo_eod_catchup")
        assert state.last_outcome == "failed"
        assert state.consecutive_failures == 1
    summary.update(failed=0, succeeded=50, primary_failures=1, fallbacks=1, pending=0, complete=True, errors=[{"message": "private-provider-token"}])
    await job.func()
    async with sessions() as session:
        state = await session.get(SchedulerJobState, "mongo_eod_catchup")
        assert state.last_outcome == "failed"
        assert state.consecutive_failures == 2
        assert "primary_failures=1" in state.last_detail
        assert "fallbacks=1" in state.last_detail
        assert "succeeded=50" in state.last_detail
        assert "private-provider-token" not in state.last_detail
    reference_job = scheduler.get_scheduler().get_job("iq_reference_sync")
    assert reference_job is not None
    await reference_job.func()
    async with sessions() as session:
        state = await session.get(SchedulerJobState, "iq_reference_sync")
        assert state.last_outcome == "partial"
        assert "1550" in state.last_detail
