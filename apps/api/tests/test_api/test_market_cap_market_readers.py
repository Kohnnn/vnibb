from datetime import date
from types import SimpleNamespace

import pytest
from vnibb.api.v1 import market
from vnibb.core.market_cap import reconcile_market_caps, resolve_market_cap
from vnibb.models.screener import ScreenerSnapshot


def certified(value):
    return {
        "market_cap": value, "market_cap_source": "issuer:cap", "market_cap_unit": "VND",
        "market_cap_currency": "VND", "market_cap_as_of": "2026-10-23",
        "outstanding_shares": 100, "shares_unit": "shares", "share_basis": "outstanding",
        "shares_as_of": "2026-10-23", "shares_source": "issuer:shares",
    }


def conflict():
    return reconcile_market_caps(
        resolve_market_cap(certified(100), source="first"),
        resolve_market_cap(certified(200), source="second"),
    )


def rows():
    common = {"exchange": "HOSE", "industry": "test", "price": 100, "price_unit": "VND"}
    return [
        {**common, "symbol": "AAA", **certified(100), "volume": 10, "value_traded": 1000, "change_pct": 1},
        {**common, "symbol": "BBB", "market_cap": 999999999999, "volume": 30, "value_traded": 3000, "change_pct": 9},
        {**common, "symbol": "CCC", "market_cap_provenance": conflict(), "volume": 20, "value_traded": 2000, "change_pct": 4},
    ]


@pytest.fixture
def market_rows(monkeypatch):
    async def cache(*args, **kwargs):
        return SimpleNamespace(data=rows(), hit=True, is_fresh=True)

    async def empty_map(*args, **kwargs):
        return {}

    async def no_rows(*args, **kwargs):
        return []

    async def ratios(symbols):
        return {symbol: {"pb_ratio": 1, "pe_ratio": 10} for symbol in symbols}

    monkeypatch.setattr(market.CacheManager, "get_screener_data", cache)
    monkeypatch.setattr(market, "_load_latest_screener_rows_from_db", no_rows)
    monkeypatch.setattr(market, "_load_stock_metadata", empty_map)
    monkeypatch.setattr(market, "_load_change_pct_map", empty_map)
    monkeypatch.setattr(market, "_load_latest_ratio_metrics", ratios)
    monkeypatch.setattr(market, "_load_latest_income_revenue", empty_map)
    monkeypatch.setattr(market, "_load_latest_market_indices_from_db", no_rows)
    monkeypatch.setattr(market, "_load_latest_price_time", lambda *args: _async(None))
    monkeypatch.setattr(market, "_resolve_sector_name", lambda *args: "Test")


async def _async(value):
    return value


@pytest.mark.asyncio
@pytest.mark.parametrize("metric,expected_sizes", [
    ("market_cap", {"AAA": 100}),
    ("volume", {"AAA": 10, "BBB": 30, "CCC": 20}),
    ("value_traded", {"AAA": 1000, "BBB": 3000, "CCC": 2000}),
])
async def test_heatmap_only_uses_admitted_cap_and_exposes_selected_size(client, market_rows, metric, expected_sizes):
    response = await client.get(f"/api/v1/market/heatmap?exchange=ALL&size_metric={metric}")
    assert response.status_code == 200
    assert response.json()["partial"] is (metric == "market_cap")
    sector = response.json()["sectors"][0]
    stocks = {stock["symbol"]: stock for stock in sector["stocks"]}
    assert {symbol: stock["size_value"] for symbol, stock in stocks.items()} == expected_sizes
    assert sector["total_market_cap"] == 100
    assert sector["cap_count"] == 1
    assert sector["total_size_value"] == sum(expected_sizes.values())
    assert stocks["AAA"]["market_cap"] == 100
    assert stocks["AAA"]["market_cap_provenance"]["status"] == "available"
    if metric != "market_cap":
        assert stocks["BBB"]["market_cap"] is None
        assert stocks["BBB"]["market_cap_provenance"]["status"] == "unavailable"
        assert stocks["CCC"]["market_cap"] is None
        assert stocks["CCC"]["market_cap_provenance"]["status"] == "conflict"
        assert sector["avg_change_pct"] == pytest.approx((1 * 10 + 9 * 30 + 4 * 20) / 60)


