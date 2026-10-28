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

    async def get_eod_prices(self, symbol, *, lookback_days, limit, include_provenance=True):
        self.calls["eod"] = {"symbol": symbol, "lookback_days": lookback_days, "limit": limit}
        return [{"symbol": symbol, "close": 1.0}]

    async def get_eod_prices_between(self, symbol, *, start_date, end_date, limit, include_provenance=True):
        self.calls["eod_between"] = {
            "symbol": symbol,
            "start_date": start_date,
            "end_date": end_date,
            "limit": limit,
        }
        return [{"symbol": symbol, "close": 2.0}]

    async def get_raw_dataset_records_precise(self, symbol, *, dataset, limit, source=None, variant=None, scope_type="symbol", scope_key=None):
        self.calls["precise_raw"] = {"symbol": symbol, "dataset": dataset, "limit": limit, "source": source, "variant": variant, "scope_type": scope_type, "scope_key": scope_key}
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
    assert "vnibb://mcp/guide" in text
    assert "get_agent_connection_guide" in text


def test_skills_catalog_lists_promptless_retrieval_workflows() -> None:
    # Prompt-backed skills are covered by the mirror test below; these three
    # workflows deliberately have no prompt template.
    text = server.read_skills_catalog_resource()
    for skill in ("matrix_selection", "reference_dataset", "ingestion_receipts"):
        assert skill in text
    assert "read-only" in text


@pytest.mark.asyncio
async def test_skills_catalog_mirrors_every_advertised_prompt() -> None:
    text = server.read_skills_catalog_resource()
    advertised = await server.mcp.list_prompts()
    assert advertised, "no prompt templates registered"
    for prompt in advertised:
        assert prompt.name in text, f"skills catalog is missing the {prompt.name} prompt"


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
    assert fake.calls["precise_raw"]["scope_type"] == "symbol"
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
        async def _build_database_snapshot_direct(self, symbol):
            return {"symbol": symbol}

        async def _build_database_market_snapshot_direct(self):
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
    from vnibb.services.mongo_market_data_service import MongoReadRows

    evidence = {f"metric_{i}": i for i in range(30)}

    class EvidenceMongo(_FakeMongoService):
        async def get_raw_dataset_records_precise(self, *args, **kwargs):
            return MongoReadRows(
                [{"recordKey": "q2-2024", "raw": evidence, "descriptors": evidence, "structured": evidence}],
                {"unrepresentable_financial_identity": {"ttm-2024": "ratio_ttm"}},
            )

    monkeypatch.setattr(server, "get_mongo_market_data_service", EvidenceMongo)
    result = await server.get_premium_dataset("FPT", "finance.ratio")
    assert result["data_status"] == "available"
    assert result["scope_type"] == "symbol" and result["scope_key"] == "FPT"
    assert result["row_count"] == len(result["items"]) == 1
    assert result["items"][0]["recordKey"] == "q2-2024"
    assert result["items"][0]["raw"] == evidence
    assert result["items"][0]["descriptors"] == evidence
    assert result["unrepresentable_financial_identity"] == {"ttm-2024": "ratio_ttm"}

@pytest.mark.asyncio
async def test_premium_dataset_surfaces_unrepresentable_row_disclosures(monkeypatch):
    from vnibb.services.mongo_market_data_service import MongoReadRows

    class DisclosureMongo(_FakeMongoService):
        async def get_raw_dataset_records_precise(self, *args, **kwargs):
            return MongoReadRows(
                [{"recordKey": "kept", "raw": {"value": 1}}],
                {"legacy_period_labels": ["legacy-key"],
                 "unrepresentable_financial_identity": {"ttm-key": "ratio_ttm",
                                                        "variant-key": "unsupported_variant:finance.ratio.month"}},
            )

    monkeypatch.setattr(server, "get_mongo_market_data_service", DisclosureMongo)
    result = await server.get_premium_dataset("FPT", "finance.ratio")

    assert result["row_count"] == len(result["items"]) == 1
    assert result["items"][0]["recordKey"] == "kept"
    assert result["legacy_period_labels"] == ["legacy-key"]
    assert result["unrepresentable_financial_identity"] == {
        "ttm-key": "ratio_ttm",
        "variant-key": "unsupported_variant:finance.ratio.month",
    }

    class PlainMongo(_FakeMongoService):
        async def get_raw_dataset_records_precise(self, *args, **kwargs):
            return [{"recordKey": "kept"}]

    monkeypatch.setattr(server, "get_mongo_market_data_service", PlainMongo)
    plain = await server.get_premium_dataset("FPT", "finance.ratio")
    assert "legacy_period_labels" not in plain
    assert "unrepresentable_financial_identity" not in plain


