import sys
from datetime import date, datetime
from types import ModuleType, SimpleNamespace

import pandas as pd
import pytest

from vnibb.core.config import settings
from vnibb.providers.vnstock import runtime
from vnibb.services import technical_analysis
from vnibb.services.technical_analysis import TechnicalAnalysisService, normalize_history_frame


def _frame(close=0.5, periods=30):
    frame = pd.DataFrame({
        "time": pd.date_range("2026-01-01", periods=periods),
        "open": [close] * periods, "high": [close + 0.1] * periods,
        "low": [close - 0.1] * periods, "close": [close] * periods,
        "volume": [100] * periods,
    })
    frame.attrs["price_unit"] = "THOUSAND_VND"
    return frame


def _mock_history(monkeypatch, frame, asset_type=None):
    quote = SimpleNamespace(history=lambda **kwargs: frame, asset_type=asset_type)
    monkeypatch.setattr(runtime, "get_quote_class", lambda: lambda **kwargs: quote)


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["indicators", "history"])
async def test_technical_history_uses_vci_quote_and_requested_window(monkeypatch, mode):
    calls = []

    class Quote:
        def __init__(self, *, symbol, source):
            calls.append((symbol, source))

        def history(self, *, start, end, interval="1D"):
            calls.append((start, end, interval))
            frame = _frame()
            frame.attrs["price_unit"] = "THOUSAND_VND"
            return frame

    async def run_provider(fn, **kwargs):
        return fn()

    monkeypatch.setattr(settings, "vnstock_source", "vci")
    monkeypatch.setattr(runtime, "get_quote_class", lambda: Quote)
    monkeypatch.setattr(runtime, "run_reference_provider", run_provider)
    service = TechnicalAnalysisService()
    start, end = date(2026, 1, 1), date(2026, 2, 1)

    if mode == "indicators":
        result = await service.calculate_indicators("FPT", start, end)
        assert result["sma_20"] == 500
    else:
        result = await service._load_ohlcv_frame("FPT", start, end, interval="1W")
        assert result["close"].tolist() == [500] * 30

    interval = "1D" if mode == "indicators" else "1W"
    assert calls == [("FPT", "VCI"), ("2026-01-01", "2026-02-01", interval)]


@pytest.mark.asyncio
@pytest.mark.parametrize("unit,price,expected", [
    ("VND", 600, 600), ("unknown", 0.6, 500), ("index_points", 0.6, 500),
])
async def test_technical_history_quote_merge_requires_same_known_unit(monkeypatch, unit, price, expected):
    frame = _frame(periods=2)
    _mock_history(monkeypatch, frame)
    monkeypatch.setattr(settings, "vnstock_source", "VCI")

    async def fetch_quote(**kwargs):
        return SimpleNamespace(price=price, price_unit=unit, updated_at=datetime(2026, 1, 2, 15)), False

    monkeypatch.setattr(technical_analysis.VnstockStockQuoteFetcher, "fetch", fetch_quote)
    result = await TechnicalAnalysisService().get_ohlcv_data("FPT", date(2026, 1, 1), date(2026, 1, 2))

    assert result["close"].tolist() == [500, expected]
    assert set(result["price_unit"]) == {"VND"}
    assert result["volume"].tolist() == [100, 100]


@pytest.mark.asyncio
async def test_technical_derivative_history_retains_points_before_quote_merge(monkeypatch):
    frame = _frame(close=1200, periods=2)
    frame.attrs["price_unit"] = "index_points"
    _mock_history(monkeypatch, frame, asset_type="derivative")
    monkeypatch.setattr(settings, "vnstock_source", "VCI")

    async def fetch_quote(**kwargs):
        return SimpleNamespace(price=1201, price_unit="index_points", updated_at=datetime(2026, 1, 2, 15)), False

    monkeypatch.setattr(technical_analysis.VnstockStockQuoteFetcher, "fetch", fetch_quote)
    result = await TechnicalAnalysisService().get_ohlcv_data("VN30F2610", date(2026, 1, 1), date(2026, 1, 2))

    assert result["close"].tolist() == [1200, 1201]
    assert set(result["price_unit"]) == {"index_points"}


