"""
Full-market OHLCV backfill (HOSE / HNX / UPCOM) into MongoDB + PostgreSQL.

QA-v3 Phase F: Backfill 5 years of EOD price history for every listed
ticker so Quant widgets (Seasonality, Sortino Monthly, Drawdown Recovery,
Risk Dashboard) have a meaningful 5Y window. Today most VN tickers only
have data from 2024-01-02 forward.

Source priority:
  1. vnstock_data Golden Sponsor (premium, fast bulk fetch)
  2. vnstock free tier (slower per-symbol)
  3. CafeF/VietStock scraper (last resort, manual)

Targets:
  - PostgreSQL `stock_prices` (canonical)
  - MongoDB `quote.price_history` (analytics-ready)

Usage::

    python -m vnibb.scripts.backfill_ohlcv_full --start 2020-01-01 --concurrency 8
    python -m vnibb.scripts.backfill_ohlcv_full --resume
    python -m vnibb.scripts.backfill_ohlcv_full --symbols VCI,VNM,FPT
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Iterable

# Ensure the script is runnable both via `python -m vnibb.scripts.*` and
# direct invocation when launched from the apps/api root.
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from vnibb.core.database import async_session_maker
from vnibb.models.stock import Stock, StockPrice

logger = logging.getLogger("ohlcv_backfill")


@dataclass
class BackfillProgress:
    started_at: str
    total: int
    completed: list[str] = field(default_factory=list)
    failed: list[dict[str, str]] = field(default_factory=list)
    last_symbol: str | None = None

    @property
    def completed_set(self) -> set[str]:
        return set(self.completed)


def _progress_path() -> Path:
    return Path(os.environ.get("OHLCV_BACKFILL_STATE", "/tmp/ohlcv_backfill_progress.json"))


def _load_progress() -> BackfillProgress | None:
    path = _progress_path()
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text())
        return BackfillProgress(
            started_at=str(data.get("started_at") or ""),
            total=int(data.get("total") or 0),
            completed=list(data.get("completed") or []),
            failed=list(data.get("failed") or []),
            last_symbol=data.get("last_symbol"),
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not parse progress file: %s", exc)
        return None


def _save_progress(progress: BackfillProgress) -> None:
    path = _progress_path()
    try:
        path.write_text(
            json.dumps(
                {
                    "started_at": progress.started_at,
                    "total": progress.total,
                    "completed": progress.completed,
                    "failed": progress.failed,
                    "last_symbol": progress.last_symbol,
                },
                indent=2,
            )
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to write progress: %s", exc)


async def _list_target_symbols() -> list[tuple[int, str]]:
    """Return all listed (stock_id, symbol) tuples on HOSE/HNX/UPCOM."""

    async with async_session_maker() as session:
        result = await session.execute(
            select(Stock.id, Stock.symbol, Stock.exchange).order_by(Stock.symbol.asc())
        )
        rows = result.all()
    out: list[tuple[int, str]] = []
    for stock_id, symbol, exchange in rows:
        if not symbol:
            continue
        sym = symbol.upper()
        ex = (exchange or "").upper()
        if ex not in {"HOSE", "HNX", "UPCOM"} and ex != "":
            continue
        out.append((int(stock_id), sym))
    return out


def _fetch_premium(symbol: str, start_date: date, end_date: date) -> list[dict[str, Any]] | None:
    """Use vnstock_data Golden Sponsor to fetch daily OHLCV.

    Returns a list of dicts with keys (time, open, high, low, close, volume).
    Returns None on failure so the caller can fall back to vnstock free.
    """

    try:
        from vnstock_data.api.history import History  # type: ignore

        history = History(symbol=symbol)
        df = history.daily(
            start=start_date.isoformat(),
            end=end_date.isoformat(),
        )
        if df is None or len(df) == 0:
            return []
        # Normalize column names regardless of provider casing.
        df = df.rename(columns={c: c.lower() for c in df.columns})
        # Provider may name the date column 'time', 'date', or use a DatetimeIndex.
        if "time" not in df.columns:
            if "date" in df.columns:
                df = df.rename(columns={"date": "time"})
            else:
                df = df.reset_index().rename(columns={df.index.name or "index": "time"})
        records: list[dict[str, Any]] = []
        for _, row in df.iterrows():
            t = row.get("time")
            if hasattr(t, "isoformat"):
                t = t.isoformat()
            elif hasattr(t, "strftime"):
                t = t.strftime("%Y-%m-%d")
            records.append(
                {
                    "time": str(t)[:10],
                    "open": float(row["open"]) if "open" in row else None,
                    "high": float(row["high"]) if "high" in row else None,
                    "low": float(row["low"]) if "low" in row else None,
                    "close": float(row["close"]) if "close" in row else None,
                    "volume": int(row["volume"]) if "volume" in row else 0,
                }
            )
        return records
    except Exception as exc:  # noqa: BLE001
        logger.debug("Premium fetch failed for %s: %s", symbol, exc)
        return None


def _fetch_free(symbol: str, start_date: date, end_date: date) -> list[dict[str, Any]] | None:
    try:
        from vnstock import Vnstock  # type: ignore

        stock = Vnstock().stock(symbol=symbol, source="VCI")
        df = stock.quote.history(
            start=start_date.isoformat(),
            end=end_date.isoformat(),
        )
        if df is None or len(df) == 0:
            return []
        df = df.rename(columns={c: c.lower() for c in df.columns})
        if "time" not in df.columns and "date" in df.columns:
            df = df.rename(columns={"date": "time"})
        records: list[dict[str, Any]] = []
        for _, row in df.iterrows():
            t = row.get("time")
            if hasattr(t, "isoformat"):
                t = t.isoformat()
            elif hasattr(t, "strftime"):
                t = t.strftime("%Y-%m-%d")
            records.append(
                {
                    "time": str(t)[:10],
                    "open": float(row["open"]) if "open" in row else None,
                    "high": float(row["high"]) if "high" in row else None,
                    "low": float(row["low"]) if "low" in row else None,
                    "close": float(row["close"]) if "close" in row else None,
                    "volume": int(row["volume"]) if "volume" in row else 0,
                }
            )
        return records
    except Exception as exc:  # noqa: BLE001
        logger.debug("Free fetch failed for %s: %s", symbol, exc)
        return None


async def _persist_postgres(stock_id: int, symbol: str, records: list[dict[str, Any]]) -> int:
    """ON CONFLICT DO UPDATE so re-runs are idempotent."""

    if not records:
        return 0
    inserted = 0
    async with async_session_maker() as session:
        for record in records:
            t = record.get("time")
            if not t:
                continue
            try:
                trade_date = datetime.strptime(str(t)[:10], "%Y-%m-%d").date()
            except ValueError:
                continue
            row = {
                "stock_id": stock_id,
                "symbol": symbol,
                "time": trade_date,
                "open": record["open"],
                "high": record["high"],
                "low": record["low"],
                "close": record["close"],
                "volume": int(record.get("volume") or 0),
                "interval": "1D",
                "source": "ohlcv_backfill_full",
            }
            stmt = (
                pg_insert(StockPrice)
                .values(**row)
                .on_conflict_do_update(
                    index_constraint="uq_stock_price_symbol_time_interval",
                    set_={
                        "open": row["open"],
                        "high": row["high"],
                        "low": row["low"],
                        "close": row["close"],
                        "volume": row["volume"],
                    },
                )
            )
            await session.execute(stmt)
            inserted += 1
        await session.commit()
    return inserted


async def _persist_mongo(symbol: str, records: list[dict[str, Any]]) -> int:
    """Write to Mongo `quote.price_history` collection if Mongo is configured."""

    if not records:
        return 0
    try:
        from vnibb.services.mongo_market_data_service import get_mongo_market_data_service
    except Exception:
        return 0

    try:
        service = await get_mongo_market_data_service()
    except Exception:
        return 0
    if service is None or not getattr(service, "available", True):
        return 0

    try:
        collection = service.get_collection("price_history")
    except Exception:
        return 0
    if collection is None:
        return 0

    docs = []
    for record in records:
        t = record.get("time")
        if not t:
            continue
        docs.append(
            {
                "symbol": symbol,
                "date": str(t)[:10],
                "open": record.get("open"),
                "high": record.get("high"),
                "low": record.get("low"),
                "close": record.get("close"),
                "volume": int(record.get("volume") or 0),
                "source": "ohlcv_backfill_full",
            }
        )
    if not docs:
        return 0

    try:
        from pymongo import UpdateOne  # type: ignore

        ops = [
            UpdateOne(
                {"symbol": doc["symbol"], "date": doc["date"]},
                {"$set": doc},
                upsert=True,
            )
            for doc in docs
        ]
        result = await collection.bulk_write(ops, ordered=False)
        return int(result.upserted_count or 0) + int(result.modified_count or 0)
    except Exception as exc:  # noqa: BLE001
        logger.debug("Mongo bulk_write failed for %s: %s", symbol, exc)
        return 0


async def _process_symbol(
    stock_id: int,
    symbol: str,
    start_date: date,
    end_date: date,
) -> tuple[int, int, str | None]:
    """Run premium → free fallback. Returns (postgres_n, mongo_n, error)."""

    records = await asyncio.to_thread(_fetch_premium, symbol, start_date, end_date)
    if records is None:
        records = await asyncio.to_thread(_fetch_free, symbol, start_date, end_date)
    if records is None:
        return 0, 0, "fetch_failed"
    if not records:
        return 0, 0, "no_data"

    pg_n = await _persist_postgres(stock_id, symbol, records)
    mongo_n = await _persist_mongo(symbol, records)
    return pg_n, mongo_n, None


async def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--start",
        default="2020-01-01",
        help="Start date YYYY-MM-DD (default 2020-01-01).",
    )
    parser.add_argument(
        "--end",
        default=None,
        help="End date YYYY-MM-DD (default today).",
    )
    parser.add_argument(
        "--symbols",
        default=None,
        help="Comma-separated symbol list. Defaults to every listed stock.",
    )
    parser.add_argument("--concurrency", type=int, default=8)
    parser.add_argument("--resume", action="store_true", help="Skip symbols in progress file.")
    parser.add_argument("--limit", type=int, default=None, help="Stop after N symbols.")
    parser.add_argument(
        "--rate-limit-rps",
        type=float,
        default=float(os.environ.get("VNSTOCK_RATE_LIMIT_RPS", "30") or 30),
    )
    args = parser.parse_args(list(argv) if argv is not None else None)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    start_date = datetime.strptime(args.start, "%Y-%m-%d").date()
    end_date = datetime.strptime(args.end, "%Y-%m-%d").date() if args.end else date.today()

    if args.symbols:
        target = [
            (i, s.strip().upper())
            for i, s in enumerate(args.symbols.split(",")) if s.strip()
        ]
    else:
        target = await _list_target_symbols()

    if args.limit:
        target = target[: args.limit]

    progress = _load_progress() if args.resume else None
    completed = set(progress.completed) if progress else set()
    if progress is None:
        progress = BackfillProgress(
            started_at=datetime.utcnow().isoformat(),
            total=len(target),
        )

    pending = [(sid, sym) for sid, sym in target if sym not in completed]
    logger.info(
        "Starting backfill: %d total, %d pending, range %s..%s, concurrency=%d",
        len(target),
        len(pending),
        start_date,
        end_date,
        args.concurrency,
    )

    semaphore = asyncio.Semaphore(args.concurrency)
    rate_window = 1.0 / max(args.rate_limit_rps, 1.0)

    async def _runner(stock_id: int, symbol: str) -> None:
        async with semaphore:
            try:
                pg_n, mongo_n, err = await _process_symbol(
                    stock_id, symbol, start_date, end_date
                )
                if err:
                    progress.failed.append({"symbol": symbol, "error": err})
                    logger.warning("FAIL %s: %s", symbol, err)
                else:
                    progress.completed.append(symbol)
                    logger.info(
                        "OK %s: pg=%d mongo=%d (%d remaining)",
                        symbol,
                        pg_n,
                        mongo_n,
                        len(pending) - len(progress.completed),
                    )
            except Exception as exc:  # noqa: BLE001
                progress.failed.append({"symbol": symbol, "error": str(exc)[:240]})
                logger.exception("UNHANDLED %s", symbol)
            finally:
                progress.last_symbol = symbol
                _save_progress(progress)
            await asyncio.sleep(rate_window)

    await asyncio.gather(*(_runner(sid, sym) for sid, sym in pending))

    logger.info(
        "Backfill complete: completed=%d failed=%d",
        len(progress.completed),
        len(progress.failed),
    )
    _save_progress(progress)
    return 0 if not progress.failed else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
