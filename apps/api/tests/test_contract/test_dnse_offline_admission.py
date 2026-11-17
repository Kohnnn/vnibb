"""Offline DNSE rows cannot enter existing canonical histories or caches."""

from copy import deepcopy
from datetime import UTC, date, datetime

import pandas as pd
import pytest
from sqlalchemy import select
from vnibb.core.cache import build_cache_key
from vnibb.core.price_units import conflicting_price_source, history_price_records
from vnibb.models.stock import Stock, StockPrice
from vnibb.providers.dnse import dnse_history
from vnibb.services.data_pipeline import DataPipeline

from dnse_store_fixture import stores

DAY = date(2026, 10, 26)


def dnse_row(symbol):
    # The prior official schema evidence records t/o/h/l/c/v as parallel arrays;
    # it does not establish price units, adjustment basis or session finality.
    payload = {
        "t": [int(datetime(2026, 10, 26, tzinfo=UTC).timestamp())],
        "o": [10.0], "h": [12.0], "l": [9.0], "c": [11.0], "v": [100], "nextTime": 0,
    }
    row = dnse_history(symbol, payload)[0]
    assert row["source"] == "DNSE"
    assert row["price_source"] == "dnse_unknown"
    assert row["price_unit"] == "unknown"
    assert all(row.get(field) is None for field in ("open", "high", "low", "close", "volume", "value"))
    assert row.get("unavailable_reason")
    assert row.get("raw_data")
    return row


def test_history_normalization_preserves_explicit_row_source():
    row = dnse_row("FPT")
    frame = pd.DataFrame([row])
    frame.attrs.update(source="VCI", price_unit="VND")
    normalized = history_price_records(frame, symbol="FPT", source="VCI")[0]
    assert normalized["source"] == "DNSE"
    assert normalized["price_source"].upper().startswith("DNSE")
    assert normalized["price_unit"] == "unknown"
    assert normalized["close"] is None
    assert normalized["raw_data"] == row["raw_data"]


@pytest.mark.parametrize("source,expected", [
    ("VCI", "VCI"), ("KBS", "KBS"), ("TCBS", "TCBS"),
    ("vnstock_history:VCI", "VCI"), ("vnstock5_history:VCI", "VCI"),
    ("vnstock_data_history:VCI", "VCI"), ("vnstock_vnd:VCI", "VCI"),
    ("vnstock_points:VCI", "VCI"), ("vnstock-data", "VCI"),
    ("vietcap", "vietcap"), ("vietcap_vnd", "vietcap"),
])
def test_known_price_source_aliases_remain_compatible(source, expected):
    assert conflicting_price_source({"source": source}, expected) is None


async def sql_snapshot(sessions):
    async with sessions() as session:
        rows = (await session.scalars(select(StockPrice).order_by(StockPrice.symbol, StockPrice.time))).all()
        return [
            (r.id, r.stock_id, r.symbol, r.time, r.interval, r.open, r.high, r.low,
             r.close, r.volume, r.value, r.adj_close, r.source, r.created_at)
            for r in rows
        ]


