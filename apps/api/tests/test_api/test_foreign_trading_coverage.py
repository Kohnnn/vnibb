"""#249 — foreign flow windows and coverage qualification.

The provider feed is row-capped and retained history can be sparse, so a row
count must never stand in for a calendar window, and a weekend date must never
be summed as a session.
"""

from datetime import date, datetime, timedelta

import pytest

from vnibb.api.v1 import equity as equity_module
from vnibb.core.config import settings
from vnibb.models.trading import ForeignTrading
from vnibb.providers.vnstock.foreign_trading import ForeignTradingData
from vnibb.services import foreign_flow_coverage as coverage_module
from vnibb.services import market_session
from vnibb.services.foreign_flow_coverage import (
    PROVIDER_ROW_CAP,
    build_foreign_flow_coverage,
    provider_row_limit,
    requested_session_dates,
    session_dates_between,
)


def _row(day: str, buy: float | None = 100.0, sell: float | None = 40.0) -> dict:
    return {"symbol": "HPG", "date": day, "buy_volume": buy, "sell_volume": sell}


def test_provider_row_limit_never_exceeds_the_documented_cap():
    assert provider_row_limit(250, 60) == PROVIDER_ROW_CAP
    assert provider_row_limit(60, 60) == 60
    assert provider_row_limit(None, 60) == 60


def test_session_windows_skip_weekends_and_closures():
    # 2026-09-01 is a published HOSE closure (National Day observed).
    days = session_dates_between(date(2026, 8, 31), date(2026, 9, 4))
    assert date(2026, 9, 1) not in days
    assert date(2026, 9, 2) not in days
    assert all(day.weekday() < 5 for day in days)
    counted = requested_session_dates(5, end=date(2026, 9, 4))
    assert len(counted) == 5
    assert counted[-1] == date(2026, 9, 4)
    # The response fixture must match the exchange calendar, not a weekday count.
    assert len(session_dates_between(date(2026, 8, 24), date(2026, 11, 13))) == 57


def test_window_total_excludes_weekend_gap_and_duplicate_rows():
    # 2026-05-29 is a Friday; 30-31 are the weekend.
    rows = [
        _row("2026-05-29"),
        _row("2026-05-29"),  # duplicated feed line collapses to one session
        _row("2026-05-30"),  # Saturday: no exchange session
        _row("2026-05-28"),
        _row("2026-05-27"),
    ]
    coverage = build_foreign_flow_coverage(
        rows, start_date=date(2026, 5, 27), end_date=date(2026, 5, 29)
    )

    assert coverage.windowed is True
    assert coverage.requested_sessions == 3
    assert coverage.observed_sessions == 3
    assert coverage.duplicate_session_dates == ["2026-05-29"]
    assert coverage.non_session_dates == ["2026-05-30"]
    assert coverage.gap_sessions == 0
    assert coverage.status == "complete"
    # 3 sessions × (100 - 40), not the 4 raw rows including the weekend.
    assert coverage.net_volume == 180.0
    assert coverage.observed_start_date == date(2026, 5, 27)
    assert coverage.observed_end_date == date(2026, 5, 29)
    assert coverage.last_validated_session == date(2026, 5, 29)
    assert coverage.calendar_verified is True


def test_partial_history_reports_gaps_and_keeps_the_total_unavailable():
    coverage = build_foreign_flow_coverage(
        [_row("2026-05-29"), _row("2026-05-27")],
        requested_sessions=20,
        start_date=date(2026, 5, 4),
        end_date=date(2026, 5, 29),
    )

    assert coverage.observed_sessions == 2
    assert coverage.requested_sessions == 20
    assert coverage.gap_sessions == 18
    assert coverage.status == "partial"
    assert len(coverage.gap_dates) == 18
    assert any("2 of 20 requested sessions observed" in warning for warning in coverage.warnings)
    meta = coverage.meta()
    assert meta["coverage_status"] == "partial"
    assert meta["window_contract"] == "sessions"
    assert meta["gap_session_count"] == 18
    assert meta["last_validated_session"] == "2026-05-29"


def test_out_of_window_and_undated_rows_are_excluded_not_summed():
    coverage = build_foreign_flow_coverage(
        [
            _row("2026-05-29"),
            _row("2026-01-15"),  # before the requested window
            _row(None, buy=10_000.0, sell=0.0),  # no parsable date
        ],
        start_date=date(2026, 5, 25),
        end_date=date(2026, 5, 29),
    )

    assert coverage.observed_sessions == 1
    assert coverage.out_of_window_rows == 1
    assert coverage.undated_rows == 1
    assert coverage.net_volume == 60.0


def test_unknown_side_withholds_the_window_total_instead_of_zeroing_it():
    coverage = build_foreign_flow_coverage(
        [_row("2026-05-29"), _row("2026-05-28", buy=None)],
        start_date=date(2026, 5, 28),
        end_date=date(2026, 5, 29),
    )

    assert coverage.observed_sessions == 2
    assert coverage.net_volume is None


