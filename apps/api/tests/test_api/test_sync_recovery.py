import asyncio
import sys
import types
from datetime import date
from itertools import count
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
async def test_modular_community_finance_is_used_without_legacy_wrapper(monkeypatch):
    calls = []

    class Finance:
        def __init__(self, symbol, source):
            calls.append((symbol, source))

        def ratio(self, period, lang="en"):
            return pd.DataFrame([{"period": "2025", "pe": 12.0}])

    module = types.ModuleType("vnstock")
    module.Finance = Finance
    monkeypatch.setitem(sys.modules, "vnstock", module)
    monkeypatch.setattr(scheduler.settings, "vnstock_source", "VCI")
    rows = await VnstockFinancialRatiosFetcher.extract_data({"symbol": "VNM", "period": "year"})
    assert rows[0]["pe"] == 12.0
    assert calls == [("VNM", "VCI")]


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


@pytest.mark.asyncio
@pytest.mark.parametrize("financial", [False, True])
async def test_identical_provider_retries_share_real_executor_until_completion(monkeypatch, financial):
    release = Event()
    entered = Event()
    calls = []
    key = ("financial_ratios" if financial else "historical", "VNM", "VCI", "year")
    runner = runtime.run_financial_provider if financial else runtime.run_reference_provider
    executor = runtime._financial_executor if financial else asyncio.get_running_loop()
    method = "submit" if financial else "run_in_executor"
    submit = getattr(executor, method)
    submissions = []

    def counted_submit(*args, **kwargs):
        submissions.append(1)
        return submit(*args, **kwargs)

    def blocked():
        calls.append(1)
        entered.set()
        release.wait(2)
        return [12]

    monkeypatch.setattr(executor, method, counted_submit)
    try:
        for _ in range(2):
            with pytest.raises(TimeoutError):
                await runner(blocked, 0.01, key=key)
        assert entered.is_set()
        assert len(submissions) == len(calls) == 1
        recovery = asyncio.create_task(runner(blocked, 1, key=key))
        await asyncio.sleep(0)
        release.set()
        assert await recovery == [12]
        assert len(submissions) == len(calls) == 1
        assert await runner(lambda: [13], 1, key=key) == [13]
        assert len(submissions) == 2
    finally:
        release.set()
        if financial and runtime._financial_future is not None:
            await asyncio.wrap_future(runtime._financial_future)
        elif not financial:
            await asyncio.gather(*list(runtime._reference_jobs.values()), return_exceptions=True)


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
async def test_secondary_ratio_refresh_preserves_iq_values_and_evidence(test_engine, monkeypatch):
    from unittest.mock import AsyncMock

    from vnibb.models.trading import FinancialRatio
    from vnibb.providers.vnstock.financial_ratios import FinancialRatioData
    from vnibb.services import data_pipeline as pipeline_module

    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr("vnibb.services.data_pipeline.async_session_maker", sessions)
    monkeypatch.setattr("vnibb.services.data_pipeline.engine", test_engine)
    evidence = {"structured": {"values": {"eps": 42}, "fiscalBasis": {"consolidation": "unknown"}}}
    async with sessions() as session:
        session.add(FinancialRatio(id=901001, symbol="IQZ", period="2025", period_type="year", fiscal_year=2025,
                                   source="vietcap", eps=42, raw_data=evidence))
        await session.commit()
    upsert = pipeline_module.get_upsert_stmt
    fresh_ids = count(902001)

    def sqlite_upsert(model, keys, values, **kwargs):
        return upsert(model, keys, {**values, "id": next(fresh_ids)}, **kwargs)

    monkeypatch.setattr(pipeline_module, "get_upsert_stmt", sqlite_upsert)
    provider_row = FinancialRatioData(symbol="IQZ", period="2025", eps=99)
    monkeypatch.setattr(VnstockFinancialRatiosFetcher, "extract_data", AsyncMock(return_value=[provider_row]))
    monkeypatch.setattr(VnstockFinancialRatiosFetcher, "transform_data", lambda query, rows: rows)
    pipeline = DataPipeline()
    monkeypatch.setattr(pipeline, "_wait_for_rate_limit", AsyncMock())
    progress = {}

    assert await pipeline.sync_financial_ratios(symbols=["IQZ"], period="year", progress=progress) == 0
    assert progress["stage_stats"]["financial_ratios"]["errors"] == 1
    async with sessions() as session:
        row = (await session.scalars(select(FinancialRatio).where(FinancialRatio.symbol == "IQZ"))).one()
        assert row.source == "vietcap"
        assert row.eps == 42
        assert row.raw_data == evidence

