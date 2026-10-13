import sys
from types import ModuleType
from unittest.mock import ANY

import pytest

from scripts.vietcap import backfill_vietcap


def test_select_symbols_for_fresh_ohlc_filters_before_limit_for_ohlc_only():
    symbols, skipped_fresh = backfill_vietcap.select_symbols_for_fresh_ohlc(
        ["AAA", "BBB", "CCC"], {"AAA", "CCC"}, ohlc_only=True
    )

    assert symbols[:1] == ["BBB"]
    assert skipped_fresh == 2


def test_select_symbols_for_fresh_ohlc_keeps_mixed_datasets_symbols():
    symbols, skipped_fresh = backfill_vietcap.select_symbols_for_fresh_ohlc(
        ["AAA", "BBB"], {"AAA"}, ohlc_only=False
    )

    assert symbols == ["AAA", "BBB"]
    assert skipped_fresh == 1


class FakeDatabase:
    def __init__(self):
        self.pipeline = None

    def __getitem__(self, name):
        assert name == "market_prices_eod"
        return self

    def aggregate(self, pipeline):
        self.pipeline = pipeline
        return [{"_id": "AAA"}]


class FakeMongoClient:
    database = FakeDatabase()

    def __init__(self, url, **kwargs):
        self.url = url

    def __getitem__(self, name):
        assert name == "vnibb-market"
        return self.database


class FakeVietcapClient:
    def get_all_symbols(self):
        return [
            {"symbol": "AAA", "type": "STOCK"},
            {"symbol": "BBB", "type": "STOCK"},
        ]

    def get_ohlc(self, symbol, *, count_back):
        raise AssertionError(f"fresh OHLC should not be fetched: {symbol}")

    def get_statistics_financial(self, symbol):
        return [{"symbol": symbol}]


    def get_company_search_bar(self):
        return [{"code": "AAA", "comTypeCode": "CT"}, {"code": "BBB", "comTypeCode": "NH"}]

@pytest.fixture
def fake_mongo(monkeypatch):
    module = ModuleType("pymongo")
    module.MongoClient = FakeMongoClient
    monkeypatch.setitem(sys.modules, "pymongo", module)


def test_ensure_indexes_creates_global_latest_date_index_in_key_order() -> None:
    class Collection:
        def __init__(self) -> None:
            self.indexes = []

        def create_index(self, keys, **options) -> None:
            self.indexes.append((keys, options))

    class Database:
        def __init__(self) -> None:
            self.collections = {}

        def __getitem__(self, name):
            return self.collections.setdefault(name, Collection())

    database = Database()
    backfill_vietcap._ensure_indexes(database)

    assert ([('tradeDate', -1)], {"name": "idx_tradeDate_desc"}) in database[
        "market_prices_eod"
    ].indexes


def test_skip_fresh_through_dry_run_requires_mongodb_url(monkeypatch):
    monkeypatch.delenv("MONGODB_URL", raising=False)
    monkeypatch.setattr(backfill_vietcap, "load_env_file", lambda _: None)
    monkeypatch.setattr(backfill_vietcap, "VietcapClient", FakeVietcapClient)
    monkeypatch.setattr(sys, "argv", ["backfill_vietcap.py", "--skip-fresh-through", "2026-07-08"])

    with pytest.raises(SystemExit, match="MONGODB_URL is required"):
        backfill_vietcap.main()


def test_skip_fresh_through_dry_run_skips_only_ohlc_for_mixed_datasets(
    monkeypatch, capsys, fake_mongo
):
    monkeypatch.setenv("MONGODB_URL", "mongodb://readonly")
    monkeypatch.setattr(backfill_vietcap, "VietcapClient", FakeVietcapClient)
    monkeypatch.setattr(backfill_vietcap, "ohlc_rows_from_gap_chart", lambda *_: [])
    monkeypatch.setattr(
        "vnibb.services.vietcap_ingestion.upsert_ratio_rows",
        lambda db, symbol, rows, **kwargs: 1,
    )
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "backfill_vietcap.py",
            "--symbols",
            "AAA,BBB",
            "--datasets",
            "ohlc,ratios",
            "--skip-fresh-through",
            "2026-07-08",
            "--limit",
            "1",
        ],
    )

    assert backfill_vietcap.main() == 0

    output = capsys.readouterr().out
    assert '"symbol_count": 1' in output
    assert '"skipped_fresh": 1' in output
    assert '"symbol": "AAA"' in output
    assert '"ohlc": {"skipped_fresh": true}' in output
    assert '"ratios": 1' in output
    assert FakeMongoClient.database.pipeline == [
        {"$match": {"source": "vietcap", "tradeDate": {"$gte": ANY}}},
        {"$group": {"_id": "$symbol"}},
    ]