ISSUER_EVIDENCE = {
    "document_sha256": "630f61f6ef9f07d5c593c3bf8f65bad1d56ecbb091921296ed5c4e830ea070a4",
    "page": 12,
    "currency": "VND",
    "value_unit": "VND",
}


@pytest.mark.asyncio
async def test_latest_financial_prefers_primary_then_secondary_then_evidenced_issuer(monkeypatch):
    calls = []

    async def read(collection, queries):
        sources = queries[0]["values"]
        calls.append(sources)
        if sources == ["issuer_report"]:
            return [
                {"source": "issuer_report", "raw_data": {}},
                {"source": "issuer_report", "raw_data": {"_financial_lineage": {"issuer_evidence": ISSUER_EVIDENCE}}},
            ]
        return [{"source": sources[0]}]

    monkeypatch.setattr(server, "list_collection_documents", read)
    row = await server._get_latest_symbol_document("financial_ratios", "FPT")
    assert row["source"] == "vietcap"
    assert calls == [["vietcap"]]

    calls.clear()

    async def read_secondary_only(collection, queries):
        sources = queries[0]["values"]
        calls.append(sources)
        if sources == ["issuer_report"]:
            return [{"source": "issuer_report", "raw_data": {"_financial_lineage": {"issuer_evidence": ISSUER_EVIDENCE}}}]
        return [] if sources == ["vietcap"] else [{"source": "VCI"}]

    monkeypatch.setattr(server, "list_collection_documents", read_secondary_only)
    row = await server._get_latest_symbol_document("financial_ratios", "FPT")
    assert row["source"] == "VCI"
    assert calls == [["vietcap"], ["VCI"]]

    calls.clear()

    async def read_issuer_only(collection, queries):
        sources = queries[0]["values"]
        calls.append(sources)
        if sources == ["issuer_report"]:
            return [
                {"source": "issuer_report", "raw_data": {}},
                {"source": "issuer_report", "raw_data": {"_financial_lineage": {"issuer_evidence": ISSUER_EVIDENCE}}},
            ]
        return []

    monkeypatch.setattr(server, "list_collection_documents", read_issuer_only)
    row = await server._get_latest_symbol_document("financial_ratios", "FPT")
    assert row["raw_data"]["_financial_lineage"]["issuer_evidence"] == ISSUER_EVIDENCE
    assert calls == [["vietcap"], ["VCI"], ["issuer_report"]]


@pytest.mark.asyncio
async def test_issuer_source_without_evidence_is_not_served(monkeypatch):
    async def read(collection, queries):
        if queries[0]["values"] == ["issuer_report"]:
            return [{"source": "issuer_report", "raw_data": {"_financial_lineage": {}}}]
        return []

    monkeypatch.setattr(server, "list_collection_documents", read)
    assert await server._get_latest_symbol_document("financial_ratios", "FPT") is None


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "collection", ["income_statements", "balance_sheets", "cash_flows", "financial_ratios"]
)
async def test_generic_financial_query_admits_evidenced_issuer_alongside_iq_and_vci(
    monkeypatch, test_engine, test_db, collection
):
    model = server.COLLECTION_MODELS[collection]
    sources = ["vietcap", "VCI", "vnstock", "issuer_report", "KBS", "DNSE", "VND"]
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
        model(id=8, symbol="VNM", period="2025", period_type="year", fiscal_year=2025, source="VCI")
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
    assert result["filters_applied"]["admitted_sources"] == ["vietcap", "VCI", "issuer_report"]


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


