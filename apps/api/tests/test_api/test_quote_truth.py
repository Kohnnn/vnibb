from datetime import date

import pytest
from vnibb.models.stock import Stock, StockPrice
from vnibb.providers.vnstock.stock_quote import StockQuoteData, VnstockStockQuoteFetcher


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
            source="vnstock",
        )
    )
    await test_db.commit()

    response = await client.get("/api/v1/equity/XYZ/quote?refresh=true")

    assert response.status_code == 200
    assert response.json()["data"]["price"] == 42.0
    assert response.json()["data"]["updated_at"].startswith("2025-01-09T00:00:00")


@pytest.mark.asyncio
async def test_quote_rejects_invalid_ticker_without_fabricating_trade(client):
    response = await client.get("/api/v1/equity/XYZ-invalid/quote")

    assert response.status_code == 200
    assert response.json()["data"] is None
    assert response.json()["meta"]["count"] == 0
    assert response.json()["error"] == "Invalid symbol format. Expected a 3-character ticker."