def test_cli_rejects_unknown_datasets(monkeypatch):
    monkeypatch.setattr(backfill_vietcap, "load_env_file", lambda _: None)
    monkeypatch.setattr(sys, "argv", ["backfill_vietcap.py", "--datasets", "typo"])
    with pytest.raises(SystemExit) as error:
        backfill_vietcap.main()
    assert error.value.code == 2


def test_cli_caught_failure_is_nonzero(monkeypatch, capsys):
    class FailedClient(FakeVietcapClient):
        def get_statistics_financial(self, symbol):
            raise RuntimeError("API unavailable")

    monkeypatch.setattr(backfill_vietcap, "load_env_file", lambda _: None)
    monkeypatch.setattr(backfill_vietcap, "VietcapClient", FailedClient)
    monkeypatch.setattr(sys, "argv", ["backfill_vietcap.py", "--symbols", "AAA", "--datasets", "ratios"])
    assert backfill_vietcap.main() == 1
    assert '"errors": 1' in capsys.readouterr().out


def test_cli_empty_requested_data_is_nonzero(monkeypatch, capsys):
    class EmptyClient(FakeVietcapClient):
        def get_statistics_financial(self, symbol):
            return []

    monkeypatch.setattr(backfill_vietcap, "load_env_file", lambda _: None)
    monkeypatch.setattr(backfill_vietcap, "VietcapClient", EmptyClient)
    monkeypatch.setattr(sys, "argv", ["backfill_vietcap.py", "--symbols", "AAA", "--datasets", "ratios"])
    assert backfill_vietcap.main() == 1
    assert '"unavailable": 1' in capsys.readouterr().out


def test_iq_envelope_rejects_application_failure():
    from vnibb.services.vietcap_client import VietcapClient

    for payload in ({"successful": False, "code": 0, "data": []}, {"code": 500, "data": []}, {"status": "ERROR", "data": []}):
        with pytest.raises(RuntimeError, match="Vietcap API failure"):
            VietcapClient._unwrap(payload)
    assert VietcapClient._unwrap({"successful": True, "code": 0, "data": [1]}) == [1]
    assert VietcapClient._unwrap({"years": []}) == {"years": []}


def test_financial_writer_preserves_variants_types_units_and_evidence():
    from datetime import datetime

    from vnibb.services import vietcap_ingestion as ingestion

    class Collection:
        def __init__(self):
            self.documents = {}
            self.filters = []

        def bulk_write(self, operations, ordered):
            for operation in operations:
                key = tuple(sorted(operation._filter.items()))
                self.filters.append(operation._filter)
                self.documents[key] = operation._doc["$set"]

    collection = Collection()
    db = {"market_vnstock_premium_records": collection}
    receipt = datetime(2026, 10, 13, 12)
    descriptors = [
        {"field": None, "parent": None, "children": [{"field": "keep"}]},
        {"field": "opaque", "titleEn": "Revenue", "unit": "VND"},
        {"field": "repeat", "titleEn": "Revenue", "parent": "opaque"},
        {"field": "repeat", "titleEn": "Other"},
    ]
    statement = {"years": [{"yearReport": 2025, "lengthReport": 5, "opaque": 17, "repeat": None, "publicDate": "2026-03-01T00:00:00Z"}],
                 "quarters": [{"yearReport": 2026, "lengthReport": 2, "opaque": 3}]}
    for _ in range(2):
        assert ingestion.upsert_statement_periods(db, "vnm", "finance.income_statement", "INCOME_STATEMENT", statement,
            com_type="CT", descriptors=descriptors, received_at=receipt, dry_run=False) == 2
    assert len(collection.documents) == 2
    annual, quarter = collection.documents.values()
    assert annual["recordKey"] == "vietcap:finance.income_statement:VNM:FY2025"
    assert annual["datasetVariant"] == "finance.income_statement.year"
    assert quarter["datasetVariant"] == "finance.income_statement.quarter"
    assert annual["comTypeCode"] == "CT"
    assert annual["observedAt"] == annual["receivedAt"] == receipt
    assert annual["sourceDate"].year == 2026
    assert annual["raw"] == statement["years"][0]
    assert annual["rawFiscalBasis"] == {"yearReport": 2025, "lengthReport": 5}
    assert annual["units"] == "unknown"
    assert annual["descriptors"] == descriptors
    assert annual["descriptorEvidence"]["symbol"] == "VNM"
    assert annual["source"] == annual["providerSource"] == "vietcap"
    assert annual["structured"]["values"].get("revenue") is None
    assert all(set(query) == {"dataset", "symbol", "recordKey"} for query in collection.filters)


