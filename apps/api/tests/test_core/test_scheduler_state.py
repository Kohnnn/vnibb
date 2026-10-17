"""Scheduler observations survive the in-process scheduler state."""

import asyncio
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
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
        {"symbols": 1, "rows": 2, "failures": 0, "primary_failures": 1, "fallbacks": 1},
        {"symbols": 1, "rows": 0, "failures": 0},
    ])
    monkeypatch.setattr(mongo_eod_sync, "run_mongo_eod_sync", sync)
    scheduler.configure_scheduler()
    job = scheduler.get_scheduler().get_job("mongo_eod_sync")

    try:
        for expected_outcome, expected_count in [("failed", 1), ("failed", 2), ("failed", 3), ("ok", 0)]:
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
async def test_scheduled_catalogue_cleanup_executes_guarded_runner(monkeypatch):
    job_id = "prediction_market_catalogue_retention"
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
    purge = AsyncMock(return_value={"candidates": 0, "deleted": 2})
    monkeypatch.setattr(catalogue_retention, "purge_catalogue_debris", purge)
    monkeypatch.setattr(catalogue_retention, "has_catalogue_debris", AsyncMock(return_value=False))

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
        assert purge.await_count == 1
        assert purge.await_args.kwargs == {"apply": True}
        outcome.assert_awaited_once()
        assert outcome.await_args.args[:2] == (job_id, "ok")
    finally:
        scheduled.shutdown(wait=True)


@pytest.mark.asyncio
@pytest.mark.parametrize("pending_rows", [0, 1])
async def test_hourly_catalogue_cleanup_reports_remaining_backlog(test_engine, monkeypatch, pending_rows):
    from sqlalchemy import select
    from vnibb.models.prediction_market import PredictionMarket
    from vnibb.models.prediction_market_archive import PredictionMarketArchive
    from vnibb.models.prediction_market_snapshot import PredictionMarketSnapshot
    from vnibb.services import prediction_market_policy as policy

    class UnavailableLock:
        def __init__(self, *_):
            pass

        async def acquire(self):
            return "unavailable"

    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(database, "async_session_maker", sessions)
    monkeypatch.setattr(scheduler, "_scheduler", AsyncIOScheduler(timezone="UTC"))
    monkeypatch.setattr(scheduler, "_job_guards", {})
    monkeypatch.setattr(scheduler, "DistributedJobLock", UnavailableLock)
    monkeypatch.setattr(scheduler.settings, "scheduler_lock_mode", "best_effort")
    monkeypatch.setattr(scheduler, "PREDICTION_MARKET_CATALOGUE_RETENTION_BATCHES", 2)
    monkeypatch.setattr(policy, "MARKET_RETENTION_BATCH", 2)
    monkeypatch.setattr(catalogue_retention, "MARKET_RETENTION_BATCH", 2)
    outcome = AsyncMock()
    monkeypatch.setattr(scheduler, "_record_job_outcome", outcome)
    now = datetime.now(UTC)
    async with sessions() as session:
        for index in range(4 + pending_rows):
            session.add(PredictionMarket(
                source="polymarket", source_id=f"debris-{index}", question="Old open market?",
                active=True, closed=False, is_synthetic=False,
                updated_at=(now - timedelta(days=8)).replace(tzinfo=None),
            ))
        protected = [
            PredictionMarket(
                source="polymarket", source_id=kind, question="Protected market?",
                active=kind != "terminal", closed=kind == "terminal", is_synthetic=kind == "synthetic",
                updated_at=(now - timedelta(days=8)).replace(tzinfo=None),
            ) for kind in ("terminal", "synthetic", "archived")
        ]
        session.add_all(protected)
        await session.flush()
        session.add(PredictionMarketArchive(
            market_id=protected[-1].id, batch_id="retained", payload={}, sha256="a" * 64,
            archived_at=now.replace(tzinfo=None), backup_sha256="a" * 64,
        ))
        session.add(PredictionMarketSnapshot(
            source="polymarket", source_id="debris-0", question="Retained observation?",
            yes_price=0.4, captured_at=now - timedelta(days=2), extra={},
        ))
        await session.commit()

    scheduler.schedule_prediction_market_catalogue_retention()
    job = scheduler.get_scheduler().get_job("prediction_market_catalogue_retention")
    first = job.trigger.get_next_fire_time(None, now)
    assert job.trigger.get_next_fire_time(first, first) - first == timedelta(hours=1)
    await job.func()
    assert outcome.await_args.args[:2] == (job.id, "partial" if pending_rows else "ok")
    if pending_rows:
        assert outcome.await_args.args[2] == "progress saved; work remains"
    async with sessions() as session:
        retained = set((await session.scalars(select(PredictionMarket.source_id))).all())
        assert retained == {"terminal", "synthetic", "archived"} | ({"debris-4"} if pending_rows else set())
        observation = (await session.scalars(select(PredictionMarketSnapshot))).one()
        assert (observation.source_id, observation.yes_price) == ("debris-0", 0.4)
    if pending_rows:
        await job.func()
        assert outcome.await_args.args[:2] == (job.id, "ok")
        async with sessions() as session:
            assert set((await session.scalars(select(PredictionMarket.source_id))).all()) == {
                "terminal", "synthetic", "archived",
            }


