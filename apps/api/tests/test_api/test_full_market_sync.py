import asyncio
from copy import deepcopy
from types import SimpleNamespace

import pytest

from vnibb.services.data_pipeline import data_pipeline
from vnibb.services.sync_all_data import FullMarketSync, SyncResult, run_daily_market_sync


def make_result(count: int) -> SyncResult:
    return SyncResult(
        success=True,
        synced_count=count,
        error_count=0,
        duration_seconds=0.1,
        errors=[],
    )


@pytest.mark.asyncio
async def test_run_full_sync_includes_corporate_actions(monkeypatch):
    sync = FullMarketSync()
    calls: list[object] = []

    async def fake_sync_all_symbols():
        calls.append("symbols")
        return make_result(5)

    async def fake_get_seeded_symbols(max_symbols=None):
        calls.append(("seeded", max_symbols))
        return ["VNM", "FPT"]

    async def fake_sync_all_prices(*, symbols=None, include_historical=False, history_days=None):
        calls.append(("prices", tuple(symbols or []), include_historical, history_days))
        return make_result(10)

    async def fake_sync_all_profiles(*, symbols=None, max_symbols=None):
        calls.append(("profiles", tuple(symbols or []), max_symbols))
        return make_result(2)

    async def fake_sync_all_indices():
        calls.append("indices")
        return make_result(4)

    async def fake_sync_all_financials(*, symbols=None, max_symbols=None):
        calls.append(("financials", tuple(symbols or []), max_symbols))
        return make_result(4)

    async def fake_sync_all_corporate_actions(*, symbols=None, max_symbols=None):
        calls.append(("corporate_actions", tuple(symbols or []), max_symbols))
        return make_result(3)

    monkeypatch.setattr(sync, "sync_all_symbols", fake_sync_all_symbols)
    monkeypatch.setattr(sync, "_get_seeded_symbols", fake_get_seeded_symbols)
    monkeypatch.setattr(sync, "sync_all_prices", fake_sync_all_prices)
    monkeypatch.setattr(sync, "sync_all_indices", fake_sync_all_indices)
    monkeypatch.setattr(sync, "sync_all_profiles", fake_sync_all_profiles)
    monkeypatch.setattr(sync, "sync_all_financials", fake_sync_all_financials)
    monkeypatch.setattr(sync, "sync_all_corporate_actions", fake_sync_all_corporate_actions)

    results = await sync.run_full_sync(
        include_historical=True,
        include_corporate_actions=True,
        max_symbols=2,
        history_days=120,
    )

    assert list(results.keys()) == [
        "symbols",
        "prices",
        "indices",
        "profiles",
        "financials",
        "corporate_actions",
    ]
    assert calls == [
        "symbols",
        ("seeded", 2),
        ("prices", ("VNM", "FPT"), True, 120),
        "indices",
        ("profiles", ("VNM", "FPT"), None),
        ("financials", ("VNM", "FPT"), None),
        ("corporate_actions", ("VNM", "FPT"), None),
    ]


@pytest.mark.asyncio
async def test_run_full_sync_can_skip_corporate_actions(monkeypatch):
    sync = FullMarketSync()

    async def fake_sync_all_symbols():
        return make_result(5)

    async def fake_get_seeded_symbols(max_symbols=None):
        return ["VNM"]

    async def fake_sync_all_prices(*, symbols=None, include_historical=False, history_days=None):
        return make_result(1)

    async def fake_sync_all_profiles(*, symbols=None, max_symbols=None):
        return make_result(1)

    async def fake_sync_all_indices():
        return make_result(1)

    async def fake_sync_all_financials(*, symbols=None, max_symbols=None):
        return make_result(1)

    async def fail_sync_all_corporate_actions(*, symbols=None, max_symbols=None):
        raise AssertionError("corporate actions stage should not run")

    monkeypatch.setattr(sync, "sync_all_symbols", fake_sync_all_symbols)
    monkeypatch.setattr(sync, "_get_seeded_symbols", fake_get_seeded_symbols)
    monkeypatch.setattr(sync, "sync_all_prices", fake_sync_all_prices)
    monkeypatch.setattr(sync, "sync_all_indices", fake_sync_all_indices)
    monkeypatch.setattr(sync, "sync_all_profiles", fake_sync_all_profiles)
    monkeypatch.setattr(sync, "sync_all_financials", fake_sync_all_financials)
    monkeypatch.setattr(sync, "sync_all_corporate_actions", fail_sync_all_corporate_actions)

    results = await sync.run_full_sync(include_corporate_actions=False)

    assert list(results.keys()) == ["symbols", "prices", "indices", "profiles", "financials"]


