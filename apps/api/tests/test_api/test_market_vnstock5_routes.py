from datetime import date

import pandas as pd
import pytest

from vnibb.api.v1 import market


@pytest.mark.asyncio
async def test_benchmark_uses_vci_index_ohlcv(monkeypatch):
    calls = []

    class Index:
        def ohlcv(self, **kwargs):
            calls.append(kwargs)
            return pd.DataFrame({"time": ["2026-01-02"], "close": [1250.25]})

    class Market:
        def index(self, symbol):
            assert symbol == "VNINDEX"
            return Index()

    monkeypatch.setattr(market, "import_vnstock_symbol", lambda name: (Market, "vnstock"))
    monkeypatch.setattr(market.settings, "vnstock_source", "VCI")
    result = await market._fetch_benchmark_history_from_provider(date(2026, 1, 1), date(2026, 1, 3))

    assert calls == [{"start": "2026-01-01", "end": "2026-01-03", "source": "VCI", "floating": None}]
    assert result.to_dict("records") == [{"time": "2026-01-02", "close_index": 1250.25}]

@pytest.mark.asyncio
async def test_benchmark_rejects_non_vci_before_import(monkeypatch):
    imported = []

    def forbidden_import(name):
        imported.append(name)
        raise AssertionError("SDK import must follow source admission")

    monkeypatch.setattr(market, "import_vnstock_symbol", forbidden_import)
    monkeypatch.setattr(market.settings, "vnstock_source", "KBS")
    result = await market._fetch_benchmark_history_from_provider(date(2026, 1, 1), date(2026, 1, 3))

    assert imported == []
    assert result.empty
    assert list(result.columns) == ["time", "close_index"]


@pytest.mark.asyncio
async def test_forex_uses_retail_columns_and_preserves_missing_values(client, monkeypatch):
    class Retail:
        def exchange_rate(self):
            return pd.DataFrame([{
                "currency_code": "USD", "currency_name": "US DOLLAR",
                "buy_cash": 24500.0, "buy_transfer": float("nan"),
                "sell": 24860.0, "date": date(2026, 2, 15),
            }])

    def load(name):
        assert name == "Retail"
        return Retail, "vnstock"

    monkeypatch.setattr(market, "import_vnstock_symbol", load)
    response = await client.get("/api/v1/market/forex-rates?limit=1")
    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 1
    assert payload["data"][0] == {
        "currency_code": "USD", "currency_name": "US DOLLAR", "buy_cash": 24500.0,
        "buy_transfer": None, "sell": 24860.0, "date": "2026-02-15",
    }


@pytest.mark.asyncio
async def test_commodities_reports_removed_gold_after_empty_yahoo(client, monkeypatch):
    async def no_yahoo(limit):
        return []

    monkeypatch.setattr(market, "_fetch_yahoo_commodities", no_yahoo)
    response = await client.get("/api/v1/market/commodities?limit=1")
    assert response.status_code == 200
    payload = response.json()
    assert payload["data"] == []
    assert payload["count"] == 0
    assert payload["error"] == "gold price helpers unavailable"
