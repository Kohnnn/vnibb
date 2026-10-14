from datetime import date
from threading import Event
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pandas as pd
import pytest
from requests.exceptions import ReadTimeout
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker
from vnibb.core.config import settings
from vnibb.models.sync_status import SyncStatus
from vnibb.providers.vnstock import runtime
from vnibb.services import sync_all_data
from vnibb.services.sync_all_data import FullMarketSync


@pytest.mark.asyncio
@pytest.mark.parametrize("dataset,method", [("shareholders", "shareholders"), ("officers", "officers"), ("subsidiaries", "subsidiaries"), ("company_news", "news")])
@pytest.mark.parametrize("source_outcome", ["timeout", "http_error", "empty", "quota_exhausted"])
async def test_provider_failure_and_successful_empty_reach_persisted_reference_receipts(
    test_engine, monkeypatch, dataset, method, source_outcome,
):
    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(sync_all_data, "async_session_maker", sessions)
    monkeypatch.setattr("vnibb.services.data_pipeline.async_session_maker", sessions)
    monkeypatch.setattr(sync_all_data.data_pipeline, "_wait_for_rate_limit", AsyncMock())
    requests = []
    timeout_seconds = settings.vnstock_timeout
    released = Event() if source_outcome == "timeout" else None
    started = Event() if source_outcome == "timeout" else None
    if released is not None:
        timeout_seconds = 0.25
        monkeypatch.setattr(settings, "vnstock_timeout", timeout_seconds)

    def request():
        requests.append(method)
        if started is not None:
            started.set()
        if source_outcome == "http_error":
            raise ReadTimeout("HTTPSConnectionPool(host='iq.vietcap.com.vn'): Read timed out. (read timeout=30)")
        if source_outcome == "quota_exhausted":
            # vnai CleanErrorContext converts SDK RateLimitExceeded into sys.exit(SystemExit).
            class RateLimitExceeded(Exception):
                pass

            try:
                raise RateLimitExceeded("API quota exhausted")
            except RateLimitExceeded as exc:
                raise SystemExit("Rate limit exceeded. API quota exhausted. Process terminated.") from exc
        if released is not None:
            # Real provider work outlives the configured deadline; the executor thread exits after assertion.
            released.wait(30)
        return pd.DataFrame()

    class Vnstock:
        def stock(self, *, symbol, source):
            assert symbol == "ACC" and source == "VCI"
            return SimpleNamespace(company=SimpleNamespace(**{method: request}))

    monkeypatch.setattr(runtime, "get_vnstock_class", lambda: Vnstock)

    async def acquire(symbol, progress):
        return await getattr(sync_all_data.data_pipeline, f"sync_{dataset}")(symbols=[symbol], progress=progress)

    try:
        result = await FullMarketSync().run_maintenance_cycle(
            "provider_receipt_fixture", ["ACC"], [(dataset, acquire)], 30, 1, allow_empty=True,
        )
    finally:
        if released is not None:
            released.set()
            started.wait(5)


    async with sessions() as session:
        row = (await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == "provider_receipt_fixture"))).one()
        stage = row.additional_data["stages"][dataset]
        receipt = stage["receipts"]["ACC"]

    assert requests == [method]
    if source_outcome == "empty":
        assert result.success and result.complete
        assert stage["acquired_symbols"] == ["ACC"] and stage["failed_symbols"] == []
        assert receipt["outcome"] == "empty" and receipt["rows"] == 0
        assert receipt["stage_stats"][dataset]["empty"] == 1
        assert "error" not in receipt
    else:
        assert not result.success and not result.complete and result.error_count == 1
        assert stage["acquired_symbols"] == [] and stage["failed_symbols"] == ["ACC"]
        assert receipt["outcome"] == "failed" and "last_succeeded_at" not in receipt
        assert receipt["stage_stats"][dataset]["errors"] == 1
        assert not receipt["stage_stats"][dataset].get("empty")
        assert "TypeError" not in receipt["error"]
        assert receipt["errors"][0]["error"] == receipt["error"]
        if source_outcome == "timeout":
            assert f"ProviderTimeoutError: Provider vnstock request timed out after {timeout_seconds}s" in receipt["error"]
        elif source_outcome == "quota_exhausted":
            assert receipt["error"].startswith("SystemExit: Rate limit exceeded. API quota exhausted. Process terminated.")
            assert "RateLimitExceeded: API quota exhausted" in receipt["error"]
        else:
            assert "ProviderError" in receipt["error"] and "ReadTimeout" in receipt["error"]


