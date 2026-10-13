import sys
from types import ModuleType

import pytest

from scripts.vietcap import backfill_vietcap


@pytest.fixture(autouse=True)
def isolated_checkpoint(monkeypatch, tmp_path):
    monkeypatch.setenv("VNIBB_BACKFILL_CHECKPOINT", str(tmp_path / "checkpoint.json"))


def test_exact_success_receipt_replaces_fresh_date_heuristic():
    state = {"receipts": {"AAA": {"ohlc": {"outcome": "succeeded"}}, "BBB": {"ohlc": {"outcome": "failed"}}}}
    assert backfill_vietcap.completed_pair(state, "AAA", "ohlc")
    assert not backfill_vietcap.completed_pair(state, "BBB", "ohlc")


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


def test_default_inventory_never_requires_mongo_or_provider(monkeypatch, capsys):
    monkeypatch.delenv("MONGODB_URL", raising=False)
    monkeypatch.setattr(backfill_vietcap, "load_env_file", lambda _: None)
    monkeypatch.setattr(backfill_vietcap, "VietcapClient", lambda: (_ for _ in ()).throw(AssertionError("provider constructed")))
    monkeypatch.setattr(sys, "argv", ["backfill_vietcap.py"])
    assert backfill_vietcap.main() == 0
    assert '"mode": "read_only"' in capsys.readouterr().out


def test_applied_backfill_requires_mongodb_url(monkeypatch):
    monkeypatch.delenv("MONGODB_URL", raising=False)
    monkeypatch.setattr(backfill_vietcap, "load_env_file", lambda _: None)
    monkeypatch.setattr(backfill_vietcap, "VietcapClient", FakeVietcapClient)
    monkeypatch.setattr(sys, "argv", ["backfill_vietcap.py", "--apply"])
    with pytest.raises(SystemExit, match="MONGODB_URL is required"):
        backfill_vietcap.main()


def test_cli_rejects_unknown_datasets(monkeypatch):
    monkeypatch.setattr(backfill_vietcap, "load_env_file", lambda _: None)
    monkeypatch.setattr(sys, "argv", ["backfill_vietcap.py", "--datasets", "typo"])
    with pytest.raises(SystemExit) as error:
        backfill_vietcap.main()
    assert error.value.code == 2


def test_cli_caught_failure_is_nonzero(monkeypatch, capsys, fake_mongo):
    class FailedClient(FakeVietcapClient):
        def get_statistics_financial(self, symbol):
            raise RuntimeError("API unavailable")

    monkeypatch.setattr(backfill_vietcap, "load_env_file", lambda _: None)
    monkeypatch.setenv("MONGODB_URL", "mongodb://fixture")
    monkeypatch.setattr(backfill_vietcap, "VietcapClient", FailedClient)
    monkeypatch.setattr(sys, "argv", ["backfill_vietcap.py", "--symbols", "AAA", "--datasets", "ratios", "--apply"])
    assert backfill_vietcap.main() == 1
    assert '"errors": 1' in capsys.readouterr().out