def test_unwindowed_read_labels_itself_as_retained_rows():
    coverage = build_foreign_flow_coverage([_row("2026-05-29")])

    assert coverage.windowed is False
    assert coverage.meta()["window_contract"] == "latest_retained_rows"
    assert coverage.net_volume == 60.0


def _set_market_clock(monkeypatch, now: str):
    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return cls.fromisoformat(now).astimezone(tz)

    monkeypatch.setattr(equity_module, "datetime", FrozenDateTime)
    monkeypatch.setattr(market_session, "datetime", FrozenDateTime)


@pytest.mark.parametrize(
    ("now", "session", "next_open", "extra_closures"),
    [
        ("2026-11-14T03:00:00+00:00", "2026-11-13", "2026-11-16T02:00:00+00:00", []),
        ("2026-11-14T03:00:00+00:00", "2026-11-13", "2026-11-17T02:00:00+00:00", ["2026-11-16"]),
        ("2026-09-02T06:00:00+00:00", "2026-08-28", "2026-09-03T02:00:00+00:00", []),
        ("2026-11-16T02:00:00+00:00", "2026-11-13", None, []),
        ("2026-12-31T09:00:00+00:00", "2026-12-31", None, []),
        ("2027-11-06T03:00:00+00:00", "2027-11-05", None, []),
    ],
)
@pytest.mark.asyncio
async def test_endpoint_separates_calendar_close_proof_from_coverage(
    client, monkeypatch, now, session, next_open, extra_closures,
):
    _set_market_clock(monkeypatch, now)
    monkeypatch.setattr(settings, "market_holiday_dates", extra_closures)
    monkeypatch.setattr(settings, "vn_timezone", "Asia/Ho_Chi_Minh")
    monkeypatch.setattr(settings, "intraday_market_open", "09:00")
    monkeypatch.setattr(settings, "intraday_market_close", "15:00")

    async def fake_fetch(_params):
        return [ForeignTradingData(symbol="HPG", date=session, buy_volume=1200, sell_volume=1200)]

    monkeypatch.setattr(equity_module.VnstockForeignTradingFetcher, "fetch", fake_fetch)
    response = await client.get("/api/v1/equity/HPG/foreign-trading?sessions=1")

    assert response.status_code == 200
    meta = response.json()["meta"]
    assert meta["requested_end_date"] == meta["last_validated_session"] == session
    assert meta["coverage_status"] == "complete"
    assert meta["latest_closed_session"] == (
        {"date": session, "checked_at": now, "valid_until": next_open} if next_open else None
    )


@pytest.mark.asyncio
async def test_endpoint_qualifies_a_session_window_and_reports_coverage(client, monkeypatch, test_db):
    expected = requested_session_dates(3)
    first, last = expected[0], expected[-1]
    seeded = [
        ForeignTrading(
            id=900 + index,
            symbol="MSN",
            trade_date=day,
            buy_volume=1_000,
            sell_volume=400,
        )
        for index, day in enumerate(expected)
    ]
    test_db.add_all(seeded)
    await test_db.commit()

    async def fake_fetch(params):
        return []

    monkeypatch.setattr(
        equity_module.VnstockForeignTradingFetcher, "fetch", fake_fetch, raising=True
    )

    response = await client.get("/api/v1/equity/MSN/foreign-trading?sessions=3")

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["count"] == 3
    assert payload["meta"]["requested_session_count"] == 3
    assert payload["meta"]["observed_session_count"] == 3
    assert payload["meta"]["requested_start_date"] == first.isoformat()
    assert payload["meta"]["requested_end_date"] == last.isoformat()
    assert payload["meta"]["coverage_status"] == "complete"
    assert payload["meta"]["gap_session_count"] == 0
    assert payload["meta"]["window_net_volume"] == 1_800.0
    assert payload["meta"]["last_validated_session"] == last.isoformat()
    assert [row["date"] for row in payload["data"]] == [
        day.isoformat() for day in sorted(expected, reverse=True)
    ]


