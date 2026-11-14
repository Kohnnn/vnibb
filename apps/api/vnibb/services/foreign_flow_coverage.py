"""Qualify foreign-flow rows against an explicit market-session window.

The provider feed returns a row-capped sample, so a row count is not a
calendar window: sparse retained history can span far more than the selected
period. This module turns a window of *market sessions* into the requested
range, rejects rows whose date cannot be a HOSE session, and reports the
observed range, the gaps and the last validated session so a consumer never
labels a partial sample as "20D".

Rows keep their raw values: nothing is rescaled, and a row whose buy/sell
volumes are unknown is never coerced to zero.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from math import isfinite
from typing import Any, Sequence

from vnibb.core.config import settings
from vnibb.core.market_calendar import OFFICIAL_MARKET_HOLIDAYS, market_calendar_metadata
from vnibb.services.data_quality import is_market_business_day
from vnibb.services.market_session import expected_market_session, market_session_date

PROVIDER_ROW_CAP = 100
_GAP_SAMPLE_LIMIT = 20


def _market_holidays() -> set[date]:
    return set(OFFICIAL_MARKET_HOLIDAYS) | {
        date.fromisoformat(value) for value in settings.market_holiday_dates
    }


def session_dates_between(start: date, end: date) -> list[date]:
    """Market business days in `start`..`end`, inclusive."""
    holidays = _market_holidays()
    days: list[date] = []
    cursor = start
    while cursor <= end:
        if is_market_business_day(cursor, holidays):
            days.append(cursor)
        cursor += timedelta(days=1)
    return days


def requested_session_dates(sessions: int, *, end: date | None = None) -> list[date]:
    """The last `sessions` market business days ending at `end` (inclusive)."""
    anchor = end or expected_market_session()
    holidays = _market_holidays()
    days: list[date] = []
    cursor = anchor
    while len(days) < sessions:
        if is_market_business_day(cursor, holidays):
            days.append(cursor)
        cursor -= timedelta(days=1)
    days.reverse()
    return days


def _row_date(row: Any) -> Any:
    if isinstance(row, dict):
        return row.get("date")
    return getattr(row, "date", None)


def _finite(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    return number if isfinite(number) else None


@dataclass
class ForeignFlowCoverage:
    """Rows admitted to one session window plus the window's actual coverage."""

    rows: list[Any] = field(default_factory=list)
    requested_start_date: date | None = None
    requested_end_date: date | None = None
    requested_sessions: int | None = None
    observed_sessions: int = 0
    observed_start_date: date | None = None
    observed_end_date: date | None = None
    last_validated_session: date | None = None
    gap_sessions: int = 0
    gap_dates: list[date] = field(default_factory=list)
    non_session_dates: list[str] = field(default_factory=list)
    duplicate_session_dates: list[str] = field(default_factory=list)
    source_overlap_sessions: int = 0
    undated_rows: int = 0
    out_of_window_rows: int = 0
    net_volume: float | None = None
    calendar_verified: bool | None = None
    windowed: bool = False
    warnings: list[str] = field(default_factory=list)

    @property
    def status(self) -> str:
        if self.observed_sessions == 0:
            return "unavailable"
        if self.windowed and (self.gap_sessions or (self.requested_sessions or 0) > self.observed_sessions):
            return "partial"
        return "complete"

    def meta(self) -> dict[str, Any]:
        """Serializable coverage fields for the response envelope."""
        return {
            "requested_start_date": self.requested_start_date.isoformat() if self.requested_start_date else None,
            "requested_end_date": self.requested_end_date.isoformat() if self.requested_end_date else None,
            "requested_session_count": self.requested_sessions,
            "observed_session_count": self.observed_sessions,
            "observed_start_date": self.observed_start_date.isoformat() if self.observed_start_date else None,
            "observed_end_date": self.observed_end_date.isoformat() if self.observed_end_date else None,
            "last_validated_session": self.last_validated_session.isoformat() if self.last_validated_session else None,
            "gap_session_count": self.gap_sessions,
            "gap_session_dates": [day.isoformat() for day in self.gap_dates],
            "non_session_dates": list(self.non_session_dates),
            "duplicate_session_dates": list(self.duplicate_session_dates),
            "source_overlap_session_count": self.source_overlap_sessions,
            "undated_row_count": self.undated_rows,
            "out_of_window_row_count": self.out_of_window_rows,
            "window_net_volume": self.net_volume,
            "coverage_status": self.status,
            "window_contract": "sessions" if self.windowed else "latest_retained_rows",
            "calendar_verified": self.calendar_verified,
            "provider_row_cap": PROVIDER_ROW_CAP,
            "provider_row_cap_applied": bool(
                self.windowed and (self.requested_sessions or 0) > PROVIDER_ROW_CAP
            ),
            "warnings": list(self.warnings),
        }


