"""Exchange-published closures; unlisted years are not certified calendars."""

from datetime import date

OFFICIAL_MARKET_HOLIDAYS = frozenset(
    date.fromisoformat(value)
    for value in (
        "2026-01-01", "2026-01-02",
        "2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19", "2026-02-20",
        "2026-04-27", "2026-04-30", "2026-05-01",
        "2026-08-31", "2026-09-01", "2026-09-02",
    )
)
CALENDAR_SOURCES = (
    "https://www.hsx.vn/vi/lich-giao-dich",
    "https://hnx.vn/chi-tiet-lich-nghi-gd-60021971.html?_page=1",
    "https://hnx.vn/chi-tiet-lich-nghi-gd-60022084.html?_page=1",
)

# HOSE published this closure after the shared 2026 calendar was assembled.
# This is a venue-specific discrepancy, not a change to the global holiday set.
# Source: https://www.hsx.vn/vi/lich-giao-dich
_UNRECONCILED_HOSE_DATES = frozenset({date(2026, 11, 24)})


def foreign_flow_calendar_verified(start: date, selection_cutoff: date) -> bool:
    """Reject ranges intersecting venue dates absent from the shared contract."""
    return (
        start <= selection_cutoff
        and market_calendar_metadata(start)["verified"]
        and market_calendar_metadata(selection_cutoff)["verified"]
        and not any(start <= day <= selection_cutoff for day in _UNRECONCILED_HOSE_DATES)
    )


def market_calendar_metadata(anchor: date) -> dict:
    verified = anchor.year == 2026
    return {
        "verified": verified,
        "year": anchor.year,
        "holiday_source": "HOSE/HNX 2026 notices + MARKET_HOLIDAY_DATES",
        "sources": list(CALENDAR_SOURCES) if verified else [],
        "limitation": (
            "Published 2026 closures, including the January 2 amendment; configured closures are additive."
            if verified
            else "No exchange-published calendar has been verified for this year."
        ),
    }
