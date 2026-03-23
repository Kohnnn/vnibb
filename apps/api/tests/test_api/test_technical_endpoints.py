from __future__ import annotations

import pandas as pd
import pytest

from vnibb.api.v1 import technical


def _build_price_frame(rows: int = 220) -> pd.DataFrame:
    dates = pd.date_range(end=pd.Timestamp.now(tz=None).normalize(), periods=rows, freq="B")
    payload = []
    base = 100.0

    for index, timestamp in enumerate(dates):
        close = base + (index * 0.22) + ((index % 11) - 5) * 0.18
        payload.append(
            {
                "time": timestamp,
                "open": close - 0.6,
                "high": close + 1.4,
                "low": close - 1.2,
                "close": close,
                "volume": 900_000 + ((index % 13) * 21_000),
            }
        )

    return pd.DataFrame(payload)


@pytest.mark.asyncio
async def test_ichimoku_endpoint_returns_series_payload(client, monkeypatch):
    class DummyService:
        async def get_ohlcv_data(self, *_args, **_kwargs):
            return _build_price_frame(260)

    monkeypatch.setattr(technical, "get_ta_service", lambda: DummyService())

    response = await client.get("/api/v1/analysis/ta/VCI/ichimoku", params={"period": "1Y"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["symbol"] == "VCI"
    assert payload["period"] == "1Y"
    assert len(payload["data"]) >= 200
    assert payload["signal"]["cloud_trend"] in {"bullish", "bearish", "neutral"}
    assert "tenkan_sen" in payload["data"][-1]


@pytest.mark.asyncio
async def test_fibonacci_endpoint_returns_levels_and_nearest_level(client, monkeypatch):
    class DummyService:
        async def get_ohlcv_data(self, *_args, **_kwargs):
            return _build_price_frame(320)

    monkeypatch.setattr(technical, "get_ta_service", lambda: DummyService())

    response = await client.get(
        "/api/v1/analysis/ta/FPT/fibonacci",
        params={"lookback_days": 252, "direction": "auto"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["symbol"] == "FPT"
    assert payload["direction"] in {"retracement_from_high", "retracement_from_low"}
    assert payload["levels"]["61.8%"] > 0
    assert payload["nearest_level"]["level"] in payload["levels"]
    assert len(payload["price_data"]) >= 200
