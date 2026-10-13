"""Trading acquisition must cover the Universe with genuine ticks and current depth."""

from copy import deepcopy
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from vnibb.core.config import settings
from vnibb.services import realtime_pipeline, sync_all_data


class Lease:
    async def acquire(self):
        return "acquired"

    async def release(self):
        return True


@pytest.mark.asyncio
@pytest.mark.parametrize("raises", [True, False])
async def test_derivative_failure_keeps_universe_receipt_independent(monkeypatch, raises):
    cycle = SimpleNamespace(complete=True, pending_count=0)
    runner = AsyncMock(return_value=cycle)
    monkeypatch.setattr(realtime_pipeline, "is_vietnam_market_open", lambda: True)
    monkeypatch.setattr(realtime_pipeline, "DistributedJobLock", lambda *_: Lease())
    monkeypatch.setattr(sync_all_data.FullMarketSync, "_get_seeded_symbols", AsyncMock(return_value=["AAA"]))
    monkeypatch.setattr(sync_all_data.FullMarketSync, "run_maintenance_cycle", runner)
    async def derivative(*, progress):
        if raises:
            raise RuntimeError("unavailable")
        progress["error_count"] = 1
        return 0

    monkeypatch.setattr(sync_all_data.data_pipeline, "sync_derivatives_prices", derivative)
    monkeypatch.setattr(sync_all_data.data_pipeline, "_create_sync_record", AsyncMock(return_value=17))
    update = AsyncMock()
    monkeypatch.setattr(sync_all_data.data_pipeline, "_update_sync_record", update)

    assert await realtime_pipeline.run_intraday_sync() is cycle
    assert cycle.complete is True
    assert update.call_args.kwargs["status"] == "failed"
    assert update.call_args.kwargs["additional_data"]["scope"] == "derivatives_only"


@pytest.mark.asyncio
@pytest.mark.parametrize("universe_size,batch_size", [(3, 1), (125, 60)])
async def test_full_universe_rotation_resumes_after_restart_and_provider_failure(monkeypatch, universe_size, batch_size):
    records = []
    calls = []
    symbols = [f"S{index:03d}" for index in range(universe_size)]

    class Session:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return False

        async def scalars(self, _):
            rotations = [record for record in records if record.sync_type == "intraday_universe_rotation"]
            return SimpleNamespace(first=lambda: rotations[-1] if rotations else None)

    async def create(sync_type, *_):
        record = SimpleNamespace(id=len(records) + 1, sync_type=sync_type, additional_data={},
                                 status="running", completed_at=None)
        records.append(record)
        return record.id

    async def update(sync_id, **kwargs):
        record = records[sync_id - 1]
        for key, value in kwargs.items():
            setattr(record, key, deepcopy(value))
        if record.status == "completed":
            record.completed_at = datetime.utcnow()

    async def ticks(*, symbols, progress, live_session, retain_ticks):
        assert live_session is True
        assert retain_ticks is True
        calls.append((symbols[0], "ticks"))
        if symbols == ["S000"]:
            progress["error_count"] = 1
            return 0
        progress["acquisition_outcomes"] = {"sql": "succeeded", "mongo": "failed"}
        progress["error_count"] = 1
        return 1

    async def depth(*, symbols, progress, live_session):
        assert live_session is True
        calls.append((symbols[0], "depth"))
        progress["empty_count"] = 1
        return 0

    monkeypatch.setattr(realtime_pipeline, "is_vietnam_market_open", lambda: True)
    monkeypatch.setattr(realtime_pipeline, "DistributedJobLock", lambda *_: Lease())
    monkeypatch.setattr(sync_all_data.FullMarketSync, "_get_seeded_symbols", AsyncMock(return_value=list(reversed(symbols))))
    monkeypatch.setattr(sync_all_data, "async_session_maker", Session)
    monkeypatch.setattr(sync_all_data.data_pipeline, "_create_sync_record", create)
    monkeypatch.setattr(sync_all_data.data_pipeline, "_update_sync_record", update)
    monkeypatch.setattr(sync_all_data.data_pipeline, "sync_intraday_trades", ticks)
    monkeypatch.setattr(sync_all_data.data_pipeline, "sync_orderbook_snapshots", depth)
    monkeypatch.setattr(sync_all_data.data_pipeline, "sync_derivatives_prices", AsyncMock(return_value=1))
    from vnibb.providers.vnstock import runtime
    monkeypatch.setattr(runtime, "financial_provider_busy", lambda: False)

    for start in range(0, universe_size, batch_size):
        monkeypatch.setattr(settings, "scheduler_live_symbols_per_run", min(batch_size, universe_size - start))
        await realtime_pipeline.run_intraday_sync()

    assert calls == [(symbol, stage) for symbol in symbols for stage in ("ticks", "depth")]
    metadata = next(record.additional_data for record in reversed(records)
                    if record.sync_type == "intraday_universe_rotation")
    assert metadata["expected_symbols"] == symbols
    assert metadata["complete"] is False
    assert metadata["stages"]["intraday_trades"]["failed_symbols"] == symbols
    assert metadata["stages"]["intraday_trades"]["receipts"][symbols[-1]]["acquisition_outcomes"] == {"sql": "succeeded", "mongo": "failed"}
    assert metadata["stages"]["orderbook_snapshots"]["acquired_symbols"] == symbols