@pytest.mark.asyncio
async def test_retention_failures_reach_scheduler_after_remaining_cleanup(monkeypatch, caplog):
    from vnibb.services import data_pipeline as pipeline_module

    scheduled = AsyncIOScheduler(timezone="UTC")
    monkeypatch.setattr(scheduler, "_scheduler", scheduled)
    class UnavailableLock:
        def __init__(self, *_):
            pass

        async def acquire(self):
            return "unavailable"

    monkeypatch.setattr(scheduler, "_job_guards", {})
    monkeypatch.setattr(scheduler, "DistributedJobLock", UnavailableLock)
    monkeypatch.setattr(scheduler.settings, "scheduler_lock_mode", "best_effort")
    outcome = AsyncMock()
    monkeypatch.setattr(scheduler, "_record_job_outcome", outcome)
    caplog.set_level("INFO")
    actions = {}
    for label, method in (
        ("screener_snapshots", "cleanup_screener_snapshots"),
        ("company_news", "cleanup_company_news"),
        ("intraday_trades", "cleanup_intraday_trades"),
        ("orderbook_snapshots", "cleanup_orderbook_snapshots"),
        ("block_trades", "cleanup_block_trades"),
        ("foreign_trading", "cleanup_foreign_trading"),
        ("order_flow_daily", "cleanup_order_flow_daily"),
    ):
        action = AsyncMock(
            side_effect=RuntimeError("cleanup unavailable")
            if label == "company_news" else None,
            return_value=2,
        )
        actions[label] = action
        monkeypatch.setattr(data_pipeline, method, action)
    terminal = AsyncMock(side_effect=RuntimeError("terminal report unavailable"))
    monkeypatch.setattr(pipeline_module, "prediction_market_retention", terminal)

    scheduler.schedule_retention_cleanup()
    await scheduled.get_job("retention_cleanup").func()

    for action in actions.values():
        action.assert_awaited_once_with()
    terminal.assert_awaited_once_with(limit=100)
    assert outcome.await_args.args[:2] == ("retention_cleanup", "failed")
    assert "Retention cleanup failed: company_news, prediction_market_candidates" in caplog.text
    assert "Retention cleanup removed rows" not in caplog.text
    assert "Retention cleanup found nothing" not in caplog.text


@pytest.mark.asyncio
@pytest.mark.parametrize("failed_snapshot", [None, "nightly_snapshot", "intraday_snapshot"])
@pytest.mark.parametrize("failed_source", [None, "polymarket"])
async def test_startup_populate_reports_snapshot_failures(
    test_engine, monkeypatch, failed_snapshot, failed_source
):
    from vnibb.services import populate_prediction_markets as populate

    class UnavailableLock:
        def __init__(self, *_):
            pass

        async def acquire(self):
            return "unavailable"

    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(database, "async_session_maker", sessions)
    monkeypatch.setattr(scheduler, "_scheduler", AsyncIOScheduler(timezone="UTC"))
    monkeypatch.setattr(scheduler, "_job_guards", {})
    monkeypatch.setattr(scheduler, "DistributedJobLock", UnavailableLock)
    monkeypatch.setattr(scheduler.settings, "scheduler_lock_mode", "best_effort")
    monkeypatch.setattr(scheduler, "_last_populate_at", None)
    monkeypatch.setattr(scheduler, "_last_populate_counts", None)
    outcome = AsyncMock()
    monkeypatch.setattr(scheduler, "_record_job_outcome", outcome)
    for source, name in (
        ("polymarket", "ingest_polymarket_gamma_markets_with_default_client"),
        ("kalshi", "ingest_kalshi_markets_with_default_client"),
        ("predictit", "ingest_predictit_markets_with_default_client"),
        ("limitless", "ingest_limitless_markets_with_default_client"),
        ("manifold", "ingest_manifold_markets_with_default_client"),
    ):
        monkeypatch.setattr(populate, name, AsyncMock(
            side_effect=RuntimeError("provider unavailable") if source == failed_source else None,
            return_value=0,
        ))
    snapshots = {}
    for label, name, result in (
        ("nightly_snapshot", "snapshot_active_prediction_markets", 0),
        ("intraday_snapshot", "snapshot_active_prediction_markets_intraday", SimpleNamespace(rows_written=0)),
    ):
        snapshots[label] = AsyncMock(
            side_effect=RuntimeError("snapshot unavailable") if label == failed_snapshot else None,
            return_value=result,
        )
        monkeypatch.setattr(populate, name, snapshots[label])

    scheduler._maybe_populate_prediction_markets_on_startup()
    await scheduler.get_scheduler().get_job("populate_prediction_markets_on_startup").func()

    expected = "failed" if failed_source or failed_snapshot else "ok"
    assert outcome.await_args.args[:2] == ("populate_prediction_markets_on_startup", expected)
    counts = scheduler.get_predictions_status()["populate"]["counts"]
    assert counts["failed_sources"] == ([failed_source] if failed_source else [])
    assert counts["failed_snapshots"] == ([failed_snapshot] if failed_snapshot else [])
    for snapshot in snapshots.values():
        snapshot.assert_awaited_once()


