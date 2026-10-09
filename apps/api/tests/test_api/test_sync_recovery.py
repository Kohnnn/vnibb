import asyncio
import sys
import types
from datetime import date
from threading import Event

import pandas as pd
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker
from vnibb.core import scheduler
from vnibb.models.scheduler_state import SchedulerJobState
from vnibb.models.sync_status import SyncStatus
from vnibb.providers.vnstock import runtime
from vnibb.providers.vnstock.financial_ratios import VnstockFinancialRatiosFetcher
from vnibb.services import sync_all_data
from vnibb.services.data_pipeline import DataPipeline
from vnibb.services.sync_all_data import FullMarketSync, SyncResult


@pytest.mark.asyncio
async def test_cycle_resumes_all_symbols_without_reacquiring_success(test_engine, monkeypatch):
    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(sync_all_data, "async_session_maker", sessions)
    monkeypatch.setattr("vnibb.services.data_pipeline.async_session_maker", sessions)
    now = [0.0]
    monkeypatch.setattr(sync_all_data.time, "monotonic", lambda: now[0])
    calls = []

    async def acquire(symbol, progress):
        calls.append(symbol)
        now[0] += 1
        return 1

    sync = FullMarketSync()
    first = await sync.run_maintenance_cycle("test_cycle", ["VNM", "FPT", "ACB"], [("ratios", acquire)], 1, 30)
    assert first.success and not first.complete and first.pending_count == 2
    async with sessions() as session:
        row = (await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == "test_cycle"))).one()
        assert row.status == "partial"
        assert row.additional_data["expected_symbols"] == ["ACB", "FPT", "VNM"]
    second = await sync.run_maintenance_cycle("test_cycle", ["VNM", "FPT", "ACB"], [("ratios", acquire)], 10, 30)
    assert second.complete and second.pending_count == 0
    assert calls == ["ACB", "FPT", "VNM"]
    third = await sync.run_maintenance_cycle("test_cycle", ["VNM", "FPT", "ACB"], [("ratios", acquire)], 10, 30)
    assert third.complete and third.synced_count == 0
    assert calls == ["ACB", "FPT", "VNM"]


@pytest.mark.asyncio
async def test_unavailable_symbol_does_not_block_rest_or_certify_cycle(test_engine, monkeypatch):
    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(sync_all_data, "async_session_maker", sessions)
    monkeypatch.setattr("vnibb.services.data_pipeline.async_session_maker", sessions)
    available = [False]
    calls = []

    async def acquire(symbol, progress):
        calls.append(symbol)
        return int(symbol != "ACB" or available[0])

    sync = FullMarketSync()
    first = await sync.run_maintenance_cycle("test_failed_cycle", ["ACB", "FPT"], [("ratios", acquire)], 10, 30)
    assert not first.success and not first.complete and first.pending_count == 1
    available[0] = True
    recovered = await sync.run_maintenance_cycle("test_failed_cycle", ["ACB", "FPT"], [("ratios", acquire)], 10, 30)
    assert recovered.success and recovered.complete
    assert calls == ["ACB", "FPT", "ACB"]


@pytest.mark.asyncio
async def test_guarded_ratio_job_records_failed_partial_and_complete(test_engine, monkeypatch):
    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(scheduler, "async_session_factory", sessions)
    monkeypatch.setattr(scheduler.settings, "scheduler_lock_mode", "best_effort")
    monkeypatch.setattr(scheduler, "_job_guards", {})

    class NoLock:
        def __init__(self, *_):
            pass

        async def acquire(self):
            return "unavailable"

    monkeypatch.setattr(scheduler, "DistributedJobLock", NoLock)
    for result, outcome, failures in [
        (SyncResult(False, 0, 1, 0, ["unavailable"], False, 2), "failed", 1),
        (SyncResult(True, 1, 0, 0, [], False, 1), "partial", 1),
        (SyncResult(True, 1, 0, 0, []), "ok", 0),
    ]:
        async def run(result=result):
            return result
        await scheduler._run_guarded_job("test_ratios_guard", run, 10)
        async with sessions() as session:
            state = await session.get(SchedulerJobState, "test_ratios_guard")
            assert state.last_outcome == outcome
            assert state.consecutive_failures == failures


