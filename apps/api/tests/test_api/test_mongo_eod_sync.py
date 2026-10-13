"""Mongo EOD sync and date-coercion contracts."""

from datetime import UTC, date, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pandas as pd
import pytest

from vnibb.api.v1.market import (
    _coerce_to_date,
    _expected_latest_trading_day,
)
from vnibb.services import mongo_eod_sync


def persisted_summary(result):
    return {key: result[key] for key in (
        "symbols", "rows", "failures", "listings", "financials", "fallbacks",
        "primary_failures", "structured_rows",
    )}


# ---------------------------------------------------------------------------
# mongo_eod_sync frame normalization
# ---------------------------------------------------------------------------
def test_frame_to_rows_normalizes_and_skips_bad_dates():
    frame = pd.DataFrame(
        [
            {"time": "2026-06-05", "open": 1.0, "high": 2.0, "low": 0.5, "close": 1.5, "volume": 100, "value": 150.0},
            {"time": None, "open": 1, "high": 1, "low": 1, "close": 1, "volume": 1},  # dropped: no date
        ]
    )
    rows = mongo_eod_sync._frame_to_rows(frame)
    assert len(rows) == 1
    row = rows[0]
    assert isinstance(row["tradeDate"], datetime)
    assert row["tradeDate"].date() == date(2026, 6, 5)
    assert row["close"] == 1.5
    assert row["volume"] == 100
    assert row["value"] == 150.0


def test_frame_to_rows_handles_empty_and_none():
    assert mongo_eod_sync._frame_to_rows(None) == []
    assert mongo_eod_sync._frame_to_rows(pd.DataFrame()) == []


def test_coerce_float_rejects_nan():
    assert mongo_eod_sync._coerce_float(float("nan")) is None
    assert mongo_eod_sync._coerce_float("abc") is None
    assert mongo_eod_sync._coerce_float("3.5") == 3.5


@pytest.fixture
def iq_sync(monkeypatch):
    symbols = ["GOOD", "BAD", "VCI", "SSI"]
    client = MagicMock()
    client.get_all_symbols.return_value = [
        {"symbol": symbol, "type": "STOCK"} for symbol in symbols
    ]
    client.get_company_search_bar.return_value = [
        {"code": symbol, "comTypeCode": "CT"} for symbol in symbols
    ]
    client.get_ohlc.return_value = {
        "o": [10000], "h": [20000], "l": [10000], "c": [15000],
        "v": [10],
        "t": [datetime.combine(date.today(), datetime.min.time(), tzinfo=UTC).timestamp()],
    }
    collection = MagicMock()
    session = AsyncMock()
    session.execute.return_value.scalars = MagicMock(return_value=SimpleNamespace(all=lambda: ["VCI", "SSI"]))
    factory = MagicMock()
    factory.return_value.__aenter__ = AsyncMock(return_value=session)
    factory.return_value.__aexit__ = AsyncMock(return_value=False)
    collection.aggregate.return_value = []
    database = MagicMock()
    service = MagicMock(enabled=True)
    service._get_database.return_value = database
    service._get_collection.return_value = collection
    service.bulk_upsert_eod_prices = AsyncMock(
        side_effect=lambda symbol, rows, *, source: len(rows)
    )
    listings = MagicMock(side_effect=lambda db, trading, search, *, dry_run: len(trading))
    listing_bridge = AsyncMock(return_value=0)
    financials = MagicMock(side_effect=lambda db, client, symbol, **kwargs: [{"symbol": symbol}])
    financial_bridge = AsyncMock(side_effect=lambda records: len(records))
    price_bridge = AsyncMock(side_effect=lambda symbol, rows: len(rows))
    fallback = AsyncMock(side_effect=AssertionError("VCI must not run for healthy IQ"))
    wait = AsyncMock()
    monkeypatch.setattr(mongo_eod_sync, "VietcapClient", lambda: client)
    monkeypatch.setattr(mongo_eod_sync, "async_session_factory", factory)
    monkeypatch.setattr(mongo_eod_sync, "get_mongo_market_data_service", lambda: service)
    monkeypatch.setattr(mongo_eod_sync, "upsert_listing_rows", listings)
    monkeypatch.setattr(mongo_eod_sync, "persist_vietcap_listings", listing_bridge)
    monkeypatch.setattr(mongo_eod_sync, "sync_symbol_financials", financials)
    monkeypatch.setattr(mongo_eod_sync, "persist_vietcap_financials", financial_bridge)
    monkeypatch.setattr(mongo_eod_sync, "persist_vietcap_prices", price_bridge)
    monkeypatch.setattr(mongo_eod_sync.data_pipeline, "_wait_for_rate_limit", wait)
    monkeypatch.setattr(mongo_eod_sync.data_pipeline, "_fetch_quote_history_frame", fallback)
    return SimpleNamespace(
        client=client, service=service, collection=collection, database=database,
        listings=listings, listing_bridge=listing_bridge, financials=financials,
        financial_bridge=financial_bridge,
        price_bridge=price_bridge, fallback=fallback, wait=wait,
        session=session,
    )


