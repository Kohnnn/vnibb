import asyncio
from datetime import date, datetime

import pytest
from pymongo.errors import ConnectionFailure, ExecutionTimeout, OperationFailure

from vnibb.services.mongo_market_data_service import MongoMarketDataService


class Cursor:
    def __init__(self, rows):
        self.rows = rows
        self.maximum = None

    def sort(self, *args):
        return self

    def limit(self, maximum):
        self.maximum = maximum
        return self

    def __iter__(self):
        return iter(self.rows if self.maximum is None else self.rows[:self.maximum])


class Collection:
    def __init__(self, rows=(), error=None):
        self.rows = rows
        self.error = error
        self.query = None

    def find(self, query, projection):
        self.query = query
        if self.error:
            raise self.error
        selected = [
            row for row in self.rows
            if all(row.get(key) == value for key, value in query.items() if not isinstance(value, dict))
        ]
        # Exercise the actual reader projection, not a projection-ignoring stub.
        projected = []
        for row in selected:
            if any(value == 1 for value in projection.values()):
                projected.append({key: value for key, value in row.items() if projection.get(key) == 1})
            else:
                projected.append({key: value for key, value in row.items() if projection.get(key) != 0})
        return Cursor(projected)


READS = [
    ("get_eod_prices", ("VNM",), {}),
    ("get_latest_eod_prices", ("VNM",), {}),
    ("get_eod_prices_between", ("VNM",), {"start_date": date(2026, 1, 1), "end_date": date(2026, 12, 31)}),
    ("get_raw_dataset_records_precise", ("VNM",), {"dataset": "company.info"}),
    ("get_raw_dataset_records", ("VNM",), {"dataset": "company.info"}),
    ("get_intraday_trades", ("VNM",), {}),
    ("get_price_depth_precise", ("VNM",), {}),
    ("get_price_depth", ("VNM",), {}),
]


@pytest.mark.asyncio
@pytest.mark.parametrize("method,args,kwargs", READS)
@pytest.mark.parametrize("error,state", [(ConnectionFailure("secret mongodb://credentials"), "unavailable"), (ExecutionTimeout("secret"), "timeout"), (OperationFailure("secret"), "query_failed")])
async def test_actual_reader_failure_never_becomes_empty(monkeypatch, method, args, kwargs, error, state):
    service = MongoMarketDataService()
    monkeypatch.setattr(service, "_get_collection", lambda _: Collection(error=error))
    with pytest.raises(RuntimeError) as caught:
        await getattr(service, method)(*args, **kwargs)
    assert caught.value.state == state
    assert "secret" not in str(caught.value)


@pytest.mark.asyncio
@pytest.mark.parametrize("method,args,kwargs", READS)
async def test_successful_empty_read_remains_empty(monkeypatch, method, args, kwargs):
    service = MongoMarketDataService()
    monkeypatch.setattr(service, "_get_collection", lambda _: Collection())
    assert await getattr(service, method)(*args, **kwargs) == []


@pytest.mark.asyncio
async def test_inspection_failure_is_not_connected_empty(monkeypatch):
    service = MongoMarketDataService()
    def fail():
        raise OperationFailure("mongodb://secret")
    monkeypatch.setattr(service, "_get_database", fail)
    with pytest.raises(RuntimeError) as caught:
        await service.inspect_collections()
    assert caught.value.state == "query_failed"
    assert "secret" not in str(caught.value)


@pytest.mark.asyncio
async def test_cancellation_propagates(monkeypatch):
    service = MongoMarketDataService()
    def fail(_):
        raise asyncio.CancelledError()
    monkeypatch.setattr(service, "_get_collection", fail)
    with pytest.raises(asyncio.CancelledError):
        await service.get_eod_prices("VNM")


