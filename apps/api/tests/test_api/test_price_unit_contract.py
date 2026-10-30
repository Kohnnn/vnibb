from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from vnibb.api.v1 import equity
from vnibb.core.price_units import history_price_records, normalize_price_record, persisted_price_record, persisted_price_source
from vnibb.providers.vnstock.equity_historical import (
    EquityHistoricalQueryParams,
    VnstockEquityHistoricalFetcher,
)
from vnibb.providers.vnstock.stock_quote import VnstockStockQuoteFetcher


def bar(**extra):
    return {"symbol": "XYZ", "time": "2026-06-08", "open": 0.4, "high": 0.6,
            "low": 0.3, "close": 0.5, "volume": 123, "value": 5000,
            "adj_close": 0.45, **extra}

def test_explicit_history_contract_scales_even_sub_thousand_vnd():
    rows = VnstockEquityHistoricalFetcher.transform_data(
        EquityHistoricalQueryParams(symbol="XYZ", start_date=date(2026, 6, 8),
                                    end_date=date(2026, 6, 8), source="VCI"), [bar(price_unit="THOUSAND_VND")],
    )
    assert rows[0].price_unit == "VND"
    assert (rows[0].open, rows[0].high, rows[0].low, rows[0].close) == (400, 600, 300, 500)
    assert rows[0].raw_close == 500
    assert rows[0].adjusted_close == 450
    assert rows[0].volume == 123
    assert rows[0].value == 5000


def test_unmarked_sdk5_historical_transform_preserves_unknown_units():
    rows = VnstockEquityHistoricalFetcher.transform_data(
        EquityHistoricalQueryParams(symbol="XYZ", source="VCI"), [bar()],
    )
    assert rows[0].price_unit == "unknown"
    assert rows[0].price_source == "vnstock5_history:VCI"
    assert (rows[0].open, rows[0].high, rows[0].low, rows[0].close) == (0.4, 0.6, 0.3, 0.5)
    assert rows[0].raw_close == 0.5
    assert rows[0].adjusted_close == 0.45


@pytest.mark.parametrize("source", ["KBS", "VCI", "TCBS"])
def test_retained_legacy_history_source_contract_stays_supported(source):
    row = normalize_price_record(bar(), source=f"vnstock_history:{source}")
    assert row["price_unit"] == "VND"
    assert row["close"] == 500


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


@pytest.mark.parametrize("as_mapping", [True, False])
def test_persisted_iq_price_preserves_raw_unit_contract(as_mapping):
    stored = bar(source="vietcap", raw_data={"priceUnit": "VND", "price_source": "vietcap"})
    row = persisted_price_record(stored if as_mapping else SimpleNamespace(**stored))
    assert row["price_unit"] == "VND"
    assert row["price_source"] == "vietcap"
    assert row["close"] == 0.5


def test_persisted_iq_price_without_unit_evidence_stays_unknown():
    row = persisted_price_record(bar(source="vietcap", raw_data={"source": "vietcap"}))
    assert row["price_unit"] == "unknown"
    assert row["close"] == 0.5


def test_certified_iq_vnd_marker_is_unscaled_but_legacy_iq_remains_unknown():
    certified = persisted_price_record(bar(source="vietcap_vnd"))
    assert certified["price_unit"] == "VND"
    assert certified["close"] == 0.5
    assert persisted_price_record(bar(source="vietcap"))["price_unit"] == "unknown"


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


@pytest.mark.parametrize("lineage,expected", [
    ({"source": "vietcap", "providerSource": "vietcap"}, "vietcap"),
    ({"source": "vnstock-data", "providerSource": "VCI"}, "VCI"),
    ({"source": "vietcap", "providerSource": "vietcap", "price_source": "certified-origin"}, "certified-origin"),
    ({}, None),
])
def test_mongo_historical_mapping_preserves_record_source(lineage, expected):
    row = equity._to_historical_data_from_mongo(bar(priceUnit="VND", tradeDate="2026-06-08", **lineage))
    assert row.price_source == expected
    assert row.close == 0.5


