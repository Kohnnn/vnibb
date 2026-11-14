"""#249 — foreign flow windows and coverage qualification.

The provider feed is row-capped and retained history can be sparse, so a row
count must never stand in for a calendar window, and a weekend date must never
be summed as a session.
"""

from datetime import date, timedelta

import pytest

from vnibb.api.v1 import equity as equity_module
from vnibb.models.trading import ForeignTrading
from vnibb.providers.vnstock.foreign_trading import ForeignTradingData
from vnibb.services import foreign_flow_coverage as coverage_module
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
    client, monkeypatch, test_db
):
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

    async def failing_fetch(params):
        raise RuntimeError("provider deadline exceeded")

    monkeypatch.setattr(
        equity_module.VnstockForeignTradingFetcher, "fetch", failing_fetch, raising=True
    )

    response = await client.get("/api/v1/equity/FPT/foreign-trading?sessions=2")

    payload = response.json()
    assert payload["meta"]["count"] == 1
    assert payload["meta"]["observed_session_count"] == 1
    assert payload["meta"]["coverage_status"] == "partial"
    assert payload["meta"]["window_net_volume"] == 300.0
    assert "provider deadline exceeded" in (payload["error"] or "")
    assert any("provider deadline exceeded" in warning for warning in payload["meta"]["warnings"])


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