@pytest.mark.asyncio
@pytest.mark.parametrize("certified", [False, True])
async def test_sql_ratio_consumers_withhold_retained_interest_coverage_without_inputs(
    monkeypatch, test_engine, test_db, certified
):
    from vnibb.services import ai_context_service

    raw = {"interest_coverage": 12, "debt_service_coverage": 8,
           "ratio_units": dict.fromkeys(server.PERCENT_RATIO_FIELDS, "percent")}
    if certified:
        raw.update({
            "symbol": "FPT", "dataset": "finance.ratio", "datasetVariant": "finance.ratio.year",
            "source": "vietcap", "providerSource": "vietcap", "comTypeCode": "CT",
            "rawFiscalBasis": {"year": 2025, "quarter": 5},
            "raw": {"year": 2025, "quarter": 5, "ratioType": "RATIO_YEAR", "reported_coverage": 12},
            "descriptors": [{"field": "reported_coverage", "parent": None,
                             "fullTitleEn": "Interest coverage", "unit": "times"}],
            "descriptorEvidence": {"symbol": "FPT", "section": "RATIO", "comTypeCode": "CT",
                                   "source": "vietcap", "endpoint": "/v1/company/FPT/financial-statement/metrics",
                                   "receivedAt": "2026-10-13T01:00:00Z"},
        })
    stored = server.FinancialRatio(
        id=1, symbol="FPT", period="2025", period_type="year", fiscal_year=2025,
        source="vietcap" if certified else "VCI", interest_coverage=12, raw_data=raw,
    )
    test_db.add(stored)
    await test_db.commit()
    session_maker = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(server, "async_session_maker", session_maker)
    monkeypatch.setattr(ai_context_service, "async_session_maker", session_maker)

    async def database_available():
        return True

    monkeypatch.setattr(server, "check_database_connection", database_available)
    generic = await server.query_database_collection_data(collection="financial_ratios", symbol="FPT")
    latest = await server.get_latest_financial_ratios("FPT")
    snapshot = await server.get_symbol_snapshot("FPT")
    for item in (generic["items"][0], latest["item"], snapshot["snapshot"]["ratios"]):
        assert item["interest_coverage"] == (12 if certified else None)
        if not certified:
            assert item["unavailable_metrics"]["interest_coverage"] == "interest_inputs_unverified"
            assert item["raw_observation"]["interest_coverage"] == 12
        assert item["raw_data"] == raw
    await test_db.refresh(stored)
    assert stored.interest_coverage == 12
    assert stored.raw_data == raw


