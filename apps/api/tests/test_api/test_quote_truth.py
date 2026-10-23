import asyncio
from contextlib import suppress
from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from vnibb.api.v1 import equity
from vnibb.core import cache
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models.stock import Stock, StockPrice
from vnibb.providers.vnstock.stock_quote import StockQuoteData, VnstockStockQuoteFetcher


@pytest.fixture(autouse=True)
def quote_session_factory(test_engine, monkeypatch):
    monkeypatch.setattr(equity, "async_session_factory", async_sessionmaker(
        test_engine, expire_on_commit=False,
    ))


@pytest.fixture
def cold_quote_cache(monkeypatch):
    monkeypatch.setattr(equity.settings, "environment", "development")
    monkeypatch.setattr(cache, "_memory_cache", {})
    monkeypatch.setattr(cache, "_inflight_cache_loads", {})
    monkeypatch.setattr(cache.redis_client, "_client", None)
    monkeypatch.setattr(cache.redis_client, "get_json", AsyncMock(return_value=None))


@pytest.mark.asyncio
async def test_concurrent_cold_quotes_share_stored_reads_after_caller_cancellation(
    client, test_db, test_engine, monkeypatch, cold_quote_cache,
):
    test_db.add(Stock(id=13501, symbol="FPT", exchange="HOSE", company_name="FPT"))
    test_db.add_all([
        StockPrice(id=13501, stock_id=13501, symbol="FPT", time=date(2026, 10, 21),
                   open=55000, high=56500, low=54800, close=56000, volume=1250000,
                   source="vnstock_vnd:VCI", interval="1D"),
        ScreenerSnapshot(symbol="FPT", snapshot_date=date(2026, 10, 23),
                         trade_date=date(2026, 10, 20), price=55000,
                         extended_metrics={"price_unit": "VND"}),
        ScreenerSnapshot(symbol="FPT", snapshot_date=date(2026, 10, 22),
                         trade_date=date(2026, 10, 22), price=57400,
                         extended_metrics={"price_unit": "VND", "change_pct": 2.5}),
    ])
    await test_db.commit()
    started, release, arrived = asyncio.Event(), asyncio.Event(), asyncio.Event()
    sessions, reads, checkouts = [], [], set()
    request_count = 0

    def checked_out(_connection, record, _proxy):
        checkouts.add(id(record))

    def checked_in(_connection, record):
        checkouts.discard(id(record))

    class QuoteSession(AsyncSession):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            sessions.append(self)

        async def execute(self, statement, *args, **kwargs):
            result = await super().execute(statement, *args, **kwargs)
            if "FROM stock_prices" in str(statement):
                reads.append(statement)
                started.set()
                await release.wait()
            return result

    factory = async_sessionmaker(test_engine, class_=QuoteSession, expire_on_commit=False)

    load_response = equity._load_quote_response

    async def quote_request(*args, **kwargs):
        nonlocal request_count
        request_count += 1
        if request_count == 20:
            arrived.set()
        return await load_response(*args, **kwargs)

    monkeypatch.setattr(equity, "async_session_factory", factory)
    monkeypatch.setattr(equity, "_load_quote_response", quote_request)
    event.listen(test_engine.sync_engine, "checkout", checked_out)
    event.listen(test_engine.sync_engine, "checkin", checked_in)
    tasks = [asyncio.create_task(client.get("/api/v1/equity/fpt/quote"))]
    try:
        await asyncio.wait_for(started.wait(), 2)
        assert checkouts
        tasks.extend(asyncio.create_task(client.get("/api/v1/equity/FPT/quote")) for _ in range(19))
        await asyncio.wait_for(arrived.wait(), 2)
        tasks[0].cancel()
        with suppress(asyncio.CancelledError):
            await tasks[0]
        release.set()
        responses = await asyncio.wait_for(asyncio.gather(*tasks[1:]), 3)

        assert len(reads) == 1
        assert all(response.status_code == 200 for response in responses)
        for response in responses:
            payload = response.json()
            assert payload["error"] is None
            assert payload["data"]["price"] == 57400
            assert payload["data"]["price_unit"] == "VND"
            assert payload["data"]["prevClose"] == pytest.approx(56000)
        assert all(not session.in_transaction() for session in sessions)
        assert not checkouts
    finally:
        release.set()
        await asyncio.gather(*tasks, return_exceptions=True)
        event.remove(test_engine.sync_engine, "checkout", checked_out)
        event.remove(test_engine.sync_engine, "checkin", checked_in)


