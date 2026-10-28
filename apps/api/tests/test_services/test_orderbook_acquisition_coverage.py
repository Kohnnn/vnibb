from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from vnibb.core.config import settings
from vnibb.providers.vnstock.price_depth import PriceDepthData, VnstockPriceDepthFetcher
from vnibb.services import data_pipeline, mongo_market_data_service


@pytest.fixture
def depth_stores(monkeypatch):
    session = AsyncMock()
    session.execute.return_value = Mock(scalar=Mock(return_value=1))
    context = AsyncMock()
    context.__aenter__.return_value = session
    monkeypatch.setattr(data_pipeline, "async_session_maker", Mock(return_value=context))
    collection = Mock()
    service = SimpleNamespace(enabled=True, _get_collection=Mock(return_value=collection))
    monkeypatch.setattr(mongo_market_data_service, "get_mongo_market_data_service", lambda: service)
    monkeypatch.setattr(settings, "orderbook_at_close_only", False)
    monkeypatch.setattr(settings, "intraday_require_market_hours", False)
    monkeypatch.setattr(data_pipeline.data_pipeline, "_wait_for_rate_limit", AsyncMock())
    cache = AsyncMock()
    monkeypatch.setattr(data_pipeline.data_pipeline, "_cache_set_json", cache)
    fetch = AsyncMock(return_value=PriceDepthData(
        symbol="FPT", bid_1={"price": 100000, "volume": 120},
        raw_levels=[{"price": 100000, "volume": 120, "buy_volume": 120}],
    ))
    monkeypatch.setattr(VnstockPriceDepthFetcher, "fetch", fetch)
    return session, collection, fetch, cache


@pytest.mark.asyncio
async def test_other_symbol_existing_today_does_not_starve_depth(depth_stores):
    session, collection, fetch, _ = depth_stores
    progress = {"acquisition_outcomes": {"FPT": {"sql_ticks": {"status": "persisted", "rows": 3}}}}
    count = await data_pipeline.data_pipeline.sync_orderbook_snapshots(
        symbols=["FPT", "VCB"], progress=progress,
    )
    assert fetch.await_count == 2
    assert count == 2
    assert session.commit.await_count == 2
    assert collection.bulk_write.call_count == 2
    coverage = progress["acquisition_outcomes"]["FPT"]
    assert coverage["current_depth"]["scope"] == "current_batch"
    assert coverage["current_depth"]["historical_replay_supported"] is False
    assert coverage["sql_depth"] == {"status": "persisted", "rows": 1, "error": None}
    assert coverage["mongo_depth"] == {"status": "persisted", "rows": 1, "error": None}
    assert coverage["sql_ticks"]["rows"] == 3


@pytest.mark.asyncio
@pytest.mark.parametrize("failed", ["sql_depth", "mongo_depth"])
async def test_depth_store_failures_remain_independent(depth_stores, failed):
    session, collection, _, cache = depth_stores
    if failed == "sql_depth":
        session.execute.side_effect = RuntimeError("SQL unavailable")
    else:
        collection.bulk_write.side_effect = RuntimeError("Mongo unavailable")
    progress = {}
    await data_pipeline.data_pipeline.sync_orderbook_snapshots(symbols=["FPT"], progress=progress)
    outcomes = progress["acquisition_outcomes"]["FPT"]
    other = "mongo_depth" if failed == "sql_depth" else "sql_depth"
    assert outcomes[failed]["status"] == "failed"
    assert outcomes[failed]["rows"] == 0
    assert outcomes[failed]["error"] == "RuntimeError"
    assert outcomes[other]["status"] == "persisted"
    assert cache.await_count == 2


@pytest.mark.asyncio
async def test_latest_empty_depth_writes_explicit_batch_receipt(depth_stores):
    session, collection, fetch, cache = depth_stores
    fetch.return_value = PriceDepthData(symbol="FPT", raw_levels=[])
    progress = {}
    await data_pipeline.data_pipeline.sync_orderbook_snapshots(symbols=["FPT"], progress=progress)
    receipt = collection.bulk_write.call_args.args[0][-1]._doc
    assert receipt["dataset"] == "equity.price_depth"
    assert receipt["batchReceipt"] is True
    assert receipt["rowCount"] == 0
    assert receipt["raw"] == {}
    assert receipt["latestSessionStatus"] == "empty"
    assert receipt["observedAt"] is None
    assert receipt["updatedAt"] == receipt["syncedAt"]
    assert session.commit.await_count == 1
    assert cache.await_args_list[0].args[1]["entries"] == []
    assert progress["acquisition_outcomes"]["FPT"]["mongo_depth"]["rows"] == 0


@pytest.mark.asyncio
async def test_fetch_stamp_does_not_claim_provider_observation_or_units(depth_stores):
    _, collection, _, _ = depth_stores
    await data_pipeline.data_pipeline.sync_orderbook_snapshots(symbols=["FPT"])
    receipt = collection.bulk_write.call_args.args[0][-1]._doc
    assert receipt["observedAt"] is None
    assert receipt["timestampMeaning"] == "unknown"
    assert receipt["priceUnit"] == "unknown"