@pytest.mark.asyncio
@pytest.mark.parametrize(
    "statement_type, metric",
    [("income", "revenue"), ("balance", "total_assets"), ("cashflow", "operating_cash_flow")],
)
async def test_secondary_statement_refresh_preserves_iq_rows_and_reports_conflict(
    test_engine, monkeypatch, statement_type, metric
):
    from unittest.mock import AsyncMock

    from vnibb.models.financials import BalanceSheet, CashFlow, IncomeStatement
    from vnibb.providers.vnstock.financials import FinancialStatementData, VnstockFinancialsFetcher
    from vnibb.services import data_pipeline as pipeline_module

    models = {"income": IncomeStatement, "balance": BalanceSheet, "cashflow": CashFlow}
    model = models[statement_type]
    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr("vnibb.services.data_pipeline.async_session_maker", sessions)
    monkeypatch.setattr("vnibb.services.data_pipeline.engine", test_engine)
    async with sessions() as session:
        session.add(model(id=901002, symbol="IQZ", period="2025", period_type="year", fiscal_year=2025,
                          source="vietcap", **{metric: 42}))
        await session.commit()
    upsert = pipeline_module.get_upsert_stmt
    fresh_ids = count(903001)

    def sqlite_upsert(upsert_model, keys, values, **kwargs):
        return upsert(upsert_model, keys, {**values, "id": next(fresh_ids)}, **kwargs)

    monkeypatch.setattr(pipeline_module, "get_upsert_stmt", sqlite_upsert)

    entry = FinancialStatementData(symbol="IQZ", period="2025", statement_type=statement_type, source="VCI",
                                   currency="VND", value_unit="VND", **{metric: 99})
    monkeypatch.setattr(VnstockFinancialsFetcher, "extract_data", AsyncMock(return_value=[entry]))
    monkeypatch.setattr(VnstockFinancialsFetcher, "transform_data", lambda params, rows: rows)
    pipeline = DataPipeline()
    monkeypatch.setattr(pipeline, "_wait_for_rate_limit", AsyncMock())
    progress = {}

    assert await pipeline.sync_financials(symbols=["IQZ"], period="year", progress=progress,
                                          statement_types=[statement_type], count=1) == 0
    assert progress["stage_stats"]["financials"]["errors"] == 1
    assert progress["stage_stats"]["financials"]["success"] == 0
    assert progress["error_count"] == 1
    async with sessions() as session:
        row = (await session.scalars(select(model).where(model.symbol == "IQZ"))).one()
        assert row.source == "vietcap"
        assert getattr(row, metric) == 42

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
async def test_community_constructor_period_is_preserved_for_quarter_ratios(monkeypatch):
    periods = []

    class Finance:
        def __init__(self, symbol, source, period):
            periods.append(period)

        def ratio(self, lang="en"):
            return pd.DataFrame([{"period": "2025-Q4", "pe": 12}])

    module = types.ModuleType("vnstock")
    module.Finance = Finance
    monkeypatch.setitem(sys.modules, "vnstock", module)
    monkeypatch.setattr(scheduler.settings, "vnstock_source", "VCI")
    rows = await VnstockFinancialRatiosFetcher.extract_data({"symbol": "VNM", "period": "quarter"})
    assert rows
    assert periods and all(period == "quarter" for period in periods)


@pytest.mark.asyncio
async def test_community_finance_does_not_repeat_ratio_call(monkeypatch):
    calls = []

    class Finance:
        def __init__(self, symbol, source):
            assert (symbol, source) == ("VNM", "VCI")

        def ratio(self, period):
            calls.append(period)
            return pd.DataFrame([{"period": "2025-Q4", "pe": 12}])

    community = types.ModuleType("vnstock")
    community.Finance = Finance
    monkeypatch.setitem(sys.modules, "vnstock", community)
    monkeypatch.setattr(scheduler.settings, "vnstock_source", "VCI")
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
    assert row.pe == 12
    available[0] = False
    progress = {}
    await pipeline.sync_screener_data(progress=progress)
    assert progress["error_count"] == 1
    async with sessions() as session:
        row = (await session.scalars(select(ScreenerSnapshot).where(ScreenerSnapshot.symbol == "VNM"))).one()
        assert row.price == 123
        assert row.pe == 12
        certified = (await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == "screener_universe"))).all()
        assert len(certified) == 2
        partial = (await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == "screener_ratio_enrichment"))).one()
        assert partial.status == "partial" and partial.error_count == 1