@pytest.mark.asyncio
async def test_run_mongo_eod_sync_disabled_service(iq_sync):
    iq_sync.service.enabled = False

    result = await mongo_eod_sync.run_mongo_eod_sync()

    assert persisted_summary(result) == {
        "symbols": 0, "rows": 0, "failures": 1, "listings": 0,
        "financials": 0, "fallbacks": 0, "primary_failures": 0, "structured_rows": 0,
    }
    iq_sync.client.get_all_symbols.assert_not_called()


@pytest.mark.asyncio
async def test_run_mongo_eod_sync_writes_explicit_symbols(iq_sync):
    result = await mongo_eod_sync.run_mongo_eod_sync(symbols=["vci", "ssi", "VCI"], window_days=5)

    assert persisted_summary(result) == {
        "symbols": 2, "rows": 2, "failures": 0, "listings": 4,
        "financials": 2, "fallbacks": 0, "primary_failures": 0, "structured_rows": 4,
    }
    writes = iq_sync.service.bulk_upsert_eod_prices.await_args_list
    assert [call.args[0] for call in writes] == ["SSI", "VCI"]
    assert all(call.kwargs == {"source": "vietcap"} for call in writes)
    assert all(call.args[1][0]["close"] == 15000 for call in writes)
    assert all(call.args[1][0]["tradeDate"].date() == date.today() for call in writes)
    iq_sync.listings.assert_called_once_with(
        iq_sync.database, iq_sync.client.get_all_symbols.return_value,
        iq_sync.client.get_company_search_bar.return_value, dry_run=False,
    )
    assert [call.args[2] for call in iq_sync.financials.call_args_list] == ["SSI", "VCI"]
    assert all(call.kwargs == {"com_type": "CT", "dry_run": False}
               for call in iq_sync.financials.call_args_list)
    assert iq_sync.price_bridge.await_count == 2
    assert iq_sync.financial_bridge.await_count == 2
    iq_sync.fallback.assert_not_awaited()
    iq_sync.wait.assert_not_awaited()


@pytest.mark.asyncio
async def test_run_mongo_eod_sync_isolates_symbol_failures(iq_sync, monkeypatch):
    iq_sync.client.get_ohlc.side_effect = RuntimeError("IQ unavailable")

    async def fake_fetch(*, symbol, start, end, interval, bypass_internal_retry):
        if symbol == "BAD":
            raise RuntimeError("provider down")
        return pd.DataFrame([{
            "time": date.today().isoformat(), "open": 10, "high": 20, "low": 10,
            "close": 15, "volume": 10, "price_source": "vnstock_history:VCI",
            "price_unit": "THOUSAND_VND",
        }])

    monkeypatch.setattr(mongo_eod_sync.data_pipeline, "_fetch_quote_history_frame", fake_fetch)
    result = await mongo_eod_sync.run_mongo_eod_sync(symbols=["GOOD", "BAD"], window_days=5)

    assert persisted_summary(result) == {
        "symbols": 1, "rows": 1, "failures": 1, "listings": 4,
        "financials": 2, "fallbacks": 1, "primary_failures": 2, "structured_rows": 2,
    }
    write = iq_sync.service.bulk_upsert_eod_prices.await_args
    assert write.args[0] == "GOOD"
    assert write.kwargs == {"source": "vnstock-data"}
    assert write.args[1][0]["price_source"] == "vnstock_history:VCI"
    assert write.args[1][0]["price_unit"] == "THOUSAND_VND"
    iq_sync.price_bridge.assert_not_awaited()


@pytest.mark.asyncio
async def test_run_mongo_eod_sync_counts_write_failure_per_symbol(iq_sync):
    def write(symbol, rows, *, source):
        if symbol == "BAD":
            raise RuntimeError("Mongo bulk write failed")
        return len(rows)

    iq_sync.service.bulk_upsert_eod_prices.side_effect = write
    result = await mongo_eod_sync.run_mongo_eod_sync(symbols=["GOOD", "BAD"], window_days=5)

    assert persisted_summary(result) == {
        "symbols": 1, "rows": 1, "failures": 1, "listings": 4,
        "financials": 2, "fallbacks": 0, "primary_failures": 0, "structured_rows": 3,
    }
    assert iq_sync.price_bridge.await_count == 1
    iq_sync.fallback.assert_not_awaited()


@pytest.mark.asyncio
async def test_run_mongo_eod_sync_keeps_legitimate_zero_write_success(iq_sync, monkeypatch):
    iq_sync.client.get_ohlc.side_effect = RuntimeError("IQ unavailable")
    iq_sync.service.bulk_upsert_eod_prices.side_effect = None
    iq_sync.service.bulk_upsert_eod_prices.return_value = 0

    async def fake_fetch(*, symbol, start, end, interval, bypass_internal_retry):
        return pd.DataFrame([{
            "time": date.today().isoformat(), "open": 10, "high": 20, "low": 10,
            "close": 15, "volume": 10, "price_source": "vnstock_history:VCI",
            "price_unit": "THOUSAND_VND",
        }])

    monkeypatch.setattr(mongo_eod_sync.data_pipeline, "_fetch_quote_history_frame", fake_fetch)
    result = await mongo_eod_sync.run_mongo_eod_sync(symbols=["VCI"], window_days=5)

    assert persisted_summary(result) == {
        "symbols": 1, "rows": 0, "failures": 0, "listings": 4,
        "financials": 1, "fallbacks": 1, "primary_failures": 1, "structured_rows": 1,
    }