def test_cli_empty_requested_data_is_nonzero(monkeypatch, capsys, fake_mongo):
    class EmptyClient(FakeVietcapClient):
        def get_statistics_financial(self, symbol):
            return []

    monkeypatch.setattr(backfill_vietcap, "load_env_file", lambda _: None)
    monkeypatch.setenv("MONGODB_URL", "mongodb://fixture")
    monkeypatch.setattr(backfill_vietcap, "VietcapClient", EmptyClient)
    monkeypatch.setattr(sys, "argv", ["backfill_vietcap.py", "--symbols", "AAA", "--datasets", "ratios", "--apply"])
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
    from vnibb.services.vietcap_financials import financial_fiscal_basis

    records = []
    raw = {"yearReport": 2018, "year": "2018", "quarter": 5, "ratioType": "RATIO_YEAR", "ratioYearId": 12238614, "ratioTTMId": 12238614, "unit": "ratio", "pe": 12}
    assert upsert_ratio_rows(None, "VNM", [raw], com_type="CT", records=records, dry_run=True) == 1
    doc = records[0]
    assert doc["datasetVariant"] == "finance.ratio.year"
    assert doc["recordKey"] == "vietcap:finance.ratio:VNM:2018-Q5:RATIO_YEAR"
    assert doc["fiscalQuarter"] is None
    assert doc["period"] == "2018"
    basis = financial_fiscal_basis(doc)
    assert (basis["period"], basis["periodType"], basis["year"], basis["quarter"]) == (
        "2018", "year", 2018, None,
    )
    assert doc["raw"] == raw
    assert doc["rawFiscalBasis"]["ratioYearId"] == doc["rawFiscalBasis"]["ratioTTMId"] == 12238614
    assert doc["unitEvidence"] == {"unit": "ratio"}
    assert not doc["structured"]["values"]
    assert basis["reason"] is None
    legacy = {**doc, "period": "2018-Q5"}
    assert financial_fiscal_basis(legacy)["reason"] == "contradictory"
    assert financial_fiscal_basis(legacy)["period"] is None
    conflict = {**doc, "raw": {**raw, "year": "2019"}}
    assert financial_fiscal_basis(conflict)["reason"] == "contradictory"
    ttm = {**doc, "datasetVariant": "finance.ratio.quarter", "periodType": "QUARTER",
           "period": "2018-Q1", "fiscalQuarter": 1,
           "raw": {**raw, "quarter": 1, "ratioType": "RATIO_TTM"}}
    assert financial_fiscal_basis(ttm)["reason"] == "ratio_ttm"
    assert financial_fiscal_basis(ttm)["period"] is None
    ttm["raw"]["fiscalQuarter"] = "1"
    assert financial_fiscal_basis(ttm)["reason"] == "ratio_ttm"
    ttm["raw"]["fiscalQuarter"] = 2
    assert financial_fiscal_basis(ttm)["reason"] == "contradictory"
    ttm["datasetVariant"] = "finance.ratio.ttm"
    ttm["periodType"] = "TTM"
    ttm["fiscalQuarter"] = None
    assert financial_fiscal_basis(ttm)["reason"] == "contradictory"



@pytest.mark.parametrize("raw,expected_variant,expected_period", [
    ({"yearReport": 2018, "year": "2018", "quarter": 1, "ratioType": "RATIO_TTM", "ratioTTMId": 5}, "ttm", None),
    ({"yearReport": 2018, "year": "2018", "quarter": None, "ratioTTMId": 5}, "ttm", None),
    ({"yearReport": 2018, "year": "2018", "quarter": 2, "ratioType": "RATIO_YEAR", "ratioTTMId": 5}, "year", None),
    ({"yearReport": 2018, "year": "2018", "quarter": 5, "ratioType": "RATIO_YEAR", "ratioTTMId": 5}, "year", "2018"),
])
def test_ttm_rows_claim_no_identity_and_explicit_ratio_type_governs(
    raw, expected_variant, expected_period
):
    from vnibb.services.vietcap_financials import financial_fiscal_basis
    from vnibb.services.vietcap_ingestion import upsert_ratio_rows

    records = []
    assert upsert_ratio_rows(None, "VNM", [raw], com_type="CT", records=records, dry_run=True) == 1
    doc = records[0]
    assert doc["datasetVariant"] == f"finance.ratio.{expected_variant}"
    assert financial_fiscal_basis(doc)["period"] == expected_period
    assert doc["recordKey"].endswith(f":{raw.get('ratioType') or 'RATIO'}")
    assert doc["raw"] == raw
    reason = financial_fiscal_basis(doc)["reason"]
    if expected_variant == "ttm":
        assert reason == "ratio_ttm" and doc["periodType"] is None and doc["fiscalQuarter"] is None
    elif expected_period is None:
        assert reason == "contradictory"
    else:
        assert reason is None, "admitted canonical rows must carry no conflict reason"



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