def test_live_wide_quarter_ratio_shape_keeps_canonical_duplicate_period():
    from vnibb.providers.vnstock.financial_ratios import FinancialRatiosQueryParams
    rows = [{"item": "P/E", "item_id": "pe", "2026-Q2": 12,
             "2025-Q4": 10, "2026-Q1": 11, "2025-Q4_1": 99}]
    data = VnstockFinancialRatiosFetcher.transform_data(
        FinancialRatiosQueryParams(symbol="VNM", period="quarter"), rows
    )
    assert [(row.period, row.pe) for row in data] == [("2026-Q2", 12), ("2026-Q1", 11), ("2025-Q4", 10)]


@pytest.fixture
def screener_base_pipeline(test_engine, monkeypatch):
    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr("vnibb.services.data_pipeline.async_session_maker", sessions)

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
            raise TimeoutError("annual ratios unavailable")

    async def no_io(*args, **kwargs):
        pass

    monkeypatch.setattr(runtime, "get_listing_class", lambda: Listing)
    monkeypatch.setattr(runtime, "get_finance_class", lambda: Finance)
    pipeline = DataPipeline()
    monkeypatch.setattr(pipeline, "_wait_for_rate_limit", no_io)
    monkeypatch.setattr(pipeline, "_cache_set_json", no_io)
    return pipeline, sessions


@pytest.mark.asyncio
@pytest.mark.parametrize("missing_base", [False, True])
async def test_screener_ratio_failure_publishes_only_complete_certified_base(screener_base_pipeline, missing_base):
    from vnibb.models.screener import ScreenerSnapshot
    from vnibb.models.stock import Stock, StockPrice

    pipeline, sessions = screener_base_pipeline
    trade_date = date(2026, 10, 14)
    async with sessions.begin() as session:
        session.add_all([Stock(id=1, symbol="FPT"), Stock(id=2, symbol="VNM")])
        for index, symbol in enumerate(["FPT"] if missing_base else ["FPT", "VNM"], 1):
            session.add(StockPrice(id=index, stock_id=index, symbol=symbol, time=trade_date,
                                   open=100, high=100, low=100, close=100, volume=0,
                                   source="vnstock_vnd:VCI", interval="1D"))
    progress = {}
    assert await pipeline.sync_screener_data(progress=progress) == (1 if missing_base else 2)
    assert progress["stage_stats"]["screener"]["ratio_errors"] == 2
    async with sessions() as session:
        rows = (await session.scalars(select(ScreenerSnapshot))).all()
        assert all(row.price == 100 and row.volume == 0 and row.trade_date == trade_date for row in rows)
        assert all(row.pe is None and row.roe is None and row.market_cap is None for row in rows)
        assert all(row.extended_metrics["price_unit"] == "VND" for row in rows)
        assert all(row.extended_metrics["price_source"] == "vnstock_vnd:VCI" for row in rows)
        markers = (await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == "screener_universe"))).all()
        assert len(markers) == (0 if missing_base else 1)
        receipt = (await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == "screener_ratio_enrichment"))).one()
        assert receipt.status == "partial" and receipt.error_count == 2