@pytest.mark.asyncio
async def test_run_mongo_eod_sync_reports_universe_read_failure(iq_sync):
    iq_sync.session.execute.side_effect = RuntimeError("SQL universe unavailable")

    result = await mongo_eod_sync.run_mongo_eod_sync()

    assert persisted_summary(result) == {
        "symbols": 0, "rows": 0, "failures": 1, "listings": 4,
        "financials": 0, "fallbacks": 0, "primary_failures": 0, "structured_rows": 0,
    }
    iq_sync.client.get_ohlc.assert_not_called()
    iq_sync.financials.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("stage", ["trading", "search", "empty", "database", "write", "bridge"])
async def test_run_mongo_eod_sync_reports_listing_failure_and_continues(iq_sync, stage):
    if stage == "trading":
        iq_sync.client.get_all_symbols.side_effect = RuntimeError("listing unavailable")
    elif stage == "search":
        iq_sync.client.get_company_search_bar.side_effect = RuntimeError("search unavailable")
    elif stage == "empty":
        iq_sync.client.get_all_symbols.return_value = []
    elif stage == "database":
        iq_sync.service._get_database.side_effect = RuntimeError("database unavailable")
    elif stage == "write":
        iq_sync.listings.side_effect = RuntimeError("listing write failed")
    else:
        iq_sync.listing_bridge.side_effect = RuntimeError("structured listing write failed")

    result = await mongo_eod_sync.run_mongo_eod_sync(symbols=["VCI"])
    # Failed/empty trading listings provide no authoritative STOCK classification.
    # Financial scheduling must not consume the oldest-50 quota with untyped symbols.
    financial_eligible = stage not in {"trading", "empty", "database"}

    assert persisted_summary(result) == {
        "symbols": 1, "rows": 1, "failures": 2 if stage == "database" else 1,
        "listings": 4 if stage == "bridge" else 0,
        "financials": int(financial_eligible),
        "fallbacks": 0, "primary_failures": 0,
        "structured_rows": int(stage not in {"trading", "empty"}) + int(financial_eligible),
    }
    iq_sync.fallback.assert_not_awaited()
    if stage in {"trading", "empty"}:
        iq_sync.financials.assert_not_called()
        iq_sync.financial_bridge.assert_not_awaited()


@pytest.mark.asyncio
async def test_run_mongo_eod_sync_counts_structured_listings(iq_sync):
    iq_sync.listing_bridge.return_value = 4

    result = await mongo_eod_sync.run_mongo_eod_sync(symbols=["VCI"])

    assert persisted_summary(result) == {
        "symbols": 1, "rows": 1, "failures": 0, "listings": 4,
        "financials": 1, "fallbacks": 0, "primary_failures": 0, "structured_rows": 6,
    }
    iq_sync.listing_bridge.assert_awaited_once_with(
        iq_sync.client.get_all_symbols.return_value,
        iq_sync.client.get_company_search_bar.return_value,
    )


@pytest.mark.asyncio
async def test_run_mongo_eod_sync_reports_financial_schedule_failure(iq_sync):
    iq_sync.collection.aggregate.side_effect = RuntimeError("financial schedule unavailable")

    result = await mongo_eod_sync.run_mongo_eod_sync(symbols=["VCI"])

    assert persisted_summary(result) == {
        "symbols": 1, "rows": 1, "failures": 1, "listings": 4,
        "financials": 0, "fallbacks": 0, "primary_failures": 0, "structured_rows": 1,
    }
    iq_sync.financials.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("stage", ["fetch", "empty", "bridge"])
async def test_run_mongo_eod_sync_isolates_financial_failure(iq_sync, stage):
    def fetch(db, client, symbol, **kwargs):
        if symbol == "BAD":
            if stage == "fetch":
                raise RuntimeError("financial provider unavailable")
            if stage == "empty":
                return []
        return [{"symbol": symbol}]

    async def bridge(records):
        if stage == "bridge" and records[0]["symbol"] == "BAD":
            raise RuntimeError("structured financial write failed")
        return len(records)

    iq_sync.financials.side_effect = fetch
    iq_sync.financial_bridge.side_effect = bridge
    result = await mongo_eod_sync.run_mongo_eod_sync(symbols=["BAD", "GOOD"])

    assert persisted_summary(result) == {
        "symbols": 2, "rows": 2, "failures": 1, "listings": 4,
        "financials": 2 if stage == "bridge" else 1,
        "fallbacks": 0, "primary_failures": 0, "structured_rows": 3,
    }
    assert iq_sync.financials.call_count == 2


