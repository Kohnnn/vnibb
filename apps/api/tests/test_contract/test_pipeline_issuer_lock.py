import asyncio
import os
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import select, text, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
from vnibb.core.database import Base
from vnibb.models.financials import CashFlow, IncomeStatement
from vnibb.models.trading import FinancialRatio
from vnibb.providers.vnstock.financial_ratios import FinancialRatioData, VnstockFinancialRatiosFetcher
from vnibb.services import data_pipeline as pipeline_module
from vnibb.services.data_pipeline import DataPipeline


@pytest_asyncio.fixture
async def isolated_engine(test_engine):
    schema = f"issuer_lock_{uuid4().hex}"
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


@pytest.mark.postgres_contract
@pytest.mark.asyncio
@pytest.mark.skipif(os.environ.get("POSTGRES_CONTRACT") != "1", reason="requires disposable PostgreSQL contract database")
async def test_ratio_enrichment_locks_source_ownership_until_commit(isolated_engine, monkeypatch):
    symbol = f"L{uuid4().hex[:8]}".upper()
    selected = asyncio.Event()
    proceed = asyncio.Event()

    class PausingSession(AsyncSession):
        async def execute(self, statement, *args, **kwargs):
            result = await super().execute(statement, *args, **kwargs)
            if getattr(statement, "_for_update_arg", None) is not None:
                selected.set()
                await proceed.wait()
            return result

    ordinary = async_sessionmaker(isolated_engine, expire_on_commit=False)
    pipeline_sessions = async_sessionmaker(isolated_engine, class_=PausingSession, expire_on_commit=False)
    monkeypatch.setattr(pipeline_module, "async_session_maker", pipeline_sessions)
    monkeypatch.setattr(pipeline_module, "engine", isolated_engine)
    provider = FinancialRatioData(symbol=symbol, period="2024")
    monkeypatch.setattr(VnstockFinancialRatiosFetcher, "extract_data", AsyncMock(return_value=[provider]))
    monkeypatch.setattr(VnstockFinancialRatiosFetcher, "transform_data", lambda query, rows: rows)
    pipeline = DataPipeline()
    monkeypatch.setattr(pipeline, "_wait_for_rate_limit", AsyncMock())
    async with ordinary.begin() as session:
        session.add_all([
            IncomeStatement(symbol=symbol, period="2025", period_type="year", fiscal_year=2025, source="vnstock", revenue=100),
            CashFlow(symbol=symbol, period="2025", period_type="year", fiscal_year=2025, source="vnstock", operating_cash_flow=10),
            FinancialRatio(symbol=symbol, period="2025", period_type="year", fiscal_year=2025, source="vnstock", raw_data={}),
        ])
    task = asyncio.create_task(pipeline.sync_financial_ratios(symbols=[symbol], period="year"))
    try:
        await asyncio.wait_for(selected.wait(), timeout=10)
        async with ordinary() as session:
            await session.execute(text("SET LOCAL lock_timeout = '200ms'"))
            with pytest.raises(DBAPIError) as blocked:
                await session.execute(update(FinancialRatio).where(FinancialRatio.symbol == symbol, FinancialRatio.period == "2025").values(source="issuer_report"))
            assert getattr(blocked.value.orig, "sqlstate", None) == "55P03"
            await session.rollback()
        proceed.set()
        assert await asyncio.wait_for(task, timeout=10) == 1
        async with ordinary() as session:
            row = (await session.scalars(select(FinancialRatio).where(FinancialRatio.symbol == symbol, FinancialRatio.period == "2025"))).one()
            assert row.source == "vnstock"
            assert row.raw_data["ocf_sales"] == 0.1
    finally:
        proceed.set()
        await asyncio.gather(task, return_exceptions=True)
