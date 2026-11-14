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
from vnibb.providers.vnstock.financials import FinancialStatementData


def canonical(period, statement_type, *, fiscal_year, fiscal_quarter=None, source="vietcap",
              unit="VND", consolidation="consolidated", flow_basis="annual", **metrics):
    """A real persisted canonical envelope for one statement row."""
    # Seed only the numeric fields: every field present is "stated", so a
    # non-numeric field seeded with a number would fail validation instead of
    # modelling an envelope.
    numeric = {"int", "float", "Optional[int]", "Optional[float]"}
    fields = {
        name: 0.0 for name, info in FinancialStatementData.model_fields.items()
        if str(info.annotation) in numeric or info.annotation in (int, float)
    }
    fields.update(
        symbol="FPT", period=period, period_type="quarter" if fiscal_quarter else "year",
        statement_type=statement_type, fiscal_year=fiscal_year, fiscal_quarter=fiscal_quarter,
        source=source if isinstance(source, str) else None,
        currency=unit, value_unit=unit, consolidation_basis=consolidation,
        flow_basis=flow_basis, source_periods=[],
        unit_metadata={
            name: {"source_unit": unit, "value_unit": "VND/share" if name in {"eps", "eps_diluted"} else unit}
            for name in metrics
        },
        **metrics,
    )
    fields["raw_data"] = {}
    return fields


def lineage(envelope):
    """The lineage a persisted row keeps beside its canonical copy."""
    return {"_financial_lineage": {"canonical_data": envelope}}


def admitted_annual(year, value, source=None, *, unit="VND", consolidation="consolidated"):
    yoy_envelope = canonical(str(year), "income", fiscal_year=year, source=source,
                             unit=unit, consolidation=consolidation,
                             revenue=value, net_income=value, eps=value, ebitda=value)
    balance_envelope = canonical(str(year), "balance", fiscal_year=year, source=source,
                                 unit=unit, consolidation=consolidation, total_assets=value)
    quarter_envelope = canonical(f"Q4-{year}", "income", fiscal_year=year, fiscal_quarter=4,
                                 source=source, unit=unit, consolidation=consolidation,
                                 flow_basis="single_quarter",
                                 revenue=value, net_income=value, eps=value, ebitda=value)
    return [
        IncomeStatement(id=year, symbol="FPT", period=str(year), period_type="year",
                        fiscal_year=year, source=source, revenue=value, net_income=value,
                        eps=value, ebitda=value, raw_data=lineage(yoy_envelope)),
        BalanceSheet(id=year, symbol="FPT", period=str(year), period_type="year",
                     fiscal_year=year, source=source, total_assets=value,
                     raw_data=lineage(balance_envelope)),
        IncomeStatement(id=year + 10000, symbol="FPT", period=f"Q4-{year}",
                        period_type="quarter", fiscal_year=year, fiscal_quarter=4,
                        source=source, revenue=value, net_income=value, eps=value, ebitda=value,
                        raw_data=lineage(quarter_envelope)),
    ]


