import asyncio
import os
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
from vnibb.core.database import Base
from vnibb.models.financials import IncomeStatement
from vnibb.models.trading import FinancialRatio
from vnibb.providers.vnstock.financial_ratios import (
    FinancialRatioData,
    VnstockFinancialRatiosFetcher,
)
from vnibb.services import data_pipeline as pipeline_module
from vnibb.services.cache_manager import CacheManager
from vnibb.services.data_pipeline import DataPipeline

pytestmark = [
    pytest.mark.postgres_contract,
    pytest.mark.asyncio,
    pytest.mark.skipif(os.environ.get("POSTGRES_CONTRACT") != "1", reason="requires disposable PostgreSQL contract database"),
]


@pytest_asyncio.fixture
async def isolated_engine(test_engine):
    schema = f"ratio_race_{uuid4().hex}"
    async with test_engine.begin() as connection:
        await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_async_engine(
        test_engine.url, poolclass=NullPool,
        connect_args={"server_settings": {"search_path": schema}},
    )
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        yield engine
    finally:
        await engine.dispose()
        async with test_engine.begin() as connection:
            await connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))


def configure_pipeline(monkeypatch, engine, session_class, provider):
    monkeypatch.setattr(pipeline_module, "engine", engine)
    monkeypatch.setattr(pipeline_module, "async_session_maker", async_sessionmaker(engine, class_=session_class, expire_on_commit=False))
    monkeypatch.setattr(VnstockFinancialRatiosFetcher, "extract_data", AsyncMock(side_effect=provider))
    monkeypatch.setattr(VnstockFinancialRatiosFetcher, "transform_data", lambda query, rows: rows)
    pipeline = DataPipeline()
    monkeypatch.setattr(pipeline, "_wait_for_rate_limit", AsyncMock())
    return pipeline


@pytest.mark.parametrize("source", ["vnstock", "issuer_report"])
async def test_seed_does_not_replace_concurrent_direct_writer(isolated_engine, monkeypatch, source):
    selected = asyncio.Event()
    proceed = asyncio.Event()
    symbol = "RACE"

    class PausingSession(AsyncSession):
        async def execute(self, statement, *args, **kwargs):
            result = await super().execute(statement, *args, **kwargs)
            sql = str(statement)
            if sql.startswith("SELECT financial_ratios.period "):
                selected.set()
                await proceed.wait()
            return result

    async def provider(_query):
        return []

    pipeline = configure_pipeline(monkeypatch, isolated_engine, PausingSession, provider)
    sessions = async_sessionmaker(isolated_engine, expire_on_commit=False)
    async with sessions.begin() as session:
        session.add(IncomeStatement(symbol=symbol, period="2025", period_type="year", fiscal_year=2025, source="vnstock", revenue=100))
    task = asyncio.create_task(pipeline.sync_financial_ratios(symbols=[symbol], period="year"))
    try:
        await asyncio.wait_for(selected.wait(), 10)
        async with sessions.begin() as session:
            session.add(FinancialRatio(symbol=symbol, period="2025", period_type="year", fiscal_year=2025, source=source, pe_ratio=17, raw_data={"original": "preserve"}))
        proceed.set()
        await asyncio.wait_for(task, 10)
        async with sessions() as session:
            row = (await session.scalars(select(FinancialRatio).where(FinancialRatio.symbol == symbol))).one()
            assert row.source == source
            assert row.pe_ratio == 17
            assert row.raw_data == {"original": "preserve"}
    finally:
        proceed.set()
        await asyncio.gather(task, return_exceptions=True)