@pytest.mark.asyncio
async def test_screener_resumed_base_and_marker_commit_atomically(screener_base_pipeline, monkeypatch):
    from datetime import datetime

    from sqlalchemy.ext.asyncio import AsyncSession
    from vnibb.models.screener import ScreenerSnapshot
    from vnibb.models.stock import Stock, StockPrice

    pipeline, sessions = screener_base_pipeline
    today = datetime.utcnow().date()
    async with sessions.begin() as session:
        session.add_all([Stock(id=1, symbol="FPT"), Stock(id=2, symbol="VNM")])
        session.add(ScreenerSnapshot(symbol="FPT", snapshot_date=today, trade_date=today, price=100,
                                    extended_metrics={"price_unit": "VND", "price_source": "vnstock_vnd:VCI"}))
        session.add(StockPrice(id=2, stock_id=2, symbol="VNM", time=today, open=200, high=200,
                               low=200, close=200, volume=0, source="vnstock_vnd:VCI", interval="1D"))
    original_commit = AsyncSession.commit
    interrupt = [True]

    async def commit(session):
        if interrupt[0] and any(isinstance(row, SyncStatus) and row.sync_type == "screener_universe" for row in session.new):
            raise asyncio.CancelledError()
        await original_commit(session)

    monkeypatch.setattr(AsyncSession, "commit", commit)
    progress = {"stage": "screener", "last_index": 0}
    with pytest.raises(asyncio.CancelledError):
        await pipeline.sync_screener_data(progress=progress, enrich_ratios=False)
    async with sessions() as session:
        assert list(await session.scalars(select(ScreenerSnapshot.symbol))) == ["FPT"]
        assert not (await session.scalars(select(SyncStatus))).all()
    interrupt[0] = False
    assert await pipeline.sync_screener_data(progress=progress, enrich_ratios=False) == 1
    async with sessions() as session:
        marker = (await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == "screener_universe"))).one()
        assert marker.additional_data["expected_symbols"] == ["FPT", "VNM"]
        assert marker.success_count == 2 and progress["base_count"] == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("prefix_damage", ["missing", "invalid"])
async def test_screener_resume_repairs_only_uncommitted_prefix_members(
    screener_base_pipeline, prefix_damage,
):
    from datetime import datetime

    from vnibb.models.screener import ScreenerSnapshot
    from vnibb.models.stock import Stock, StockPrice
    from vnibb.services.cache_manager import CacheManager

    pipeline, sessions = screener_base_pipeline
    today = datetime.utcnow().date()
    symbols = [f"B{index:02d}" for index in range(22)]
    async with sessions.begin() as session:
        session.add_all([Stock(id=index + 1, symbol=symbol, is_active=1) for index, symbol in enumerate(symbols)])
        session.add_all([
            StockPrice(id=index + 1, stock_id=index + 1, symbol=symbol, time=today,
                       open=110, high=110, low=110, close=110, volume=0,
                       source="vnstock_vnd:VCI", interval="1D")
            for index, symbol in enumerate(symbols)
        ])
        session.add_all([
            ScreenerSnapshot(symbol=symbol, snapshot_date=today, trade_date=today, price=100,
                             extended_metrics={"price_unit": "VND", "price_source": "vnstock_vnd:VCI"})
            for symbol in symbols[1:21]
        ])
        if prefix_damage == "invalid":
            session.add(ScreenerSnapshot(
                symbol="B00", snapshot_date=today, trade_date=today, price=0,
                extended_metrics={"price_unit": "VND", "price_source": "vnstock_vnd:VCI"},
            ))
    progress = {"stage": "screener", "last_index": 20, "last_symbol": "B20"}

    assert await pipeline.sync_screener_data(progress=progress) == 2

    async with sessions() as session:
        marker = (await session.scalars(select(SyncStatus).where(
            SyncStatus.sync_type == "screener_universe",
        ))).one()
        assert marker.additional_data["expected_symbols"] == symbols
        assert marker.additional_data["expected_count"] == marker.success_count == progress["base_count"] == 22
        rows = (await session.scalars(select(ScreenerSnapshot).order_by(ScreenerSnapshot.symbol))).all()
        assert [(row.symbol, row.price) for row in rows] == [
            (symbol, 110 if symbol in {"B00", "B21"} else 100) for symbol in symbols
        ]
        cached = await CacheManager(db=session).get_screener_data(allow_stale=False)
        assert cached.hit and not cached.is_stale
        assert {row.symbol for row in cached.data} == set(symbols)