@pytest.mark.asyncio
@pytest.mark.parametrize("dataset", ["company.info", "finance.income_statement", "finance.balance_sheet", "finance.cash_flow", "finance.ratio"])
async def test_stored_full_envelope_reaches_public_mcp(monkeypatch, dataset):
    from vnibb.mcp import server
    from vnibb.services import mongo_market_data_service as module
    envelope = {
        "dataset": dataset, "datasetGroup": dataset.split(".")[0], "datasetVariant": f"{dataset}.year",
        "symbol": "VNM", "scopeType": "symbol", "scopeKey": "VNM", "source": "vietcap",
        "providerSource": "IQ", "recordKey": f"{dataset}:2025", "section": "income",
        "period": "2025", "periodType": "year", "fiscalYear": 2025, "fiscalQuarter": None,
        "schemaVersion": 2, "createdAt": datetime(2026, 1, 2), "syncedAt": datetime(2026, 1, 3),
        "updatedAt": datetime(2026, 1, 3), "observedAt": datetime(2025, 1, 1),
        "sourceDate": None, "receivedAt": datetime(2026, 1, 3), "unit": "VND", "units": {"revenue": "VND"},
        "raw": {"yearReport": 2025, "revenue": 1},
    }
    monkeypatch.setattr(module.settings, "mongodb_enabled", True)
    monkeypatch.setattr(module.settings, "mongodb_url", "mongodb://fixture")
    service = MongoMarketDataService()
    monkeypatch.setattr(service, "_get_collection", lambda _: Collection([envelope]))
    monkeypatch.setattr(server, "get_mongo_market_data_service", lambda: service)
    response = await server.get_premium_dataset("VNM", dataset, **({"period_type": "year"} if dataset.startswith("finance.") else {}))
    assert set(response["items"][0]) == set(envelope)
    assert response["items"][0]["sourceDate"] is None
    assert response["items"][0]["observedAt"].startswith("2025-01-01")


@pytest.mark.asyncio
async def test_market_scope_does_not_bind_outer_symbol(monkeypatch):
    collection = Collection()
    service = MongoMarketDataService()
    monkeypatch.setattr(service, "_get_collection", lambda _: collection)
    await service.get_raw_dataset_records_precise("VNM", dataset="macro.gdp", scope_type="market", scope_key="market")
    assert collection.query == {"dataset": "macro.gdp", "scopeType": "market", "scopeKey": "market"}


@pytest.mark.asyncio
@pytest.mark.parametrize("start,end,key", [(date(2026, 1, 1), None, "$gte"), (None, date(2026, 1, 31), "$lte")])
async def test_eod_one_sided_bounds(monkeypatch, start, end, key):
    collection = Collection()
    service = MongoMarketDataService()
    monkeypatch.setattr(service, "_get_collection", lambda _: collection)
    await service.get_eod_prices_between("VNM", start_date=start, end_date=end)
    assert set(collection.query["tradeDate"]) == {key}


@pytest.mark.asyncio
@pytest.mark.parametrize("period_type", ["YEAR", "Year", " year "])
async def test_period_type_case_preserves_original_envelope(monkeypatch, period_type):
    envelope = {"dataset": "finance.ratio", "symbol": "VNM", "datasetVariant": "finance.ratio.year", "source": "vietcap",
                "periodType": period_type, "period": "FY2025", "fiscalYear": 2025,
                "raw": {"yearReport": 2025, "quarter": 0}}
    service = MongoMarketDataService()
    monkeypatch.setattr(service, "_get_collection", lambda _: Collection([envelope]))
    rows = await service.get_raw_dataset_records_precise("VNM", dataset="finance.ratio", source="vietcap")
    assert rows == [envelope]


@pytest.mark.asyncio
@pytest.mark.parametrize("override", [
    {"fiscalYear": 2024},
    {"period": "2025-Q1"},
    {"raw": {"yearReport": 2025, "quarter": 2}},
    {"datasetVariant": "finance.ratio.ttm", "raw": {"yearReport": 2025, "quarter": 5, "ratioType": "RATIO_YEAR"}},
    {"datasetVariant": "finance.ratio.ttm", "periodType": "year"},
    {"period": "2018-Q5", "raw": {"yearReport": 2018, "quarter": 5, "ratioType": "RATIO_YEAR"}, "fiscalYear": 2019},
    {"period": "2018-Q5", "raw": {"yearReport": 2018, "year": 2019, "quarter": 5, "ratioType": "RATIO_YEAR"}},
])
async def test_contradictory_supplied_identity_still_raises(monkeypatch, override):
    envelope = {"dataset": "finance.ratio", "symbol": "VNM", "datasetVariant": "finance.ratio.year", "source": "vietcap",
                "periodType": "year", "period": "FY2025", "fiscalYear": 2025,
                "raw": {"yearReport": 2025, "quarter": 0}, **override}
    service = MongoMarketDataService()
    monkeypatch.setattr(service, "_get_collection", lambda _: Collection([envelope]))
    with pytest.raises(RuntimeError) as caught:
        await service.get_raw_dataset_records_precise("VNM", dataset="finance.ratio", source="vietcap")
    assert caught.value.state == "invalid_financial_identity"


