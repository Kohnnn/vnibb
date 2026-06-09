"""Scheduled daily writer for the canonical Mongo ``market_prices_eod`` corpus.

Background
----------
Before this job existed, ``market_prices_eod`` was only ever written by
operator-run backfill scripts (``scripts/backfill_mongo_vnstock_*.py``). Nothing
in the scheduler advanced it, so the collection stayed frozen at whatever date
the last manual backfill produced while the Postgres ``StockPrice`` table kept
updating daily. Since Mongo ``vnibb-market`` is the canonical source for the
price/history and (via fallback) market-wide widgets, that froze large parts of
the dashboard one trading day behind reality.

This job closes the gap: after the Postgres daily sync and nightly backfill have
run, it fetches a short rolling window of EOD bars for the symbols already
present in ``market_prices_eod`` and upserts them through
``MongoMarketDataService.bulk_upsert_eod_prices`` (same db-name/connection as the
reads, keyed on ``(symbol, tradeDate, source)`` so it is idempotent and never
duplicates bars).

It reuses ``data_pipeline._fetch_quote_history_frame`` (the healthy KBS->VCI
source-fallback fetcher) and the shared ``prices`` rate limiter so it respects
the same vnstock budget as every other sync.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timedelta
from typing import Any

from vnibb.services.data_pipeline import data_pipeline
from vnibb.services.mongo_market_data_service import get_mongo_market_data_service

logger = logging.getLogger(__name__)

# Rolling catch-up window. Long enough to self-heal across a long weekend or a
# single missed run, short enough to stay cheap for the full universe.
DEFAULT_WINDOW_DAYS = 7
# Hard ceiling so a misconfiguration can never launch an unbounded full-history
# refetch of the entire universe inside the scheduler.
MAX_WINDOW_DAYS = 30


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
                "open": _coerce_float(record.get("open")),
                "high": _coerce_float(record.get("high")),
                "low": _coerce_float(record.get("low")),
                "close": _coerce_float(record.get("close")),
                "volume": _coerce_int(record.get("volume")),
                "value": _coerce_float(record.get("value")),
            }
        )
    return rows


async def _resolve_universe(service: Any) -> list[str]:
    """Distinct symbols already tracked in ``market_prices_eod``.

    Restricting to symbols already in the collection keeps the daily job aligned
    with the backfilled corpus and avoids fanning out to delisted/unknown
    tickers. Falls back to an empty list (job no-ops) if the read fails.
    """

    def _read() -> list[str]:
        coll = service._get_collection("market_prices_eod")  # noqa: SLF001 - same module family
        return [str(sym).upper() for sym in coll.distinct("symbol") if sym]

    try:
        symbols = await asyncio.to_thread(_read)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Mongo EOD sync: universe read failed: %s", exc)
        return []
    return sorted(dict.fromkeys(symbols))


async def run_mongo_eod_sync(
    *,
    symbols: list[str] | None = None,
    window_days: int = DEFAULT_WINDOW_DAYS,
) -> dict[str, int]:
    """Refresh recent EOD bars for the Mongo universe.

    Returns a summary dict ``{"symbols": n, "rows": m, "failures": k}`` so the
    scheduler log and tests can assert progress.
    """

    service = get_mongo_market_data_service()
    if not service.enabled:
        logger.warning("Mongo EOD sync skipped: MongoDB analytical source not configured")
        return {"symbols": 0, "rows": 0, "failures": 0}

    window_days = max(1, min(int(window_days), MAX_WINDOW_DAYS))
    end = date.today()
    start = end - timedelta(days=window_days)
    start_str = start.strftime("%Y-%m-%d")
    end_str = end.strftime("%Y-%m-%d")

    if symbols:
        universe = sorted(dict.fromkeys(str(s).upper() for s in symbols if s))
    else:
        universe = await _resolve_universe(service)

    if not universe:
        logger.warning("Mongo EOD sync: empty universe, nothing to do")
        return {"symbols": 0, "rows": 0, "failures": 0}

    logger.info(
        "Mongo EOD sync: %d symbols, window %s -> %s",
        len(universe),
        start_str,
        end_str,
    )

    total_rows = 0
    failures = 0
    processed = 0
    for symbol in universe:
        try:
            await data_pipeline._wait_for_rate_limit("prices")  # noqa: SLF001 - shared limiter
            frame = await data_pipeline._fetch_quote_history_frame(  # noqa: SLF001
                symbol=symbol,
                start=start_str,
                end=end_str,
                interval="1D",
                bypass_internal_retry=True,
            )
            rows = _frame_to_rows(frame)
            if not rows:
                continue
            written = await service.bulk_upsert_eod_prices(symbol, rows)
            total_rows += written
            processed += 1
        except Exception as exc:  # noqa: BLE001 - one symbol must not abort the run
            failures += 1
            logger.debug("Mongo EOD sync failed for %s: %s", symbol, exc)

    logger.info(
        "Mongo EOD sync complete: %d/%d symbols refreshed, %d rows upserted, %d failures",
        processed,
        len(universe),
        total_rows,
        failures,
    )
    return {"symbols": processed, "rows": total_rows, "failures": failures}