@pytest.mark.asyncio
@pytest.mark.parametrize("interrupt", [False, True])
async def test_file_sqlite_screener_checkpoint_preserves_publication_and_resume(tmp_path, monkeypatch, interrupt):
    from datetime import datetime

    from sqlalchemy import update
    from sqlalchemy.ext.asyncio import create_async_engine
    from vnibb.core.database import Base
    from vnibb.models.stock import Stock, StockPrice
    from vnibb.services import data_pipeline as pipeline_module
    from vnibb.services.cache_manager import CacheManager

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'screener.db'}", connect_args={"timeout": 0.1})
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(pipeline_module, "engine", engine)
    monkeypatch.setattr(pipeline_module, "async_session_maker", sessions)
    pipeline = DataPipeline()
    today = datetime.utcnow().date()
    symbols = [f"B{index:02d}" for index in range(22)]
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with sessions.begin() as session:
            session.add_all([Stock(id=index, symbol=symbol, is_active=1) for index, symbol in enumerate(symbols, 1)])
            session.add_all([
                StockPrice(id=index, stock_id=index, symbol=symbol, time=today, open=100, high=100,
                           low=100, close=100, volume=1, source="vnstock_vnd:VCI", interval="1D")
                for index, symbol in enumerate(symbols, 1)
            ])
        assert await pipeline.sync_screener_data(enrich_ratios=False) == 22
        sync_id = await pipeline._create_sync_record("full", "sqlite-checkpoint", 1)
        async with sessions.begin() as session:
            await session.execute(update(StockPrice).values(close=110, high=110))

        progress = {"job_id": "sqlite-checkpoint", "sync_id": sync_id, "status": "running"}
        original_save = pipeline._save_progress
        if interrupt:
            async def cancel_after_batch(data, *args, **kwargs):
                await original_save(data, *args, **kwargs)
                raise asyncio.CancelledError()

            monkeypatch.setattr(pipeline, "_save_progress", cancel_after_batch)
            with pytest.raises(asyncio.CancelledError):
                await pipeline.sync_screener_data(enrich_ratios=False, progress=progress, sync_id=sync_id)
            async with sessions() as session:
                reader = await CacheManager(db=session).get_screener_data()
                assert reader.hit and {row.symbol for row in reader.data} == set(symbols)
                assert {row.price for row in reader.data} == {100}
                receipts = (await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == "screener_universe"))).all()
                assert len(receipts) == 1
                assert (await session.get(SyncStatus, sync_id)).status == "running"
            assert progress.get("last_index") is None and progress.get("last_symbol") is None
            monkeypatch.setattr(pipeline, "_save_progress", original_save)

        assert await pipeline.sync_screener_data(enrich_ratios=False, progress=progress, sync_id=sync_id) == 22
        async with sessions() as session:
            reader = await CacheManager(db=session).get_screener_data()
            assert reader.hit and {row.symbol for row in reader.data} == set(symbols)
            assert {row.price for row in reader.data} == {110}
            receipts = (await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == "screener_universe"))).all()
            assert len(receipts) == 2 and receipts[-1].additional_data["expected_symbols"] == symbols
            record = await session.get(SyncStatus, sync_id)
            assert record.additional_data["committed_count"] == 22
            assert record.additional_data["last_index"] is None
            assert record.additional_data["last_symbol"] is None
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_file_sqlite_acquired_sessions_keep_prices_on_interruption(tmp_path, monkeypatch):
    from copy import deepcopy
    from datetime import UTC, datetime

    from sqlalchemy import BigInteger, Integer
    from sqlalchemy.ext.asyncio import create_async_engine
    from vnibb.core.database import Base
    from vnibb.models.stock import Stock, StockPrice
    from vnibb.services import cache_manager as cache_module
    from vnibb.services import data_pipeline as pipeline_module
    from vnibb.services.cache_manager import CacheManager
    from vnibb.services.vietcap_client import VietcapClient

    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 10, 26, 9, tzinfo=UTC).astimezone(tz)

        @classmethod
        def utcnow(cls):
            return datetime(2026, 10, 26, 9)

    class RetainedSessions:
        def retain_price_board_envelope(self, requested, raw, session, observed):
            pass

        def retain_market_sessions(self, records):
            return {record["symbol"]: record for record in records}

        def verified_market_sessions(self, records, envelopes):
            return set(records)

    symbols = [f"B{index:02d}" for index in range(22)]
    def board_row(symbol):
        return {
            "listingInfo": {"symbol": symbol, "ticker": symbol, "stockType": "STOCK", "type": "STOCK",
                            "isDelisted": 0, "tradingDate": "2026-10-26", "receivedTime": "2026-10-26T01:44:00Z",
                            "tradingStatus": "TRADING_ACTIVATED", "tradingStatusCode": "20", "securityStatus": "N"},
            "bidAsk": {"symbol": symbol, "session": "ENDED", "time": "2026-10-26T08:00:00Z", "receivedTime": "2026-10-26T08:00:03Z"},
            "matchPrice": {"symbol": symbol, "session": "ENDED", "time": "2026-10-26T08:00:00Z",
                           "receivedTime": "2026-10-26T08:00:03Z", "openPrice": 10000, "highest": 12000,
                           "lowest": 9000, "matchPrice": 11000, "accumulatedVolume": 100},
        }

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'sessions.db'}", connect_args={"timeout": 0.1})
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(pipeline_module, "engine", engine)
    monkeypatch.setattr(pipeline_module, "async_session_maker", sessions)
    monkeypatch.setattr(pipeline_module, "datetime", FrozenDateTime)
    monkeypatch.setattr(cache_module, "datetime", FrozenDateTime)
    monkeypatch.setattr("vnibb.services.mongo_market_data_service.get_mongo_market_data_service", lambda: RetainedSessions())
    monkeypatch.setattr(VietcapClient, "get_price_board", lambda self, requested, **kwargs: deepcopy([board_row(symbol) for symbol in requested]))
    pipeline = DataPipeline()
    try:
        async with engine.begin() as connection:
            # Mirror the migration's SQLite INTEGER variant so inserts generate price IDs.
            price_id = StockPrice.__table__.c.id
            original_type = price_id.type
            price_id.type = BigInteger().with_variant(Integer, "sqlite")
            try:
                await connection.run_sync(Base.metadata.create_all)
            finally:
                price_id.type = original_type
        async with sessions.begin() as session:
            session.add_all([Stock(symbol=symbol, is_active=1) for symbol in symbols])
        sync_id = await pipeline._create_sync_record("full", "sqlite-acquire", 1)
        progress = {"job_id": "sqlite-acquire", "sync_id": sync_id, "status": "running"}
        original_save = pipeline._save_progress

        async def interrupt_after_batch(data, *args, **kwargs):
            assert data["stage_stats"]["screener"]["success"] >= 20
            raise asyncio.CancelledError()

        monkeypatch.setattr(pipeline, "_save_progress", interrupt_after_batch)
        with pytest.raises(asyncio.CancelledError):
            await pipeline.sync_screener_data(enrich_ratios=False, acquire_sessions=True, progress=progress, sync_id=sync_id)
        async with sessions() as session:
            assert len((await session.scalars(select(StockPrice))).all()) == 22
            assert not (await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == "screener_universe"))).all()
            assert not (await CacheManager(db=session).get_screener_data()).hit
        assert progress.get("last_index") is None and progress.get("last_symbol") is None
        monkeypatch.setattr(pipeline, "_save_progress", original_save)
        assert await pipeline.sync_screener_data(enrich_ratios=False, acquire_sessions=True, progress=progress, sync_id=sync_id) == 22
        async with sessions() as session:
            reader = await CacheManager(db=session).get_screener_data()
            assert reader.hit and {row.symbol for row in reader.data} == set(symbols)
            assert {row.price for row in reader.data} == {11000}
            receipt = (await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == "screener_universe"))).one()
            assert receipt.additional_data["expected_symbols"] == symbols
            assert (await session.get(SyncStatus, sync_id)).additional_data["committed_count"] == 22
            before_replay = sorted((row.id, row.symbol, row.price, row.extended_metrics, row.created_at) for row in reader.data)
        assert await pipeline.sync_screener_data(enrich_ratios=False, acquire_sessions=True, progress=progress, sync_id=sync_id) == 22
        async with sessions() as session:
            replay = await CacheManager(db=session).get_screener_data()
            assert replay.hit
            assert sorted((row.id, row.symbol, row.price, row.extended_metrics, row.created_at) for row in replay.data) == before_replay
            assert len((await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == "screener_universe"))).all()) == 1
    finally:
        await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize("interruption", ["checkpoint", "final_commit"])
