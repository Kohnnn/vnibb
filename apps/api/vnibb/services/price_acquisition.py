"""Retry state for daily history only; it is not listing or session evidence."""

import asyncio
import logging
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import async_sessionmaker

from vnibb.models.app_kv import AppKeyValue

logger = logging.getLogger(__name__)

_KEY_PREFIX = "acquisition:daily_prices:"
_EMPTY_LIMIT = 5
_RETRY_DELAY = timedelta(hours=1)
_WINDOW_LIMIT = 8
_DB_TIMEOUT_SECONDS = 5
_EMPTY_SIGNALS = ("dữ liệu trống", "du lieu trong", "no data", "empty data", "no records")


class EmptyPriceHistory(ValueError):
    """No history returned; not evidence of suspension, delisting or no trades."""


class PriceHistoryOutsideWindow(ValueError):
    """History was returned, but none of it belongs to the requested window."""


def history_failure_reason(error: Exception | SystemExit) -> str:
    if isinstance(error, EmptyPriceHistory) or (
        isinstance(error, ValueError)
        and any(signal in str(error).lower() for signal in _EMPTY_SIGNALS)
    ):
        return "empty_history"
    if isinstance(error, PriceHistoryOutsideWindow):
        return "history_outside_window"
    if isinstance(error, TimeoutError):
        return "history_timeout"
    if isinstance(error, SystemExit):
        return "history_aborted"
    return "history_failed"


class PriceHistoryAcquisition:
    """Bounded retry state per requested window within a daily-price symbol key."""

    def __init__(self, sessions: async_sessionmaker, start: str, end: str):
        self._sessions = sessions
        self._window = sorted((start, end))
        self._window_key = ":".join(self._window)

    @staticmethod
    def start_attempt() -> str:
        stamp = datetime.now(UTC).isoformat(timespec="microseconds")
        return f"{stamp}/{uuid4().hex}"

    async def load(self, symbol: str) -> dict | None:
        try:
            async with asyncio.timeout(_DB_TIMEOUT_SECONDS), self._sessions() as session:
                row = await session.get(AppKeyValue, _KEY_PREFIX + symbol.strip().upper())
                return (row.value or {}).get("windows", {}).get(self._window_key) if row else None
        except Exception as exc:
            logger.warning("Daily price retry state unavailable: %s", type(exc).__name__)
            return None

    @staticmethod
    def retry_after(previous: dict | None) -> datetime | None:
        try:
            value = datetime.fromisoformat((previous or {})["retry_at"])
        except (KeyError, TypeError, ValueError):
            return None
        return value if value.tzinfo is not None and value > datetime.now(UTC) else None

    async def record(self, symbol: str, attempt: str, reason: str) -> None:
        key = _KEY_PREFIX + symbol.strip().upper()
        try:
            async with asyncio.timeout(_DB_TIMEOUT_SECONDS), self._sessions() as session:
                insert = pg_insert if session.get_bind().dialect.name == "postgresql" else sqlite_insert
                # Ensure there is a row to lock. In SQLite this first DML holds the writer lock.
                await session.execute(insert(AppKeyValue).values(key=key, value={}).on_conflict_do_nothing(
                    index_elements=[AppKeyValue.key],
                ))
                row = await session.scalar(select(AppKeyValue).where(AppKeyValue.key == key).with_for_update())
                windows = dict((row.value or {}).get("windows", {}))
                windows[self._window_key] = self._transition(windows.get(self._window_key, {}), attempt, reason)
                # Keep active deferrals ahead of ordinary last observations, then evict oldest first.
                retained = sorted(windows, key=lambda item: (
                    self.retry_after(windows[item]) is not None, windows[item]["last_attempt"],
                ), reverse=True)[:_WINDOW_LIMIT]
                row.value = {"windows": {item: windows[item] for item in retained}}
                row.updated_at = datetime.now(UTC).replace(tzinfo=None)
                await session.commit()
        except Exception as exc:
            logger.warning("Daily price retry state could not be recorded: %s", type(exc).__name__)

    def _transition(self, previous: dict, attempt: str, reason: str) -> dict:
        # Only an in-window SQL commit can reset the streak. Errors and out-of-window
        # responses are diagnostic, not a recovery, an empty observation, or listing evidence.
        outcomes = dict(previous.get("qualifying_attempts", []))
        if reason in {"empty_history", "persisted"}:
            outcomes[attempt] = reason
        ordered = sorted(outcomes.items())[-_EMPTY_LIMIT:]
        repeats = 0
        for _, outcome in reversed(ordered):
            if outcome != "empty_history":
                break
            repeats += 1
        retry_at = None
        if repeats == _EMPTY_LIMIT:
            retry_at = (datetime.fromisoformat(ordered[-1][0].split("/", 1)[0]) + _RETRY_DELAY).isoformat()
        last_attempt = max(attempt, previous.get("last_attempt", ""))
        return {
            "window": self._window,
            "reason": reason if last_attempt == attempt else previous["reason"],
            "attempted_at": last_attempt.split("/", 1)[0],
            "last_attempt": last_attempt,
            "qualifying_attempts": ordered,
            "consecutive_empty": repeats,
            "retry_at": retry_at,
        }
