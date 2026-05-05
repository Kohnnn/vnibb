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

    async def fake_sync_all_prices(
        self, *, symbols=None, include_historical=False, history_days=None
    ):
        calls.append(("prices", tuple(symbols or []), include_historical, history_days))
        return make_result(20)

    async def fake_sync_all_indices(self):
        calls.append("indices")
        return make_result(4)

    async def fake_sync_dividends(symbols=None):
        calls.append(("dividends", tuple(symbols or [])))
        return 2

    async def fake_sync_company_events(symbols=None):
        calls.append(("company_events", tuple(symbols or [])))
        return 3

    async def fake_calculate_all_rs_ratings(self, calculation_date=None):
        calls.append(("rs_ratings", calculation_date))
        return {"success": True, "total_stocks": 2}

    async def fail_run_full_sync(self, **kwargs):
        raise AssertionError("daily market sync should not call full sync")

    monkeypatch.setattr(FullMarketSync, "_get_seeded_symbols", fake_get_seeded_symbols)
    monkeypatch.setattr(FullMarketSync, "run_full_sync", fail_run_full_sync)
    monkeypatch.setattr(FullMarketSync, "sync_all_prices", fake_sync_all_prices)
    monkeypatch.setattr(FullMarketSync, "sync_all_indices", fake_sync_all_indices)
    monkeypatch.setattr(data_pipeline, "sync_dividends", fake_sync_dividends)
    monkeypatch.setattr(data_pipeline, "sync_company_events", fake_sync_company_events)
    monkeypatch.setattr(
        "vnibb.services.rs_rating_service.RSRatingService.calculate_all_rs_ratings",
        fake_calculate_all_rs_ratings,
    )

    results = await run_daily_market_sync()

    assert list(results.keys()) == ["prices", "indices", "rs_ratings", "corporate_actions"]
    assert calls == [
        "seeded",
        ("prices", ("VNM", "FPT"), True, 21),
        "indices",
        ("rs_ratings", None),
        ("dividends", ("VNM", "FPT")),
        ("company_events", ("VNM", "FPT")),
    ]
