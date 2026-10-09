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
    return pd.DataFrame({
        "time": pd.date_range("2026-01-01", periods=periods),
        "open": [close] * periods, "high": [close + 0.1] * periods,
        "low": [close - 0.1] * periods, "close": [close] * periods,
        "volume": [100] * periods,
    })


def _mock_history(monkeypatch, frame, asset_type=None):
    quote = SimpleNamespace(history=lambda **kwargs: frame, asset_type=asset_type)
    monkeypatch.setattr(runtime, "get_vnstock_class", lambda: lambda: SimpleNamespace(
        stock=lambda **kwargs: SimpleNamespace(quote=quote)
    ))
    monkeypatch.setattr(TechnicalAnalysisService, "_check_vnstock_ta", lambda self: None)


@pytest.mark.asyncio
@pytest.mark.parametrize("unit,price,expected", [
    ("VND", 600, 600), ("unknown", 0.6, 500), ("index_points", 0.6, 500),
])
async def test_technical_history_quote_merge_requires_same_known_unit(monkeypatch, unit, price, expected):
    frame = _frame(periods=2)
    _mock_history(monkeypatch, frame)
    monkeypatch.setattr(settings, "vnstock_source", "KBS")

    async def fetch_quote(**kwargs):
        return SimpleNamespace(price=price, price_unit=unit, updated_at=datetime(2026, 1, 2, 15)), False

    monkeypatch.setattr(technical_analysis.VnstockStockQuoteFetcher, "fetch", fetch_quote)
    result = await TechnicalAnalysisService().get_ohlcv_data("FPT", date(2026, 1, 1), date(2026, 1, 2))

    assert result["close"].tolist() == [500, expected]
    assert set(result["price_unit"]) == {"VND"}
    assert result["volume"].tolist() == [100, 100]


@pytest.mark.asyncio
async def test_technical_derivative_history_retains_points_before_quote_merge(monkeypatch):
    _mock_history(monkeypatch, _frame(close=1200, periods=2), asset_type="derivative")
    monkeypatch.setattr(settings, "vnstock_source", "KBS")

    async def fetch_quote(**kwargs):
        return SimpleNamespace(price=1201, price_unit="index_points", updated_at=datetime(2026, 1, 2, 15)), False

    monkeypatch.setattr(technical_analysis.VnstockStockQuoteFetcher, "fetch", fetch_quote)
    result = await TechnicalAnalysisService().get_ohlcv_data("VN30F2610", date(2026, 1, 1), date(2026, 1, 2))

    assert result["close"].tolist() == [1200, 1201]
    assert set(result["price_unit"]) == {"index_points"}


@pytest.mark.asyncio
async def test_technical_unknown_history_is_not_used_for_calculations(monkeypatch):
    _mock_history(monkeypatch, _frame())
    monkeypatch.setattr(settings, "vnstock_source", "MSN")

    async def unexpected_quote(**kwargs):
        pytest.fail("Unknown history must not be merged with a quote")

    monkeypatch.setattr(technical_analysis.VnstockStockQuoteFetcher, "fetch", unexpected_quote)
    service = TechnicalAnalysisService()

    assert await service.get_ohlcv_data("FPT", date(2026, 1, 1), date(2026, 2, 1)) is None
    assert await service._calculate_fallback("FPT", date(2026, 1, 1), date(2026, 2, 1)) == {}


@pytest.mark.asyncio
async def test_fallback_indicators_use_vnd_without_scaling_volume(monkeypatch):
    _mock_history(monkeypatch, _frame())
    monkeypatch.setattr(settings, "vnstock_source", "KBS")

    result = await TechnicalAnalysisService()._calculate_fallback("FPT", date(2026, 1, 1), date(2026, 2, 1))

    assert result["sma_20"] == 500
    assert result["atr_14"] == pytest.approx(200)