@pytest.mark.asyncio
async def test_prediction_retention_jobs_prune_sql_rows_after_fetch_failure(test_engine, monkeypatch):
    from sqlalchemy import select
    from vnibb.models.prediction_market import PredictionMarket
    from vnibb.models.prediction_market_intraday_snapshot import PredictionMarketIntradaySnapshot
    from vnibb.models.prediction_market_snapshot import PredictionMarketSnapshot
    from vnibb.services import (
        kalshi_service,
        limitless_service,
        manifold_service,
        prediction_market_service,
        predictit_service,
    )

    class UnavailableLock:
        def __init__(self, *_):
            pass

        async def acquire(self):
            return "unavailable"

    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(database, "async_session_maker", sessions)
    monkeypatch.setattr(scheduler, "_scheduler", AsyncIOScheduler(timezone="UTC"))
    monkeypatch.setattr(scheduler, "_job_guards", {})
    monkeypatch.setattr(scheduler, "DistributedJobLock", UnavailableLock)
    monkeypatch.setattr(scheduler.settings, "scheduler_lock_mode", "best_effort")
    monkeypatch.setattr(scheduler, "_last_daily_prune", None)
    monkeypatch.setattr(scheduler, "_last_intraday_prune", None)
    outcome = AsyncMock()
    monkeypatch.setattr(scheduler, "_record_job_outcome", outcome)
    fetches = []
    for module, name in (
        (prediction_market_service, "ingest_polymarket_gamma_markets_with_default_client"),
        (kalshi_service, "ingest_kalshi_markets_with_default_client"),
        (predictit_service, "ingest_predictit_markets_with_default_client"),
        (limitless_service, "ingest_limitless_markets_with_default_client"),
        (manifold_service, "ingest_manifold_markets_with_default_client"),
    ):
        fetch = AsyncMock(side_effect=RuntimeError("fetch unavailable"))
        fetches.append(fetch)
        monkeypatch.setattr(module, name, fetch)

    now = datetime.now(UTC)
    async with sessions() as session:
        for model, expired_days in (
            (PredictionMarketSnapshot, 31), (PredictionMarketIntradaySnapshot, 8),
        ):
            for source_id, days in (("expired", expired_days), ("recent", 1)):
                session.add(model(
                    source="polymarket", source_id=source_id, question="Observed market?",
                    yes_price=0.5, extra={}, captured_at=now - timedelta(days=days),
                ))
        for source_id, days in (("expired", 8), ("recent", 1)):
            session.add(PredictionMarket(
                source="polymarket", source_id=source_id, question="Real market?",
                active=True, closed=False, is_synthetic=False,
                updated_at=(now - timedelta(days=days)).replace(tzinfo=None),
            ))
        await session.commit()

    scheduler.configure_scheduler()
    scheduler.schedule_prediction_market_catalogue_retention()
    for job_id in (
        "prediction_market_ingest", "prediction_market_daily_prune",
        "prediction_market_intraday_prune", "prediction_market_catalogue_retention",
    ):
        await scheduler.get_scheduler().get_job(job_id).func()
        assert outcome.await_args.args[:2] == (
            job_id, "failed" if job_id == "prediction_market_ingest" else "ok",
        )
    for fetch in fetches:
        fetch.assert_awaited_once()
    async with sessions() as session:
        for model in (PredictionMarketSnapshot, PredictionMarketIntradaySnapshot, PredictionMarket):
            assert (await session.scalars(select(model.source_id))).all() == ["recent"]