@pytest.mark.asyncio
async def test_persistent_cycle_reaches_tail_all_datasets_after_restart_and_universe_change(test_engine, monkeypatch):
    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(sync_all_data, "async_session_maker", sessions)
    monkeypatch.setattr("vnibb.services.data_pipeline.async_session_maker", sessions)
    symbols = [f"S{index:04d}" for index in range(800)]
    calls = []
    unavailable = {("S0000", "officers")}

    def operation(dataset):
        async def acquire(symbol, progress):
            calls.append((symbol, dataset))
            if (symbol, dataset) in unavailable:
                progress["error_count"] = 1
                return 0
            if dataset == "subsidiaries":
                progress["empty_count"] = 1
                return 0
            return 1
        return acquire

    stages = [(name, operation(name)) for name in ("shareholders", "officers", "subsidiaries", "company_news")]
    first = await FullMarketSync().run_maintenance_cycle(
        "supplemental_fixture", symbols, stages, 300, 1, max_attempts=480, allow_empty=True,
    )
    assert not first.complete and first.error_count == 1
    # A ranking change and an additional confirmed symbol cannot discard successful receipts.
    symbols = list(reversed(symbols)) + ["S0800"]
    unavailable.clear()
    for _ in range(8):
        result = await FullMarketSync().run_maintenance_cycle(
            "supplemental_fixture", symbols, stages, 300, 1, max_attempts=480, allow_empty=True,
        )
        if result.complete:
            break
    assert result.complete
    expected = {(symbol, name) for symbol in symbols for name, _ in stages}
    assert set(calls) == expected
    assert calls.count(("S0000", "shareholders")) == 1
    async with sessions() as session:
        rows = (await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == "supplemental_fixture"))).all()
        assert len(rows) == 1
        metadata = rows[0].additional_data
        assert metadata["complete"] is True
        for name, _ in stages:
            assert metadata["stages"][name]["pending_count"] == 0
            for symbol in symbols:
                receipt = metadata["stages"][name]["receipts"][symbol]
                assert receipt["last_attempted_at"] and receipt["last_succeeded_at"]
                assert receipt["outcome"] == ("empty" if name == "subsidiaries" else "succeeded")
    fresh = await FullMarketSync().run_maintenance_cycle(
        "supplemental_fixture", symbols, stages, 300, 1, max_attempts=480, allow_empty=True,
    )
    assert fresh.synced_count == 0
    async with sessions() as session:
        row = (await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == "supplemental_fixture"))).one()
        assert row.additional_data["attempted_this_run"] == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("target_day", [date(2026, 10, 13), date(2026, 10, 17)])
async def test_supplemental_weekend_and_weekday_use_all_active_symbols(monkeypatch, target_day):
    symbols = [f"S{index:04d}" for index in range(801)]
    captured = {}

    class Today:
        @staticmethod
        def today():
            return target_day

    monkeypatch.setattr(sync_all_data, "date", Today)

    async def universe(self, max_symbols=None):
        assert max_symbols is None
        return symbols

    async def cycle(self, sync_type, selected, stages, budget_seconds, refresh_days, **kwargs):
        captured.update(selected=selected, stages=[name for name, _ in stages], kwargs=kwargs)
        return sync_all_data.SyncResult(True, 0, 0, 0, [], False, len(selected))

    monkeypatch.setattr(FullMarketSync, "_get_seeded_symbols", universe)
    monkeypatch.setattr(FullMarketSync, "run_maintenance_cycle", cycle)

    async def sector_refresh():
        return 1

    monkeypatch.setattr(sync_all_data.data_pipeline, "sync_market_sectors", sector_refresh)
    monkeypatch.setattr(sync_all_data.data_pipeline, "sync_sector_performance", sector_refresh)
    result = await sync_all_data.run_supplemental_company_sync()
    assert captured["selected"] == symbols
    assert {"shareholders", "officers", "subsidiaries", "company_news", "insider_deals"} <= set(captured["stages"])
    assert captured["kwargs"]["max_attempts"] > 0
    assert result["supplemental_company"].pending_count == 801


