from __future__ import annotations

from datetime import date, datetime
from types import SimpleNamespace

import pytest

from vnibb.api.v1.screener import (
    _apply_discovery_filters,
    _build_screener_meta,
    _enrich_discovery_fields,
    _enrich_screener_metrics,
    _resolve_index_universe,
    _validated_target_reference,
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
