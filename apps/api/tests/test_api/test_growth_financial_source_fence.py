"""Growth endpoint admission regressions (issues #246 and the source fence).

The fence below is the issuer-report/limit ordering, retained unchanged. The
admission cases are new: a populated lineage dictionary is not evidence, two
matching unknowns are not a confirmed basis, and asset growth obeys the same
contract as the income metrics.
"""

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import MetaData, null
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from vnibb.api.v1.equity import router
from vnibb.core.database import get_db
from vnibb.models.financials import BalanceSheet, IncomeStatement


def lineage(overrides=None):
    """What the pipeline persists beside an admitted annual/quarter row."""
    payload = {
        "source": "vietcap",
        "currency": "VND",
        "value_unit": "VND",
        "consolidation_basis": "consolidated",
        "flow_basis": "annual",
        "unit_metadata": {
            "revenue": {"source_unit": "VND", "value_unit": "VND"},
            "net_income": {"source_unit": "VND", "value_unit": "VND"},
            "eps": {"source_unit": "VND", "value_unit": "VND/share"},
            "ebitda": {"source_unit": "VND", "value_unit": "VND"},
            "total_assets": {"source_unit": "VND", "value_unit": "VND"},
        },
    }
    payload.update(overrides or {})
    return {"_financial_lineage": payload}


def quarter_lineage(overrides=None):
    payload = {"flow_basis": "single_quarter"}
    payload.update(overrides or {})
    return lineage(payload)


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