def test_metric_map_preserves_symbol_hierarchy_and_bounded_filter():
    from vnibb.services.vietcap_ingestion import upsert_metric_map

    class Collection:
        def bulk_write(self, operations, ordered):
            self.operation = operations[0]

    collection = Collection()
    descriptors = [{"field": None}, {"field": "a", "parent": "ROOT"}, {"field": "a", "extra": None}]
    assert upsert_metric_map({"market_financial_metric_map": collection}, "CT", {"INCOME_STATEMENT": descriptors}, symbol="VNM", dry_run=False) == 1
    assert collection.operation._filter == {"symbol": "VNM", "comTypeCode": "CT", "section": "INCOME_STATEMENT", "source": "vietcap"}
    stored = collection.operation._doc["$set"]
    assert stored["descriptors"] == descriptors
    assert stored["descriptorEvidence"]["symbol"] == "VNM"
    assert stored["schemaVersion"] == 3
    assert "symbolDescriptors" not in stored
    assert upsert_metric_map(None, None, {"INCOME_STATEMENT": descriptors}, symbol="VNM", dry_run=False) == 0


def test_metric_map_index_cutover_fails_closed_and_drops_only_obsolete_unique():
    from vnibb.services.vietcap_ingestion import ensure_metric_map_indexes

    class Collection:
        def __init__(self):
            self.calls = []

        def list_indexes(self):
            keys = {"comTypeCode": 1, "section": 1, "source": 1}
            return [{"name": "actual_legacy_name", "key": keys, "unique": True},
                    {"name": "retained_read_index", "key": keys},
                    {"name": "_id_", "key": {"_id": 1}, "unique": True}]

        def create_index(self, keys, **options):
            self.calls.append(("create", keys, options))

        def drop_index(self, name):
            self.calls.append(("drop", name))

    collection = Collection()
    db = {"market_financial_metric_map": collection}
    with pytest.raises(RuntimeError, match="actual_legacy_name"):
        ensure_metric_map_indexes(db)
    assert len(collection.calls) == 1
    assert collection.calls[0][2]["partialFilterExpression"] == {"symbol": {"$type": "string"}}
    assert ensure_metric_map_indexes(db, drop_obsolete=True) == ["actual_legacy_name"]
    assert collection.calls[-1] == ("drop", "actual_legacy_name")


def test_metric_map_migration_retains_only_exact_evidence_and_is_additive():
    from copy import deepcopy
    from datetime import datetime
    from types import SimpleNamespace
    from bson import ObjectId
    from vnibb.services.vietcap_ingestion import migrate_metric_maps

    received = datetime(2025, 1, 1)
    descriptors = [{"field": None}, {"field": "a"}, {"field": "a"}]
    legacy_id, inline_id = ObjectId(), ObjectId()
    legacy = {"_id": legacy_id, "comTypeCode": "CT", "section": "INCOME_STATEMENT", "source": "vietcap",
              "createdAt": received, "symbolDescriptors": {
                  "AAA": {"symbol": "AAA", "descriptors": descriptors, "receivedAt": received,
                          "endpoint": "/v1/company/AAA/financial-statement/metrics"},
                  "BBB": {"symbol": "AAA", "descriptors": descriptors, "receivedAt": received}}}
    key = {"symbol": "BBB", "comTypeCode": "CT", "section": "INCOME_STATEMENT", "source": "vietcap"}
    inline = {"_id": inline_id, **key, "descriptors": [{"field": "b"}], "descriptorEvidence": {
        **key, "receivedAt": received, "endpoint": "/v1/company/BBB/financial-statement/metrics"}}
    original = deepcopy(legacy)

    class Cursor(list):
        def sort(self, *args):
            return self

    class Collection:
        def __init__(self, rows):
            self.rows = rows
            self.inserted = {}

        def find(self, query, *args):
            return Cursor([] if "migrationSource.documentId" in query else self.rows)

        def list_indexes(self):
            return []

        def create_index(self, *args, **kwargs):
            pass

        def update_one(self, query, update, upsert):
            identity = tuple(query.items())
            if identity in self.inserted:
                return SimpleNamespace(upserted_id=None)
            self.inserted[identity] = update["$setOnInsert"]
            return SimpleNamespace(upserted_id=identity)

    maps = Collection([legacy])
    records = Collection([inline, {**inline, "_id": "contradiction", "symbol": "CCC"}])
    db = {"market_financial_metric_map": maps, "market_vnstock_premium_records": records}
    assert migrate_metric_maps(db)["eligible"] == 2
    assert not maps.inserted
    report = migrate_metric_maps(db, apply=True)
    assert (report["inserted"], report["rejected"]) == (2, 2)
    assert legacy == original
    stored = {document["symbol"]: document for document in maps.inserted.values()}
    assert stored["AAA"]["descriptors"] == descriptors
    assert stored["AAA"]["receivedAt"] == received
    assert stored["AAA"]["migrationSource"] == {"collection": "market_financial_metric_map", "documentId": str(legacy_id), "path": "symbolDescriptors.AAA", "createdAt": received}
    assert "createdAt" not in stored["AAA"]
    assert "updatedAt" not in stored["AAA"]
    assert stored["BBB"]["descriptorEvidence"] == inline["descriptorEvidence"]
    assert stored["BBB"]["migrationSource"]["documentId"] == str(inline_id)
    assert migrate_metric_maps(db, apply=True)["existing"] == 2


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
        def get_ohlc(self, symbol, *, count_back, to_epoch=None):
            return {"o": [1], "h": [2], "l": [1], "c": [2], "v": [3], "t": [1720000000]}

    captured = []
    order = []

    async def persist_listing(trading, search):
        order.append("listing")
        return 1

    async def persist(symbol, rows, **kwargs):
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
        def get_ohlc(self, symbol, *, count_back, to_epoch=None):
            return {"o": [1], "h": [2], "l": [1], "c": [2], "v": [3], "t": [1720000000]}

    order = []

    async def listings(trading, search):
        order.append("listing")
        return 1

    async def prices(symbol, rows, **kwargs):
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