@pytest.mark.asyncio
@pytest.mark.parametrize("override,reason", [
    # Unsupported basis with no contradicting supplied identity.
    ({"datasetVariant": "finance.ratio.ttm", "periodType": "TTM", "period": None, "fiscalQuarter": None,
      "raw": {"yearReport": 2025, "quarter": 1, "ratioType": "RATIO_TTM", "pe": 1}}, "ratio_ttm"),
    ({"datasetVariant": "finance.ratio.ttm", "periodType": "TTM", "period": None, "fiscalQuarter": None,
      "raw": {"yearReport": 2025, "ratioTTMId": 7, "pe": 1}}, "ratio_ttm"),
    ({"datasetVariant": "finance.ratio.monthly", "periodType": None, "period": None,
      "raw": {"yearReport": 2025, "pe": 1}}, "unsupported_variant:finance.ratio.monthly"),
])
async def test_unrepresentable_period_is_disclosed_not_coerced(monkeypatch, override, reason):
    envelope = {"dataset": "finance.ratio", "symbol": "VNM", "datasetVariant": "finance.ratio.year", "source": "vietcap",
                "recordKey": "vietcap:finance.ratio:VNM:ttm", "periodType": None, "fiscalQuarter": None,
                "period": "FY2025", "fiscalYear": 2025, "raw": {"yearReport": 2025, "quarter": 0, "pe": 1}, **override}
    service = MongoMarketDataService()
    monkeypatch.setattr(service, "_get_collection", lambda _: Collection([envelope]))
    rows = await service.get_raw_dataset_records_precise("VNM", dataset="finance.ratio", source="vietcap")
    assert rows == []
    assert rows.metadata["unrepresentable_financial_identity"] == {envelope["recordKey"]: reason}
    assert rows.metadata["legacy_period_labels"] == []


@pytest.mark.asyncio
async def test_legacy_annual_period_label_disclosed_without_poisoning_read(monkeypatch):
    legacy = {"dataset": "finance.ratio", "symbol": "VNM", "datasetVariant": "finance.ratio.year", "source": "vietcap", "recordKey": "vietcap:finance.ratio:VNM:2025-Q5:RATIO_YEAR",
              "periodType": "YEAR", "period": "2025-Q5", "fiscalYear": 2025, "fiscalQuarter": None, "raw": {"yearReport": 2025, "quarter": 5, "ratioType": "RATIO_YEAR", "pe": 1}}
    canonical = {"dataset": "finance.ratio", "symbol": "VNM", "datasetVariant": "finance.ratio.year", "source": "vietcap", "recordKey": "vietcap:finance.ratio:VNM:FY2024:RATIO_YEAR",
                 "periodType": "year", "period": "FY2024", "fiscalYear": 2024, "raw": {"yearReport": 2024, "quarter": 0, "pe": 2}}
    service = MongoMarketDataService()
    monkeypatch.setattr(service, "_get_collection", lambda _: Collection([legacy, canonical]))
    rows = await service.get_raw_dataset_records_precise("VNM", dataset="finance.ratio", source="vietcap")
    assert rows == [canonical]
    assert rows.metadata["legacy_period_labels"] == [legacy["recordKey"]]
    assert rows.metadata["unrepresentable_financial_identity"] == {}

@pytest.mark.asyncio
@pytest.mark.parametrize("method,args,kwargs", READS)
async def test_zero_page_requires_successful_access(monkeypatch, method, args, kwargs):
    service = MongoMarketDataService()
    monkeypatch.setattr(service, "_get_collection", lambda _: Collection([{"raw": {}, "close": 1, "tradeDate": datetime(2026, 1, 1)}]))
    assert await getattr(service, method)(*args, **kwargs, limit=0) == []
    monkeypatch.setattr(service, "_get_collection", lambda _: Collection(error=ConnectionFailure("secret")))
    with pytest.raises(RuntimeError):
        await getattr(service, method)(*args, **kwargs, limit=0)