@pytest.mark.asyncio
async def test_modular_sponsor_finance_is_used_without_legacy_wrapper(monkeypatch):
    calls = []

    class Finance:
        def __init__(self, symbol, source):
            calls.append((symbol, source))

        def ratio(self, period, lang="en"):
            return pd.DataFrame([{"period": "2025", "pe": 12.0}])

    module = types.ModuleType("vnstock_data")
    module.Finance = Finance
    monkeypatch.setitem(sys.modules, "vnstock_data", module)
    rows = await VnstockFinancialRatiosFetcher.extract_data({"symbol": "VNM", "period": "year"})
    assert rows[0]["pe"] == 12.0
    assert calls and all(symbol == "VNM" for symbol, _ in calls)


@pytest.mark.asyncio
async def test_timed_out_provider_never_queues_duplicate_thread(monkeypatch):
    release = Event()
    entered = Event()

    def blocked():
        entered.set()
        release.wait(2)
        return []

    try:
        with pytest.raises(TimeoutError):
            await runtime.run_financial_provider(blocked, 0.01)
        assert entered.is_set()
        with pytest.raises(RuntimeError, match="still running"):
            await runtime.run_financial_provider(lambda: [1], 0.01)
    finally:
        release.set()
        await asyncio.wrap_future(runtime._financial_future)


def test_configured_closures_are_not_missing_price_gaps(monkeypatch):
    monkeypatch.setattr(scheduler.settings, "market_holiday_dates", ["2026-03-17"])
    pipeline = DataPipeline()
    assert pipeline._build_missing_date_ranges({date(2026, 3, 16)}, date(2026, 3, 16), date(2026, 3, 17)) == []


@pytest.mark.asyncio
async def test_ratio_timeout_is_not_reported_as_derived_acquisition(monkeypatch):
    async def timeout(query):
        raise TimeoutError("provider unavailable")

    async def pace(bucket):
        return None

    monkeypatch.setattr(VnstockFinancialRatiosFetcher, "extract_data", timeout)
    pipeline = DataPipeline()
    monkeypatch.setattr(pipeline, "_wait_for_rate_limit", pace)
    progress = {}
    count = await pipeline.sync_financial_ratios(symbols=["VNM"], period="quarter", progress=progress)
    assert count == 0
    assert progress["error_count"] == 1
    assert progress["stage_stats"]["financial_ratios"]["success"] == 0


@pytest.mark.asyncio
async def test_cancelled_cycle_keeps_acquired_symbols_and_pending_metadata(test_engine, monkeypatch):
    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(sync_all_data, "async_session_maker", sessions)
    monkeypatch.setattr("vnibb.services.data_pipeline.async_session_maker", sessions)
    calls = []

    async def acquire(symbol, progress):
        calls.append(symbol)
        if symbol == "FPT":
            raise asyncio.CancelledError()
        return 1

    sync = FullMarketSync()
    with pytest.raises(asyncio.CancelledError):
        await sync.run_maintenance_cycle("test_cancelled_cycle", ["ACB", "FPT"], [("ratios", acquire)], 10, 30)
    async with sessions() as session:
        row = (await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == "test_cancelled_cycle"))).one()
        assert row.status == "partial"
        assert row.additional_data["stages"]["ratios"]["acquired_symbols"] == ["ACB"]
        assert row.additional_data["stages"]["ratios"]["pending_count"] == 1