def test_receipt_snapshot_survives_later_dataset_failure():
    from datetime import datetime

    path = backfill_vietcap.Path(backfill_vietcap.os.environ["VNIBB_BACKFILL_CHECKPOINT"])
    state = backfill_vietcap.load_checkpoint(path, {"source": "vietcap"})
    details = {"company_error": "API unavailable", "sourceResponse": {"receivedAt": datetime(2026, 10, 13, 12)}}
    backfill_vietcap.save_receipt(path, state, "AAA", "company", "failed", details)
    details["company_error"] = "rewritten later"
    details["sourceResponse"]["receivedAt"] = datetime(2030, 1, 1)
    backfill_vietcap.save_receipt(path, state, "AAA", "ohlc", "failed", {"ohlc_error": "boom"})
    saved = backfill_vietcap.load_checkpoint(path, {"source": "vietcap"})["receipts"]["AAA"]["company"]["details"]
    assert saved["company_error"] == "API unavailable"
    assert saved["sourceResponse"]["receivedAt"] == str(datetime(2026, 10, 13, 12))


def test_persisted_pair_cursor_resumes_company_after_recurring_ohlc_failure(monkeypatch, fake_mongo):
    from vnibb.services import vietcap_financials, vietcap_ingestion

    class Client(FakeVietcapClient):
        def get_ohlc(self, symbol, *, count_back, to_epoch=None):
            raise RuntimeError("OHLC provider down")

        def get_company_details(self, symbol):
            return {"organName": "Fixture Co"}

    def pack(db, collection, symbol, rows, *, dry_run):
        return len(rows) if rows else 1

    monkeypatch.setenv("MONGODB_URL", "mongodb://fixture")
    monkeypatch.setattr(backfill_vietcap, "load_env_file", lambda _: None)
    monkeypatch.setattr(backfill_vietcap, "VietcapClient", Client)
    monkeypatch.setattr(backfill_vietcap, "upsert_eod_rows", pack)
    monkeypatch.setattr(vietcap_ingestion, "upsert_listing_rows", lambda *a, **k: 1)

    async def listings(trading, search):
        return len(trading)

    monkeypatch.setattr(vietcap_financials, "persist_vietcap_listings", listings)
    monkeypatch.setattr(vietcap_ingestion, "upsert_company_profile", lambda *a, **k: 1)

    def base_argv(*datasets):
        return ["backfill_vietcap.py", "--symbols", "AAA", "--datasets", ",".join(datasets),
                "--apply", "--max-pairs", "1", "--checkpoint-file",
                backfill_vietcap.os.environ["VNIBB_BACKFILL_CHECKPOINT"]]

    monkeypatch.setattr(sys, "argv", base_argv("ohlc,company"))
    assert backfill_vietcap.main() == 1
    monkeypatch.setattr(sys, "argv", base_argv("ohlc,company"))
    assert backfill_vietcap.main() == 0
    state = backfill_vietcap.json.loads(
        backfill_vietcap.Path(backfill_vietcap.os.environ["VNIBB_BACKFILL_CHECKPOINT"]).read_text()
    )
    assert state["receipts"]["AAA"]["company"]["outcome"] == "succeeded"
    assert state["receipts"]["AAA"]["company"]["details"]["company"] == 1


