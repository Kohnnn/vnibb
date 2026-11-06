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
    assert "previous_close" not in hnx
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


def _index_db(rows):
    """Minimal AsyncSession stand-in for the retained-index reader."""

    class FakeResult:
        def all(self):
            return rows

    class FakeDB:
        async def execute(self, *args, **kwargs):
            return FakeResult()

    return FakeDB()


def _stored(code, when, close, change=None, change_pct=None):
    return SimpleNamespace(
        index_code=code, time=when, open=close, high=close, low=close,
        close=close, volume=1, change=change, change_pct=change_pct,
    )


@pytest.mark.asyncio
async def test_index_gap_with_matching_arithmetic_still_withholds_the_base():
    """#205: matching arithmetic is not proof of the preceding session.

    2026-10-28 (259.86) to 2026-10-30 is two sessions apart because 10-29 was
    never retained. Submitted with a change that happens to agree, it would
    otherwise publish a two-session close as one session's base.
    """
    rows = await market._load_latest_market_indices_from_db(
        _index_db(
            [
                _stored("HNX", date(2026, 10, 30), 252.74, change=-7.12),
                _stored("HNX", date(2026, 10, 28), 259.86, change=0.36),
            ]
        )
    )
    hnx = next(row for row in rows if row["index_name"] == "HNX")

    assert "previous_close" not in hnx
    assert hnx["previous_close_status"] == "previous_session_not_retained"
    assert hnx["change"] == pytest.approx(-7.12)