@pytest.mark.asyncio
async def test_run_mongo_eod_sync_counts_partial_structured_financial_failure(iq_sync):
    from vnibb.services.vietcap_financials import StructuredFinancialUnavailable

    def fetch(db, client, symbol, **kwargs):
        return [{"symbol": symbol}] * (3 if symbol == "BAD" else 1)

    async def bridge(records):
        if records[0]["symbol"] == "BAD":
            raise StructuredFinancialUnavailable(
                persisted_rows=2,
                unavailable_groups=["finance.cash_flow"],
                evidence=["cash flow response unavailable"],
            )
        return len(records)

    iq_sync.financials.side_effect = fetch
    iq_sync.financial_bridge.side_effect = bridge

    result = await mongo_eod_sync.run_mongo_eod_sync(symbols=["BAD", "GOOD"])

    assert persisted_summary(result) == {
        "symbols": 2, "rows": 2, "failures": 1, "listings": 4,
        "financials": 4, "fallbacks": 0, "primary_failures": 0, "structured_rows": 5,
    }
    assert iq_sync.financial_bridge.await_count == 2
    assert iq_sync.financial_bridge.await_args_list[1].args[0] == [{"symbol": "GOOD"}]


@pytest.mark.asyncio
async def test_run_mongo_eod_sync_admits_acquired_groups_after_later_fetch_failure(iq_sync):
    from vnibb.services.vietcap_ingestion import FinancialAcquisitionPartial

    records = [{"symbol": "VCI", "dataset": "finance.income_statement"}]
    iq_sync.financials.side_effect = FinancialAcquisitionPartial(records, {"finance.balance_sheet": "provider unavailable"}, 1)
    result = await mongo_eod_sync.run_mongo_eod_sync(symbols=["VCI"])

    assert result["financials"] == 1
    assert result["failures"] == 1
    assert result["structured_rows"] == 2
    iq_sync.financial_bridge.assert_awaited_once_with(records)


@pytest.mark.asyncio
async def test_run_mongo_eod_sync_keeps_index_points_in_mongo_without_stock_sql_bridge(iq_sync):
    iq_sync.client.get_all_symbols.return_value = [{"symbol": "VNINDEX", "type": "INDEX"}]
    iq_sync.client.get_company_search_bar.return_value = [{"code": "VNINDEX"}]
    result = await mongo_eod_sync.run_mongo_eod_sync(symbols=["VNINDEX"])

    assert result["symbols"] == 1
    assert result["rows"] == 1
    assert result["failures"] == 0
    assert result["structured_rows"] == 0
    assert iq_sync.service.bulk_upsert_eod_prices.await_args.args[1][0]["priceUnit"] == "index_points"
    iq_sync.price_bridge.assert_not_awaited()
    iq_sync.financials.assert_not_called()


@pytest.mark.asyncio
async def test_run_mongo_eod_sync_bounds_financials_to_oldest_fifty_symbols(iq_sync):
    symbols = [f"S{index:03}" for index in range(55)]
    iq_sync.client.get_all_symbols.return_value = [
        {"symbol": symbol, "type": "STOCK"} for symbol in symbols
    ]
    iq_sync.client.get_company_search_bar.return_value = [
        {"code": symbol, "comTypeCode": "CT"} for symbol in symbols
    ]
    iq_sync.collection.aggregate.return_value = [
        {"_id": symbol, "updatedAt": datetime(2026, 10, 12)} for symbol in symbols[:5]
    ]

    result = await mongo_eod_sync.run_mongo_eod_sync(symbols=symbols)

    assert persisted_summary(result) == {
        "symbols": 55, "rows": 55, "failures": 0, "listings": 55,
        "financials": 50, "fallbacks": 0, "primary_failures": 0, "structured_rows": 105,
    }
    assert [call.args[2] for call in iq_sync.financials.call_args_list] == symbols[5:]
    assert iq_sync.collection.aggregate.call_args.args[0] == [
        {"$match": {"source": "vietcap", "datasetGroup": "finance", "symbol": {"$in": symbols}}},
        {"$group": {"_id": "$symbol", "updatedAt": {"$max": "$updatedAt"}}},
    ]
    iq_sync.fallback.assert_not_awaited()


@pytest.mark.asyncio
async def test_run_mongo_eod_sync_reads_active_sql_universe(iq_sync):
    iq_sync.session.execute.return_value.scalars.return_value.all = lambda: ["vci", "SSI", "VCI", None]

    result = await mongo_eod_sync.run_mongo_eod_sync()

    assert persisted_summary(result) == {
        "symbols": 2, "rows": 2, "failures": 0, "listings": 4,
        "financials": 2, "fallbacks": 0, "primary_failures": 0, "structured_rows": 4,
    }
    iq_sync.session.execute.assert_awaited_once()
    statement = str(iq_sync.session.execute.call_args.args[0])
    assert "is_active" in statement and "exchange" in statement
    iq_sync.collection.distinct.assert_not_called()
    assert [call.args[0] for call in iq_sync.client.get_ohlc.call_args_list] == ["SSI", "VCI"]


