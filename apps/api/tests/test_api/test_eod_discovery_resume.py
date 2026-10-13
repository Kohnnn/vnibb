"""Isolated discovery/catchup regressions; never access providers or databases."""
from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from vnibb.services import mongo_eod_sync as sync
from vnibb.services.mongo_market_data_service import MongoMarketDataService


class Collection:
    def __init__(self, documents=None):
        self.documents = list(documents or [])

    def create_index(self, keys, **kwargs):
        return kwargs["name"]

    def find(self, query, projection=None):
        def matches(document):
            for key, value in query.items():
                actual = document.get(key)
                if isinstance(value, dict):
                    if "$in" in value and actual not in value["$in"]:
                        return False
                    if "$gte" in value and (actual is None or actual < value["$gte"]):
                        return False
                    if "$lte" in value and (actual is None or actual > value["$lte"]):
                        return False
                elif actual != value:
                    return False
            return True
        return [dict(document) for document in self.documents if matches(document)]

    def update_one(self, query, update, upsert=False):
        documents = self.find(query)
        if documents:
            document = next(item for item in self.documents if all(item.get(k) == v for k, v in query.items()))
        elif upsert:
            document = {**query, **update.get("$setOnInsert", {})}
            self.documents.append(document)
        else:
            return
        document.update(update.get("$set", {}))

    def bulk_write(self, operations, ordered=False):
        for operation in operations:
            self.update_one(operation._filter, operation._doc, upsert=operation._upsert)

    def aggregate(self, pipeline):
        return []


def chart(day):
    return {"o": [10000], "h": [20000], "l": [10000], "c": [15000], "v": [10],
            "t": [datetime.combine(day, datetime.min.time(), tzinfo=UTC).timestamp()]}


@pytest.fixture
def fixture(monkeypatch):
    prices = Collection()
    receipts = Collection()
    finance = Collection()
    service = MongoMarketDataService()
    monkeypatch.setattr(MongoMarketDataService, "enabled", property(lambda self: True))
    monkeypatch.setattr(service, "ensure_eod_indexes", lambda: [])
    monkeypatch.setattr(service, "_get_collection", lambda name: {
        "market_prices_eod": prices, "market_eod_catchup_receipts": receipts,
        "market_vnstock_premium_records": finance,
    }[name])
    monkeypatch.setattr(service, "_get_database", lambda: MagicMock())
    session = AsyncMock()
    session.execute.return_value.scalars = MagicMock(return_value=SimpleNamespace(all=lambda: ["NEW", "VCI"]))
    session.execute.return_value.all = MagicMock(return_value=[("NEW", None), ("VCI", None)])
    factory = MagicMock()
    factory.return_value.__aenter__ = AsyncMock(return_value=session)
    factory.return_value.__aexit__ = AsyncMock(return_value=False)
    client = MagicMock()
    client.get_all_symbols.return_value = [{"symbol": "VCI", "type": "STOCK"}]
    client.get_company_search_bar.return_value = [{"code": "VCI", "comTypeCode": "CT"}]
    client.get_ohlc.return_value = chart(date.today())
    monkeypatch.setattr(sync, "async_session_factory", factory, raising=False)
    monkeypatch.setattr(sync, "get_mongo_market_data_service", lambda: service)
    monkeypatch.setattr(sync, "VietcapClient", lambda: client)
    monkeypatch.setattr(sync, "upsert_listing_rows", MagicMock(return_value=1))
    monkeypatch.setattr(sync, "persist_vietcap_listings", AsyncMock(return_value=0))
    monkeypatch.setattr(sync, "persist_vietcap_prices", AsyncMock(return_value=0))
    monkeypatch.setattr(sync, "sync_symbol_financials", MagicMock(return_value=[{"symbol": "VCI"}]))
    monkeypatch.setattr(sync, "persist_vietcap_financials", AsyncMock(return_value=0))
    monkeypatch.setattr(sync.data_pipeline, "_wait_for_rate_limit", AsyncMock())
    monkeypatch.setattr(sync.data_pipeline, "_fetch_quote_history_frame", AsyncMock(return_value=None))
    return SimpleNamespace(prices=prices, receipts=receipts, service=service,
                           client=client, session=session, factory=factory)