@pytest.mark.asyncio
async def test_run_daily_market_sync_uses_gap_fill_window(monkeypatch):
    calls: list[object] = []

    async def fake_get_seeded_symbols(self):
        calls.append("seeded")
        return ["VNM", "FPT"]

    async def fake_screener(*, progress, enrich_ratios):
        assert enrich_ratios is False
        calls.append("screener_universe")
        return 2

    async def fake_prices(**kwargs):
        calls.append(("prices", tuple(kwargs["symbols"]), kwargs["days"], kwargs["fill_missing_gaps"]))
        return 20

    async def fake_create(*args):
        return 99

    async def fake_update(*args, **kwargs):
        calls.append(("ledger", kwargs))

    async def fake_sync_all_indices(self):
        calls.append("indices")
        return make_result(4)

    async def fake_maintenance(self, symbols, budget_seconds=None):
        return SyncResult(True, 2, 0, 0.1, [], complete=False, pending_count=6)

    async def fake_sync_dividends(symbols=None, progress=None):
        calls.append(("dividends", tuple(symbols or [])))
        return 2

    async def fake_sync_company_events(symbols=None, progress=None):
        calls.append(("company_events", tuple(symbols or [])))
        return 3

    async def fake_calculate_all_rs_ratings(self, calculation_date=None):
        calls.append(("rs_ratings", calculation_date))
        return {"success": True, "total_stocks": 2}

    async def fail_run_full_sync(self, **kwargs):
        raise AssertionError("daily market sync should not call full sync")

    monkeypatch.setattr(FullMarketSync, "_get_seeded_symbols", fake_get_seeded_symbols)
    monkeypatch.setattr(FullMarketSync, "run_full_sync", fail_run_full_sync)
    monkeypatch.setattr(data_pipeline, "sync_screener_data", fake_screener)
    monkeypatch.setattr(data_pipeline, "sync_daily_prices", fake_prices)
    monkeypatch.setattr(data_pipeline, "_create_sync_record", fake_create)
    monkeypatch.setattr(data_pipeline, "_update_sync_record", fake_update)
    monkeypatch.setattr(FullMarketSync, "sync_all_indices", fake_sync_all_indices)
    monkeypatch.setattr(FullMarketSync, "sync_daily_maintenance", fake_maintenance)
    monkeypatch.setattr(FullMarketSync, "sync_daily_profiles", fake_maintenance)
    monkeypatch.setattr(data_pipeline, "sync_dividends", fake_sync_dividends)
    monkeypatch.setattr(data_pipeline, "sync_company_events", fake_sync_company_events)
    monkeypatch.setattr(
        "vnibb.services.rs_rating_service.RSRatingService.calculate_all_rs_ratings",
        fake_calculate_all_rs_ratings,
    )

    results = await run_daily_market_sync()

    assert list(results) == ["daily_prices", "screener", "indices", "rs_ratings", "corporate_actions", "profiles", "financials"]
    assert results["daily_prices"].synced_count == 20
    assert results["screener"].synced_count == 2
    assert calls.index(("prices", ("VNM", "FPT"), 21, True)) < calls.index("screener_universe")
    ledger = [item[1] for item in calls if isinstance(item, tuple) and item[0] == "ledger"][-1]
    assert ledger["status"] == "partial"
    assert ledger["additional_data"]["expected_count"] == 2
    assert ledger["additional_data"]["stages"]["financials"]["pending_count"] == 6