@pytest.mark.asyncio
async def test_live_depth_bypasses_close_only_but_keeps_market_gate(depth_stores, monkeypatch):
    _, _, fetch, _ = depth_stores
    monkeypatch.setattr(settings, "orderbook_at_close_only", True)
    monkeypatch.setattr(settings, "intraday_require_market_hours", True)
    monkeypatch.setattr(data_pipeline.data_pipeline, "_is_after_market_close", lambda: False)
    monkeypatch.setattr(data_pipeline.data_pipeline, "_is_market_hours", lambda: True)
    await data_pipeline.data_pipeline.sync_orderbook_snapshots(symbols=["FPT"], live_session=True)
    assert fetch.await_count == 1
    monkeypatch.setattr(data_pipeline.data_pipeline, "_is_market_hours", lambda: False)
    await data_pipeline.data_pipeline.sync_orderbook_snapshots(symbols=["FPT"], live_session=True)
    assert fetch.await_count == 1


@pytest.mark.asyncio
async def test_depth_fetch_failure_is_not_a_persistence_success(depth_stores):
    session, collection, fetch, cache = depth_stores
    fetch.side_effect = RuntimeError("Depth unavailable in free VCI")
    progress = {}
    assert await data_pipeline.data_pipeline.sync_orderbook_snapshots(symbols=["FPT"], progress=progress) == 0
    outcomes = progress["acquisition_outcomes"]["FPT"]
    assert outcomes["sql_depth"]["status"] == "failed"
    assert outcomes["mongo_depth"]["status"] == "failed"
    session.commit.assert_not_awaited()
    collection.bulk_write.assert_not_called()
    cache.assert_not_awaited()


@pytest.mark.asyncio
async def test_explicit_adapter_units_and_raw_lineage_survive_both_writes(depth_stores):
    session, collection, fetch, _ = depth_stores
    fetch.return_value = PriceDepthData(
        symbol="FPT", raw_levels=[{"price": 100000, "volume": 120, "buy_volume": 120}],
        price_unit="VND", volume_unit="shares", timestamp_meaning="source_observation_time",
        observed_at="2026-10-13T02:30:00",
    )
    await data_pipeline.data_pipeline.sync_orderbook_snapshots(symbols=["FPT"])
    row = collection.bulk_write.call_args.args[0][0]._doc
    assert row["priceUnit"] == "VND"
    assert row["volumeUnit"] == "shares"
    assert row["observedAt"] == "2026-10-13T02:30:00"
    assert row["raw"] == fetch.return_value.raw_levels[0]
    assert session.execute.await_args.args[1]["price_depth"]["price_unit"] == "VND"


@pytest.mark.asyncio
@pytest.mark.parametrize("dataset,symbol", [
    ("equity.intraday", "FPT"), ("equity.price_depth", "VCB"),
    ("equity.intraday", "VCB"),
])
@pytest.mark.parametrize("suffix", ["0", "latest-batch"])
async def test_depth_upsert_preserves_colliding_observation(depth_stores, dataset, symbol, suffix):
    _, collection, fetch, _ = depth_stores
    original = {"dataset": dataset, "symbol": symbol, "recordKey": f"free-vci:depth:FPT:{suffix}",
                "raw": {"price": 50000}, "source": "retained-provider"}
    documents = [deepcopy(original)]
    original_payload = fetch.return_value.model_dump(mode="json")

    def replace(operations, *, ordered):
        assert ordered is True
        for operation in operations:
            index = next((index for index, document in enumerate(documents)
                          if all(document.get(key) == value for key, value in operation._filter.items())), None)
            if index is None:
                documents.append(deepcopy(operation._doc))
            else:
                documents[index] = deepcopy(operation._doc)

    collection.bulk_write.side_effect = replace
    for _ in range(2):
        assert await data_pipeline.data_pipeline.sync_orderbook_snapshots(symbols=["FPT"]) == 1
        assert documents[0] == original
        assert len(documents) == 3

    level, receipt = documents[1:]
    assert (level["dataset"], level["symbol"], level["recordKey"]) == (
        "equity.price_depth", "FPT", "free-vci:depth:FPT:0")
    assert level["raw"] == {"price": 100000, "volume": 120, "buy_volume": 120}
    assert level["source"] == "vnstock"
    assert level["providerSource"] == "VCI"
    assert (receipt["dataset"], receipt["symbol"], receipt["recordKey"]) == (
        "equity.price_depth", "FPT", "free-vci:depth:FPT:latest-batch")
    assert receipt["batchReceipt"] is True
    assert receipt["raw"] == {}
    assert receipt["rowCount"] == 1
    assert fetch.return_value.model_dump(mode="json") == original_payload
