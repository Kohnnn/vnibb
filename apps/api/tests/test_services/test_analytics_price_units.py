from datetime import date, timedelta
from types import SimpleNamespace

import pandas as pd
import pytest
from vnibb.models.stock import StockPrice
from vnibb.services import chart_data_service, rs_snapshot_service
from vnibb.services.rs_rating_service import RSRatingService


class _Result:
    def __init__(self, rows):
        self.rows = rows

    def scalar(self):
        return self.rows[0] if self.rows else None

    def scalars(self):
        return self

    def all(self):
        return self.rows

    def __iter__(self):
        return iter(self.rows)


class _Session:
    def __init__(self, results):
        self.results = iter(results)
        self.statements = []
        self.committed = False

    async def execute(self, statement):
        self.statements.append(statement)
        return _Result(next(self.results))

    async def commit(self):
        self.committed = True

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False


def _price(symbol="FPT", close=0.5, source="KBS", day=0):
    return SimpleNamespace(
        symbol=symbol, time=date(2026, 1, 1) + timedelta(days=day),
        open=close, high=close, low=close, close=close, volume=100,
        source=source,
    )


@pytest.mark.asyncio
async def test_chart_db_normalizes_provenance_and_excludes_unknown(monkeypatch):
    session = _Session([[
        _price(source="KBS"),
        _price(close=600, source="vnstock_vnd:KBS", day=1),
        _price(source="vnstock", day=2),
    ]])
    monkeypatch.setattr(chart_data_service, "async_session_maker", lambda: session)

    bars = await chart_data_service._fetch_chart_data_from_db("FPT", date(2026, 1, 1))

    assert session.statements[0].column_descriptions[0]["expr"] is StockPrice
    assert [bar["close"] for bar in bars] == [500, 600]
    assert {bar["price_unit"] for bar in bars} == {"VND"}


@pytest.mark.asyncio
async def test_chart_db_keeps_index_points(monkeypatch):
    session = _Session([[_price(symbol="VNINDEX", close=1200, source="KBS")]])
    monkeypatch.setattr(chart_data_service, "async_session_maker", lambda: session)

    bars = await chart_data_service._fetch_chart_data_from_db("VNINDEX", date(2026, 1, 1))

    assert bars[0]["close"] == 1200
    assert bars[0]["price_unit"] == "index_points"


@pytest.mark.asyncio
@pytest.mark.parametrize("symbol,source,close,expected,unit,metadata", [
    ("FPT", "KBS", 0.5, 500, "VND", None),
    ("FPT", "MSN", 0.5, None, None, None),
    ("VNINDEX", "KBS", 1200, 1200, "index_points", None),
    ("VN30F2610", "KBS", 1200, 1200, "index_points", "frame"),
    ("VN30F2610", "KBS", 1200, 1200, "index_points", "quote"),
])
async def test_live_chart_normalizes_only_known_provider_units(
    monkeypatch, symbol, source, close, expected, unit, metadata,
):
    from vnibb.providers.vnstock import runtime

    frame = pd.DataFrame([{
        "time": date(2026, 1, 1), "open": close, "high": close,
        "low": close, "close": close, "volume": 100,
    }])
    quote = SimpleNamespace(history=lambda **kwargs: frame)
    if metadata == "frame":
        frame.category = "derivative"
    if metadata == "quote":
        quote.asset_type = "derivative"
    monkeypatch.setattr(runtime, "get_vnstock_class", lambda: lambda: SimpleNamespace(
        stock=lambda **kwargs: SimpleNamespace(quote=quote)
    ))
    monkeypatch.setattr(chart_data_service, "_cache", {})

    async def no_db_history(**kwargs):
        return []

    monkeypatch.setattr(chart_data_service, "_fetch_chart_data_from_db", no_db_history)
    bars = await chart_data_service.fetch_chart_data(symbol, source=source)

    if expected is None:
        assert bars == []
    else:
        assert bars[0]["close"] == expected
        assert bars[0]["price_unit"] == unit


@pytest.mark.asyncio
async def test_rs_returns_normalize_scale_transition_and_skip_unknown_history():
    stocks = [SimpleNamespace(symbol=symbol, company_name=symbol, sector=None, industry=None)
              for symbol in ("FPT", "VNM")]
    rows = [
        _price(close=0.5 if day < 35 else 500, source="KBS" if day < 35 else "vnstock_vnd:KBS", day=day)
        for day in range(70)
    ]
    rows.extend(_price(symbol="VNM", close=50, source="KBS", day=day) for day in range(70))
    rows.append(_price(symbol="VNM", close=50, source="ohlcv_backfill_full", day=70))
    session = _Session([rows])
    service = RSRatingService()

    ratings = await service._calculate_all_weighted_returns(
        session, stocks, dict.fromkeys(service.PERIODS, 0.1), date(2026, 4, 1),
    )

    assert session.statements[0].column_descriptions[0]["expr"] is StockPrice
    assert [(row["symbol"], row["weighted_return"]) for row in ratings] == [("FPT", 0)]


