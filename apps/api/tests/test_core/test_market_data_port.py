import pandas as pd
import pytest
from vnibb.core.price_units import history_price_records
from vnibb.providers import market_data
from vnibb.providers.vnstock import runtime


def test_history_preserves_unit_source_and_provider_metadata(monkeypatch):
    frame = pd.DataFrame([{"time": "2026-01-02", "close": 12}])
    frame.attrs["price_unit"] = "thousand_vnd"

    class Quote:
        source = "VCI"
        asset_type = "stock"

        def __init__(self, symbol, source):
            assert (symbol, source) == ("FPT", "VCI")

        def history(self, **kwargs):
            assert kwargs == {"start": "2026-01-01", "end": "2026-01-03", "interval": "1D"}
            return frame

    monkeypatch.setattr(runtime, "get_quote_class", lambda: Quote)
    result = market_data.history("FPT", "VCI", start="2026-01-01", end="2026-01-03", interval="1D")
    record = history_price_records(result, symbol="FPT", source="VCI")[0]
    assert record["close"] == 12000
    assert record["price_unit"] == "VND"
    assert record["price_source"] == "vnstock5_history:VCI"

def test_history_keeps_provider_source_without_claiming_frame_source(monkeypatch):
    frame = pd.DataFrame([{"time": "2026-01-02", "close": 12}])
    frame.attrs["price_unit"] = "VND"

    class Quote:
        source = "KBS"

        def __init__(self, **kwargs):
            pass

        def history(self, **kwargs):
            return frame

    monkeypatch.setattr(runtime, "get_quote_class", lambda: Quote)
    result = market_data.history("FPT", "VCI", start="2026-01-01", end="2026-01-03")
    assert "source" not in result.attrs
    assert history_price_records(result, symbol="FPT", source="VCI")[0]["price_source"] == "vnstock5_history:KBS"


@pytest.mark.parametrize("field", ["source", "providerSource", "provider_source", "price_source"])
def test_history_mixed_rows_admit_absent_source_but_reject_explicit_conflicts(monkeypatch, field):
    frame = pd.DataFrame([
        {"time": "2026-01-01", "close": 11},
        {"time": "2026-01-02", "close": 12, field: "VCI"},
        {"time": "2026-01-03", "close": 13, field: "DNSE"},
        {"time": "2026-01-04", "close": 14, field: ""},
        {"time": "2026-01-05", "close": 15, field: 17},
        {"time": "2026-01-06", "close": 16, field: float("inf")},
        {"time": "2026-01-07", "close": 17, field: {"claimed": "VCI"}},
    ])
    frame.attrs["price_unit"] = "VND"

    class Quote:
        source = "VCI"

        def __init__(self, **kwargs):
            pass

        def history(self, **kwargs):
            return frame

    monkeypatch.setattr(runtime, "get_quote_class", lambda: Quote)
    result = market_data.history("FPT", "VCI", start="2026-01-01", end="2026-01-07")
    rows = history_price_records(result, symbol="FPT", source="VCI")
    assert [row["price_unit"] for row in rows] == ["VND", "VND", *(["unknown"] * 5)]
    assert [row["price_source"] for row in rows] == [
        "vnstock5_history:VCI", "vnstock5_history:VCI", "DNSE", *(["invalid_source"] * 4),
    ]


def test_history_rejects_banned_source_before_loading_sdk(monkeypatch):
    monkeypatch.setattr(runtime, "get_quote_class", lambda: pytest.fail("SDK must not be loaded"))
    with pytest.raises(ValueError, match="only free VCI"):
        market_data.history("FPT", "TCBS", start="2026-01-01", end="2026-01-03")
