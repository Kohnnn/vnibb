import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import BackgroundTasks
from sqlalchemy import select
from vnibb.api.v1 import data_sync, equity
from vnibb.models.financials import IncomeStatement
from vnibb.providers.vnstock.balance_sheet import BalanceSheetData
from vnibb.providers.vnstock.cash_flow import CashFlowData
from vnibb.providers.vnstock.financial_ratios import FinancialRatioData
from vnibb.providers.vnstock.financials import FinancialStatementData
from vnibb.providers.vnstock.income_statement import IncomeStatementData
from vnibb.services.cache_manager import CacheManager


@pytest.mark.asyncio
@pytest.mark.parametrize("period,expected", [("FY", ["2024"]), ("Q1", ["Q1-2024"])])
async def test_iq_statements_keep_provenance_without_legacy_transform(monkeypatch, period, expected):
    row = IncomeStatementData(
        symbol="VNM", period=expected[0], revenue=1200, profit_before_tax=150, eps_diluted=1507,
        source="vietcap", fiscal_year=2024, fiscal_quarter=1 if period == "Q1" else None,
        value_unit="VND", raw_data={"descriptors": [{"field": "opaque"}]},
        unit_metadata={"revenue": {"unit": "VND", "descriptor": "opaque"}},
    )
    loader = AsyncMock(return_value=[row])
    legacy = AsyncMock(side_effect=AssertionError("legacy Mongo reader used"))
    monkeypatch.setattr("vnibb.services.vietcap_financials.load_vietcap_financial_rows", loader)
    monkeypatch.setattr(equity, "get_mongo_market_data_service", lambda: SimpleNamespace(enabled=True, get_raw_dataset_records_precise=legacy))
    monkeypatch.setattr(equity.VnstockFinancialsFetcher, "transform_data", lambda *args: pytest.fail("IQ transformed as Vnstock"))
    rows = await equity._load_mongo_financial_statement_rows("VNM", "income", period, 10)
    assert [item.period for item in rows] == expected
    assert rows[0].source == "vietcap"
    assert rows[0].raw_data == row.raw_data
    assert rows[0].unit_metadata == row.unit_metadata
    assert rows[0].fiscal_year == 2024
    assert rows[0].pre_tax_profit == 150
    assert rows[0].eps_diluted == 1507
    loader.assert_awaited_once_with("VNM", "finance.income_statement", "quarter" if period == "Q1" else "year", limit=80, records=None)
    legacy.assert_not_awaited()


@pytest.mark.asyncio
async def test_iq_ttm_does_not_invent_quarter_basis(monkeypatch):
    rows = [IncomeStatementData(symbol="VNM", period=f"Q{quarter}-2024", revenue=100,
        source="vietcap", value_unit="VND", fiscal_year=2024, fiscal_quarter=quarter)
        for quarter in range(1, 5)]
    monkeypatch.setattr("vnibb.services.vietcap_financials.load_vietcap_financial_rows", AsyncMock(return_value=rows))
    monkeypatch.setattr(equity, "get_mongo_market_data_service", lambda: SimpleNamespace(enabled=True))
    result = await equity._load_mongo_financial_statement_rows("VNM", "income", "TTM", 10)
    assert result[0].revenue is None
    assert result[0].unavailable_reason == "unknown_quarterly_flow_basis"


@pytest.mark.asyncio
@pytest.mark.parametrize("source", ["KBS", "TCBS", "vnstock_data", "vietcap", ""])
async def test_legacy_financial_fallback_requires_vci_provenance(monkeypatch, source):
    monkeypatch.setattr("vnibb.services.vietcap_financials.load_vietcap_financial_rows", AsyncMock(return_value=[]))
    records = AsyncMock(return_value=[{"source": source, "raw": {"yearReport": 2024, "revenue": 900, "pe": 10}}])
    monkeypatch.setattr(equity, "get_mongo_market_data_service", lambda: SimpleNamespace(enabled=True, get_raw_dataset_records_precise=records))
    assert await equity._load_mongo_financial_statement_rows("VNM", "income", "year", 10) == []
    assert await equity._load_mongo_financial_ratio_rows("VNM", "year") == []