@pytest.mark.asyncio
async def test_endpoint_keeps_provider_failure_visible_when_rows_are_retained(
    client, monkeypatch, test_db, caplog
):
    _set_market_clock(monkeypatch, "2026-05-30T03:00:00+00:00")
    session = requested_session_dates(2)[-1]
    test_db.add(
        ForeignTrading(
            id=921,
            symbol="FPT",
            trade_date=session,
            buy_volume=500,
            sell_volume=200,
        )
    )
    await test_db.commit()

    sentinel = "SYNTHETIC_FOREIGN_INSTALLER_SECRET"

    async def failing_fetch(params):
        raise RuntimeError(sentinel)

    monkeypatch.setattr(
        equity_module.VnstockForeignTradingFetcher, "fetch", failing_fetch, raising=True
    )

    response = await client.get("/api/v1/equity/FPT/foreign-trading?sessions=2")

    assert response.status_code == 200
    assert sentinel not in response.text
    payload = response.json()
    assert payload["meta"]["count"] == 1
    assert payload["meta"]["observed_session_count"] == 1
    assert payload["meta"]["coverage_status"] == "partial"
    assert payload["meta"]["window_net_volume"] == 300.0
    provider_warning = "live foreign trading feed unavailable; using cached database fallback"
    assert provider_warning in payload["error"]
    assert provider_warning in payload["meta"]["warnings"]
    assert payload["data"][0]["date"] == session.isoformat()
    assert payload["data"][0]["buy_volume"] == 500
    assert payload["data"][0]["sell_volume"] == 200
    assert any(sentinel in record.getMessage() for record in caplog.records)


@pytest.mark.asyncio
async def test_endpoint_discloses_the_row_cap_for_long_windows(client, monkeypatch, test_db):
    async def fake_fetch(params):
        assert params.limit == PROVIDER_ROW_CAP
        return [
            ForeignTradingData(
                symbol="FPT",
                date=requested_session_dates(1)[-1].isoformat(),
                buy_volume=100.0,
                sell_volume=0.0,
            )
        ]

    monkeypatch.setattr(
        equity_module.VnstockForeignTradingFetcher, "fetch", fake_fetch, raising=True
    )

    response = await client.get("/api/v1/equity/FPT/foreign-trading?sessions=250")

    payload = response.json()
    assert payload["meta"]["provider_row_cap_applied"] is True
    assert payload["meta"]["provider_row_cap"] == 100
    assert "caps" in (payload["error"] or "")


@pytest.mark.asyncio
async def test_empty_live_feed_serving_retained_rows_stays_degraded(
    client, monkeypatch, test_db
):
    sessions_ = requested_session_dates(2)
    test_db.add_all(
        [
            ForeignTrading(
                id=930 + index,
                symbol="VNM",
                trade_date=day,
                buy_volume=1_000,
                sell_volume=400,
            )
            for index, day in enumerate(sessions_)
        ]
    )
    await test_db.commit()

    async def empty_fetch(params):
        return []

    monkeypatch.setattr(
        equity_module.VnstockForeignTradingFetcher, "fetch", empty_fetch, raising=True
    )

    response = await client.get("/api/v1/equity/VNM/foreign-trading?sessions=2")

    payload = response.json()
    # A complete cache window does not make an empty live answer healthy.
    assert payload["meta"]["coverage_status"] == "complete"
    assert payload["meta"]["count"] == 2
    message = "Live foreign trading feed returned no rows; using cached database fallback."
    assert payload["error"] == message
    assert message in payload["meta"]["warnings"]
    # The retained sessions keep their own dates rather than "today".
    assert payload["meta"]["last_validated_session"] == sessions_[-1].isoformat()
    assert [row["date"] for row in payload["data"]] == [
        day.isoformat() for day in sorted(sessions_, reverse=True)
    ]


@pytest.mark.asyncio
async def test_disjoint_sources_return_exactly_the_latest_unwindowed_rows(
    client, monkeypatch, test_db
):
    recent = requested_session_dates(3)
    older = requested_session_dates(6)[:3]
    test_db.add_all(
        [
            ForeignTrading(
                id=940 + index,
                symbol="HPG",
                trade_date=day,
                buy_volume=1_000,
                sell_volume=400,
            )
            for index, day in enumerate(recent)
        ]
    )
    await test_db.commit()

    async def older_fetch(params):
        return [
            ForeignTradingData(
                symbol="HPG",
                date=day.isoformat(),
                buy_volume=1_000.0,
                sell_volume=400.0,
            )
            for day in sorted(older, reverse=True)
        ]

    monkeypatch.setattr(
        equity_module.VnstockForeignTradingFetcher, "fetch", older_fetch, raising=True
    )

    response = await client.get("/api/v1/equity/HPG/foreign-trading?limit=3")

    payload = response.json()
    # Provider and cache dates are disjoint, so a per-source cap would return 6.
    assert payload["meta"]["count"] == 3
    assert payload["meta"]["window_contract"] == "latest_retained_rows"
    assert [row["date"] for row in payload["data"]] == [
        day.isoformat() for day in sorted(recent, reverse=True)
    ]
    assert payload["meta"]["last_validated_session"] == max(recent).isoformat()


