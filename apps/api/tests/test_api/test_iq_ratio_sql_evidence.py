"""IQ descriptor admission survives real SQL storage and the public MCP ratio tool."""

from copy import deepcopy

import pytest
from sqlalchemy import BigInteger, Integer, select
from sqlalchemy.ext.asyncio import async_sessionmaker
from vnibb.mcp import server
from vnibb.models.financials import IncomeStatement
from vnibb.models.trading import FinancialRatio
from vnibb.services.cache_manager import CacheManager
from vnibb.services.vietcap_financials import (
    StructuredFinancialUnavailable,
    decode_vietcap_financial_record,
    persist_vietcap_financials,
)


@pytest.fixture(autouse=True)
async def portable_ratio_primary_key(setup_tables, test_engine):
    if test_engine.dialect.name != "sqlite":
        return

    def recreate_table(connection):
        for table in (FinancialRatio.__table__, IncomeStatement.__table__):
            table.drop(connection)
            original_type = table.c.id.type
            table.c.id.type = BigInteger().with_variant(Integer, "sqlite")
            try:
                table.create(connection)
            finally:
                table.c.id.type = original_type

    async with test_engine.begin() as connection:
        await connection.run_sync(recreate_table)


def ratio_envelope(value, unit):
    roe_descriptor = {
        "field": "reported_return", "parent": None, "fullTitleEn": "Return on equity",
    }
    if unit is not None:
        roe_descriptor["unit"] = unit
    return {
        "symbol": "FPT", "dataset": "finance.ratio", "datasetVariant": "finance.ratio.year",
        "source": "vietcap", "providerSource": "vietcap", "comTypeCode": "CT",
        "recordKey": "FPT:finance.ratio.year:2025",
        "receivedAt": "2026-10-13T01:00:00Z", "observedAt": "2026-10-13T01:00:00Z",
        "rawFiscalBasis": {"year": 2025, "quarter": 5},
        "raw": {
            "year": 2025, "quarter": 5, "ratioType": "RATIO_YEAR",
            "reported_return": value, "reported_eps": 4200, "reported_pe": 12.5,
        },
        "descriptors": [
            roe_descriptor,
            {"field": "reported_eps", "parent": None, "fullTitleEn": "EPS basic (VND)", "unit": "VND/share"},
            {"field": "reported_pe", "parent": None, "fullTitleEn": "P/E", "unit": "times"},
        ],
        "descriptorEvidence": {
            "symbol": "FPT", "section": "RATIO", "comTypeCode": "CT", "source": "vietcap",
            "endpoint": "/v1/company/FPT/financial-statement/metrics",
            "receivedAt": "2026-10-13T01:00:00Z",
        },
    }


@pytest.mark.asyncio
@pytest.mark.parametrize("value", [0.25, 25.0])
@pytest.mark.parametrize("unit", ["percent", "%", None, "unknown", "ratio", "times", "fraction"])
@pytest.mark.parametrize("metric, column, title", [
    ("roe", "roe", "Return on equity"),
    ("debt_assets", "debt_to_assets", "Debt to assets"),
])
async def test_iq_ratio_decode_sql_public_mcp_preserves_admitted_units(
    monkeypatch, test_engine, test_db, value, unit, metric, column, title
):
    envelope = ratio_envelope(value, unit)
    envelope["descriptors"][0]["fullTitleEn"] = title
    original = deepcopy(envelope)
    decoded = decode_vietcap_financial_record(envelope)
    admitted = unit in {"percent", "%"}
    expected_units = {"eps": "VND/share", "pe": "ratio"}
    if admitted:
        expected_units[metric] = "percent"
    else:
        assert metric not in decoded["values"]
        assert decoded["unavailable"][metric] == "unit_unverified"
    expected_raw_data = {**original, "structured": decoded, "ratio_units": expected_units}

    assert await persist_vietcap_financials(
        [envelope], cache_manager=CacheManager(db=test_db)
    ) == 1
    monkeypatch.setattr(
        server, "async_session_maker", async_sessionmaker(test_engine, expire_on_commit=False)
    )

    async def database_available():
        return True

    monkeypatch.setattr(server, "check_database_connection", database_available)
    result = await server.get_latest_financial_ratios("FPT", period_type="year")

    assert result["found"] is True
    assert result["provider_source"] == "vietcap"
    assert result["item"][column] == (value if admitted else None)
    assert result["item"]["eps"] == 4200.0
    assert result["item"]["pe_ratio"] == 12.5
    assert result["item"]["raw_data"] == expected_raw_data
    stored = (await test_db.execute(select(FinancialRatio))).scalar_one()
    assert getattr(stored, column) == (value if admitted else None)
    assert stored.raw_data == expected_raw_data
    assert envelope == original