@pytest.mark.asyncio
@pytest.mark.parametrize("canonical,label", [
    (False, "financial_expenses"), (True, "financial_expenses"), (True, "interest_expense"),
])
@pytest.mark.parametrize("period,period_type,quarter,reason", [
    ("2025", "year", None, None),
    ("Q2-2025", "quarter", 2, None),
    ("2025", "quarter", None, "ambiguous_quarterly_fiscal_identity"),
    ("Q1-2025", "quarter", 2, "conflicting_fiscal_identity"),
])
async def test_sql_statement_consumers_admit_observations_without_rewriting_evidence(
    monkeypatch, test_engine, test_db, canonical, label, period, period_type, quarter, reason
):
    from vnibb.services import ai_context_service

    raw_data = {label: 900, "provider_rows": [{"label": label, "value": 900}]}
    unit_metadata = {"revenue": {"source_unit": "VND", "value_unit": "VND"}}
    raw_data["_financial_lineage"] = {
        "symbol": "FPT", "statement_type": "income", "source": "VCI",
        "period": period, "fiscal_year": 2025, "fiscal_quarter": quarter,
        "currency": "VND", "value_unit": "VND", "consolidation_basis": "consolidated",
        "flow_basis": "annual" if period_type == "year" else "single_quarter",
        "aggregation_basis": "reported_annual" if period_type == "year" else "reported_quarter",
        "source_periods": [period], "unit_metadata": unit_metadata,
    }
    if canonical:
        raw_data["_financial_lineage"]["canonical_data"] = {
            "symbol": "FPT", "statement_type": "income", "period": period,
            "fiscal_year": 2025, "fiscal_quarter": quarter, "source": "VCI",
            "value_unit": "VND", "interest_expense": 900, "revenue": 1000,
            "unit_metadata": {**unit_metadata, "interest_expense": {
                "label": label, "source_unit": "VND", "value_unit": "VND",
            }},
        }
    stored = server.IncomeStatement(
        id=1, symbol="FPT", period=period, period_type=period_type, fiscal_year=2025,
        fiscal_quarter=quarter, source="VCI", interest_expense=900, revenue=1000, raw_data=raw_data,
    )
    test_db.add(stored)
    await test_db.commit()
    session_maker = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(server, "async_session_maker", session_maker)
    monkeypatch.setattr(ai_context_service, "async_session_maker", session_maker)

    async def database_available():
        return True

    monkeypatch.setattr(server, "check_database_connection", database_available)
    generic = await server.query_database_collection_data(
        collection="income_statements", symbol="FPT", period_type=period_type,
    )
    latest = await server.get_latest_financial_statement("FPT", period_type=period_type)
    snapshot = await server.get_symbol_snapshot("FPT")

    for payload in (generic["items"][0], latest["item"], snapshot["snapshot"]["income_statement"]):
        accepted = canonical and label == "interest_expense" and reason is None
        assert payload["interest_expense"] == (900 if accepted else None)
        assert payload["revenue"] == (None if reason else 1000)
        assert payload["raw_data"] == raw_data
        assert payload.get("data_status", "available") == ("available" if accepted else "partial_unavailable")
        if not accepted:
            assert "interest_expense" in payload["unavailable_metrics"]
            assert payload["raw_observation"]["interest_expense"] == 900
        if reason:
            assert payload["unavailable_reason"] == reason
    assert latest["data_status"] == ("available" if canonical and label == "interest_expense" and reason is None else "partial_unavailable")
    await test_db.refresh(stored)
    assert stored.interest_expense == 900
    assert stored.revenue == 1000
    assert stored.raw_data == raw_data


@pytest.mark.parametrize("value,expected", [("quarter", "quarter"), (" YEAR ", "year")])
def test_fiscal_period_filters_match_persisted_lowercase_values(value, expected):
    _, queries, _, _ = server.build_collection_queries(collection="income_statements", period_type=value)
    assert server._query_equal("period_type", [expected]) in queries


@pytest.mark.asyncio
@pytest.mark.parametrize("limit", [0, 1, 19, 20, 21, 60, 250, 999])
async def test_public_sql_tool_preserves_fetched_rows_and_deep_evidence(
    monkeypatch, test_engine, test_db, limit
):
    from datetime import date, timedelta

    evidence = "  audit\n" + "evidence " * 100 + "https://example.test/report?unit=VND&basis=consolidated"
    canonical_data = {"zero": 0, "missing": None, "flag": False}
    test_db.add(server.Stock(id=1, symbol="VNM", exchange="HOSE"))
    await test_db.flush()
    test_db.add_all(server.StockPrice(
        id=index + 1, stock_id=1, symbol="VNM", time=date(2026, 1, 1) + timedelta(days=index),
        interval="1D", open=1, high=1, low=1, close=1, volume=1, source="vietcap_vnd",
    ) for index in range(260))
    test_db.add(server.BalanceSheet(
        id=1, symbol="VNM", period="2025", period_type="year", fiscal_year=2025,
        source="vietcap", total_equity=0,
        raw_data={"_financial_lineage": {
            "symbol": "VNM", "statement_type": "balance", "source": "vietcap",
            "period": "2025", "fiscal_year": 2025, "fiscal_quarter": None,
            "currency": "VND", "value_unit": "VND", "consolidation_basis": "consolidated",
            "flow_basis": "instantaneous", "aggregation_basis": "reported_annual",
            "source_periods": ["2025"], "unit_metadata": {
                "total_equity": {
                    "provider_value": 0, "source_unit": "VND", "value_unit": "VND", "raw_value": None,
                    "raw_unit": "VND", "normalization_multiplier": 1, "validated": True,
                },
            }, "canonical_data": canonical_data,
            "source_report": {"evidence": evidence}}},
    ))
    await test_db.commit()
    monkeypatch.setattr(server, "async_session_maker", async_sessionmaker(test_engine, expire_on_commit=False))
    async def available():
        return True
    monkeypatch.setattr(server, "check_database_connection", available)

    result = await server.query_database_collection("stock_prices", symbol="VNM", limit=limit)
    assert len(result["items"]) == result["row_count"] == min(max(limit, 0), 250)
    latest = await server.get_latest_financial_statement("VNM", "balance_sheet", "YEAR")
    assert latest["item"]["total_equity"] == 0
    assert latest["item"]["raw_data"]["_financial_lineage"]["source_report"]["evidence"] == evidence
    assert latest["item"]["raw_data"]["_financial_lineage"]["canonical_data"] == canonical_data


