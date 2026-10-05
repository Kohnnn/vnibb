from datetime import date
from types import SimpleNamespace

import pytest
from vnibb.api.v1 import equity
from vnibb.core.price_units import normalize_price_record, persisted_price_record
from vnibb.providers.vnstock.equity_historical import (
    EquityHistoricalQueryParams,
    VnstockEquityHistoricalFetcher,
)
from vnibb.providers.vnstock.stock_quote import VnstockStockQuoteFetcher


def bar(**extra):
    return {"symbol": "XYZ", "time": "2026-06-08", "open": 0.4, "high": 0.6,
            "low": 0.3, "close": 0.5, "volume": 123, "value": 5000,
            "adj_close": 0.45, **extra}

@pytest.mark.parametrize("source", ["KBS", "VCI"])
def test_history_source_contract_scales_even_sub_thousand_vnd(source):
    rows = VnstockEquityHistoricalFetcher.transform_data(
        EquityHistoricalQueryParams(symbol="XYZ", start_date=date(2026, 6, 8),
                                    end_date=date(2026, 6, 8), source=source), [bar()],
    )
    assert rows[0].price_unit == "VND"
    assert (rows[0].open, rows[0].high, rows[0].low, rows[0].close) == (400, 600, 300, 500)
    assert rows[0].raw_close == 500
    assert rows[0].adjusted_close == 450
    assert rows[0].volume == 123
    assert rows[0].value == 5000


def test_explicit_vnd_prevents_double_scaling_and_preserves_low_price():
    row = normalize_price_record(bar(priceUnit="VND", change=0.1), source="vnstock_history:KBS")
    assert row["close"] == 0.5
    assert row["adj_close"] == 0.45
    assert row["change"] == 0.1
    assert normalize_price_record(row)["close"] == 0.5


@pytest.mark.parametrize("source", ["vnstock", "ohlcv_backfill_full", "MSN", "FMP"])
def test_ambiguous_legacy_provenance_never_guesses_from_magnitude(source):
    row = persisted_price_record(SimpleNamespace(**bar(source=source)))
    assert row["price_unit"] == "unknown"
    assert row["close"] == 0.5


def test_known_legacy_source_and_new_source_markers_are_distinct():
    assert persisted_price_record(SimpleNamespace(**bar(source="KBS")))["close"] == 500
    row = persisted_price_record(SimpleNamespace(**bar(source="vnstock_vnd:KBS")))
    assert row["close"] == 0.5
    assert row["price_unit"] == "VND"


def test_index_history_stays_points():
    row = normalize_price_record(bar(symbol="VNINDEX", close=1200), source="vnstock_history:KBS")
    assert row["price_unit"] == "index_points"
    assert row["close"] == 1200


def test_unknown_explicit_marker_overrides_provider_source():
    row = normalize_price_record(bar(price_unit="unknown"), source="vnstock_history:VCI")
    assert row["price_unit"] == "unknown"
    assert row["close"] == 0.5


def test_adjusted_db_prices_normalize_before_adjustment():
    row = equity._to_historical_data(SimpleNamespace(**bar(source="VCI")), adjustment_mode="adjusted")
    assert row.price_unit == "VND"
    assert row.close == 450
    assert row.raw_close == 500
    assert row.adjusted_close == 450
    assert row.open == 360
    assert row.adjustment_factor == 0.9


def test_mongo_vnd_price_remains_canonical():
    row = equity._to_historical_data_from_mongo(bar(priceUnit="VND", tradeDate="2026-06-08"))
    assert row.price_unit == "VND"
    assert row.close == 0.5


def test_merge_excludes_unknown_and_metadata_uses_selected_rows(monkeypatch):
    trusted = equity._to_historical_data_from_payload(bar(price_unit="VND"))
    unknown = trusted.model_copy(update={"price_unit": "unknown", "close": 50000})
    merged, counts = equity._merge_historical_rows([("mongo", [unknown]), ("db", [trusted])])
    assert merged == [trusted]
    assert counts == {"db": 1}
    monkeypatch.setattr(equity.settings, "market_holiday_dates", [])
    meta = equity._historical_resolution_meta(merged, "raw", start_date=date(2026, 6, 8),
        end_date=date(2026, 6, 8), interval="1D", source_counts=counts,
        mongo_docs=[{"priceUnit": "unknown"}], warnings=[])
    assert meta.unit_status == "confirmed_vnd"
    mixed = equity._historical_resolution_meta([trusted, unknown], "raw", start_date=date(2026, 6, 8),
        end_date=date(2026, 6, 8), interval="1D", source_counts=counts,
        mongo_docs=[{"priceUnit": "VND"}], warnings=[])
    assert mixed.unit_status == "mixed"


