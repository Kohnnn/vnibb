"""Qualify provider-board sessions without inventing an actual trade date."""

from __future__ import annotations

from copy import deepcopy
from datetime import date, datetime, time, timedelta
from math import isfinite
from typing import Any
from zoneinfo import ZoneInfo

from vnibb.core.config import settings
from vnibb.core.market_calendar import OFFICIAL_MARKET_HOLIDAYS

_ICT = ZoneInfo("Asia/Ho_Chi_Minh")


def _market_holidays() -> set[date]:
    return set(OFFICIAL_MARKET_HOLIDAYS) | {
        date.fromisoformat(value) for value in settings.market_holiday_dates
    }


def expected_market_session(*, now: datetime | None = None) -> date:
    market_timezone = ZoneInfo(settings.vn_timezone)
    current = now if now is not None else datetime.now(market_timezone)
    if current.tzinfo is None:
        current = current.replace(tzinfo=market_timezone)
    current = current.astimezone(market_timezone)
    session = current.date()
    if current.time() < time.fromisoformat(settings.intraday_market_close):
        session -= timedelta(days=1)
    holidays = _market_holidays()
    while session.weekday() >= 5 or session in holidays:
        session -= timedelta(days=1)
    return session


def market_session_date(value: Any) -> date | None:
    """Resolve a source timestamp to its market-zone session date.

    Date-only values stay dates. Aware timestamps resolve in the configured
    market timezone, where a late-evening UTC instant can fall on the next
    Vietnamese date. The whole string must parse; anything else is `None`, and
    a missing date never becomes "today".
    """
    if isinstance(value, datetime):
        if value.tzinfo is None or value.utcoffset() is None:
            return value.date()
        return value.astimezone(ZoneInfo(settings.vn_timezone)).date()
    if isinstance(value, date):
        return value
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    parsed: datetime | None = None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        try:
            return date.fromisoformat(text)
        except ValueError:
            return None
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        return parsed.date()
    return parsed.astimezone(ZoneInfo(settings.vn_timezone)).date()


def _is_market_business_day(anchor: date, holidays: set[date]) -> bool:
    return anchor.weekday() < 5 and anchor not in holidays


def market_sessions_are_adjacent(earlier: Any, later: Any) -> bool:
    """True when `later` is the first market session after `earlier`.

    `df.iloc[-2]` is only the previous session when no session is missing in
    between. HNX is missing 2026-10-29, so its second row is 2026-10-28 and
    deriving a change from it reports a two-session move as one session's
    (#205). Both endpoints must themselves be market business days: a closure
    or a weekend beside the other date is not a session boundary.
    """
    start = market_session_date(earlier)
    end = market_session_date(later)
    if start is None or end is None or end <= start:
        return False
    holidays = _market_holidays()
    if not _is_market_business_day(start, holidays) or not _is_market_business_day(end, holidays):
        return False
    cursor = end
    while cursor > start:
        cursor -= timedelta(days=1)
        if cursor == start:
            return True
        if _is_market_business_day(cursor, holidays):
            # A session between them means they are not adjacent.
            return False
    return False


def _timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo is not None and parsed.utcoffset() is not None else None
    except ValueError:
        return None


def _number(value: Any) -> bool:
    return type(value) is int or (type(value) is float and isfinite(value))


def _current_clock(value: Any, session: date, observed_at: datetime) -> bool:
    clock = _timestamp(value)
    return clock is not None and clock <= observed_at and clock.astimezone(_ICT).date() == session


def _valid_source_clocks(section: dict, observed_at: datetime) -> bool:
    for field in ("time", "receivedTime", "firstTimeMatchPrice"):
        value = section.get(field)
        if value is not None:
            clock = _timestamp(value)
            if clock is None or clock > observed_at:
                return False
    return True


def _raw_status(raw: Any, symbol: str, session: date, observed_at: datetime) -> str | None:
    if not isinstance(raw, dict) or not isinstance(symbol, str) or not symbol:
        return None
    if type(session) is not date or session.weekday() >= 5 or session in _market_holidays():
        return None
    if not isinstance(observed_at, datetime) or observed_at.tzinfo is None or observed_at.utcoffset() is None:
        return None
    if expected_market_session(now=observed_at) != session:
        return None
    listing, match, book = (raw.get(field) for field in ("listingInfo", "matchPrice", "bidAsk"))
    if not all(isinstance(section, dict) for section in (listing, match, book)):
        return None
    if any(section.get("symbol") != symbol for section in (listing, match, book)):
        return None
    if listing.get("ticker") != symbol or listing.get("type") != "STOCK" or listing.get("stockType") != "STOCK":
        return None
    if type(listing.get("isDelisted")) is not int or listing["isDelisted"] != 0:
        return None
    if listing.get("tradingDate") != session.isoformat():
        return None
    if not _current_clock(listing.get("receivedTime"), session, observed_at):
        return None
    if not all(_valid_source_clocks(section, observed_at) for section in (listing, match, book)):
        return None

    suspension = (
        listing.get("tradingStatus") == "TRADING_SUSPENSION",
        listing.get("tradingStatusCode") == "110",
        listing.get("securityStatus") == "Y",
    )
    if any(suspension):
        volume = match.get("accumulatedVolume")
        prices = [match.get(field) for field in ("openPrice", "highest", "lowest", "matchPrice")]
        valid_prices = all(value is None or (_number(value) and value >= 0) for value in prices)
        if not all(suspension) or not _number(volume) or volume != 0 or not valid_prices:
            return None
        current_match = _current_clock(match.get("time"), session, observed_at)
        if current_match and any(value is not None and value > 0 for value in prices):
            return None
        return "suspended"
    if not all(
        _current_clock(section.get(field), session, observed_at)
        for section in (match, book) for field in ("time", "receivedTime")
    ):
        return None
    if book.get("session") != "ENDED":
        return None
    prices = [match.get(field) for field in ("openPrice", "highest", "lowest", "matchPrice")]
    volume = match.get("accumulatedVolume")
    if not _number(volume) or volume != int(volume):
        return None
    if volume == 0:
        if match.get("session") != "ENDED":
            return None
        # Vietcap uses a null open when no opening match exists, not a zero-price trade.
        no_open = prices[0] is None or (_number(prices[0]) and prices[0] == 0)
        return "no_trade" if no_open and all(_number(value) and value == 0 for value in prices[1:]) else None
    if volume < 0 or not all(_number(value) and value > 0 for value in prices):
        return None
    opening, high, low, last = prices
    return "traded" if low <= opening <= high and low <= last <= high else None


def qualify_market_session(
    raw: Any, symbol: str, expected_session: date, observed_at: datetime,
) -> dict | None:
    status = _raw_status(raw, symbol, expected_session, observed_at)
    if status is None:
        return None
    return {
        "symbol": symbol,
        "session_date": expected_session.isoformat(),
        "status": status,
        "source": "vietcap",
        "scope": "vietcap_board",
        "observed_at": observed_at.isoformat(),
        "raw": deepcopy(raw),
    }


def session_coverage(record: Any, symbol: str, expected_session: date | None) -> str | None:
    if not isinstance(record, dict) or type(expected_session) is not date:
        return None
    if record.get("symbol") != symbol or record.get("session_date") != expected_session.isoformat():
        return None
    if record.get("source") != "vietcap" or record.get("scope") != "vietcap_board":
        return None
    observed_at = _timestamp(record.get("observed_at"))
    if observed_at is None:
        return None
    status = _raw_status(record.get("raw"), symbol, expected_session, observed_at)
    return status if status is not None and status == record.get("status") else None