@pytest.mark.asyncio
@pytest.mark.parametrize("sql_failure", [False, True], ids=["empty_sql", "failed_sql"])
async def test_quote_closes_sql_before_remote_fallback_and_cancellation(
    client, test_engine, monkeypatch, cold_quote_cache, sql_failure,
):
    mongo_started, mongo_release = asyncio.Event(), asyncio.Event()
    provider_started, provider_release = asyncio.Event(), asyncio.Event()
    survivor_arrived = asyncio.Event()
    checkouts, at_mongo, at_provider = set(), [], []

    def checked_out(_connection, record, _proxy):
        checkouts.add(id(record))

    def checked_in(_connection, record):
        checkouts.discard(id(record))

    class QuoteSession(AsyncSession):
        async def execute(self, statement, *args, **kwargs):
            result = await super().execute(statement, *args, **kwargs)
            if sql_failure:
                raise RuntimeError("isolated SQL read failure")
            return result

    factory = async_sessionmaker(test_engine, class_=QuoteSession, expire_on_commit=False)
    request_count = 0

    load_response = equity._load_quote_response

    async def quote_request(*args, **kwargs):
        nonlocal request_count
        request_count += 1
        if request_count == 2:
            survivor_arrived.set()
        return await load_response(*args, **kwargs)

    async def mongo_rows(*args, **kwargs):
        at_mongo.append(len(checkouts))
        mongo_started.set()
        await mongo_release.wait()
        return []

    async def provider(**kwargs):
        at_provider.append(len(checkouts))
        provider_started.set()
        await provider_release.wait()
        raise RuntimeError("provider offline")

    monkeypatch.setattr(equity, "async_session_factory", factory)
    monkeypatch.setattr(equity, "get_mongo_market_data_service", lambda: SimpleNamespace(
        enabled=True, get_latest_eod_prices=mongo_rows,
    ))
    monkeypatch.setattr(equity.VnstockStockQuoteFetcher, "fetch", provider)
    monkeypatch.setattr(equity, "_load_quote_response", quote_request)
    event.listen(test_engine.sync_engine, "checkout", checked_out)
    event.listen(test_engine.sync_engine, "checkin", checked_in)
    first = asyncio.create_task(client.get("/api/v1/equity/ZZZ/quote"))
    survivor = None
    try:
        await asyncio.wait_for(mongo_started.wait(), 2)
        survivor = asyncio.create_task(client.get("/api/v1/equity/ZZZ/quote"))
        await asyncio.wait_for(survivor_arrived.wait(), 2)
        first.cancel()
        with suppress(asyncio.CancelledError):
            await first
        mongo_release.set()
        await asyncio.wait_for(provider_started.wait(), 2)
        assert at_mongo == [0]
        assert at_provider == [0]
        provider_release.set()
        response = await asyncio.wait_for(survivor, 3)
        assert response.status_code == 200
        assert response.json()["data"] is None
        assert response.json()["error"] == "Quote unavailable."
        assert all(count == 0 for count in at_mongo)
        assert not checkouts
    finally:
        mongo_release.set()
        provider_release.set()
        await asyncio.gather(first, *([survivor] if survivor is not None else []), return_exceptions=True)
        event.remove(test_engine.sync_engine, "checkout", checked_out)
        event.remove(test_engine.sync_engine, "checkin", checked_in)