@pytest.mark.asyncio
async def test_latest_and_recent_cache_normalize_each_source_independently(monkeypatch):
    async def get_json(key):
        if ":latest:" in key:
            return bar(time="2026-06-09", price_source="vnstock_history:KBS", close=0.6)
        return [bar(price_unit="VND", close=500), bar(time="2026-06-09", price_source="vnstock_history:KBS", close=0.6)]
    monkeypatch.setattr(equity.redis_client, "get_json", get_json)
    quote = await equity._load_quote_from_price_cache("XYZ")
    assert quote.price_unit == "VND"
    assert quote.price == 600
    assert quote.prev_close == 500
    assert quote.change == 100
    assert quote.change_pct == 20


@pytest.mark.asyncio
async def test_unmarked_cache_is_not_spliced_into_vnd(monkeypatch):
    async def get_json(key):
        return bar() if ":latest:" in key else [bar()]
    monkeypatch.setattr(equity.redis_client, "get_json", get_json)
    assert await equity._load_quote_from_price_cache("XYZ") is None


@pytest.mark.asyncio
async def test_quote_provider_scales_all_price_fields_but_not_volume(monkeypatch):
    class History:
        empty = False
        def to_dict(self, orient):
            return [bar(close=0.4), bar(time="2026-06-09", close=0.5)]
    class Provider:
        def stock(self, **kwargs):
            return SimpleNamespace(quote=SimpleNamespace(history=lambda **kwargs: History()))
    monkeypatch.setattr("vnibb.providers.vnstock.runtime.get_vnstock_class", lambda: Provider)
    quote, cached = await VnstockStockQuoteFetcher.fetch("XYZ", source="KBS", use_cache=False)
    assert not cached
    assert quote.price_unit == "VND"
    assert (quote.price, quote.prev_close, quote.open, quote.high, quote.low) == (500, 400, 400, 600, 300)
    assert quote.change == 100
    assert quote.change_pct == 25
    assert quote.volume == 123


def test_screener_quote_uses_compatible_settled_prices_only():
    snapshot = SimpleNamespace(symbol="XYZ", price=0.6, volume=123,
        snapshot_date=date(2026, 6, 9), created_at=None,
        extended_metrics={"price_unit": "THOUSAND_VND", "change_pct": 20})
    latest = SimpleNamespace(**bar(time=date(2026, 6, 9), source="KBS", close=0.6))
    previous = SimpleNamespace(**bar(time=date(2026, 6, 8), source="vnstock_vnd", close=500))
    quote = equity._build_quote_from_screener_snapshot(snapshot, latest, previous)
    assert quote.price_unit == "VND"
    assert quote.price == 600
    assert quote.prev_close == 500
    assert quote.change == 100
    assert quote.open == 400
    unknown_previous = SimpleNamespace(**bar(source="vnstock", close=50))
    quote = equity._build_quote_from_screener_snapshot(snapshot, latest, unknown_previous)
    assert quote.prev_close == 500


def test_unknown_screener_snapshot_cannot_supply_a_quote():
    snapshot = SimpleNamespace(symbol="XYZ", price=500, extended_metrics={})
    assert equity._build_quote_from_screener_snapshot(snapshot) is None


def test_derivative_asset_metadata_preserves_points():
    record = normalize_price_record(bar(symbol="VN30F1M", asset_type="derivative", close=1300),
                                    source="vnstock_history:VCI")
    assert record["price_unit"] == "index_points"
    assert record["close"] == 1300


def test_index_points_cannot_be_spliced_into_equity_vnd_history():
    trusted = equity._to_historical_data_from_payload(bar(price_unit="VND"))
    points = trusted.model_copy(update={"time": date(2026, 6, 9), "price_unit": "index_points"})
    merged, counts = equity._merge_historical_rows([("mongo", [points]), ("db", [trusted])])
    assert merged == [trusted]
    assert counts == {"db": 1}


@pytest.mark.asyncio
async def test_quote_memory_cache_is_scoped_by_provider_source(monkeypatch):
    from vnibb.providers.vnstock.stock_quote import QuoteCache, StockQuoteData

    monkeypatch.setattr(QuoteCache, "_cache", {})
    QuoteCache.set("KBS:XYZ", StockQuoteData(symbol="XYZ", price=500, price_unit="VND"))
    calls = []
    class History:
        empty = False
        def to_dict(self, orient):
            return [bar(close=0.6)]
    class Provider:
        def stock(self, **kwargs):
            calls.append(kwargs["source"])
            return SimpleNamespace(quote=SimpleNamespace(history=lambda **kwargs: History()))
    monkeypatch.setattr("vnibb.providers.vnstock.runtime.get_vnstock_class", lambda: Provider)
    quote, cached = await VnstockStockQuoteFetcher.fetch("XYZ", source="VCI")
    assert not cached
    assert quote.price == 600
    assert calls == ["VCI"]