async def test_concurrent_syncs_cannot_deadlock_on_disjoint_periods(isolated_engine, monkeypatch):
    first_written = asyncio.Event()
    second_written = asyncio.Event()
    release_first = asyncio.Event()
    release_second = asyncio.Event()
    pids = {}
    symbol = "RACE"

    class PausingSession(AsyncSession):
        async def execute(self, statement, *args, **kwargs):
            name = asyncio.current_task().get_name()
            if name not in pids:
                pids[name] = (await super().execute(text("SELECT pg_backend_pid()"))).scalar_one()
            result = await super().execute(statement, *args, **kwargs)
            sql = str(statement)
            if sql.startswith("INSERT INTO financial_ratios"):
                if name == "first":
                    first_written.set()
                    await release_first.wait()
                else:
                    second_written.set()
                    await release_second.wait()
            return result

    async def provider(_query):
        period = "2024" if asyncio.current_task().get_name() == "first" else "2025"
        return [FinancialRatioData(symbol=symbol, period=period, pe=17 if period == "2024" else 23)]

    pipeline = configure_pipeline(monkeypatch, isolated_engine, PausingSession, provider)
    sessions = async_sessionmaker(isolated_engine, expire_on_commit=False)
    async with sessions.begin() as session:
        session.add_all([
            FinancialRatio(symbol=symbol, period=period, period_type="year", fiscal_year=int(period), source="vnstock", pe_ratio=1, raw_data={})
            for period in ("2024", "2025")
        ])
    first = asyncio.create_task(pipeline.sync_financial_ratios(symbols=[symbol], period="year"), name="first")
    second = None
    try:
        await asyncio.wait_for(first_written.wait(), 10)
        second = asyncio.create_task(pipeline.sync_financial_ratios(symbols=[symbol], period="year"), name="second")

        async def wait_for_second_write_or_block():
            while True:
                if second_written.is_set():
                    return "written"
                if "second" in pids:
                    async with sessions() as session:
                        blocked = (await session.execute(text("SELECT :first = ANY(pg_blocking_pids(:second))"), {"first": pids["first"], "second": pids["second"]})).scalar_one()
                    if blocked:
                        return "blocked"
                await asyncio.sleep(0.01)

        state = await asyncio.wait_for(wait_for_second_write_or_block(), 10)
        release_first.set()
        if state == "written":
            async def wait_for_first_block():
                while True:
                    async with sessions() as session:
                        blocked = (await session.execute(text("SELECT :second = ANY(pg_blocking_pids(:first))"), {"first": pids["first"], "second": pids["second"]})).scalar_one()
                    if blocked:
                        return
                    await asyncio.sleep(0.01)
            await asyncio.wait_for(wait_for_first_block(), 10)
        release_second.set()
        assert await asyncio.wait_for(asyncio.gather(first, second), 15) == [1, 1]
        async with sessions() as session:
            rows = (await session.scalars(select(FinancialRatio).where(FinancialRatio.symbol == symbol).order_by(FinancialRatio.period))).all()
            assert [(row.period, row.source, row.pe_ratio) for row in rows] == [("2024", "vnstock", 17), ("2025", "vnstock", 23)]
    finally:
        release_first.set()
        release_second.set()
        await asyncio.gather(*(task for task in (first, second) if task is not None), return_exceptions=True)


async def test_cache_ratio_writer_serializes_with_sync(isolated_engine, monkeypatch):
    written = asyncio.Event()
    release = asyncio.Event()
    pids = {}

    class PausingSession(AsyncSession):
        async def execute(self, statement, *args, **kwargs):
            name = asyncio.current_task().get_name()
            if name not in pids:
                pids[name] = (await super().execute(text("SELECT pg_backend_pid()"))).scalar_one()
            result = await super().execute(statement, *args, **kwargs)
            if name == "sync" and str(statement).startswith("INSERT INTO financial_ratios"):
                written.set()
                await release.wait()
            return result

    async def provider(_query):
        return [FinancialRatioData(symbol="RACE", period="2025", pe=23)]

    pipeline = configure_pipeline(monkeypatch, isolated_engine, PausingSession, provider)
    sessions = async_sessionmaker(isolated_engine, class_=PausingSession, expire_on_commit=False)
    sync = asyncio.create_task(pipeline.sync_financial_ratios(symbols=["RACE"], period="year"), name="sync")
    writer = None
    try:
        await asyncio.wait_for(written.wait(), 10)

        async def write_cache():
            async with sessions() as session:
                return await CacheManager(session).store_financial_ratios(
                    "RACE", "year", [{"period": "2024", "fiscal_year": 2024, "pe_ratio": 17}], source="vnstock"
                )

        writer = asyncio.create_task(write_cache(), name="writer")

        async def wait_for_block():
            while True:
                if "writer" in pids:
                    async with isolated_engine.connect() as connection:
                        blocked = (await connection.execute(text("SELECT :sync = ANY(pg_blocking_pids(:writer))"), {"sync": pids["sync"], "writer": pids["writer"]})).scalar_one()
                    if blocked:
                        return
                if writer.done():
                    pytest.fail("cache writer completed before the sync transaction released its lock")
                await asyncio.sleep(0.01)

        await asyncio.wait_for(wait_for_block(), 10)
        release.set()
        assert await asyncio.wait_for(asyncio.gather(sync, writer), 10) == [1, 1]
        async with async_sessionmaker(isolated_engine)() as session:
            rows = (await session.scalars(select(FinancialRatio).order_by(FinancialRatio.period))).all()
            assert [(row.period, row.pe_ratio, row.source) for row in rows] == [("2024", 17, "vnstock"), ("2025", 23, "vnstock")]
    finally:
        release.set()
        await asyncio.gather(*(task for task in (sync, writer) if task is not None), return_exceptions=True)