@pytest.mark.asyncio
async def test_snapshot_fallback_sorts_admitted_cap_before_limit(monkeypatch):
    snapshots = [
        ScreenerSnapshot(symbol="BAD", snapshot_date=date(2026, 10, 23), market_cap=10**15),
        ScreenerSnapshot(symbol="GOOD", snapshot_date=date(2026, 10, 23), market_cap=100,
                         extended_metrics={key: value for key, value in certified(100).items() if key != "market_cap"}),
    ]

    async def cache(*args, **kwargs):
        return SimpleNamespace(data=snapshots, hit=True)

    monkeypatch.setattr(market.CacheManager, "get_screener_data", cache)
    selected = await market._load_latest_screener_rows_from_db(limit=1)
    assert [row["symbol"] for row in selected] == ["GOOD"]
    assert selected[0]["market_cap"] == 100
    assert selected[0]["market_cap_provenance"]["status"] == "available"
    assert selected[0]["extended_metrics"] == snapshots[1].extended_metrics


@pytest.mark.asyncio
async def test_bubble_and_board_exclude_raw_and_conflicting_cap_weights(client, market_rows):
    bubble = await client.get("/api/v1/market/industry-bubble?symbol=AAA&size_metric=market_cap")
    assert bubble.status_code == 200
    assert [point["symbol"] for point in bubble.json()["data"]] == ["AAA"]
    assert bubble.json()["data"][0]["market_cap_provenance"]["status"] == "available"

    volume_bubble = await client.get("/api/v1/market/industry-bubble?symbol=AAA&size_metric=volume")
    assert volume_bubble.status_code == 200
    points = {point["symbol"]: point for point in volume_bubble.json()["data"]}
    assert points["BBB"]["market_cap"] is None
    assert points["BBB"]["market_cap_provenance"]["status"] == "unavailable"
    assert points["CCC"]["market_cap_provenance"]["status"] == "conflict"

    board = await client.get("/api/v1/market/sector-board?sort_by=market_cap")
    assert board.status_code == 200
    sector = board.json()["sectors"][0]
    assert [stock["symbol"] for stock in sector["stocks"]] == ["AAA", "BBB", "CCC"]
    assert sector["change_pct"] == 1
    assert sector["constituent_count"] == 3
    assert sector["stocks"][1]["market_cap_provenance"]["status"] == "unavailable"
    assert sector["stocks"][2]["market_cap_provenance"]["status"] == "conflict"


@pytest.mark.asyncio
async def test_board_equal_weight_fallback_uses_returns_without_cap(client, market_rows, monkeypatch):
    async def cache(*args, **kwargs):
        return SimpleNamespace(data=rows()[1:], hit=True, is_fresh=True)

    monkeypatch.setattr(market.CacheManager, "get_screener_data", cache)
    response = await client.get("/api/v1/market/sector-board?sort_by=volume")
    assert response.status_code == 200
    sector = response.json()["sectors"][0]
    assert sector["change_pct"] == 6.5
    assert sector["constituent_count"] == 2


@pytest.mark.asyncio
async def test_volume_heatmap_null_cap_total_when_no_cap_admitted(client, market_rows, monkeypatch):
    async def cache(*args, **kwargs):
        return SimpleNamespace(data=rows()[1:], hit=True, is_fresh=True)

    monkeypatch.setattr(market.CacheManager, "get_screener_data", cache)
    response = await client.get("/api/v1/market/heatmap?exchange=ALL&size_metric=volume")
    assert response.status_code == 200
    sector = response.json()["sectors"][0]
    assert sector["total_market_cap"] is None
    assert sector["cap_count"] == 0
    assert sector["total_size_value"] == 50