@pytest.mark.asyncio
@pytest.mark.parametrize("existing", [False, True])
async def test_sql_discovery_persists_absent_symbol_in_empty_or_partial_collection(fixture, existing):
    if existing:
        fixture.prices.documents.append({"symbol": "VCI", "source": "legacy", "tradeDate": datetime(2026, 1, 1)})
    result = await sync.run_mongo_eod_sync()
    assert {row["symbol"] for row in fixture.prices.documents if row["source"] == "vietcap"} == {"NEW", "VCI"}
    assert (result["expected"], result["attempted"], result["succeeded"], result["empty"], result["failed"]) == (2, 2, 2, 0, 0)
    statement = str(fixture.session.execute.call_args.args[0])
    assert "is_active" in statement and "exchange" in statement


@pytest.mark.asyncio
async def test_lookup_failure_is_not_no_work_and_preserves_error(fixture):
    fixture.session.execute.side_effect = RuntimeError("SQL lookup unavailable")
    result = await sync.run_mongo_eod_sync()
    assert result["outcome"] == "failed" and result["failures"] == 1
    assert result["failed"] == 1 and result["complete"] is False
    assert result["attempted"] == 0
    assert any(error["message"] == "SQL lookup unavailable" for error in result["errors"])
    fixture.client.get_ohlc.assert_not_called()


@pytest.mark.asyncio
async def test_confirmed_empty_sql_universe_is_explicit_no_work(fixture):
    fixture.session.execute.return_value.scalars.return_value.all = lambda: []
    result = await sync.run_mongo_eod_sync()
    assert result["outcome"] == "no_work"
    assert (result["expected"], result["attempted"], result["failures"]) == (0, 0, 0)
    fixture.client.get_ohlc.assert_not_called()


@pytest.mark.asyncio
async def test_empty_acquisition_is_unsuccessful_even_without_provider_exception(fixture):
    fixture.client.get_ohlc.return_value = None
    result = await sync.run_mongo_eod_sync(symbols=["VCI"])
    assert (result["expected"], result["attempted"], result["succeeded"], result["empty"], result["failed"]) == (1, 1, 0, 1, 0)
    assert result["failures"] == 1 and result["outcome"] == "empty"
    assert result["errors"]


@pytest.mark.asyncio
async def test_successful_zero_change_refresh_is_not_empty(fixture, monkeypatch):
    monkeypatch.setattr(fixture.service, "bulk_upsert_eod_prices", AsyncMock(return_value=0))
    result = await sync.run_mongo_eod_sync(symbols=["VCI"])
    assert result["succeeded"] == 1 and result["empty"] == 0 and result["outcome"] == "ok"


@pytest.mark.asyncio
async def test_recent_gap_refresh_leaves_old_gap_for_separate_bounded_owner(fixture):
    old = date.today() - timedelta(days=90)
    fixture.prices.documents.append({"symbol": "VCI", "source": "legacy", "tradeDate": datetime.combine(old, datetime.min.time()), "close": 123})
    await sync.run_mongo_eod_sync(symbols=["VCI"])
    assert fixture.prices.documents[0]["close"] == 123
    assert fixture.receipts.documents == []
    assert fixture.client.get_ohlc.call_args.kwargs == {"count_back": 8}
    assert any(row["tradeDate"].date() == date.today() for row in fixture.prices.documents)