@pytest.mark.asyncio
async def test_disabled_reader_is_not_successful_empty(monkeypatch):
    from vnibb.services import mongo_market_data_service as module
    monkeypatch.setattr(module.settings, "mongodb_enabled", False)
    monkeypatch.setattr(module.settings, "mongodb_url", "")
    with pytest.raises(RuntimeError) as caught:
        await MongoMarketDataService().get_eod_prices("VNM")
    assert caught.value.state == "not_configured"


MARKET_DATASETS = ["market.pe", "market.pb", "market.evaluation", "analytics.valuation.pe", "analytics.valuation.pb", "macro.gdp", "macro.cpi", "macro.exchange_rate", "macro.interest_rate", "macro.money_supply", "macro.fdi", "macro.import_export", "macro.industry_prod", "macro.population_labor", "macro.retail"]


def enable_public_reader(monkeypatch, collection):
    from vnibb.mcp import server
    from vnibb.services import mongo_market_data_service as module
    monkeypatch.setattr(module.settings, "mongodb_enabled", True)
    monkeypatch.setattr(module.settings, "mongodb_url", "mongodb://fixture")
    service = MongoMarketDataService()
    monkeypatch.setattr(service, "_get_collection", lambda _: collection)
    monkeypatch.setattr(server, "get_mongo_market_data_service", lambda: service)
    return server


@pytest.mark.asyncio
@pytest.mark.parametrize("dataset", MARKET_DATASETS)
async def test_market_reader_public_tool_ignores_outer_symbol(monkeypatch, dataset):
    collection = Collection([{"dataset": dataset, "scopeType": "market", "scopeKey": "market", "symbol": "VNINDEX", "raw": {"value": 1}}])
    server = enable_public_reader(monkeypatch, collection)
    response = await server.get_premium_dataset("VNM", dataset)
    assert response["row_count"] == 1
    assert collection.query == {"dataset": dataset, "scopeType": "market", "scopeKey": "market"}
    assert response["items"][0]["symbol"] == "VNINDEX"


@pytest.mark.asyncio
@pytest.mark.parametrize("store", ["market_company_profiles", "market_financial_metric_map"])
async def test_reference_envelope_public_tool(monkeypatch, store):
    envelope = {"source": "vietcap", "symbol": "VNM", "schemaVersion": 3, "createdAt": datetime(2025, 1, 1), "descriptors": [{"field": None}, {"field": "a"}, {"field": "a"}], "descriptorEvidence": {"symbol": "VNM"}}
    collection = Collection([envelope])
    server = enable_public_reader(monkeypatch, collection)
    response = await server.get_reference_dataset("VNM", store)
    assert set(response["items"][0]) == set(envelope)
    assert response["items"][0]["descriptors"] == envelope["descriptors"]
    if store == "market_financial_metric_map":
        assert collection.query == {"source": "vietcap", "symbol": "VNM", "schemaVersion": 3}


@pytest.mark.asyncio
async def test_metric_map_same_type_section_stays_independent_through_public_consumer(monkeypatch):
    from copy import deepcopy
    from vnibb.services.vietcap_ingestion import upsert_metric_map

    class WritableCollection(Collection):
        def bulk_write(self, operations, ordered):
            for operation in operations:
                match = next((row for row in self.rows if all(row.get(key) == value for key, value in operation._filter.items())), None)
                if match is None:
                    match = deepcopy(operation._doc.get("$setOnInsert", {}))
                    self.rows.append(match)
                match.update(deepcopy(operation._doc["$set"]))

    legacy = {"source": "vietcap", "comTypeCode": "CT", "section": "INCOME_STATEMENT",
              "schemaVersion": 2, "symbolDescriptors": {"AAA": {"descriptors": [{"field": "historical"}]}}}
    original = deepcopy(legacy)
    collection = WritableCollection([legacy])
    db = {"market_financial_metric_map": collection}
    descriptors = {"AAA": [{"field": None}, {"field": "a"}, {"field": "a"}], "BBB": [{"field": "b"}]}
    for symbol, fields in descriptors.items():
        upsert_metric_map(db, "CT", {"INCOME_STATEMENT": fields}, symbol=symbol, dry_run=False)
    aaa = deepcopy(collection.rows[1])
    upsert_metric_map(db, "CT", {"INCOME_STATEMENT": [{"field": "b2"}]}, symbol="BBB", dry_run=False)
    assert len(collection.rows) == 3
    assert collection.rows[0] == original
    assert collection.rows[1] == aaa
    server = enable_public_reader(monkeypatch, collection)
    for symbol, fields in (("AAA", descriptors["AAA"]), ("BBB", [{"field": "b2"}])):
        response = await server.get_reference_dataset(symbol, "market_financial_metric_map")
        assert len(response["items"]) == 1
        item = response["items"][0]
        assert item["descriptors"] == fields
        assert item["descriptorEvidence"]["symbol"] == symbol
        assert item["descriptorEvidence"]["endpoint"] == f"/v1/company/{symbol}/financial-statement/metrics"
        assert "symbolDescriptors" not in item


