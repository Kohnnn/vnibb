from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from sqlalchemy import MetaData, null
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from vnibb.api.v1 import equity
from vnibb.models.financials import BalanceSheet, CashFlow, IncomeStatement
from vnibb.models.stock import Stock, StockPrice
from vnibb.models.trading import FinancialRatio
from vnibb.providers.vnstock.financials import FinancialStatementData


@pytest_asyncio.fixture
async def legacy_db():
    # Deployed legacy tables may contain NULL source despite today's ORM constraint.
    metadata = MetaData()
    for model in (Stock, StockPrice, IncomeStatement, BalanceSheet, CashFlow, FinancialRatio):
        table = model.__table__.to_metadata(metadata)
        if model in (IncomeStatement, BalanceSheet, CashFlow, FinancialRatio):
            table.c.source.nullable = True
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(metadata.create_all)
    async with async_sessionmaker(engine, expire_on_commit=False)() as session:
        yield session
    await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize("statement_type,model,metric", [
    ("income", IncomeStatement, "revenue"),
    ("balance", BalanceSheet, "total_assets"),
    ("cashflow", CashFlow, "operating_cash_flow"),
])
@pytest.mark.parametrize("sources,expected", [
    ([(2025, "vietcap"), (2024, None)], [(2025, 125), (2024, 124)]),
    ([(2026, "issuer_report")], []),
    ([(2026, "issuer_report"), (2025, "vietcap")], [(2025, 125)]),
    ([(2026, "issuer_report"), (2025, None)], [(2025, 125)]),
])
async def test_statement_fallback_fences_issuer_before_limit(
    legacy_db, statement_type, model, metric, sources, expected,
):
    for year, source in sources:
        value = year - 1900
        canonical = FinancialStatementData(
            symbol="FPT", period=str(year), fiscal_year=year, statement_type=statement_type,
            source="vietcap", currency="VND", value_unit="VND",
            consolidation_basis="Consolidated", flow_basis="annual",
            unit_metadata={metric: {"source_unit": "VND", "value_unit": "VND"}},
            **{metric: value},
        )
        legacy_db.add(model(
            id=year, symbol="FPT", period=str(year), period_type="year", fiscal_year=year,
            source=source if source is not None else null(),
            raw_data={"_financial_lineage": {"canonical_data": canonical.model_dump(mode="json")}},
            **{metric: value},
        ))
    await legacy_db.commit()

    rows = await equity._load_financial_statement_fallback(
        legacy_db, "fpt", statement_type, "year", len(expected) or 1,
    )
    assert [(row.fiscal_year, getattr(row, metric)) for row in rows] == expected


@pytest.mark.asyncio
@pytest.mark.parametrize("endpoint", ["ratios", "history"])
@pytest.mark.parametrize("sources,expected", [
    ([(2025, "vietcap"), (2024, None)], [("2025", 25), ("2024", 24)]),
    ([(2026, "issuer_report")], []),
    ([(2026, "issuer_report"), (2025, "vietcap")], [("2025", 25)]),
    ([(2026, "issuer_report"), (2025, None)], [("2025", 25)]),
])
async def test_ratio_sql_fences_issuer_before_limit(legacy_db, monkeypatch, endpoint, sources, expected):
    for year, source in sources:
        legacy_db.add(FinancialRatio(
            id=year, symbol="FPT", period=str(year), period_type="year", fiscal_year=year,
            source=source if source is not None else null(), pe_ratio=year - 2000,
            raw_data={"_financial_lineage": {"canonical_data": {"source": "vietcap"}}},
        ))
    await legacy_db.commit()
    monkeypatch.setattr(equity, "_load_mongo_financial_ratio_rows", AsyncMock(return_value=[]))
    monkeypatch.setattr(equity.VnstockFinancialRatiosFetcher, "fetch", AsyncMock(return_value=[]))
    monkeypatch.setattr(equity, "_get_latest_statement_period_key", AsyncMock(return_value=0))
    monkeypatch.setattr(equity, "_schedule_critical_reinforcement", AsyncMock())

    async def unchanged_enrichment(*, rows, **kwargs):
        return rows

    monkeypatch.setattr(equity, "_enrich_missing_ratio_metrics", unchanged_enrichment)
    if endpoint == "ratios":
        response = await equity.get_financial_ratios.__wrapped__("FPT", "year", db=legacy_db)
        actual = [(row.period, row.pe) for row in response.data]
    else:
        response = await equity.get_ratio_history.__wrapped__(
            "FPT", ratios="pe", period="year", limit=len(expected) or 1, db=legacy_db,
        )
        actual = [(row["period"], row["pe"]) for row in response.data]
    assert sorted(actual) == sorted(expected)
