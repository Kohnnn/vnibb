from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta
from types import SimpleNamespace

import pandas as pd
import pytest

import vnibb.services.technical_analysis as technical_analysis
from vnibb.api.v1 import equity, technical
from vnibb.core.config import settings
from vnibb.providers.vnstock import runtime
from vnibb.services.technical_analysis import TechnicalAnalysisService


@pytest.mark.asyncio
async def test_signal_summary_respects_long_term_trend_context(monkeypatch):
    service = TechnicalAnalysisService()

    async def fake_ma(*_args, **_kwargs):
        return {
            "sma": {"sma_10": 109.0, "sma_20": 110.0, "sma_50": 112.0, "sma_200": 101.0},
            "ema": {"ema_10": 108.5, "ema_20": 109.5, "ema_50": 111.0},
            "signals": {"sma_10": "sell", "sma_20": "sell", "sma_50": "buy", "sma_200": "buy"},
            "current_price": 108.0,
        }

    async def fake_rsi(*_args, **_kwargs):
        return {"value": 58.0, "signal": "sell", "period": 14}

    async def fake_macd(*_args, **_kwargs):
        return {"macd": -100.0, "signal": "sell", "histogram": -80.0, "price_unit": "VND"}

    async def fake_bb(*_args, **_kwargs):
        return {"upper": 112.0, "percent_b": 0.46, "signal": "neutral"}

    async def fake_stoch(*_args, **_kwargs):
        return {"k": 52.0, "signal": "sell"}

    async def fake_adx(*_args, **_kwargs):
        return {"adx": 24.0, "signal": "buy", "trend_strength": "moderate"}

    async def fake_volume(*_args, **_kwargs):
        return {"volume": 1_500_000, "relative_volume": 1.4, "signal": "sell"}

    service.get_moving_averages = fake_ma
    service.get_rsi = fake_rsi
    service.get_macd = fake_macd
    service.get_bollinger_bands = fake_bb
    service.get_stochastic = fake_stoch
    service.get_adx = fake_adx
    service.get_volume_analysis = fake_volume

    summary = await service.get_signal_summary("VCI", 200)

    assert summary["overall_signal"] in {"neutral", "buy"}
    assert summary["trend_strength"] == "moderate"
    assert summary["neutral_count"] >= 2


@pytest.mark.asyncio
async def test_signal_summary_balances_category_weights(monkeypatch):
    service = TechnicalAnalysisService()

    async def fake_ma(*_args, **_kwargs):
        return {
            "sma": {"sma_10": 101.0, "sma_20": 103.0, "sma_50": 106.0, "sma_200": 104.0},
            "ema": {"ema_10": 101.0, "ema_20": 102.5, "ema_50": 105.0},
            "signals": {"sma_10": "buy", "sma_20": "buy", "sma_50": "buy", "sma_200": "buy"},
            "current_price": 107.0,
        }

    async def fake_rsi(*_args, **_kwargs):
        return {"value": 74.0, "signal": "sell", "period": 14}

    async def fake_macd(*_args, **_kwargs):
        return {"macd": -500.0, "signal": "sell", "histogram": -420.0, "price_unit": "VND"}

    async def fake_bb(*_args, **_kwargs):
        return {"upper": 112.0, "percent_b": 0.89, "signal": "sell"}

    async def fake_stoch(*_args, **_kwargs):
        return {"k": 88.0, "signal": "sell"}

    async def fake_adx(*_args, **_kwargs):
        return {"adx": 28.0, "signal": "buy", "trend_strength": "strong"}

    async def fake_volume(*_args, **_kwargs):
        return {"volume": 2_000_000, "relative_volume": 1.8, "signal": "buy"}

    service.get_moving_averages = fake_ma
    service.get_rsi = fake_rsi
    service.get_macd = fake_macd
    service.get_bollinger_bands = fake_bb
    service.get_stochastic = fake_stoch
    service.get_adx = fake_adx
    service.get_volume_analysis = fake_volume

    summary = await service.get_signal_summary("VCI", 200)

    assert summary["buy_count"] >= 4
    assert summary["sell_count"] >= 2
    assert summary["overall_signal"] in {"neutral", "buy"}