@pytest.mark.asyncio
async def test_historical_consumer_keeps_iq_lineage_without_certifying_session(client, monkeypatch):
    docs = [bar(priceUnit="VND", tradeDate="2026-06-08", source="vietcap", providerSource="vietcap")]
    async def mongo_prices(*args, **kwargs):
        return docs
    async def no_cache(*args, **kwargs):
        return SimpleNamespace(hit=False, data=None)
    async def no_rows(*args, **kwargs):
        return []
    provider = AsyncMock(side_effect=AssertionError("Complete Mongo row must not trigger VCI"))
    monkeypatch.setattr(equity, "get_mongo_market_data_service", lambda: SimpleNamespace(enabled=True, get_eod_prices_between=mongo_prices))
    monkeypatch.setattr(equity.CacheManager, "get_historical_prices", no_cache)
    monkeypatch.setattr(equity, "_load_historical_from_recent_cache", no_rows)
    monkeypatch.setattr(equity, "_load_historical_from_db", no_rows)
    monkeypatch.setattr(equity.VnstockEquityHistoricalFetcher, "fetch", provider)
    response = await client.get("/api/v1/equity/historical?symbol=XYZ&start_date=2026-06-08&end_date=2026-06-08")
    payload = response.json()
    assert response.status_code == 200
    assert payload["data"][0]["price_source"] == "vietcap"
    assert payload["data"][0]["close"] == 0.5
    assert payload["meta"]["source_counts"] == {"mongo": 1}
    assert payload["meta"]["session_basis"] == "unverified"
    provider.assert_not_awaited()


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
        attrs = {"price_unit": "THOUSAND_VND"}
        def to_dict(self, orient):
            return [bar(close=0.4), bar(time="2026-06-09", close=0.5)]
    class Provider:
        def __init__(self, *, symbol, source):
            assert (symbol, source) == ("XYZ", "VCI")
        def history(self, **kwargs):
            return History()
    monkeypatch.setattr("vnibb.providers.vnstock.runtime.get_quote_class", lambda: Provider)
    quote, cached = await VnstockStockQuoteFetcher.fetch("XYZ", source="VCI", use_cache=False)
    assert not cached
    assert quote.price_unit == "VND"
    assert (quote.price, quote.prev_close, quote.open, quote.high, quote.low) == (500, 400, 400, 600, 300)
    assert quote.change == 100
    assert quote.change_pct == 25
    assert quote.volume == 123
    assert quote.upstream_source == "vnstock5_history:VCI"


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
        attrs = {"price_unit": "THOUSAND_VND"}
        def to_dict(self, orient):
            return [bar(close=0.6)]
    class Provider:
        def __init__(self, *, symbol, source):
            calls.append(source)
        def history(self, **kwargs):
            return History()
    monkeypatch.setattr("vnibb.providers.vnstock.runtime.get_quote_class", lambda: Provider)
    quote, cached = await VnstockStockQuoteFetcher.fetch("XYZ", source="VCI")
    assert not cached
    assert quote.price == 600
    assert calls == ["VCI"]


@pytest.mark.asyncio
async def test_quote_rejects_unsupported_source_before_cache(monkeypatch):
    from vnibb.providers.vnstock.stock_quote import QuoteCache, StockQuoteData

    monkeypatch.setattr(QuoteCache, "_cache", {})
    QuoteCache.set("KBS:XYZ", StockQuoteData(symbol="XYZ", price=500, price_unit="VND"))
    with pytest.raises(ValueError, match="only free VCI"):
        await VnstockStockQuoteFetcher.fetch("XYZ", source="KBS")


@pytest.mark.asyncio
async def test_quote_cache_churn_evicts_unrelated_expired_and_oldest_fresh_entries(monkeypatch):
    from datetime import datetime, timedelta

    from vnibb.providers.vnstock.stock_quote import QuoteCache, StockQuoteData

    monkeypatch.setattr(QuoteCache, "_cache", {
        "VCI:OLD": (StockQuoteData(symbol="OLD", price=1000, price_unit="VND"),
                    datetime.utcnow() - timedelta(seconds=31)),
    })
    for index in range(51):
        symbol = f"S{index:02}"
        QuoteCache.set(f"VCI:{symbol}", StockQuoteData(symbol=symbol, price=42000, price_unit="VND"))
    quote, cached = await VnstockStockQuoteFetcher.fetch("S50", source="VCI")
    assert cached and quote.price == 42000
    assert "VCI:OLD" not in QuoteCache._cache
    assert "VCI:S00" not in QuoteCache._cache
    assert len(QuoteCache._cache) == 50