def quarter_row(row_id, period, year, quarter, value, source=None, **metrics):
    envelope = canonical(period, "income", fiscal_year=year, fiscal_quarter=quarter,
                         source=source, flow_basis="single_quarter", revenue=value, **metrics)
    return IncomeStatement(id=row_id, symbol="FPT", period=period, period_type="quarter",
                           fiscal_year=year, fiscal_quarter=quarter, source=source,
                           revenue=value, raw_data=lineage(envelope), **metrics)


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
    db.add_all(admitted_annual(2024, 100, eligible_source))
    db.add_all(admitted_annual(2025, 150, eligible_source))
    db.add_all(admitted_annual(2026, 999, "issuer_report"))
    await db.commit()

    response = await client.get("/equity/fpt/growth")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["as_of"] == {"annual": "2025", "quarter": "Q4-2025"}
    if source is None:
        # An absent source is not a shared identity: no rate may be published.
        assert all(value is None for value in data["yoy"].values())
        return
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
@pytest.mark.parametrize("source", ["vietcap"])
async def test_growth_withholds_issuer_previous_quarter(growth_client, source):
    db, client = growth_client
    db.add_all([
        IncomeStatement(id=1, symbol="FPT", period="Q4-2024", period_type="quarter",
                        fiscal_year=2024, fiscal_quarter=4, source="issuer_report", revenue=100),
        quarter_row(2, "Q4-2025", 2025, 4, 150, source=source),
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
@pytest.mark.parametrize("source", ["vietcap"])
async def test_growth_selects_eligible_previous_quarter_before_limit(growth_client, source):
    db, client = growth_client
    db.add_all([
        IncomeStatement(id=1, symbol="FPT", period="Q4-2024", period_type="quarter",
                        fiscal_year=2024, fiscal_quarter=4, source="issuer_report", revenue=999),
        quarter_row(2, "2024-Q4", 2024, 4, 100, source=source),
        quarter_row(3, "Q4-2025", 2025, 4, 150, source=source),
    ])
    await db.commit()

    response = await client.get("/equity/FPT/growth")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["qoq"]["revenue_growth"] == 50
    detail = data["comparisons"]["qoq"]["revenue_growth"]
    assert (detail["current"], detail["previous"], detail["previous_period"]) == (150, 100, "Q4-2024")


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
    for year, value in ((2024, 100), (2025, 200)):
        envelope = canonical(str(year), "income", fiscal_year=year, unit="unknown",
                             consolidation="unknown", flow_basis="unknown",
                             revenue=value, net_income=value, eps=value, ebitda=value)
        envelope["unit_metadata"] = {}
        db.add(IncomeStatement(id=year, symbol="QAZ", period=str(year), period_type="year",
                               fiscal_year=year, source="vietcap", revenue=value,
                               net_income=value, eps=value, ebitda=value,
                               raw_data=lineage(envelope)))
        balance_envelope = canonical(str(year), "balance", fiscal_year=year, unit="unknown",
                                     consolidation="unknown", total_assets=value)
        balance_envelope["unit_metadata"] = {}
        db.add(BalanceSheet(id=year, symbol="QAZ", period=str(year), period_type="year",
                            fiscal_year=year, source="vietcap", total_assets=value,
                            raw_data=lineage(balance_envelope)))
    await db.commit()

    response = await client.get("/equity/QAZ/growth")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["yoy"] == dict.fromkeys(data["yoy"], None)
    detail = data["comparisons"]["yoy"]["revenue_growth"]
    assert detail["basis_status"] == "unconfirmed"
    # The loader's own field rejection is what reaches the comparison now.
    assert detail["unavailable_reason"] == "rejected_field"
    assert detail["field_unavailable_reason"]["current"] == "rejected:unverified_statement_currency_or_unit"
    assert detail["value_unit"] == "unknown"
    assert detail["current"] is None
    # Asset growth is held to the same contract, not published with no metadata.
    assert data["comparisons"]["yoy"]["asset_growth"]["unavailable_reason"] == "rejected_field"


@pytest.mark.asyncio
async def test_growth_withholds_rates_with_incompatible_scale(growth_client):
    db, client = growth_client
    db.add_all([
        IncomeStatement(id=1, symbol="QAZ", period="2024", period_type="year", fiscal_year=2024,
                        source="vietcap", revenue=100,
                        raw_data=lineage(canonical("2024", "income", fiscal_year=2024,
                                                   unit="million VND", revenue=100))),
        IncomeStatement(id=2, symbol="QAZ", period="2025", period_type="year", fiscal_year=2025,
                        source="vietcap", revenue=200,
                        raw_data=lineage(canonical("2025", "income", fiscal_year=2025, revenue=200))),
    ])
    await db.commit()

    data = (await client.get("/equity/QAZ/growth")).json()["data"]
    assert data["yoy"]["revenue_growth"] is None
    assert data["comparisons"]["yoy"]["revenue_growth"]["unavailable_reason"] == "rejected_field"


@pytest.mark.asyncio
async def test_growth_keeps_loss_and_zero_base_conventions(growth_client):
    db, client = growth_client
    db.add_all([
        IncomeStatement(id=1, symbol="QAZ", period="2024", period_type="year", fiscal_year=2024,
                        source="vietcap", revenue=0, net_income=-100,
                        raw_data=lineage(canonical("2024", "income", fiscal_year=2024,
                                                   revenue=0, net_income=-100))),
        IncomeStatement(id=2, symbol="QAZ", period="2025", period_type="year", fiscal_year=2025,
                        source="vietcap", revenue=50, net_income=100,
                        raw_data=lineage(canonical("2025", "income", fiscal_year=2025,
                                                   revenue=50, net_income=100))),
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
    rejected_envelope = canonical("2025", "income", fiscal_year=2025, revenue=200, net_income=60)
    rejected_envelope["unit_metadata"]["revenue"] = {
        "unavailable_reason": "unverified_statement_currency_or_unit",
    }
    db.add_all([
        IncomeStatement(id=1, symbol="QAZ", period="2024", period_type="year", fiscal_year=2024,
                        source="vietcap", revenue=100, net_income=50,
                        raw_data=lineage(canonical("2024", "income", fiscal_year=2024,
                                                   revenue=100, net_income=50))),
        IncomeStatement(id=2, symbol="QAZ", period="2025", period_type="year", fiscal_year=2025,
                        source="vietcap", revenue=200, net_income=60,
                        raw_data=lineage(rejected_envelope)),
    ])
    await db.commit()

    data = (await client.get("/equity/QAZ/growth")).json()["data"]
    revenue = data["comparisons"]["yoy"]["revenue_growth"]
    assert revenue["unavailable_reason"] == "rejected_field"
    assert revenue["field_unavailable_reason"]["current"] == "rejected:unverified_statement_currency_or_unit"
    # The admitted sibling metric still publishes its own rate.
    assert data["yoy"]["earnings_growth"] == 20


@pytest.mark.asyncio
async def test_growth_withholds_a_row_whose_canonical_disagrees_with_its_column(growth_client):
    """#246/F1: a stored column may not override what its canonical proves."""
    db, client = growth_client
    # The canonical says revenue 100; the SQL column kept 200 from a later sync.
    db.add_all([
        IncomeStatement(id=1, symbol="QAZ", period="2024", period_type="year", fiscal_year=2024,
                        source="vietcap", revenue=100,
                        raw_data=lineage(canonical("2024", "income", fiscal_year=2024, revenue=100))),
        IncomeStatement(id=2, symbol="QAZ", period="2025", period_type="year", fiscal_year=2025,
                        source="vietcap", revenue=200,
                        raw_data=lineage(canonical("2025", "income", fiscal_year=2025, revenue=100))),
    ])
    await db.commit()

    data = (await client.get("/equity/QAZ/growth")).json()["data"]
    detail = data["comparisons"]["yoy"]["revenue_growth"]
    assert data["yoy"]["revenue_growth"] is None
    assert detail["current"] is None
    assert detail["field_unavailable_reason"]["current"].endswith(
        "stored_statement_disagrees_with_lineage"
    )


@pytest.mark.asyncio
async def test_growth_withholds_a_row_with_a_conflicting_fiscal_identity(growth_client):
    """A canonical for another fiscal year cannot be relabelled as this one."""
    db, client = growth_client
    mismatched = canonical("2024", "income", fiscal_year=2024, revenue=200)
    db.add_all([
        IncomeStatement(id=1, symbol="QAZ", period="2024", period_type="year", fiscal_year=2024,
                        source="vietcap", revenue=100,
                        raw_data=lineage(canonical("2024", "income", fiscal_year=2024, revenue=100))),
        IncomeStatement(id=2, symbol="QAZ", period="2025", period_type="year", fiscal_year=2025,
                        source="vietcap", revenue=200, raw_data=lineage(mismatched)),
    ])
    await db.commit()

    data = (await client.get("/equity/QAZ/growth")).json()["data"]
    detail = data["comparisons"]["yoy"]["revenue_growth"]
    assert data["yoy"]["revenue_growth"] is None
    assert detail["unavailable_reason"] in {"conflicting_fiscal_identity", "row_unavailable:conflicting_fiscal_identity"}
