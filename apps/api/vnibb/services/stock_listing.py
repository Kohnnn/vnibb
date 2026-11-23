"""Persist stock reference metadata without granting it listing-status authority."""

from collections.abc import Mapping
from datetime import date, datetime
from numbers import Real
from typing import Any

from sqlalchemy import and_, case, func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.models.stock import Stock

_EQUITY_BOARDS = {"HOSE", "HNX", "UPCOM"}
_UNVERIFIED_STATES = {"DELISTED", "SUSPENDED", "NO_TRADE", "INACTIVE"}


def _label(value: Any) -> str:
    return value.strip().upper().replace("-", "_").replace(" ", "_") if isinstance(value, str) else ""


def equity_board(value: Any) -> str | None:
    board = _label(value)
    if board == "HSX":
        board = "HOSE"
    return board if board in _EQUITY_BOARDS else None


def withhold_listing_status(record: Mapping[str, Any]) -> bool:
    """A refresh label or unverified date cannot authorize a status change."""
    active = record.get("is_active")
    return (
        any(_label(record.get(key)) in _UNVERIFIED_STATES for key in
            ("exchange", "board", "status", "comGroupCode"))
        or (isinstance(active, Real) and active == 0)
        or _label(active) in {"0", "FALSE"}
        or any(
            (isinstance(value, date) and value == value)
            or (isinstance(value, str) and _label(value) not in {"", "NAN", "NAT", "NONE", "NULL"})
            for value in (record.get("delisting_date"), record.get("delistingDate"))
        )
    )


def listed_exchange_update(exchange):
    """Enrich the board of a currently listed row, never erase a retained status marker."""
    return case(
        (and_(Stock.is_active == 1, Stock.delisting_date.is_(None),
              func.upper(Stock.exchange).not_in(_UNVERIFIED_STATES)), exchange),
        else_=Stock.exchange,
    )


def stock_metadata_upsert(session: AsyncSession, record: Mapping[str, Any]):
    """Insert a positively observed identity; on conflict write only descriptive metadata."""
    if withhold_listing_status(record):
        raise ValueError("A listing refresh cannot change membership status")
    now = datetime.utcnow()
    board = equity_board(record.get("exchange"))
    fields = ("company_name", "short_name", "industry", "sector")
    insert = pg_insert if session.get_bind().dialect.name == "postgresql" else sqlite_insert
    stmt = insert(Stock).values(
        symbol=record["symbol"], exchange=board or "UNKNOWN", is_active=1,
        created_at=now, updated_at=now, **{key: record.get(key) for key in fields},
    )
    updates = {key: func.coalesce(stmt.excluded[key], getattr(Stock, key)) for key in fields}
    updates["updated_at"] = now
    if board:
        updates["exchange"] = listed_exchange_update(stmt.excluded.exchange)
    return stmt.on_conflict_do_update(index_elements=[Stock.symbol], set_=updates)
