from __future__ import annotations

from datetime import date, datetime, timedelta
from types import SimpleNamespace

import pytest

from vnibb.api.v1.screener import (
    _apply_discovery_filters,
    _build_screener_meta,
    _enrich_discovery_fields,
    _enrich_screener_metrics,
    _resolve_index_universe,
    _validated_target_reference,
    _to_screener_data_row,
    fill_market_cap,
)
from vnibb.providers.vnstock.equity_screener import ScreenerData


def test_screener_meta_reports_source_and_visible_field_coverage():
    rows = [
        ScreenerData(symbol="VNM", price=10.0, pe=12.0),
        ScreenerData(symbol="FPT", price=20.0, pe=None),
    ]

    meta = _build_screener_meta(rows, cached=True, stale=True, fallback=True)

    assert meta.source == "fallback_cache"
    assert meta.cached is True
    assert meta.stale is True
    assert meta.fallback is True
    assert meta.visible_field_coverage == {
        "symbol": 2,
        "organ_name": 0,
        "exchange": 0,
        "industry_name": 0,
        "price": 2,
        "change_1d": 0,
        "volume": 0,
        "market_cap": 0,
        "pe": 1,
        "pb": 0,
        "roe": 0,
        "dividend_yield": 0,
    }
    assert meta.visible_field_values == 5
    assert meta.visible_field_possible_values == 24


class _FakeResult:
    def __init__(self, rows: list[object]):
        self._rows = rows

    def scalars(self):
        return self

    def all(self):
        return self._rows


class _NoQueryDB:
    def __init__(self):
        self.calls = 0

    async def execute(self, *_args, **_kwargs):
        self.calls += 1
        raise AssertionError("DB should not be queried for this scenario")


class _RecordingDB:
    def __init__(self):
        self.queries: list[str] = []

    async def execute(self, statement):
        query = str(statement).lower()
        self.queries.append(query)

        if "stock_prices" in query:
            raise AssertionError(
                "Price query should not run when only fundamental enrichment is needed"
            )

        if "financial_ratios" in query:
            ratio = SimpleNamespace(
                symbol="VNM",
                raw_data={},
                roic=12.5,
                fiscal_year=2024,
                fiscal_quarter=4,
                updated_at=None,
                ev_ebitda=None,
                operating_margin=None,
                revenue_growth=None,
                earnings_growth=None,
                debt_to_assets=None,
                dps=None,
            )
            return _FakeResult([ratio])

        return _FakeResult([])


@pytest.mark.asyncio
async def test_enrich_skips_database_when_only_updated_at_missing():
    row = ScreenerData(
        symbol="VNM",
        revenue_growth=5.0,
        earnings_growth=6.0,
        operating_margin=10.0,
        ev_ebitda=8.0,
        roic=12.0,
        dividend_yield=1.5,
        change_1d=0.5,
        perf_1w=1.2,
        perf_1m=3.4,
        perf_ytd=9.1,
        debt_to_asset=0.3,
        equity_on_total_asset=0.5,
        market_cap=1_000_000_000,
        updated_at=None,
    )
    db = _NoQueryDB()

    result = await _enrich_screener_metrics([row], db)  # type: ignore[arg-type]

    assert db.calls == 0
    assert len(result) == 1
    assert result[0].symbol == "VNM"
    assert result[0].updated_at is None


@pytest.mark.asyncio
async def test_enrich_skips_price_query_for_fundamental_only_gap():
    row = ScreenerData(
        symbol="VNM",
        revenue_growth=5.0,
        earnings_growth=6.0,
        operating_margin=10.0,
        ev_ebitda=8.0,
        roic=None,
        dividend_yield=1.5,
        change_1d=0.5,
        perf_1w=1.2,
        perf_1m=3.4,
        perf_ytd=9.1,
        debt_to_asset=0.3,
        equity_on_total_asset=0.5,
        market_cap=1_000_000_000,
    )
    db = _RecordingDB()

    result = await _enrich_screener_metrics([row], db)  # type: ignore[arg-type]

    assert len(result) == 1
    assert result[0].roic == 12.5
    assert any("financial_ratios" in query for query in db.queries)
    assert all("stock_prices" not in query for query in db.queries)