@pytest.mark.asyncio
async def test_bulk_upsert_eod_prices_repeats_primary_natural_key(monkeypatch):
    from vnibb.services.mongo_market_data_service import MongoMarketDataService

    collection = MagicMock()
    collection.find.return_value = [{"tradeDate": datetime(2026, 6, 5, 7)}]
    service = MongoMarketDataService()
    monkeypatch.setattr(service, "_get_collection", lambda name: collection)
    monkeypatch.setattr(MongoMarketDataService, "enabled", property(lambda self: True))
    monkeypatch.setattr(service, "ensure_eod_indexes", lambda: ["uniq_symbol_tradeDate_source"])
    rows = [{
        "tradeDate": datetime(2026, 6, 5), "open": 10000, "high": 20000,
        "low": 10000, "close": 15000, "volume": 10, "price_unit": "VND",
        "price_source": "vietcap", "sourceUnit": "VND",
    }]

    assert await service.bulk_upsert_eod_prices("vci", rows, source="vietcap") == 1
    assert await service.bulk_upsert_eod_prices("VCI", rows, source="vietcap") == 1

    assert collection.bulk_write.call_count == 2
    for write in collection.bulk_write.call_args_list:
        operation = write.args[0][0]
        assert operation._filter == {
            "symbol": "VCI", "tradeDate": datetime(2026, 6, 5, 7), "source": "vietcap",
        }
        assert operation._upsert is True
        document = operation._doc["$set"]
        assert document["close"] == 15000
        assert document["priceUnit"] == "VND"
        assert document["providerSource"] == "vietcap"
        assert document["sourceKey"] == "vietcap:VCI:eod:2026-06-05"
        assert "createdAt" in operation._doc["$setOnInsert"]
        assert write.kwargs == {"ordered": False}


def test_ensure_eod_indexes_reuses_compatible_unique_index(monkeypatch):
    from unittest.mock import MagicMock, call

    from vnibb.services.mongo_market_data_service import MongoMarketDataService

    service = MongoMarketDataService()
    collection = MagicMock()
    collection.list_indexes.return_value = [
        {"name": "_id_", "key": {"_id": 1}},
        {
            "name": "legacy_eod_key",
            "key": {"symbol": 1, "tradeDate": 1, "source": 1},
            "unique": True,
            "hidden": True,
        },
    ]
    monkeypatch.setattr(service, "_get_collection", lambda name: collection)
    monkeypatch.setattr(MongoMarketDataService, "enabled", property(lambda self: True))

    ensured = service.ensure_eod_indexes()

    assert ensured == ["legacy_eod_key", "idx_symbol_tradeDate_desc"]
    assert collection.create_index.call_args_list == [
        call(
            [("symbol", 1), ("tradeDate", 1), ("source", 1)],
            name="legacy_eod_key",
            unique=True,
            hidden=True,
        ),
        call(
            [("symbol", 1), ("tradeDate", -1)], name="idx_symbol_tradeDate_desc"
        ),
    ]


def test_bulk_upsert_eod_prices_refuses_write_when_unique_index_fails(monkeypatch):
    import sys
    import types
    from unittest.mock import MagicMock

    from vnibb.services.mongo_market_data_service import MongoMarketDataService

    class FakeUpdateOne:
        def __init__(self, *args, **kwargs):
            pass

    fake_pymongo = types.ModuleType("pymongo")
    fake_pymongo.UpdateOne = FakeUpdateOne
    monkeypatch.setitem(sys.modules, "pymongo", fake_pymongo)

    service = MongoMarketDataService()
    collection = MagicMock()
    collection.list_indexes.return_value = [{"name": "_id_", "key": {"_id": 1}}]
    collection.create_index.side_effect = RuntimeError("duplicate keys")
    monkeypatch.setattr(service, "_get_collection", lambda name: collection)
    monkeypatch.setattr(MongoMarketDataService, "enabled", property(lambda self: True))

    with pytest.raises(RuntimeError, match="unique index.*could not be ensured"):
        import asyncio

        asyncio.run(
            service.bulk_upsert_eod_prices(
                "VCI",
                [{"tradeDate": datetime(2026, 6, 5), "close": 1,
                  "price_unit": "VND", "price_source": "vnstock_history:VCI"}],
            )
        )

    collection.bulk_write.assert_not_called()


def test_ensure_eod_indexes_rejects_incompatible_named_index(monkeypatch):
    from unittest.mock import MagicMock

    from vnibb.services.mongo_market_data_service import MongoMarketDataService

    service = MongoMarketDataService()
    collection = MagicMock()
    collection.list_indexes.return_value = [
        {
            "name": "uniq_symbol_tradeDate_source",
            "key": {"symbol": 1, "tradeDate": 1, "source": 1},
            "unique": False,
        }
    ]
    monkeypatch.setattr(service, "_get_collection", lambda name: collection)
    monkeypatch.setattr(MongoMarketDataService, "enabled", property(lambda self: True))

    with pytest.raises(RuntimeError, match="incompatible specification"):
        service.ensure_eod_indexes()

    collection.create_index.assert_not_called()


