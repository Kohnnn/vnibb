from datetime import date, datetime
from types import SimpleNamespace

import pytest
from vnibb.api.main import app
from vnibb.api.v1 import equity, health, screener
from vnibb.core.database import get_db
from vnibb.providers.vnstock.equity_historical import EquityHistoricalData
from vnibb.providers.vnstock.equity_profile import EquityProfileData
from vnibb.providers.vnstock.equity_screener import ScreenerData
from vnibb.providers.vnstock.stock_quote import StockQuoteData


class NoDatabase:
    async def execute(self, *args, **kwargs):
        raise AssertionError("response contract must not query a database")


class ProfileDatabase:
    async def execute(self, *args, **kwargs):
        return SimpleNamespace(first=lambda: None)


@pytest.fixture
def no_database(monkeypatch):
    async def override_get_db():
        yield NoDatabase()

    monkeypatch.setitem(app.dependency_overrides, get_db, override_get_db)


@pytest.fixture
def screener_row():
    return ScreenerData(
        symbol="VNM",
        organ_name="Vinamilk",
        exchange="HOSE",
        industry_name="Food",
        price=75000,
        updated_at=datetime(2026, 3, 14, 15),
    )


@pytest.fixture
def profile_row():
    return EquityProfileData(
        symbol="VNM",
        company_name="Vinamilk",
        short_name="VNM",
        exchange="HOSE",
        industry="Food",
    )


@pytest.fixture
def quote_row():
    return StockQuoteData(
        symbol="VNM",
        price=75000,
        open=74000,
        high=76000,
        low=73500,
        volume=1_000_000,
        updated_at=datetime(2026, 3, 14, 15),
    )


@pytest.fixture
def historical_row():
    return EquityHistoricalData(
        symbol="VNM",
        time=date(2026, 3, 13),
        open=74000,
        high=76000,
        low=73500,
        close=75000,
        volume=1_000_000,
    )


@pytest.mark.asyncio
async def test_browser_health_envelopes(client, monkeypatch):
    async def connected(*args, **kwargs):
        return True

    async def appwrite_status(*args, **kwargs):
        return {"status": "not_configured"}

    health._BASIC_HEALTH_CACHE.clear()
    monkeypatch.setattr("vnibb.core.database.check_database_connection", connected)
    monkeypatch.setattr(health, "check_appwrite_connectivity", appwrite_status)

    live, ready, basic = await client.get("/live"), await client.get("/ready"), await client.get("/health/")

    assert live.status_code == ready.status_code == basic.status_code == 200
    assert live.json() == {"alive": True}
    assert ready.json() == {"ready": True}
    assert basic.json()["providers"]["data_backend"] == "postgres"


@pytest.mark.asyncio
async def test_browser_screener_envelope_keeps_display_identity(client, monkeypatch, no_database, screener_row):
    async def fetch(_params):
        return [screener_row]

    async def identity(rows, *args, **kwargs):
        return rows

    async def universe(_universe):
        return None, {"universe": "ALL"}

    async def store(*args, **kwargs):
        return None

    monkeypatch.setattr(screener.VnstockScreenerFetcher, "fetch", fetch)
    monkeypatch.setattr(screener, "_enrich_screener_metrics", identity)
    monkeypatch.setattr(screener, "_hydrate_screener_rows", identity)
    monkeypatch.setattr(screener, "_enrich_discovery_fields", identity)
    monkeypatch.setattr(screener, "_merge_fundamental_snapshots", identity)
    monkeypatch.setattr(screener, "_resolve_index_universe", universe)
    monkeypatch.setattr(screener.CacheManager, "store_screener_data", store)

    response = await client.get("/api/v1/screener?limit=1&use_cache=false")

    assert response.status_code == 200
    payload = response.json()
    assert isinstance(payload["data"], list)
    assert payload["meta"]["count"] == 1
    assert (payload["data"][0].get("ticker") or payload["data"][0]["symbol"]) == "VNM"
    assert payload["data"][0]["organ_name"] == "Vinamilk"


@pytest.mark.asyncio
async def test_browser_profile_envelope(client, monkeypatch, profile_row):
    async def override_get_db():
        yield ProfileDatabase()

    async def fetch(_params):
        return [profile_row]

    async def no_shares(*args, **kwargs):
        return None

    async def no_market_cap(*args, **kwargs):
        return None

    async def no_last_data_date(*args, **kwargs):
        return None

    async def store(*args, **kwargs):
        return None

    monkeypatch.setitem(app.dependency_overrides, get_db, override_get_db)
    monkeypatch.setattr(equity.VnstockEquityProfileFetcher, "fetch", fetch)
    monkeypatch.setattr(equity, "_get_outstanding_shares", no_shares)
    monkeypatch.setattr(equity, "_resolve_profile_market_cap", no_market_cap)
    monkeypatch.setattr(equity, "_get_profile_last_data_date", no_last_data_date)
    monkeypatch.setattr(equity.CacheManager, "store_profile_data", store)

    response = await client.get("/api/v1/equity/VNM/profile?refresh=true")

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["count"] == 1
    assert payload["data"]["symbol"] == "VNM"
    assert payload["data"]["company_name"] == "Vinamilk"


@pytest.mark.asyncio
async def test_browser_quote_envelope_has_numeric_price(client, monkeypatch, no_database, quote_row):
    async def fetch(*args, **kwargs):
        return quote_row, {"source": "VCI"}

    async def no_snapshot(*args, **kwargs):
        return None

    monkeypatch.setattr(equity.VnstockStockQuoteFetcher, "fetch", fetch)
    monkeypatch.setattr(equity, "_load_latest_screener_snapshot_quote", no_snapshot)

    response = await client.get("/api/v1/equity/VNM/quote?refresh=true")

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["count"] == 1
    assert payload["data"]["symbol"] == "VNM"
    assert isinstance(payload["data"]["price"], (int, float))
    assert payload["data"]["price"] == 75000


@pytest.mark.asyncio
async def test_browser_historical_envelope_keeps_legacy_meta(client, monkeypatch, no_database, historical_row):
    async def no_rows(*args, **kwargs):
        return ([], []) if kwargs.get("include_provenance") else []

    async def no_cache(*args, **kwargs):
        return SimpleNamespace(hit=False, data=None)

    async def fetch(_params):
        return [historical_row]

    monkeypatch.setattr(equity, "_load_historical_from_mongo", no_rows)
    monkeypatch.setattr(equity, "_load_historical_from_recent_cache", no_rows)
    monkeypatch.setattr(equity.CacheManager, "get_historical_prices", no_cache)
    monkeypatch.setattr(equity.VnstockEquityHistoricalFetcher, "fetch", fetch)

    response = await client.get(
        "/api/v1/equity/historical?symbol=VNM&start_date=2026-03-13&end_date=2026-03-13"
    )

    assert response.status_code == 200
    payload = response.json()
    assert isinstance(payload["data"], list)
    assert payload["data"][0]["close"] == 75000
    assert payload["meta"]["count"] == 1
    assert payload["meta"]["adjustment_mode"] == "raw"
    assert payload["meta"]["adjustment_requested_count"] == 0
