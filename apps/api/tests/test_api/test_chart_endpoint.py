"""
Tests for Chart Data endpoint (/api/v1/chart-data/{symbol}).
"""

import pytest


@pytest.mark.asyncio
async def test_chart_data_returns_ohlcv(client, monkeypatch):
    """GET /api/v1/chart-data/VNM returns OHLCV array."""
    async def fake_fetch_chart_data(symbol, period="5Y", source=None):
        return [
            {"time": "2025-01-02", "open": 73000, "high": 74000, "low": 72500, "close": 73500, "volume": 1250000},
            {"time": "2025-01-03", "open": 73500, "high": 75000, "low": 73000, "close": 74500, "volume": 1100000},
        ]

    monkeypatch.setattr(
        "vnibb.api.v1.chart.fetch_chart_data",
        fake_fetch_chart_data,
    )

    response = await client.get("/api/v1/chart-data/VNM?period=1Y")
    assert response.status_code == 200
    payload = response.json()
    assert payload["symbol"] == "VNM"
    assert payload["period"] == "1Y"
    assert payload["count"] == 2
    assert len(payload["data"]) == 2
    assert payload["data"][0]["time"] == "2025-01-02"
    assert payload["data"][0]["close"] == 73500


@pytest.mark.asyncio
async def test_chart_data_invalid_period(client, monkeypatch):
    """GET /api/v1/chart-data/VNM?period=INVALID returns 400."""
    response = await client.get("/api/v1/chart-data/VNM?period=INVALID")
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_chart_data_empty_returns_404(client, monkeypatch):
    """GET /api/v1/chart-data/XXXXX returns 404 when no data."""
    async def fake_empty_fetch(symbol, period="5Y", source=None):
        return []

    monkeypatch.setattr(
        "vnibb.api.v1.chart.fetch_chart_data",
        fake_empty_fetch,
    )

    response = await client.get("/api/v1/chart-data/XXXXX")
    assert response.status_code == 404