@pytest.mark.asyncio
@pytest.mark.parametrize("limit", [0, 1, 19, 20, 21, 60, 5000])
async def test_eod_tool_preserves_deep_evidence_and_all_rows(monkeypatch, limit):
    import json
    from decimal import Decimal

    evidence = "  raw\n" + "evidence " * 100 + "qualified unit=VND"
    class MongoService(_FakeMongoService):
        async def get_eod_prices(self, symbol, *, limit, **kwargs):
            return [{"symbol": symbol, "close": 1, "priceUnit": "VND", "audit": {
                "deep": {"units": {"revenue": {"multiplier": Decimal("1.00000000000000000001"),
                "large_integer": 2**63, "null": None, "valid": False, "evidence": evidence}}}}}
                for _ in range(min(limit, 60))]
    monkeypatch.setattr(server, "get_mongo_market_data_service", MongoService)
    result = await server.get_eod_price_history("VNM", limit=limit)
    assert result["row_count"] == len(result["items"]) == min(limit, 60)
    json.dumps(result, allow_nan=False)
    if result["items"]:
        audit = result["items"][0]["audit"]["deep"]["units"]["revenue"]
        assert audit == {"multiplier": "1.00000000000000000001", "large_integer": str(2**63),
                         "null": None, "valid": False, "evidence": evidence}


@pytest.mark.asyncio
@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf")])
async def test_mcp_tool_rejects_nonfinite_data_before_json(monkeypatch, value):
    class InvalidMongo(_FakeMongoService):
        async def get_raw_dataset_records_precise(self, *args, **kwargs):
            return [{"raw": {"nested": {"value": value}}}]
    monkeypatch.setattr(server, "get_mongo_market_data_service", InvalidMongo)
    with pytest.raises(ValueError, match="Nonfinite"):
        await server.get_premium_dataset("VNM", "company.info")


@pytest.mark.asyncio
@pytest.mark.parametrize("start,end", [("2020-01-01", None), (None, "2020-01-01")])
async def test_eod_one_sided_bounds_are_executed(monkeypatch, start, end):
    from datetime import date
    class BoundMongo(_FakeMongoService):
        async def get_eod_prices_between(self, symbol, *, start_date, end_date, limit, include_provenance):
            assert include_provenance is True
            self.calls["bounds"] = (start_date, end_date)
            return []
    fake = BoundMongo()
    monkeypatch.setattr(server, "get_mongo_market_data_service", lambda: fake)
    result = await server.get_eod_price_history("VNM", start_date=start, end_date=end)
    assert fake.calls["bounds"] == (date.fromisoformat(start) if start else None, date.fromisoformat(end) if end else None)
    assert "eod" not in fake.calls
    assert result["start_date"] == start and result["end_date"] == end


@pytest.mark.asyncio
@pytest.mark.parametrize("dataset", [name for name, spec in server.PREMIUM_DATASET_SPECS.items() if spec.scope_type == "market"])
async def test_market_dataset_uses_scope_without_equity_symbol(monkeypatch, dataset):
    fake = _FakeMongoService()
    monkeypatch.setattr(server, "get_mongo_market_data_service", lambda: fake)
    result = await server.get_premium_dataset(dataset=dataset)
    assert fake.calls["precise_raw"]["scope_type"] == "market"
    assert fake.calls["precise_raw"]["scope_key"] == "market"
    assert result["scope_key"] == "market"
    assert result["row_count"] == len(result["items"])


