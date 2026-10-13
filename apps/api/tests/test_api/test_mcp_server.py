import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker
from vnibb.mcp import server


def test_normalize_symbol_input_handles_exchange_prefix() -> None:
    assert server.normalize_symbol_input("HOSE:VNM") == "VNM"
    assert server.normalize_symbol_input(" vcb ") == "VCB"


def test_build_collection_queries_rejects_disallowed_filter() -> None:
    with pytest.raises(ValueError, match="does not support filter 'exchange'"):
        server.build_collection_queries(collection="stock_prices", exchange="HOSE")


@pytest.mark.asyncio
async def test_query_database_collection_data_builds_expected_queries(monkeypatch) -> None:
    captured: dict[str, object] = {}

    async def fake_list_collection_documents_paginated(
        collection_id, queries=None, page_size=250, max_documents=None, timeout_seconds=8.0
    ):
        captured["collection_id"] = collection_id
        captured["queries"] = queries or []
        captured["page_size"] = page_size
        captured["max_documents"] = max_documents
        return [{"symbol": "VNM", "time": "2026-04-01T00:00:00.000Z", "close": 65000}]

    monkeypatch.setattr(
        server,
        "list_collection_documents_paginated",
        fake_list_collection_documents_paginated,
    )

    result = await server.query_database_collection_data(
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

    async def get_raw_dataset_records_precise(self, symbol, *, dataset, limit, source=None, variant=None, raise_errors=False):
        self.calls["precise_raw"] = {"symbol": symbol, "dataset": dataset, "limit": limit, "source": source, "variant": variant, "raise_errors": raise_errors}
        return [{"symbol": symbol, "dataset": dataset, "recordKey": f"k:{symbol}:{dataset}"}]

    async def get_price_depth_precise(self, symbol, *, limit, include_provenance):
        self.calls["precise_depth"] = {
            "symbol": symbol,
            "limit": limit,
            "include_provenance": include_provenance,
        }
        return [{"price": 1.0, "volume": 100, "observedAt": "2026-10-01T00:00:00Z"}]

    async def get_raw_dataset_records(self, symbol, *, dataset, limit):
        self.calls["raw"] = {"symbol": symbol, "dataset": dataset, "limit": limit}
        return [{"raw": {"symbol": symbol}, "dataset": dataset}]

    async def get_price_depth(self, symbol, *, limit):
        self.calls["depth"] = {"symbol": symbol, "limit": limit}
        return [{"raw": {"symbol": symbol}}]

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
    assert fake.calls["precise_raw"]["limit"] == server.PREMIUM_DATASET_SPECS["finance.ratio"].max_limit
    assert fake.calls["precise_raw"]["dataset"] == "finance.ratio"
    assert "raw" not in fake.calls


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


@pytest.mark.asyncio
async def test_get_price_depth_uses_newest_snapshot_deterministically(monkeypatch) -> None:
    fake = _FakeMongoService()
    monkeypatch.setattr(server, "get_mongo_market_data_service", lambda: fake)

    result = await server.get_price_depth(symbol="hose:ssi", limit=10_000)

    assert result["symbol"] == "SSI"
    assert fake.calls["precise_depth"]["symbol"] == "SSI"
    assert fake.calls["precise_depth"]["limit"] == 5000
    assert fake.calls["precise_depth"]["include_provenance"] is True
    assert "depth" not in fake.calls


def test_agent_guide_resource_covers_connect_auth_and_discovery() -> None:
    text = server.read_agent_guide_resource()
    assert "streamable-http" in text
    assert "Authorization: Bearer" in text
    assert "/mcp" in text
    assert "vnibb://mcp/guardrails" in text
    assert "vnibb://database/collections" in text
    assert "vnibb://mongo/datasets" in text
    assert "get_symbol_snapshot" in text
    assert "query_database_collection" in text


def test_skills_catalog_lists_named_retrieval_workflows() -> None:
    text = server.read_skills_catalog_resource()
    for skill in (
        "symbol_deep_dive",
        "market_brief",
        "eod_price_history",
        "premium_dataset",
        "intraday_trades",
        "price_depth",
        "database_audit",
        "matrix_selection",
    ):
        assert skill in text
    assert "read-only" in text


def test_agent_connection_guide_tool_exposes_guide_and_skills() -> None:
    result = server.get_agent_connection_guide()
    assert result["server"] == "VNIBB Read-Only MCP"
    assert result["read_only"] is True
    assert result["guide_resource"] == "vnibb://mcp/guide"
    assert result["skills_resource"] == "vnibb://mcp/skills"
    assert result["guide"] == server.AGENT_CONNECTION_GUIDE
    assert result["skills"] == server.SKILLS_CATALOG


def test_new_workflow_prompt_templates_return_directive_text() -> None:
    assert "get_eod_price_history" in server.eod_price_history("vnm", lookback_days=90)
    assert "get_premium_dataset" in server.premium_dataset("vnm", "equity.foreign_flow", limit=10)
    assert "get_intraday_trades" in server.intraday_trades("vnm", lookback_days=3, limit=10)
    assert "get_price_depth" in server.price_depth("vnm", limit=50)


@pytest.fixture
def mock_price_sql(monkeypatch):
    records = []
    statements = []

    class Result:
        def mappings(self):
            return self

        def all(self):
            return records

    class Session:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def execute(self, statement):
            statements.append(statement)
            return Result()

    async def ensure_available():
        return None

    monkeypatch.setattr(server, "async_session_maker", Session)
    monkeypatch.setattr(server, "_ensure_database_available", ensure_available)
    return records, statements


@pytest.mark.asyncio
@pytest.mark.parametrize("paginated", [False, True])
async def test_stock_price_sql_projects_source_and_normalizes_units(mock_price_sql, paginated):
    records, statements = mock_price_sql
    records.extend([
        {"symbol": "VNM", "close": 65000.0, "source": "vnstock_vnd:VCI"},
        {"symbol": "VNM", "close": 65.0, "source": "VCI"},
        {"symbol": "VNM", "close": 65.0, "source": "vnstock"},
        {"symbol": "VNM", "close": 65.0, "source": "ohlcv_backfill_full"},
    ])
    if paginated:
        rows = await server.list_collection_documents_paginated("stock_prices", max_documents=4)
    else:
        rows = await server.list_collection_documents("stock_prices")

    assert "source" in statements[0].selected_columns.keys()
    assert [row["source"] for row in rows] == [row["source"] for row in records]
    assert [row["close"] for row in rows] == [65000.0, 65000.0, 65.0, 65.0]
    assert [row["price_unit"] for row in rows] == ["VND", "VND", "unknown", "unknown"]
    assert records[1]["close"] == 65.0


@pytest.mark.asyncio
@pytest.mark.parametrize("generic_collection", [False, True])
async def test_mcp_price_wrappers_warn_about_unknown_series(mock_price_sql, generic_collection):
    records, _ = mock_price_sql
    records.extend([
        {"symbol": "VNM", "close": 65000.0, "source": "vnstock_vnd:VCI"},
        {"symbol": "VNM", "close": 65.0, "source": "vnstock"},
    ])
    if generic_collection:
        result = await server.query_database_collection(collection="stock_prices", symbol="VNM")
    else:
        result = await server.get_symbol_prices("VNM")

    assert result["row_count"] == 2
    assert result["price_unit"] == "unknown"
    assert result["price_units"] == ["VND", "unknown"]
    assert result["unknown_price_unit_count"] == 1
    assert result["prices_comparable"] is False
    assert result["warnings"]
    assert result["items"][1]["price_unit"] == "unknown"
    assert result["items"][1]["close"] == 65.0


@pytest.mark.asyncio
async def test_get_symbol_prices_reports_canonical_comparable_series(mock_price_sql):
    records, _ = mock_price_sql
    records.append({"symbol": "VNM", "close": 65000.0, "source": "vnstock_vnd:VCI"})

    result = await server.get_symbol_prices("VNM")

    assert result["source"] == "postgres:stock_prices"
    assert result["price_unit"] == "VND"
    assert result["prices_comparable"] is True
    assert result["items"][0]["close"] == 65000.0
    assert result["warnings"] == []


@pytest.mark.asyncio
@pytest.mark.parametrize("date_range", [False, True])
@pytest.mark.parametrize(
    "symbol,row,expected_close,expected_unit",
    [
        ("VNM", {"close": 65000.0, "priceUnit": "VND", "source": "VCI"}, 65000.0, "VND"),
        ("VNM", {"close": 65.0, "priceUnit": "THOUSAND_VND"}, 65000.0, "VND"),
        ("VNM", {"close": 65000.0, "price_unit": "VND", "source": "VCI"}, 65000.0, "VND"),
        ("VNM", {"close": 65.0, "source": "KBS"}, 65.0, "unknown"),
        ("VNM", {"close": 65.0, "source": "vnstock_history:KBS"}, 65000.0, "VND"),
        ("VNM", {"close": 65.0, "source": "ohlcv_backfill_full"}, 65.0, "unknown"),
        ("VNINDEX", {"close": 1300.0, "priceUnit": "index_points", "source": "VCI"}, 1300.0, "index_points"),
        ("VNINDEX", {"close": 1300.0, "source": "VCI"}, 1300.0, "unknown"),
        ("VNM", {"close": 65000.0, "source": "vnstock_vnd:KBS"}, 65000.0, "VND"),
        ("VNM", {"close": 65.0, "source": "vnstock_vnd_bad"}, 65.0, "unknown"),
    ],
)
async def test_eod_history_preserves_markers_and_normalizes_once(
    monkeypatch, date_range, symbol, row, expected_close, expected_unit
):
    class MongoService(_FakeMongoService):
        async def get_eod_prices(self, *_args, **_kwargs):
            return [row]

        async def get_eod_prices_between(self, *_args, **_kwargs):
            return [row]

    monkeypatch.setattr(server, "get_mongo_market_data_service", MongoService)
    date_args = {"start_date": "2026-01-01", "end_date": "2026-02-01"} if date_range else {}

    result = await server.get_eod_price_history(symbol, **date_args)

    item = result["items"][0]
    assert item["close"] == expected_close
    assert item["price_unit"] == expected_unit
    assert result["price_unit"] == expected_unit
    assert result["prices_comparable"] is (expected_unit != "unknown")
    assert result["unknown_price_unit_count"] == int(expected_unit == "unknown")
    assert bool(result["warnings"]) is (expected_unit == "unknown")
    if "priceUnit" in row:
        assert item["priceUnit"] == row["priceUnit"]
    if "source" in row:
        assert item["source"] == row["source"]


@pytest.mark.asyncio
async def test_empty_price_history_does_not_claim_known_comparable_units(monkeypatch):
    class MongoService(_FakeMongoService):
        async def get_eod_prices(self, *_args, **_kwargs):
            return []

    monkeypatch.setattr(server, "get_mongo_market_data_service", MongoService)

    result = await server.get_eod_price_history("VNM")

    assert result["row_count"] == 0
    assert result["price_unit"] == "unknown"
    assert result["price_units"] == []
    assert result["prices_comparable"] is False


@pytest.mark.asyncio
async def test_eod_history_retains_unknown_rows_without_claiming_comparable_series(monkeypatch):
    rows = [
        {"symbol": "VNM", "close": 65000.0, "priceUnit": "VND", "source": "VCI"},
        {"symbol": "VNM", "close": 65.0, "source": "vnstock"},
    ]

    class MongoService(_FakeMongoService):
        async def get_eod_prices(self, *_args, **_kwargs):
            return rows

    monkeypatch.setattr(server, "get_mongo_market_data_service", MongoService)

    result = await server.get_eod_price_history("VNM")

    assert result["row_count"] == 2
    assert result["price_unit"] == "unknown"
    assert result["price_units"] == ["VND", "unknown"]
    assert result["unknown_price_unit_count"] == 1
    assert result["prices_comparable"] is False
    assert result["warnings"]
    assert [item["close"] for item in result["items"]] == [65000.0, 65.0]
    assert [item["price_unit"] for item in result["items"]] == ["VND", "unknown"]


@pytest.mark.parametrize(
    "row,expected_close,expected_unit",
    [
        ({"symbol": "VNINDEX", "close": 1300.0, "source": "VCI"}, 1300.0, "index_points"),
        ({"symbol": "VNM", "close": 65.0, "price_unit": "unknown", "source": "VCI"}, 65.0, "unknown"),
        ({"symbol": "VNM", "close": 65.0, "source": "vietcap_vnd"}, 65.0, "VND"),
        ({"symbol": "VNM", "close": 65.0, "source": "vietcap"}, 65.0, "unknown"),
    ],
)
def test_stock_price_serialization_respects_index_and_explicit_unknown_units(
    row, expected_close, expected_unit
):
    result = server._serialize_row(row, model=server.StockPrice)

    assert result["close"] == expected_close
    assert result["price_unit"] == expected_unit
    assert result["source"] == row["source"]


def test_non_price_collection_serialization_does_not_add_price_units():
    row = {"symbol": "VNM", "source": "vnstock", "revenue": 1000.0}

    assert server._serialize_row(row, model=server.IncomeStatement) == row


@pytest.mark.asyncio
async def test_financial_corpus_filters_iq_source_and_fiscal_variant(monkeypatch):
    fake = _FakeMongoService()
    monkeypatch.setattr(server, "get_mongo_market_data_service", lambda: fake)
    result = await server.get_premium_dataset("FPT", "finance.income_statement", period_type="quarter")
    assert fake.calls["precise_raw"]["source"] == "vietcap"
    assert fake.calls["precise_raw"]["variant"] == "finance.income_statement.quarter"
    assert fake.calls["precise_raw"]["raise_errors"] is True
    assert result["provider_source"] == "vietcap"


@pytest.mark.asyncio
async def test_mongo_read_failure_is_not_an_empty_dataset(monkeypatch):
    class FailedMongo(_FakeMongoService):
        async def get_raw_dataset_records_precise(self, *args, **kwargs):
            raise ConnectionError("unavailable")

    monkeypatch.setattr(server, "get_mongo_market_data_service", FailedMongo)
    with pytest.raises(server.ToolError, match="not an empty result"):
        await server.get_premium_dataset("FPT", "finance.ratio")


@pytest.mark.asyncio
@pytest.mark.parametrize("reachable", [True, False])
async def test_mongo_status_distinguishes_empty_database_from_unreachable(monkeypatch, reachable):
    class EmptyMongo(_FakeMongoService):
        def _get_database(self):
            return self

        def command(self, name):
            assert name == "ping"
            if not reachable:
                raise ConnectionError("unavailable")
            return {"ok": 1}

        async def inspect_collections(self, **kwargs):
            return []

    monkeypatch.setattr(server, "get_mongo_market_data_service", EmptyMongo)
    result = await server.get_mongo_status()
    assert result["connectivity"]["status"] == ("connected" if reachable else "error")


@pytest.mark.asyncio
async def test_mcp_snapshots_use_only_postgres_context(monkeypatch):
    async def available():
        pass

    class DatabaseContext:
        async def _build_postgres_snapshot(self, symbol):
            return {"symbol": symbol}

        async def _build_postgres_market_snapshot(self):
            return {"indices": []}

    monkeypatch.setattr(server, "_ensure_database_available", available)
    monkeypatch.setattr(server, "AIContextService", DatabaseContext)
    assert (await server.get_symbol_snapshot("FPT"))["snapshot"] == {"symbol": "FPT"}
    assert (await server.get_market_snapshot())["snapshot"] == {"indices": []}


@pytest.mark.asyncio
async def test_latest_financial_prefers_iq_before_newer_vci(monkeypatch):
    calls = []

    async def read(collection, queries):
        source = queries[0]["values"]
        calls.append(source)
        return [{"symbol": "FPT", "source": source[0], "fiscal_year": 2025}]

    monkeypatch.setattr(server, "list_collection_documents", read)
    row = await server._get_latest_symbol_document("income_statements", "FPT")
    assert row["source"] == "vietcap"
    assert calls == [["vietcap"]]


@pytest.mark.asyncio
async def test_financial_envelope_does_not_truncate_source_evidence(monkeypatch):
    evidence = {f"metric_{i}": i for i in range(30)}

    class EvidenceMongo(_FakeMongoService):
        async def get_raw_dataset_records_precise(self, *args, **kwargs):
            return [{"raw": evidence, "descriptors": evidence, "structured": evidence}]

    monkeypatch.setattr(server, "get_mongo_market_data_service", EvidenceMongo)
    result = await server.get_premium_dataset("FPT", "finance.ratio")
    assert result["items"][0]["raw"] == evidence
    assert result["items"][0]["descriptors"] == evidence


@pytest.mark.asyncio
async def test_latest_financial_uses_only_explicit_vci_secondary(monkeypatch):
    calls = []

    async def read(collection, queries):
        sources = queries[0]["values"]
        calls.append(sources)
        return [] if sources == ["vietcap"] else [{"source": "VCI"}]

    monkeypatch.setattr(server, "list_collection_documents", read)
    row = await server._get_latest_symbol_document("financial_ratios", "FPT")
    assert row["source"] == "VCI"
    assert calls == [["vietcap"], ["VCI"]]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "collection", ["income_statements", "balance_sheets", "cash_flows", "financial_ratios"]
)
async def test_generic_financial_query_admits_iq_and_vci_only(
    monkeypatch, test_engine, test_db, collection
):
    model = server.COLLECTION_MODELS[collection]
    sources = ["vietcap", "VCI", "vnstock", "KBS", "DNSE", "VND"]
    test_db.add_all(
        model(
            id=index,
            symbol="FPT",
            period=str(2026 - index),
            period_type="year",
            fiscal_year=2026 - index,
            source=source,
        )
        for index, source in enumerate(sources, start=1)
    )
    test_db.add(
        model(id=7, symbol="VNM", period="2025", period_type="year", fiscal_year=2025, source="VCI")
    )
    await test_db.commit()
    monkeypatch.setattr(
        server, "async_session_maker", async_sessionmaker(test_engine, expire_on_commit=False)
    )

    result = await server.query_database_collection_data(
        collection=collection, symbol="FPT", period_type="year"
    )

    assert result["row_count"] == 2
    assert {row["id"] for row in result["items"]} == {1, 2}
    assert {row["source"] for row in result["items"]} == {"vietcap", "VCI"}
    assert result["filters_applied"]["admitted_sources"] == ["vietcap", "VCI"]


