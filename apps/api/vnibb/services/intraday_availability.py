"""Availability of the requested feed, independent of the exchange calendar."""

from collections.abc import Iterable
from datetime import UTC, datetime, timedelta, tzinfo
from typing import Any, Literal, TypedDict
from zoneinfo import ZoneInfo

from vnibb.core.config import settings
from vnibb.core.exceptions import ProviderError, ProviderTimeoutError
from vnibb.services.market_session import market_session_date

FeedStatus = Literal["available", "empty", "timeout", "unsupported", "unavailable", "unusable", "not_requested"]
Delivery = Literal["provider", "cache", "retained", "reference"]


class CoveredTradeWindow(TypedDict):
    session_date: str
    trade_count: int
    basis: Literal["completed_tick_session", "vietcap_board"]


class IntradayFeed(TypedDict):
    status: FeedStatus
    requested_source: str | None
    source: str | None
    source_as_of: str | None
    fetched_at: str
    snapshot_at: str | None
    delivery: Delivery
    fallback: bool
    covered_window: CoveredTradeWindow | None


def intraday_feed(
    status: FeedStatus,
    *,
    fetched_at: datetime,
    source: str | None = None,
    requested_source: str | None = None,
    source_as_of: str | None = None,
    snapshot_at: str | None = None,
    delivery: Delivery = "provider",
    fallback: bool = False,
    covered_window: CoveredTradeWindow | None = None,
) -> IntradayFeed:
    return {
        "status": status,
        "source": source,
        "requested_source": requested_source or source,
        "source_as_of": source_as_of,
        "fetched_at": fetched_at.isoformat(),
        "snapshot_at": snapshot_at,
        "delivery": delivery,
        "fallback": fallback,
        "covered_window": covered_window,
    }

FEED_ERROR_COPY = {
    "timeout": "Request timed out",
    "unsupported": "The configured provider does not support this feed",
    "unavailable": "The feed could not be retrieved",
    "unusable": "The feed returned no usable observations",
}


def provider_feed_failure(exc: Exception) -> tuple[FeedStatus, str]:
    status: FeedStatus = "unavailable"
    if isinstance(exc, (TimeoutError, ProviderTimeoutError)) or getattr(exc, "timeout", False):
        status = "timeout"
    elif isinstance(exc, ProviderError):
        if exc.capability:
            status = "unsupported"
        elif exc.details.get("feed_status") == "unusable":
            status = "unusable"
    return status, FEED_ERROR_COPY[status]


def observation_time(value: Any, *, naive_tz: tzinfo | None = None) -> datetime | None:
    """A clock without a date is not an as-of. Naive timestamps need a known convention."""
    if isinstance(value, str):
        if len(value.strip()) <= 10:
            return None
        try:
            value = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError:
            return None
    if not isinstance(value, datetime):
        return None
    if value.utcoffset() is None:
        return value.replace(tzinfo=naive_tz) if naive_tz is not None else None
    return value


def latest_trade_observation(values: Iterable[Any], *, now: datetime) -> str | None:
    market_tz = ZoneInfo(settings.vn_timezone)
    latest = max(
        (stamp for value in values if (stamp := observation_time(value, naive_tz=market_tz)) is not None and stamp <= now),
        default=None,
    )
    return latest.isoformat() if latest else None


def retained_trade_time(row: dict[str, Any]) -> Any:
    raw = row.get("raw")
    for value in (raw.get("time") if isinstance(raw, dict) else None, row.get("tradeTime")):
        if value is not None:
            return value
    if row.get("timestampMeaning") == "source_trade_time":
        return row.get("observedAt")
    return None


