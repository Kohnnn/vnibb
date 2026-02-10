#!/usr/bin/env python3
"""
Resumable historical-price backfill for Sprint V34.

Features:
- top-symbol selection from latest screener snapshot
- chunked processing
- JSON checkpoint for resume/restart safety
- batch fallback to per-symbol retries
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from sqlalchemy import desc, func, select

from vnibb.core.database import async_session_maker
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models.stock import Stock
from vnibb.services.data_pipeline import DataPipeline

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


@dataclass
class BackfillCheckpoint:
    next_index: int
    total_symbols: int
    completed_symbols: int
    failed_symbols: list[str]
    updated_at: str


def load_checkpoint(path: Path) -> BackfillCheckpoint | None:
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return BackfillCheckpoint(
            next_index=int(payload.get("next_index", 0)),
            total_symbols=int(payload.get("total_symbols", 0)),
            completed_symbols=int(payload.get("completed_symbols", 0)),
            failed_symbols=[str(item).upper() for item in payload.get("failed_symbols", [])],
            updated_at=str(payload.get("updated_at", "")),
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to read checkpoint %s: %s", path, exc)
        return None


def save_checkpoint(path: Path, checkpoint: BackfillCheckpoint) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(asdict(checkpoint), indent=2), encoding="utf-8")


async def get_top_symbols(limit: int) -> list[str]:
    async with async_session_maker() as session:
        latest_date = await session.execute(select(func.max(ScreenerSnapshot.snapshot_date)))
        snapshot_date = latest_date.scalar()
        if snapshot_date:
            rows = await session.execute(
                select(ScreenerSnapshot.symbol)
                .where(ScreenerSnapshot.snapshot_date == snapshot_date)
                .order_by(desc(ScreenerSnapshot.market_cap))
                .limit(limit)
            )
            symbols = [row[0] for row in rows.fetchall() if row[0]]
            if symbols:
                return symbols

        fallback = await session.execute(
            select(Stock.symbol)
            .where(Stock.is_active == 1)
            .order_by(Stock.symbol.asc())
            .limit(limit)
        )
        return [row[0] for row in fallback.fetchall() if row[0]]


def chunked(items: list[str], size: int) -> list[list[str]]:
    return [items[i : i + size] for i in range(0, len(items), max(1, size))]


async def run_backfill(
    years: int,
    limit: int,
    batch_size: int,
    sleep_seconds: float,
    checkpoint_file: Path,
    reset_checkpoint: bool,
) -> int:
    symbols = await get_top_symbols(limit)
    if not symbols:
        logger.error("No symbols found for historical backfill.")
        return 1

    if reset_checkpoint and checkpoint_file.exists():
        checkpoint_file.unlink()

    checkpoint = load_checkpoint(checkpoint_file) or BackfillCheckpoint(
        next_index=0,
        total_symbols=len(symbols),
        completed_symbols=0,
        failed_symbols=[],
        updated_at=datetime.now(UTC).isoformat(),
    )

    end_date = date.today()
    start_date = end_date - timedelta(days=years * 365)
    pipeline = DataPipeline()

    all_batches = chunked(symbols, batch_size)
    start_batch = min(checkpoint.next_index, len(all_batches))

    logger.info(
        "Starting historical backfill: symbols=%s years=%s batches=%s start_batch=%s",
        len(symbols),
        years,
        len(all_batches),
        start_batch,
    )

    for batch_idx in range(start_batch, len(all_batches)):
        batch_symbols = all_batches[batch_idx]
        logger.info(
            "Batch %s/%s (%s symbols): %s",
            batch_idx + 1,
            len(all_batches),
            len(batch_symbols),
            ", ".join(batch_symbols[:6]) + ("..." if len(batch_symbols) > 6 else ""),
        )

        try:
            await pipeline.sync_daily_prices(
                symbols=batch_symbols,
                start_date=start_date,
                end_date=end_date,
            )
            checkpoint.completed_symbols += len(batch_symbols)
        except Exception as batch_exc:  # noqa: BLE001
            logger.warning("Batch failed, falling back to per-symbol retry: %s", batch_exc)
            for symbol in batch_symbols:
                try:
                    await pipeline.sync_daily_prices(
                        symbols=[symbol],
                        start_date=start_date,
                        end_date=end_date,
                    )
                    checkpoint.completed_symbols += 1
                except Exception as symbol_exc:  # noqa: BLE001
                    logger.warning("Symbol backfill failed for %s: %s", symbol, symbol_exc)
                    checkpoint.failed_symbols.append(symbol)

        checkpoint.next_index = batch_idx + 1
        checkpoint.updated_at = datetime.now(UTC).isoformat()
        save_checkpoint(checkpoint_file, checkpoint)

        if sleep_seconds > 0:
            await asyncio.sleep(sleep_seconds)

    logger.info(
        "Historical backfill completed: completed=%s failed=%s checkpoint=%s",
        checkpoint.completed_symbols,
        len(checkpoint.failed_symbols),
        checkpoint_file,
    )
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Resumable historical backfill for Sprint V34")
    parser.add_argument("--years", type=int, default=5)
    parser.add_argument("--limit", type=int, default=200)
    parser.add_argument("--batch-size", type=int, default=25)
    parser.add_argument("--sleep-seconds", type=float, default=0.5)
    parser.add_argument(
        "--checkpoint-file",
        type=Path,
        default=Path("scripts/v34_backfill_historical_checkpoint.json"),
    )
    parser.add_argument("--reset-checkpoint", action="store_true")
    return parser.parse_args()


async def _main() -> int:
    args = parse_args()
    return await run_backfill(
        years=args.years,
        limit=args.limit,
        batch_size=args.batch_size,
        sleep_seconds=args.sleep_seconds,
        checkpoint_file=args.checkpoint_file,
        reset_checkpoint=args.reset_checkpoint,
    )


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main()))