@pytest.mark.asyncio
async def test_migrated_objectid_lineage_reaches_public_reference_json(monkeypatch):
    import json
    from copy import deepcopy
    from types import SimpleNamespace
    from bson import ObjectId
    from vnibb.services.vietcap_ingestion import migrate_metric_maps

    original_id = ObjectId()
    received = datetime(2025, 1, 1)
    key = {"symbol": "VNM", "comTypeCode": "CT", "section": "INCOME_STATEMENT", "source": "vietcap"}
    evidence = {**key, "receivedAt": received, "endpoint": "/v1/company/VNM/financial-statement/metrics"}
    descriptors = [{"field": None}, {"field": "a"}, {"field": "a"}]
    legacy = {"_id": original_id, "comTypeCode": "CT", "section": "INCOME_STATEMENT", "source": "vietcap",
              "symbolDescriptors": {"VNM": {"symbol": "VNM", "descriptors": descriptors,
                  "receivedAt": received, "endpoint": evidence["endpoint"]}}}

    class RetainedCollection(Collection):
        def find(self, query, projection=None):
            if "migrationSource.documentId" in query:
                return Cursor([row for row in self.rows if row.get("schemaVersion") == 3
                               and isinstance(row.get("migrationSource", {}).get("documentId"), ObjectId)])
            if isinstance(query.get("symbol"), dict):
                return Cursor([row for row in self.rows if "symbol" not in row])
            return super().find(query, projection or {})

        def list_indexes(self):
            return []

        def create_index(self, *args, **kwargs):
            pass

        def update_one(self, query, update, upsert=False):
            if "$set" in update:
                row = next(row for row in self.rows if row["_id"] == query["_id"])
                assert row["migrationSource"]["documentId"] == query["migrationSource.documentId"]
                row["migrationSource"]["documentId"] = update["$set"]["migrationSource.documentId"]
                return SimpleNamespace(modified_count=1)
            match = next((row for row in self.rows if all(row.get(field) == value for field, value in query.items())), None)
            if match is not None:
                return SimpleNamespace(upserted_id=None)
            row = {"_id": ObjectId(), **deepcopy(update["$setOnInsert"])}
            self.rows.append(row)
            return SimpleNamespace(upserted_id=row["_id"])

    maps = RetainedCollection([legacy])
    db = {"market_financial_metric_map": maps, "market_vnstock_premium_records": RetainedCollection([])}
    assert migrate_metric_maps(db, apply=True)["inserted"] == 1
    server = enable_public_reader(monkeypatch, maps)
    response = await server.get_reference_dataset("VNM", "market_financial_metric_map")
    assert json.loads(json.dumps(response))["items"][0]["migrationSource"]["documentId"] == str(original_id)
    assert response["items"][0]["descriptors"] == descriptors
    assert response["items"][0]["descriptorEvidence"]["symbol"] == "VNM"

    # Repair already migrated ObjectId provenance without touching any other data.
    maps.rows[1]["migrationSource"]["documentId"] = original_id
    before = deepcopy(maps.rows)
    assert migrate_metric_maps(db)["normalizable_ids"] == 1
    assert maps.rows == before
    report = migrate_metric_maps(db, apply=True)
    assert report["normalized_ids"] == 1
    before[1]["migrationSource"]["documentId"] = str(original_id)
    assert maps.rows == before
    response = await server.get_reference_dataset("VNM", "market_financial_metric_map")
    assert json.loads(json.dumps(response))["items"][0]["migrationSource"]["documentId"] == str(original_id)


