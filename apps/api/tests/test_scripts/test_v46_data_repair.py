import argparse
import importlib.util
from pathlib import Path

import pytest
from sqlalchemy import MetaData, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.sql.dml import Update

from vnibb.models.financials import IncomeStatement
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models.trading import FinancialRatio

path = Path(__file__).resolve().parents[2] / "scripts/v46_data_repair.py"
spec = importlib.util.spec_from_file_location("v46_data_repair", path)
assert spec and spec.loader
repair = importlib.util.module_from_spec(spec)
spec.loader.exec_module(repair)


@pytest.mark.asyncio
async def test_eps_backfill_rejects_unsafe_write():
    with pytest.raises(RuntimeError, match="EPS backfill is disabled"):
        await repair._backfill_income_eps_from_ratios(500)


@pytest.mark.asyncio
@pytest.mark.parametrize("target", ["eps", "all"])
async def test_eps_and_all_fail_before_any_database_work(monkeypatch, capsys, target):
    monkeypatch.setattr(repair, "parse_args", lambda: argparse.Namespace(
        target=target, audit_only=False, batch_size=500, output_json="unused.json"
    ))

    async def unexpected_database_work():
        raise AssertionError("must reject before database work")

    monkeypatch.setattr(repair, "_collect_metrics", unexpected_database_work)
    assert await repair.main() != 0
    assert "EPS backfill is disabled" in capsys.readouterr().err


@pytest.mark.asyncio
async def test_ev_sales_excludes_issuer_inputs_and_targets(monkeypatch):
    metadata = MetaData()
    for model in (IncomeStatement, FinancialRatio, ScreenerSnapshot):
        model.__table__.to_metadata(metadata)
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as session:
        for identifier, symbol, income_source, ratio_source in (
            (1, "SAFE", "vnstock", "vnstock"),
            (2, "INPUT", "issuer_report", "vnstock"),
            (3, "TARGET", "vnstock", "issuer_report"),
        ):
            common = dict(id=identifier, symbol=symbol, period="2025", period_type="year", fiscal_year=2025)
            session.add(IncomeStatement(**common, source=income_source, revenue=100))
            session.add(FinancialRatio(**common, source=ratio_source, raw_data={"enterprise_value": 200}))
        await session.commit()
    monkeypatch.setattr(repair, "async_session_maker", sessions)
    assert await repair._backfill_ev_sales(500) == 1
    async with sessions() as session:
        rows = (await session.execute(select(FinancialRatio).order_by(FinancialRatio.id))).scalars().all()
        assert [row.ev_sales for row in rows] == [2, None, None]
    await engine.dispose()


@pytest.mark.asyncio
async def test_ev_sales_does_not_overwrite_concurrently_owned_ratio(monkeypatch):
    metadata = MetaData()
    for model in (IncomeStatement, FinancialRatio, ScreenerSnapshot):
        model.__table__.to_metadata(metadata)
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as session:
        common = dict(id=1, symbol="FPT", period="2025", period_type="year", fiscal_year=2025)
        session.add(IncomeStatement(**common, source="vnstock", revenue=100))
        session.add(FinancialRatio(**common, source="vnstock", raw_data={"enterprise_value": 200}))
        await session.commit()

    class OwnershipChangeSession(AsyncSession):
        async def execute(self, statement, *args, **kwargs):
            if isinstance(statement, Update) and statement.table.name == "financial_ratios":
                await super().execute(update(FinancialRatio).where(FinancialRatio.id == 1).values(source="issuer_report"))
            return await super().execute(statement, *args, **kwargs)

    monkeypatch.setattr(repair, "async_session_maker", async_sessionmaker(
        engine, class_=OwnershipChangeSession, expire_on_commit=False,
    ))
    assert await repair._backfill_ev_sales(500) == 0
    async with sessions() as session:
        row = (await session.execute(select(FinancialRatio))).scalar_one()
        assert row.source == "issuer_report"
        assert row.ev_sales is None
    await engine.dispose()


@pytest.mark.asyncio
async def test_ev_sales_rechecks_income_ownership_before_use(monkeypatch):
    metadata = MetaData()
    for model in (IncomeStatement, FinancialRatio, ScreenerSnapshot):
        model.__table__.to_metadata(metadata)
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as session:
        common = dict(id=1, symbol="FPT", period="2025", period_type="year", fiscal_year=2025)
        session.add(IncomeStatement(**common, source="vnstock", revenue=100))
        session.add(FinancialRatio(**common, source="vnstock", raw_data={"enterprise_value": 200}))
        await session.commit()

    class OwnershipChangeSession(AsyncSession):
        async def execute(self, statement, *args, **kwargs):
            if getattr(statement, "_for_update_arg", None) is not None:
                await super().execute(update(IncomeStatement).where(IncomeStatement.id == 1).values(source="issuer_report"))
            return await super().execute(statement, *args, **kwargs)

    monkeypatch.setattr(repair, "async_session_maker", async_sessionmaker(
        engine, class_=OwnershipChangeSession, expire_on_commit=False,
    ))
    assert await repair._backfill_ev_sales(500) == 0
    async with sessions() as session:
        row = (await session.execute(select(FinancialRatio))).scalar_one()
        assert row.ev_sales is None
    await engine.dispose()