@pytest.mark.asyncio
async def test_oldest_missing_window_resumes_without_deleting_non_iq(fixture):
    start = date(2020, 1, 1)
    end = date(2020, 3, 31)
    fixture.prices.documents.append({"symbol": "VCI", "source": "legacy", "tradeDate": datetime(2020, 1, 5, 7), "close": 123})
    fixture.client.get_ohlc.return_value = chart(date(2020, 1, 5))
    first = await sync.run_mongo_eod_catchup(symbols=["VCI"], start=start, end=end, window_days=30, max_symbols=1)
    assert first["succeeded"] == 1
    assert fixture.prices.documents[0]["close"] == 123
    assert any(row["source"] == "vietcap" and row["tradeDate"].date() == date(2020, 1, 5) for row in fixture.prices.documents)
    fixture.client.get_ohlc.return_value = chart(date(2020, 2, 5))
    second = await sync.run_mongo_eod_catchup(symbols=["VCI"], start=start, end=end, window_days=30, max_symbols=1)
    assert second["succeeded"] == 1
    windows = [(row["start"], row["end"]) for row in fixture.receipts.documents if row["status"] == "succeeded"]
    assert windows == [("2020-01-01", "2020-01-30"), ("2020-01-31", "2020-02-29")]
    assert all(call.kwargs["count_back"] <= 31 for call in fixture.client.get_ohlc.call_args_list)
    inventory = await sync.get_mongo_eod_catchup_inventory(symbols=["VCI"], start=start, end=end)
    assert (inventory["expected"], inventory["completed"], inventory["pending"]) == (1, 0, 1)
    assert inventory["symbols"][0]["next_start"] == "2020-03-01"


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["empty", "provider", "write", "bridge", "receipt"])
async def test_failed_window_never_advances_resume_cursor(fixture, monkeypatch, failure):
    start = date(2020, 1, 1)
    if failure == "empty":
        fixture.client.get_ohlc.return_value = None
    elif failure == "provider":
        fixture.client.get_ohlc.side_effect = RuntimeError("provider unavailable")
    else:
        fixture.client.get_ohlc.return_value = chart(start)
    if failure == "write":
        monkeypatch.setattr(fixture.service, "bulk_upsert_eod_prices", AsyncMock(side_effect=RuntimeError("write unavailable")))
    elif failure == "bridge":
        monkeypatch.setattr(sync, "persist_vietcap_prices", AsyncMock(side_effect=RuntimeError("bridge unavailable")))
    elif failure == "receipt":
        monkeypatch.setattr(fixture.receipts, "update_one", MagicMock(side_effect=RuntimeError("receipt unavailable")))
    result = await sync.run_mongo_eod_catchup(symbols=["VCI"], start=start, end=date(2020, 2, 1), max_symbols=1)
    assert result["failures"] == 1 and result["succeeded"] == 0
    inventory = await sync.get_mongo_eod_catchup_inventory(symbols=["VCI"], start=start, end=date(2020, 2, 1))
    assert inventory["symbols"][0]["next_start"] == "2020-01-01"


@pytest.mark.asyncio
async def test_completed_range_is_explicit_no_work(fixture):
    fixture.client.get_ohlc.return_value = chart(date(2020, 1, 1))
    await sync.run_mongo_eod_catchup(symbols=["VCI"], start=date(2020, 1, 1), end=date(2020, 1, 10))
    fixture.client.get_ohlc.reset_mock()
    result = await sync.run_mongo_eod_catchup(symbols=["VCI"], start=date(2020, 1, 1), end=date(2020, 1, 10))
    assert result["outcome"] == "no_work" and result["attempted"] == 0
    assert result["complete"] is True
    fixture.client.get_ohlc.assert_not_called()


@pytest.mark.asyncio
async def test_catchup_prioritizes_oldest_pending_symbol_and_caps_work(fixture):
    fixture.receipts.documents.append({"symbol": "NEW", "start": "2020-01-01", "end": "2020-01-30", "status": "succeeded"})
    fixture.client.get_ohlc.return_value = chart(date(2020, 1, 5))
    result = await sync.run_mongo_eod_catchup(start=date(2020, 1, 1), end=date(2020, 3, 1), max_symbols=1, window_days=99)
    assert result["expected"] == 2 and result["attempted"] == 1
    assert fixture.client.get_ohlc.call_args.args[0] == "VCI"
    assert fixture.client.get_ohlc.call_args.kwargs["count_back"] == 31


