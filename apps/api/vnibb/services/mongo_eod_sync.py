"""Vietcap-primary EOD ingestion with separate bounded refresh and catchup.

Incremental refresh discovers the active SQL Universe, including new symbols.
Historical acquisition advances oldest unacquired calendar windows using durable
receipts; receipts do not certify exchange-session completeness. Both writers
reuse source natural-key upserts and never delete other providers' records.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import select

from vnibb.core.database import async_session_factory
from vnibb.models.stock import Stock
from vnibb.services.data_pipeline import data_pipeline
from vnibb.services.mongo_market_data_service import get_mongo_market_data_service
from vnibb.services.vietcap_client import VietcapClient
from vnibb.services.vietcap_financials import (
    persist_vietcap_financials,
    persist_vietcap_listings,
    persist_vietcap_prices,
)
from vnibb.services.vietcap_ingestion import (
    FinancialAcquisitionPartial,
    ohlc_rows_from_gap_chart,
    sync_symbol_financials,
    upsert_listing_rows,
)

logger = logging.getLogger(__name__)

# Rolling catch-up window. Long enough to self-heal across a long weekend or a
# single missed run, short enough to stay cheap for the full universe.
DEFAULT_WINDOW_DAYS = 7
# Hard ceiling so a misconfiguration can never launch an unbounded full-history
# refetch of the entire universe inside the scheduler.
MAX_WINDOW_DAYS = 30
MAX_FINANCIAL_SYMBOLS = 50
MAX_CATCHUP_SYMBOLS = 50
DEFAULT_HISTORY_START = date(2000, 1, 1)
CATCHUP_RECEIPTS = "market_eod_catchup_receipts"


def _to_naive_datetime(value: Any) -> datetime | None:
    """Coerce a vnstock ``time`` cell into a naive ``datetime`` (Mongo schema)."""

    if value is None:
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed.replace(tzinfo=None)
    except (TypeError, ValueError):
        return None


def _coerce_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    # pandas NaN is a float that is not equal to itself.
    if result != result:
        return None
    return result


def _coerce_int(value: Any) -> int | None:
    coerced = _coerce_float(value)
    if coerced is None:
        return None
    return int(coerced)


def _frame_to_rows(frame: Any) -> list[dict[str, Any]]:
    """Normalize a vnstock history frame into upsert-ready dicts."""

    if frame is None or getattr(frame, "empty", True):
        return []

    rows: list[dict[str, Any]] = []
    for record in frame.to_dict(orient="records"):
        trade_date = _to_naive_datetime(record.get("time") or record.get("date"))
        if trade_date is None:
            continue
        rows.append(
            {
                "tradeDate": trade_date,
                "price_unit": record.get("price_unit", "unknown"),
                "price_source": record.get("price_source"),
                "open": _coerce_float(record.get("open")),
                "high": _coerce_float(record.get("high")),
                "low": _coerce_float(record.get("low")),
                "close": _coerce_float(record.get("close")),
                "volume": _coerce_int(record.get("volume")),
                "value": _coerce_float(record.get("value")),
                "adj_close": _coerce_float(next((record.get(field) for field in ("adj_close", "adjusted_close", "adjClose") if record.get(field) is not None), None)),
                "raw": record,
                "sourceUnit": record.get("price_unit", "unknown"),
            }
        )
    return rows


async def _resolve_universe(service: Any) -> list[str]:
    """Discover confirmed active SQL stocks, never infer from retained bars."""
    async with async_session_factory() as session:
        result = await session.execute(select(Stock.symbol).where(
            Stock.is_active == 1,
            Stock.exchange.in_(("HOSE", "HNX", "UPCOM")),
        ))
        return sorted({str(symbol).strip().upper() for symbol in result.scalars().all() if symbol})


def _summary() -> dict[str, Any]:
    return {"symbols": 0, "rows": 0, "failures": 0, "listings": 0,
            "financials": 0, "fallbacks": 0, "primary_failures": 0,
            "structured_rows": 0, "expected": 0, "attempted": 0,
            "succeeded": 0, "empty": 0, "failed": 0,
            "outcome": "no_work", "complete": False, "errors": []}


def _error(summary: dict[str, Any], stage: str, exc: Exception, symbol: str | None = None) -> None:
    summary["errors"].append({"stage": stage, "symbol": symbol,
                              "type": type(exc).__name__, "message": str(exc)})


def _finish(summary: dict[str, Any]) -> dict[str, Any]:
    if "pending" in summary:
        summary["complete"] = summary["pending"] == 0 and summary["failures"] == 0
    if summary["failures"] or summary["primary_failures"]:
        summary["outcome"] = "partial" if summary["succeeded"] else (
            "empty" if summary["empty"] and not summary["failed"] else "failed")
    elif summary["succeeded"]:
        summary["outcome"] = "ok"
    logger.info("Mongo IQ sync outcome: %s", summary)
    return summary


class EmptyEodAcquisition(RuntimeError):
    """Both providers returned no usable bars, rather than a transport error."""


async def _acquire_eod(client: Any, symbol: str, start: date, end: date,
                       instrument_type: str | None, summary: dict[str, Any],
                       *, historical: bool = False) -> tuple[list[dict[str, Any]], str]:
    try:
        kwargs = {"count_back": (end - start).days + (2 if historical else 1)}
        if historical:
            kwargs["to_epoch"] = int(datetime.combine(end + timedelta(days=1),
                                                       datetime.min.time(), tzinfo=UTC).timestamp()) - 1
        raw = await asyncio.to_thread(client.get_ohlc, symbol, **kwargs)
        rows = ohlc_rows_from_gap_chart(symbol, raw, instrument_type=instrument_type) if raw else []
        rows = [row for row in rows if start <= row["tradeDate"].date() <= end]
        if not rows:
            raise EmptyEodAcquisition("Vietcap returned no EOD bars in the requested window")
        return rows, "vietcap"
    except Exception as exc:
        summary["primary_failures"] += 1
        _error(summary, "eod_primary", exc, symbol)
        logger.warning("Vietcap EOD unavailable for %s: %s", symbol, exc)
        if str(instrument_type or "").upper() != "STOCK":
            raise RuntimeError("Free VCI fallback requires a confirmed stock listing") from exc
        await data_pipeline._wait_for_rate_limit("prices")
        frame = await data_pipeline._fetch_quote_history_frame(
            symbol=symbol, start=start.isoformat(), end=end.isoformat(),
            interval="1D", bypass_internal_retry=True,
        )
        rows = [row for row in _frame_to_rows(frame) if start <= row["tradeDate"].date() <= end]
        if not rows:
            error_type = EmptyEodAcquisition if isinstance(exc, EmptyEodAcquisition) else RuntimeError
            raise error_type("Free VCI returned no EOD bars in the requested window") from exc
        if any(str(row.get("price_source") or "").upper() not in
               {"VCI", "VNSTOCK_HISTORY:VCI", "VNSTOCK_VND:VCI"} for row in rows):
            raise RuntimeError("Free VCI returned no source-backed EOD bars") from exc
        summary["fallbacks"] += 1
        return rows, "vnstock-data"


async def run_mongo_eod_sync(
    *,
    symbols: list[str] | None = None,
    window_days: int = DEFAULT_WINDOW_DAYS,
) -> dict[str, Any]:
    """Refresh IQ listings, bounded financials, and a rolling EOD window."""
    service = get_mongo_market_data_service()
    summary = _summary()
    if not service.enabled:
        summary["failures"] = 1
        summary["failed"] += 1
        _error(summary, "configuration", RuntimeError("MongoDB is not configured"))
        logger.error("Mongo IQ sync unavailable: MongoDB is not configured")
        return _finish(summary)

    client = VietcapClient()
    window_days = max(1, min(int(window_days), MAX_WINDOW_DAYS))
    end = date.today()
    start = end - timedelta(days=window_days)
    explicit = sorted({str(s).strip().upper() for s in symbols or [] if s})
    trading_rows: list[dict[str, Any]] = []
    search_rows: list[dict[str, Any]] = []
    try:
        trading_rows = await asyncio.to_thread(client.get_all_symbols)
        search_rows = await asyncio.to_thread(client.get_company_search_bar)
        if not trading_rows or not search_rows:
            raise RuntimeError("Vietcap listing response is empty")
        summary["listings"] = await asyncio.to_thread(
            upsert_listing_rows, service._get_database(), trading_rows, search_rows,
            dry_run=False,
        )
        summary["structured_rows"] += await persist_vietcap_listings(trading_rows, search_rows)
    except Exception as exc:
        summary["structured_rows"] += getattr(exc, "persisted_rows", 0)
        summary["failures"] += 1
        summary["failed"] += 1
        _error(summary, "listings", exc)
        logger.error("Mongo IQ listing sync failed: %s", exc)

    metadata = {str(row.get("symbol") or "").upper(): row for row in trading_rows}
    search = {str(row.get("code") or "").upper(): row for row in search_rows}
    try:
        universe = explicit if symbols is not None else await _resolve_universe(service)
    except Exception as exc:
        summary["failures"] += 1
        summary["failed"] += 1
        _error(summary, "universe", exc)
        logger.error("Mongo IQ universe read failed: %s", exc)
        return _finish(summary)
    summary["expected"] = len(universe)
    if not universe:
        return _finish(summary)
    if symbols is None:
        for symbol in universe:
            metadata.setdefault(symbol, {"symbol": symbol, "type": "STOCK"})

    for symbol in universe:
        summary["attempted"] += 1
        try:
            rows, source = await _acquire_eod(
                client, symbol, start, end, metadata.get(symbol, {}).get("type"), summary,
            )
            summary["rows"] += await service.bulk_upsert_eod_prices(symbol, rows, source=source)
            if source == "vietcap" and str(metadata.get(symbol, {}).get("type") or "").upper() == "STOCK":
                summary["structured_rows"] += await persist_vietcap_prices(symbol, rows)
            summary["symbols"] += 1
            summary["succeeded"] += 1
        except Exception as exc:
            summary["structured_rows"] += getattr(exc, "persisted_rows", 0)
            summary["failures"] += 1
            summary["empty" if isinstance(exc, EmptyEodAcquisition) else "failed"] += 1
            _error(summary, "eod", exc, symbol)
            logger.error("Mongo IQ EOD sync failed for %s: %s", symbol, exc)

    def _financial_slice() -> list[str]:
        coll = service._get_collection("market_vnstock_premium_records")
        latest = {str(row["_id"]).upper(): row.get("updatedAt")
                  for row in coll.aggregate([
                      {"$match": {"source": "vietcap", "datasetGroup": "finance",
                                  "symbol": {"$in": universe}}},
                      {"$group": {"_id": "$symbol", "updatedAt": {"$max": "$updatedAt"}}},
                  ])}
        stocks = [symbol for symbol in universe
                  if str(metadata.get(symbol, {}).get("type") or "").upper() == "STOCK"]
        return sorted(stocks, key=lambda symbol: (
            str(latest.get(symbol) or ""), symbol,
        ))[:MAX_FINANCIAL_SYMBOLS]

    try:
        financial_symbols = await asyncio.to_thread(_financial_slice)
    except Exception as exc:
        summary["failures"] += 1
        summary["failed"] += 1
        _error(summary, "financial_schedule", exc)
        logger.error("Mongo IQ financial scheduling read failed: %s", exc)
        return _finish(summary)
    for symbol in financial_symbols:
        if str(metadata.get(symbol, {}).get("type") or "").upper() != "STOCK":
            continue
        try:
            try:
                records = await asyncio.to_thread(
                    sync_symbol_financials, service._get_database(), client, symbol,
                    com_type=search.get(symbol, {}).get("comTypeCode"), dry_run=False,
                )
                summary["financials"] += len(records)
            except FinancialAcquisitionPartial as exc:
                records = exc.records
                summary["financials"] += exc.mongo_rows
                summary["failures"] += 1
                summary["failed"] += 1
                _error(summary, "financial_acquisition", exc, symbol)
                logger.error("Mongo IQ financial acquisition incomplete for %s: %s", symbol, exc)
                if not records:
                    continue
            if not records:
                raise RuntimeError("Vietcap financial data unavailable")
            summary["structured_rows"] += await persist_vietcap_financials(records)
        except Exception as exc:
            summary["structured_rows"] += getattr(exc, "persisted_rows", 0)
            summary["failures"] += 1
            summary["failed"] += 1
            _error(summary, "financial", exc, symbol)
            logger.error("Mongo IQ financial sync failed for %s: %s", symbol, exc)
    return _finish(summary)


async def get_mongo_eod_catchup_inventory(
    *, symbols: list[str] | None = None, start: date = DEFAULT_HISTORY_START,
    end: date | None = None, window_days: int = MAX_WINDOW_DAYS,
) -> dict[str, Any]:
    """Provider-free inventory of unacquired windows, not missing sessions.

    Successful receipts cover only the requested acquisition windows. Existing
    bars alone cannot certify a window: it may contain internal historical gaps.
    A confirmed listing date excludes pre-listing windows; unknown dates do not.
    Only windows older than the incremental refresh window are acquired, so a
    newly discovered symbol's recent sessions stay with the incremental job.
    """
    end = end or date.today() - timedelta(days=DEFAULT_WINDOW_DAYS)
    if start > end:
        raise ValueError("Catchup start must not be after end")
    window_days = max(1, min(int(window_days), MAX_WINDOW_DAYS))
    service = get_mongo_market_data_service()
    if not service.enabled:
        raise RuntimeError("MongoDB is not configured")
    universe = (sorted({str(symbol).strip().upper() for symbol in symbols if symbol})
                if symbols is not None else await _resolve_universe(service))
    async with async_session_factory() as session:
        result = await session.execute(select(Stock.symbol, Stock.listing_date).where(
            Stock.symbol.in_(universe), Stock.is_active == 1,
            Stock.exchange.in_(("HOSE", "HNX", "UPCOM")),
        ))
        listing_dates = {str(symbol).upper(): listed for symbol, listed in result.all()}

    def read_inventory() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        receipts = service._get_collection(CATCHUP_RECEIPTS)
        acquired: dict[str, list[tuple[date, date]]] = {}
        last_attempted: dict[str, str] = {}
        retained = list(receipts.find({"symbol": {"$in": universe}}, {"_id": 0}))
        relevant = [receipt for receipt in retained
                    if date.fromisoformat(receipt["end"]) >= start
                    and date.fromisoformat(receipt["start"]) <= end]
        for receipt in relevant:
            attempted_at = _to_naive_datetime(receipt.get("updatedAt")) or datetime.min
            last_attempted[receipt["symbol"]] = max(
                last_attempted.get(receipt["symbol"], ""), attempted_at.isoformat(),
            )
            if receipt.get("status") == "succeeded":
                acquired.setdefault(receipt["symbol"], []).append((
                    date.fromisoformat(receipt["start"]), date.fromisoformat(receipt["end"]),
                ))
        inventory = []
        for symbol in universe:
            next_start = max(start, listing_dates.get(symbol) or start)
            for covered_start, covered_end in sorted(acquired.get(symbol, [])):
                if covered_start <= next_start <= covered_end:
                    next_start = covered_end + timedelta(days=1)
            inventory.append({"symbol": symbol,
                              "confirmed_stock": symbol in listing_dates,
                              "last_attempted_at": last_attempted.get(symbol),
                              "next_start": next_start.isoformat() if next_start <= end else None,
                              "next_end": min(next_start + timedelta(days=window_days - 1), end).isoformat()
                                          if next_start <= end else None})
        return inventory, relevant

    inventory, receipts = await asyncio.to_thread(read_inventory)
    pending = sum(row["next_start"] is not None for row in inventory)
    return {"expected": len(universe), "completed": len(universe) - pending,
            "pending": pending, "start": start.isoformat(), "end": end.isoformat(),
            "window_days": window_days, "symbols": inventory, "receipts": receipts,
            "receipt_counts": {status: sum(receipt.get("status") == status for receipt in receipts)
                               for status in ("succeeded", "empty", "failed")}}


async def run_mongo_eod_catchup(
    *, symbols: list[str] | None = None, start: date = DEFAULT_HISTORY_START,
    end: date | None = None, window_days: int = MAX_WINDOW_DAYS,
    max_symbols: int = MAX_CATCHUP_SYMBOLS,
) -> dict[str, Any]:
    """Acquire one oldest pending window per bounded symbol slice.

    Register separately from incremental refresh. Empty/failed windows retain
    their cursor and error receipt; a later run retries without skipping gaps.
    A successful receipt follows Mongo and SQL writes, including no-change
    natural-key upserts. No exchange-session completeness is inferred.
    """
    summary = _summary()
    try:
        inventory = await get_mongo_eod_catchup_inventory(
            symbols=symbols, start=start, end=end, window_days=window_days,
        )
    except Exception as exc:
        summary["failures"] += 1
        summary["failed"] += 1
        _error(summary, "catchup_inventory", exc)
        return _finish(summary)
    summary["expected"] = inventory["expected"]
    summary["completed"] = inventory["completed"]
    summary["pending"] = inventory["pending"]
    limit = max(1, min(int(max_symbols), MAX_CATCHUP_SYMBOLS))
    pending = sorted((row for row in inventory["symbols"] if row["next_start"]),
                     key=lambda row: (row["last_attempted_at"] is not None,
                                      row["last_attempted_at"] or "",
                                      row["next_start"], row["symbol"]))[:limit]
    if not pending:
        return _finish(summary)
    service = get_mongo_market_data_service()
    client = VietcapClient()
    try:
        await asyncio.to_thread(
            service._get_collection(CATCHUP_RECEIPTS).create_index,
            [("symbol", 1), ("start", 1), ("end", 1)], unique=True,
            name="uniq_symbol_acquisition_window",
        )
    except Exception as exc:
        summary["failures"] += 1
        summary["failed"] += 1
        _error(summary, "catchup_receipt_index", exc)
        return _finish(summary)
    for row in pending:
        symbol = row["symbol"]
        summary["attempted"] += 1
        receipt = {"symbol": symbol, "start": row["next_start"], "end": row["next_end"]}
        try:
            rows, source = await _acquire_eod(
                client, symbol, date.fromisoformat(row["next_start"]),
                date.fromisoformat(row["next_end"]),
                "STOCK" if row["confirmed_stock"] else None, summary, historical=True,
            )
            writes = await service.bulk_upsert_eod_prices(symbol, rows, source=source)
            summary["rows"] += writes
            if source == "vietcap" and row["confirmed_stock"]:
                summary["structured_rows"] += await persist_vietcap_prices(symbol, rows)
            await asyncio.to_thread(
                service._get_collection(CATCHUP_RECEIPTS).update_one, receipt,
                {"$set": {"status": "succeeded", "source": source,
                          "acquired_rows": len(rows), "written_rows": writes,
                          "updatedAt": datetime.now(UTC).replace(tzinfo=None),
                          "errors": [error for error in summary["errors"] if error["symbol"] == symbol]}},
                upsert=True,
            )
            summary["succeeded"] += 1
            summary["symbols"] += 1
            if row["next_end"] == inventory["end"]:
                summary["completed"] += 1
                summary["pending"] -= 1
        except Exception as exc:
            summary["structured_rows"] += getattr(exc, "persisted_rows", 0)
            summary["failures"] += 1
            status = "empty" if isinstance(exc, EmptyEodAcquisition) else "failed"
            summary[status] += 1
            _error(summary, "catchup_eod", exc, symbol)
            try:
                await asyncio.to_thread(
                    service._get_collection(CATCHUP_RECEIPTS).update_one, receipt,
                    {"$set": {"status": status,
                              "updatedAt": datetime.now(UTC).replace(tzinfo=None),
                              "errors": [error for error in summary["errors"] if error["symbol"] == symbol]}},
                    upsert=True,
                )
            except Exception as receipt_exc:
                _error(summary, "catchup_receipt", receipt_exc, symbol)
            logger.error("Mongo EOD catchup failed for %s: %s", symbol, exc)
    return _finish(summary)