def test_ohlc_rejects_unequal_arrays():
    from vnibb.services.vietcap_ingestion import ohlc_rows_from_gap_chart

    with pytest.raises(ValueError, match="Unequal OHLC"):
        ohlc_rows_from_gap_chart("VNM", {"o": [1], "h": [2], "l": [1], "c": [2], "v": [], "t": [1]})


def test_listing_writer_keeps_identity_when_metadata_changes():
    from vnibb.services.vietcap_ingestion import upsert_listing_rows

    class Collection:
        def __init__(self):
            self.keys = set()

        def bulk_write(self, operations, ordered):
            for operation in operations:
                self.keys.add(tuple(sorted(operation._filter.items())))
                doc = operation._doc["$set"]
                assert doc["scopeKey"] == "market"
                assert doc["raw"]["searchBar"]["comTypeCode"] == "CT"

    collection = Collection()
    db = {"market_vnstock_premium_records": collection}
    for name in ("Old", "New"):
        assert upsert_listing_rows(db, [{"symbol": "VNM", "board": "HOSE"}], [{"code": "VNM", "name": name, "comTypeCode": "CT"}], dry_run=False) == 1
    assert len(collection.keys) == 1


def test_ratio_annual_variant_retains_original_natural_key_and_units():
    from vnibb.services.vietcap_ingestion import upsert_ratio_rows

    records = []
    raw = {"yearReport": 2025, "year": "2025", "quarter": 5, "ratioType": "RATIO_YEAR", "ratioYearId": 9, "unit": "ratio", "pe": 12}
    assert upsert_ratio_rows(None, "VNM", [raw], com_type="CT", records=records, dry_run=True) == 1
    doc = records[0]
    assert doc["datasetVariant"] == "finance.ratio.year"
    assert doc["recordKey"] == "vietcap:finance.ratio:VNM:2025-Q5:RATIO_YEAR"
    assert doc["fiscalQuarter"] is None
    assert doc["rawFiscalBasis"]["ratioYearId"] == 9
    assert doc["unitEvidence"] == {"unit": "ratio"}
    assert not doc["structured"]["values"]


def test_sync_fetches_symbol_descriptors_once_and_actual_iq_type():
    from vnibb.services.vietcap_ingestion import sync_symbol_financials

    class Client:
        descriptor_calls = 0

        def get_company_search_bar(self):
            return [{"code": "VNM", "comTypeCode": "CT"}]

        def get_financial_metrics_map(self, symbol):
            self.descriptor_calls += 1
            return {section: [{"field": "opaque", "titleEn": "Net sales", "unit": "VND"}] for section in ("INCOME_STATEMENT", "BALANCE_SHEET", "CASH_FLOW")}

        def get_financial_statement(self, symbol, section):
            return {"years": [{"yearReport": 2025, "lengthReport": 5, "opaque": 7}], "quarters": []}

        def get_statistics_financial(self, symbol):
            return [{"yearReport": 2025, "quarter": 5, "ratioType": "RATIO_YEAR"}]

    client = Client()
    records = sync_symbol_financials(None, client, "VNM", dry_run=True)
    assert client.descriptor_calls == 1
    assert len(records) == 4
    assert all(record["comTypeCode"] == "CT" for record in records)
    assert records[0]["structured"]["values"] == {"revenue": 7.0}


