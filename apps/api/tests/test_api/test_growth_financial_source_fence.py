import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import MetaData, null
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from vnibb.api.v1.equity import router
from vnibb.core.database import get_db
from vnibb.models.financials import BalanceSheet, IncomeStatement


@pytest_asyncio.fixture
async def growth_client():
    metadata = MetaData()
    for model in (IncomeStatement, BalanceSheet):
        table = model.__table__.to_metadata(metadata)
        table.c.source.nullable = True
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(metadata.create_all)
    async with async_sessionmaker(engine, expire_on_commit=False)() as session:
        app = FastAPI()
        app.include_router(router, prefix="/equity")

        async def override_db():
            yield session

        app.dependency_overrides[get_db] = override_db
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            yield session, client
    await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize("source", [None, "vietcap"])
async def test_growth_skips_newer_issuer_rows_before_limits(growth_client, source):
    db, client = growth_client
    eligible_source = null() if source is None else source
    for year, value, row_source in [(2024, 100, eligible_source), (2025, 150, eligible_source),
                                    (2026, 999, "issuer_report")]:
        db.add_all([
            IncomeStatement(id=year, symbol="FPT", period=str(year), period_type="year",
                            fiscal_year=year, source=row_source, revenue=value, net_income=value,
                            eps=value, ebitda=value),
            BalanceSheet(id=year, symbol="FPT", period=str(year), period_type="year",
                         fiscal_year=year, source=row_source, total_assets=value),
            IncomeStatement(id=year + 10000, symbol="FPT", period=f"Q4-{year}",
                            period_type="quarter", fiscal_year=year, fiscal_quarter=4,
                            source=row_source, revenue=value, net_income=value, eps=value, ebitda=value),
        ])
    await db.commit()

    response = await client.get("/equity/fpt/growth")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["as_of"] == {"annual": "2025", "quarter": "Q4-2025"}
    assert data["yoy"] == {"revenue_growth": 50, "earnings_growth": 50, "eps_growth": 50,
                           "ebitda_growth": 50, "asset_growth": 50}
    assert data["qoq"] == {"revenue_growth": 50, "earnings_growth": 50, "eps_growth": 50,
                           "ebitda_growth": 50}
    assert data["comparisons"]["yoy"]["revenue_growth"]["source"] == source
    assert data["comparisons"]["qoq"]["revenue_growth"]["source"] == source


@pytest.mark.asyncio
@pytest.mark.parametrize("source", [None, "vietcap"])
async def test_growth_withholds_issuer_previous_quarter(growth_client, source):
    db, client = growth_client
    db.add_all([
        IncomeStatement(id=1, symbol="FPT", period="Q4-2024", period_type="quarter",
                        fiscal_year=2024, fiscal_quarter=4, source="issuer_report", revenue=100),
        IncomeStatement(id=2, symbol="FPT", period="Q4-2025", period_type="quarter",
                        fiscal_year=2025, fiscal_quarter=4,
                        source=null() if source is None else source, revenue=150),
    ])
    await db.commit()

    response = await client.get("/equity/FPT/growth")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["as_of"]["quarter"] == "Q4-2025"
    assert data["qoq"]["revenue_growth"] is None
    detail = data["comparisons"]["qoq"]["revenue_growth"]
    assert detail["current"] == 150
    assert detail["previous"] is None
    assert detail["unavailable_reason"] == "missing_base_or_value"


@pytest.mark.asyncio
@pytest.mark.parametrize("source", [None, "vietcap"])
async def test_growth_selects_eligible_previous_quarter_before_limit(growth_client, source):
    db, client = growth_client
    eligible_source = null() if source is None else source
    db.add_all([
        IncomeStatement(id=1, symbol="FPT", period="Q4-2024", period_type="quarter",
                        fiscal_year=2024, fiscal_quarter=4, source="issuer_report", revenue=999),
        IncomeStatement(id=2, symbol="FPT", period="2024-Q4", period_type="quarter",
                        fiscal_year=2024, fiscal_quarter=4, source=eligible_source, revenue=100),
        IncomeStatement(id=3, symbol="FPT", period="Q4-2025", period_type="quarter",
                        fiscal_year=2025, fiscal_quarter=4, source=eligible_source, revenue=150),
    ])
    await db.commit()

    response = await client.get("/equity/FPT/growth")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["qoq"]["revenue_growth"] == 50
    detail = data["comparisons"]["qoq"]["revenue_growth"]
    assert (detail["current"], detail["previous"], detail["previous_period"]) == (150, 100, "2024-Q4")


@pytest.mark.asyncio
async def test_growth_returns_no_issuer_only_values(growth_client):
    db, client = growth_client
    db.add_all([
        IncomeStatement(id=1, symbol="FPT", period="2025", period_type="year",
                        fiscal_year=2025, source="issuer_report", revenue=999),
        IncomeStatement(id=2, symbol="FPT", period="Q4-2025", period_type="quarter",
                        fiscal_year=2025, fiscal_quarter=4, source="issuer_report", revenue=999),
        BalanceSheet(id=1, symbol="FPT", period="2025", period_type="year",
                     fiscal_year=2025, source="issuer_report", total_assets=999),
    ])
    await db.commit()

    response = await client.get("/equity/FPT/growth")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["as_of"] == {"annual": None, "quarter": None}
    assert all(value is None for value in data["yoy"].values())
    assert all(value is None for value in data["qoq"].values())
    assert data["comparisons"]["yoy"]["revenue_growth"]["current"] is None
    assert data["comparisons"]["qoq"]["revenue_growth"]["current"] is None