@pytest.mark.asyncio
async def test_full_analysis_loads_and_merges_quote_once(monkeypatch):
    monkeypatch.setattr(settings, "vnstock_source", "VCI")
    history_calls = 0
    quote_calls = 0
    frame = pd.DataFrame(
        {
            "time": pd.date_range(end=pd.Timestamp.today().normalize(), periods=260, freq="D"),
            "open": range(100, 360),
            "high": range(102, 362),
            "low": range(99, 359),
            "close": range(101, 361),
            "volume": [1_000_000] * 260,
        }
    )
    frame.attrs["price_unit"] = "THOUSAND_VND"

    async def no_retained_history(*_args, **_kwargs):
        return None

    monkeypatch.setattr(TechnicalAnalysisService, "_load_retained_ohlcv_frame", no_retained_history)

    class Quote:
        def history(self, **_kwargs):
            nonlocal history_calls
            history_calls += 1
            return frame

    async def fetch_quote(**_kwargs):
        nonlocal quote_calls
        quote_calls += 1
        return SimpleNamespace(price=360000.0, price_unit="VND", updated_at=datetime.now()), False

    monkeypatch.setattr(runtime, "get_quote_class", lambda: lambda **kwargs: Quote())
    monkeypatch.setattr(
        technical_analysis.VnstockStockQuoteFetcher, "fetch", staticmethod(fetch_quote)
    )

    analysis = await TechnicalAnalysisService().get_full_technical_analysis("VCI")

    assert history_calls == 1
    assert quote_calls == 1
    assert analysis["symbol"] == "VCI"
    assert analysis["price_unit"] == "VND"
    assert analysis["moving_averages"]["current_price"] == 360000.0


@pytest.mark.asyncio
@pytest.mark.parametrize("price_unit", ["VND", "unknown"])
async def test_full_analysis_uses_retained_sessions_when_live_provider_is_blocked(monkeypatch, price_unit):
    latest_session = date.today() - timedelta(days=20)
    rows = [
        equity.EquityHistoricalData(
            symbol="VCI", time=timestamp.date(), price_unit=price_unit,
            price_source="retained:test", open=100_000 + index * 100,
            high=102_000 + index * 100, low=99_000 + index * 100,
            close=101_000 + index * 100, volume=1_000_000,
        )
        for index, timestamp in enumerate(pd.bdate_range(end=latest_session, periods=260))
    ]
    provider_calls = 0

    async def retained_mongo(*_args, **_kwargs):
        return rows

    async def retained_sql(*_args, **_kwargs):
        return []

    def blocked_provider(*_args, **_kwargs):
        nonlocal provider_calls
        provider_calls += 1
        raise AssertionError("Retained full analysis must not acquire live provider data")

    monkeypatch.setattr(equity, "_load_historical_from_mongo", retained_mongo)
    monkeypatch.setattr(equity, "_load_historical_from_db", retained_sql)
    monkeypatch.setattr(runtime, "get_quote_class", blocked_provider)
    monkeypatch.setattr(technical_analysis.VnstockStockQuoteFetcher, "fetch", blocked_provider)

    analysis = await asyncio.wait_for(
        technical.get_full_analysis(symbol="VCI", timeframe="W", lookback_days=200),
        timeout=1,
    )
    assert provider_calls == 0

    if price_unit == "unknown":
        assert analysis.signals.overall_signal == "unavailable"
        assert analysis.signals.total_indicators == 0
        assert analysis.signals.data_quality["reason"] == "unresolved_price_units"
        assert analysis.data_quality["unresolved_session_count"] == 260
        return
    assert analysis.moving_averages.current_price == 126_900
    assert analysis.signals.total_indicators > 0
    assert analysis.data_quality["latest_date"] == rows[-1].time.isoformat()
    assert analysis.data_quality["freshness_as_of"] == rows[-1].time.isoformat()
    assert analysis.data_quality["source_counts"] == {"mongo": 260}
    assert analysis.data_quality["unit_status"] == "confirmed_vnd"
    assert analysis.data_quality["completeness_status"] == "partial"
    assert analysis.data_quality["stale"] is True


@pytest.mark.asyncio
async def test_direct_indicators_uses_shared_asyncio_thread_pool(monkeypatch):
    calls = 0
    quote_calls = []

    class Quote:
        __module__ = "vnstock.explorer.vci.quote"

        def __init__(self, *, symbol, source):
            quote_calls.append((symbol, source))

        def history(self, *, start, end):
            quote_calls.append((start, end))
            frame = pd.DataFrame({"close": list(range(100000, 130000, 1000))})
            frame.attrs["price_unit"] = "VND"
            return frame

    original_to_thread = asyncio.to_thread

    async def to_thread(func, *args, **kwargs):
        nonlocal calls
        calls += 1
        return await original_to_thread(func, *args, **kwargs)

    monkeypatch.setattr(technical, "get_quote_class", lambda: Quote)
    monkeypatch.setattr(asyncio, "to_thread", to_thread)
    monkeypatch.setattr(settings, "vnstock_timeout", 5, raising=False)

    payload = await technical.get_technical_indicators_direct(
        "VCI", indicators="rsi,sma,ema", period=14, source="VCI"
    )

    assert calls == 1
    assert quote_calls[0] == ("VCI", "VCI")
    start, end = (date.fromisoformat(value) for value in quote_calls[1])
    assert (end - start).days == 90
    assert payload["symbol"] == "VCI"
    assert payload["price_unit"] == "VND"
    assert payload["indicators"]["sma"]["value"] == 122500.0
    assert payload["indicators"]["rsi"]["value"] == 100.0
