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
    assert health.json()["revision"] == server.settings.release_revision


def test_guardrails_resource_marks_write_tools_dangerous() -> None:
    text = server.read_guardrails_resource().lower()
    assert "dangerous" in text
    assert "write" in text
    assert "admin" in text


class _FakeMongoService:
    def __init__(self, *, enabled: bool = True) -> None:
        self.enabled = enabled
        self.calls: dict[str, object] = {}

    async def get_eod_prices(self, symbol, *, lookback_days, limit):
        self.calls["eod"] = {"symbol": symbol, "lookback_days": lookback_days, "limit": limit}
        return [{"symbol": symbol, "close": 1.0}]

    async def get_eod_prices_between(self, symbol, *, start_date, end_date, limit):
        self.calls["eod_between"] = {
            "symbol": symbol,
            "start_date": start_date,
            "end_date": end_date,
            "limit": limit,
        }
        return [{"symbol": symbol, "close": 2.0}]

    async def get_raw_dataset_records(self, symbol, *, dataset, limit):
        self.calls["raw"] = {"symbol": symbol, "dataset": dataset, "limit": limit}
        return [{"raw": {"symbol": symbol}, "dataset": dataset}]

    async def inspect_collections(self, *, sample_limit=5):
        return [{"name": "market_prices_eod", "estimated_count": 10}]


@pytest.mark.asyncio
async def test_get_premium_dataset_rejects_unknown_dataset(monkeypatch) -> None:
    monkeypatch.setattr(server, "get_mongo_market_data_service", lambda: _FakeMongoService())
    with pytest.raises(ValueError, match="is not exposed"):
        await server.get_premium_dataset(symbol="vnm", dataset="company.insider_deals")


@pytest.mark.asyncio
async def test_get_premium_dataset_caps_limit_and_normalizes(monkeypatch) -> None:
    fake = _FakeMongoService()
    monkeypatch.setattr(server, "get_mongo_market_data_service", lambda: fake)

    result = await server.get_premium_dataset(symbol="hose:vnm", dataset="finance.ratio", limit=10_000)

    assert result["symbol"] == "VNM"
    assert result["dataset"] == "finance.ratio"
    # finance.ratio max_limit is 200, so the requested 10_000 must be capped.
    assert fake.calls["raw"]["limit"] == server.PREMIUM_DATASET_SPECS["finance.ratio"].max_limit
    assert fake.calls["raw"]["dataset"] == "finance.ratio"


@pytest.mark.asyncio
async def test_get_eod_price_history_uses_range_when_both_dates_present(monkeypatch) -> None:
    fake = _FakeMongoService()
    monkeypatch.setattr(server, "get_mongo_market_data_service", lambda: fake)

    result = await server.get_eod_price_history(
        symbol="vnm", start_date="2026-01-01", end_date="2026-02-01", limit=50
    )

    assert result["source"] == "mongodb:market_prices_eod"
    assert "eod_between" in fake.calls
    assert "eod" not in fake.calls


@pytest.mark.asyncio
async def test_mongo_tools_raise_when_disabled(monkeypatch) -> None:
    monkeypatch.setattr(
        server, "get_mongo_market_data_service", lambda: _FakeMongoService(enabled=False)
    )
    with pytest.raises(RuntimeError, match="not configured"):
        await server.get_eod_price_history(symbol="vnm")


@pytest.mark.asyncio
async def test_get_mongo_status_reports_disabled(monkeypatch) -> None:
    monkeypatch.setattr(
        server, "get_mongo_market_data_service", lambda: _FakeMongoService(enabled=False)
    )
    status = await server.get_mongo_status()
    assert status["enabled"] is False
    assert status["read_only"] is True


def test_list_premium_datasets_excludes_disabled_datasets() -> None:
    names = {item["dataset"] for item in server._serialize_premium_dataset_specs()}
    assert "finance.ratio" in names
    assert "equity.intraday" in names
    for disabled in (
        "company.capital_history",
        "company.insider_deals",
        "equity.block_trades",
        "equity.put_through",
        "quote.intraday",
        "quote.price_depth",
    ):
        assert disabled not in names