@pytest.mark.asyncio
async def test_rolling_range_filters_unconfirmed_db_prices(monkeypatch):
    trusted = equity._to_historical_data_from_payload(bar(price_unit="VND", high=600, low=300))
    unknown = trusted.model_copy(update={"price_unit": "unknown", "high": 600000})
    async def historical(*args, **kwargs):
        return [unknown, trusted]
    monkeypatch.setattr(equity, "_load_historical_from_db", historical)
    rows = await equity._load_rolling_price_window(None, "XYZ")
    assert rows == [trusted]


@pytest.mark.parametrize("symbol", ["VNMID", "VNFINSELECT", "UPCOMLAR", "VN100F1M", "VN30F2411", "41I1G3000"])
def test_registered_indices_and_derivatives_are_not_equity_currency(symbol):
    row = normalize_price_record(bar(symbol=symbol, close=1300), source="vnstock_history:KBS")
    assert row["price_unit"] == "index_points"
    assert row["close"] == 1300


def test_frame_actual_source_overrides_requested_provider():
    import pandas as pd
    from vnibb.core.price_units import history_price_records

    frame = pd.DataFrame([bar()])
    frame.attrs["source"] = "MSN"
    row = history_price_records(frame, symbol="XYZ", source="KBS", provider="vnstock.explorer.kbs.quote")[0]
    assert row["price_unit"] == "unknown"
    assert row["close"] == 0.5
    assert row["price_source"] == "vnstock_history:MSN"


def test_sponsor_frame_requires_explicit_unit_contract():
    import pandas as pd
    from vnibb.core.price_units import history_price_records

    frame = pd.DataFrame([bar()])
    row = history_price_records(frame, symbol="XYZ", source="VCI", provider="vnstock_data.explorer.vci.quote")[0]
    assert row["price_unit"] == "unknown"
    assert row["close"] == 0.5
    frame.attrs["price_unit"] = "VND"
    row = history_price_records(frame, symbol="XYZ", source="VCI", provider="vnstock_data.explorer.vci.quote")[0]
    assert row["price_unit"] == "VND"
    assert row["close"] == 0.5


def test_unknown_index_marker_remains_uncertified():
    row = normalize_price_record(bar(symbol="VNINDEX", price_unit="unknown", close=1300),
                                 source="vnstock_history:VCI")
    assert row["price_unit"] == "unknown"
    assert row["close"] == 1300


@pytest.mark.parametrize("source", ["vnstock_vnd_bad", "vnstock_vnd:MSN", "KBS"])
def test_arbitrary_source_labels_do_not_certify_a_generic_record(source):
    row = normalize_price_record(bar(source=source))
    assert row["price_unit"] == "unknown"
    assert row["close"] == 0.5


@pytest.mark.asyncio
async def test_recent_cache_requires_explicit_history_lineage(monkeypatch):
    async def get_json(key):
        return [bar(source="KBS"), bar(time="2026-06-09", price_source="vnstock_history:KBS")]
    monkeypatch.setattr(equity.redis_client, "get_json", get_json)
    rows = await equity._load_historical_from_recent_cache("XYZ", date(2026, 6, 8), date(2026, 6, 9), "1D")
    assert [row.price_unit for row in rows] == ["unknown", "VND"]
    merged, counts = equity._merge_historical_rows([("recent_cache", rows)])
    assert [row.time for row in merged] == [date(2026, 6, 9)]
    assert merged[0].close == 500
    assert counts == {"recent_cache": 1}


@pytest.mark.asyncio
async def test_historical_api_discloses_unknown_omission_and_selected_units(client, monkeypatch):
    trusted = equity._to_historical_data_from_payload(bar(price_unit="VND"))
    unknown = trusted.model_copy(update={"time": date(2026, 6, 9), "price_unit": "unknown"})
    async def mongo(*args, **kwargs):
        return ([trusted, unknown], [{"priceUnit": "VND"}])
    async def no_cache(*args, **kwargs):
        return SimpleNamespace(hit=False, data=None)
    async def no_rows(*args, **kwargs):
        return []
    async def provider_down(*args, **kwargs):
        raise RuntimeError("provider offline")
    monkeypatch.setattr(equity, "_load_historical_from_mongo", mongo)
    monkeypatch.setattr(equity.CacheManager, "get_historical_prices", no_cache)
    monkeypatch.setattr(equity, "_load_historical_from_recent_cache", no_rows)
    monkeypatch.setattr(equity, "_load_historical_from_db", no_rows)
    monkeypatch.setattr(equity.VnstockEquityHistoricalFetcher, "fetch", provider_down)
    response = await client.get("/api/v1/equity/historical?symbol=XYZ&start_date=2026-06-08&end_date=2026-06-09")
    payload = response.json()
    assert response.status_code == 200
    assert len(payload["data"]) == 1
    assert payload["data"][0]["price_unit"] == "VND"
    assert payload["meta"]["unit_status"] == "confirmed_vnd"
    assert payload["meta"]["completeness_status"] == "partial"
    assert any("Excluded 1 row(s)" in warning for warning in payload["meta"]["warnings"])