@pytest.mark.asyncio
async def test_skipped_runs_do_not_reset_and_new_cycles_retain_last_success(test_engine, monkeypatch):
    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(sync_all_data, "async_session_maker", sessions)
    monkeypatch.setattr("vnibb.services.data_pipeline.async_session_maker", sessions)
    calls = []

    async def acquire(symbol, progress):
        calls.append(symbol)
        return 1

    stages = [("officers", acquire)]
    first = await FullMarketSync().run_maintenance_cycle("skipped_fixture", ["ACB", "VNM"], stages, 30, 0, max_attempts=1)
    assert not first.complete
    # No calls occur during a skipped scheduler run; a restarted owner resumes persisted work.
    second = await FullMarketSync().run_maintenance_cycle("skipped_fixture", ["ACB", "VNM"], stages, 30, 0, max_attempts=1)
    assert second.complete and calls == ["ACB", "VNM"]
    third = await FullMarketSync().run_maintenance_cycle("skipped_fixture", ["ACB", "VNM"], stages, 30, 0, max_attempts=1)
    assert not third.complete and calls == ["ACB", "VNM", "ACB"]
    async with sessions() as session:
        row = (await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == "skipped_fixture").order_by(SyncStatus.id.desc()))).first()
        receipt = row.additional_data["stages"]["officers"]["receipts"]["VNM"]
        assert receipt["last_succeeded_at"]
        assert "VNM" not in row.additional_data["stages"]["officers"]["acquired_symbols"]


@pytest.mark.asyncio
async def test_legacy_empty_revalidation_is_exact_guarded_and_preserves_receipt(test_engine, monkeypatch):
    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(sync_all_data, "async_session_maker", sessions)
    monkeypatch.setattr("vnibb.services.data_pipeline.async_session_maker", sessions)
    calls = []

    async def acquire(symbol, progress):
        calls.append(symbol)
        if symbol == "ACC":
            progress["empty_count"] = 1
            return 0
        return 1

    stages = [("officers", acquire)]
    await FullMarketSync().run_maintenance_cycle("revalidation_fixture", ["ACC", "VNM"], stages, 30, 1, allow_empty=True)
    async with sessions() as session:
        row = (await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == "revalidation_fixture"))).one()
        original = row.additional_data["stages"]["officers"]["receipts"]["ACC"].copy()
    targets = [{"symbol": "ACC", "stage": "officers", "expected_last_attempted_at": original["last_attempted_at"],
                "expected_last_succeeded_at": original["last_succeeded_at"]}]
    await FullMarketSync().run_maintenance_cycle(
        "revalidation_fixture", ["ACC", "VNM"], stages, 30, 1, allow_empty=True,
        revalidate_empty_receipts=[{**targets[0], "expected_last_attempted_at": "2020-01-01T00:00:00"}],
    )
    assert calls == ["ACC", "VNM"]
    result = await FullMarketSync().run_maintenance_cycle(
        "revalidation_fixture", ["ACC", "VNM"], stages, 30, 1, allow_empty=True, revalidate_empty_receipts=targets,
    )
    assert result.complete and calls == ["ACC", "VNM", "ACC"]
    async with sessions() as session:
        row = (await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == "revalidation_fixture"))).one()
        receipt = row.additional_data["stages"]["officers"]["receipts"]["ACC"]
        assert receipt["previous_empty_receipts"] == [original]
    await FullMarketSync().run_maintenance_cycle(
        "revalidation_fixture", ["ACC", "VNM"], stages, 30, 1, allow_empty=True, revalidate_empty_receipts=targets,
    )
    assert calls == ["ACC", "VNM", "ACC"]