@pytest.mark.asyncio
@pytest.mark.parametrize("bound", ["start_date", "end_date"])
async def test_eod_public_tool_preserves_source_age_and_one_sided_bound(monkeypatch, bound):
    envelope = {"symbol": "VNM", "tradeDate": datetime(2025, 1, 1), "open": 1, "high": 1, "low": 1, "close": 1, "volume": 1,
                "source": "vietcap", "providerSource": "vietcap", "priceUnit": "VND", "sourceDate": "2025-01-01",
                "receivedAt": datetime(2026, 1, 1), "updatedAt": datetime(2026, 1, 1), "sourceKey": "retained-id"}
    collection = Collection([envelope])
    server = enable_public_reader(monkeypatch, collection)
    for _ in range(2):
        response = await server.get_eod_price_history("VNM", **{bound: "2025-01-01"})
        assert response["items"][0]["sourceDate"] == "2025-01-01"
        assert response["items"][0]["receivedAt"].startswith("2026-01-01")
        assert response["items"][0]["providerSource"] == "vietcap"
    assert set(collection.query["tradeDate"]) == ({"$gte"} if bound == "start_date" else {"$lte"})


@pytest.mark.asyncio
@pytest.mark.parametrize("dataset,section", [("finance.income_statement", "INCOME_STATEMENT"), ("finance.balance_sheet", "BALANCE_SHEET"), ("finance.cash_flow", "CASH_FLOW"), ("finance.ratio", None)])
async def test_actual_iq_writer_envelope_reader_parity(monkeypatch, dataset, section):
    from vnibb.services.vietcap_ingestion import upsert_ratio_rows, upsert_statement_periods
    records = []
    if section:
        upsert_statement_periods({}, "VNM", dataset, section, {"years": [{"yearReport": 2025, "lengthReport": 5, "isa1": 1}]}, descriptors=[], records=records, dry_run=True)
    else:
        upsert_ratio_rows({}, "VNM", [{"yearReport": 2025, "quarter": 5, "ratioType": "RATIO_YEAR", "pe": 1}], records=records, dry_run=True)
    assert len(records) == 1
    server = enable_public_reader(monkeypatch, Collection(records))
    response = await server.get_premium_dataset("VNM", dataset, period_type="year")
    assert set(response["items"][0]) == set(records[0])
    assert response["items"][0]["period"] == records[0]["period"]
    assert response["items"][0]["recordKey"] == records[0]["recordKey"]


@pytest.mark.asyncio
@pytest.mark.parametrize("raw", [{"yearReport": 2025, "quarter": 1, "ratioType": "RATIO_TTM", "pe": 1}, {"yearReport": 2025, "ratioTTMId": 7, "pe": 1}])
async def test_actual_ttm_writer_row_disclosed_not_coerced(monkeypatch, raw):
    from vnibb.services.vietcap_ingestion import upsert_ratio_rows
    records = []
    upsert_ratio_rows({}, "VNM", [raw], records=records, dry_run=True)
    assert records[0]["datasetVariant"] == "finance.ratio.ttm"
    assert records[0]["periodType"] is None
    assert records[0]["fiscalQuarter"] is None
    server = enable_public_reader(monkeypatch, DatasetCollection(records))
    for kwargs in ({}, {"period_type": "quarter"}, {"period_type": "year"}):
        response = await server.get_premium_dataset("VNM", "finance.ratio", **kwargs)
        assert response["row_count"] == 0
        if not kwargs:
            assert response["unrepresentable_financial_identity"] == {records[0]["recordKey"]: "ratio_ttm"}
        else:
            assert "unrepresentable_financial_identity" not in response
    assert records[0]["raw"] == raw