@pytest.fixture
def daily_receipts(monkeypatch):
    receipts = []

    async def seeded(self):
        return ["FPT", "VNM"]

    async def create(*args):
        return 99

    async def update(*args, **kwargs):
        receipts.append(deepcopy(kwargs))

    async def later_stage(self, *args, **kwargs):
        return make_result(0)

    async def ratings(self):
        return {"success": True, "total_stocks": 0}

    monkeypatch.setattr(FullMarketSync, "_get_seeded_symbols", seeded)
    monkeypatch.setattr(data_pipeline, "_create_sync_record", create)
    monkeypatch.setattr(data_pipeline, "_update_sync_record", update)
    for name in ("sync_all_indices", "sync_all_corporate_actions", "sync_daily_profiles", "sync_daily_maintenance"):
        monkeypatch.setattr(FullMarketSync, name, later_stage)
    monkeypatch.setattr(
        "vnibb.services.rs_rating_service.RSRatingService.calculate_all_rs_ratings", ratings
    )
    return receipts


@pytest.mark.asyncio
@pytest.mark.parametrize("raises", [False, True])
async def test_daily_receipt_retains_prices_when_screener_fails(monkeypatch, daily_receipts, raises):
    calls = []

    async def prices(*, progress, **kwargs):
        calls.append("daily_prices")
        progress.update(committed_count=20, success_count=2)
        return 20

    async def screener(*, progress, enrich_ratios):
        calls.append("screener")
        progress.update(committed_count=1, success_count=2, error_count=1,
                        errors=[{"symbol": "VNM", "error": "ratio unavailable"}])
        if raises:
            raise RuntimeError("ratio unavailable")
        return 1

    monkeypatch.setattr(data_pipeline, "sync_daily_prices", prices)
    monkeypatch.setattr(data_pipeline, "sync_screener_data", screener)

    results = await run_daily_market_sync()

    assert calls == ["daily_prices", "screener"]
    assert results["daily_prices"].success
    assert results["daily_prices"].synced_count == 20
    assert not results["screener"].success
    assert not results["screener"].complete
    assert results["screener"].synced_count == 1
    final = daily_receipts[-1]
    assert final["status"] == "partial"
    assert final["success_count"] == 21
    assert final["error_count"] == 1
    stages = final["additional_data"]["stages"]
    assert final["additional_data"]["active_stage"] is None
    assert set(stages) == {"daily_prices", "screener", "indices", "rs_ratings", "corporate_actions", "profiles", "financials"}
    assert stages["daily_prices"]["synced_count"] == 20
    assert stages["screener"]["progress"]["errors"][0]["error"] == "ratio unavailable"


@pytest.mark.asyncio
async def test_daily_price_timeout_still_materializes_retained_screener(monkeypatch, daily_receipts):
    clock = [0.0]

    async def seeded(self):
        clock[0] = 7080.0
        return ["FPT", "VNM"]

    async def prices(*, progress, **kwargs):
        progress.update(committed_count=20, error_count=3, last_symbol="FPT",
                        errors=[{"symbol": "VNM", "error": "source unavailable"}])
        await asyncio.Event().wait()

    async def screener(*, progress, enrich_ratios):
        assert enrich_ratios is False
        progress.update(committed_count=2, base_count=2)
        return 2

    monkeypatch.setattr("vnibb.services.sync_all_data.time", SimpleNamespace(
        monotonic=lambda: clock[0], time=lambda: 0,
    ))
    monkeypatch.setattr(FullMarketSync, "_get_seeded_symbols", seeded)
    monkeypatch.setattr(data_pipeline, "sync_daily_prices", prices)
    monkeypatch.setattr(data_pipeline, "sync_screener_data", screener)

    results = await asyncio.wait_for(run_daily_market_sync(), timeout=1)

    assert not results["daily_prices"].success
    assert not results["daily_prices"].complete
    assert results["daily_prices"].synced_count == 20
    assert results["daily_prices"].error_count == 3
    assert results["screener"].success
    assert results["screener"].synced_count == 2
    final = daily_receipts[-1]
    assert final["status"] == "partial"
    assert final["success_count"] == 22
    assert final["error_count"] == 3
    assert final["additional_data"]["active_stage"] is None
    price_stage = final["additional_data"]["stages"]["daily_prices"]
    assert price_stage["status"] == "failed"
    assert price_stage["progress"]["last_symbol"] == "FPT"
    assert price_stage["progress"]["errors"][0]["error"] == "source unavailable"


