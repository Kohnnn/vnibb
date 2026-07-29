from __future__ import annotations

import asyncio
import sys
from datetime import datetime
from types import ModuleType, SimpleNamespace

import pandas as pd
import pytest

import vnibb.services.technical_analysis as technical_analysis
from vnibb.api.v1 import technical
from vnibb.core.config import settings
from vnibb.providers.vnstock import runtime
from vnibb.services.technical_analysis import TechnicalAnalysisService


@pytest.mark.asyncio
async def test_signal_summary_respects_long_term_trend_context(monkeypatch):
    monkeypatch.setattr(TechnicalAnalysisService, "_check_vnstock_ta", lambda self: None)
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
        return {"macd": -0.1, "signal": "sell", "histogram": -0.08}

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
    monkeypatch.setattr(TechnicalAnalysisService, "_check_vnstock_ta", lambda self: None)
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
        return {"macd": -0.5, "signal": "sell", "histogram": -0.42}

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
    monkeypatch.setattr(TechnicalAnalysisService, "_check_vnstock_ta", lambda self: None)
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

    class Quote:
        def history(self, **_kwargs):
            nonlocal history_calls
            history_calls += 1
            return frame

    class Stock:
        quote = Quote()

    class Vnstock:
        def stock(self, **_kwargs):
            return Stock()

    async def fetch_quote(**_kwargs):
        nonlocal quote_calls
        quote_calls += 1
        return SimpleNamespace(price=360.0, updated_at=datetime.now()), False

    monkeypatch.setattr(runtime, "get_vnstock_class", lambda: Vnstock)
    monkeypatch.setattr(
        technical_analysis.VnstockStockQuoteFetcher, "fetch", staticmethod(fetch_quote)
    )

    analysis = await TechnicalAnalysisService().get_full_technical_analysis("VCI")

    assert history_calls == 1
    assert quote_calls == 1
    assert analysis["symbol"] == "VCI"


@pytest.mark.asyncio
async def test_direct_indicators_uses_shared_asyncio_thread_pool(monkeypatch):
    calls = 0

    class Quote:
        def __init__(self, **_kwargs):
            pass

        def history(self, **_kwargs):
            return pd.DataFrame({"close": list(range(100, 130))})

    original_to_thread = asyncio.to_thread

    async def to_thread(func, *args, **kwargs):
        nonlocal calls
        calls += 1
        return await original_to_thread(func, *args, **kwargs)

    module = ModuleType("vnstock_data")
    module.Quote = Quote
    monkeypatch.setitem(sys.modules, "vnstock_data", module)
    monkeypatch.setattr(asyncio, "to_thread", to_thread)
    monkeypatch.setattr(settings, "vnstock_timeout", 5, raising=False)

    payload = await technical.get_technical_indicators_direct(
        "VCI", indicators="rsi,sma,ema", period=14, source="KBS"
    )

    assert calls == 1
    assert payload["symbol"] == "VCI"