@pytest.mark.asyncio
async def test_registered_ratio_runner_records_real_cycle_outcome(test_engine, monkeypatch):
    from apscheduler.schedulers.asyncio import AsyncIOScheduler
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

    async def continuation():
        return SyncResult(True, 100, 0, 1, [], complete=False, pending_count=1617)

    monkeypatch.setattr(scheduler, "DistributedJobLock", NoLock)
    monkeypatch.setattr(sync_all_data, "run_financial_ratios_sync", continuation)
    scheduler.configure_scheduler()
    job = scheduler.get_scheduler().get_job("financial_ratios_sync")
    await job.func()
    async with sessions() as session:
        state = await session.get(SchedulerJobState, "financial_ratios_sync")
        assert state.last_outcome == "partial"
        assert "1617" in state.last_detail
    from datetime import UTC, datetime
    first = job.trigger.get_next_fire_time(None, datetime(2026, 10, 4, 17, tzinfo=UTC))
    second = job.trigger.get_next_fire_time(first, first)
    assert first == datetime(2026, 10, 4, 18, tzinfo=UTC)
    assert second == datetime(2026, 10, 5, 18, tzinfo=UTC)


@pytest.mark.asyncio
async def test_statement_source_failures_are_not_valid_empty_data(monkeypatch):
    from vnibb.core.exceptions import ProviderError
    from vnibb.providers.vnstock.financials import VnstockFinancialsFetcher

    class Finance:
        def __init__(self, **kwargs):
            pass

        def income_statement(self, period, lang="en"):
            raise OSError("provider unavailable")

    monkeypatch.setattr(runtime, "get_finance_class", lambda: Finance)
    with pytest.raises(ProviderError):
        await VnstockFinancialsFetcher.extract_data({
            "symbol": "VNM", "statement_type": "income", "period": "year", "limit": 6,
        })


@pytest.mark.asyncio
async def test_statement_all_language_fallbacks_only_when_fields_need_supplement(monkeypatch):
    from vnibb.providers.vnstock.financials import VnstockFinancialsFetcher
    languages = []

    class Finance:
        def __init__(self, **kwargs):
            pass

        def income_statement(self, period, lang="en"):
            languages.append(lang)
            frame = pd.DataFrame([{
                "period": "2025", "revenue": 100, "net_income": 10,
                "selling_general_admin": 2, "depreciation": 1,
                "research_development": 1, "ebitda": 20,
            }])
            frame.attrs["value_unit"] = "VND"
            return frame

    monkeypatch.setattr(runtime, "get_finance_class", lambda: Finance)
    rows = await VnstockFinancialsFetcher.extract_data({
        "symbol": "VNM", "statement_type": "income", "period": "year", "limit": 6,
    })
    assert rows
    assert languages and all(language == "en" for language in languages)


@pytest.mark.asyncio
async def test_statement_dispatches_supported_keywords_to_underlying_provider(monkeypatch):
    from vnibb.providers.vnstock.financials import VnstockFinancialsFetcher
    calls = []

    class Provider:
        def balance_sheet(self, period, display_mode="std"):
            calls.append(display_mode)
            frame = pd.DataFrame([{"item_id": "total_assets", "2026-Q2": 55_677_822_007_000}])
            frame.attrs["value_unit"] = "VND"
            return frame

    class Adapter:
        def __init__(self, **kwargs):
            self._provider = Provider()

        def balance_sheet(self, period):
            raise AssertionError("Adapter wrapper must not reject underlying provider keywords")

    monkeypatch.setattr(runtime, "get_finance_class", lambda: Adapter)
    rows = await VnstockFinancialsFetcher.extract_data({
        "symbol": "VNM", "statement_type": "balance", "period": "quarter", "limit": 4,
    })
    assert calls and all(mode == "all" for mode in calls)
    assert rows[0]["total_assets"] == 55_677_822_007_000


@pytest.mark.asyncio
async def test_statement_respects_wrapped_provider_actual_signature(monkeypatch):
    from functools import wraps

    from vnibb.providers.vnstock.financials import VnstockFinancialsFetcher
    calls = []

    def original(self, period, display_mode="std"):
        calls.append(display_mode)
        frame = pd.DataFrame([{"item_id": "total_assets", "2026-Q2": 55_677_822_007_000}])
        frame.attrs["value_unit"] = "VND"
        return frame

    @wraps(original)
    def quota_wrapper(self, period, show_log=False):
        calls.append("quota_wrapper")
        return original(self, period)

    class Provider:
        balance_sheet = quota_wrapper

    class Adapter:
        def __init__(self, **kwargs):
            self._provider = Provider()

    monkeypatch.setattr(runtime, "get_finance_class", lambda: Adapter)
    rows = await VnstockFinancialsFetcher.extract_data({
        "symbol": "VNM", "statement_type": "balance", "period": "quarter", "limit": 4,
    })
    assert calls and "quota_wrapper" in calls
    assert "all" not in calls
    assert rows[0]["total_assets"] == 55_677_822_007_000


