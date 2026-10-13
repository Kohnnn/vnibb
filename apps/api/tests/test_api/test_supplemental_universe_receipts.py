from datetime import date

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from vnibb.models.sync_status import SyncStatus
from vnibb.services import sync_all_data
from vnibb.services.sync_all_data import FullMarketSync


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