def test_ohlc_units_require_actual_instrument_contract():
    from vnibb.services.vietcap_ingestion import ohlc_rows_from_gap_chart

    raw = {"o": [1], "h": [2], "l": [1], "c": [2], "v": [3], "t": [1720000000]}
    assert ohlc_rows_from_gap_chart("VNM", raw, instrument_type="STOCK")[0]["priceUnit"] == "VND"
    assert ohlc_rows_from_gap_chart("VNINDEX", raw)[0]["priceUnit"] == "index_points"
    assert ohlc_rows_from_gap_chart("BOND1", raw, instrument_type="BOND")[0]["priceUnit"] == "unknown"


def test_statement_writer_retains_success_response_lineage():
    from vnibb.services.vietcap_ingestion import upsert_statement_periods

    source = {"successful": True, "code": 0, "status": 200, "traceId": "fixture", "serverDateTime": "2026-10-13T04:00:00"}
    records = []
    upsert_statement_periods(None, "VNM", "finance.income_statement", "INCOME_STATEMENT",
        {"years": [{"yearReport": 2025, "lengthReport": 5}]},
        com_type="CT", descriptors=[{"field": None}], source_response=source,
        descriptor_response=source, records=records, dry_run=True)
    assert records[0]["sourceResponse"] == source
    assert records[0]["descriptorEvidence"]["sourceResponse"] == source


def test_metric_map_preserves_symbol_hierarchy_and_existing_filter():
    from vnibb.services.vietcap_ingestion import upsert_metric_map

    class Collection:
        def bulk_write(self, operations, ordered):
            self.operation = operations[0]

    collection = Collection()
    descriptors = [{"field": None}, {"field": "a", "parent": "ROOT"}, {"field": "a", "extra": None}]
    assert upsert_metric_map({"market_financial_metric_map": collection}, "CT", {"INCOME_STATEMENT": descriptors}, symbol="VNM", dry_run=False) == 1
    assert collection.operation._filter == {"comTypeCode": "CT", "section": "INCOME_STATEMENT", "source": "vietcap"}
    stored = collection.operation._doc["$set"]["symbolDescriptors.VNM"]
    assert stored["descriptors"] == descriptors
    assert upsert_metric_map(None, None, {"INCOME_STATEMENT": descriptors}, symbol="VNM", dry_run=False) == 0


def test_cli_uses_one_loop_and_disposes_engine_before_close(monkeypatch):
    import asyncio

    loops = []

    async def persistence():
        loops.append(asyncio.get_running_loop())
        return 1

    class Engine:
        async def dispose(self):
            loops.append(asyncio.get_running_loop())

    database = ModuleType("vnibb.core.database")
    database.engine = Engine()
    monkeypatch.setitem(sys.modules, "vnibb.core.database", database)

    def fake_main(runner):
        assert runner.run(persistence()) == 1
        assert runner.run(persistence()) == 1
        return 0

    monkeypatch.setattr(backfill_vietcap, "_main", fake_main)
    assert backfill_vietcap.main() == 0
    assert len(loops) == 3
    assert loops[0] is loops[1] is loops[2]
    assert loops[0].is_closed()