@pytest.mark.asyncio
async def test_prior_iq_structured_row_recovers_units_by_normal_reingestion(
    monkeypatch, test_engine, test_db
):
    envelope = ratio_envelope(0.25, "percent")
    decoded = decode_vietcap_financial_record(envelope)
    legacy_raw_data = {**deepcopy(envelope), "structured": decoded}
    test_db.add(FinancialRatio(
        symbol="FPT", period="2025", period_type="year", fiscal_year=2025,
        source="vietcap", roe=0.25, eps=4200.0, pe_ratio=12.5, raw_data=legacy_raw_data,
    ))
    await test_db.commit()
    monkeypatch.setattr(
        server, "async_session_maker", async_sessionmaker(test_engine, expire_on_commit=False)
    )

    async def database_available():
        return True

    monkeypatch.setattr(server, "check_database_connection", database_available)
    before = await server.get_latest_financial_ratios("FPT", period_type="year")
    assert before["item"]["roe"] is None
    assert before["item"]["raw_data"] == legacy_raw_data

    assert await persist_vietcap_financials(
        [envelope], cache_manager=CacheManager(db=test_db)
    ) == 1
    after = await server.get_latest_financial_ratios("FPT", period_type="year")

    assert after["item"]["roe"] == 0.25
    assert after["item"]["raw_data"]["ratio_units"]["roe"] == "percent"
    assert {key: value for key, value in after["item"]["raw_data"].items() if key != "ratio_units"} == legacy_raw_data


@pytest.mark.asyncio
@pytest.mark.parametrize("scope", ["verified", "wrong_symbol", "conflicting_unit", "unknown_unit"])
async def test_ratio_ingestion_scoped_response_survives_sql_and_public_mcp(
    monkeypatch, test_engine, test_db, scope
):
    from vnibb.services.vietcap_ingestion import upsert_ratio_rows

    envelope = ratio_envelope(0.25, None)
    response = {"receivedAt": envelope["receivedAt"], "unit": "percent", "traceId": "retained-trace"}
    records = []
    assert upsert_ratio_rows(
        None, "FPT", [envelope["raw"]], com_type="CT", descriptors=envelope["descriptors"],
        source_response=response, records=records, dry_run=True,
    ) == 1
    record = records[0]
    if scope == "wrong_symbol":
        record["responseEvidence"]["symbol"] = "VNM"
    elif scope == "conflicting_unit":
        record["raw"]["unit"] = "times"
    elif scope == "unknown_unit":
        response.pop("unit")
    # Keep independently certified fields available when response units cannot be used.
    if scope in {"verified", "conflicting_unit"}:
        record["descriptors"] = record["descriptors"][:1]
    if scope == "conflicting_unit":
        with pytest.raises(StructuredFinancialUnavailable):
            await persist_vietcap_financials([record], cache_manager=CacheManager(db=test_db))
        assert (await test_db.execute(select(FinancialRatio))).scalars().all() == []
        return
    assert await persist_vietcap_financials([record], cache_manager=CacheManager(db=test_db)) == 1
    monkeypatch.setattr(server, "async_session_maker", async_sessionmaker(test_engine, expire_on_commit=False))

    async def database_available():
        return True

    monkeypatch.setattr(server, "check_database_connection", database_available)
    result = await server.get_latest_financial_ratios("FPT", period_type="year")
    assert result["item"]["roe"] == (0.25 if scope == "verified" else None)
    assert result["item"]["raw_data"]["sourceResponse"] == response
    assert result["item"]["raw_data"]["descriptors"] == record["descriptors"]
    assert result["item"]["raw_data"]["responseEvidence"] == record["responseEvidence"]


@pytest.mark.asyncio
async def test_statement_ingestion_scoped_response_survives_sql_and_public_mcp(monkeypatch, test_engine, test_db):
    from vnibb.services.vietcap_ingestion import upsert_statement_periods

    received_at = "2026-10-13T01:00:00Z"
    response = {"receivedAt": received_at, "unit": "VND", "currency": "VND", "scale": 1_000_000,
                "flowBasis": "single_quarter", "consolidationBasis": "consolidated", "traceId": "retained-statement"}
    raw = {"yearReport": 2025, "lengthReport": 2, "reported_sales": 12}
    descriptors = [{"field": "reported_sales", "parent": None, "fullTitleEn": "Net sales"}]
    records = []
    assert upsert_statement_periods(
        None, "FPT", "finance.income_statement", "INCOME_STATEMENT", {"quarters": [raw]},
        com_type="CT", descriptors=descriptors, source_response=response,
        records=records, dry_run=True,
    ) == 1
    assert records[0]["structured"]["values"] == {"revenue": 12_000_000}
    assert await persist_vietcap_financials(records, cache_manager=CacheManager(db=test_db)) == 1
    monkeypatch.setattr(server, "async_session_maker", async_sessionmaker(test_engine, expire_on_commit=False))

    async def database_available():
        return True

    monkeypatch.setattr(server, "check_database_connection", database_available)
    result = await server.get_latest_financial_statement("FPT", statement="income_statement", period_type="quarter")
    assert result["found"] is True
    assert result["provider_source"] == "vietcap"
    assert result["item"]["revenue"] == 12_000_000
    stored_raw = result["item"]["raw_data"]
    assert stored_raw["raw"] == raw
    assert stored_raw["sourceResponse"] == response
    lineage = stored_raw["_financial_lineage"]
    assert lineage["flow_basis"] == "single_quarter"
    assert lineage["consolidation_basis"] == "consolidated"
    assert lineage["unit_metadata"]["revenue"]["unitEvidence"]["responses"][0]["metadata"] == response


