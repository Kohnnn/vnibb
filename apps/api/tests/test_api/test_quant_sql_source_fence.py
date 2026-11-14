import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import MetaData, null
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from vnibb.api.v1.quant import router
from vnibb.core.database import get_db
from vnibb.models.financials import BalanceSheet, CashFlow, IncomeStatement


def _lineage(**overrides):
    """What the pipeline persists beside an admitted statement row."""
    lineage = {
        "source": "vietcap",
        "currency": "VND",
        "value_unit": "VND",
        "consolidation_basis": "consolidated",
        "flow_basis": "single_quarter",
        "unit_metadata": {
            "revenue": {"source_unit": "VND", "value_unit": "VND"},
            "net_income": {"source_unit": "VND", "value_unit": "VND"},
            "eps": {"source_unit": "VND", "value_unit": "VND/share"},
            "operating_cash_flow": {"source_unit": "VND", "value_unit": "VND"},
            "total_assets": {"source_unit": "VND", "value_unit": "VND"},
        },
    }
    lineage.update(overrides)
    return {"_financial_lineage": lineage}


def _client(session):
    app = FastAPI()
    app.include_router(router, prefix="/quant")

    async def override_get_db():
        yield session

    app.dependency_overrides[get_db] = override_get_db
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _fresh_session():
    metadata = MetaData()
    for model in (IncomeStatement, CashFlow, BalanceSheet):
        table = model.__table__.to_metadata(metadata)
        table.c.source.nullable = True
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(metadata.create_all)
    return engine


@pytest.mark.asyncio
@pytest.mark.parametrize("issuer_model", [IncomeStatement, CashFlow, BalanceSheet])
async def test_earnings_quality_excludes_issuer_before_limit_and_keeps_legacy(issuer_model):
    engine = await _fresh_session()
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as session:
            for index in range(12):
                year, quarter = 2020 + index // 4, index % 4 + 1
                common = {
                    "id": index + 1, "symbol": "FPT", "period": f"Q{quarter}-{year}",
                    "period_type": "quarter", "fiscal_year": year, "fiscal_quarter": quarter,
                    "source": null() if index >= 6 else "vietcap",
                }
                session.add_all([
                    IncomeStatement(**common, revenue=100, net_income=20, eps=2, raw_data=_lineage()),
                    CashFlow(**common, operating_cash_flow=80, raw_data=_lineage()),
                    BalanceSheet(**common, total_assets=200, raw_data=_lineage(flow_basis=None)),
                ])
                issuer_year = year + 3
                issuer_common = {
                    "id": index + 101, "symbol": "FPT", "period": f"Q{quarter}-{issuer_year}",
                    "period_type": "quarter", "fiscal_year": issuer_year, "fiscal_quarter": quarter,
                    "source": "issuer_report",
                }
                session.add(issuer_model(**issuer_common))
            await session.commit()

            async with _client(session) as client:
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