@pytest.mark.asyncio
@pytest.mark.parametrize("source", ["VCI", "MSN"])
async def test_technical_unknown_history_is_not_used_for_calculations(monkeypatch, source):
    frame = _frame()
    frame.attrs.pop("price_unit")
    frame.attrs["source"] = source
    _mock_history(monkeypatch, frame)
    monkeypatch.setattr(settings, "vnstock_source", "VCI")

    async def unexpected_quote(**kwargs):
        pytest.fail("Unknown history must not be merged with a quote")

    monkeypatch.setattr(technical_analysis.VnstockStockQuoteFetcher, "fetch", unexpected_quote)
    service = TechnicalAnalysisService()

    assert await service.get_ohlcv_data("FPT", date(2026, 1, 1), date(2026, 2, 1)) is None
    assert await service.calculate_indicators("FPT", date(2026, 1, 1), date(2026, 2, 1)) == {}


@pytest.mark.asyncio
async def test_pandas_indicators_use_vnd_without_scaling_volume(monkeypatch):
    _mock_history(monkeypatch, _frame())
    monkeypatch.setattr(settings, "vnstock_source", "VCI")

    result = await TechnicalAnalysisService().calculate_indicators("FPT", date(2026, 1, 1), date(2026, 2, 1))

    assert result["sma_20"] == 500
    assert result["atr_14"] == pytest.approx(200)


@pytest.mark.asyncio
async def test_installed_paid_ta_is_never_selected(monkeypatch):
    module = ModuleType("vnstock_ta")

    def paid_access(name):
        pytest.fail(f"Paid technical package accessed: {name}")

    module.__getattr__ = paid_access
    monkeypatch.setitem(sys.modules, "vnstock_ta", module)
    _mock_history(monkeypatch, _frame())
    monkeypatch.setattr(settings, "vnstock_source", "VCI")
    service = TechnicalAnalysisService()

    result = await service.calculate_indicators("FPT", date(2026, 1, 1), date(2026, 2, 1))

    assert service._ta_available is False
    assert result["sma_20"] == 500
    assert result["atr_14"] == pytest.approx(200)


def test_history_normalization_preserves_real_split_in_canonical_prices():
    frame = _frame(periods=2)
    frame["close"] = [100000, 50000]
    frame["price_unit"] = "VND"

    normalized = normalize_history_frame(frame, symbol="FPT", source="KBS")
    cleaned = TechnicalAnalysisService._clean_ohlcv_frame(normalized)

    assert cleaned["close"].tolist() == [100000, 50000]


def test_frame_category_keeps_unrecognized_index_in_points():
    frame = _frame(close=1200)
    frame.attrs["price_unit"] = "index_points"
    frame.category = "index"

    result = normalize_history_frame(frame, symbol="CUSTOMIDX", source="KBS")

    assert result["close"].tolist() == [1200] * 30
    assert set(result["price_unit"]) == {"index_points"}


@pytest.mark.parametrize("unit,expected", [(None, None), ("VND", 0.5)])
def test_stored_sponsor_technical_history_needs_explicit_equity_unit(unit, expected):
    frame = _frame(periods=2)
    frame.attrs.pop("price_unit")
    if unit:
        frame.attrs["price_unit"] = unit

    quote = SimpleNamespace()
    quote.__module__ = "vnstock_data.explorer.kbs.quote"
    result = normalize_history_frame(frame, symbol="FPT", source="KBS", provider=quote)

    if expected is None:
        assert result.empty
    else:
        assert result["close"].tolist() == [expected, expected]
        assert set(result["price_unit"]) == {"VND"}


@pytest.mark.asyncio
async def test_direct_indicator_endpoint_discloses_unknown_without_computing(monkeypatch):
    from vnibb.api.v1 import technical

    class Quote:
        __module__ = "vnstock.explorer.vci.quote"

        def __init__(self, **kwargs):
            pass

        def history(self, **kwargs):
            frame = _frame()
            frame.attrs["price_unit"] = "unknown"
            return frame

    monkeypatch.setattr(technical, "get_quote_class", lambda: Quote)
    monkeypatch.setattr(settings, "vnstock_timeout", 5)

    result = await technical.get_technical_indicators_direct("FPT", indicators="sma", period=14, source="VCI")

    assert result == {"error": "Price units unavailable", "price_unit": "unknown"}


