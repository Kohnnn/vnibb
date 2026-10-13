from datetime import date
from threading import Event
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pandas as pd
from requests.exceptions import ReadTimeout

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from vnibb.models.sync_status import SyncStatus
from vnibb.services import sync_all_data
from vnibb.services.sync_all_data import FullMarketSync
from vnibb.core.config import settings
from vnibb.providers.vnstock import runtime


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
            except RateLimitExceeded:
                raise SystemExit("Rate limit exceeded. API quota exhausted. Process terminated.")
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