def test_cli_reports_partial_structured_count_and_failure(monkeypatch, capsys, fake_mongo):
    from vnibb.services import vietcap_financials, vietcap_ingestion

    async def partial_persist(records):
        raise vietcap_financials.StructuredFinancialUnavailable(3, [("AAA", "finance.ratio", "year")], [])

    def raw_writer(db, symbol, rows, **kwargs):
        kwargs["records"].append({"dataset": "finance.ratio", "structured": {"values": {}, "unavailable": {"pe": "descriptor_unavailable"}}})
        return 1

    monkeypatch.setenv("MONGODB_URL", "mongodb://fixture")
    monkeypatch.setattr(backfill_vietcap, "load_env_file", lambda _: None)
    monkeypatch.setattr(backfill_vietcap, "VietcapClient", FakeVietcapClient)
    monkeypatch.setattr(vietcap_ingestion, "upsert_ratio_rows", raw_writer)
    monkeypatch.setattr(vietcap_financials, "persist_vietcap_financials", partial_persist)
    monkeypatch.setattr(sys, "argv", ["backfill_vietcap.py", "--symbols", "AAA", "--datasets", "ratios", "--apply"])
    assert backfill_vietcap.main() == 1
    output = capsys.readouterr().out
    assert '"structured_rows": 3' in output
    assert '"ratio_rows": 1' in output
    assert '"unavailable": 1' in output


def test_cli_applied_stock_prices_reach_structured_bridge(monkeypatch, capsys, fake_mongo):
    from vnibb.services import vietcap_financials, vietcap_ingestion

    class PriceClient(FakeVietcapClient):
        def get_ohlc(self, symbol, *, count_back):
            return {"o": [1], "h": [2], "l": [1], "c": [2], "v": [3], "t": [1720000000]}

    captured = []
    order = []

    async def persist_listing(trading, search):
        order.append("listing")
        return 1

    async def persist(symbol, rows):
        assert order == ["listing"]
        order.append("prices")
        captured.extend(rows)
        return len(rows)

    monkeypatch.setenv("MONGODB_URL", "mongodb://fixture")
    monkeypatch.setattr(backfill_vietcap, "load_env_file", lambda _: None)
    monkeypatch.setattr(backfill_vietcap, "VietcapClient", PriceClient)
    monkeypatch.setattr(backfill_vietcap, "upsert_eod_rows", lambda *args, **kwargs: 1)
    monkeypatch.setattr(vietcap_financials, "persist_vietcap_prices", persist)
    monkeypatch.setattr(vietcap_ingestion, "upsert_listing_rows", lambda *args, **kwargs: 1)
    monkeypatch.setattr(vietcap_financials, "persist_vietcap_listings", persist_listing)
    monkeypatch.setattr(sys, "argv", ["backfill_vietcap.py", "--symbols", "AAA", "--datasets", "ohlc", "--apply"])
    assert backfill_vietcap.main() == 0
    assert captured[0]["source"] == "vietcap"
    assert captured[0]["priceUnit"] == "VND"
    assert '"structured_price_rows": 1' in capsys.readouterr().out
    assert order == ["listing", "prices"]


def test_selected_listing_persists_before_first_stock_price(monkeypatch, fake_mongo):
    from vnibb.services import vietcap_financials, vietcap_ingestion

    class Client(FakeVietcapClient):
        def get_ohlc(self, symbol, *, count_back):
            return {"o": [1], "h": [2], "l": [1], "c": [2], "v": [3], "t": [1720000000]}

    order = []

    async def listings(trading, search):
        order.append("listing")
        return 1

    async def prices(symbol, rows):
        assert order == ["listing"]
        order.append("prices")
        return 1

    monkeypatch.setenv("MONGODB_URL", "mongodb://fixture")
    monkeypatch.setattr(backfill_vietcap, "load_env_file", lambda _: None)
    monkeypatch.setattr(backfill_vietcap, "VietcapClient", Client)
    monkeypatch.setattr(backfill_vietcap, "upsert_eod_rows", lambda *args, **kwargs: 1)
    monkeypatch.setattr(vietcap_ingestion, "upsert_listing_rows", lambda *args, **kwargs: 1)
    monkeypatch.setattr(vietcap_financials, "persist_vietcap_listings", listings)
    monkeypatch.setattr(vietcap_financials, "persist_vietcap_prices", prices)
    monkeypatch.setattr(sys, "argv", ["backfill_vietcap.py", "--symbols", "AAA", "--datasets", "listing,ohlc", "--apply"])
    assert backfill_vietcap.main() == 0
    assert order == ["listing", "prices"]