@pytest.mark.asyncio
@pytest.mark.parametrize("tool,kwargs", [("get_eod_price_history", {}), ("get_premium_dataset", {"dataset": "company.info"}), ("get_intraday_trades", {}), ("get_price_depth", {})])
@pytest.mark.parametrize("error,state", [(ConnectionFailure("mongodb://secret"), "unavailable"), (ExecutionTimeout("secret"), "timeout"), (OperationFailure("secret"), "query_failed")])
async def test_real_query_failure_public_tool_is_not_empty(monkeypatch, tool, kwargs, error, state):
    server = enable_public_reader(monkeypatch, Collection(error=error))
    with pytest.raises(Exception) as caught:
        await getattr(server, tool)("VNM", **kwargs)
    assert state in str(caught.value)
    assert "secret" not in str(caught.value)


class DatasetCollection(Collection):
    def find(self, query, projection):
        selected = [row for row in self.rows if all(row.get(key) == value for key, value in query.items() if not isinstance(value, dict))]
        result = Collection(selected, self.error).find(query, projection)
        self.query = query
        return result


@pytest.mark.asyncio
@pytest.mark.parametrize("case", ["current", "legacy", "derived", "empty_latest"])
async def test_intraday_actual_selected_store_and_empty_receipt(monkeypatch, case):
    now = datetime.now().replace(microsecond=0)
    current = {"dataset": "equity.intraday", "symbol": "VNM", "updatedAt": now, "observedAt": now, "source": "vnstock", "providerSource": "VCI", "raw": {"price": 1, "volume": 2}}
    legacy = {**current, "dataset": "quote.intraday", "recordKey": "legacy"}
    marker = {**current, "raw": {}, "batchReceipt": True, "rowCount": 0, "latestSessionStatus": "empty", "requestedSessionDate": "2026-10-13", "sourceDate": None, "observedAt": None, "coverage": {"status": "empty", "complete": False}}
    raw = {"current": [current, legacy], "legacy": [legacy], "derived": [], "empty_latest": [marker, legacy]}[case]
    derived = {"symbol": "VNM", "tradeTime": now, "observedAt": None, "source": "vnstock", "providerSource": "VCI", "sourceRecordKey": "retained", "price": 1, "volume": 2, "coverage": "historical_retained_window"}
    service = MongoMarketDataService()
    monkeypatch.setattr(service, "_get_collection", lambda name: DatasetCollection(raw) if name == "market_vnstock_premium_records" else Collection([derived]))
    rows = await service.get_intraday_trades("VNM")
    if case == "empty_latest":
        assert rows == []
        assert rows.metadata["latest_session_status"] == "empty"
        assert rows.metadata["source_date"] is None
        assert rows.metadata["coverage"]["complete"] is False
    elif case == "derived":
        assert rows[0]["sourceCollection"] == "market_intraday_trades"
        assert rows[0]["observedAt"] is None
        assert rows[0]["sourceRecordKey"] == "retained"
    else:
        assert rows[0]["dataset"] == ("equity.intraday" if case == "current" else "quote.intraday")
        assert rows[0]["sourceCollection"] == "market_vnstock_premium_records"
        assert rows[0]["providerSource"] == "VCI"


@pytest.mark.asyncio
@pytest.mark.parametrize("case", ["disabled", "down", "timeout", "inspection_failure", "empty", "populated"])
async def test_actual_status_configuration_and_access_are_distinct(monkeypatch, case):
    server = enable_public_reader(monkeypatch, Collection())
    from vnibb.services import mongo_market_data_service as module
    if case == "disabled":
        monkeypatch.setattr(module.settings, "mongodb_enabled", False)
        response = await server.get_mongo_status()
        assert response["enabled"] is False
        assert response["connectivity"]["status"] == "not_configured"
        return
    class Database:
        def command(self, command):
            if case == "down":
                raise ConnectionFailure("mongodb://secret")
            if case == "timeout":
                raise ExecutionTimeout("secret")
            return {"ok": 1}

        def list_collection_names(self):
            if case == "inspection_failure":
                raise OperationFailure("secret")
            return ["retained"] if case == "populated" else []

        def __getitem__(self, name):
            collection = Collection([{"dataset": "company.info", "raw": {"name": "VNM"}}])
            collection.estimated_document_count = lambda: 1
            collection.distinct = lambda field: ["company.info"]
            return collection
    service = server.get_mongo_market_data_service()
    monkeypatch.setattr(service, "_get_database", lambda: Database())
    if case == "inspection_failure":
        with pytest.raises(RuntimeError) as caught:
            await server.get_mongo_status()
        assert caught.value.state == "query_failed"
    else:
        response = await server.get_mongo_status()
        assert response["enabled"] is True
        assert "secret" not in str(response)
        if case in {"down", "timeout"}:
            assert response["connectivity"]["status"] != "connected"
        else:
            assert response["connectivity"]["status"] == "connected"
            assert bool(response["collections"]) == (case == "populated")