@pytest.mark.asyncio
async def test_latest_rs_price_retains_provenance_without_stale_unknown_fallback():
    session = _Session([[
        _price("FPT", close=0.5, source="VCI"),
        _price("VNM", close=0.5, source="vnstock_vnd:VCI"),
        _price("VCB", close=80, source="vnstock"),
        _price("VNINDEX", close=1200, source="KBS"),
    ]])

    prices = await RSRatingService()._get_latest_price_map(session, ["FPT", "VNM", "VCB", "VNINDEX"])

    assert session.statements[0].column_descriptions[0]["expr"] is StockPrice
    assert prices == {"FPT": 500, "VNM": 0.5, "VNINDEX": 1200}


@pytest.mark.asyncio
async def test_rs_snapshot_uses_normalized_returns_and_skips_unknown_history(monkeypatch):
    benchmark = [SimpleNamespace(time=date(2026, 1, 1) + timedelta(days=day), close=1200 + day)
                 for day in range(90)]
    fpt = [_price(close=0.5 if day < 45 else 500,
                  source="KBS" if day < 45 else "vnstock_vnd:KBS", day=day)
           for day in range(90)]
    session = _Session([benchmark, fpt, [], [_price("VNM", source="vnstock")]])
    monkeypatch.setattr(rs_snapshot_service, "async_session_maker", lambda: session)
    computed = []

    def compute_pair(symbol_returns, bench_returns):
        computed.append((symbol_returns, bench_returns))
        return 100.0, 100.0

    monkeypatch.setattr(rs_snapshot_service, "_compute_rs_pair", compute_pair)

    count = await rs_snapshot_service.take_rs_snapshot(symbols=["FPT", "VNM"])

    assert count == 1
    assert len(computed) == 1
    assert (computed[0][0] == 0).all()
    assert computed[0][1].iloc[0] == pytest.approx(1 / 1200)
    assert session.statements[1].column_descriptions[0]["expr"] is StockPrice
    assert session.committed


@pytest.mark.asyncio
@pytest.mark.parametrize("metrics,expected,unit", [
    ({"price_unit": "thousand_vnd"}, 500, "VND"),
    ({"price_unit": "VND"}, 0.5, "VND"),
    ({}, 0.5, "unknown"),
])
async def test_rs_snapshot_rankings_disclose_units_through_response_schema(
    monkeypatch, metrics, expected, unit,
):
    from vnibb.api.v1.rs_rating import RSStockItem
    from vnibb.services import rs_rating_service

    snapshot = SimpleNamespace(
        symbol="FPT", company_name="FPT", rs_rating=90, rs_rank=1,
        price=0.5, industry="Technology", extended_metrics=metrics,
    )
    session = _Session([[date(2026, 1, 1)], [snapshot]])
    monkeypatch.setattr(rs_rating_service, "get_db_context", lambda: session)

    leaders = await RSRatingService().get_rs_leaders()
    item = RSStockItem.model_validate(leaders[0]).model_dump()

    assert item["price"] == expected
    assert item["price_unit"] == unit


def test_chart_cache_does_not_share_provider_unit_provenance():
    assert chart_data_service._cache_key("FPT", "1Y", "KBS") != (
        chart_data_service._cache_key("FPT", "1Y", "MSN")
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("unit,expected", [(None, []), ("VND", [0.5])])
async def test_sponsor_chart_requires_explicit_equity_unit(monkeypatch, unit, expected):
    from vnibb.providers.vnstock import runtime

    frame = pd.DataFrame([{
        "time": date(2026, 1, 1), "open": 0.5, "high": 0.5,
        "low": 0.5, "close": 0.5, "volume": 100,
    }])
    if unit:
        frame.attrs["price_unit"] = unit

    class Quote:
        __module__ = "vnstock_data.explorer.kbs.quote"

        def history(self, **kwargs):
            return frame

    monkeypatch.setattr(runtime, "get_vnstock_class", lambda: lambda: SimpleNamespace(
        stock=lambda **kwargs: SimpleNamespace(quote=Quote())
    ))
    monkeypatch.setattr(chart_data_service, "_cache", {})

    async def no_db_history(**kwargs):
        return []

    monkeypatch.setattr(chart_data_service, "_fetch_chart_data_from_db", no_db_history)

    result = await chart_data_service.fetch_chart_data("FPT", source="KBS")

    assert [bar["close"] for bar in result] == expected
    if result:
        assert result[0]["price_unit"] == "VND"
