"""Retry state for daily history only; it is not listing or session evidence."""

import asyncio
import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import async_sessionmaker

from vnibb.models.app_kv import AppKeyValue

logger = logging.getLogger(__name__)

_KEY_PREFIX = "acquisition:daily_prices:"
_EMPTY_LIMIT = 5
_RETRY_DELAY = timedelta(hours=1)
_DB_TIMEOUT_SECONDS = 5
_EMPTY_SIGNALS = ("dữ liệu trống", "du lieu trong", "no data", "empty data", "no records")


class EmptyPriceHistory(ValueError):
    """No history returned; not evidence of suspension, delisting or no trades."""


def history_failure_reason(error: Exception | SystemExit) -> str:
    if isinstance(error, EmptyPriceHistory) or (
        isinstance(error, ValueError)
        and any(signal in str(error).lower() for signal in _EMPTY_SIGNALS)
    ):
        return "empty_history"
    if isinstance(error, TimeoutError):
        return "history_timeout"
    if isinstance(error, SystemExit):
        return "history_aborted"
    return "history_failed"


class PriceHistoryAcquisition:
    """Keep one durable status for the last recorded attempt per symbol in this feed."""

    def __init__(self, sessions: async_sessionmaker, start: str, end: str):
        self._sessions = sessions
        self._window = [start, end]

    async def load(self, symbol: str) -> dict | None:
        try:
            async with asyncio.timeout(_DB_TIMEOUT_SECONDS), self._sessions() as session:
                row = await session.get(AppKeyValue, _KEY_PREFIX + symbol.upper())
                return row.value if row is not None and isinstance(row.value, dict) else None
        except Exception as exc:
            logger.warning("Daily price retry state unavailable: %s", type(exc).__name__)
            return None

    def retry_after(self, previous: dict | None) -> datetime | None:
        if not previous or previous.get("window") != self._window:
            return None
        try:
            value = datetime.fromisoformat(previous["retry_at"])
        except (KeyError, TypeError, ValueError):
            return None
        return value if value.tzinfo is not None and value > datetime.now(UTC) else None

    async def record(
        self, symbol: str, attempted_at: datetime, reason: str, previous: dict | None,
    ) -> None:
        repeats = 0
        if reason == "empty_history":
            older = previous or {}
            count = older.get("consecutive_empty")
            repeats = 1 + (
                count if older.get("window") == self._window and type(count) is int and count >= 0 else 0
            )
        retry_at = attempted_at + _RETRY_DELAY if repeats >= _EMPTY_LIMIT else None
        value = {
            "reason": reason,
            "attempted_at": attempted_at.isoformat(),
            "window": self._window,
            "consecutive_empty": repeats,
            "retry_at": retry_at.isoformat() if retry_at else None,
        }
        try:
            async with asyncio.timeout(_DB_TIMEOUT_SECONDS), self._sessions() as session:
                insert = pg_insert if session.get_bind().dialect.name == "postgresql" else sqlite_insert
                stmt = insert(AppKeyValue).values(
                    key=_KEY_PREFIX + symbol.upper(), value=value, updated_at=attempted_at.replace(tzinfo=None),
                )
                await session.execute(stmt.on_conflict_do_update(
                    index_elements=[AppKeyValue.key],
                    set_={"value": stmt.excluded.value, "updated_at": stmt.excluded.updated_at},
                    where=AppKeyValue.updated_at <= stmt.excluded.updated_at,
                ))
                await session.commit()
        except Exception as exc:
            logger.warning("Daily price retry state could not be recorded: %s", type(exc).__name__)