async def test_cancelled_final_commit_keeps_previous_same_day_admitted_cohort(screener_base_pipeline, monkeypatch, interruption):
    from datetime import datetime

    from sqlalchemy import update
    from sqlalchemy.ext.asyncio import AsyncSession
    from vnibb.models.stock import Stock, StockPrice
    from vnibb.services.cache_manager import CacheManager

    pipeline, sessions = screener_base_pipeline
    today = datetime.utcnow().date()
    symbols = [f"B{index:02d}" for index in range(50)]
    async with sessions.begin() as session:
        session.add_all([Stock(id=index, symbol=symbol, is_active=1) for index, symbol in enumerate(symbols, 1)])
        session.add_all([
            StockPrice(id=index, stock_id=index, symbol=symbol, time=today, open=100, high=100,
                       low=100, close=100, volume=1, source="vnstock_vnd:VCI", interval="1D")
            for index, symbol in enumerate(symbols, 1)
        ])
    assert await pipeline.sync_screener_data(enrich_ratios=False) == 50
    async with sessions() as session:
        reader = await CacheManager(db=session).get_screener_data()
        assert reader.hit and len(reader.data) == 50
        before = sorted((row.id, row.symbol, row.price, row.created_at) for row in reader.data)
    async with sessions.begin() as session:
        await session.execute(update(StockPrice).values(close=110, high=110))

    original_commit = AsyncSession.commit
    interrupt = [True]
    checkpoints = []

    async def save_progress(progress, *args, **kwargs):
        checkpoints.append(dict(progress))
        if interrupt[0] and interruption == "checkpoint" and progress["stage_stats"]["screener"]["success"] >= 40:
            raise asyncio.CancelledError()

    async def cancel_publication(session):
        if interrupt[0] and interruption == "final_commit" and any(isinstance(row, SyncStatus) and row.sync_type == "screener_universe" for row in session.new):
            raise asyncio.CancelledError()
        await original_commit(session)

    monkeypatch.setattr(AsyncSession, "commit", cancel_publication)
    monkeypatch.setattr(pipeline, "_save_progress", save_progress)
    progress = {}
    with pytest.raises(asyncio.CancelledError):
        await pipeline.sync_screener_data(enrich_ratios=False, progress=progress, sync_id=123)
    async with sessions() as session:
        reader = await CacheManager(db=session).get_screener_data()
        assert reader.hit and len(reader.data) == 50
        assert sorted((row.id, row.symbol, row.price, row.created_at) for row in reader.data) == before
        assert len((await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == "screener_universe"))).all()) == 1
        assert set(await session.scalars(select(StockPrice.close))) == {110}
    assert len(checkpoints) == 2
    assert progress.get("last_index") is None and progress.get("last_symbol") is None
    interrupt[0] = False
    assert await pipeline.sync_screener_data(enrich_ratios=False, progress=progress, sync_id=123) == 50
    async with sessions() as session:
        reader = await CacheManager(db=session).get_screener_data()
        assert reader.hit and len(reader.data) == 50
        assert {row.symbol for row in reader.data} == set(symbols)
        assert all(row.price == 110 for row in reader.data)
        assert sorted((row.id, row.symbol, row.created_at) for row in reader.data) == [
            (row_id, symbol, created_at) for row_id, symbol, _, created_at in before
        ]
        receipts = (await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == "screener_universe").order_by(SyncStatus.id))).all()
        assert len(receipts) == 2 and receipts[-1].additional_data["expected_symbols"] == symbols
        assert receipts[-1].success_count == progress["base_count"] == progress["committed_count"] == 50