@pytest.mark.asyncio
@pytest.mark.parametrize("source", ["vietcap", "VCI"])
@pytest.mark.parametrize("unit", [None, "unknown", "fraction", "percent"])
async def test_sql_ratio_consumers_withhold_unadmitted_percentages(
    monkeypatch, test_engine, test_db, source, unit
):
    from vnibb.models.trading import FinancialRatio
    from vnibb.services import ai_context_service

    percent_columns = {
        "roe", "roa", "roic", "gross_margin", "operating_margin", "net_margin",
        "revenue_growth", "earnings_growth", "debt_to_assets",
    }
    raw_data = {"provider_evidence": [{"roe": 0.2, "unit": unit}]}
    if unit is not None:
        raw_data["ratio_units"] = dict.fromkeys(server.PERCENT_RATIO_FIELDS, unit)
    stored_row = FinancialRatio(
        id=1, symbol="FPT", period="2025", period_type="year", fiscal_year=2025,
        source=source, pe_ratio=12.5, eps=4200.0, raw_data=raw_data,
        **dict.fromkeys(percent_columns, 0.2),
    )
    test_db.add(stored_row)
    await test_db.commit()
    session_maker = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(server, "async_session_maker", session_maker)
    monkeypatch.setattr(ai_context_service, "async_session_maker", session_maker)

    async def database_available():
        return True

    monkeypatch.setattr(server, "check_database_connection", database_available)
    generic = await server.query_database_collection_data(
        collection="financial_ratios", symbol="FPT", period_type="year"
    )
    latest = await server.get_latest_financial_ratios("FPT", period_type="year")
    snapshot = await server.get_symbol_snapshot("FPT")

    for payload in (generic["items"][0], latest["item"], snapshot["snapshot"]["ratios"]):
        assert payload["pe_ratio"] == 12.5
        assert payload["eps"] == 4200.0
        assert payload["raw_data"] == raw_data
        for column in percent_columns:
            assert payload[column] == (0.2 if unit == "percent" else None)
        if unit != "percent":
            assert set(payload["unavailable_metrics"]) == percent_columns
            assert payload["data_status"] == "partial_unavailable"
        else:
            assert "unavailable_metrics" not in payload
    assert snapshot["snapshot"]["ratios"]["pe"] == 12.5
    assert latest["data_status"] == ("available" if unit == "percent" else "partial_unavailable")
    await test_db.refresh(stored_row)
    assert stored_row.raw_data == raw_data
    assert all(getattr(stored_row, column) == 0.2 for column in percent_columns)


@pytest.mark.parametrize("value,expected", [("quarter", "quarter"), (" YEAR ", "year")])
def test_fiscal_period_filters_match_persisted_lowercase_values(value, expected):
    _, queries, _, _ = server.build_collection_queries(collection="income_statements", period_type=value)
    assert server._query_equal("period_type", [expected]) in queries