def test_bulk_upsert_eod_prices_refuses_existing_index_build_failure(monkeypatch):
    import sys
    import types
    from unittest.mock import MagicMock

    from vnibb.services.mongo_market_data_service import MongoMarketDataService

    class FakeUpdateOne:
        def __init__(self, *args, **kwargs):
            pass

    fake_pymongo = types.ModuleType("pymongo")
    fake_pymongo.UpdateOne = FakeUpdateOne
    monkeypatch.setitem(sys.modules, "pymongo", fake_pymongo)

    service = MongoMarketDataService()
    collection = MagicMock()
    collection.list_indexes.return_value = [
        {
            "name": "legacy_eod_key",
            "key": {"symbol": 1, "tradeDate": 1, "source": 1},
            "unique": True,
        }
    ]
    collection.create_index.side_effect = RuntimeError("index build incomplete")
    monkeypatch.setattr(service, "_get_collection", lambda name: collection)
    monkeypatch.setattr(MongoMarketDataService, "enabled", property(lambda self: True))

    with pytest.raises(RuntimeError, match="index build incomplete"):
        import asyncio

        asyncio.run(
            service.bulk_upsert_eod_prices(
                "VCI", [{"tradeDate": datetime(2026, 6, 5), "close": 1,
                         "price_unit": "VND", "price_source": "vnstock_history:VCI"}]
            )
        )

    collection.bulk_write.assert_not_called()


@pytest.mark.parametrize(
    "incompatible_option",
    [
        {"partialFilterExpression": {"source": {"$exists": True}}},
        {"sparse": True},
    ],
)
def test_ensure_eod_indexes_rejects_partial_or_sparse_unique_index(
    monkeypatch, incompatible_option
):
    from unittest.mock import MagicMock

    from vnibb.services.mongo_market_data_service import MongoMarketDataService

    service = MongoMarketDataService()
    collection = MagicMock()
    collection.list_indexes.return_value = [
        {
            "name": "legacy_eod_key",
            "key": {"symbol": 1, "tradeDate": 1, "source": 1},
            "unique": True,
            **incompatible_option,
        }
    ]
    monkeypatch.setattr(service, "_get_collection", lambda name: collection)
    monkeypatch.setattr(MongoMarketDataService, "enabled", property(lambda self: True))

    with pytest.raises(RuntimeError, match="incompatible specification"):
        service.ensure_eod_indexes()

    collection.create_index.assert_not_called()


# ---------------------------------------------------------------------------
# MongoMarketDataService.bulk_upsert_eod_prices document shape
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_bulk_upsert_eod_prices_propagates_bulk_write_failure(monkeypatch):
    import sys
    import types
    from unittest.mock import MagicMock

    from vnibb.services.mongo_market_data_service import MongoMarketDataService

    class FakeUpdateOne:
        def __init__(self, *args, **kwargs):
            pass

    fake_pymongo = types.ModuleType("pymongo")
    fake_pymongo.UpdateOne = FakeUpdateOne
    monkeypatch.setitem(sys.modules, "pymongo", fake_pymongo)

    service = MongoMarketDataService()
    collection = MagicMock()
    collection.find.return_value = []
    collection.bulk_write.side_effect = RuntimeError("unordered bulk partially failed")
    monkeypatch.setattr(service, "_get_collection", lambda name: collection)
    monkeypatch.setattr(MongoMarketDataService, "enabled", property(lambda self: True))
    monkeypatch.setattr(service, "ensure_eod_indexes", lambda: ["uniq_symbol_tradeDate_source"])

    with pytest.raises(RuntimeError, match="unordered bulk partially failed"):
        await service.bulk_upsert_eod_prices(
            "VCI", [{"tradeDate": datetime(2026, 6, 5), "close": 1,
                     "price_unit": "VND", "price_source": "vnstock_history:VCI"}]
        )


@pytest.mark.asyncio
async def test_bulk_upsert_eod_prices_builds_idempotent_ops(monkeypatch):
    import sys
    import types
    from unittest.mock import MagicMock

    captured = {}

    class FakeUpdateOne:
        def __init__(self, flt, update, upsert=False):
            self.filter = flt
            self.update = update
            self.upsert = upsert

    fake_pymongo = types.ModuleType("pymongo")
    fake_pymongo.UpdateOne = FakeUpdateOne
    monkeypatch.setitem(sys.modules, "pymongo", fake_pymongo)

    from vnibb.services.mongo_market_data_service import MongoMarketDataService

    svc = MongoMarketDataService()

    fake_coll = MagicMock()

    def fake_bulk_write(ops, ordered=False):
        captured["ops"] = ops

    fake_coll.bulk_write.side_effect = fake_bulk_write
    fake_coll.find.return_value = []
    monkeypatch.setattr(svc, "_get_collection", lambda name: fake_coll)
    monkeypatch.setattr(MongoMarketDataService, "enabled", property(lambda self: True))
    monkeypatch.setattr(svc, "ensure_eod_indexes", lambda: ["uniq_symbol_tradeDate_source"])

    rows = [
        {"tradeDate": datetime(2026, 6, 5), "open": 1.0, "high": 2.0, "low": 0.5, "close": 1.5, "volume": 100, "value": 150.0},
        {"tradeDate": datetime(2026, 6, 6), "open": 1.5, "high": 2.5, "low": 1.0, "close": 2.0, "volume": 200, "value": 400.0},
        {"tradeDate": datetime(2026, 6, 7), "open": 2.0, "high": 2.0, "low": 2.0, "close": None, "volume": 0},  # dropped: null close
    ]
    rows = [{**row, "price_source": "vnstock_history:VCI"} for row in rows]
    written = await svc.bulk_upsert_eod_prices("vci", rows)
    assert written == 2

    ops = captured["ops"]
    assert len(ops) == 2
    first = ops[0]
    # Idempotency key matches the vnstock fallback source AND the corpus's
    # 07:00:00 tradeDate convention. Prices are converted from vnstock's
    # thousand-VND convention to the corpus's raw-VND convention.
    assert first.filter == {
        "symbol": "VCI",
        "tradeDate": datetime(2026, 6, 5, 7, 0, 0),
        "source": "vnstock-data",
    }
    assert first.upsert is True
    doc = first.update["$set"]
    assert doc["symbol"] == "VCI"
    assert doc["tradeDate"] == datetime(2026, 6, 5, 7, 0, 0)
    assert doc["close"] == 1500.0
    assert doc["open"] == 1000.0
    assert doc["value"] == 150.0
    assert doc["interval"] == "1D"
    assert doc["source"] == "vnstock-data"
    assert doc["priceUnit"] == "VND"
    assert doc["price_source"] == "vnstock_history:VCI"


