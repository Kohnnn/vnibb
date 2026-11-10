import asyncio
import os
from datetime import datetime
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from vnibb.core.database import Base
from vnibb.mcp.server import _serialize_row
from vnibb.models.financials import IncomeStatement
from vnibb.providers.vnstock.financials import FinancialStatementData, VnstockFinancialsFetcher
from vnibb.services import data_pipeline as pipeline_module
from vnibb.services.cache_manager import CacheManager, StructuredPersistenceConflict
from vnibb.services.data_pipeline import DataPipeline

pytestmark = [
    pytest.mark.postgres_contract,
    pytest.mark.asyncio,
    pytest.mark.skipif(os.environ.get("POSTGRES_CONTRACT") != "1", reason="requires disposable PostgreSQL contract database"),
]


@pytest_asyncio.fixture
async def isolated_engine(test_engine):
    schema = f"statement_race_{uuid4().hex}"
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


async def test_statement_sync_preserves_concurrent_cache_writer_lineage(isolated_engine, monkeypatch):
    selected = asyncio.Event()
    proceed = asyncio.Event()
    unit = {"unit": "VND", "source_unit": "VND"}
    statement = FinancialStatementData(
        symbol="RACE", period="2025", fiscal_year=2025, statement_type="income",
        source="VCI", currency="VND", value_unit="VND", consolidation_basis="consolidated",
        flow_basis="annual", revenue=100, unit_metadata={"revenue": unit},
    )
    prior = statement.model_copy(update={"revenue": None, "gross_profit": 0, "unit_metadata": {"gross_profit": unit}})

    class PausingSession(AsyncSession):
        async def execute(self, query, *args, **kwargs):
            result = await super().execute(query, *args, **kwargs)
            if str(query).startswith("SELECT income_statements.id,"):
                selected.set()
                await proceed.wait()
            return result

    class FixtureDateTime(datetime):
        @classmethod
        def utcnow(cls):
            return cls(2026, 4, 2)

    monkeypatch.setattr(pipeline_module, "datetime", FixtureDateTime)
    monkeypatch.setattr(pipeline_module, "engine", isolated_engine)
    monkeypatch.setattr(pipeline_module, "async_session_maker", async_sessionmaker(isolated_engine, expire_on_commit=False))
    monkeypatch.setattr(VnstockFinancialsFetcher, "extract_data", AsyncMock(return_value=[]))
    monkeypatch.setattr(VnstockFinancialsFetcher, "transform_data", lambda params, rows: [statement])
    pipeline = DataPipeline()
    monkeypatch.setattr(pipeline, "_wait_for_rate_limit", AsyncMock())
    monkeypatch.setattr(pipeline, "_cache_set_json", AsyncMock())
    sessions = async_sessionmaker(isolated_engine, expire_on_commit=False)
    pausing_sessions = async_sessionmaker(isolated_engine, class_=PausingSession, expire_on_commit=False)

    async def write_cache():
        async with pausing_sessions() as session:
            return await CacheManager(session).store_financial_data("RACE", "income", "year", [{
                "period": "2025", "fiscal_year": 2025, "gross_profit": 0,
                "raw_data": {"_financial_lineage": {"canonical_data": prior.model_dump(mode="json")}},
            }], source="VCI")

    writer = asyncio.create_task(write_cache())
    task = None
    try:
        await asyncio.wait_for(selected.wait(), 10)
        task = asyncio.create_task(pipeline.sync_financials(symbols=["RACE"], period="year", statement_types=["income"], count=1))
        try:
            await asyncio.wait_for(asyncio.shield(task), 1)
        except TimeoutError:
            pass
        proceed.set()
        await asyncio.wait_for(asyncio.gather(task, writer), 10)
        async with sessions() as session:
            row = (await session.scalars(select(IncomeStatement).where(IncomeStatement.symbol == "RACE"))).one()
            served = _serialize_row({column.name: getattr(row, column.name) for column in IncomeStatement.__table__.columns}, model=IncomeStatement)
            assert row.source == "VCI"
            assert (served["revenue"], served["gross_profit"]) == (100, 0)
    finally:
        proceed.set()
        await asyncio.gather(*(item for item in (task, writer) if item is not None), return_exceptions=True)


async def test_cache_writer_preserves_concurrent_statement_sync_lineage(isolated_engine, monkeypatch):
    selected = asyncio.Event()
    proceed = asyncio.Event()
    unit = {"unit": "VND", "source_unit": "VND"}
    statement = FinancialStatementData(
        symbol="RACE", period="2025", fiscal_year=2025, statement_type="income",
        source="VCI", currency="VND", value_unit="VND", consolidation_basis="consolidated",
        flow_basis="annual", revenue=100, unit_metadata={"revenue": unit},
    )
    prior = statement.model_copy(update={"revenue": None, "gross_profit": 0, "unit_metadata": {"gross_profit": unit}})

    class PausingSession(AsyncSession):
        async def execute(self, query, *args, **kwargs):
            result = await super().execute(query, *args, **kwargs)
            if str(query).startswith("SELECT income_statements.id,"):
                selected.set()
                await proceed.wait()
            return result

    class FixtureDateTime(datetime):
        @classmethod
        def utcnow(cls):
            return cls(2026, 4, 2)

    monkeypatch.setattr(pipeline_module, "datetime", FixtureDateTime)
    monkeypatch.setattr(pipeline_module, "engine", isolated_engine)
    monkeypatch.setattr(pipeline_module, "async_session_maker", async_sessionmaker(isolated_engine, class_=PausingSession, expire_on_commit=False))
    monkeypatch.setattr(VnstockFinancialsFetcher, "extract_data", AsyncMock(return_value=[]))
    monkeypatch.setattr(VnstockFinancialsFetcher, "transform_data", lambda params, rows: [statement])
    pipeline = DataPipeline()
    monkeypatch.setattr(pipeline, "_wait_for_rate_limit", AsyncMock())
    monkeypatch.setattr(pipeline, "_cache_set_json", AsyncMock())
    sessions = async_sessionmaker(isolated_engine, expire_on_commit=False)

    async def write_cache():
        async with sessions() as session:
            return await CacheManager(session).store_financial_data("RACE", "income", "year", [{
                "period": "2025", "fiscal_year": 2025, "gross_profit": 0,
                "raw_data": {"_financial_lineage": {"canonical_data": prior.model_dump(mode="json")}},
            }], source="VCI")

    task = asyncio.create_task(pipeline.sync_financials(symbols=["RACE"], period="year", statement_types=["income"], count=1))
    writer = None
    try:
        await asyncio.wait_for(selected.wait(), 10)
        writer = asyncio.create_task(write_cache())
        try:
            await asyncio.wait_for(asyncio.shield(writer), 1)
        except TimeoutError:
            pass
        proceed.set()
        result = await asyncio.wait_for(asyncio.gather(task, writer, return_exceptions=True), 10)
        assert not isinstance(result[0], BaseException)
        assert isinstance(result[1], StructuredPersistenceConflict)
        async with sessions() as session:
            row = (await session.scalars(select(IncomeStatement).where(IncomeStatement.symbol == "RACE"))).one()
            served = _serialize_row({column.name: getattr(row, column.name) for column in IncomeStatement.__table__.columns}, model=IncomeStatement)
            assert row.source == "VCI"
            assert (served["revenue"], served["gross_profit"]) == (100, None)
    finally:
        proceed.set()
        await asyncio.gather(*(item for item in (task, writer) if item is not None), return_exceptions=True)
