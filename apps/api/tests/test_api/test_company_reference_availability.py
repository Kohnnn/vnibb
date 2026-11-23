import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pandas as pd
import pytest
from vnibb.api.v1 import copilot, equity
from vnibb.api.v1.schemas import StandardResponse
from vnibb.core.exceptions import ProviderError
from vnibb.mcp import server
from vnibb.providers.vnstock import runtime
from vnibb.services.mongo_market_data_service import MongoReadError


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("route", "raw_field", "public_field"),
    [
        ("officers", "officer_name", "name"),
        ("subsidiaries", "organ_name", "company_name"),
    ],
)
async def test_company_reference_http_distinguishes_empty_failure_and_timeout(
    client, monkeypatch, route, raw_field, public_field,
):
    secret = "SYNTHETIC_PROVIDER_DIAGNOSTIC"
    read = Mock(side_effect=[
        pd.DataFrame(columns=[raw_field]),
        pd.DataFrame([{raw_field: "Fixture name"}]),
        ConnectionError(secret),
        TimeoutError(secret),
        SystemExit(secret),
        None,
    ])
    company = Mock(return_value=SimpleNamespace(**{route: read}))
    monkeypatch.setattr(runtime, "get_company_class", lambda: company)
    path = f"/api/v1/equity/hpg/{route}"

    empty, populated, failed, timed_out, aborted, no_table = [await client.get(path) for _ in range(6)]

    for response in (empty, populated, failed, timed_out, aborted, no_table):
        assert response.status_code == 200
        assert response.headers["Cache-Control"] == "no-store, max-age=0"
        assert secret not in response.text
    assert empty.json()["data"] == []
    assert empty.json()["error"] is None
    assert empty.json()["meta"]["count"] == 0
    assert populated.json()["data"][0]["symbol"] == "HPG"
    assert populated.json()["data"][0][public_field] == "Fixture name"
    assert populated.json()["meta"]["last_data_date"] is None
    assert failed.json() == {"data": [], "meta": None, "error": "Provider unavailable"}
    assert timed_out.json() == {"data": [], "meta": None, "error": "Provider request timed out"}
    assert aborted.json() == no_table.json() == failed.json()
    assert read.call_count == 6
    assert all(call.kwargs == {"symbol": "HPG", "source": "VCI"} for call in company.call_args_list)


@pytest.mark.asyncio
async def test_fundamental_analysis_keeps_reference_failure_separate_from_empty_section(client, monkeypatch):
    monkeypatch.setattr(equity.VnstockOfficersFetcher, "extract_data", AsyncMock(
        side_effect=ProviderError("SYNTHETIC_PROVIDER_DIAGNOSTIC", provider="vnstock"),
    ))
    monkeypatch.setattr(equity.VnstockSubsidiariesFetcher, "extract_data", AsyncMock(return_value=[]))
    for name in ("get_profile", "get_financial_ratios", "get_financials", "get_shareholders",
                 "get_company_news", "get_company_events"):
        monkeypatch.setattr(equity, name, AsyncMock(return_value=StandardResponse(data=[])))
    monkeypatch.setattr(equity, "_load_latest_fundamental_snapshot", AsyncMock(return_value=None))

    response = await client.get("/api/v1/equity/HPG/fundamental-analysis")

    assert response.status_code == 200
    assert "SYNTHETIC_PROVIDER_DIAGNOSTIC" not in response.text
    payload = response.json()
    assert payload["error"] == "Partial data unavailable"
    assert payload["data"]["officers"] == payload["data"]["subsidiaries"] == []
    assert payload["data"]["section_errors"]["officers"] == "Provider unavailable"
    assert "subsidiaries" not in payload["data"]["section_errors"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("widget_type", "sample"),
    [
        ("officers_management", [{"symbol": "HPG", "name": "Fixture executive"}]),
        ("subsidiaries", None),
    ],
)
async def test_reference_availability_reaches_agent_prompt_with_large_snapshot(
    client, monkeypatch, widget_type, sample,
):
    monkeypatch.setattr(copilot.ai_context_service, "_build_market_snapshot", AsyncMock(return_value={}))
    monkeypatch.setattr(copilot.ai_context_service, "_build_symbol_snapshot", AsyncMock(return_value=None))
    captured = {}

    async def capture_agent_prompt(messages, context, request_settings=None):
        prompt = copilot.llm_service._build_messages(messages, context, request_settings)
        captured["policy"] = prompt[1]["content"]
        captured["evidence"] = prompt[2]["content"]
        yield {"done": True}

    monkeypatch.setattr(copilot.llm_service, "generate_response_stream_events", capture_agent_prompt)
    provenance = {
        "observationStatus": "available" if sample else "unavailable",
        "refreshStatus": "failed",
        "coverage": "unknown",
        "updatedAt": "2026-10-30" if sample else None,
        "fetchedAt": "2026-11-23T05:00:00.000Z" if sample else None,
        "failedAt": "2026-11-23T05:20:00.000Z",
        "failureKind": "envelope",
        "warnings": ["Provider request timed out"],
    }
    response = await client.post("/api/v1/copilot/chat/stream", json={
        "message": "What records are available for HPG?",
        "context": {
            "widgetTypeKey": widget_type,
            "symbol": "HPG",
            "widgetPayload": {"symbol": "HPG", "dataSample": sample, "dataProvenance": provenance},
            "dataSnapshot": {
                key: {str(i): "x" * 500 for i in range(20)} for key in ("profile", "ratios")
            },
        },
        "settings": {"mode": "browser_key"},
    })

    assert response.status_code == 200
    assert '"done": true' in response.text
    assert f'"dataProvenance": {json.dumps(provenance)}' in captured["evidence"]
    assert f'"dataSample": {json.dumps(sample)}' in captured["evidence"]
    assert "does not establish that a company has zero" in captured["policy"]


@pytest.mark.asyncio
@pytest.mark.parametrize("dataset", ["company.officers", "company.subsidiaries"])
async def test_reference_mcp_reads_distinguish_retained_rows_empty_and_store_failure(monkeypatch, dataset):
    item = {"symbol": "HPG", "dataset": dataset, "sourceDate": "2026-10-30"}
    read = AsyncMock(side_effect=[[item], [], MongoReadError("timeout")])

    store = SimpleNamespace(enabled=True, get_raw_dataset_records_precise=read)
    monkeypatch.setattr(server, "get_mongo_market_data_service", lambda: store)
    args = {"symbol": "hpg", "dataset": dataset}

    _, retained = await server.mcp.call_tool("get_premium_dataset", args)
    _, empty = await server.mcp.call_tool("get_premium_dataset", args)
    with pytest.raises(server.ToolError, match="timeout.*not an empty result"):
        await server.mcp.call_tool("get_premium_dataset", args)

    assert retained["data_status"] == "available"
    assert retained["items"] == [item]
    assert retained["retrieved_at"] != item["sourceDate"]
    assert empty["data_status"] == "empty"
    assert empty["items"] == []
    assert empty["row_count"] == 0
    assert empty["freshness"].startswith("not_assessed")
    assert retained["provider_execution"] is empty["provider_execution"] is False
    assert all(call.kwargs["scope_key"] == "HPG" for call in read.await_args_list)