@pytest.mark.parametrize("source", ["KBS", "TCBS", "MSN", "FMP", "DNSE"])
def test_historical_params_reject_unsupported_source(source):
    with pytest.raises(ValueError):
        EquityHistoricalQueryParams(symbol="XYZ", source=source)


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
    assert row["price_source"] == "vnstock5_history:MSN"


@pytest.mark.parametrize("provider", [
    "vnstock.api.quote", "vnstock.ui.market", "vnstock.explorer.vci.quote", None,
])
@pytest.mark.parametrize("symbol", ["XYZ", "VNINDEX", "VN30F1M"])
def test_sdk5_history_without_unit_metadata_never_inherits_legacy_contract(provider, symbol):
    import pandas as pd

    frame = pd.DataFrame([bar(symbol=symbol, price_source="vnstock_history:VCI")])
    row = history_price_records(frame, symbol=symbol, source="VCI", provider=provider)[0]
    assert row["price_unit"] == "unknown"
    assert row["price_source"] == "vnstock5_history:VCI"
    assert (row["open"], row["high"], row["low"], row["close"]) == (0.4, 0.6, 0.3, 0.5)
    assert row["adj_close"] == 0.45
    assert persisted_price_source(row) == "vnstock_unknown"


@pytest.mark.parametrize("field", ["price_unit", "priceUnit"])
@pytest.mark.parametrize("marker,expected,unit,persisted_source", [
    ("VND", 0.5, "VND", "vnstock_vnd:VCI"),
    ("THOUSAND_VND", 500, "VND", "vnstock_vnd:VCI"),
    ("index_points", 0.5, "index_points", "vnstock_points:VCI"),
    ("unknown", 0.5, "unknown", "vnstock_unknown"),
    ("USD", 0.5, "unknown", "vnstock_unknown"),
])
def test_sdk5_history_uses_declared_frame_units_once(field, marker, expected, unit, persisted_source):
    import pandas as pd

    frame = pd.DataFrame([bar()])
    frame.attrs[field] = marker
    row = history_price_records(frame, symbol="XYZ", source="VCI", provider="vnstock.api.quote")[0]
    assert (row["price_unit"], row["close"]) == (unit, expected)
    assert row["price_source"] == "vnstock5_history:VCI"
    assert (row["volume"], row["value"]) == (123, 5000)
    assert normalize_price_record(row) == row
    assert persisted_price_source(row) == persisted_source
    assert persisted_price_record({**row, "source": "VCI"}) == {**row, "source": "VCI"}


@pytest.mark.parametrize("marker,unit", [("VND", "VND"), ("unknown", "unknown")])
def test_sdk5_history_record_unit_takes_precedence_over_frame(marker, unit):
    import pandas as pd

    frame = pd.DataFrame([bar(priceUnit=marker)])
    frame.attrs["price_unit"] = "THOUSAND_VND"
    row = history_price_records(frame, symbol="XYZ", source="VCI", provider="vnstock.api.quote")[0]
    assert row["price_unit"] == unit
    assert row["close"] == 0.5


@pytest.mark.asyncio
async def test_quote_provider_withholds_unmarked_sdk5_history(monkeypatch):
    calls = []

    class History:
        empty = False

        def to_dict(self, orient):
            return [bar()]

    class Provider:
        def __init__(self, *, symbol, source):
            calls.append((symbol, source))

        def history(self, **kwargs):
            calls.append("history")
            return History()

    monkeypatch.setattr("vnibb.providers.vnstock.runtime.get_quote_class", lambda: Provider)
    quote, cached = await VnstockStockQuoteFetcher.fetch("XYZ", source="VCI", use_cache=False)
    assert calls == [("XYZ", "VCI"), "history"]
    assert not cached
    assert quote.price_unit == "unknown"
    assert quote.price is None
    assert quote.change is None


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