@pytest.mark.asyncio
@pytest.mark.parametrize("symbol", ["FPT", "VNINDEX"])
async def test_replayed_unknown_dnse_rows_cannot_overwrite_histories_or_cache(stores, monkeypatch, caplog, symbol):
    async with stores.sessions.begin() as session:
        stock = Stock(symbol=symbol, is_active=1)
        session.add(stock)
        await session.flush()
        session.add(StockPrice(
            stock_id=stock.id, symbol=symbol, time=DAY, interval="1D", source="vnstock_vnd:VCI",
            open=10000, high=12000, low=9000, close=11000, volume=100, value=None, adj_close=None,
        ))

    collection = stores.mongo["market_prices_eod"]
    collection.insert_many([
        {"symbol": symbol, "tradeDate": datetime(2026, 10, 26, 7), "source": "vnstock-data",
         "price_source": "vnstock5_history:VCI", "providerSource": "VCI", "priceUnit": "VND",
         "open": 10000, "high": 12000, "low": 9000, "close": 11000, "volume": 100,
         "value": None, "adj_close": None, "raw": {"source": "VCI", "observation": 1}},
        {"symbol": symbol, "tradeDate": datetime(2026, 10, 26, 7), "source": "vietcap",
         "providerSource": "vietcap", "priceUnit": "VND", "open": 10100, "high": 12100,
         "low": 9100, "close": 11100, "volume": 110, "value": None, "adj_close": None,
         "raw": {"source": "vietcap", "observation": 2}},
    ])
    mongo_before = list(collection.find().sort([("source", 1), ("_id", 1)]))
    sql_before = await sql_snapshot(stores.sessions)
    cache_key = stores.redis_key(build_cache_key("vnibb", "price", "latest", symbol))
    if stores.redis:
        await stores.redis.client.set(cache_key, '{"source":"VCI","close":11000,"value":null}')
        cache_before = await stores.redis.client.get(cache_key)

    row = dnse_row(symbol)
    pipeline = DataPipeline()

    async def listing(_client):
        return [{"symbol": symbol, "type": "STOCK"}]

    async def history(*args, **kwargs):
        return pd.DataFrame([deepcopy(row)])

    async def wait(_bucket):
        return None

    monkeypatch.setattr(pipeline, "_fetch_trading_listing_rows", listing)
    monkeypatch.setattr(pipeline, "_fetch_stock_history_frame", history)
    monkeypatch.setattr(pipeline, "_fetch_quote_history_frame", history)
    monkeypatch.setattr(pipeline, "_wait_for_rate_limit", wait)
    if not stores.redis:
        async def no_cache(*args, **kwargs):
            pytest.fail("Rejected price must not publish a cache entry")
        monkeypatch.setattr(pipeline, "_cache_set_json", no_cache)

    for _ in range(2):
        caplog.clear()
        progress = {}
        count = await pipeline.sync_daily_prices(
            [symbol], start_date=DAY, end_date=DAY, progress=progress, cache_recent=True,
        )
        assert count == 0
        assert progress["stage_stats"]["prices"]["errors"] == 1
        assert f"Unknown price unit for {symbol}" in caplog.text
        for source in ("vnstock-data", "vietcap"):
            with pytest.raises(ValueError, match="provenance"):
                await stores.service.bulk_upsert_eod_prices(symbol, [deepcopy(row)], source=source)
        with pytest.raises(ValueError, match="Unsupported EOD source"):
            await stores.service.bulk_upsert_eod_prices(symbol, [deepcopy(row)], source="DNSE")
        assert await sql_snapshot(stores.sessions) == sql_before
        assert list(collection.find().sort([("source", 1), ("_id", 1)])) == mongo_before
        if stores.redis:
            assert await stores.redis.client.get(cache_key) == cache_before


@pytest.mark.asyncio
@pytest.mark.parametrize("symbol", ["FPT", "VNINDEX"])
@pytest.mark.parametrize("field,value", [
    ("source", "DNSE"),
    ("source", "DNSE:VCI"),
    ("providerSource", "anything:VCI"),
    ("provider_source", 42),
    ("source", {"claimed": "VCI"}),
    ("price_source", "DNSE:VCI"),
    ("price_source", 42),
])
async def test_conflicting_rows_cannot_impersonate_trusted_unit_or_source(stores, monkeypatch, caplog, symbol, field, value):
    async with stores.sessions.begin() as session:
        stock = Stock(symbol=symbol, is_active=1)
        session.add(stock)
        await session.flush()
        session.add(StockPrice(
            stock_id=stock.id, symbol=symbol, time=DAY, interval="1D", source="vnstock_vnd:VCI",
            open=10000, high=12000, low=9000, close=11000, volume=100, value=None, adj_close=None,
        ))
    row = {
        **dnse_row(symbol), "time": DAY, "tradeDate": datetime(2026, 10, 26, 7),
        "open": 20000, "high": 22000, "low": 19000, "close": 21000, "volume": 100,
        "price_unit": "VND", "price_source": "vnstock5_history:VCI",
    }
    row.update(source="VCI")
    row[field] = value
    collection = stores.mongo["market_prices_eod"]
    collection.insert_one({
        "symbol": symbol, "tradeDate": row["tradeDate"], "source": "vnstock-data",
        "providerSource": "VCI", "priceUnit": "VND", "close": 11000, "value": None,
        "raw": {"source": "VCI"},
    })
    mongo_before = list(collection.find())
    sql_before = await sql_snapshot(stores.sessions)
    pipeline = DataPipeline()

    async def listing(_client):
        return [{"symbol": symbol, "type": "STOCK"}]

    async def history(*args, **kwargs):
        return pd.DataFrame([deepcopy(row)])

    async def wait(_bucket):
        return None

    monkeypatch.setattr(pipeline, "_fetch_trading_listing_rows", listing)
    monkeypatch.setattr(pipeline, "_fetch_stock_history_frame", history)
    monkeypatch.setattr(pipeline, "_fetch_quote_history_frame", history)
    monkeypatch.setattr(pipeline, "_wait_for_rate_limit", wait)
    for _ in range(2):
        caplog.clear()
        progress = {}
        assert await pipeline.sync_daily_prices([symbol], start_date=DAY, end_date=DAY, progress=progress) == 0
        assert progress["stage_stats"]["prices"]["errors"] == 1
        assert f"Conflicting price provenance for {symbol}" in caplog.text
        with pytest.raises(ValueError, match="provenance"):
            await stores.service.bulk_upsert_eod_prices(symbol, [deepcopy(row)], source="vnstock-data")
        assert await sql_snapshot(stores.sessions) == sql_before
        assert list(collection.find()) == mongo_before


