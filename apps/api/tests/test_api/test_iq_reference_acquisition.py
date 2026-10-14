from collections import defaultdict
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from vnibb.services import mongo_market_data_service, vietcap_client, vietcap_ingestion


class Collection:
    def __init__(self):
        self.documents = []

    def update_one(self, query, update, *, upsert):
        assert upsert
        document = next((row for row in self.documents if all(row.get(key) == value for key, value in query.items())), None)
        if document is None:
            document = {**query, **update.get("$setOnInsert", {})}
            self.documents.append(document)
        document.update(update["$set"])


@pytest.fixture
def acquisition(monkeypatch):
    database = defaultdict(Collection)
    client = vietcap_client.VietcapClient(min_interval_seconds=0, max_retries=0)
    monkeypatch.setattr(vietcap_client, "VietcapClient", lambda: client)
    monkeypatch.setattr(mongo_market_data_service, "get_mongo_market_data_service", lambda: SimpleNamespace(_get_database=lambda: database))
    response = Mock(content=b"json", status_code=200)
    response.raise_for_status.return_value = None
    client._session.request = Mock(return_value=response)
    return database, client, response


@pytest.mark.asyncio
@pytest.mark.parametrize("dataset,collection", [
    ("iq_company_profile", "market_company_profiles"),
    ("iq_shareholder_structure", "market_vnstock_premium_records"),
])
async def test_reference_acquisition_persists_actual_writer_and_source_receipt(acquisition, dataset, collection):
    database, client, response = acquisition
    raw = {"ticker": "VNM", "holdingRatio": 0, "unknown": None}
    response.json.return_value = {"successful": True, "data": raw, "message": "ok", "traceId": "receipt-17"}
    progress = {}

    assert await vietcap_ingestion.sync_vietcap_reference("vnm", dataset, progress) == 1
    assert await vietcap_ingestion.sync_vietcap_reference("vnm", dataset, {}) == 1

    assert len(database[collection].documents) == 1
    document = database[collection].documents[0]
    assert document["symbol"] == "VNM"
    assert document["source"] == document["providerSource"] == "vietcap"
    assert document["details" if dataset == "iq_company_profile" else "raw"] == raw
    metadata = next(iter(client.response_metadata.values()))
    assert document["sourceResponse"] == metadata
    assert document["sourceResponse"]["traceId"] == "receipt-17"
    assert document["syncedAt"] == document["updatedAt"]
    assert progress["acquisition"]["source_response"]["traceId"] == "receipt-17"
    assert progress["acquisition"]["outcome"] == "succeeded"
    assert progress["success_count"] == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("dataset", ["iq_company_profile", "iq_shareholder_structure"])
@pytest.mark.parametrize("empty", [None, {}])
async def test_confirmed_empty_reference_preserves_previous_documents(acquisition, dataset, empty):
    database, _, response = acquisition
    database["market_company_profiles"].documents.append({"symbol": "VNM", "source": "vietcap", "details": {"old": True}})
    response.json.return_value = {"successful": True, "data": empty}
    progress = {}

    assert await vietcap_ingestion.sync_vietcap_reference("VNM", dataset, progress) == 0
    assert progress["empty_count"] == 1
    assert progress["acquisition"]["outcome"] == "confirmed_empty"
    assert database["market_company_profiles"].documents[0]["details"] == {"old": True}
    assert not database["market_vnstock_premium_records"].documents


@pytest.mark.asyncio
@pytest.mark.parametrize("dataset", ["iq_company_profile", "iq_shareholder_structure"])
@pytest.mark.parametrize("payload", [
    {"successful": False, "data": None, "message": "unavailable"},
    {"successful": True, "data": []},
    {"successful": True, "data": "invalid"},
    {"data": None},
    {"successful": True},
    {"status": 200, "message": "missing data"},
])
async def test_unavailable_or_malformed_response_is_not_confirmed_empty(acquisition, dataset, payload):
    database, _, response = acquisition
    response.json.return_value = payload
    progress = {}

    with pytest.raises((RuntimeError, ValueError)):
        await vietcap_ingestion.sync_vietcap_reference("VNM", dataset, progress)
    assert progress["error_count"] == 1
    assert progress["acquisition"]["outcome"] == "failed"
    assert not progress.get("empty_count")
    assert not any(collection.documents for collection in database.values())


@pytest.mark.asyncio
async def test_reference_provider_failure_is_explicit(acquisition):
    _, client, _ = acquisition
    client._session.request.side_effect = RuntimeError("provider unavailable")
    progress = {}
    with pytest.raises(RuntimeError, match="provider unavailable"):
        await vietcap_ingestion.sync_vietcap_reference("VNM", "iq_company_profile", progress)
    assert progress["error_count"] == 1
    assert progress["acquisition"]["outcome"] == "failed"


@pytest.mark.asyncio
async def test_failed_reference_write_is_not_success(acquisition):
    database, _, response = acquisition
    response.json.return_value = {"successful": True, "data": {"ticker": "VNM"}}
    database["market_company_profiles"].update_one = Mock(side_effect=RuntimeError("write failed"))
    progress = {}
    with pytest.raises(RuntimeError, match="write failed"):
        await vietcap_ingestion.sync_vietcap_reference("VNM", "iq_company_profile", progress)
    assert progress["error_count"] == 1
    assert not progress.get("success_count")
    assert not database["market_company_profiles"].documents


@pytest.mark.asyncio
async def test_reference_acquisition_rejects_unsupported_dataset_before_fetch(acquisition):
    _, client, _ = acquisition
    with pytest.raises(ValueError, match="Unsupported IQ reference dataset"):
        await vietcap_ingestion.sync_vietcap_reference("VNM", "company.info", {})
    client._session.request.assert_not_called()


@pytest.mark.asyncio
async def test_details_refresh_preserves_existing_search_bar(acquisition):
    database, _, response = acquisition
    database["market_company_profiles"].documents.append({"symbol": "VNM", "source": "vietcap", "searchBar": {"comTypeCode": "CORP"}})
    response.json.return_value = {"successful": True, "data": {"ticker": "VNM"}}
    await vietcap_ingestion.sync_vietcap_reference("VNM", "iq_company_profile", {})
    assert database["market_company_profiles"].documents[0]["searchBar"] == {"comTypeCode": "CORP"}


@pytest.mark.asyncio
async def test_missing_response_body_is_not_confirmed_empty(acquisition):
    _, _, response = acquisition
    response.content = b""
    progress = {}
    with pytest.raises(RuntimeError, match="Unconfirmed empty"):
        await vietcap_ingestion.sync_vietcap_reference("VNM", "iq_shareholder_structure", progress)
    assert progress["error_count"] == 1
    assert not progress.get("empty_count")


@pytest.mark.asyncio
@pytest.mark.parametrize("symbol", ["", "../VNM", "VNM?x=y", "VＮM"])
async def test_reference_acquisition_rejects_invalid_symbol_before_fetch(acquisition, symbol):
    _, client, _ = acquisition
    with pytest.raises(ValueError, match="Invalid IQ reference symbol"):
        await vietcap_ingestion.sync_vietcap_reference(symbol, "iq_company_profile", {})
    client._session.request.assert_not_called()