@pytest.mark.asyncio
@pytest.mark.parametrize("year,quarter,value,unit,scale,admitted", [
    (2025, None, 5216, None, None, True),
    (2026, 2, 1507, None, None, True),
    (2026, 2, 0, None, None, True),
    (2026, 2, 1507, "unknown", None, False),
    (2026, 2, 1507, "VND", 1_000_000, False),
    (2026, 2, 1507, "million VND", None, False),
    (2026, 2, 1507, "VND/share", 1_000_000, False),
])
async def test_diluted_eps_decode_sql_public_mcp_preserves_per_share_evidence(
    monkeypatch, test_engine, test_db, year, quarter, value, unit, scale, admitted
):
    from vnibb.services.vietcap_financials import load_vietcap_financial_rows
    from vnibb.services.vietcap_ingestion import upsert_statement_periods

    period_type = "quarter" if quarter else "year"
    raw = {"yearReport": year, "lengthReport": quarter or 5, "isa24": value,
           "reported_basic": 42, "reported_sales": 900}
    diluted = {"level": 1, "parent": None, "titleEn": "EPS diluted (VND)",
               "fullTitleEn": "EPS diluted (VND)", "field": "isa24", "name": "ISA24"}
    if unit is not None:
        diluted["unit"] = unit
    if scale is not None:
        diluted["scale"] = scale
    descriptors = [diluted,
        {"field": "reported_basic", "parent": None, "fullTitleEn": "EPS basic (VND)"},
        {"field": "reported_sales", "parent": None, "fullTitleEn": "Net sales"}]
    records = []
    assert upsert_statement_periods(
        None, "FPT", "finance.income_statement", "INCOME_STATEMENT",
        {"quarters" if quarter else "years": [raw]}, com_type="CT", descriptors=descriptors,
        source_response={"receivedAt": "2026-10-13T01:00:00Z"}, records=records, dry_run=True,
    ) == 1
    envelope = records[0]
    original = deepcopy(envelope)
    decoded = decode_vietcap_financial_record(envelope)
    assert decoded["values"] == ({"eps": 42.0, "eps_diluted": value} if admitted else {"eps": 42.0})
    assert decoded["unavailable"]["revenue"] == "unit_unverified"
    evidence = decoded["fieldEvidence"]["eps_diluted"]
    assert evidence["rawValue"] == value
    assert evidence["unitEvidence"]["unitTitle"] == "EPS diluted (VND)"
    if admitted:
        assert evidence["unit"] == "VND/share"
    else:
        assert decoded["unavailable"]["eps_diluted"] == "unit_unverified"
    rows = await load_vietcap_financial_rows(
        "FPT", "finance.income_statement", period_type, records=records,
    )
    assert rows[0].eps_diluted == (value if admitted else None)
    assert rows[0].flow_basis is None
    assert rows[0].value_unit is None
    assert await persist_vietcap_financials(records, cache_manager=CacheManager(db=test_db)) == 1
    stored = (await test_db.execute(select(IncomeStatement))).scalar_one()
    assert stored.eps_diluted == (value if admitted else None)
    assert stored.revenue is None
    monkeypatch.setattr(server, "async_session_maker", async_sessionmaker(test_engine, expire_on_commit=False))

    async def database_available():
        return True

    monkeypatch.setattr(server, "check_database_connection", database_available)
    result = await server.get_latest_financial_statement("FPT", statement="income_statement", period_type=period_type)
    assert result["found"] is True
    assert result["provider_source"] == "vietcap"
    assert result["item"]["eps_diluted"] == (value if admitted else None)
    assert result["item"]["revenue"] is None
    stored_raw = result["item"]["raw_data"]
    assert stored_raw["raw"] == raw
    assert stored_raw["descriptors"] == descriptors
    assert stored_raw["descriptorEvidence"] == envelope["descriptorEvidence"]
    assert stored_raw["structured"] == decoded
    lineage = stored_raw["_financial_lineage"]
    assert lineage["canonical_data"]["eps_diluted"] == (value if admitted else None)
    assert lineage["canonical_data"]["value_unit"] is None
    assert lineage["unit_metadata"]["eps_diluted"] == evidence
    assert lineage["flow_basis"] is None
    assert lineage["consolidation_basis"] is None
    assert envelope == original