@pytest.mark.asyncio
@pytest.mark.parametrize("date_layout", ["index", "named_index", "date_column"])
async def test_vci_backfill_preserves_provider_trading_dates(monkeypatch, date_layout):
    import sys
    from contextlib import asynccontextmanager
    from unittest.mock import AsyncMock

    import pandas as pd

    from scripts import backfill_ohlcv_full as backfill

    dates = pd.to_datetime(["2026-06-08", "2026-06-09"])
    frame = pd.DataFrame([bar(close=0.5, adj_close=0.45), bar(close=0.6, adj_close=0.55)]).drop(columns="time")
    if date_layout == "date_column":
        frame["date"] = dates
    else:
        frame.index = dates.rename("date" if date_layout == "named_index" else None)
    frame.attrs["price_unit"] = "THOUSAND_VND"
    provider = SimpleNamespace(source="VCI", __module__="vnstock.explorer.vci.quote",
                               history=lambda **kwargs: frame)
    monkeypatch.setitem(sys.modules, "vnstock", SimpleNamespace(
        Quote=lambda **kwargs: provider,
        status=lambda: {"authenticated": False, "tier": "guest"},
    ))
    session = SimpleNamespace(execute=AsyncMock(), commit=AsyncMock())
    @asynccontextmanager
    async def session_maker():
        yield session
    monkeypatch.setattr(backfill, "async_session_maker", session_maker)

    records = backfill._fetch_vci("XYZ", date(2026, 6, 8), date(2026, 6, 9))
    assert records is not None
    assert [row["time"] for row in records] == ["2026-06-08", "2026-06-09"]
    assert [(row["price_unit"], row["close"], row["adj_close"], row["volume"], row["value"]) for row in records] == [
        ("VND", 500, 450, 123, 5000), ("VND", 600, 550, 123, 5000),
    ]
    assert await backfill._persist_postgres(1, "XYZ", records) == 2
    persisted = [call.args[0].compile().params for call in session.execute.await_args_list]
    assert [(row["time"], row["close"], row["adj_close"], row["source"]) for row in persisted] == [
        (date(2026, 6, 8), 500, 450, "vnstock_vnd:VCI"),
        (date(2026, 6, 9), 600, 550, "vnstock_vnd:VCI"),
    ]
    session.commit.assert_awaited_once()


def test_historical_meta_never_certifies_unadjusted_history_as_raw():
    """A plain read cannot claim a raw session basis.

    No resolved source contract documents that its stored history is
    unadjusted (Vietcap's ``raw`` marker denotes VND denomination, not an
    unadjusted series), so an unadjusted read is disclosed as ``unverified``
    rather than certified as ``raw``.
    """
    rows = [equity._to_historical_data_from_payload(bar(price_unit="VND"))]
    warnings: list[str] = []
    meta = equity._historical_resolution_meta(
        rows,
        "raw",
        start_date=date(2026, 6, 8),
        end_date=date(2026, 6, 8),
        interval="1D",
        source_counts={"mongo": 1},
        mongo_docs=[],
        warnings=warnings,
    )
    assert meta.unit_status == "confirmed_vnd"
    assert meta.session_basis == "unverified"
    assert any("session price basis unverified" in warning for warning in meta.warnings)


def test_historical_meta_marks_applied_adjustment_as_adjusted_basis():
    row = equity._to_historical_data_from_payload(
        bar(price_unit="VND", adj_close=0.45), adjustment_mode="adjusted"
    )
    assert row.adjustment_applied is True
    meta = equity._historical_resolution_meta(
        [row],
        "adjusted",
        start_date=date(2026, 6, 8),
        end_date=date(2026, 6, 8),
        interval="1D",
        source_counts={"mongo": 1},
        mongo_docs=[],
        warnings=[],
    )
    assert meta.session_basis == "adjusted"


def test_historical_meta_index_basis_is_not_applicable():
    row = equity._to_historical_data_from_payload(
        bar(symbol="VNINDEX", price_unit="index_points", close=1200)
    )
    meta = equity._historical_resolution_meta(
        [row],
        "raw",
        start_date=date(2026, 6, 8),
        end_date=date(2026, 6, 8),
        interval="1D",
        source_counts={"mongo": 1},
        mongo_docs=[],
        warnings=[],
    )
    assert meta.unit_status == "not_applicable"
    assert meta.session_basis == "not_applicable"