@pytest.mark.asyncio
async def test_depth_latest_empty_receipt_suppresses_older_levels(monkeypatch):
    latest = datetime(2026, 10, 13)
    collection = Collection([
        {"symbol": "VNM", "dataset": "equity.price_depth", "batchReceipt": True, "rowCount": 0, "updatedAt": latest,
         "latestSessionStatus": "empty", "observedAt": None, "sourceDate": None, "source": "vnstock", "providerSource": "VCI", "raw": {}},
        {"symbol": "VNM", "updatedAt": datetime(2026, 10, 12), "raw": {"price": 1, "volume": 2}},
    ])
    service = MongoMarketDataService()
    monkeypatch.setattr(service, "_get_collection", lambda _: collection)
    rows = await service.get_price_depth_precise("VNM")
    assert rows == []
    assert rows.metadata["latest_session_status"] == "empty"
    assert rows.metadata["batch_receipt"]["providerSource"] == "VCI"
    assert rows.metadata["batch_receipt"]["observedAt"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize("raw,expected", [({"price": 1, "buyVol": 3, "sellVol": 2}, 5), ({"side": "buy", "price": 1, "volume": 4}, 4), ({"bidPrice1": 1, "bidVol1": 4}, 4)])
async def test_native_depth_shapes_preserve_unknown_units(monkeypatch, raw, expected):
    envelope = {"dataset": "equity.price_depth", "symbol": "VNM", "updatedAt": datetime(2026, 10, 13), "source": "vnstock", "providerSource": "VCI", "priceUnit": "unknown", "raw": raw}
    service = MongoMarketDataService()
    monkeypatch.setattr(service, "_get_collection", lambda _: Collection([envelope]))
    rows = await service.get_price_depth_precise("VNM")
    assert rows[0]["raw"] == raw
    assert rows[0]["priceUnit"] == "unknown"
    if expected is not None:
        assert rows[0]["volume"] == expected


class ReplaceCollection(Collection):
    def __init__(self):
        super().__init__()
        self.docs = {}

    def bulk_write(self, operations, *, ordered):
        for operation in operations:
            self.docs[operation._filter["recordKey"]] = dict(operation._doc)

    def find(self, query, projection):
        self.query = query
        rows = [dict(doc) for doc in self.docs.values()
                if all(doc.get(key) == value for key, value in query.items() if not isinstance(value, dict))]
        rows.sort(key=lambda row: not row.get("batchReceipt"))
        return Cursor(rows)


@pytest.mark.asyncio
@pytest.mark.parametrize("ticks,status", [(2, "available"), (0, "empty")])
async def test_real_trade_writer_reaches_public_mcp(monkeypatch, ticks, status):
    from vnibb.services import mongo_market_data_service as module
    from vnibb.services.trading_acquisition import persist_mongo_trades
    now = datetime.now().replace(microsecond=0)
    collection = ReplaceCollection()
    service = MongoMarketDataService()
    monkeypatch.setattr(service, "_get_collection", lambda _: collection)
    monkeypatch.setattr(module, "get_mongo_market_data_service", lambda: service)
    rows = [{"trade_time": now, "price": 1000 + index, "volume": 10 + index, "match_type": "BUY", "transaction_id": index} for index in range(ticks)]
    coverage = {"provider": "vnstock:VCI", "session_date": "2026-10-13", "requested_session_date": "2026-10-13", "status": status}
    assert persist_mongo_trades("VNM", rows, coverage) == ticks
    server = enable_public_reader(monkeypatch, collection)
    response = await server.get_intraday_trades("VNM")
    assert response["row_count"] == ticks
    assert len(response["items"]) == ticks
    assert all(item["raw"]["price"] == 1000 + index for index, item in enumerate(response["items"]))
    assert response["latest_session_status"] == status
    assert response["source_collection"] == "market_vnstock_premium_records"
    assert response["source"] == "mongodb:market_vnstock_premium_records"