@pytest.mark.asyncio
async def test_iq_ratio_filter_preserves_certified_units(monkeypatch):
    evidence = [{"source": "vietcap", "fields": {"roe": {"unit": "percent"}}}]
    rows = [FinancialRatioData(symbol="VNM", period=f"Q{quarter}-2024", roe=0.25,
        ratio_units={"roe": "percent"}, provider_evidence=evidence) for quarter in (1, 2)]
    monkeypatch.setattr("vnibb.services.vietcap_financials.load_vietcap_financial_rows", AsyncMock(return_value=rows))
    monkeypatch.setattr(equity, "get_mongo_market_data_service", lambda: SimpleNamespace(enabled=True))
    result = await equity._load_mongo_financial_ratio_rows("VNM", "Q1")
    assert [row.period for row in result] == ["Q1-2024"]
    assert result[0].roe == 0.25
    assert result[0].provider_evidence == evidence
    assert await equity._load_mongo_financial_ratio_rows("VNM", "TTM") == []


@pytest.mark.asyncio
async def test_statement_endpoint_does_not_fetch_vci_when_iq_available(monkeypatch):
    rows = [FinancialStatementData(symbol="VNM", period="2024", statement_type="income", revenue=100, source="vietcap")]
    monkeypatch.setattr(equity, "_get_model_last_updated", AsyncMock(return_value=None))
    monkeypatch.setattr(equity, "_load_mongo_financial_statement_rows", AsyncMock(return_value=rows))
    fallback = AsyncMock(side_effect=AssertionError("VCI called before IQ exhausted"))
    monkeypatch.setattr(equity, "get_financials_with_ttm", fallback)
    response = await equity.get_financials("VNM", "income", "FY", 10, db=None)
    assert response.data == rows
    fallback.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("primary_failure", [False, True])
async def test_statement_endpoint_falls_back_on_empty_or_failed_iq(monkeypatch, primary_failure):
    row = FinancialStatementData(symbol="VNM", period="2024", statement_type="balance", total_assets=100, source="VCI")
    monkeypatch.setattr(equity, "_get_model_last_updated", AsyncMock(return_value=None))
    iq_client = SimpleNamespace(get_company_details=Mock(side_effect=RuntimeError("IQ unavailable")))
    monkeypatch.setattr(equity, "VietcapClient", lambda: iq_client)
    monkeypatch.setattr(equity, "_load_mongo_financial_statement_rows", AsyncMock(side_effect=RuntimeError("Mongo unavailable") if primary_failure else None, return_value=[]))
    fallback = AsyncMock(return_value=[row])
    monkeypatch.setattr(equity, "get_financials_with_ttm", fallback)
    monkeypatch.setattr(equity, "_load_financial_statement_fallback", AsyncMock(return_value=[]))
    response = await equity.get_financials("VNM", "balance", "year", 10, db=None)
    assert response.data[0].total_assets == 100
    assert "IQ unavailable" in response.error
    assert ("Mongo unavailable" in response.error) == primary_failure
    fallback.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize("stored_read_failure", [False, True])
