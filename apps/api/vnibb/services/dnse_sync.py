"""DNSE daily-bar import into ``stock_prices``.

Additive by construction: rows land as ``source='dnse_vnd'`` and an existing
(symbol, time, interval) row is left untouched, so Vietcap-certified bars and
prior history are never rewritten, restamped or deleted. DNSE publishes
thousand-VND prices and no turnover, so bars go through the shared price-unit
contract and ``value`` stays NULL instead of being invented.

Nothing credential-bearing reaches the receipt: a failing symbol is recorded as
the provider's status/code (``DNSE /price/ohlc returned HTTP 401 (OA-401)``) or a
local code (``persist_failed:IntegrityError``), never an upstream body (#231).
"""

from __future__ import annotations

import logging
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from vnibb.core.database import async_session_maker, engine
from vnibb.core.price_units import normalize_price_record
from vnibb.models.stock import Stock, StockPrice
from vnibb.models.sync_status import SyncStatus
from vnibb.providers import dnse

logger = logging.getLogger(__name__)


def _dialect_insert():
    if engine.dialect.name == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    else:
        from sqlalchemy.dialects.sqlite import insert
    return insert


def _price_rows(symbol: str, stock_id: int, bars: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = []
    for bar in bars:
        normalized = normalize_price_record({**bar, "symbol": symbol}, source="dnse")
        if normalized["price_unit"] != "VND":
            continue  # Never persist a bar whose scale could not be proven.
        rows.append({
            "stock_id": stock_id,
            "symbol": symbol,
            "time": normalized["time"],
            "open": normalized["open"],
            "high": normalized["high"],
            "low": normalized["low"],
            "close": normalized["close"],
            "volume": normalized["volume"],
            "value": None,
            "adj_close": None,
            "interval": "1D",
            "source": "dnse_vnd",
        })
    return rows


async def sync_daily_prices(symbols: list[str], start: date, end: date) -> dict[str, Any]:
    """Insert missing DNSE daily bars and publish a SyncStatus receipt.

    A misconfigured or disabled client fails the whole run before any write,
    rather than recording one bogus per-symbol error for every ticker. A single
    symbol's fetch or persist failure is reported and the run continues.
    """
    insert = _dialect_insert()
    started = datetime.now(UTC).replace(tzinfo=None)
    imported = skipped = 0
    errors: dict[str, str] = {}
    normalized = sorted({symbol.strip().upper() for symbol in symbols if symbol.strip()})
    async with async_session_maker() as session:
        known = dict((await session.execute(
            select(Stock.symbol, Stock.id).where(Stock.symbol.in_(normalized))
        )).all())
    for symbol in normalized:
        if symbol not in known:
            errors[symbol] = "symbol_not_in_stocks"
            continue
        try:
            bars = await dnse.fetch_daily_bars(symbol, start.isoformat(), end.isoformat())
        except dnse.DNSEConfigError:
            raise  # Fail the run: every symbol would report the same misconfiguration.
        except dnse.ProviderError as exc:
            errors[symbol] = str(exc)
            continue
        rows = _price_rows(symbol, known[symbol], bars)
        if not rows:
            continue
        try:
            async with async_session_maker.begin() as write_session:
                inserted = (await write_session.execute(
                    insert(StockPrice)
                    .values(rows)
                    .on_conflict_do_nothing(index_elements=["symbol", "time", "interval"])
                    .returning(StockPrice.id)
                )).scalars().all()
            imported += len(inserted)
            skipped += len(rows) - len(inserted)
        except SQLAlchemyError as exc:
            errors[symbol] = f"persist_failed:{type(exc).__name__}"
            logger.warning("DNSE persist failed for %s: %s", symbol, exc)
    receipt = {
        "sync_type": "dnse_daily_prices",
        "status": "partial" if errors else "completed",
        "symbols": normalized,
        "window": {"start": start.isoformat(), "end": end.isoformat()},
        "imported": imported,
        "skipped_existing": skipped,
        "errors": errors,
    }
    async with async_session_maker.begin() as session:
        session.add(SyncStatus(
            sync_type="dnse_daily_prices",
            status=receipt["status"],
            started_at=started,
            completed_at=datetime.now(UTC).replace(tzinfo=None),
            success_count=imported,
            error_count=len(errors),
            additional_data=receipt,
        ))
    return receipt