@pytest.mark.asyncio
async def test_inventory_preserves_empty_failed_receipts_and_is_provider_free(fixture):
    fixture.receipts.documents.extend([
        {"symbol": "VCI", "start": "2020-01-01", "end": "2020-01-30", "status": "empty", "errors": [{"message": "no bars"}]},
        {"symbol": "NEW", "start": "2020-01-01", "end": "2020-01-30", "status": "failed", "errors": [{"message": "provider unavailable"}]},
    ])
    result = await sync.get_mongo_eod_catchup_inventory(start=date(2020, 1, 1), end=date(2020, 3, 1))
    assert result["receipt_counts"] == {"succeeded": 0, "empty": 1, "failed": 1}
    assert {row["next_start"] for row in result["symbols"]} == {"2020-01-01"}
    assert [row["errors"][0]["message"] for row in result["receipts"]] == ["no bars", "provider unavailable"]
    fixture.client.get_ohlc.assert_not_called()


@pytest.mark.asyncio
async def test_inventory_does_not_skip_gap_between_successful_receipts(fixture):
    fixture.receipts.documents.extend([
        {"symbol": "VCI", "start": "2020-01-01", "end": "2020-01-30", "status": "succeeded"},
        {"symbol": "VCI", "start": "2020-03-01", "end": "2020-03-30", "status": "succeeded"},
    ])
    result = await sync.get_mongo_eod_catchup_inventory(symbols=["VCI"], start=date(2020, 1, 1), end=date(2020, 4, 1))
    assert result["symbols"][0]["next_start"] == "2020-01-31"


@pytest.mark.asyncio
async def test_inventory_excludes_confirmed_prelisting_windows(fixture):
    fixture.session.execute.return_value.all.return_value = [("VCI", date(2020, 2, 15))]
    result = await sync.get_mongo_eod_catchup_inventory(symbols=["VCI"], start=date(2000, 1, 1), end=date(2020, 3, 1))
    assert result["symbols"][0]["next_start"] == "2020-02-15"


@pytest.mark.asyncio
async def test_catchup_inventory_failure_stops_acquisition(fixture):
    fixture.session.execute.side_effect = RuntimeError("SQL inventory unavailable")
    result = await sync.run_mongo_eod_catchup(start=date(2020, 1, 1), end=date(2020, 3, 1))
    assert result["outcome"] == "failed" and result["failures"] == 1
    assert result["failed"] == 1 and result["complete"] is False
    assert result["errors"][0]["message"] == "SQL inventory unavailable"
    fixture.client.get_ohlc.assert_not_called()


@pytest.mark.asyncio
async def test_default_history_does_not_truncate_to_2019(fixture):
    result = await sync.get_mongo_eod_catchup_inventory(symbols=["VCI"])
    assert result["start"] == "2000-01-01"
    assert result["symbols"][0]["next_start"] == "2000-01-01"
    assert date.fromisoformat(result["end"]) == date.today() - timedelta(days=sync.DEFAULT_WINDOW_DAYS)
    fixture.client.get_ohlc.assert_not_called()


@pytest.mark.asyncio
async def test_cancellation_retains_completed_window_receipt(fixture, monkeypatch):
    import asyncio

    original = sync._acquire_eod
    fixture.client.get_ohlc.return_value = chart(date(2020, 1, 5))

    async def acquire(client, symbol, *args, **kwargs):
        if symbol == "VCI":
            raise asyncio.CancelledError()
        return await original(client, symbol, *args, **kwargs)

    monkeypatch.setattr(sync, "_acquire_eod", acquire)
    with pytest.raises(asyncio.CancelledError):
        await sync.run_mongo_eod_catchup(start=date(2020, 1, 1), end=date(2020, 3, 1))
    result = await sync.get_mongo_eod_catchup_inventory(start=date(2020, 1, 1), end=date(2020, 3, 1))
    positions = {row["symbol"]: row["next_start"] for row in result["symbols"]}
    assert positions == {"NEW": "2020-01-31", "VCI": "2020-01-01"}
    assert result["receipt_counts"] == {"succeeded": 1, "empty": 0, "failed": 0}