def admitted_annual(year, value, source, *, unit="VND", consolidation="consolidated"):
    raw = lineage({
        "currency": unit, "value_unit": unit, "consolidation_basis": consolidation,
        "unit_metadata": {
            field: {"source_unit": unit, "value_unit": "VND/share" if field == "eps" else unit}
            for field in ("revenue", "net_income", "eps", "ebitda", "total_assets")
        },
    })
    return [
        IncomeStatement(id=year, symbol="FPT", period=str(year), period_type="year",
                        fiscal_year=year, source=source, revenue=value, net_income=value,
                        eps=value, ebitda=value, raw_data=raw),
        BalanceSheet(id=year, symbol="FPT", period=str(year), period_type="year",
                     fiscal_year=year, source=source, total_assets=value, raw_data=raw),
        IncomeStatement(id=year + 10000, symbol="FPT", period=f"Q4-{year}",
                        period_type="quarter", fiscal_year=year, fiscal_quarter=4,
                        source=source, revenue=value, net_income=value, eps=value, ebitda=value,
                        raw_data=quarter_lineage()),
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize("source", [None, "vietcap"])
async def test_growth_skips_newer_issuer_rows_before_limits(growth_client, source):
    db, client = growth_client
    eligible_source = null() if source is None else source
    db.add_all(admitted_annual(2024, 100, eligible_source))
    db.add_all(admitted_annual(2025, 150, eligible_source))
    db.add_all(admitted_annual(2026, 999, "issuer_report"))
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
    # Assets now report their comparison basis like every other metric.
    asset_detail = data["comparisons"]["yoy"]["asset_growth"]
    assert (asset_detail["basis_status"], asset_detail["value_unit"]) == ("confirmed", "VND")


@pytest.mark.asyncio
@pytest.mark.parametrize("source", [None, "vietcap"])
async def test_growth_withholds_issuer_previous_quarter(growth_client, source):
    db, client = growth_client
    db.add_all([
        IncomeStatement(id=1, symbol="FPT", period="Q4-2024", period_type="quarter",
                        fiscal_year=2024, fiscal_quarter=4, source="issuer_report", revenue=100),
        IncomeStatement(id=2, symbol="FPT", period="Q4-2025", period_type="quarter",
                        fiscal_year=2025, fiscal_quarter=4,
                        source=null() if source is None else source, revenue=150,
                        raw_data=quarter_lineage()),
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
    assert detail["unavailable_reason"] == "missing_comparison_period"


@pytest.mark.asyncio
@pytest.mark.parametrize("source", [None, "vietcap"])
async def test_growth_selects_eligible_previous_quarter_before_limit(growth_client, source):
    db, client = growth_client
    eligible_source = null() if source is None else source
    db.add_all([
        IncomeStatement(id=1, symbol="FPT", period="Q4-2024", period_type="quarter",
                        fiscal_year=2024, fiscal_quarter=4, source="issuer_report", revenue=999),
        IncomeStatement(id=2, symbol="FPT", period="2024-Q4", period_type="quarter",
                        fiscal_year=2024, fiscal_quarter=4, source=eligible_source, revenue=100,
                        raw_data=quarter_lineage()),
        IncomeStatement(id=3, symbol="FPT", period="Q4-2025", period_type="quarter",
                        fiscal_year=2025, fiscal_quarter=4, source=eligible_source, revenue=150,
                        raw_data=quarter_lineage()),
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


@pytest.mark.asyncio
async def test_growth_withholds_rates_from_unknown_unit_rows(growth_client):
    """The reproduction from #246: a lineage dict of `unknown` values is not a basis."""
    db, client = growth_client
    unknown = lineage({
        "currency": "unknown", "value_unit": "unknown", "consolidation_basis": "unknown",
        "flow_basis": "unknown", "unit_metadata": {},
    })
    for year, value in ((2024, 100), (2025, 200)):
        db.add(IncomeStatement(id=year, symbol="QAZ", period=str(year), period_type="year",
                               fiscal_year=year, source="vietcap", revenue=value,
                               net_income=value, eps=value, ebitda=value, raw_data=unknown))
        db.add(BalanceSheet(id=year, symbol="QAZ", period=str(year), period_type="year",
                            fiscal_year=year, source="vietcap", total_assets=value, raw_data=unknown))
    await db.commit()

    response = await client.get("/equity/QAZ/growth")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["yoy"] == dict.fromkeys(data["yoy"], None)
    detail = data["comparisons"]["yoy"]["revenue_growth"]
    assert detail["basis_status"] == "unconfirmed"
    assert detail["unavailable_reason"] == "unverified_statement_currency_or_unit"
    assert detail["value_unit"] == "unknown"
    assert detail["current"] is None
    # Asset growth is held to the same contract, not published with no metadata.
    assert data["comparisons"]["yoy"]["asset_growth"]["unavailable_reason"] == (
        "unverified_statement_currency_or_unit"
    )


@pytest.mark.asyncio
async def test_growth_withholds_rates_with_incompatible_scale(growth_client):
    db, client = growth_client
    db.add_all([
        IncomeStatement(id=1, symbol="QAZ", period="2024", period_type="year", fiscal_year=2024,
                        source="vietcap", revenue=100, raw_data=lineage({"value_unit": "million_VND"})),
        IncomeStatement(id=2, symbol="QAZ", period="2025", period_type="year", fiscal_year=2025,
                        source="vietcap", revenue=200, raw_data=lineage()),
    ])
    await db.commit()

    data = (await client.get("/equity/QAZ/growth")).json()["data"]
    assert data["yoy"]["revenue_growth"] is None
    assert data["comparisons"]["yoy"]["revenue_growth"]["unavailable_reason"] == (
        "unverified_statement_currency_or_unit"
    )


@pytest.mark.asyncio
async def test_growth_keeps_loss_and_zero_base_conventions(growth_client):
    db, client = growth_client
    db.add_all([
        IncomeStatement(id=1, symbol="QAZ", period="2024", period_type="year", fiscal_year=2024,
                        source="vietcap", revenue=0, net_income=-100, raw_data=lineage()),
        IncomeStatement(id=2, symbol="QAZ", period="2025", period_type="year", fiscal_year=2025,
                        source="vietcap", revenue=50, net_income=100, raw_data=lineage()),
    ])
    await db.commit()

    data = (await client.get("/equity/QAZ/growth")).json()["data"]
    # A zero revenue base is not a rate; a loss base keeps the absolute-denominator
    # convention and is labelled with its transition.
    assert data["comparisons"]["yoy"]["revenue_growth"]["unavailable_reason"] == "zero_base"
    assert data["comparisons"]["yoy"]["earnings_growth"]["value"] == 200
    assert data["comparisons"]["yoy"]["earnings_growth"]["transition"] == "loss_to_profit"
    assert data["yoy"]["earnings_growth"] == 200


@pytest.mark.asyncio
async def test_growth_withholds_a_rejected_field(growth_client):
    db, client = growth_client
    rejected = lineage({
        "unit_metadata": {
            "revenue": {"unavailable_reason": "unverified_statement_currency_or_unit"},
            "net_income": {"source_unit": "VND", "value_unit": "VND"},
        },
    })
    db.add_all([
        IncomeStatement(id=1, symbol="QAZ", period="2024", period_type="year", fiscal_year=2024,
                        source="vietcap", revenue=100, net_income=50, raw_data=lineage()),
        IncomeStatement(id=2, symbol="QAZ", period="2025", period_type="year", fiscal_year=2025,
                        source="vietcap", revenue=200, net_income=60, raw_data=rejected),
    ])
    await db.commit()

    data = (await client.get("/equity/QAZ/growth")).json()["data"]
    revenue = data["comparisons"]["yoy"]["revenue_growth"]
    assert revenue["unavailable_reason"] == "rejected_field"
    assert revenue["field_unavailable_reason"]["current"] == "rejected:unverified_statement_currency_or_unit"
    # The admitted sibling metric still publishes its own rate.
    assert data["yoy"]["earnings_growth"] == 20