def test_quant_failed_frame_discloses_unresolved_sessions():
    """The quant diagnostics meta survives on an empty unresolved frame."""
    import pandas as pd
    from vnibb.api.v1 import quant

    frame = pd.DataFrame(columns=["time", "open", "high", "low", "close", "volume"])
    frame.attrs["price_diagnostics"] = {
        "unit_status": "unconfirmed",
        "observed_session_count": 2,
        "excluded_session_count": 3,
        "excluded_price_unit_dates": ["2026-06-01", "2026-06-02", "2026-06-03"],
        "unresolved_excluded_dates": ["2026-06-02"],
    }
    meta = quant._price_diagnostics_meta(frame)
    assert meta["unit_status"] == "unconfirmed"
    assert meta["excluded_session_count"] == 3
    assert meta["unresolved_excluded_dates"] == ["2026-06-02"]
    assert quant._price_diagnostics_meta(None) == {}
    assert quant._price_diagnostics_meta(pd.DataFrame()) == {}


def test_quant_price_unit_warning_names_unresolved_sessions():
    from vnibb.api.v1 import quant

    warning = quant._build_price_unit_warning(
        {
            "unresolved_excluded_dates": ["2026-06-02"],
            "excluded_session_count": 3,
            "observed_session_count": 2,
            "requested_start_date": "2026-06-01",
            "requested_end_date": "2026-06-03",
        }
    )
    assert warning is not None
    assert "2026-06-02" in warning
    assert "derived analytics withheld" in warning
    assert quant._build_price_unit_warning({"unresolved_excluded_dates":[]}) is None
    assert quant._build_price_unit_warning(None) is None


@pytest.mark.asyncio
@pytest.mark.parametrize("row_trade_date, trade_date, expected", [
    (None, None, "2026-10-23T00:00:00+07:00"),
    (None, "2026-10-20", "2026-10-23T00:00:00+07:00"),
    (date(2026, 10, 22), "2026-10-20", "2026-10-22T00:00:00+07:00"),
])
async def test_stored_snapshot_uses_observation_date_not_later_ingestion(
    monkeypatch, row_trade_date, trade_date, expected
):
    from contextlib import asynccontextmanager
    from datetime import datetime

    snapshot = SimpleNamespace(
        symbol="FPT", price=57400, volume=123, snapshot_date=date(2026, 10, 23),
        trade_date=row_trade_date,
        created_at=datetime.fromisoformat("2026-10-24T12:00:00+00:00"),
        extended_metrics={"price_unit": "VND", "trade_date": trade_date,
                          "updated_at": "2026-10-24T12:00:00+00:00"},
    )
    db = SimpleNamespace(execute=AsyncMock(side_effect=[
        SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: [])),
        SimpleNamespace(scalar_one_or_none=lambda: snapshot),
    ]), rollback=AsyncMock())

    @asynccontextmanager
    async def session():
        yield db

    monkeypatch.setattr(equity, "async_session_factory", session)
    monkeypatch.setattr(equity, "_load_quote_from_price_cache", AsyncMock(return_value=None))
    quote, source = await equity._load_stored_quote("FPT")

    assert source == "postgres:stored_quote"
    assert quote.price == 57400
    assert quote.updated_at.isoformat() == expected
    assert equity._build_quote_from_screener_snapshot(snapshot).updated_at == snapshot.created_at


def test_snapshot_trade_session_controls_prior_close_and_ohlc():
    snapshot = SimpleNamespace(
        symbol="FPT", price=57400, volume=123, snapshot_date=date(2026, 10, 23),
        trade_date=date(2026, 10, 22), created_at=None,
        extended_metrics={"price_unit": "VND", "change_pct": 0},
    )
    latest = SimpleNamespace(**bar(time=date(2026, 10, 22), source="vnstock_vnd",
                                  open=56000, high=58000, low=55000, close=57400))
    previous = SimpleNamespace(**bar(time=date(2026, 10, 21), source="vnstock_vnd", close=56000))

    quote = equity._build_quote_from_screener_snapshot(
        snapshot, latest, previous, observation_clock=True
    )

    assert (quote.prev_close, quote.change, quote.change_pct) == (56000, 1400, 2.5)
    assert (quote.open, quote.high, quote.low) == (56000, 58000, 55000)
    assert quote.updated_at.isoformat() == "2026-10-22T00:00:00+07:00"