class _IndexService:
    def __init__(self, record=None, *, enabled=True):
        self.enabled = enabled
        self.record = record

    async def get_current_index_constituents(self, _group):
        return self.record


@pytest.mark.asyncio
async def test_current_index_universe_uses_only_fresh_provider_members(monkeypatch):
    service = _IndexService({
        "source": "vietcap",
        "members": ["VNM", "FPT"],
        "member_count": 2,
        "synced_at": datetime(2026, 7, 16),
        "stale": False,
    })
    monkeypatch.setattr("vnibb.api.v1.screener.get_mongo_market_data_service", lambda: service)

    members, meta = await _resolve_index_universe("VN30")

    assert members == {"VNM", "FPT"}
    assert meta["membership_current"] is True
    assert meta["membership_source"] == "vietcap"
    assert meta["membership_available"] is True


@pytest.mark.asyncio
async def test_current_index_universe_returns_no_broader_fallback_when_unavailable(monkeypatch):
    monkeypatch.setattr(
        "vnibb.api.v1.screener.get_mongo_market_data_service",
        lambda: _IndexService(None),
    )

    members, meta = await _resolve_index_universe("VN30")

    assert members == set()
    assert meta["membership_current"] is True
    assert meta["membership_available"] is False


def test_target_reference_requires_provider_source_and_vnd_unit():
    valid = {
        "targetPrice": 50_000,
        "targetPriceUnit": "VND",
        "targetSource": "Vietcap",
        "recommendation": "BUY",
    }
    target, upside, source, recommendation = _validated_target_reference(valid, 40_000)

    assert target == 50_000
    assert upside == 25
    assert source == "Vietcap"
    assert recommendation == "BUY"
    assert _validated_target_reference({"targetPrice": 50_000, "targetSource": "Vietcap"}, 40_000)[:3] == (None, None, None)


def test_discovery_filters_exclude_unknown_listing_and_target_values():
    rows = [
        ScreenerData(symbol="VNM", listing_age_days=500, target_upside_pct=20),
        ScreenerData(symbol="FPT", listing_age_days=None, target_upside_pct=None),
    ]

    assert [row.symbol for row in _apply_discovery_filters(rows, min_listing_age_days=365, target_upside_min=None)] == ["VNM"]
    assert [row.symbol for row in _apply_discovery_filters(rows, min_listing_age_days=None, target_upside_min=10)] == ["VNM"]


class _DiscoveryDB:
    async def execute(self, statement):
        query = str(statement).lower()
        if "companies" in query:
            return _FakeResult([("VNM", date(2024, 1, 1), {}, datetime(2026, 7, 15))])
        if "stocks" in query:
            return _FakeResult([])
        raise AssertionError(f"Unexpected query: {query}")


@pytest.mark.asyncio
async def test_listing_age_uses_requested_as_of_date():
    rows = await _enrich_discovery_fields(
        [ScreenerData(symbol="VNM", price=50_000)],
        _DiscoveryDB(),  # type: ignore[arg-type]
        as_of_date=date(2025, 1, 1),
    )

    assert rows[0].listing_date == date(2024, 1, 1)
    assert rows[0].listing_age_days == 366


@pytest.mark.parametrize(
    ("metrics", "price", "expected", "unit"),
    [
        ({"price_unit": "THOUSAND_VND"}, 73, 73_000, "VND"),
        ({"price_unit": "VND"}, 80, 80, "VND"),
        ({}, 73_000, None, "unknown"),
    ],
)
def test_stored_screener_prices_require_provenance(metrics, price, expected, unit):
    row = _to_screener_data_row(SimpleNamespace(symbol="FPT", price=price, extended_metrics=metrics))

    assert row.price == expected
    assert row.price_unit == unit


def test_screener_market_cap_preserves_low_vnd_and_rejects_unknown_prices():
    rows = fill_market_cap([
        ScreenerData(symbol="LOW", price=80, price_unit="VND", shares_outstanding=1_000_000),
        ScreenerData(symbol="BAD", price=80_000, price_unit="unknown", shares_outstanding=1_000_000),
    ])

    assert rows[0].market_cap == 80_000_000
    assert rows[1].market_cap is None


