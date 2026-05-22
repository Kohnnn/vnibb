#!/usr/bin/env python3
"""In-process technical analysis parity probe.

Calls the TA service for every active symbol on the daily timeframe and
buckets results by status. Bypasses the FastAPI rate limiter that polluted
prior HTTP-based parity attempts.

Run from the monorepo root::

    python -m apps.api.scripts.technical_parity --limit 100

Outputs::

    output/technical_parity_<timestamp>.csv
    output/technical_parity_<timestamp>.summary.json
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import logging
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import select

from vnibb.core.database import async_session_maker
from vnibb.models.stock import Stock
from vnibb.services.technical_analysis import get_ta_service

logger = logging.getLogger("technical_parity")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="In-process technical analysis parity probe")
    parser.add_argument("--symbols", default="ALL")
    parser.add_argument("--timeframe", default="D")
    parser.add_argument("--lookback", type=int, default=200)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument("--output-dir", default="output")
    return parser.parse_args()


async def load_symbols(symbols_arg: str, limit: int) -> list[str]:
    if symbols_arg.strip().upper() != "ALL":
        symbols = [s.strip().upper() for s in symbols_arg.split(",") if s.strip()]
        return list(dict.fromkeys(symbols))[:limit] if limit > 0 else list(dict.fromkeys(symbols))

    async with async_session_maker() as session:
        rows = await session.execute(select(Stock.symbol).where(Stock.is_active == 1))
        symbols = [str(row[0]).strip().upper() for row in rows.fetchall() if row[0]]

    deduped = list(dict.fromkeys(symbols))
    return deduped[:limit] if limit > 0 else deduped


async def probe_symbol(symbol: str, timeframe: str, lookback: int) -> dict[str, Any]:
    started = datetime.now(UTC)
    service = get_ta_service()
    try:
        result = await service.get_full_technical_analysis(
            symbol=symbol,
            timeframe=timeframe,
            lookback_days=lookback,
        )
        data_quality = result.get("data_quality") or {}
        issues = data_quality.get("issues") or []
        bars = data_quality.get("bars")
        return {
            "symbol": symbol,
            "timeframe": timeframe,
            "bars": bars if bars is not None else 0,
            "first_bar_date": data_quality.get("first_bar_date") or "",
            "last_bar_date": data_quality.get("last_bar_date") or "",
            "issue_count": len(issues),
            "issues": "|".join(str(issue) for issue in issues),
            "has_signals": bool(result.get("signals")),
            "error": "",
            "duration_ms": int((datetime.now(UTC) - started).total_seconds() * 1000),
        }
    except Exception as exc:  # pylint: disable=broad-except
        logger.warning("[%s/%s] %s", symbol, timeframe, exc)
        return {
            "symbol": symbol,
            "timeframe": timeframe,
            "bars": 0,
            "first_bar_date": "",
            "last_bar_date": "",
            "issue_count": 0,
            "issues": "",
            "has_signals": False,
            "error": str(exc),
            "duration_ms": int((datetime.now(UTC) - started).total_seconds() * 1000),
        }


async def main() -> int:
    args = parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

    symbols = await load_symbols(args.symbols, args.limit)
    if not symbols:
        logger.warning("No symbols to probe.")
        return 0

    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    csv_path = output_dir / f"technical_parity_{timestamp}.csv"
    summary_path = output_dir / f"technical_parity_{timestamp}.summary.json"

    semaphore = asyncio.Semaphore(max(1, args.concurrency))

    async def guarded(symbol: str) -> dict[str, Any]:
        async with semaphore:
            return await probe_symbol(symbol, args.timeframe, args.lookback)

    started_at = datetime.now(UTC)
    logger.info(
        "Probing %d symbols on timeframe %s (concurrency=%d)",
        len(symbols),
        args.timeframe,
        args.concurrency,
    )

    rows: list[dict[str, Any]] = []
    for batch_start in range(0, len(symbols), 50):
        batch = symbols[batch_start : batch_start + 50]
        results = await asyncio.gather(*(guarded(s) for s in batch))
        rows.extend(results)
        logger.info(
            "Progress: %d / %d symbols",
            min(batch_start + len(batch), len(symbols)),
            len(symbols),
        )

    fieldnames = [
        "symbol",
        "timeframe",
        "bars",
        "first_bar_date",
        "last_bar_date",
        "issue_count",
        "issues",
        "has_signals",
        "error",
        "duration_ms",
    ]
    with csv_path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    issue_buckets: dict[str, int] = {}
    for row in rows:
        if not row["issues"]:
            continue
        for issue in row["issues"].split("|"):
            issue_buckets[issue] = issue_buckets.get(issue, 0) + 1

    summary = {
        "total_symbols": len(rows),
        "symbols_with_signals": sum(1 for r in rows if r["has_signals"]),
        "symbols_with_errors": sum(1 for r in rows if r["error"]),
        "symbols_with_issues": sum(1 for r in rows if r["issue_count"] > 0),
        "median_bars": sorted(r["bars"] for r in rows)[len(rows) // 2] if rows else 0,
        "issue_buckets": dict(sorted(issue_buckets.items(), key=lambda kv: -kv[1])),
        "started_at": started_at.isoformat(),
        "completed_at": datetime.now(UTC).isoformat(),
    }
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    logger.info("Wrote %s", csv_path)
    logger.info("Wrote %s", summary_path)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