def test_cli_retains_invalid_source_bars_and_reports_failed_partial_window(monkeypatch, fake_mongo):
    from datetime import UTC, datetime
    from unittest.mock import AsyncMock

    from vnibb.services import cache_manager, vietcap_financials, vietcap_ingestion

    timestamps = [int(datetime(2013, 6, day, tzinfo=UTC).timestamp()) for day in (20, 21, 22)]

    class Client(FakeVietcapClient):
        def get_ohlc(self, symbol, *, count_back, to_epoch=None):
            # Middle bar reproduces the observed AAA source bounds discrepancy.
            return {"o": [3694.95] * 3, "h": [3694.95] * 3, "l": [3694.95] * 3,
                    "c": [3694.95, 3722.12, 3694.95], "v": [11900, 11900, None], "t": timestamps}

    mongo_rows = []

    def preserve(db, collection, symbol, rows, *, dry_run):
        mongo_rows.extend(rows)
        return len(rows)

    cache = AsyncMock()
    cache.store_historical_prices.return_value = 1

    async def listings(trading, search):
        return 1

    monkeypatch.setenv("MONGODB_URL", "mongodb://fixture")
    monkeypatch.setattr(backfill_vietcap, "load_env_file", lambda _: None)
    monkeypatch.setattr(backfill_vietcap, "VietcapClient", Client)
    monkeypatch.setattr(backfill_vietcap, "upsert_eod_rows", preserve)
    monkeypatch.setattr(vietcap_ingestion, "upsert_listing_rows", lambda *a, **k: 1)
    monkeypatch.setattr(vietcap_financials, "persist_vietcap_listings", listings)
    monkeypatch.setattr(cache_manager, "CacheManager", lambda: cache)
    monkeypatch.setattr(sys, "argv", ["backfill_vietcap.py", "--symbols", "AAA", "--datasets", "ohlc", "--apply"])

    assert backfill_vietcap.main() == 1
    state = backfill_vietcap.json.loads(backfill_vietcap.Path(backfill_vietcap.os.environ["VNIBB_BACKFILL_CHECKPOINT"]).read_text())
    receipt = state["receipts"]["AAA"]["ohlc"]
    assert receipt["outcome"] == "failed"
    assert not backfill_vietcap.completed_pair(state, "AAA", "ohlc")
    details = receipt["details"]
    assert details["ohlc"]["rows"] == len(mongo_rows) == 3
    assert details["ohlc"]["history_complete"] is None
    assert mongo_rows[1]["close"] == mongo_rows[1]["raw"]["c"] == 3722.12
    assert details["price_admission"] == {
        "source_rows": 3, "admitted_rows": 1, "rejected_rows": 2,
        "rejected_reasons": {"invalid_ohlc_bounds": 1, "missing_negative_or_nonfinite_ohlcv": 1},
        "admitted_first": "2013-06-20", "admitted_last": "2013-06-20",
        "persisted_rows": 1, "persisted_first": "2013-06-20", "persisted_last": "2013-06-20",
        "classification": "partial_source_invalid",
    }
    assert details["structured_price_rows"] == 1
    assert "2 source rows unadmitted; 1/3 SQL rows persisted" in details["ohlc_error"]
    persisted = cache.store_historical_prices.call_args.args[1]
    assert len(persisted) == 1
    assert persisted[0]["time"].isoformat() == "2013-06-20"
    assert persisted[0]["open"] == persisted[0]["high"] == persisted[0]["low"] == persisted[0]["close"] == 3694.95
    assert persisted[0]["volume"] == 11900