@pytest.mark.asyncio
async def test_long_session_window_is_not_truncated_by_the_default_row_limit(
    client, monkeypatch, test_db
):
    # 6M = 120 sessions; the request keeps the default limit of 60.
    window = requested_session_dates(120)
    test_db.add_all(
        [
            ForeignTrading(
                id=1_000 + index,
                symbol="VCI",
                trade_date=day,
                buy_volume=1_000,
                sell_volume=400,
            )
            for index, day in enumerate(window)
        ]
    )
    await test_db.commit()

    # The live feed overlaps the newest cached sessions, so the merge keeps one
    # row per session and 120 distinct sessions remain.
    newest = sorted(window, reverse=True)[:100]

    async def newest_fetch(params):
        return [
            ForeignTradingData(
                symbol="VCI",
                date=day.isoformat(),
                buy_volume=1_000.0,
                sell_volume=400.0,
            )
            for day in newest
        ]

    monkeypatch.setattr(
        equity_module.VnstockForeignTradingFetcher, "fetch", newest_fetch, raising=True
    )

    response = await client.get("/api/v1/equity/VCI/foreign-trading?sessions=120")

    payload = response.json()
    assert payload["meta"]["count"] == 120
    assert payload["meta"]["observed_session_count"] == 120
    assert payload["meta"]["requested_session_count"] == 120
    assert payload["meta"]["coverage_status"] == "complete"
    assert payload["meta"]["gap_session_count"] == 0
    # The 100 overlapping sessions collapse to one row each rather than adding,
    # and a healthy live/cache overlap is not reported as a duplicate feed line.
    assert payload["meta"]["duplicate_session_dates"] == []
    assert payload["meta"]["source_overlap_session_count"] == 100
    assert payload["meta"]["window_net_volume"] == 120 * 600
    assert payload["meta"]["observed_start_date"] == window[0].isoformat()
    assert payload["meta"]["observed_end_date"] == window[-1].isoformat()


def test_calendar_metadata_is_disclosed_for_unverified_years(monkeypatch):
    monkeypatch.setattr(coverage_module, "market_calendar_metadata", lambda anchor: {"verified": False})

    coverage = build_foreign_flow_coverage(
        [_row("2025-05-29"), _row("2025-05-28")],
        requested_sessions=2,
        start_date=date(2025, 5, 28),
        end_date=date(2025, 5, 29),
    )

    assert coverage.calendar_verified is False
    assert coverage.meta()["calendar_verified"] is False
    assert any("calendar not verified" in warning for warning in coverage.warnings)


@pytest.mark.asyncio
async def test_endpoint_admits_only_sessions_and_discloses_each_exclusion(
    client, monkeypatch, test_db
):
    window = requested_session_dates(3)
    out_of_window = requested_session_dates(4)[0]
    weekend = window[-1] + timedelta(days=(5 - window[-1].weekday()) % 7 or 7)
    test_db.add(
        ForeignTrading(
            id=950,
            symbol="GAS",
            trade_date=window[0],
            buy_volume=2_000,
            sell_volume=500,
        )
    )
    await test_db.commit()

    async def mixed_fetch(params):
        return [
            ForeignTradingData(
                symbol="GAS",
                date=window[2].isoformat(),
                buy_volume=1_000.0,
                sell_volume=400.0,
            ),
            ForeignTradingData(
                symbol="GAS",
                date=window[1].isoformat(),
                buy_volume=500.0,
                sell_volume=200.0,
            ),
            # A repeated session must collapse to one row, not double the total.
            ForeignTradingData(
                symbol="GAS",
                date=window[2].isoformat(),
                buy_volume=9_999.0,
                sell_volume=9_999.0,
            ),
            # No exchange session exists on this date, so it is never summed.
            ForeignTradingData(
                symbol="GAS",
                date=weekend.isoformat(),
                buy_volume=5_000.0,
                sell_volume=0.0,
            ),
            # A real earlier session outside the requested window.
            ForeignTradingData(
                symbol="GAS",
                date=out_of_window.isoformat(),
                buy_volume=7_000.0,
                sell_volume=0.0,
            ),
        ]

    monkeypatch.setattr(
        equity_module.VnstockForeignTradingFetcher, "fetch", mixed_fetch, raising=True
    )

    response = await client.get("/api/v1/equity/GAS/foreign-trading?sessions=3")

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["count"] == 3
    assert payload["meta"]["observed_session_count"] == 3
    assert payload["meta"]["coverage_status"] == "complete"
    assert payload["meta"]["window_net_volume"] == 2_400.0
    assert [row["date"] for row in payload["data"]] == [
        day.isoformat() for day in sorted(window, reverse=True)
    ]
    assert payload["meta"]["non_session_dates"] == [weekend.isoformat()]
    assert payload["meta"]["duplicate_session_dates"] == [window[2].isoformat()]
    assert payload["meta"]["out_of_window_row_count"] == 1
    assert any("no exchange session" in warning for warning in payload["meta"]["warnings"])
    assert any("duplicated session date" in warning for warning in payload["meta"]["warnings"])