async def test_empty_store_financials_http_acquires_actual_iq_eps_before_vci(
    client, test_db, monkeypatch, stored_read_failure,
):
    assert (await test_db.execute(select(IncomeStatement))).scalars().all() == []
    sections = {
        "INCOME_STATEMENT": [
            {"field": "opaque_eps", "name": "EPS", "parent": None, "fullTitleEn": "EPS basic (VND)"},
            {"field": "opaque_revenue", "name": "SALES", "parent": None, "fullTitleEn": "Net sales"},
        ],
        "BALANCE_SHEET": [{"field": "opaque_assets", "name": "ASSETS", "parent": None, "fullTitleEn": "Total assets"}],
        "CASH_FLOW": [{"field": "opaque_cash", "name": "CASH", "parent": None, "fullTitleEn": "Net cash from operating activities"}],
    }
    iq = SimpleNamespace(
        get_company_details=Mock(return_value={"comTypeCode": "CT"}),
        get_financial_metrics_map=Mock(return_value=sections),
        get_company_search_bar=Mock(side_effect=AssertionError("Broad company listing must not run")),
        get_statistics_financial=Mock(side_effect=RuntimeError("ratios unavailable")),
    )

    def statement(symbol, section):
        assert symbol == "VNM"
        if section == "BALANCE_SHEET":
            raise RuntimeError("balance unavailable")
        if section == "CASH_FLOW":
            return {"years": [{"yearReport": 2025, "lengthReport": 5, "opaque_cash": 25, "unit": "VND"}]}
        return {"years": [{"yearReport": 2025, "lengthReport": 5, "opaque_eps": 4321, "opaque_revenue": 900}]}

    iq.get_financial_statement = Mock(side_effect=statement)
    precise = AsyncMock(side_effect=RuntimeError("Mongo unavailable") if stored_read_failure else None, return_value=[])
    mongo = {name: SimpleNamespace(bulk_write=Mock()) for name in (
        "market_financial_metric_map", "market_vnstock_premium_records",
    )}
    service = SimpleNamespace(enabled=stored_read_failure, get_raw_dataset_records_precise=precise, _get_database=lambda: mongo)
    monkeypatch.setattr(equity, "get_mongo_market_data_service", lambda: service)
    monkeypatch.setattr("vnibb.services.mongo_market_data_service.get_mongo_market_data_service", lambda: service)
    monkeypatch.setattr(equity, "VietcapClient", lambda: iq)
    # Capture only the SQL boundary; acquisition, decoding, grouping and serving remain real.
    stored = AsyncMock(return_value=1)
    monkeypatch.setattr(CacheManager, "_store_rows", stored)
    vci = AsyncMock(side_effect=AssertionError("VCI must not replace acquired IQ data"))
    monkeypatch.setattr(equity, "get_financials_with_ttm", vci)

    response = await client.get("/api/v1/equity/vnm/financials?statement_type=income&period=FY&limit=1")

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["count"] == 1
    row = payload["data"][0]
    assert (row["symbol"], row["period"], row["source"], row["eps"]) == ("VNM", "2025", "vietcap", 4321)
    assert row["revenue"] is None
    assert row["unit_metadata"]["eps"]["unit"] == "VND/share"
    assert row["raw_data"]["structured"]["unavailable"]["revenue"] == "unit_unverified"
    assert row["raw_data"]["descriptors"] == sections["INCOME_STATEMENT"]
    assert "balance unavailable" in payload["error"]
    assert "ratios unavailable" in payload["error"]
    assert ("Mongo unavailable" in payload["error"]) == stored_read_failure
    assert stored.await_count == 2
    income_write = next(call for call in stored.await_args_list if call.args[0] is IncomeStatement)
    assert income_write.args[1][0]["eps"] == 4321
    assert income_write.args[1][0]["source"] == "vietcap"
    iq.get_company_details.assert_called_once_with("VNM")
    iq.get_financial_metrics_map.assert_called_once_with("VNM")
    assert iq.get_financial_statement.call_count == 3
    iq.get_company_search_bar.assert_not_called()
    vci.assert_not_awaited()


@pytest.mark.asyncio
async def test_empty_store_financial_acquisition_propagates_cancellation(monkeypatch):
    monkeypatch.setattr(equity, "_get_model_last_updated", AsyncMock(return_value=None))
    monkeypatch.setattr(equity, "_load_mongo_financial_statement_rows", AsyncMock(return_value=[]))
    iq = SimpleNamespace(get_company_details=Mock(side_effect=asyncio.CancelledError))
    monkeypatch.setattr(equity, "VietcapClient", lambda: iq)
    vci = AsyncMock()
    monkeypatch.setattr(equity, "get_financials_with_ttm", vci)
    with pytest.raises(asyncio.CancelledError):
        await equity.get_financials.__wrapped__("VNM", "income", "FY", 10, db=None)
    vci.assert_not_awaited()