@pytest.mark.asyncio
async def test_hnx30_selection_does_not_rank_unqualified_caps(client, market_rows, monkeypatch):
    data = [{**row, "exchange": "HNX"} for row in rows()]

    async def cache(*args, **kwargs):
        return SimpleNamespace(data=data, hit=True, is_fresh=True)

    monkeypatch.setattr(market.CacheManager, "get_screener_data", cache)
    response = await client.get("/api/v1/market/heatmap?exchange=HNX&group_by=hnx30&size_metric=volume")
    assert response.status_code == 200
    assert [stock["symbol"] for stock in response.json()["sectors"][0]["stocks"]] == ["AAA"]
    assert response.json()["partial"] is True


@pytest.mark.asyncio
async def test_board_unknown_returns_are_not_zero(client, market_rows, monkeypatch):
    data = [{**row, "change_pct": None} for row in rows()]

    async def cache(*args, **kwargs):
        return SimpleNamespace(data=data, hit=True, is_fresh=True)

    monkeypatch.setattr(market.CacheManager, "get_screener_data", cache)
    response = await client.get("/api/v1/market/sector-board?sort_by=volume")
    assert response.status_code == 200
    sector = response.json()["sectors"][0]
    assert sector["change_pct"] is None
    assert sector["constituent_count"] == 0


@pytest.mark.asyncio
async def test_index_withholds_previous_close_across_a_session_gap():
    """#205: a missing session must not rewrite the published base.

    HNX has no 2026-10-29 row, so the second newest stored row is 2026-10-28
    (259.86) while the 2026-10-30 row's own change is -3.87. Publishing 259.86
    as the previous close made level, base and change incompatible. The close
    for 2026-10-29 was never observed, so it is withheld rather than derived.
    """

    class FakeResult:
        def all(self):
            return [
                SimpleNamespace(
                    index_code="HNX", time=date(2026, 10, 30), open=252.74,
                    high=256.88, low=252.74, close=252.74, volume=1,
                    change=-3.87, change_pct=-1.50812517049219,
                ),
                SimpleNamespace(
                    index_code="HNX", time=date(2026, 10, 28), open=259.86,
                    high=261.49, low=255.67, close=259.86, volume=1,
                    change=0.36, change_pct=0.138728323699427,
                ),
            ]

    class FakeDB:
        async def execute(self, *args, **kwargs):
            return FakeResult()

    rows = await market._load_latest_market_indices_from_db(FakeDB())
    hnx = next(row for row in rows if row["index_name"] == "HNX")

    assert hnx["current_value"] == pytest.approx(252.74)
    assert hnx["change"] == pytest.approx(-3.87)
    assert hnx["previous_close"] is None
    assert hnx["previous_close_status"] == "previous_session_not_retained"
    # The stored percentage is quoted against the session's own base
    # (252.74 - -3.87 = 256.61), not against the level. Checking it against the
    # level discarded a figure the source measured consistently.
    assert hnx["change_pct"] == pytest.approx(-1.50812517049219)


@pytest.mark.asyncio
async def test_index_keeps_an_observed_previous_close_that_reconciles():
    """A retained adjacent session stays published."""

    class FakeResult:
        def all(self):
            return [
                SimpleNamespace(
                    index_code="VNINDEX", time=date(2026, 10, 30), open=1250.0,
                    high=1260.0, low=1240.0, close=1250.0, volume=1,
                    change=10.0, change_pct=0.8064516129032258,
                ),
                SimpleNamespace(
                    index_code="VNINDEX", time=date(2026, 10, 29), open=1240.0,
                    high=1245.0, low=1235.0, close=1240.0, volume=1,
                    change=5.0, change_pct=0.4048582995951417,
                ),
            ]

    class FakeDB:
        async def execute(self, *args, **kwargs):
            return FakeResult()

    rows = await market._load_latest_market_indices_from_db(FakeDB())
    vnindex = next(row for row in rows if row["index_name"] == "VNINDEX")

    assert vnindex["previous_close"] == pytest.approx(1240.0)
    assert vnindex["change"] == pytest.approx(10.0)
    assert vnindex["change_pct"] == pytest.approx(10.0 / 1240.0 * 100, rel=1e-9)
    assert "previous_close_status" not in vnindex