@pytest.mark.asyncio
async def test_index_adjacent_base_derives_a_missing_change():
    """A proven adjacent base is allowed to derive the change it implies."""
    rows = await market._load_latest_market_indices_from_db(
        _index_db(
            [
                _stored("VNINDEX", date(2026, 10, 30), 1250.0),
                _stored("VNINDEX", date(2026, 10, 29), 1240.0),
            ]
        )
    )
    vnindex = next(row for row in rows if row["index_name"] == "VNINDEX")

    assert vnindex["previous_close"] == pytest.approx(1240.0)
    assert vnindex["change"] == pytest.approx(10.0)
    assert "previous_close_status" not in vnindex


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("previous_time", "latest_time"),
    [
        # Friday -> Monday and a published holiday span are real adjacency.
        (date(2026, 10, 30), date(2026, 11, 2)),
        (date(2026, 8, 28), date(2026, 9, 3)),
        # ... and the same values as source timestamps.
        ("2026-08-28", "2026-09-03"),
    ],
)
async def test_index_accepts_a_real_session_boundary(previous_time, latest_time):
    rows = await market._load_latest_market_indices_from_db(
        _index_db(
            [
                _stored("VNINDEX", latest_time, 1250.0, change=10.0),
                _stored("VNINDEX", previous_time, 1240.0),
            ]
        )
    )
    vnindex = next(row for row in rows if row["index_name"] == "VNINDEX")

    assert vnindex["previous_close"] == pytest.approx(1240.0)
    assert "previous_close_status" not in vnindex


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("previous_time", "latest_time"),
    [
        # A weekend day or a closure beside the other date is not a session.
        (date(2026, 11, 1), date(2026, 11, 2)),
        (date(2026, 10, 30), date(2026, 10, 31)),
        (date(2026, 8, 31), date(2026, 9, 3)),
        # A skipped real session is a gap.
        (date(2026, 10, 28), date(2026, 10, 30)),
    ],
)
async def test_index_rejects_an_unproven_session_boundary(previous_time, latest_time):
    rows = await market._load_latest_market_indices_from_db(
        _index_db(
            [
                _stored("VNINDEX", latest_time, 1250.0, change=10.0),
                _stored("VNINDEX", previous_time, 1240.0),
            ]
        )
    )
    vnindex = next(row for row in rows if row["index_name"] == "VNINDEX")

    assert "previous_close" not in vnindex
    assert vnindex["previous_close_status"] == "previous_session_not_retained"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("previous_time", "latest_time"),
    [
        (None, date(2026, 10, 30)),
        (date(2026, 10, 29), None),
        ("", date(2026, 10, 30)),
        ("2026-13-40", date(2026, 10, 30)),
        # A valid date followed by junk is not a session date either: the
        # whole timestamp must parse, so a truncated slice cannot prove a base.
        ("2026-10-29garbage", date(2026, 10, 30)),
    ],
)
async def test_index_missing_or_invalid_dates_cannot_prove_a_base(previous_time, latest_time):
    """No retained timestamp means no adjacency proof, and no borrowing."""
    rows = await market._load_latest_market_indices_from_db(
        _index_db(
            [
                _stored("VNINDEX", latest_time, 1250.0, change=10.0),
                _stored("VNINDEX", previous_time, 1240.0),
            ]
        )
    )
    vnindex = next(row for row in rows if row["index_name"] == "VNINDEX")

    assert "previous_close" not in vnindex
    assert vnindex["previous_close_status"] == "previous_session_unconfirmed"
    # The retained change still anchors the percentage; it is never reloaded
    # from a base that was withheld.
    assert vnindex["change_pct"] == pytest.approx(10.0 / 1240.0 * 100, rel=1e-6)


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
    """An agreeing source pair keeps its base and derives the percentage from it.

    Both rows name the same observed session and agree on the level, so the
    DB base is this session's base and may anchor the percentage.
    """
    db_rows = [
        {
            "index_name": "VNINDEX",
            "current_value": 1250.0,
            "change": 10.0,
            "change_pct": 0.8064516129032258,
            "previous_close": 1240.0,
            "time": "2026-10-30",
        }
    ]
    provider_rows = [
        {
            "index_name": "VNINDEX",
            "current_value": 1250.0,
            "change": 10.0,
            "time": "2026-10-30T08:15:00",
        }
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


def test_provider_uses_an_asserted_base_and_never_an_open_fallback():
    """#205: the transform derives only from a base the provider asserted.

    An explicit `prev_close` is the provider's own claim about the session, so
    the change may follow from it. Without one, the transform must not fall back
    to `open`, which is this session's open rather than the previous close.
    """
    from vnibb.providers.vnstock.market_overview import (
        MarketOverviewQueryParams,
        VnstockMarketOverviewFetcher,
    )

    asserted = [
        {
            "index_name": "HNX",
            "current_value": 252.74,
            "time": "2026-10-30",
            "prev_close": 256.61,
        }
    ]
    (asserted_row,) = VnstockMarketOverviewFetcher.transform_data(
        MarketOverviewQueryParams(), asserted
    )
    assert asserted_row.change == pytest.approx(-3.87)
    assert asserted_row.change_pct == pytest.approx(-3.87 / 256.61 * 100, rel=1e-9)
    assert asserted_row.previous_close == pytest.approx(256.61)

    unbased = [
        {
            "index_name": "HNX",
            "current_value": 252.74,
            "open": 255.0,
            "time": "2026-10-30",
        }
    ]
    (unbased_row,) = VnstockMarketOverviewFetcher.transform_data(
        MarketOverviewQueryParams(), unbased
    )
    assert unbased_row.change is None
    assert unbased_row.change_pct is None


def test_sessions_are_adjacent_uses_the_market_calendar():
    from datetime import UTC, date, datetime

    from vnibb.services.market_session import market_sessions_are_adjacent

    # HNX is missing 2026-10-29, so these are not consecutive sessions.
    assert not market_sessions_are_adjacent(date(2026, 10, 28), date(2026, 10, 30))
    assert market_sessions_are_adjacent(date(2026, 10, 29), date(2026, 10, 30))
    # Friday to Monday is consecutive: the weekend is not a session.
    assert market_sessions_are_adjacent(date(2026, 10, 30), date(2026, 11, 2))
    # 2026-08-31, 09-01 and 09-02 are published closures, so 08-28 -> 09-03 is
    # the next session, while 08-27 -> 09-03 skips 08-28.
    assert market_sessions_are_adjacent(date(2026, 8, 28), date(2026, 9, 3))
    assert not market_sessions_are_adjacent(date(2026, 8, 27), date(2026, 9, 3))

    # Both endpoints must themselves be sessions: a weekend or a closure next
    # to the other date is a gap, not the previous session.
    assert not market_sessions_are_adjacent(date(2026, 11, 1), date(2026, 11, 2))  # Sun -> Mon
    assert not market_sessions_are_adjacent(date(2026, 10, 30), date(2026, 10, 31))  # Fri -> Sat
    assert not market_sessions_are_adjacent(date(2026, 8, 31), date(2026, 9, 3))  # closure endpoint
    assert not market_sessions_are_adjacent(date(2026, 10, 30), date(2026, 10, 30))
    assert not market_sessions_are_adjacent(date(2026, 10, 30), date(2026, 10, 29))

    # Missing or malformed dates never prove adjacency and never become today.
    for earlier, later in (
        (None, date(2026, 10, 30)),
        (date(2026, 10, 29), None),
        ("", date(2026, 10, 30)),
        ("not-a-date", date(2026, 10, 30)),
        (date(2026, 10, 29), "2026-13-45"),
    ):
        assert not market_sessions_are_adjacent(earlier, later)

    # An aware timestamp resolves in the market zone, not in UTC: 17:30Z on
    # 2026-10-29 is 2026-10-30 00:30 ICT, so it can only ever be 10-30.
    from vnibb.services.market_session import market_session_date

    late_utc = datetime(2026, 10, 29, 17, 30, tzinfo=UTC)
    assert market_session_date(late_utc) == date(2026, 10, 30)
    assert market_sessions_are_adjacent(date(2026, 10, 29), late_utc)


def test_enrichment_does_not_reuse_target_evidence_for_a_different_sum():
    """#206: a summed value must be backed by its operands, not by the total.

    A payload carrying `selling_general_admin: -100` and `selling_expenses:
    -50` produced a -150 sum that inherited the -100 field's evidence. The sum
    has no provider record of its own, so it is only admissible when the
    operands it came from are.
    """
    from vnibb.api.v1 import equity
    from vnibb.providers.vnstock.financials import FinancialStatementData

    def _row(raw: dict, metadata: dict) -> FinancialStatementData:
        return FinancialStatementData(
            symbol="ABC",
            period="2024",
            statement_type="income",
            source="fixture",
            currency="VND",
            value_unit="VND",
            consolidation_basis="consolidated",
            flow_basis="annual",
            raw_data={"_financial_lineage": {
                "value_unit": "VND",
                "canonical_data": {"unit_metadata": metadata, **raw},
            }},
        )

    # Both operands carry evidence: the sum is backed.
    (backed,) = equity._enrich_financial_statement_rows([
        _row(
            {"selling_expenses": -50.0, "general_and_administrative_expenses": -100.0},
            {
                "selling_expenses": {"source_unit": "VND", "value_unit": "VND"},
                "general_and_administrative_expenses": {"source_unit": "VND", "value_unit": "VND"},
            },
        )
    ])
    assert backed.selling_general_admin == -150.0
    assert equity.admit_statement_rows([backed], "year")[0].selling_general_admin == -150.0

    # Only the total carries evidence, and the total is a different number.
    (unbacked,) = equity._enrich_financial_statement_rows([
        _row(
            {"selling_expenses": -50.0, "selling_general_admin": -100.0},
            {"selling_general_admin": {"source_unit": "VND", "value_unit": "VND"}},
        )
    ])
    assert unbacked.selling_general_admin == -100.0
    admitted = equity.admit_statement_rows([unbacked], "year")[0]
    # The reported total is used as-is; it is never replaced by the sum.
    assert admitted.selling_general_admin == -100.0


def test_evidence_naming_another_currency_cannot_admit_a_vnd_value():
    """#206: a source unit naming another currency is not evidence for VND.

    `{"source_unit": "USD", "value_unit": "VND"}` asserts the figure arrived in
    dollars, so it cannot certify a VND amount without a recorded conversion.
    Scale differences (`Bn. VND`) remain admissible: the value is normalized.
    """
    from vnibb.services.financial_service import _monetary_evidence_admitted

    assert _monetary_evidence_admitted(
        {"source_unit": "Bn. VND", "value_unit": "VND"}, "VND"
    )
    assert _monetary_evidence_admitted(
        {"source_unit": "VND", "value_unit": "VND"}, "VND"
    )
    assert not _monetary_evidence_admitted(
        {"source_unit": "USD", "value_unit": "VND"}, "VND"
    )
    assert not _monetary_evidence_admitted(
        {"source_unit": "vnd", "value_unit": "VND", "unavailable_reason": "rejected"}, "VND"
    )


def test_merge_does_not_lend_a_foreign_session_date_to_a_provider_row():
    """#205: an index date is an observation, not a fillable field.

    The provider row carries no date and its level disagrees with the DB row, so
    the two describe different sessions. Copying the DB date onto the provider
    observation would claim a source date nothing established.
    """
    db_rows = [
        {
            "index_name": "HNX",
            "current_value": 259.86,
            "change": 0.36,
            "time": "2026-10-28",
        }
    ]
    provider_rows = [
        {"index_name": "HNX", "current_value": 252.74, "change": -3.87, "time": None}
    ]

    merged = market._merge_market_index_rows(db_rows, provider_rows)
    row = next(item for item in merged if item["index_name"] == "HNX")

    assert row["current_value"] == pytest.approx(252.74)
    assert row.get("time") is None


def test_merge_does_not_lend_a_date_to_an_undated_provider_row():
    """An agreeing pair with no provider date is not proof of one session.

    Equal levels alone never establish that both sources observed one session,
    and an index date is an observation rather than a fillable field, so the
    undated provider row stays undated.
    """
    db_rows = [
        {
            "index_name": "VNINDEX",
            "current_value": 1250.0,
            "change": 10.0,
            "time": "2026-10-30",
        }
    ]
    provider_rows = [
        {"index_name": "VNINDEX", "current_value": 1250.0, "change": 10.0, "time": None}
    ]

    merged = market._merge_market_index_rows(db_rows, provider_rows)
    row = next(item for item in merged if item["index_name"] == "VNINDEX")

    assert row.get("time") is None


def test_merge_enriches_only_a_known_matching_session_date():
    """A known equal source date is the one control that permits enrichment.

    The provider keeps its own observation time (never a borrowed clock) while
    the DB volume and range for the same session fill the gaps.
    """
    db_rows = [
        {
            "index_name": "VNINDEX",
            "current_value": 1250.0,
            "change": 10.0,
            "volume": 900_000,
            "high": 1255.0,
            "time": "2026-10-30",
        }
    ]
    provider_rows = [
        {
            "index_name": "VNINDEX",
            "current_value": 1250.0,
            "change": 10.0,
            "time": "2026-10-30T08:15:00",
        }
    ]

    merged = market._merge_market_index_rows(db_rows, provider_rows)
    row = next(item for item in merged if item["index_name"] == "VNINDEX")

    assert row["time"] == "2026-10-30T08:15:00"
    assert row["volume"] == 900_000
    assert row["high"] == pytest.approx(1255.0)


def test_balance_sheet_readmission_keeps_a_refilled_metric_withheld():
    """#206: a value that arrives after admission is not an admitted value.

    A retained legacy row has no unit lineage, so admission withholds its
    numbers. `_enrich_financial_statement_rows` then refills `cash_and_equivalents`
    from `raw_data`, which has no unit evidence of its own. The dedicated
    balance-sheet endpoint returned that refilled number without a second gate.
    """
    from vnibb.api.v1 import equity
    from vnibb.providers.vnstock.financials import FinancialStatementData

    legacy = FinancialStatementData(
        symbol="VNM",
        period="2023",
        statement_type="balance_sheet",
        raw_data={"cash_and_equivalents": 12_345.0},
        unit_metadata={"basis": {"unavailable_reason": "legacy_unit_basis_unconfirmed"}},
    )
    admitted = equity.admit_statement_rows([legacy], "year")[0]
    assert admitted.cash_and_equivalents is None

    refilled = equity._enrich_financial_statement_rows([admitted])[0]
    assert refilled.cash_and_equivalents == pytest.approx(12_345.0)

    final = equity.admit_statement_rows([refilled], "year")[0]
    assert final.cash_and_equivalents is None
    assert "cash_and_equivalents" in final.unit_metadata


def test_merge_does_not_treat_an_equal_level_on_another_day_as_the_same_session():
    """#205: an unchanged level is not proof of one session.

    Both rows report 1250.0, but they observed different dates. Borrowing the
    DB percentage (or date) would publish a figure from another session.
    """
    db_rows = [
        {
            "index_name": "VNINDEX",
            "current_value": 1250.0,
            "change": 10.0,
            "volume": 900_000,
            "high": 1255.0,
            "time": "2026-10-29",
        }
    ]
    provider_rows = [
        {"index_name": "VNINDEX", "current_value": 1250.0, "change": 10.0, "time": "2026-10-30"}
    ]

    merged = market._merge_market_index_rows(db_rows, provider_rows)
    row = next(item for item in merged if item["index_name"] == "VNINDEX")

    # The level did not move, but 2026-10-29's volume and range describe that
    # session, not the provider's 2026-10-30 observation.
    assert "volume" not in row
    assert "high" not in row
    assert row["time"] == "2026-10-30"