def build_foreign_flow_coverage(
    rows: Sequence[Any] | None,
    *,
    requested_sessions: int | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    row_limit: int | None = None,
    primary_source_count: int = 0,
) -> ForeignFlowCoverage:
    """Admit `rows` into the requested session window.

    `rows` is expected newest-first. Duplicate dates keep the first row seen,
    so a caller that passes provider rows before retained rows prefers the
    live feed for the same session. Weekend/holiday rows are excluded rather
    than summed: no exchange session exists on those dates.

    `row_limit` truncates the merged result, never the inputs: a caller that
    unions the live feed with retained rows must still return exactly the
    latest N *distinct* sessions, not 2N when the two sources are disjoint. A
    session window is instead bounded by its own sessions, so the limit does
    not apply there.

    `primary_source_count` is how many leading `rows` came from the primary
    source. A later repeat of one of those sessions is reported as a source
    overlap rather than a duplicated feed line, so a healthy live/cache
    overlap does not raise a data-quality warning.
    """
    coverage = ForeignFlowCoverage()
    ordered = [row for row in (rows or []) if row is not None]

    if start_date is not None or end_date is not None or requested_sessions:
        if start_date is not None and end_date is not None:
            expected_days = session_dates_between(start_date, end_date)
            if not expected_days:
                coverage.warnings.append(
                    "requested range contains no market session; no window can be validated"
                )
        else:
            expected_days = requested_session_dates(
                max(1, int(requested_sessions or 1)), end=end_date
            )
        coverage.windowed = True
        coverage.requested_start_date = start_date or (expected_days[0] if expected_days else None)
        coverage.requested_end_date = end_date or (expected_days[-1] if expected_days else None)
        coverage.requested_sessions = len(expected_days) if expected_days else (requested_sessions or 0)
        coverage.calendar_verified = bool(
            expected_days
            and all(
                market_calendar_metadata(day)["verified"]
                for day in (coverage.requested_start_date, coverage.requested_end_date)
            )
        )
        if expected_days and coverage.calendar_verified is False:
            coverage.warnings.append(
                "exchange calendar not verified for the requested year; "
                "closures may appear as missing sessions"
            )
    else:
        expected_days = []


    expected_set = set(expected_days)
    holidays = _market_holidays()
    seen: dict[date, Any] = {}
    non_session: list[str] = []
    duplicates: list[str] = []
    overlaps: list[str] = []

    # Rows are newest-first, so the first source to offer a session wins. When
    # the caller unions sources with `primary_source_count` live rows followed
    # by retained rows, a second sighting of a session from the other source is
    # a normal overlap, not a defective feed.
    for index, row in enumerate(ordered):
        session = market_session_date(_row_date(row))
        if session is None:
            coverage.undated_rows += 1
            continue
        if session.weekday() >= 5 or session in holidays:
            # Not a possible exchange session: never admitted to a window total.
            non_session.append(session.isoformat())
            continue
        if coverage.windowed and session not in expected_set:
            coverage.out_of_window_rows += 1
            continue
        if session in seen:
            # A repeat inside the live feed is a duplicated line; a repeat from
            # the retained read is the normal overlap between the two sources.
            if 0 < primary_source_count <= index:
                overlaps.append(session.isoformat())
            else:
                duplicates.append(session.isoformat())
            continue
        seen[session] = row

    admitted = sorted(seen.items(), key=lambda item: item[0], reverse=True)
    if row_limit is not None and not coverage.windowed:
        admitted = admitted[: max(0, int(row_limit))]
    coverage.rows = [row for _, row in admitted]
    coverage.observed_sessions = len(admitted)
    if admitted:
        coverage.observed_end_date = admitted[0][0]
        coverage.observed_start_date = admitted[-1][0]
        coverage.last_validated_session = admitted[0][0]
    coverage.non_session_dates = sorted(set(non_session))
    coverage.duplicate_session_dates = sorted(set(duplicates))
    coverage.source_overlap_sessions = len(set(overlaps))

    if coverage.windowed:
        missing = [day for day in expected_days if day not in seen]
        coverage.gap_sessions = len(missing)
        coverage.gap_dates = missing[:_GAP_SAMPLE_LIMIT]
        if coverage.non_session_dates:
            coverage.warnings.append(
                f"{len(coverage.non_session_dates)} row(s) carried a date with no exchange session"
            )
        if coverage.duplicate_session_dates:
            coverage.warnings.append(
                f"{len(coverage.duplicate_session_dates)} duplicated session date(s) collapsed to one row"
            )
        if coverage.undated_rows:
            coverage.warnings.append(
                f"{coverage.undated_rows} row(s) without a parsable date were excluded"
            )

    net_total = 0.0
    for _, row in admitted:
        buy = _finite(row.get("buy_volume") if isinstance(row, dict) else getattr(row, "buy_volume", None))
        sell = _finite(row.get("sell_volume") if isinstance(row, dict) else getattr(row, "sell_volume", None))
        if buy is None or sell is None:
            coverage.net_volume = None
            break
        net_total += buy - sell
    else:
        coverage.net_volume = net_total if admitted else None

    if coverage.windowed and coverage.observed_sessions and coverage.status == "partial":
        coverage.warnings.append(
            f"{coverage.observed_sessions} of {coverage.requested_sessions} requested sessions observed"
        )

    return coverage


def provider_row_limit(requested_sessions: int | None, fallback_limit: int) -> int:
    """Provider requests above its documented row cap cannot be honoured."""
    wanted = requested_sessions or fallback_limit
    return max(1, min(int(wanted), PROVIDER_ROW_CAP))