@pytest.mark.asyncio
async def test_bulk_upsert_eod_prices_skips_existing_vietcap_dates(monkeypatch):
    import sys
    import types
    from unittest.mock import MagicMock

    captured = {}

    class FakeUpdateOne:
        def __init__(self, flt, update, upsert=False):
            self.filter = flt
            self.update = update
            self.upsert = upsert

    fake_pymongo = types.ModuleType("pymongo")
    fake_pymongo.UpdateOne = FakeUpdateOne
    monkeypatch.setitem(sys.modules, "pymongo", fake_pymongo)

    from vnibb.services.mongo_market_data_service import MongoMarketDataService

    svc = MongoMarketDataService()
    fake_coll = MagicMock()
    fake_coll.list_indexes.return_value = [
        {
            "name": "legacy_eod_key",
            "key": {"symbol": 1, "tradeDate": 1, "source": 1},
            "unique": True,
        },
        {
            "name": "idx_symbol_tradeDate_desc",
            "key": {"symbol": 1, "tradeDate": -1},
        },
    ]
    fake_coll.find.return_value = [{"tradeDate": datetime(2026, 6, 5, 7, 0, 0)}]

    def fake_bulk_write(ops, ordered=False):
        captured["ops"] = ops

    fake_coll.bulk_write.side_effect = fake_bulk_write
    monkeypatch.setattr(svc, "_get_collection", lambda name: fake_coll)
    monkeypatch.setattr(MongoMarketDataService, "enabled", property(lambda self: True))

    rows = [
        {"tradeDate": datetime(2026, 6, 5), "open": 1.0, "high": 2.0, "low": 0.5, "close": 1.5},
        {"tradeDate": datetime(2026, 6, 6), "open": 1.5, "high": 2.5, "low": 1.0, "close": 2.0},
    ]
    rows = [{**row, "price_source": "vnstock_history:VCI"} for row in rows]

    written = await svc.bulk_upsert_eod_prices("vci", rows)
    assert written == 1
    assert len(captured["ops"]) == 1
    assert captured["ops"][0].filter["tradeDate"] == datetime(2026, 6, 6, 7, 0, 0)


@pytest.mark.asyncio
async def test_bulk_upsert_eod_prices_empty_rows_returns_zero():
    from vnibb.services.mongo_market_data_service import MongoMarketDataService

    svc = MongoMarketDataService()
    assert await svc.bulk_upsert_eod_prices("VCI", []) == 0


# ---------------------------------------------------------------------------
# market.py staleness helpers
# ---------------------------------------------------------------------------
def test_expected_latest_trading_day_skips_weekend():
    # Saturday 2026-06-06 -> Friday 2026-06-05
    assert _expected_latest_trading_day(date(2026, 6, 6)) == date(2026, 6, 5)
    # Sunday 2026-06-07 -> Friday 2026-06-05
    assert _expected_latest_trading_day(date(2026, 6, 7)) == date(2026, 6, 5)
    # Monday stays Monday
    assert _expected_latest_trading_day(date(2026, 6, 8)) == date(2026, 6, 8)


def test_coerce_to_date_variants():
    assert _coerce_to_date(date(2026, 6, 5)) == date(2026, 6, 5)
    assert _coerce_to_date(datetime(2026, 6, 5, 12, 0)) == date(2026, 6, 5)
    assert _coerce_to_date("2026-06-05") == date(2026, 6, 5)
    assert _coerce_to_date(None) is None
    assert _coerce_to_date("not-a-date") is None

# ---------------------------------------------------------------------------
# _dedup_eod_rows source-preference dedup
# ---------------------------------------------------------------------------
def test_dedup_eod_rows_prefers_vietcap_and_sorts():
    from vnibb.services.mongo_market_data_service import _dedup_eod_rows

    rows = [
        # Duplicate day: vnstock-data first, vietcap second -> vietcap wins
        {"tradeDate": datetime(2026, 6, 10), "close": 25.5, "source": "vnstock-data"},
        {"tradeDate": datetime(2026, 6, 10), "close": 25500.0, "source": "vietcap"},
        # Out-of-order unique day, unknown source kept
        {"tradeDate": datetime(2026, 6, 9), "close": 25000.0, "source": "other"},
        # Missing source treated as lowest priority but kept when alone
        {"tradeDate": datetime(2026, 6, 11), "close": 26000.0},
    ]
    deduped = _dedup_eod_rows(rows)
    assert [r["tradeDate"].day for r in deduped] == [9, 10, 11]
    assert deduped[1]["close"] == 25500.0  # vietcap bar won the duplicate day