@pytest.mark.asyncio
async def test_provider_history_without_close_is_not_a_zero_price_trade(monkeypatch):
    class History:
        empty = False

        def to_dict(self, orient):
            return [{"close": None, "date": "2026-03-14"}]

    class Stock:
        quote = type("Quote", (), {"history": lambda self, **_kwargs: History()})()

    class Provider:
        def stock(self, **_kwargs):
            return Stock()

    monkeypatch.setattr("vnibb.providers.vnstock.runtime.get_vnstock_class", lambda: Provider)

    quote, _ = await VnstockStockQuoteFetcher.fetch("ZZZ", use_cache=False)

    assert quote.price is None
    assert quote.updated_at is None


@pytest.mark.asyncio
async def test_quote_is_unavailable_when_provider_and_stores_have_no_price(client, monkeypatch):
    async def provider_down(**_kwargs):
        raise RuntimeError("provider offline")

    async def empty_cache(_key):
        return None

    monkeypatch.setattr("vnibb.api.v1.equity.VnstockStockQuoteFetcher.fetch", provider_down)
    monkeypatch.setattr("vnibb.api.v1.equity.redis_client.get_json", empty_cache)

    response = await client.get("/api/v1/equity/ZZZ/quote?refresh=true")

    assert response.status_code == 200
    assert response.json()["data"] is None
    assert response.json()["meta"]["count"] == 0
    assert response.json()["error"]


@pytest.mark.asyncio
async def test_quote_rejects_unpriced_provider_response(client, monkeypatch):
    async def empty_provider(**_kwargs):
        return StockQuoteData(symbol="ZZZ"), False

    monkeypatch.setattr("vnibb.api.v1.equity.VnstockStockQuoteFetcher.fetch", empty_provider)

    response = await client.get("/api/v1/equity/ZZZ/quote?refresh=true")

    assert response.status_code == 200
    assert response.json()["data"] is None
    assert response.json()["error"]


@pytest.mark.asyncio
async def test_http_quote_keeps_refresh_error_when_unpriced_provider_uses_snapshot(
    client, test_db, monkeypatch, cold_quote_cache,
):
    monkeypatch.setattr(equity.VnstockStockQuoteFetcher, "fetch", AsyncMock(return_value=(StockQuoteData(symbol="FPT"), False)))
    test_db.add(ScreenerSnapshot(
        symbol="FPT", snapshot_date=date(2025, 1, 9), trade_date=date(2025, 1, 9),
        price=57000, extended_metrics={"price_unit": "VND"},
    ))
    await test_db.commit()

    response = await client.get("/api/v1/equity/FPT/quote?refresh=true")

    payload = response.json()
    assert payload["data"]["price"] == 57000
    assert payload["error"] == "Live quote unavailable; showing stored price."
    assert payload["meta"]["source"] == "postgres:stored_quote"
    assert payload["meta"]["as_of"].startswith("2025-01-09T00:00:00")


@pytest.mark.asyncio
async def test_quote_uses_dated_stored_price_when_provider_is_down(client, test_db, monkeypatch):
    async def provider_down(**_kwargs):
        raise RuntimeError("provider offline")

    monkeypatch.setattr("vnibb.api.v1.equity.VnstockStockQuoteFetcher.fetch", provider_down)
    test_db.add(Stock(id=321, symbol="XYZ", exchange="HOSE", company_name="Example"))
    test_db.add(
        StockPrice(
            id=321,
            stock_id=321,
            symbol="XYZ",
            time=date(2025, 1, 9),
            open=41.5,
            high=42.5,
            low=41.0,
            close=42.0,
            volume=1000,
            interval="1D",
            source="KBS",
        )
    )
    await test_db.commit()

    response = await client.get("/api/v1/equity/XYZ/quote?refresh=true")

    assert response.status_code == 200
    assert response.json()["data"]["price"] == 42_000.0
    assert response.json()["data"]["price_unit"] == "VND"
    assert response.json()["data"]["updated_at"].startswith("2025-01-09T00:00:00")

    payload = response.json()
    assert payload["error"] == "Live quote unavailable; showing stored price."
    assert payload["meta"]["source"] == "postgres:stored_quote"
    assert payload["meta"]["upstream_source"] == "KBS"
    assert payload["meta"]["as_of"].startswith("2025-01-09T00:00:00")
    assert payload["meta"]["stale"] is True