@pytest.mark.asyncio
@pytest.mark.parametrize("snapshot_trade_day, latest_day, expected_price, expected_prev_close, expected_change, expected_pct", [
    (22, 22, 57400, 56000, 1400, 2.5),
    (21, 22, 57400, 56000, 1400, 2.5),
    (22, 21, 58000, 56000, 2000, 3.57),
])
async def test_stored_snapshot_competes_by_trade_session_with_settled_rows(
    monkeypatch, snapshot_trade_day, latest_day, expected_price, expected_prev_close,
    expected_change, expected_pct,
):
    from contextlib import asynccontextmanager
    from datetime import datetime

    snapshot = SimpleNamespace(
        symbol="FPT", price=58000, volume=999, snapshot_date=date(2026, 10, 23),
        trade_date=date(2026, 10, snapshot_trade_day),
        created_at=datetime.fromisoformat("2026-10-24T12:00:00+00:00"),
        extended_metrics={"price_unit": "VND", "change_pct": 0},
    )
    rows = [
        SimpleNamespace(**bar(time=date(2026, 10, latest_day), source="vnstock_vnd",
                              open=55000, high=59000, low=54000,
                              close=57400 if latest_day == 22 else 56000)),
        SimpleNamespace(**bar(time=date(2026, 10, latest_day - 1), source="vnstock_vnd", close=56000)),
    ]
    db = SimpleNamespace(execute=AsyncMock(side_effect=[
        SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: rows)),
        SimpleNamespace(scalar_one_or_none=lambda: snapshot),
    ]), rollback=AsyncMock())

    @asynccontextmanager
    async def session():
        yield db

    monkeypatch.setattr(equity, "async_session_factory", session)
    monkeypatch.setattr(equity, "_load_quote_from_price_cache", AsyncMock(return_value=None))
    quote, source = await equity._load_stored_quote("FPT")

    assert source == "postgres:stored_quote"
    assert quote.price == expected_price
    assert (quote.prev_close, quote.change, quote.change_pct) == (
        expected_prev_close, expected_change, expected_pct
    )
    assert (quote.open, quote.high, quote.low) == (
        (55000, 59000, 54000) if latest_day == 22 else (None, None, None)
    )
    assert quote.updated_at.isoformat() == "2026-10-22T00:00:00+07:00"


@pytest.mark.asyncio
@pytest.mark.parametrize("loader", ["_load_quote_from_database", "_load_latest_screener_snapshot_quote"])
async def test_snapshot_selection_orders_observation_before_ingestion(test_db, loader):
    from vnibb.models.screener import ScreenerSnapshot

    test_db.add_all([
        ScreenerSnapshot(symbol="FPT", snapshot_date=date(2026, 10, 23),
                         trade_date=date(2026, 10, 20), price=55000,
                         extended_metrics={"price_unit": "VND"}),
        ScreenerSnapshot(symbol="FPT", snapshot_date=date(2026, 10, 22),
                         trade_date=date(2026, 10, 22), price=57400,
                         extended_metrics={"price_unit": "VND", "change_pct": 2.5}),
    ])
    await test_db.commit()

    quote = await getattr(equity, loader)(test_db, "FPT")

    assert quote.price == 57400
    assert quote.prev_close == pytest.approx(56000)
    assert quote.change_pct == 2.5


def test_stored_snapshot_never_promotes_same_session_ingestion_clock():
    snapshot = SimpleNamespace(
        symbol="FPT", price=57400, volume=123, snapshot_date=date(2026, 10, 23),
        trade_date=date(2026, 10, 22), created_at=None,
        extended_metrics={"price_unit": "VND", "updated_at": "2026-10-22T07:00:00+00:00"},
    )

    quote = equity._build_quote_from_screener_snapshot(snapshot, observation_clock=True)

    assert quote.updated_at.isoformat() == "2026-10-22T00:00:00+07:00"