def test_dedup_eod_rows_duplicate_same_rank_keeps_first():
    from vnibb.services.mongo_market_data_service import _dedup_eod_rows

    rows = [
        {"tradeDate": datetime(2026, 6, 10), "close": 1.0, "source": "vnstock-data"},
        {"tradeDate": datetime(2026, 6, 10), "close": 2.0, "source": "vnstock-data"},
    ]
    deduped = _dedup_eod_rows(rows)
    assert len(deduped) == 1
    assert deduped[0]["close"] == 1.0


@pytest.mark.asyncio
@pytest.mark.parametrize("symbol,marker,source,expected,unit", [
    ("VCI", "VND", "vnstock_history:VCI", 1.5, "VND"),
    ("VCI", None, "vnstock_history:VCI", 1500.0, "VND"),
    ("VNINDEX", None, "vnstock_history:VCI", 1.5, "index_points"),
])
async def test_mongo_ingestion_uses_source_or_explicit_marker(monkeypatch, symbol, marker, source, expected, unit):
    from unittest.mock import MagicMock

    from vnibb.services.mongo_market_data_service import MongoMarketDataService

    collection = MagicMock()
    collection.find.return_value = []
    service = MongoMarketDataService()
    monkeypatch.setattr(service, "_get_collection", lambda name: collection)
    monkeypatch.setattr(MongoMarketDataService, "enabled", property(lambda self: True))
    monkeypatch.setattr(service, "ensure_eod_indexes", lambda: [])
    raw = {"tradeDate": datetime(2026, 6, 5), "open": 1, "high": 2, "low": 0.5,
           "close": 1.5, "adjClose": 1.5, "value": 150, "volume": 100, "price_source": source}
    if marker:
        raw["price_unit"] = marker
    await service.bulk_upsert_eod_prices(symbol, [raw])
    doc = collection.bulk_write.call_args.args[0][0]._doc["$set"]
    assert doc["close"] == expected
    assert doc["priceUnit"] == unit
    assert doc["price_source"] == source
    assert doc["adj_close"] == expected
    assert doc["value"] == 150


@pytest.mark.asyncio
@pytest.mark.parametrize("price_source", [None, "vnstock_history:KBS"])
async def test_mongo_ingestion_rejects_unbacked_fallback_without_writing(monkeypatch, price_source):
    from vnibb.services.mongo_market_data_service import MongoMarketDataService

    collection = MagicMock()
    service = MongoMarketDataService()
    monkeypatch.setattr(service, "_get_collection", lambda name: collection)
    monkeypatch.setattr(MongoMarketDataService, "enabled", property(lambda self: True))
    monkeypatch.setattr(service, "ensure_eod_indexes", lambda: [])
    row = {"tradeDate": datetime(2026, 6, 5), "close": 60000,
           "price_unit": "VND", "price_source": price_source}

    with pytest.raises(ValueError, match="Free VCI provenance required"):
        await service.bulk_upsert_eod_prices("VCI", [row])

    collection.bulk_write.assert_not_called()


@pytest.mark.asyncio
async def test_mongo_ingestion_rejects_unknown_units_without_writing(monkeypatch):
    from unittest.mock import MagicMock

    from vnibb.services.mongo_market_data_service import MongoMarketDataService

    collection = MagicMock()
    service = MongoMarketDataService()
    monkeypatch.setattr(service, "_get_collection", lambda name: collection)
    monkeypatch.setattr(MongoMarketDataService, "enabled", property(lambda self: True))
    monkeypatch.setattr(service, "ensure_eod_indexes", lambda: [])
    with pytest.raises(ValueError, match="Unknown EOD price unit"):
        await service.bulk_upsert_eod_prices(
            "VCI", [{"tradeDate": datetime(2026, 6, 5), "close": 60000}], source="vietcap"
        )
    collection.bulk_write.assert_not_called()


def test_frame_and_dedup_keep_unit_contract_without_full_provenance():
    from vnibb.services.mongo_market_data_service import _dedup_eod_rows

    frame = pd.DataFrame([{"time": "2026-06-05", "close": 60000, "price_unit": "VND",
                           "adjusted_close": 59000, "price_source": "vnstock_history:VCI"}])
    rows = mongo_eod_sync._frame_to_rows(frame)
    assert rows[0]["price_unit"] == "VND"
    assert rows[0]["price_source"] == "vnstock_history:VCI"
    assert rows[0]["adj_close"] == 59000
    deduped = _dedup_eod_rows([{**rows[0], "priceUnit": "VND", "source": "vnstock-data"}])
    assert deduped[0]["priceUnit"] == "VND"
    assert deduped[0]["price_source"] == "vnstock_history:VCI"