@pytest.mark.asyncio
@pytest.mark.parametrize("marked", [True, False])
async def test_premium_indicators_require_explicit_history_units(monkeypatch, marked):
    frame = _frame()
    if marked:
        frame.attrs["price_unit"] = "THOUSAND_VND"
    seen = []
    module = ModuleType("vnstock_ta")

    class DataSource:
        __module__ = "vnstock_ta.datasource"

        def __init__(self, **kwargs):
            pass

        def get_data(self):
            return frame

    class Indicator:
        def __init__(self, data):
            if not marked:
                pytest.fail("Unmarked premium history must not reach indicator calculations")
            seen.append(data)

        def sma(self, **kwargs):
            return pd.Series([500])

    module.DataSource = DataSource
    module.Indicator = Indicator
    monkeypatch.setitem(sys.modules, "vnstock_ta", module)
    monkeypatch.setattr(TechnicalAnalysisService, "_check_vnstock_ta", lambda self: None)
    monkeypatch.setattr(settings, "vnstock_source", "KBS")

    result = await TechnicalAnalysisService()._calculate_with_vnstock_ta("FPT", date(2026, 1, 1), date(2026, 2, 1))
    if not marked:
        assert result == {}
        assert seen == []
        return

    assert result["sma_20"] == 500
    assert seen[0]["close"].tolist() == [500] * 30
    assert seen[0]["volume"].tolist() == [100] * 30


def test_history_normalization_preserves_real_split_in_canonical_prices():
    frame = _frame(periods=2)
    frame["close"] = [100000, 50000]
    frame["price_unit"] = "VND"

    normalized = normalize_history_frame(frame, symbol="FPT", source="KBS")
    cleaned = TechnicalAnalysisService._clean_ohlcv_frame(normalized)

    assert cleaned["close"].tolist() == [100000, 50000]


def test_frame_category_keeps_unrecognized_index_in_points():
    frame = _frame(close=1200)
    frame.category = "index"

    result = normalize_history_frame(frame, symbol="CUSTOMIDX", source="KBS")

    assert result["close"].tolist() == [1200] * 30
    assert set(result["price_unit"]) == {"index_points"}


@pytest.mark.asyncio
@pytest.mark.parametrize("unit,expected", [(None, None), ("VND", 0.5)])
async def test_sponsor_technical_history_needs_explicit_equity_unit(monkeypatch, unit, expected):
    frame = _frame(periods=2)
    if unit:
        frame.attrs["price_unit"] = unit

    class Quote:
        __module__ = "vnstock_data.explorer.kbs.quote"

        def history(self, **kwargs):
            return frame

    monkeypatch.setattr(runtime, "get_vnstock_class", lambda: lambda: SimpleNamespace(
        stock=lambda **kwargs: SimpleNamespace(quote=Quote())
    ))
    monkeypatch.setattr(TechnicalAnalysisService, "_check_vnstock_ta", lambda self: None)
    monkeypatch.setattr(settings, "vnstock_source", "KBS")

    async def no_quote(**kwargs):
        return SimpleNamespace(price=None, updated_at=None), False

    monkeypatch.setattr(technical_analysis.VnstockStockQuoteFetcher, "fetch", no_quote)

    result = await TechnicalAnalysisService().get_ohlcv_data("FPT", date(2026, 1, 1), date(2026, 1, 2))

    if expected is None:
        assert result is None
    else:
        assert result["close"].tolist() == [expected, expected]
        assert set(result["price_unit"]) == {"VND"}


@pytest.mark.asyncio
async def test_direct_sponsor_indicator_endpoint_discloses_unknown_without_computing(monkeypatch):
    from vnibb.api.v1 import technical

    module = ModuleType("vnstock_data")

    class Quote:
        __module__ = "vnstock_data.explorer.kbs.quote"

        def __init__(self, **kwargs):
            pass

        def history(self, **kwargs):
            return _frame()

    module.Quote = Quote
    monkeypatch.setitem(sys.modules, "vnstock_data", module)
    monkeypatch.setattr(settings, "vnstock_timeout", 5)

    result = await technical.get_technical_indicators_direct("FPT", indicators="sma", period=14, source="KBS")

    assert result == {"error": "Price units unavailable", "price_unit": "unknown"}


def test_technical_frame_actual_source_overrides_requested_source():
    frame = _frame()
    frame.attrs["source"] = "MSN"

    assert normalize_history_frame(frame, symbol="FPT", source="KBS").empty


@pytest.mark.asyncio
async def test_signal_summary_unavailable_reason_insufficient_when_no_exclusion(monkeypatch):
    """Zero indicators without an observed unit exclusion must NOT claim unresolved units."""
    service = TechnicalAnalysisService()
    monkeypatch.setattr(TechnicalAnalysisService, "_check_vnstock_ta", lambda self: None)

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
    monkeypatch.setattr(TechnicalAnalysisService, "_check_vnstock_ta", lambda self: None)

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
    monkeypatch.setattr(TechnicalAnalysisService, "_check_vnstock_ta", lambda self: None)
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
    monkeypatch.setattr(TechnicalAnalysisService, "_check_vnstock_ta", lambda self: None)
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
