import pytest
from httpx import ASGITransport, AsyncClient

from vnibb.mcp import server


def test_normalize_symbol_input_handles_exchange_prefix() -> None:
    assert server.normalize_symbol_input("HOSE:VNM") == "VNM"
    assert server.normalize_symbol_input(" vcb ") == "VCB"


def test_build_collection_queries_rejects_disallowed_filter() -> None:
    with pytest.raises(ValueError, match="does not support filter 'exchange'"):
        server.build_collection_queries(collection="stock_prices", exchange="HOSE")


@pytest.mark.asyncio
async def test_query_appwrite_collection_data_builds_expected_queries(monkeypatch) -> None:
    captured: dict[str, object] = {}

    async def fake_list_appwrite_documents_paginated(
        collection_id, queries=None, page_size=250, max_documents=None, timeout_seconds=8.0
    ):
        captured["collection_id"] = collection_id
        captured["queries"] = queries or []
        captured["page_size"] = page_size
        captured["max_documents"] = max_documents
        return [{"symbol": "VNM", "time": "2026-04-01T00:00:00.000Z", "close": 65000}]

    monkeypatch.setattr(
        server,
        "list_appwrite_documents_paginated",
        fake_list_appwrite_documents_paginated,
    )

    result = await server.query_appwrite_collection_data(
        collection="stock_prices",
        symbol="vnm",
        interval="1d",
        start_date="2026-04-01",
        end_date="2026-04-05",
        limit=5,
        sort_by="time",
        descending=False,
    )

    assert captured["collection_id"] == "stock_prices"
    queries = captured["queries"]
    assert any(
        query.get("method") == "equal"
        and query.get("attribute") == "symbol"
        and query.get("values") == ["VNM"]
        for query in queries
    )
    assert any(
        query.get("method") == "equal"
        and query.get("attribute") == "interval"
        and query.get("values") == ["1D"]
        for query in queries
    )
    assert any(
        query.get("method") == "orderAsc" and query.get("attribute") == "time" for query in queries
    )
    assert result["row_count"] == 1
    assert result["filters_applied"]["symbol"] == "VNM"


@pytest.mark.asyncio
async def test_http_app_requires_shared_bearer_for_remote_mcp(monkeypatch) -> None:
    monkeypatch.setattr(server.settings, "vnibb_mcp_shared_bearer_token", "secret-token")
    app = server.create_http_app()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        unauthorized = await client.get("/mcp")
        health = await client.get("/health")

    assert unauthorized.status_code == 401
    assert health.status_code == 200


def test_guardrails_resource_marks_write_tools_dangerous() -> None:
    text = server.read_guardrails_resource().lower()
    assert "dangerous" in text
    assert "write" in text
    assert "admin" in text