@pytest.mark.asyncio
async def test_known_vci_alias_is_admitted_by_sql_and_mongo(stores, monkeypatch):
    symbol = "FPT"
    async with stores.sessions.begin() as session:
        session.add(Stock(symbol=symbol, is_active=1))
    row = {
        "symbol": symbol, "time": datetime(2026, 10, 26, tzinfo=UTC), "tradeDate": datetime(2026, 10, 26, 7),
        "source": "vnstock-data", "providerSource": "VCI", "price_source": "vnstock5_history:VCI",
        "price_unit": "VND", "open": 10000, "high": 12000, "low": 9000,
        "close": 11000, "volume": 100, "value": None, "adj_close": None,
    }
    pipeline = DataPipeline()

    async def listing(_client):
        return [{"symbol": symbol, "type": "STOCK"}]

    async def history(*args, **kwargs):
        return pd.DataFrame([deepcopy(row)])

    async def wait(_bucket):
        return None

    monkeypatch.setattr(pipeline, "_fetch_trading_listing_rows", listing)
    monkeypatch.setattr(pipeline, "_fetch_stock_history_frame", history)
    monkeypatch.setattr(pipeline, "_wait_for_rate_limit", wait)
    pipeline.cache_writes_enabled = False
    assert await pipeline.sync_daily_prices([symbol], start_date=DAY, end_date=DAY, cache_recent=False) == 1
    assert await stores.service.bulk_upsert_eod_prices(symbol, [deepcopy(row)], source="vnstock-data") == 1
    stored = await sql_snapshot(stores.sessions)
    assert len(stored) == 1 and stored[0][8] == 11000 and stored[0][12] == "vnstock_vnd:VCI"
    document = stores.mongo["market_prices_eod"].find_one({"symbol": symbol})
    assert document["close"] == 11000 and document["providerSource"] == "VCI"
    assert document["value"] is None and document["adj_close"] is None


@pytest.mark.asyncio
async def test_cached_vietcap_row_cannot_hide_conflicting_lineage(stores, monkeypatch):
    row = {
        **dnse_row("FPT"), "source": "vietcap", "tradeDate": datetime(2026, 10, 26, 7),
        "open": 20000, "high": 22000, "low": 19000, "close": 21000, "volume": 100,
        "price_unit": "VND", "priceUnit": "VND", "providerSource": "DNSE",
    }
    stores.mongo["market_prices_eod"].insert_one(row)
    monkeypatch.setattr(
        "vnibb.services.mongo_market_data_service.get_mongo_market_data_service", lambda: stores.service,
    )

    class UnavailableVietcap:
        def get_ohlc(self, *args, **kwargs):
            raise RuntimeError("offline")

    with pytest.raises(ValueError, match="Conflicting IQ EOD provenance"):
        await DataPipeline()._fetch_stock_history_frame(
            UnavailableVietcap(), "FPT", DAY.isoformat(), DAY.isoformat(), instrument_type="STOCK",
        )