def test_technical_frame_actual_source_overrides_requested_source():
    frame = _frame()
    frame.attrs["source"] = "MSN"

    assert normalize_history_frame(frame, symbol="FPT", source="KBS").empty


@pytest.mark.asyncio
async def test_signal_summary_unavailable_reason_insufficient_when_no_exclusion(monkeypatch):
    """Zero indicators without an observed unit exclusion must NOT claim unresolved units."""
    service = TechnicalAnalysisService()

    async def no_frame(*args, **kwargs):
        return None

    monkeypatch.setattr(service, "_load_ohlcv_frame", no_frame)

    summary = await service.get_signal_summary("FPT", lookback_days=200)

    assert summary["overall_signal"] == "unavailable"
    assert summary["total_indicators"] == 0
    assert summary["data_quality"]["reason"] == "insufficient_source_data"
    assert "unresolved_price_units" not in summary["data_quality"]["reason"]


@pytest.mark.asyncio
async def test_signal_summary_unavailable_reason_unresolved_when_exclusion_observed(monkeypatch):
    """Only an observed unit exclusion yields the unresolved_price_units reason."""
    service = TechnicalAnalysisService()

    async def excluded_frame(*args, **kwargs):
        frame = pd.DataFrame()
        frame.attrs["unit_exclusion"] = {
            "reason": "unresolved_price_units",
            "excluded_count": 3,
            "unresolved_sources": ["vnstock_history:KBS"],
        }
        return frame

    monkeypatch.setattr(service, "_load_ohlcv_frame", excluded_frame)

    summary = await service.get_signal_summary("FPT", lookback_days=200)

    assert summary["overall_signal"] == "unavailable"
    assert summary["total_indicators"] == 0
    assert summary["data_quality"]["reason"] == "unresolved_price_units"
    assert "excluded 3" in summary["data_quality"]["note"]
    assert "vnstock_history:KBS" in summary["data_quality"]["note"]


@pytest.mark.asyncio
@pytest.mark.parametrize("unit,scale", [("VND", 1000), ("index_points", 1)])
@pytest.mark.parametrize("signal,direction", [("sell", -1), ("buy", 1)])
@pytest.mark.parametrize("magnitude,expected", [(0.34, "unchanged"), (0.35, "neutral"), (0.36, "neutral")])
async def test_macd_fade_threshold_preserves_semantics_by_price_unit(
    monkeypatch, unit, scale, signal, direction, magnitude, expected,
):
    service = TechnicalAnalysisService()

    async def moving_averages(*args, **kwargs):
        return {
            "sma": {"sma_200": 100 * scale}, "ema": {}, "signals": {},
            "current_price": (110 if signal == "sell" else 90) * scale,
        }

    async def macd(*args, **kwargs):
        return {
            "macd": direction * scale, "histogram": direction * magnitude * scale,
            "signal": signal, "price_unit": unit,
        }

    async def no_indicator(*args, **kwargs):
        return {}

    monkeypatch.setattr(service, "get_moving_averages", moving_averages)
    monkeypatch.setattr(service, "get_macd", macd)
    for name in ("get_rsi", "get_bollinger_bands", "get_stochastic", "get_adx", "get_volume_analysis"):
        monkeypatch.setattr(service, name, no_indicator)

    summary = await service.get_signal_summary("FPT" if unit == "VND" else "VNINDEX")
    macd_detail = next(item for item in summary["indicators"] if item["name"] == "MACD")

    assert macd_detail["signal"] == (signal if expected == "unchanged" else expected)


@pytest.mark.asyncio
@pytest.mark.parametrize("unit,expected", [("VND", "confirmed_vnd"), ("index_points", "index_points"), (None, "unconfirmed")])
async def test_full_technical_quality_certifies_actual_frame_units(monkeypatch, unit, expected):
    service = TechnicalAnalysisService()
    frame = _frame(close=100000, periods=240)
    frame.loc[1, "close"] = 50000
    if unit:
        frame["price_unit"] = unit

    async def history(*args, **kwargs):
        return frame

    monkeypatch.setattr(service, "get_ohlcv_data", history)
    quality = await service.get_data_quality_summary("FPT")

    assert quality["unit_status"] == expected
    assert quality["unresolved_session_count"] == 0
    assert quality["bars"] == 240
    assert frame["close"].iloc[:2].tolist() == [100000, 50000]