@pytest.mark.asyncio
@pytest.mark.parametrize("observation", [None, "2025-01-09"], ids=["unknown", "known"])
async def test_http_quote_keeps_cache_delivery_separate_from_unknown_supplier(
    client, monkeypatch, cold_quote_cache, observation,
):
    async def price_cache(key):
        if ":latest:" in key:
            return {"symbol": "FPT", "close": 57000, "price_unit": "VND",
                    "time": observation, "updated_at": "2026-10-23T12:30:00"}
        return []

    monkeypatch.setattr(equity.redis_client, "get_json", price_cache)
    provider = AsyncMock()
    monkeypatch.setattr(equity.VnstockStockQuoteFetcher, "fetch", provider)

    response = await client.get("/api/v1/equity/FPT/quote")

    assert response.status_code == 200
    payload = response.json()
    assert payload["data"]["price"] == 57000
    assert payload["data"]["price_unit"] == "VND"
    assert payload["data"]["updated_at"].startswith("2026-10-23T12:30:00")
    assert payload["meta"]["source"] == "redis:price_snapshot"
    assert payload["meta"]["upstream_source"] is None
    if observation:
        assert payload["meta"]["as_of"].startswith(observation)
        assert payload["meta"]["stale"] is True
    else:
        assert payload["meta"]["as_of"] is None
        assert payload["meta"]["stale"] is None
    provider.assert_not_called()


@pytest.mark.asyncio
async def test_http_quote_does_not_use_snapshot_write_clock_as_observation(
    client, test_db, monkeypatch, cold_quote_cache,
):
    test_db.add(ScreenerSnapshot(
        symbol="FPT", snapshot_date=date(2026, 10, 23), trade_date=date(2025, 1, 9),
        price=57000, extended_metrics={"price_unit": "VND", "updated_at": "2026-10-23T12:30:00"},
    ))
    await test_db.commit()

    response = await client.get("/api/v1/equity/FPT/quote")

    payload = response.json()
    assert payload["data"]["updated_at"].startswith("2026-10-23T12:30:00")
    assert payload["meta"]["as_of"].startswith("2025-01-09T00:00:00")
    assert payload["meta"]["source"] == "postgres:stored_quote"
    assert payload["meta"]["upstream_source"] is None
    assert payload["meta"]["stale"] is True


@pytest.mark.asyncio
async def test_http_quote_retains_mongo_value_and_raw_source_after_refresh_failure(
    client, monkeypatch, cold_quote_cache,
):
    monkeypatch.setattr(equity.VnstockStockQuoteFetcher, "fetch", AsyncMock(side_effect=RuntimeError("offline")))
    mongo = SimpleNamespace(enabled=True, get_latest_eod_prices=AsyncMock(return_value=[{
        "symbol": "FPT", "close": 57000, "price_unit": "VND", "tradeDate": "2025-01-09",
        "source": "admitted-supplier-envelope",
    }]))
    monkeypatch.setattr(equity, "get_mongo_market_data_service", lambda: mongo)

    response = await client.get("/api/v1/equity/FPT/quote?refresh=true")

    payload = response.json()
    assert payload["data"]["price"] == 57000
    assert payload["error"] == "Live quote unavailable; showing stored price."
    assert payload["meta"]["source"] == "mongo:market_prices_eod"
    assert payload["meta"]["upstream_source"] == "admitted-supplier-envelope"
    assert payload["meta"]["as_of"].startswith("2025-01-09T00:00:00")
    assert payload["meta"]["stale"] is True


@pytest.mark.asyncio
async def test_quote_rejects_invalid_ticker_without_fabricating_trade(client):
    response = await client.get("/api/v1/equity/XYZ-invalid/quote")

    assert response.status_code == 200
    assert response.json()["data"] is None
    assert response.json()["meta"]["count"] == 0
    assert response.json()["error"] == "Invalid symbol format. Expected a 3-character ticker."