@pytest.mark.asyncio
async def test_unsuccessful_daily_stage_reaches_guarded_failure(test_engine, monkeypatch):
    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(scheduler, "async_session_factory", sessions)
    monkeypatch.setattr(scheduler.settings, "scheduler_lock_mode", "best_effort")
    monkeypatch.setattr(scheduler, "_job_guards", {})

    class NoLock:
        def __init__(self, *_):
            pass

        async def acquire(self):
            return "unavailable"

    async def unavailable():
        raise OSError("provider offline")

    async def run():
        return {"prices": await FullMarketSync()._run_stage("prices", unavailable)}

    monkeypatch.setattr(scheduler, "DistributedJobLock", NoLock)
    await scheduler._run_guarded_job("test_daily_failed_stage", run, 10)
    async with sessions() as session:
        state = await session.get(SchedulerJobState, "test_daily_failed_stage")
        assert state.last_outcome == "failed"
        assert state.consecutive_failures == 1


@pytest.mark.asyncio
async def test_sponsor_constructor_period_is_preserved_for_quarter_ratios(monkeypatch):
    periods = []

    class Finance:
        def __init__(self, symbol, source, period):
            periods.append(period)

        def ratio(self, lang="en"):
            return pd.DataFrame([{"period": "2025-Q4", "pe": 12}])

    module = types.ModuleType("vnstock_data")
    module.Finance = Finance
    monkeypatch.setitem(sys.modules, "vnstock_data", module)
    rows = await VnstockFinancialRatiosFetcher.extract_data({"symbol": "VNM", "period": "quarter"})
    assert rows
    assert periods and all(period == "quarter" for period in periods)


@pytest.mark.asyncio
async def test_unified_sponsor_without_source_does_not_repeat_default_provider(monkeypatch):
    calls = []

    class Equity:
        def ratio(self, period):
            calls.append(period)
            return pd.DataFrame([{"period": "2025-Q4", "pe": 12}])

    class Fundamental:
        def equity(self, symbol):
            return Equity()

    module = types.ModuleType("vnstock_data")
    module.Fundamental = Fundamental
    monkeypatch.setitem(sys.modules, "vnstock_data", module)
    rows = await VnstockFinancialRatiosFetcher.extract_data({"symbol": "VNM", "period": "quarter"})
    assert rows
    assert calls == ["quarter"]


@pytest.mark.asyncio
async def test_cycle_deadline_expiry_is_partial_and_next_stage_is_not_starved(test_engine, monkeypatch):
    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(sync_all_data, "async_session_maker", sessions)
    monkeypatch.setattr("vnibb.services.data_pipeline.async_session_maker", sessions)
    calls = []
    # Acquisition deadline is real asyncio time; isolate accounting from variable
    # fixture/database setup latency, so the timeout reaches the provider seam.
    monkeypatch.setattr(sync_all_data, "time", types.SimpleNamespace(monotonic=lambda: 0.0, time=lambda: 0.0))
    blocked_forever = asyncio.Event()

    async def blocked(symbol, progress):
        calls.append("year")
        await blocked_forever.wait()
        return 1

    async def quarter(symbol, progress):
        calls.append("quarter")
        return 1

    sync = FullMarketSync()
    stages = [("year", blocked), ("quarter", quarter)]
    first = await sync.run_maintenance_cycle("test_deadline_cycle", ["VNM"], stages, 0.01, 7)
    assert first.success and not first.complete and first.error_count == 0
    assert first.pending_count == 2
    second = await sync.run_maintenance_cycle("test_deadline_cycle", ["VNM"], stages, 0.01, 7)
    assert calls[:2] == ["year", "quarter"]
    assert second.pending_count == 1


