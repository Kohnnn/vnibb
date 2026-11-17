from unittest.mock import AsyncMock

import pytest
from vnibb.api.v1 import equity
from vnibb.api.v1.schemas import StandardResponse
from vnibb.models.trading import FinancialRatio


@pytest.mark.asyncio
@pytest.mark.parametrize("endpoint", ["ratios", "financial-ratios", "fundamental-analysis"])
@pytest.mark.parametrize("failure", ["provider", "iq"])
@pytest.mark.parametrize("retained", [False, True])
async def test_ratio_http_hides_upstream_exception_and_retains_data(
    client, test_db, monkeypatch, caplog, endpoint, failure, retained,
):
    sentinel = "SYNTHETIC_INSTALLER_ENVIRONMENT_SECRET"
    is_aggregate = endpoint == "fundamental-analysis"
    period = "year" if is_aggregate else "quarter"
    period_label = "2025" if is_aggregate else "2025-Q1"
    evidence = {"source": "fixture", "trace": "retained-row"}
    if retained:
        test_db.add(FinancialRatio(
            id=1, symbol="VNM", period=period_label, period_type=period, fiscal_year=2025,
            fiscal_quarter=None if is_aggregate else 1, pe_ratio=12,
            raw_data={"provider_evidence": [evidence]},
        ))
        await test_db.commit()

    async def unchanged_ratios(**kwargs):
        return kwargs["rows"]

    monkeypatch.setattr(equity, "_load_mongo_financial_ratio_rows", AsyncMock(
        side_effect=RuntimeError(sentinel) if failure == "iq" else None,
        return_value=[],
    ))
    monkeypatch.setattr(equity, "_get_latest_statement_period_key", AsyncMock(return_value=20260))
    monkeypatch.setattr(equity, "_load_ratio_statement_support", AsyncMock(return_value={}))
    monkeypatch.setattr(equity, "_enrich_missing_ratio_metrics", unchanged_ratios)
    monkeypatch.setattr(equity, "_schedule_critical_reinforcement", AsyncMock())
    monkeypatch.setattr(equity.VnstockFinancialRatiosFetcher, "fetch", AsyncMock(
        side_effect=RuntimeError(sentinel) if failure == "provider" else None,
        return_value=[],
    ))
    if is_aggregate:
        for name in (
            "get_profile", "get_officers", "get_subsidiaries", "get_company_news",
            "get_financials", "get_shareholders", "get_company_events",
        ):
            monkeypatch.setattr(equity, name, AsyncMock(return_value=StandardResponse(data=[])))
        monkeypatch.setattr(equity, "_load_latest_fundamental_snapshot", AsyncMock(return_value=None))

    response = await client.get(f"/api/v1/equity/VNM/{endpoint}?period={period}")

    assert response.status_code == 200
    assert sentinel not in response.text
    payload = response.json()
    if is_aggregate:
        assert payload["error"]
        assert payload["data"]["section_errors"]["ratios"]
        rows = payload["data"]["ratios"]
    else:
        assert payload["error"]
        rows = payload["data"]
        if retained:
            assert payload["meta"]["count"] == 1
            assert payload["meta"]["data_points"] == 1
        else:
            assert payload["meta"] is None
    if retained:
        assert len(rows) == 1
        assert rows[0]["period"] == ("2025" if is_aggregate else "Q1-2025")
        assert rows[0]["pe"] == 12
        assert rows[0]["roe"] is None
        assert evidence in rows[0]["provider_evidence"]
    else:
        assert rows == []
    assert any(sentinel in record.getMessage() for record in caplog.records)


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", [RuntimeError, TimeoutError])
async def test_aggregate_hides_unexpected_ratio_sql_failure(
    client, test_db, monkeypatch, caplog, failure,
):
    sentinel = "SYNTHETIC_RATIO_SQL_SECRET"
    for name in (
        "get_profile", "get_officers", "get_subsidiaries", "get_company_news",
        "get_financials", "get_shareholders", "get_company_events",
    ):
        monkeypatch.setattr(equity, name, AsyncMock(return_value=StandardResponse(data=[])))
    monkeypatch.setattr(equity, "_load_latest_fundamental_snapshot", AsyncMock(return_value=None))
    monkeypatch.setattr(test_db, "execute", AsyncMock(side_effect=failure(sentinel)))

    response = await client.get("/api/v1/equity/VNM/fundamental-analysis")

    assert response.status_code == 200
    assert sentinel not in response.text
    payload = response.json()
    assert payload["error"]
    assert payload["data"]["ratios"] == []
    assert payload["data"]["section_errors"]["ratios"]
    assert payload["data"]["financials"] == {"income": [], "balance": [], "cashflow": []}
    assert any(sentinel in record.getMessage() for record in caplog.records)
