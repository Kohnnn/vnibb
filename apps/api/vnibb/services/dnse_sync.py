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
from math import isfinite
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
    """Persistable rows; raises ``ProviderError`` on a bar that cannot be proven.

    The finiteness check is repeated here on purpose: ``parse_ohlc`` already
    rejects NaN/Infinity, and this is the last gate before ``StockPrice.close``,
    so a non-finite price can never be written even if a caller hand-builds bars.
    """
    rows = []
    for bar in bars:
        normalized = normalize_price_record({**bar, "symbol": symbol}, source="dnse")
        if normalized["price_unit"] != "VND":
            continue  # Never persist a bar whose scale could not be proven.
        prices = [normalized[field] for field in ("open", "high", "low", "close")]
        if not all(isfinite(float(value)) for value in prices):
            raise dnse.ProviderError(
                f"DNSE bar for {symbol} on {normalized['time']} has a non-finite price", "dnse"
            )
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


async def _record_refusal(exc: dnse.DNSEConfigError, started: datetime, symbols: list[str],
                          start: date, end: date) -> None:
    """Persist a failed receipt for a refused run; never mask the original error.

    The stderr of an operator's shell is gone by morning, so the durable row is
    what makes a missing/revoked key a truthful unavailable state (#231). The
    reason is ``exc.reason``, a stable token, never ``str(exc)``. If the database
    is also unreachable — plausibly why config failed — log and let the caller
    still see the ``DNSEConfigError``.
    """
    receipt = {
        "sync_type": "dnse_daily_prices",
        "status": "failed",
        "refused": exc.reason,
        "symbols": symbols,
        "window": {"start": start.isoformat(), "end": end.isoformat()},
    }
    try:
        async with async_session_maker.begin() as session:
            session.add(SyncStatus(
                sync_type="dnse_daily_prices",
                status="failed",
                started_at=started,
                completed_at=datetime.now(UTC).replace(tzinfo=None),
                success_count=0,
                error_count=1,
                additional_data=receipt,
            ))
    except Exception as write_exc:  # Ambient read-only copy; any failure to record
        # the refusal must never replace the DNSEConfigError the caller is owed.
        logger.warning("DNSE refusal receipt could not be written: %s", type(write_exc).__name__)


async def sync_daily_prices(symbols: list[str], start: date, end: date) -> dict[str, Any]:
    """Insert missing DNSE daily bars and publish a SyncStatus receipt.

    A misconfigured or disabled client fails the whole run before any write,
    rather than recording one bogus per-symbol error for every ticker; the
    refusal still leaves one ``status='failed'`` receipt behind. A single
    symbol's fetch or persist failure is reported and the run continues.
    """
    insert = _dialect_insert()
    started = datetime.now(UTC).replace(tzinfo=None)
    imported = skipped = 0
    errors: dict[str, str] = {}
    normalized = sorted({symbol.strip().upper() for symbol in symbols if symbol.strip()})
    try:
        # Refuse before any per-symbol work or database access, so one run leaves
        # exactly one receipt whether or not the tickers exist locally.
        dnse.ensure_configured()
    except dnse.DNSEConfigError as exc:
        await _record_refusal(exc, started, normalized, start, end)
        raise
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
            rows = _price_rows(symbol, known[symbol], bars)
        except dnse.DNSEConfigError:
            raise  # Already receipted above; never write a second row for one run.
        except dnse.ProviderError as exc:
            # One bad symbol or unusable bar is reported, and the run continues:
            # it must never abort after earlier symbols already committed.
            errors[symbol] = str(exc)
            continue
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
