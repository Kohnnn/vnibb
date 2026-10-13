"""IQ descriptor admission survives real SQL storage and the public MCP ratio tool."""

from copy import deepcopy

import pytest
from sqlalchemy import BigInteger, Integer, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from vnibb.mcp import server
from vnibb.models.trading import FinancialRatio
from vnibb.services.cache_manager import CacheManager
from vnibb.services.vietcap_financials import (
    decode_vietcap_financial_record,
    persist_vietcap_financials,
)


@pytest.fixture(autouse=True)
async def portable_ratio_primary_key(setup_tables, test_engine):
    if test_engine.dialect.name != "sqlite":
        return

    def recreate_table(connection):
        table = FinancialRatio.__table__
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
@pytest.mark.parametrize("unit", ["percent", "%", None, "unknown"])
async def test_iq_ratio_decode_sql_public_mcp_preserves_admitted_units(
    monkeypatch, test_engine, test_db, value, unit
):
    envelope = ratio_envelope(value, unit)
    original = deepcopy(envelope)
    decoded = decode_vietcap_financial_record(envelope)
    admitted = unit in {"percent", "%"}
    expected_units = {"eps": "VND/share", "pe": "ratio"}
    if admitted:
        expected_units["roe"] = "percent"
    else:
        assert "roe" not in decoded["values"]
        assert decoded["unavailable"]["roe"] == "unit_unverified"
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
    assert result["item"]["roe"] == (value if admitted else None)
    assert result["item"]["eps"] == 4200.0
    assert result["item"]["pe_ratio"] == 12.5
    assert result["item"]["raw_data"] == expected_raw_data
    stored = (await test_db.execute(select(FinancialRatio))).scalar_one()
    assert stored.roe == (value if admitted else None)
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
