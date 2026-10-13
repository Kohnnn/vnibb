"""Bounded recurring Vietcap-primary Mongo and PostgreSQL ingestion.

Listings refresh once per run; recent EOD refreshes the tracked stock universe.
The oldest 50 IQ financial symbols refresh per run so a daily job cannot trigger
an unbounded full-history financial sweep. Free vnstock VCI fills EOD only when
the public Vietcap chart is unavailable. All writes preserve source natural keys.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timedelta
from typing import Any

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
    """Read the tracked universe; database failure must not become an empty run."""

    def _read() -> list[str]:
        coll = service._get_collection("market_prices_eod")  # noqa: SLF001 - same module family
        return [str(sym).upper() for sym in coll.distinct("symbol") if sym]

    symbols = await asyncio.to_thread(_read)
    return sorted(dict.fromkeys(symbols))


async def run_mongo_eod_sync(
    *,
    symbols: list[str] | None = None,
    window_days: int = DEFAULT_WINDOW_DAYS,
) -> dict[str, int]:
    """Refresh IQ listings, bounded financials, and a rolling EOD window."""
    service = get_mongo_market_data_service()
    summary = {"symbols": 0, "rows": 0, "failures": 0,
               "listings": 0, "financials": 0, "fallbacks": 0,
               "primary_failures": 0, "structured_rows": 0}
    if not service.enabled:
        summary["failures"] = 1
        logger.error("Mongo IQ sync unavailable: MongoDB is not configured")
        return summary

    client = VietcapClient()
    window_days = max(1, min(int(window_days), MAX_WINDOW_DAYS))
    end = date.today()
    start = end - timedelta(days=window_days)
    explicit = sorted({str(s).upper() for s in symbols or [] if s})
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
        logger.error("Mongo IQ listing sync failed: %s", exc)

    metadata = {str(row.get("symbol") or "").upper(): row for row in trading_rows}
    search = {str(row.get("code") or "").upper(): row for row in search_rows}
    try:
        universe = explicit or await _resolve_universe(service)
    except Exception as exc:
        summary["failures"] += 1
        logger.error("Mongo IQ universe read failed: %s", exc)
        return summary
    if not universe:
        universe = sorted(symbol for symbol, row in metadata.items()
                          if symbol and str(row.get("type") or "").upper() == "STOCK")
    if not universe:
        summary["failures"] += 1
        logger.error("Mongo IQ sync unavailable: empty universe")
        return summary

    for symbol in universe:
        try:
            source = "vietcap"
            try:
                raw = await asyncio.to_thread(client.get_ohlc, symbol,
                                               count_back=window_days + 1)
                rows = ohlc_rows_from_gap_chart(
                    symbol, raw, instrument_type=metadata.get(symbol, {}).get("type"),
                ) if raw else []
                rows = [row for row in rows if start <= row["tradeDate"].date() <= end]
                if not rows:
                    raise RuntimeError("Vietcap returned no EOD bars in the requested window")
            except Exception as exc:
                summary["primary_failures"] += 1
                logger.warning("Vietcap EOD unavailable for %s: %s", symbol, exc)
                if str(metadata.get(symbol, {}).get("type") or "").upper() != "STOCK":
                    raise RuntimeError("Free VCI fallback requires a confirmed stock listing") from exc
                await data_pipeline._wait_for_rate_limit("prices")
                frame = await data_pipeline._fetch_quote_history_frame(
                    symbol=symbol, start=start.isoformat(), end=end.isoformat(),
                    interval="1D", bypass_internal_retry=True,
                )
                rows = _frame_to_rows(frame)
                if not rows or any(str(row.get("price_source") or "").upper() not in
                                   {"VCI", "VNSTOCK_HISTORY:VCI", "VNSTOCK_VND:VCI"}
                                   for row in rows):
                    raise RuntimeError("Free VCI returned no source-backed EOD bars") from exc
                source = "vnstock-data"
                summary["fallbacks"] += 1
            summary["rows"] += await service.bulk_upsert_eod_prices(symbol, rows, source=source)
            if source == "vietcap" and str(metadata.get(symbol, {}).get("type") or "").upper() == "STOCK":
                summary["structured_rows"] += await persist_vietcap_prices(symbol, rows)
            summary["symbols"] += 1
        except Exception as exc:
            summary["structured_rows"] += getattr(exc, "persisted_rows", 0)
            summary["failures"] += 1
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
        logger.error("Mongo IQ financial scheduling read failed: %s", exc)
        return summary
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
                logger.error("Mongo IQ financial acquisition incomplete for %s: %s", symbol, exc)
                if not records:
                    continue
            if not records:
                raise RuntimeError("Vietcap financial data unavailable")
            summary["structured_rows"] += await persist_vietcap_financials(records)
        except Exception as exc:
            summary["structured_rows"] += getattr(exc, "persisted_rows", 0)
            summary["failures"] += 1
            logger.error("Mongo IQ financial sync failed for %s: %s", symbol, exc)
    logger.info("Mongo IQ sync outcome: %s", summary)
    return summary
