"""Offline DNSE rows cannot enter existing canonical histories or caches."""

import ipaddress
import os
from copy import deepcopy
from datetime import UTC, date, datetime
from types import SimpleNamespace
from urllib.parse import urlsplit
from uuid import uuid4

import pandas as pd
import pytest
from pymongo import MongoClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
from vnibb.core import cache as cache_module
from vnibb.core.cache import RedisClient, build_cache_key
from vnibb.core.config import settings
from vnibb.core.database import Base
from vnibb.core.price_units import conflicting_price_source, history_price_records
from vnibb.models.stock import Stock, StockPrice
from vnibb.providers.dnse import dnse_history
from vnibb.services import data_pipeline as pipeline_module
from vnibb.services.data_pipeline import DataPipeline
from vnibb.services.mongo_market_data_service import MongoMarketDataService

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


def _loopback(url):
    host = urlsplit(url).hostname
    try:
        return host == "localhost" or bool(host and ipaddress.ip_address(host).is_loopback)
    except ValueError:
        return False


@pytest.fixture
async def stores(monkeypatch):
    pg_url = os.environ.get("POSTGRES_CONTRACT_DATABASE_URL")
    mongo_url = os.environ.get("MONGODB_CONTRACT_URL")
    redis_url = os.environ.get("REDIS_CONTRACT_URL")
    if os.environ.get("POSTGRES_CONTRACT") != "1" or not pg_url or not mongo_url:
        pytest.skip("Requires disposable POSTGRES_CONTRACT_DATABASE_URL and MONGODB_CONTRACT_URL")
    for url in (pg_url, mongo_url, redis_url):
        if url:
            assert _loopback(url), "Contract store must be loopback"

    schema = f"dnse_admission_{uuid4().hex}"
    admin = create_async_engine(pg_url, poolclass=NullPool)
    async with admin.begin() as connection:
        await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_async_engine(
        pg_url, poolclass=NullPool, connect_args={"server_settings": {"search_path": schema}},
    )
    client = MongoClient(mongo_url, serverSelectionTimeoutMS=5000)
    database = client[schema]
    service = MongoMarketDataService()
    monkeypatch.setattr(service, "_get_collection", lambda name: database[name])
    monkeypatch.setattr(settings, "mongodb_enabled", True)
    monkeypatch.setattr(settings, "mongodb_url", mongo_url)
    monkeypatch.setattr(pipeline_module, "engine", engine)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(pipeline_module, "async_session_maker", sessions)
    redis = RedisClient(url=redis_url) if redis_url else None
    if redis:
        monkeypatch.setattr(settings, "redis_url", redis_url)
        monkeypatch.setattr(cache_module, "_redis_cache_enabled", lambda: True)
        monkeypatch.setattr(pipeline_module, "redis_client", redis)
    else:
        monkeypatch.setattr(settings, "redis_url", "")
    try:
        if redis:
            await redis.connect()
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        yield SimpleNamespace(sessions=sessions, mongo=database, service=service, redis=redis)
    finally:
        if redis:
            await redis.disconnect()
        client.drop_database(schema)
        client.close()
        await engine.dispose()
        async with admin.begin() as connection:
            await connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        await admin.dispose()


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
    cache_key = build_cache_key("vnibb", "price", "latest", symbol)
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

    try:
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
    finally:
        if stores.redis:
            await stores.redis.client.delete(cache_key)


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