@pytest.mark.asyncio
async def test_first_pass_resumes_deferred_but_skips_terminal_failures(test_engine, monkeypatch):
    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(sync_all_data, "async_session_maker", sessions)
    monkeypatch.setattr("vnibb.services.data_pipeline.async_session_maker", sessions)
    calls = []

    async def acquire(symbol, progress):
        calls.append(symbol)
        progress["error_count"] = 1
        return 0

    stages = [("officers", acquire)]
    await FullMarketSync().run_maintenance_cycle("first_pass_fixture", ["ACC", "VNM"], stages, 30, 1, max_attempts=1)
    async with sessions() as session:
        row = (await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == "first_pass_fixture"))).one()
        metadata = dict(row.additional_data)
        metadata["stages"]["officers"]["receipts"]["VNM"] = {"outcome": "deferred", "error": "TimeoutError"}
        row.additional_data = metadata
        await session.commit()
    await FullMarketSync().run_maintenance_cycle(
        "first_pass_fixture", ["ACC", "VNM"], stages, 30, 1, first_pass_only=True,
    )
    await FullMarketSync().run_maintenance_cycle(
        "first_pass_fixture", ["ACC", "VNM"], stages, 30, 1, first_pass_only=True,
    )
    assert calls == ["ACC", "VNM"]


@pytest.mark.asyncio
async def test_legacy_revalidation_resumes_budget_interruption_without_duplicate_lineage(test_engine, monkeypatch):
    import asyncio

    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(sync_all_data, "async_session_maker", sessions)
    monkeypatch.setattr("vnibb.services.data_pipeline.async_session_maker", sessions)
    calls = []
    interrupted = False

    async def acquire(symbol, progress):
        calls.append(symbol)
        if interrupted:
            await asyncio.sleep(60)
        progress["empty_count"] = 1
        return 0

    stages = [("officers", acquire)]
    await FullMarketSync().run_maintenance_cycle("interrupted_revalidation", ["ACC"], stages, 30, 1, allow_empty=True)
    async with sessions() as session:
        row = (await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == "interrupted_revalidation"))).one()
        original = row.additional_data["stages"]["officers"]["receipts"]["ACC"].copy()
    targets = [{"symbol": "ACC", "stage": "officers", "expected_last_attempted_at": original["last_attempted_at"],
                "expected_last_succeeded_at": original["last_succeeded_at"]}]
    interrupted = True
    result = await FullMarketSync().run_maintenance_cycle(
        "interrupted_revalidation", ["ACC"], stages, 0.25, 1, allow_empty=True, revalidate_empty_receipts=targets,
    )
    assert not result.complete
    interrupted = False
    await FullMarketSync().run_maintenance_cycle(
        "interrupted_revalidation", ["ACC"], stages, 30, 1, allow_empty=True, revalidate_empty_receipts=targets,
    )
    async with sessions() as session:
        row = (await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == "interrupted_revalidation"))).one()
        receipt = row.additional_data["stages"]["officers"]["receipts"]["ACC"]
        assert receipt["outcome"] == "empty"
        assert receipt["previous_empty_receipts"] == [original]
    assert calls == ["ACC", "ACC", "ACC"]


@pytest.mark.asyncio
async def test_subset_work_retains_canonical_universe_progress(test_engine, monkeypatch):
    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(sync_all_data, "async_session_maker", sessions)
    monkeypatch.setattr("vnibb.services.data_pipeline.async_session_maker", sessions)
    calls = []

    async def acquire(symbol, progress):
        calls.append(symbol)
        return 1

    sync = FullMarketSync()
    symbols = ["ACC", "FPT", "VNM"]
    stages = [("officers", acquire)]
    first = await sync.run_maintenance_cycle(
        "subset_reference_fixture", symbols, stages, 30, 7, work_symbols=["ACC"],
    )
    assert first.success and not first.complete and first.pending_count == 2
    second = await sync.run_maintenance_cycle(
        "subset_reference_fixture", symbols, stages, 30, 7, work_symbols=["VNM"],
    )
    assert second.success and not second.complete and second.pending_count == 1
    async with sessions() as session:
        row = (await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == "subset_reference_fixture"))).one()
        metadata = row.additional_data
        assert row.status == "partial" and row.success_count == 2
        assert metadata["expected_symbols"] == symbols and metadata["expected_pairs"] == 3
        assert metadata["stages"]["officers"]["acquired_symbols"] == ["ACC", "VNM"]
    repeated = await sync.run_maintenance_cycle(
        "subset_reference_fixture", symbols, stages, 30, 7, work_symbols=["ACC"],
    )
    assert not repeated.complete and repeated.synced_count == 0
    completed = await sync.run_maintenance_cycle("subset_reference_fixture", symbols, stages, 30, 7)
    assert completed.complete and calls == ["ACC", "VNM", "FPT"]
    fresh = await sync.run_maintenance_cycle(
        "subset_reference_fixture", symbols, stages, 30, 7, work_symbols=["VNM"],
    )
    assert fresh.complete and fresh.synced_count == 0 and calls == ["ACC", "VNM", "FPT"]