@pytest.mark.asyncio
@pytest.mark.parametrize("blocked_stage", ["daily_prices", "screener"])
async def test_daily_receipt_retains_active_stage_on_cancellation(monkeypatch, daily_receipts, blocked_stage):
    entered = asyncio.Event()
    started_with_receipt = []

    async def acquire(name, progress, count):
        receipt = daily_receipts[-1]["additional_data"] if daily_receipts else {}
        started_with_receipt.append(receipt.get("active_stage") == name)
        progress.update(committed_count=count, success_count=2, error_count=1,
                        last_symbol="FPT", errors=[{"symbol": "VNM", "error": "source unavailable"}])
        if name == blocked_stage:
            entered.set()
            await asyncio.Event().wait()
        return count

    async def prices(*, progress, **kwargs):
        return await acquire("daily_prices", progress, 20)

    async def screener(*, progress, enrich_ratios):
        return await acquire("screener", progress, 1)

    monkeypatch.setattr(data_pipeline, "sync_daily_prices", prices)
    monkeypatch.setattr(data_pipeline, "sync_screener_data", screener)
    task = asyncio.create_task(run_daily_market_sync())
    try:
        await asyncio.wait_for(entered.wait(), timeout=1)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    finally:
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    assert all(started_with_receipt)
    assert len(started_with_receipt) == (1 if blocked_stage == "daily_prices" else 2)
    final = daily_receipts[-1]
    assert final["status"] == "failed"
    assert final["success_count"] == (20 if blocked_stage == "daily_prices" else 21)
    assert final["error_count"] >= 1
    metadata = final["additional_data"]
    assert metadata["active_stage"] == blocked_stage
    stage = metadata["stages"][blocked_stage]
    assert stage["status"] == "cancelled"
    assert not stage["complete"]
    assert stage["synced_count"] == (20 if blocked_stage == "daily_prices" else 1)
    assert stage["progress"]["last_symbol"] == "FPT"
    assert stage["progress"]["errors"][0]["error"] == "source unavailable"
    if blocked_stage == "screener":
        assert metadata["stages"]["daily_prices"]["synced_count"] == 20


@pytest.mark.asyncio
@pytest.mark.parametrize("blocked_stage", ["daily_prices", "screener"])
async def test_daily_receipt_cancellation_persists_to_sql(test_engine, monkeypatch, daily_receipts, blocked_stage):
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import async_sessionmaker
    from vnibb.models.sync_status import SyncStatus

    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr("vnibb.services.data_pipeline.async_session_maker", sessions)
    monkeypatch.setattr("vnibb.services.sync_all_data.async_session_maker", sessions)
    for name in ("_create_sync_record", "_update_sync_record"):
        monkeypatch.setattr(data_pipeline, name, getattr(type(data_pipeline), name).__get__(data_pipeline))
    entered = asyncio.Event()

    async def acquire(name, progress, count):
        progress.update(committed_count=count, error_count=1, last_symbol="FPT")
        if name == blocked_stage:
            async with sessions() as session:
                row = (await session.scalars(select(SyncStatus))).one()
                assert row.additional_data["active_stage"] == name
                assert row.additional_data["stages"][name]["status"] == "running"
            entered.set()
            await asyncio.Event().wait()
        return count

    async def prices(*, progress, **kwargs):
        return await acquire("daily_prices", progress, 20)

    async def screener(*, progress, enrich_ratios):
        return await acquire("screener", progress, 1)

    monkeypatch.setattr(data_pipeline, "sync_daily_prices", prices)
    monkeypatch.setattr(data_pipeline, "sync_screener_data", screener)
    task = asyncio.create_task(run_daily_market_sync())
    try:
        await asyncio.wait_for(entered.wait(), timeout=1)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    finally:
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async with sessions() as session:
        row = (await session.scalars(select(SyncStatus))).one()
        assert row.sync_type == "daily_market"
        assert row.status == "failed"
        assert row.success_count == (20 if blocked_stage == "daily_prices" else 21)
        assert row.error_count >= 1
        assert row.additional_data["expected_symbols"] == ["FPT", "VNM"]
        stage = row.additional_data["stages"][blocked_stage]
        assert row.additional_data["active_stage"] == blocked_stage
        assert stage["status"] == "cancelled"
        assert stage["progress"]["last_symbol"] == "FPT"
        assert stage["synced_count"] == (20 if blocked_stage == "daily_prices" else 1)