@pytest.mark.asyncio
@pytest.mark.parametrize("transition", ["newly_active", "removed"])
async def test_screener_active_membership_transition_keeps_inactive_history(
    screener_base_pipeline, transition,
):
    from datetime import datetime, timedelta

    from vnibb.models.screener import ScreenerSnapshot
    from vnibb.models.stock import Stock, StockPrice
    from vnibb.services.cache_manager import CacheManager

    pipeline, sessions = screener_base_pipeline
    today = datetime.utcnow().date()
    yesterday = today - timedelta(days=1)
    async with sessions.begin() as session:
        session.add_all([
            Stock(id=1, symbol="AAA", is_active=1),
            Stock(id=2, symbol="BBB", is_active=int(transition == "removed")),
            Stock(id=3, symbol="OLD", is_active=0),
        ])
        for index, symbol in enumerate(["AAA", "BBB"], 1):
            session.add(StockPrice(
                id=index, stock_id=index, symbol=symbol, time=today,
                open=100, high=100, low=100, close=100, volume=0,
                source="vnstock_vnd:VCI", interval="1D",
            ))
    old_expected = ["AAA"] if transition == "newly_active" else ["AAA", "BBB"]
    assert await pipeline.sync_screener_data(enrich_ratios=False) == len(old_expected)
    async with sessions() as session:
        marker = (await session.scalars(select(SyncStatus).where(
            SyncStatus.sync_type == "screener_universe",
        ))).one()
        assert marker.additional_data["expected_symbols"] == old_expected

    async with sessions.begin() as session:
        stock = (await session.scalars(select(Stock).where(Stock.symbol == "BBB"))).one()
        stock.is_active = int(transition == "newly_active")
        session.add_all([
            ScreenerSnapshot(symbol="OLD", snapshot_date=today, price=0),
            ScreenerSnapshot(symbol="OLD", snapshot_date=yesterday, price=75),
        ])
    expected = ["AAA", "BBB"] if transition == "newly_active" else ["AAA"]
    progress = {}
    assert await pipeline.sync_screener_data(progress=progress, enrich_ratios=False) == len(expected)

    async with sessions() as session:
        markers = (await session.scalars(select(SyncStatus).where(
            SyncStatus.sync_type == "screener_universe",
        ).order_by(SyncStatus.id))).all()
        assert len(markers) == 2
        assert markers[-1].additional_data["expected_symbols"] == expected
        assert markers[-1].additional_data["expected_count"] == len(expected)
        assert markers[-1].success_count == progress["base_count"] == len(expected)
        result = await CacheManager(db=session).get_screener_data(allow_stale=False)
        assert result.hit is True
        assert {row.symbol for row in result.data} == set(expected)
        rows = (await session.scalars(select(ScreenerSnapshot))).all()
        assert {(row.symbol, row.snapshot_date) for row in rows} == {
            ("AAA", today), ("BBB", today), ("OLD", today), ("OLD", yesterday),
        }
        assert all(row.extended_metrics["price_source"] == "vnstock_vnd:VCI"
                   for row in rows if row.symbol in {"AAA", "BBB"})