def test_merge_does_not_borrow_a_change_pct_from_another_session():
    """#205: merging may not mix a base from one session with a level from another.

    The DB row and provider row disagree on the level, so they describe
    different sessions. Adopting the DB percentage beside the provider change
    published a figure neither source measured.
    """
    db_rows = [
        {
            "index_name": "VNINDEX",
            "current_value": 1250.0,
            "change": 10.0,
            "change_pct": None,
            "previous_close": 1240.0,
        }
    ]
    provider_rows = [
        {"index_name": "VNINDEX", "current_value": 1275.5, "change": 25.5}
    ]

    merged = market._merge_market_index_rows(db_rows, provider_rows)
    row = next(item for item in merged if item["index_name"] == "VNINDEX")

    assert row["current_value"] == pytest.approx(1275.5)
    assert row["change"] == pytest.approx(25.5)
    # The DB base (1240) belongs to a different session and is dropped. The
    # percentage then follows from the provider's own level and change
    # (1275.5 - 25.5 = 1250), never from the foreign base.
    assert "previous_close" not in row
    assert row["change_pct"] == pytest.approx(25.5 / 1250 * 100, rel=1e-9)


def test_merge_publishes_a_base_only_when_it_reconciles():
    """An agreeing source pair keeps its base and derives the percentage from it."""
    db_rows = [
        {
            "index_name": "VNINDEX",
            "current_value": 1250.0,
            "change": 10.0,
            "change_pct": 0.8064516129032258,
            "previous_close": 1240.0,
        }
    ]
    provider_rows = [
        {"index_name": "VNINDEX", "current_value": 1250.0, "change": 10.0}
    ]

    merged = market._merge_market_index_rows(db_rows, provider_rows)
    row = next(item for item in merged if item["index_name"] == "VNINDEX")

    assert row["previous_close"] == pytest.approx(1240.0)
    assert row["change_pct"] == pytest.approx(10.0 / 1240.0 * 100, rel=1e-9)


def test_admission_withholds_sga_after_enrichment_fills_it():
    """#206: income-statement output must be the admitted rows.

    FPT FY2025 returned `selling_general_admin=-14899986038258.0` with
    `currency=null` and `value_unit=null`, while revenue and net income were
    correctly withheld. SG&A was filled by `_enrich_financial_statement_rows`
    after admission, and the endpoint copied back only EPS.
    """
    from vnibb.api.v1 import equity
    from vnibb.providers.vnstock.financials import FinancialStatementData

    enriched = FinancialStatementData(
        symbol="FPT",
        period="2025",
        statement_type="income_statement",
        raw_data={"selling_expenses": -100.0},
        unit_metadata={"basis": {"unavailable_reason": "legacy_unit_basis_unconfirmed"}},
    )
    enriched = equity._enrich_financial_statement_rows([enriched])[0]
    assert enriched.selling_general_admin == -100.0

    row = equity.admit_statement_rows([enriched], "year")[0]

    assert row.selling_general_admin is None
    assert row.unit_metadata["selling_general_admin"]["unavailable_reason"] == (
        "unverified_statement_currency_or_unit"
    )


def test_admission_keeps_metrics_with_real_unit_evidence():
    """A metric with admitted unit evidence survives the same gate."""
    from vnibb.api.v1 import equity
    from vnibb.providers.vnstock.financials import FinancialStatementData

    admitted = FinancialStatementData(
        symbol="VNM",
        period="2024",
        statement_type="income_statement",
        currency="VND",
        value_unit="VND",
        source="vnstock",
        consolidation_basis="consolidated",
        flow_basis="annual",
        revenue=1000.0,
        selling_general_admin=-100.0,
        unit_metadata={
            "revenue": {"source_unit": "VND", "value_unit": "VND"},
            "selling_general_admin": {"source_unit": "VND", "value_unit": "VND"},
        },
    )

    row = equity.admit_statement_rows([admitted], "year")[0]

    assert row.revenue == 1000.0
    assert row.selling_general_admin == -100.0
