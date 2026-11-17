from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from vnibb.api.v1 import equity
from vnibb.providers.vnstock.financials import FinancialStatementData


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["iq_read", "iq_acquisition", "comparison", "provider", "both"])
@pytest.mark.parametrize("retained", [False, True])
async def test_financial_http_hides_source_errors_and_preserves_available_rows(
    client, monkeypatch, caplog, failure, retained,
):
    sentinel = "SYNTHETIC_FINANCIAL_INSTALLER_SECRET"
    row = FinancialStatementData(
        symbol="VNM", period="2024", fiscal_year=2024, statement_type="balance",
        source="vietcap" if failure == "comparison" else "VCI", currency="VND",
        value_unit="VND", consolidation_basis="consolidated", total_assets=100,
        unit_metadata={"total_assets": {"source_unit": "VND", "value_unit": "VND"}},
    )
    iq_rows = [row] if failure == "comparison" else []
    monkeypatch.setattr(equity, "_load_mongo_financial_statement_rows", AsyncMock(
        side_effect=RuntimeError(sentinel) if failure in {"iq_read", "both"} else None,
        return_value=iq_rows,
    ))
    client_error = sentinel if failure == "iq_acquisition" else "synthetic IQ unavailable"
    iq_client = SimpleNamespace(get_company_details=Mock(side_effect=RuntimeError(client_error)))
    monkeypatch.setattr(equity, "VietcapClient", lambda: iq_client)
    monkeypatch.setattr(equity, "get_mongo_market_data_service", lambda: SimpleNamespace(enabled=False))
    monkeypatch.setattr(equity, "get_financials_with_ttm", AsyncMock(
        side_effect=RuntimeError(sentinel) if failure in {"provider", "both"} else None,
        return_value=[],
    ))
    monkeypatch.setattr(equity, "_load_financial_statement_fallback", AsyncMock(
        side_effect=RuntimeError(sentinel) if failure == "comparison" else None,
        return_value=[row] if retained else [],
    ))

    response = await client.get("/api/v1/equity/VNM/financials?statement_type=balance&period=year")

    assert response.status_code == 200
    assert sentinel not in response.text
    payload = response.json()
    assert payload["error"]
    expected_count = 1 if retained or failure == "comparison" else 0
    assert payload["meta"]["count"] == expected_count
    assert len(payload["data"]) == expected_count
    if expected_count:
        result = payload["data"][0]
        assert result["period"] == "2024"
        assert result["source"] == row.source
        if failure == "comparison":
            assert result["total_assets"] is None
            assert result["unavailable_reason"] == "financial_source_comparison_unavailable"
        else:
            assert result["total_assets"] == 100
            assert result["unit_metadata"]["total_assets"]["source_unit"] == "VND"
    assert any(sentinel in record.getMessage() for record in caplog.records)