@pytest.mark.asyncio
async def test_empty_first_fifty_do_not_starve_new_symbol(fixture):
    symbols = [f"A{index:02}" for index in range(50)] + ["NEW"]
    fixture.session.execute.return_value.scalars.return_value.all = lambda: symbols
    fixture.session.execute.return_value.all.return_value = [(symbol, None) for symbol in symbols]
    fixture.client.get_ohlc.side_effect = lambda symbol, **kwargs: chart(date(2020, 1, 5)) if symbol == "NEW" else None
    first = await sync.run_mongo_eod_catchup(start=date(2020, 1, 1), end=date(2020, 3, 1))
    assert first["empty"] == 50 and first["complete"] is False
    fixture.client.get_ohlc.reset_mock()
    second = await sync.run_mongo_eod_catchup(start=date(2020, 1, 1), end=date(2020, 3, 1), max_symbols=1)
    assert fixture.client.get_ohlc.call_args.args[0] == "NEW"
    assert second["succeeded"] == 1
    assert any(row["symbol"] == "NEW" and row["source"] == "vietcap" for row in fixture.prices.documents)


@pytest.mark.asyncio
async def test_catchup_completed_last_window_marks_complete(fixture):
    fixture.client.get_ohlc.return_value = chart(date(2020, 1, 5))
    result = await sync.run_mongo_eod_catchup(symbols=["VCI"], start=date(2020, 1, 1), end=date(2020, 1, 10))
    assert result["complete"] is True
    assert result["completed"] == 1 and result["pending"] == 0


@pytest.mark.asyncio
async def test_catchup_default_ceiling_joins_incremental_window_without_unowned_days(fixture):
    today = date.today()
    end = today - timedelta(days=sync.DEFAULT_WINDOW_DAYS)
    # Historical acquisition is oldest-first and bounded: seed the already
    # covered prefix so the next single call lands adjacent to the incremental
    # window instead of restarting at the 2000-01-01 head.
    start = end - timedelta(days=29)
    fixture.session.execute.return_value.all.return_value = [("VCI", None)]
    fixture.receipts.documents.append({
        "symbol": "VCI", "start": "2000-01-01", "end": (start - timedelta(days=1)).isoformat(),
        "status": "succeeded", "updatedAt": datetime(2026, 1, 1),
    })
    fixture.client.get_ohlc.return_value = chart(today - timedelta(days=30))
    inventory = await sync.get_mongo_eod_catchup_inventory(symbols=["VCI"])
    assert date.fromisoformat(inventory["end"]) == end
    assert inventory["symbols"][0]["next_start"] == start.isoformat()
    assert inventory["symbols"][0]["next_end"] == end.isoformat()
    result = await sync.run_mongo_eod_catchup(symbols=["VCI"])
    assert (result["succeeded"], result["complete"]) == (1, True)
    windows = sorted((row["start"], row["end"]) for row in fixture.receipts.documents
                     if row["status"] == "succeeded")
    assert windows[-1] == (start.isoformat(), end.isoformat())
    # Historical acquisition ends exactly where the incremental window begins.
    assert date.fromisoformat(windows[-1][1]) == today - timedelta(days=sync.DEFAULT_WINDOW_DAYS)
    fixture.client.get_ohlc.reset_mock()
    fixture.client.get_ohlc.return_value = chart(today)
    incremental = await sync.run_mongo_eod_sync(symbols=["VCI"])
    assert (incremental["succeeded"], incremental["outcome"]) == (1, "ok")
    assert all(call.kwargs["count_back"] == sync.DEFAULT_WINDOW_DAYS + 1
               for call in fixture.client.get_ohlc.call_args_list)