@pytest.mark.asyncio
async def test_default_polling_uses_universe_rotation_not_quote_board(monkeypatch):
    pipeline = realtime_pipeline.RealtimePipeline()
    pipeline.is_running = True
    rotation = AsyncMock(return_value=SimpleNamespace(complete=False, pending_count=2))
    monkeypatch.setattr(realtime_pipeline, "run_intraday_sync", rotation)
    monkeypatch.setattr(realtime_pipeline, "is_vietnam_market_open", lambda: True)
    monkeypatch.setattr(realtime_pipeline.asyncio, "sleep", AsyncMock(side_effect=lambda _: setattr(pipeline, "is_running", False)))

    await pipeline._polling_fallback(None)

    rotation.assert_awaited_once_with(symbols=None)
    assert pipeline.get_status()["coverage"]["scope"] == "full_universe_rotation"
    assert pipeline.get_status()["coverage"]["complete"] is False
    assert pipeline.get_status()["coverage"]["completion_basis"] == "symbol_dataset_acquisition_cycle"
    assert pipeline.get_status()["coverage"]["tick_session_totals_verified"] is False
    assert pipeline.get_status()["coverage"]["historical_depth_replay"] is False


@pytest.mark.asyncio
async def test_closed_session_does_not_resolve_universe_or_call_provider(monkeypatch):
    monkeypatch.setattr(realtime_pipeline, "is_vietnam_market_open", lambda: False)
    universe = AsyncMock()
    monkeypatch.setattr(sync_all_data.FullMarketSync, "_get_seeded_symbols", universe)

    assert await realtime_pipeline.run_intraday_sync() is None
    universe.assert_not_awaited()


@pytest.mark.asyncio
async def test_contended_rotation_never_acquires_or_mutates_coverage(monkeypatch):
    lease = Lease()
    lease.acquire = AsyncMock(return_value="contended")
    monkeypatch.setattr(realtime_pipeline, "DistributedJobLock", lambda *_: lease)
    monkeypatch.setattr(realtime_pipeline, "is_vietnam_market_open", lambda: True)
    universe = AsyncMock()
    monkeypatch.setattr(sync_all_data.FullMarketSync, "_get_seeded_symbols", universe)

    assert await realtime_pipeline.run_intraday_sync() is None
    universe.assert_not_awaited()


@pytest.mark.asyncio
async def test_scheduler_uses_durable_intraday_entrypoint(monkeypatch):
    from apscheduler.schedulers.asyncio import AsyncIOScheduler
    from vnibb.core import scheduler

    rotation = AsyncMock()
    scheduler_instance = AsyncIOScheduler(timezone="UTC")
    monkeypatch.setattr(scheduler, "_scheduler", scheduler_instance)
    monkeypatch.setattr(realtime_pipeline, "run_intraday_sync", rotation)

    async def guarded(_name, operation, _timeout):
        return await operation()

    monkeypatch.setattr(scheduler, "_run_guarded_job", guarded)
    scheduler.configure_scheduler()
    await scheduler_instance.get_job("intraday_sync").func()

    rotation.assert_awaited_once_with()


@pytest.mark.asyncio
async def test_public_status_exposes_incomplete_universe_coverage(monkeypatch):
    from vnibb.api.v1 import realtime

    pipeline = realtime_pipeline.RealtimePipeline()
    pipeline._coverage = {"scope": "full_universe_rotation", "complete": False, "pending_pairs": 7}
    monkeypatch.setattr(realtime, "get_realtime_pipeline", lambda: pipeline)

    status = await realtime.get_status()

    assert status.coverage == pipeline.get_status()["coverage"]


@pytest.mark.asyncio
async def test_requested_subset_reports_its_own_scope_and_never_completes_full_cycle(monkeypatch):
    pipeline = realtime_pipeline.RealtimePipeline()
    pipeline.is_running = True
    types = []
    universe = AsyncMock(return_value=["AAA", "BBB", "CCC"])
    monkeypatch.setattr(realtime_pipeline, "is_vietnam_market_open", lambda: True)
    monkeypatch.setattr(realtime_pipeline, "DistributedJobLock", lambda *_: Lease())
    monkeypatch.setattr(sync_all_data.FullMarketSync, "_get_seeded_symbols", universe)
    monkeypatch.setattr(sync_all_data.data_pipeline, "sync_derivatives_prices", AsyncMock(return_value=0))
    monkeypatch.setattr(sync_all_data.data_pipeline, "_create_sync_record", AsyncMock(return_value=1))
    monkeypatch.setattr(sync_all_data.data_pipeline, "_update_sync_record", AsyncMock())
    monkeypatch.setattr(sync_all_data.FullMarketSync, "run_maintenance_cycle",
                        AsyncMock(side_effect=lambda sync_type, symbols, *_a, **_k:
                                  types.append((sync_type, symbols)) or SimpleNamespace(
                                      complete=False, pending_count=2)))
    monkeypatch.setattr(realtime_pipeline.asyncio, "sleep",
                        AsyncMock(side_effect=lambda _: setattr(pipeline, "is_running", False)))

    await pipeline._polling_fallback(["bbb", "MISSING"])

    assert types[0][1] == ["BBB"]
    assert types[0][0].startswith("intraday_subset_rotation_")
    coverage = pipeline.get_status()["coverage"]
    assert coverage["scope"] == "explicit_subset_rotation"
    assert coverage["complete"] is False
    assert coverage["completion_basis"] == "symbol_dataset_acquisition_cycle"