@pytest.mark.asyncio
async def test_earnings_quality_does_not_grade_rows_without_unit_lineage():
    """Legacy rows kept for the source fence are not gradable inputs (#257)."""
    engine = await _fresh_session()
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as session:
            for index, quarter in enumerate((1, 2)):
                common = {
                    "id": index + 1, "symbol": "QAZ", "period": f"Q{quarter}-2025",
                    "period_type": "quarter", "fiscal_year": 2025, "fiscal_quarter": quarter,
                    "source": null(),
                }
                session.add_all([
                    IncomeStatement(**common, revenue=100, net_income=100, eps=2),
                    CashFlow(**common, operating_cash_flow=120),
                    BalanceSheet(**common, total_assets=20_000),
                ])
            await session.commit()

            async with _client(session) as client:
                response = await client.get("/quant/QAZ/earnings-quality")

            assert response.status_code == 200
            payload = response.json()
            data = payload["data"]
            assert data["grade"] is None
            assert data["quality_score"] is None
            assert data["trend"] is None
            assert data["checks"] == []
            assert data["coverage"]["status"] == "unavailable"
            assert payload["error"] == data["coverage"]["unavailable_reason"]
            # The per-period reasons name the actual gate that refused them.
            availability = data["coverage"]["component_availability"]["Q2-2025"]
            assert availability["revenue"] == "legacy_unit_basis_unconfirmed"
            assert availability["operating_cash_flow"] == "legacy_unit_basis_unconfirmed"
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_earnings_quality_withholds_mixed_basis_ratios():
    """An admitted income row cannot be divided by an unadmitted cash figure."""
    engine = await _fresh_session()
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as session:
            for index, quarter in enumerate((1, 2)):
                common = {
                    "id": index + 1, "symbol": "QAZ", "period": f"Q{quarter}-2025",
                    "period_type": "quarter", "fiscal_year": 2025, "fiscal_quarter": quarter,
                    "source": "vietcap",
                }
                session.add(IncomeStatement(
                    **common, revenue=100, net_income=100, eps=2, raw_data=_lineage(),
                ))
                # Cash flow is a million-VND YTD series, the balance sheet a
                # consolidated VND snapshot: neither may pair with the income.
                session.add(CashFlow(
                    **common, operating_cash_flow=120,
                    raw_data=_lineage(value_unit="million_VND", flow_basis="cumulative_ytd"),
                ))
                session.add(BalanceSheet(
                    **common, total_assets=20_000,
                    raw_data=_lineage(flow_basis=None, value_unit="VND"),
                ))
            await session.commit()

            async with _client(session) as client:
                response = await client.get("/quant/QAZ/earnings-quality")

            data = response.json()["data"]
            assert data["grade"] is None
            assert data["revenue_quality_pct"] is None
            assert data["accruals_ratio_pct"] is None
            availability = data["coverage"]["component_availability"]["Q2-2025"]
            assert availability["revenue"] is None
            assert availability["operating_cash_flow"] == "unverified_statement_currency_or_unit"
            assert availability["total_assets"] is None
            assert availability["cross_statement_basis"] == "cross_statement_basis_mismatch"
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_earnings_quality_reports_partial_ratios_without_a_grade():
    """One admitted ratio is an observation, not a complete scorecard (#257)."""
    engine = await _fresh_session()
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as session:
            for index, quarter in enumerate((1, 2)):
                common = {
                    "id": index + 1, "symbol": "QAZ", "period": f"Q{quarter}-2025",
                    "period_type": "quarter", "fiscal_year": 2025, "fiscal_quarter": quarter,
                    "source": "vietcap",
                }
                # Revenue and OCF are admitted, net income is not: cash
                # conversion is computable, accruals are not.
                session.add(IncomeStatement(
                    **common, revenue=100, eps=2,
                    raw_data=_lineage(unit_metadata={
                        "revenue": {"source_unit": "VND", "value_unit": "VND"},
                        "eps": {"source_unit": "VND", "value_unit": "VND/share"},
                    }),
                ))
                session.add(CashFlow(
                    **common, operating_cash_flow=120, raw_data=_lineage(),
                ))
                session.add(BalanceSheet(
                    **common, total_assets=20_000,
                    raw_data=_lineage(flow_basis=None),
                ))
            await session.commit()

            async with _client(session) as client:
                response = await client.get("/quant/QAZ/earnings-quality")

            data = response.json()["data"]
            assert data["grade"] is None
            assert data["quality_score"] is None
            assert data["trend"] is None
            assert data["coverage"]["status"] == "partial"
            assert data["coverage"]["required_components"] == {
                "accruals": False, "revenue_quality": True,
            }
            # The admitted ratio is reported; the ungraded scorecard is named.
            assert data["revenue_quality_pct"] == pytest.approx(120.0)
            assert data["accruals_ratio_pct"] is None
            assert data["coverage"]["unavailable_reason"]
            assert data["series"][0]["cross_statement_basis_reason"] is None
    finally:
        await engine.dispose()