def completed_trade_window(
    receipt: Any,
    *,
    symbol: str,
    row_count: int,
    lookback_days: int,
    now: datetime,
) -> CoveredTradeWindow | None:
    """Admit a completed retained tick session, not a row limit or an empty batch."""
    if not isinstance(receipt, dict) or receipt.get("batchReceipt") is not True:
        return None
    coverage = receipt.get("coverage")
    if not isinstance(coverage, dict):
        return None
    day = market_session_date(coverage.get("session_date"))
    if day is None or coverage.get("session_date") != day.isoformat():
        return None
    market_tz = ZoneInfo(settings.vn_timezone)
    oldest_day = (now - timedelta(days=lookback_days)).astimezone(market_tz).date()
    if not oldest_day < day <= now.astimezone(market_tz).date():
        return None
    counts = (receipt.get("rowCount"), coverage.get("observed_trade_count"), coverage.get("denominator_trade_count"))
    if (
        receipt.get("symbol") != symbol
        or receipt.get("sourceDate") != day.isoformat()
        or coverage.get("requested_session_date") != day.isoformat()
        or coverage.get("scope") != "full_session"
        or coverage.get("status") != "complete_session"
        or coverage.get("completed_session") is not True
        or coverage.get("provider_exhausted") is not True
        or any(type(count) is not int or count != row_count for count in counts)
    ):
        return None
    return {"session_date": day.isoformat(), "trade_count": row_count, "basis": "completed_tick_session"}


def retained_tick_feed(
    rows: list[dict[str, Any]],
    symbol: str,
    *,
    lookback_days: int,
    now: datetime,
    admitted_times: list[datetime] | None = None,
    limit: int | None = None,
) -> IntradayFeed:
    metadata = getattr(rows, "metadata", {})
    market_tz = ZoneInfo(settings.vn_timezone)
    clocks = admitted_times if admitted_times is not None else [
        observation_time(retained_trade_time(row), naive_tz=market_tz) for row in rows
    ]
    count = len(clocks) if admitted_times is not None else len(rows)
    dates = {market_session_date(stamp) if stamp is not None and stamp <= now else None for stamp in clocks}
    window = None
    if len(rows) == count and limit != 0:
        window = completed_trade_window(
            metadata.get("batch_receipt"), symbol=symbol, row_count=count, lookback_days=lookback_days, now=now,
        )
        if window and dates and dates != {market_session_date(window["session_date"])}:
            window = None
    as_of = max((stamp for stamp in clocks if stamp is not None and stamp <= now), default=None)
    return intraday_feed(
        "not_requested" if limit == 0 else "available" if count else "unusable" if rows else "empty",
        fetched_at=now,
        source=_retained_store(rows),
        source_as_of=as_of.isoformat() if as_of else window["session_date"] if window else None,
        snapshot_at=_batch_time(metadata),
        delivery="retained",
        covered_window=window,
    )


def _retained_store(rows: list[dict[str, Any]]) -> str | None:
    stores = {row["sourceCollection"] for row in rows if row.get("sourceCollection")}
    collection = getattr(rows, "metadata", {}).get("source_collection")
    if collection:
        stores.add(collection)
    return f"mongodb:{next(iter(stores))}" if len(stores) == 1 else None


def _batch_time(metadata: dict[str, Any]) -> str | None:
    stamp = observation_time(metadata.get("batch_updated_at"), naive_tz=UTC)
    return stamp.isoformat() if stamp is not None else None


def depth_observation(record: Any, meaning: Any, *, now: datetime) -> str | None:
    if meaning not in ("observed", "source_observation", "source_observation_time"):
        return None
    stamp = observation_time(record, naive_tz=UTC)
    return stamp.isoformat() if stamp is not None and stamp <= now else None


def retained_depth_feed(rows: list[dict[str, Any]], *, now: datetime, limit: int) -> IntradayFeed:
    usable = [row for row in rows if row.get("normalizationStatus") != "unsupported_depth_shape"]
    stamps = (depth_observation(row.get("observedAt"), row.get("timestampMeaning"), now=now) for row in usable)
    return intraday_feed(
        "not_requested" if limit == 0 else "available" if usable else "unusable" if rows else "empty",
        fetched_at=now,
        source=_retained_store(rows),
        source_as_of=max((stamp for stamp in stamps if stamp is not None),
                         key=datetime.fromisoformat, default=None),
        snapshot_at=_batch_time(getattr(rows, "metadata", {})),
        delivery="retained",
    )