@pytest.mark.asyncio
@pytest.mark.parametrize("dataset", ["company.info", "macro.gdp", "market.pe", "analytics.valuation.pe"])
async def test_premium_tool_rejects_unapplied_period_and_index_constraints(monkeypatch, dataset):
    monkeypatch.setattr(server, "get_mongo_market_data_service", _FakeMongoService)
    with pytest.raises(ValueError, match="period_type is supported only"):
        await server.get_premium_dataset("VNM", dataset, period_type="year")
    with pytest.raises(ValueError, match="Index selection"):
        await server.get_premium_dataset("VNM", dataset, index_code="VN30")


@pytest.mark.asyncio
async def test_ingestion_receipt_tool_projects_selected_pair_from_real_sql(monkeypatch, test_engine, test_db):
    from datetime import datetime

    from vnibb.models.sync_status import SyncStatus
    receipt = {"last_attempted_at": "2026-10-01T12:00:00", "last_succeeded_at": None,
               "outcome": "failed", "rows": 0, "error": "ProviderUnavailable", "stage_stats": {"zero": 0}}
    test_db.add_all([
        SyncStatus(id=1, sync_type="supplemental_company_maintenance", status="partial",
            started_at=datetime(2026, 10, 1), additional_data={"expected_symbols": ["VCB", "VNM"],
                "expected_count": 2, "complete": False, "stages": {"profiles": {
                "acquired_symbols": ["VCB"], "failed_symbols": ["VNM"], "pending_count": 1,
                "receipts": {"VNM": receipt, "VCB": {"private_other_symbol": True}}}}, "unrelated": "not exposed"}),
        SyncStatus(id=2, sync_type="supplemental_company_maintenance", status="completed",
            started_at=datetime(2026, 10, 2), additional_data={"stages": {"profiles": {
                "receipts": {"VCB": {"outcome": "success"}}}}}),
        SyncStatus(id=3, sync_type="daily_profile_maintenance", status="completed",
            started_at=datetime(2026, 10, 3), additional_data={"expected_symbols": ["VNM"],
                "expected_count": 1, "complete": True, "stages": {"profiles": {
                "acquired_symbols": ["VNM"], "failed_symbols": [], "pending_count": 0,
                "receipts": {"VNM": {"outcome": "succeeded", "owner": "daily_profile"}}}}}),
        SyncStatus(id=4, sync_type="daily_financial_maintenance", status="completed",
            started_at=datetime(2026, 10, 4), additional_data={"stages": {"ratios_year": {
                "receipts": {"VNM": {"outcome": "succeeded", "owner": "daily_financial"}}}}}),
        SyncStatus(id=5, sync_type="financial_ratios_maintenance", status="completed",
            started_at=datetime(2026, 10, 5), additional_data={"stages": {"ratios_quarter": {
                "receipts": {"VNM": {"outcome": "succeeded", "owner": "ratios_quarter"}}}}}),
    ])
    await test_db.commit()
    monkeypatch.setattr(server, "async_session_maker", async_sessionmaker(test_engine, expire_on_commit=False))
    async def available():
        return True
    monkeypatch.setattr(server, "check_database_connection", available)

    result = await server.get_ingestion_receipts("VNM", "profiles", limit=1)
    assert result["source"] == "postgres:sync_status"
    assert result["row_count"] == len(result["items"]) == 1
    # Newest matching cycle wins: the daily profile owner, not the older legacy row.
    assert result["items"][0]["record_id"] == 3
    assert result["items"][0]["receipt"] == {"outcome": "succeeded", "owner": "daily_profile"}
    assert result["items"][0]["expected_count"] == 1
    assert result["items"][0]["pending_count"] == 0
    assert result["items"][0]["complete"] is True
    history = await server.get_ingestion_receipts("VNM", "profiles", limit=3)
    assert [item["record_id"] for item in history["items"]] == [3, 1]
    assert history["items"][1]["record_id"] == 1 and history["items"][1]["receipt"] == receipt
    assert history["items"][1]["expected_count"] == 2
    assert history["items"][1]["pending_count"] == 1
    assert history["items"][1]["complete"] is False
    assert "unrelated" not in history["items"][1]
    assert "private_other_symbol" not in str(history)
    empty = await server.get_ingestion_receipts("VNM", "profiles", limit=0)
    assert empty["row_count"] == 0 and empty["items"] == []
    profiles = await server.get_ingestion_receipts("VNM", "profiles", limit=2)
    assert [item["record_id"] for item in profiles["items"]] == [3, 1]
    assert profiles["items"][0]["receipt"]["owner"] == "daily_profile"
    ratios_year = await server.get_ingestion_receipts("VNM", "ratios_year", limit=2)
    assert [item["record_id"] for item in ratios_year["items"]] == [4]
    assert ratios_year["items"][0]["expected_count"] is None
    assert ratios_year["items"][0]["complete"] is None
    ratios_quarter = await server.get_ingestion_receipts("VNM", "ratios_quarter", limit=2)
    assert [item["record_id"] for item in ratios_quarter["items"]] == [5]
    legacy_only = await server.get_ingestion_receipts("VNM", "officers", limit=2)
    assert legacy_only["row_count"] == 0 and legacy_only["items"] == []