@pytest.mark.asyncio
@pytest.mark.parametrize("max_attempts", [0, 1])
async def test_all_legacy_revalidation_targets_are_outstanding_before_bounded_work(test_engine, monkeypatch, max_attempts):
    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(sync_all_data, "async_session_maker", sessions)
    monkeypatch.setattr("vnibb.services.data_pipeline.async_session_maker", sessions)
    calls = []
    revalidating = False

    async def acquire(symbol, progress):
        if revalidating and not calls:
            async with sessions() as session:
                row = (await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == "bounded_revalidation"))).one()
                state = row.additional_data["stages"]["officers"]
                assert row.status == "running" and row.additional_data["complete"] is False
                assert state["acquired_symbols"] == [] and state["pending_count"] == 2
                assert all(state["receipts"][item]["revalidation_pending"] for item in ("ACC", "VNM"))
        calls.append(symbol)
        progress["empty_count"] = 1
        return 0

    sync = FullMarketSync()
    symbols = ["ACC", "VNM"]
    stages = [("officers", acquire)]
    await sync.run_maintenance_cycle("bounded_revalidation", symbols, stages, 30, 7, allow_empty=True)
    async with sessions() as session:
        row = (await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == "bounded_revalidation"))).one()
        sync_id = row.id
        originals = row.additional_data["stages"]["officers"]["receipts"]
    targets = [{"symbol": symbol, "stage": "officers", "expected_last_attempted_at": originals[symbol]["last_attempted_at"],
                "expected_last_succeeded_at": originals[symbol]["last_succeeded_at"]} for symbol in symbols]
    calls.clear()
    revalidating = True
    bounded = await sync.run_maintenance_cycle(
        "bounded_revalidation", symbols, stages, 30, 7, allow_empty=True,
        max_attempts=max_attempts, revalidate_empty_receipts=targets,
    )
    assert not bounded.complete and bounded.pending_count == 2 - max_attempts
    assert len(calls) == max_attempts
    async with sessions() as session:
        row = (await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == "bounded_revalidation"))).one()
        metadata = row.additional_data
        state = metadata["stages"]["officers"]
        assert row.id == sync_id and row.status == "partial" and metadata["complete"] is False
        assert state["pending_count"] == 2 - max_attempts
        assert set(state["acquired_symbols"]) == set(calls)
        for symbol in symbols:
            receipt = state["receipts"][symbol]
            assert receipt["previous_empty_receipts"] == [originals[symbol]]
            if symbol not in calls:
                assert receipt["outcome"] == "pending" and receipt["revalidation_pending"] is True
                assert receipt["last_attempted_at"] == originals[symbol]["last_attempted_at"]
                assert receipt["last_succeeded_at"] == originals[symbol]["last_succeeded_at"]
    resumed = await sync.run_maintenance_cycle(
        "bounded_revalidation", symbols, stages, 30, 7, allow_empty=True,
        max_attempts=2, revalidate_empty_receipts=targets,
    )
    assert resumed.complete and sorted(calls) == symbols
    replay = await sync.run_maintenance_cycle(
        "bounded_revalidation", symbols, stages, 30, 7, allow_empty=True, revalidate_empty_receipts=targets,
    )
    assert replay.complete and replay.synced_count == 0 and sorted(calls) == symbols
    async with sessions() as session:
        row = (await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == "bounded_revalidation"))).one()
        for symbol in symbols:
            receipt = row.additional_data["stages"]["officers"]["receipts"][symbol]
            assert receipt["previous_empty_receipts"] == [originals[symbol]]
            assert "revalidation_pending" not in receipt
