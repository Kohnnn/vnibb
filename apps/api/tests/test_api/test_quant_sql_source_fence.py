import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import MetaData, null
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from vnibb.api.v1.quant import router
from vnibb.core.database import get_db
from vnibb.models.financials import BalanceSheet, CashFlow, IncomeStatement


@pytest.mark.asyncio
@pytest.mark.parametrize("issuer_model", [IncomeStatement, CashFlow, BalanceSheet])
async def test_earnings_quality_excludes_issuer_before_limit_and_keeps_legacy(issuer_model):
    metadata = MetaData()
    for model in (IncomeStatement, CashFlow, BalanceSheet):
        table = model.__table__.to_metadata(metadata)
        table.c.source.nullable = True
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    try:
        async with engine.begin() as connection:
            await connection.run_sync(metadata.create_all)
        async with async_sessionmaker(engine, expire_on_commit=False)() as session:
            for index in range(12):
                year, quarter = 2020 + index // 4, index % 4 + 1
                common = dict(
                    id=index + 1, symbol="FPT", period=f"Q{quarter}-{year}",
                    period_type="quarter", fiscal_year=year, fiscal_quarter=quarter,
                    source=null() if index >= 6 else "vietcap",
                )
                session.add_all([
                    IncomeStatement(**common, revenue=100, net_income=20, eps=2),
                    CashFlow(**common, operating_cash_flow=80),
                    BalanceSheet(**common, total_assets=200),
                ])
                issuer_year = year + 3
                issuer_common = dict(
                    id=index + 101, symbol="FPT", period=f"Q{quarter}-{issuer_year}",
                    period_type="quarter", fiscal_year=issuer_year, fiscal_quarter=quarter,
                    source="issuer_report",
                )
                session.add(issuer_model(**issuer_common))
            await session.commit()

            app = FastAPI()
            app.include_router(router, prefix="/quant")

            async def override_get_db():
                yield session

            app.dependency_overrides[get_db] = override_get_db
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                response = await client.get("/quant/FPT/earnings-quality")

            assert response.status_code == 200
            payload = response.json()
            assert payload["error"] is None
            assert payload["meta"]["count"] == 8
            assert [row["period"] for row in payload["data"]["series"]] == [
                "Q4-2022", "Q3-2022", "Q2-2022", "Q1-2022",
                "Q4-2021", "Q3-2021", "Q2-2021", "Q1-2021",
            ]
            assert all(
                (row["revenue"], row["operating_cash_flow"], row["total_assets"]) == (100, 80, 200)
                for row in payload["data"]["series"]
            )
    finally:
        await engine.dispose()