@pytest.mark.asyncio
@pytest.mark.parametrize("root_complete", [False, True])
@pytest.mark.parametrize("unattempted_symbol", [False, True])
@pytest.mark.parametrize("outcome, revalidation_pending, pending_count", [
    ("succeeded", False, 0),
    ("empty", False, 0),
    ("failed", False, 1),
    ("deferred", False, 1),
    ("attempted", False, 1),
    ("pending", False, 1),
    ("empty", True, 1),
])
async def test_ingestion_receipt_stage_completion_uses_root_universe_and_outstanding_receipts(
    monkeypatch, test_engine, test_db, root_complete, unattempted_symbol, outcome, revalidation_pending, pending_count
):
    from datetime import datetime

    from vnibb.models.sync_status import SyncStatus

    receipt = {"outcome": outcome, "rows": 0, "revalidation_pending": revalidation_pending}
    test_db.add(SyncStatus(
        id=1, sync_type="daily_profile_maintenance", status="completed",
        started_at=datetime(2026, 10, 3), additional_data={
            "expected_symbols": ["VCB", "VNM"] + (["NEW"] if unattempted_symbol else []),
            "expected_count": 2 + int(unattempted_symbol), "complete": root_complete,
            "stages": {"profiles": {
                "acquired_symbols": ["VCB", "VNM", "RETIRED"], "failed_symbols": [],
                "pending_count": 0,
                "receipts": {"VNM": receipt, "VCB": {"outcome": "succeeded"},
                             "RETIRED": {"outcome": "deferred"}},
            }},
        },
    ))
    await test_db.commit()
    monkeypatch.setattr(server, "async_session_maker", async_sessionmaker(test_engine, expire_on_commit=False))

    async def available():
        return True

    monkeypatch.setattr(server, "check_database_connection", available)
    result = await server.get_ingestion_receipts("VNM", "profiles", limit=1)

    item = result["items"][0]
    assert item["expected_count"] == 2 + int(unattempted_symbol)
    assert item["pending_count"] == pending_count + int(unattempted_symbol)
    assert item["complete"] is (pending_count == 0 and not unattempted_symbol)
    assert item["receipt"] == receipt
    assert "RETIRED" not in str(result)


@pytest.mark.asyncio
async def test_selected_store_empty_batch_metadata_survives_public_tool(monkeypatch):
    class EmptyRows(list):
        metadata = {"source_collection": "market_intraday_trades", "source_date": "2020-01-01",
                    "latest_session_status": "empty", "batch_updated_at": "2026-10-01"}
    class MongoService(_FakeMongoService):
        async def get_intraday_trades(self, *args, **kwargs):
            return EmptyRows()
    monkeypatch.setattr(server, "get_mongo_market_data_service", MongoService)
    result = await server.get_intraday_trades("VNM")
    assert result["source"] == "mongodb:market_intraday_trades"
    assert result["row_count"] == 0 and result["items"] == []
    assert result["source_date"] == "2020-01-01"
    assert result["batch_updated_at"] == "2026-10-01"
    assert result["latest_session_status"] == "empty"


