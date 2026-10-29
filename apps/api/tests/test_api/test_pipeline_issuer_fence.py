import re
from datetime import datetime
from unittest.mock import AsyncMock

import pandas as pd
import pytest
import pytest_asyncio
from sqlalchemy import Integer, MetaData, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from vnibb.api.v1 import admin
from vnibb.core.database import Base
from vnibb.models.financials import BalanceSheet, CashFlow, IncomeStatement
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models.trading import FinancialRatio
from vnibb.providers.vnstock import runtime
from vnibb.providers.vnstock.financial_ratios import (
    FinancialRatioData,
    VnstockFinancialRatiosFetcher,
)
from vnibb.services import data_pipeline as pipeline_module
from vnibb.services.data_pipeline import DataPipeline

from scripts import repair_financial_periods as repair


@pytest_asyncio.fixture
async def financial_db(monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    metadata = MetaData()
    for table in Base.metadata.sorted_tables:
        table.to_metadata(metadata)
    for table in ("income_statements", "balance_sheets", "cash_flows", "financial_ratios"):
        metadata.tables[table].c.source.nullable = True
        metadata.tables[table].c.id.type = Integer()
    async with engine.begin() as connection:
        await connection.run_sync(metadata.create_all)
        await connection.execute(text("ALTER TABLE financial_ratios ADD COLUMN dividend_yield FLOAT"))
        await connection.execute(text("ALTER TABLE financial_ratios ADD COLUMN payout_ratio FLOAT"))
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(pipeline_module, "engine", engine)
    monkeypatch.setattr(pipeline_module, "async_session_maker", sessions)
    yield sessions
    await engine.dispose()


@pytest.mark.asyncio
async def test_reinforcement_selects_admitted_ratios_before_limit(financial_db, monkeypatch):
    async def table_exists(_db, name):
        return name == "financial_ratios"

    monkeypatch.setattr(admin, "_table_exists", table_exists)
    async with financial_db.begin() as session:
        session.add_all([
            FinancialRatio(id=1, symbol="BAD", period="2025", fiscal_year=2025, source="issuer_report", updated_at=datetime(2000, 1, 1)),
            FinancialRatio(id=2, symbol="NULL", period="2025", fiscal_year=2025, source="vnstock", updated_at=datetime(2001, 1, 1)),
            FinancialRatio(id=3, symbol="GOOD", period="2025", fiscal_year=2025, source="vnstock", updated_at=datetime(2002, 1, 1)),
        ])
        await session.flush()
        await session.execute(text("UPDATE financial_ratios SET source = NULL WHERE symbol = 'NULL'"))
    async with financial_db() as session:
        assert await admin._collect_reinforcement_candidates(session, 2) == ["NULL", "GOOD"]


@pytest.mark.asyncio
@pytest.mark.parametrize("allowed_source", [None, "vnstock"])
async def test_screener_backfill_skips_newer_issuer_ratio(financial_db, monkeypatch, allowed_source):
    class Listing:
        def __init__(self, **kwargs):
            pass

        def all_symbols(self):
            return pd.DataFrame()

        symbols_by_exchange = all_symbols
        symbols_by_industries = all_symbols

    monkeypatch.setattr(runtime, "get_listing_class", lambda: Listing)
    now = datetime.utcnow().date()
    async with financial_db.begin() as session:
        session.add(ScreenerSnapshot(symbol="VNM", snapshot_date=now, price=100))
        session.add_all([
            FinancialRatio(id=1, symbol="VNM", period="2026", fiscal_year=2026, source="issuer_report", revenue_growth=99, raw_data={"ratio_units": {"revenue_growth": "percent"}}),
            FinancialRatio(id=2, symbol="VNM", period="2025", fiscal_year=2025, source="vnstock", revenue_growth=12, raw_data={"ratio_units": {"revenue_growth": "percent"}}),
        ])
        await session.flush()
        if allowed_source is None:
            await session.execute(text("UPDATE financial_ratios SET source = NULL WHERE id = 2"))
    await DataPipeline().sync_screener_data(symbols=["VNM"], progress={"stage": "screener", "last_index": 0})
    async with financial_db() as session:
        row = (await session.scalars(select(ScreenerSnapshot))).one()
        assert row.revenue_growth == 12


@pytest.mark.asyncio
@pytest.mark.parametrize("model,field,value", [
    (IncomeStatement, "revenue", 100),
    (BalanceSheet, "total_liabilities", 20),
    (CashFlow, "operating_cash_flow", 10),
])
async def test_ratio_seed_ignores_issuer_statement_periods(financial_db, monkeypatch, model, field, value):
    monkeypatch.setattr(VnstockFinancialRatiosFetcher, "extract_data", AsyncMock(return_value=[]))
    monkeypatch.setattr(VnstockFinancialRatiosFetcher, "transform_data", lambda query, rows: rows)
    pipeline = DataPipeline()
    monkeypatch.setattr(pipeline, "_wait_for_rate_limit", AsyncMock())
    async with financial_db.begin() as session:
        session.add_all([
            model(id=1, symbol="VNM", period="2026", fiscal_year=2026, period_type="year", source="issuer_report", **{field: value}),
            model(id=2, symbol="VNM", period="2025", fiscal_year=2025, period_type="year", source="vnstock", **{field: value}),
        ])
        await session.flush()
        await session.execute(text(f"UPDATE {model.__tablename__} SET source = NULL WHERE id = 2"))
    await pipeline.sync_financial_ratios(symbols=["VNM"], period="year")
    async with financial_db() as session:
        assert list(await session.scalars(select(FinancialRatio.period))) == ["2025"]


@pytest.mark.asyncio
@pytest.mark.parametrize("model,field,metric", [
    (IncomeStatement, "revenue", "ocf_sales"),
    (BalanceSheet, "total_liabilities", "ocf_debt"),
    (CashFlow, "operating_cash_flow", "ocf_sales"),
])
async def test_ratio_enrichment_ignores_issuer_statement_values(financial_db, monkeypatch, model, field, metric):
    row = FinancialRatioData(symbol="VNM", period="2025")
    monkeypatch.setattr(VnstockFinancialRatiosFetcher, "extract_data", AsyncMock(return_value=[row]))
    monkeypatch.setattr(VnstockFinancialRatiosFetcher, "transform_data", lambda query, rows: rows)
    pipeline = DataPipeline()
    monkeypatch.setattr(pipeline, "_wait_for_rate_limit", AsyncMock())
    async with financial_db.begin() as session:
        session.add(model(id=1, symbol="VNM", period="2025", fiscal_year=2025, period_type="year", source="issuer_report", **{field: 100}))
        if model is not IncomeStatement:
            session.add(IncomeStatement(id=2, symbol="VNM", period="2025", fiscal_year=2025, period_type="year", source="vnstock", revenue=100))
        if model is not CashFlow:
            session.add(CashFlow(id=2, symbol="VNM", period="2025", fiscal_year=2025, period_type="year", source="vnstock", operating_cash_flow=10))
    await pipeline.sync_financial_ratios(symbols=["VNM"], period="year")
    async with financial_db() as session:
        ratio = (await session.scalars(select(FinancialRatio))).one()
        assert ratio.raw_data.get(metric) is None


@pytest.mark.asyncio
async def test_period_repair_preserves_issuer_rows_and_repairs_null_and_valid_sources(financial_db):
    async with financial_db.begin() as session:
        for model in (IncomeStatement, BalanceSheet, CashFlow):
            session.add_all([
                model(id=1, symbol="ISS", period="2025", fiscal_year=2025, period_type="quarter", source="issuer_report"),
                model(id=2, symbol="NUL", period="2025", fiscal_year=2025, period_type="quarter", source="vnstock"),
                model(id=3, symbol="VAL", period="2025", fiscal_year=2025, period_type="quarter", source="vnstock"),
                model(id=4, symbol="COL", period="2025", fiscal_year=2025, period_type="quarter", source="vnstock"),
                model(id=5, symbol="COL", period="2025", fiscal_year=2025, period_type="year", source="issuer_report"),
            ])
        session.add_all([
            FinancialRatio(id=1, symbol="ISS", period="2025-Q1", fiscal_year=2025, period_type="quarter", source="issuer_report"),
            FinancialRatio(id=2, symbol="NUL", period="2025-Q1", fiscal_year=2025, period_type="quarter", source="vnstock"),
            FinancialRatio(id=3, symbol="VAL", period="2025-Q1", fiscal_year=2025, period_type="quarter", source="vnstock"),
        ])
        await session.flush()
        for table in ("income_statements", "balance_sheets", "cash_flows", "financial_ratios"):
            await session.execute(text(f"UPDATE {table} SET source = NULL WHERE symbol = 'NUL'"))
        connection = await session.connection()
        raw = await connection.get_raw_connection()
        await raw.driver_connection.create_function("regexp", 2, lambda pattern, value: bool(re.search(pattern, value or "")))
        await raw.driver_connection.create_function("regexp_replace", 3, lambda value, pattern, replacement: re.sub(pattern, replacement, value))
        for fix in repair.SAFE_FIXES:
            await session.execute(text(fix.sql.replace(" ~ ", " REGEXP ")))
    async with financial_db() as session:
        for model in (IncomeStatement, BalanceSheet, CashFlow):
            rows = {(row.symbol, row.id): row.period_type for row in (await session.scalars(select(model))).all()}
            assert rows == {("ISS", 1): "quarter", ("NUL", 2): "year", ("VAL", 3): "year", ("COL", 4): "quarter", ("COL", 5): "year"}
        rows = {row.symbol: row.period for row in (await session.scalars(select(FinancialRatio))).all()}
        assert rows == {"ISS": "2025-Q1", "NUL": "Q1-2025", "VAL": "Q1-2025"}


@pytest.mark.asyncio
async def test_admin_financial_sample_and_freshness_exclude_issuer(financial_db, monkeypatch):
    async def discover_tables(_db):
        return ["income_statements"]

    async def timestamp_column(_db, _table):
        return "updated_at"

    async def table_exists(_db, _table):
        return True

    monkeypatch.setattr(admin, "_discover_tables", discover_tables)
    monkeypatch.setattr(admin, "_discover_timestamp_column", timestamp_column)
    monkeypatch.setattr(admin, "_table_exists", table_exists)
    async with financial_db.begin() as session:
        session.add_all([
            IncomeStatement(id=1, symbol="ISS", period="2026", fiscal_year=2026, source="issuer_report", updated_at=datetime(2026, 1, 1)),
            IncomeStatement(id=2, symbol="NUL", period="2025", fiscal_year=2025, source="vnstock", updated_at=datetime(2025, 1, 1)),
            IncomeStatement(id=3, symbol="VAL", period="2024", fiscal_year=2024, source="vnstock", updated_at=datetime(2024, 1, 1)),
        ])
        await session.flush()
        await session.execute(text("UPDATE income_statements SET source = NULL WHERE id = 2"))
    async with financial_db() as session:
        sample = await admin.get_table_sample("income_statements", limit=10, offset=0, search=None, db=session)
        assert {row["symbol"] for row in sample["rows"]} == {"NUL", "VAL"}
        assert sample["total"] == 2
        freshness = await admin.get_freshness_summary(session)
        assert freshness["entries"][0]["count"] == 2
        assert freshness["entries"][0]["last_updated"].startswith("2025-01-01")