@pytest.mark.asyncio
async def test_variadic_finance_method_receives_requested_quarter(monkeypatch):
    calls = []

    class Finance:
        def __init__(self, symbol, source):
            pass

        def ratio(self, *args, **kwargs):
            calls.append(kwargs)
            return pd.DataFrame([{"period": "2025-Q4", "pe": 12}])

    monkeypatch.setattr(runtime, "get_finance_class", lambda: Finance)
    rows = await VnstockFinancialRatiosFetcher.extract_data({"symbol": "VNM", "period": "quarter"})
    assert rows
    assert calls and all(call["period"] == "quarter" for call in calls)


@pytest.mark.asyncio
async def test_screener_modular_quote_and_failed_rerun_preserve_certified_row(test_engine, monkeypatch):
    from datetime import datetime

    from vnibb.models.screener import ScreenerSnapshot
    from vnibb.models.stock import Stock

    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr("vnibb.services.data_pipeline.async_session_maker", sessions)
    cache = []
    available = [True]
    quote_calls = []

    class Listing:
        def __init__(self, **kwargs):
            pass

        def all_symbols(self):
            return pd.DataFrame()

        symbols_by_exchange = all_symbols
        symbols_by_industries = all_symbols

    class Finance:
        def __init__(self, **kwargs):
            pass

        def ratio(self, **kwargs):
            if not available[0]:
                return pd.DataFrame()
            return pd.DataFrame([{"period": "2025", "pe": 12}])

    class Quote:
        def __init__(self, symbol, source):
            quote_calls.append(symbol)

        def history(self, **kwargs):
            frame = pd.DataFrame([{"time": datetime.utcnow(), "close": 123, "volume": 456}])
            frame.attrs["price_unit"] = "VND"
            return frame

    async def pace(bucket):
        return None

    async def cached(key, value, ttl, **kwargs):
        cache.append(value)

    monkeypatch.setattr(runtime, "get_listing_class", lambda: Listing)
    monkeypatch.setattr(runtime, "get_finance_class", lambda: Finance)
    monkeypatch.setattr(runtime, "get_quote_class", lambda: Quote)
    pipeline = DataPipeline()
    monkeypatch.setattr(pipeline, "_wait_for_rate_limit", pace)
    monkeypatch.setattr(pipeline, "_cache_set_json", cached)
    async with sessions.begin() as session:
        session.add(Stock(symbol="VNM", is_active=1))
    await pipeline.sync_screener_data()
    async with sessions() as session:
        row = (await session.scalars(select(ScreenerSnapshot).where(ScreenerSnapshot.symbol == "VNM"))).one()
        assert row.price == 123
        certified = (await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == "screener_universe"))).one()
        assert certified.status == "completed"
    assert quote_calls == ["VNM"]
    writes_before = len(cache)
    available[0] = False
    progress = {}
    await pipeline.sync_screener_data(progress=progress)
    assert progress["error_count"] == 1
    assert len(cache) == writes_before
    async with sessions() as session:
        row = (await session.scalars(select(ScreenerSnapshot).where(ScreenerSnapshot.symbol == "VNM"))).one()
        assert row.price == 123
        certified = (await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == "screener_universe"))).one()
        assert certified.status == "completed"


def test_live_wide_quarter_ratio_shape_keeps_canonical_duplicate_period():
    from vnibb.providers.vnstock.financial_ratios import FinancialRatiosQueryParams
    rows = [{"item": "P/E", "item_id": "pe", "2026-Q2": 12,
             "2025-Q4": 10, "2026-Q1": 11, "2025-Q4_1": 99}]
    data = VnstockFinancialRatiosFetcher.transform_data(
        FinancialRatiosQueryParams(symbol="VNM", period="quarter"), rows
    )
    assert [(row.period, row.pe) for row in data] == [("2026-Q2", 12), ("2026-Q1", 11), ("2025-Q4", 10)]
