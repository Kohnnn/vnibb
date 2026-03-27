from __future__ import annotations

import pytest

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