class _PriceEnrichmentDB:
    def __init__(self, prices, *, dps=None):
        self.prices = prices
        self.dps = dps

    async def execute(self, statement):
        query = str(statement).lower()
        if "stock_prices" in query:
            return _FakeResult(self.prices)
        if "financial_ratios" in query and self.dps is not None:
            return _FakeResult([SimpleNamespace(
                symbol="FPT", raw_data={}, roic=None, fiscal_year=None, fiscal_quarter=None,
                updated_at=None, ev_ebitda=None, operating_margin=None, revenue_growth=None,
                earnings_growth=None, debt_to_assets=None, dps=self.dps,
            )])
        return _FakeResult([])


@pytest.mark.asyncio
async def test_screener_performance_normalizes_each_persisted_source():
    db = _PriceEnrichmentDB([
        SimpleNamespace(symbol="FPT", time=date(2025, 1, 2), close=80, source="vnstock_vnd:KBS"),
        SimpleNamespace(symbol="FPT", time=date(2025, 1, 1), close=0.1, source="KBS"),
    ])
    rows = await _enrich_screener_metrics([ScreenerData(symbol="FPT")], db)

    assert rows[0].change_1d == pytest.approx(-20)
    assert rows[0].updated_at == date(2025, 1, 2)


@pytest.mark.asyncio
@pytest.mark.parametrize("cached", [False, True])
@pytest.mark.parametrize(
    ("sessions", "unknown_index", "expected"),
    [
        (3, 1, (None, None, None, None)),
        (3, 0, (None, None, None, None)),
        (6, None, (10.0, 10.0, 10.0, 10.0)),
        (7, 6, (10.0, 10.0, None, None)),
        (23, 22, (10.0, 10.0, 10.0, None)),
        (253, None, (10.0, 10.0, 10.0, 10.0)),
    ],
)
async def test_screener_performance_preserves_original_session_windows(
    cached, sessions, unknown_index, expected
):
    prices = []
    session = date(2025, 1, 14)
    for index in range(sessions):
        while session.weekday() >= 5:
            session -= timedelta(days=1)
        prices.append(SimpleNamespace(
            symbol="FPT", time=session, close=110 if index == 0 else 100,
            source="vnstock" if index == unknown_index else "vnstock_vnd:KBS",
        ))
        session -= timedelta(days=1)

    value = 10 if unknown_index is not None else None
    metrics = {"change_1d": value, "perf_1w": value, "perf_1m": value}
    row = (
        _to_screener_data_row(SimpleNamespace(symbol="FPT", extended_metrics=metrics))
        if cached
        else ScreenerData(symbol="FPT", **metrics)
    )
    result = (await _enrich_screener_metrics([row], _PriceEnrichmentDB(prices)))[0]

    assert (result.change_1d, result.perf_1w, result.perf_1m, result.perf_ytd) == expected


@pytest.mark.asyncio
async def test_screener_performance_preserves_large_legitimate_split():
    db = _PriceEnrichmentDB([
        SimpleNamespace(symbol="FPT", time=date(2025, 1, 2), close=100, source="vnstock_vnd:KBS"),
        SimpleNamespace(symbol="FPT", time=date(2025, 1, 1), close=100_000, source="vnstock_vnd:KBS"),
    ])
    rows = await _enrich_screener_metrics([ScreenerData(symbol="FPT")], db)

    assert rows[0].change_1d == pytest.approx(-99.9)


@pytest.mark.asyncio
@pytest.mark.parametrize(("unit", "expected"), [("VND", 10), ("unknown", None)])
async def test_screener_dividend_yield_uses_only_canonical_vnd(unit, expected):
    rows = await _enrich_screener_metrics(
        [ScreenerData(symbol="FPT", price=80, price_unit=unit)],
        _PriceEnrichmentDB([], dps=8),
    )

    assert rows[0].dividend_yield == expected


def test_target_upside_preserves_low_canonical_vnd_price():
    target, upside, source, _ = _validated_target_reference(
        {"targetPrice": 100, "targetPriceUnit": "VND", "targetSource": "Vietcap"},
        80,
    )

    assert target == 100
    assert upside == 25
    assert source == "Vietcap"