@pytest.mark.asyncio
async def test_ratio_endpoint_does_not_fetch_vci_when_iq_available(monkeypatch, test_db):
    rows = [FinancialRatioData(symbol="VNM", period="2024", roe=0.25,
        ratio_units={"roe": "percent"}, provider_evidence=[{"source": "vietcap"}])]
    monkeypatch.setattr(equity, "_load_mongo_financial_ratio_rows", AsyncMock(return_value=rows))
    fallback = AsyncMock(side_effect=AssertionError("VCI called before IQ exhausted"))
    monkeypatch.setattr(equity.VnstockFinancialRatiosFetcher, "fetch", fallback)
    response = await equity.get_financial_ratios.__wrapped__("VNM", "year", test_db)
    assert response.data == rows
    fallback.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("summary,status", [
    ({"failures": 0, "primary_failures": 0, "rows": 0}, "success"),
    ({"failures": 1, "primary_failures": 0, "rows": 0}, "failed"),
    ({"failures": 1, "primary_failures": 0, "rows": 10}, "degraded"),
    ({"failures": 0, "primary_failures": 1, "rows": 10, "fallbacks": 1}, "degraded"),
])
async def test_mongo_sync_reports_truthful_outcome(monkeypatch, summary, status):
    summary = {"symbols": 1, **summary}
    monkeypatch.setattr("vnibb.services.mongo_eod_sync.run_mongo_eod_sync", AsyncMock(return_value=summary))
    response = await data_sync.sync_mongo_eod(BackgroundTasks(), window_days=7, async_mode=False)
    assert response.status == status
    assert response.count == summary["rows"]
    assert f"{summary['primary_failures']} primary failures" in response.message

@pytest.mark.asyncio
@pytest.mark.parametrize("primary_failure", [False, True])
async def test_ratio_endpoint_falls_back_on_empty_or_failed_iq(monkeypatch, test_db, primary_failure):
    rows = [FinancialRatioData(symbol="VNM", period="2024", pe=10)]
    monkeypatch.setattr(equity, "_load_mongo_financial_ratio_rows", AsyncMock(
        side_effect=RuntimeError("Mongo unavailable") if primary_failure else None, return_value=[]))
    monkeypatch.setattr(equity, "_get_latest_statement_period_key", AsyncMock(return_value=0))
    async def unchanged(**kwargs):
        return kwargs["rows"]
    monkeypatch.setattr(equity, "_enrich_missing_ratio_metrics", unchanged)
    fallback = AsyncMock(return_value=rows)
    monkeypatch.setattr(equity.VnstockFinancialRatiosFetcher, "fetch", fallback)
    response = await equity.get_financial_ratios.__wrapped__("VNM", "year", test_db)
    assert response.data[0].pe == 10
    assert bool(response.error) == primary_failure
    fallback.assert_awaited_once()


@pytest.mark.asyncio
async def test_iq_reader_error_remains_a_failure_not_empty_dataset(monkeypatch):
    monkeypatch.setattr("vnibb.services.vietcap_financials.load_vietcap_financial_rows", AsyncMock(side_effect=RuntimeError("Mongo unavailable")))
    monkeypatch.setattr(equity, "get_mongo_market_data_service", lambda: SimpleNamespace(enabled=True))
    with pytest.raises(RuntimeError, match="Mongo unavailable"):
        await equity._load_mongo_financial_statement_rows("VNM", "income", "year", 10)
    with pytest.raises(RuntimeError, match="Mongo unavailable"):
        await equity._load_mongo_financial_ratio_rows("VNM", "year")


@pytest.mark.parametrize("model,values", [
    (IncomeStatementData, {"revenue": 100}),
    (BalanceSheetData, {"equity": 100}),
    (CashFlowData, {"operating_cash_flow": 100}),
])
def test_existing_statement_models_retain_iq_descriptor_and_fiscal_provenance(model, values):
    provenance = {"source": "vietcap", "raw_data": {"descriptors": [{"field": "opaque"}]},
        "fiscal_year": 2024, "fiscal_quarter": 1, "value_unit": "VND",
        "unit_metadata": {next(iter(values)): {"unit": "VND"}},
        "flow_basis": None, "consolidation_basis": None}
    payload = model(symbol="VNM", period="Q1-2024", **values, **provenance).model_dump()
    assert {key: payload[key] for key in provenance} == provenance