@pytest.mark.asyncio
@pytest.mark.parametrize("invalid_base", [
    "missing", "zero", "negative", "nonfinite", "future_date", "unknown_unit", "missing_source",
])
async def test_screener_inactive_leftover_cannot_hide_invalid_active_base(
    screener_base_pipeline, invalid_base,
):
    from datetime import datetime, timedelta

    from vnibb.models.screener import ScreenerSnapshot
    from vnibb.models.stock import Stock

    pipeline, sessions = screener_base_pipeline
    today = datetime.utcnow().date()
    async with sessions.begin() as session:
        session.add_all([
            Stock(symbol="AAA", is_active=1), Stock(symbol="BBB", is_active=1),
            Stock(symbol="OLD", is_active=0),
        ])
        for symbol in ("AAA", "OLD"):
            session.add(ScreenerSnapshot(
                symbol=symbol, snapshot_date=today, trade_date=today, price=100,
                extended_metrics={"price_unit": "VND", "price_source": "vnstock_vnd:VCI"},
            ))
        if invalid_base != "missing":
            session.add(ScreenerSnapshot(
                symbol="BBB", snapshot_date=today,
                trade_date=today + timedelta(days=int(invalid_base == "future_date")),
                price={"zero": 0, "negative": -1, "nonfinite": float("inf")}.get(invalid_base, 100),
                extended_metrics={
                    "price_unit": "unknown" if invalid_base == "unknown_unit" else "VND",
                    "price_source": None if invalid_base == "missing_source" else "vnstock_vnd:VCI",
                },
            ))
    progress = {"stage": "screener", "last_index": 1}
    assert await pipeline.sync_screener_data(progress=progress, enrich_ratios=False) == 0

    async with sessions() as session:
        assert not (await session.scalars(select(SyncStatus).where(
            SyncStatus.sync_type == "screener_universe",
        ))).all()
        assert progress["base_count"] == 1
        assert (await session.scalars(select(ScreenerSnapshot).where(
            ScreenerSnapshot.symbol == "OLD",
        ))).one().price == 100