@pytest.mark.asyncio
@pytest.mark.parametrize("bound", ["", " ", "2026-02-30", "2026-10-01T00:00:00Z"])
async def test_public_price_tools_reject_invalid_explicit_dates(monkeypatch, bound):
    async def available():
        return True
    monkeypatch.setattr(server, "check_database_connection", available)
    monkeypatch.setattr(server, "get_mongo_market_data_service", _FakeMongoService)
    with pytest.raises(ValueError):
        await server.get_symbol_prices("VNM", start_date=bound)
    with pytest.raises(ValueError):
        await server.get_eod_price_history("VNM", end_date=bound)


@pytest.mark.asyncio
async def test_public_tool_rejects_nonfinite_decimal_and_keeps_safe_scalar_types(monkeypatch):
    from decimal import Decimal
    class NumericMongo(_FakeMongoService):
        value = Decimal("NaN")
        async def get_raw_dataset_records_precise(self, *args, **kwargs):
            return [{"raw": {"value": self.value, "integer": 2**53 - 1, "boolean": True,
                             "float": 1.25, "missing": None}}]
    fake = NumericMongo()
    monkeypatch.setattr(server, "get_mongo_market_data_service", lambda: fake)
    for value in [Decimal("NaN"), Decimal("Infinity"), Decimal("-Infinity")]:
        fake.value = value
        with pytest.raises(ValueError, match="Nonfinite"):
            await server.get_premium_dataset("VNM", "company.info")
    fake.value = Decimal("0.100000000000000000000000000001")
    result = await server.get_premium_dataset("VNM", "company.info")
    assert result["items"][0]["raw"] == {"value": "0.100000000000000000000000000001",
        "integer": 2**53 - 1, "boolean": True, "float": 1.25, "missing": None}


@pytest.mark.asyncio
async def test_retrieval_time_does_not_replace_stored_observation_time(monkeypatch):
    source_row = {"sourceCollection": "market_intraday_trades", "source": "vnstock", "providerSource": "VCI",
                  "sourceDate": "2020-01-01", "observedAt": "2020-01-01T09:00:00", "updatedAt": "2026-10-01T12:00:00",
                  "priceUnit": "VND", "recordKey": "VNM:old-trade", "volume": 0}
    class MongoService(_FakeMongoService):
        async def get_intraday_trades(self, *args, **kwargs):
            return [source_row]
    monkeypatch.setattr(server, "get_mongo_market_data_service", MongoService)
    first = await server.get_intraday_trades("VNM")
    second = await server.get_intraday_trades("VNM")
    assert first["items"] == second["items"] == [source_row]
    assert first["retrieved_at"] <= second["retrieved_at"]
    assert second["source"] == "mongodb:market_intraday_trades"
    assert second["freshness"].startswith("not_assessed")


@pytest.mark.asyncio
async def test_eod_rows_expose_canonical_session_time(monkeypatch):
    from datetime import datetime

    class MongoService(_FakeMongoService):
        async def get_eod_prices_between(self, symbol, *, start_date, end_date, limit, include_provenance):
            assert include_provenance is True
            return [{"symbol": symbol, "tradeDate": datetime(2026, 9, 30, 7, 0), "priceUnit": "VND",
                     "close": 59400.0, "source": "vietcap"}]

    monkeypatch.setattr(server, "get_mongo_market_data_service", MongoService)
    result = await server.get_eod_price_history("VNM", start_date="2026-09-01", end_date="2026-10-01")

    item = result["items"][0]
    assert item["time"] == "2026-09-30"
    assert item["tradeDate"] == "2026-09-30T07:00:00"
    assert item["price_unit"] == "VND"
    assert result["price_unit"] == "VND"
