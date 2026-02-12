#!/usr/bin/env python3
"""
Resumable historical-price backfill for Sprint V34.

Features:
- top-symbol selection from latest screener snapshot
- chunked processing
- JSON checkpoint for resume/restart safety
- batch fallback to per-symbol retries
- optional time-boxing (`--max-runtime-minutes`, `--max-batches`) for fast feedback runs
- hard-timeout watchdog (`--hard-timeout-grace-seconds`) to force exit if runtime hangs
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import threading
import time
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from sqlalchemy import func, select

from vnibb.core.database import async_session_maker
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models.stock import Stock, StockPrice
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
            non_null_market_caps = await session.execute(
                select(func.count())
                .select_from(ScreenerSnapshot)
                .where(
                    ScreenerSnapshot.snapshot_date == snapshot_date,
                    ScreenerSnapshot.market_cap.is_not(None),
                )
            )
            non_null_count = int(non_null_market_caps.scalar() or 0)
            rows = await session.execute(
                select(ScreenerSnapshot.symbol)
                .where(
                    ScreenerSnapshot.snapshot_date == snapshot_date,
                    ScreenerSnapshot.market_cap.is_not(None),
                )
                .order_by(ScreenerSnapshot.market_cap.desc().nullslast())
                .limit(limit)
            )
            symbols = [row[0] for row in rows.fetchall() if row[0]]
            if non_null_count >= max(20, limit // 2) and symbols:
                return symbols

        recent_cutoff = date.today() - timedelta(days=60)
        liquidity_rows = await session.execute(
            select(StockPrice.symbol)
            .where(StockPrice.interval == "1D", StockPrice.time >= recent_cutoff)
            .group_by(StockPrice.symbol)
            .order_by(
                func.avg(StockPrice.close * StockPrice.volume).desc().nullslast(),
                func.max(StockPrice.time).desc(),
                StockPrice.symbol.asc(),
            )
            .limit(limit)
        )
        liquidity_symbols = [row[0] for row in liquidity_rows.fetchall() if row[0]]
        if liquidity_symbols:
            return liquidity_symbols

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
    max_runtime_minutes: float | None,
    max_batches: int | None,
    call_timeout_seconds: float | None,
    hard_timeout_grace_seconds: float,
    report_json: Path | None,
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
    run_started_at = time.monotonic()
    processed_batches = 0
    stop_reason = "completed"

    def write_report(reason: str, elapsed_seconds: float) -> None:
        if report_json is None:
            return

        report = {
            "generated_at": datetime.now(UTC).isoformat(),
            "years": years,
            "limit": limit,
            "batch_size": batch_size,
            "max_runtime_minutes": max_runtime_minutes,
            "max_batches": max_batches,
            "call_timeout_seconds": call_timeout_seconds,
            "hard_timeout_grace_seconds": hard_timeout_grace_seconds,
            "processed_batches": processed_batches,
            "elapsed_seconds": elapsed_seconds,
            "stop_reason": reason,
            "checkpoint_file": str(checkpoint_file),
            "checkpoint": asdict(checkpoint),
        }
        report_json.parent.mkdir(parents=True, exist_ok=True)
        report_json.write_text(json.dumps(report, indent=2), encoding="utf-8")
        logger.info("Wrote report: %s", report_json)

    hard_timeout_seconds: float | None = None
    watchdog_timer: threading.Timer | None = None
    if max_runtime_minutes is not None and max_runtime_minutes > 0:
        hard_timeout_seconds = (max_runtime_minutes * 60) + max(0.0, hard_timeout_grace_seconds)

        def _force_exit() -> None:
            forced_elapsed = round(time.monotonic() - run_started_at, 2)
            checkpoint.updated_at = datetime.now(UTC).isoformat()
            save_checkpoint(checkpoint_file, checkpoint)
            write_report("hard_timeout_forced_exit", forced_elapsed)
            logger.error(
                "Hard timeout reached after %.2fs (max_runtime_minutes=%s, grace=%ss). Forcing process exit.",
                forced_elapsed,
                max_runtime_minutes,
                hard_timeout_grace_seconds,
            )
            os._exit(124)

        watchdog_timer = threading.Timer(hard_timeout_seconds, _force_exit)
        watchdog_timer.daemon = True
        watchdog_timer.start()

    def remaining_runtime_seconds() -> float | None:
        if max_runtime_minutes is None or max_runtime_minutes <= 0:
            return None
        return (max_runtime_minutes * 60) - (time.monotonic() - run_started_at)

    def compute_timeout() -> float | None:
        timeout: float | None = (
            call_timeout_seconds if call_timeout_seconds and call_timeout_seconds > 0 else None
        )
        remaining = remaining_runtime_seconds()
        if remaining is not None:
            if remaining <= 0:
                return 0
            timeout = min(timeout, remaining) if timeout is not None else remaining
        return timeout

    async def run_sync(target_symbols: list[str]) -> None:
        timeout = compute_timeout()
        if timeout is not None:
            if timeout <= 0:
                raise TimeoutError("runtime limit reached before sync call")
            try:
                await asyncio.wait_for(
                    pipeline.sync_daily_prices(
                        symbols=target_symbols,
                        start_date=start_date,
                        end_date=end_date,
                    ),
                    timeout=timeout,
                )
            except TimeoutError as exc:
                raise TimeoutError(
                    f"sync_daily_prices timed out after {timeout:.1f}s for {len(target_symbols)} symbol(s)"
                ) from exc
            return

        await pipeline.sync_daily_prices(
            symbols=target_symbols,
            start_date=start_date,
            end_date=end_date,
        )

    logger.info(
        "Starting historical backfill: symbols=%s years=%s batches=%s start_batch=%s max_runtime_minutes=%s max_batches=%s call_timeout_seconds=%s hard_timeout_seconds=%s",
        len(symbols),
        years,
        len(all_batches),
        start_batch,
        max_runtime_minutes,
        max_batches,
        call_timeout_seconds,
        hard_timeout_seconds,
    )

    for batch_idx in range(start_batch, len(all_batches)):
        if max_batches is not None and max_batches > 0 and processed_batches >= max_batches:
            stop_reason = "max_batches_reached"
            logger.info(
                "Stopping early after %s processed batches (max_batches reached)", processed_batches
            )
            break

        if max_runtime_minutes is not None and max_runtime_minutes > 0:
            elapsed_minutes = (time.monotonic() - run_started_at) / 60
            if elapsed_minutes >= max_runtime_minutes:
                stop_reason = "max_runtime_reached"
                logger.info(
                    "Stopping early at %.2f minutes (max-runtime-minutes reached)",
                    elapsed_minutes,
                )
                break

        batch_symbols = all_batches[batch_idx]
        logger.info(
            "Batch %s/%s (%s symbols): %s",
            batch_idx + 1,
            len(all_batches),
            len(batch_symbols),
            ", ".join(batch_symbols[:6]) + ("..." if len(batch_symbols) > 6 else ""),
        )

        try:
            await run_sync(batch_symbols)
            checkpoint.completed_symbols += len(batch_symbols)
        except Exception as batch_exc:  # noqa: BLE001
            logger.warning("Batch failed, falling back to per-symbol retry: %s", batch_exc)
            for symbol in batch_symbols:
                if max_runtime_minutes is not None and (remaining_runtime_seconds() or 0) <= 0:
                    stop_reason = "max_runtime_reached"
                    logger.info("Stopping symbol retries because runtime limit was reached")
                    break
                try:
                    await run_sync([symbol])
                    checkpoint.completed_symbols += 1
                except Exception as symbol_exc:  # noqa: BLE001
                    logger.warning("Symbol backfill failed for %s: %s", symbol, symbol_exc)
                    checkpoint.failed_symbols.append(symbol)

            if stop_reason == "max_runtime_reached":
                checkpoint.next_index = batch_idx
                checkpoint.updated_at = datetime.now(UTC).isoformat()
                save_checkpoint(checkpoint_file, checkpoint)
                break

        checkpoint.next_index = batch_idx + 1
        checkpoint.updated_at = datetime.now(UTC).isoformat()
        save_checkpoint(checkpoint_file, checkpoint)
        processed_batches += 1

        if sleep_seconds > 0:
            await asyncio.sleep(sleep_seconds)

    elapsed_seconds = round(time.monotonic() - run_started_at, 2)
    if watchdog_timer is not None:
        watchdog_timer.cancel()

    write_report(stop_reason, elapsed_seconds)

    logger.info(
        "Historical backfill finished: completed=%s failed=%s checkpoint=%s stop_reason=%s elapsed_seconds=%s",
        checkpoint.completed_symbols,
        len(checkpoint.failed_symbols),
        checkpoint_file,
        stop_reason,
        elapsed_seconds,
    )
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Resumable historical backfill for Sprint V34")
    parser.add_argument("--years", type=int, default=5)
    parser.add_argument("--limit", type=int, default=200)
    parser.add_argument("--batch-size", type=int, default=25)
    parser.add_argument("--sleep-seconds", type=float, default=0.5)
    parser.add_argument(
        "--max-runtime-minutes",
        type=float,
        default=0,
        help="Stop after this many minutes (0 disables the limit)",
    )
    parser.add_argument(
        "--max-batches",
        type=int,
        default=0,
        help="Stop after this many processed batches (0 disables the limit)",
    )
    parser.add_argument(
        "--call-timeout-seconds",
        type=float,
        default=0,
        help="Timeout for each sync call (0 disables the limit)",
    )
    parser.add_argument(
        "--hard-timeout-grace-seconds",
        type=float,
        default=30,
        help="Additional seconds after max-runtime before force exit (0 disables grace)",
    )
    parser.add_argument(
        "--checkpoint-file",
        type=Path,
        default=Path("scripts/v34_backfill_historical_checkpoint.json"),
    )
    parser.add_argument(
        "--report-json",
        type=Path,
        default=None,
        help="Optional JSON report output for time-boxed runs",
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
        max_runtime_minutes=args.max_runtime_minutes if args.max_runtime_minutes > 0 else None,
        max_batches=args.max_batches if args.max_batches > 0 else None,
        call_timeout_seconds=args.call_timeout_seconds if args.call_timeout_seconds > 0 else None,
        hard_timeout_grace_seconds=max(0.0, args.hard_timeout_grace_seconds),
        report_json=args.report_json,
    )


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main()))
