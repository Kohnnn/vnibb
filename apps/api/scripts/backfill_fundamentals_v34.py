#!/usr/bin/env python3
# ruff: noqa: E402
"""
Resumable ratios/news/events recovery for Sprint V34.

Features:
- top-symbol selection from latest screener snapshot
- stage + batch checkpoints
- batch fallback to per-symbol retry
- optional time-boxing (`--max-runtime-minutes`, `--max-batches`) for fast feedback runs
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
import time
from dataclasses import asdict, dataclass, field
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from sqlalchemy import func, select

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from vnibb.core.database import async_session_maker
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models.stock import Stock, StockPrice
from vnibb.services.data_pipeline import DataPipeline

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


@dataclass
class StageStats:
    success_symbols: int = 0
    failed_symbols: int = 0
    completed_batches: int = 0


@dataclass
class RecoveryCheckpoint:
    stage: str
    next_batch: int
    total_symbols: int
    completed_symbols: int
    failed_symbols: list[str] = field(default_factory=list)
    stage_stats: dict[str, StageStats] = field(default_factory=dict)
    updated_at: str = ""


def checkpoint_default(stages: list[str], total_symbols: int) -> RecoveryCheckpoint:
    return RecoveryCheckpoint(
        stage=stages[0],
        next_batch=0,
        total_symbols=total_symbols,
        completed_symbols=0,
        failed_symbols=[],
        stage_stats={stage: StageStats() for stage in stages},
        updated_at=datetime.now(UTC).isoformat(),
    )


def load_checkpoint(path: Path) -> RecoveryCheckpoint | None:
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        stage_stats_raw = payload.get("stage_stats", {})
        stage_stats: dict[str, StageStats] = {}
        for stage, values in stage_stats_raw.items():
            stage_stats[stage] = StageStats(
                success_symbols=int(values.get("success_symbols", 0)),
                failed_symbols=int(values.get("failed_symbols", 0)),
                completed_batches=int(values.get("completed_batches", 0)),
            )
        return RecoveryCheckpoint(
            stage=str(payload.get("stage", "")),
            next_batch=int(payload.get("next_batch", 0)),
            total_symbols=int(payload.get("total_symbols", 0)),
            completed_symbols=int(payload.get("completed_symbols", 0)),
            failed_symbols=[str(item).upper() for item in payload.get("failed_symbols", [])],
            stage_stats=stage_stats,
            updated_at=str(payload.get("updated_at", "")),
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to parse checkpoint %s: %s", path, exc)
        return None


def save_checkpoint(path: Path, checkpoint: RecoveryCheckpoint) -> None:
    payload = asdict(checkpoint)
    payload["stage_stats"] = {
        key: asdict(value) if isinstance(value, StageStats) else value
        for key, value in checkpoint.stage_stats.items()
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


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


def parse_types(raw_types: str) -> set[str]:
    parsed = {item.strip().lower() for item in raw_types.split(",") if item.strip()}
    valid = {"ratios", "news", "events"}
    selected = parsed & valid
    if not selected:
        raise ValueError("--types must include at least one of: ratios, news, events")
    return selected


def stage_order(include_quarterly_ratios: bool, selected_types: set[str]) -> list[str]:
    stages: list[str] = []
    if "ratios" in selected_types:
        stages.append("ratios_year")
        if include_quarterly_ratios:
            stages.append("ratios_quarter")
    if "news" in selected_types:
        stages.append("company_news")
    if "events" in selected_types:
        stages.append("company_events")
    return stages


async def run_stage(
    pipeline: DataPipeline, stage: str, symbols: list[str], args: argparse.Namespace
) -> None:
    if stage == "ratios_year":
        await pipeline.sync_financial_ratios(symbols=symbols, period="year")
        return
    if stage == "ratios_quarter":
        await pipeline.sync_financial_ratios(symbols=symbols, period="quarter")
        return
    if stage == "company_news":
        await pipeline.sync_company_news(symbols=symbols, limit=args.news_limit)
        return
    if stage == "company_events":
        await pipeline.sync_company_events(symbols=symbols, limit=args.events_limit)
        return
    raise ValueError(f"Unsupported stage: {stage}")


def add_failed_symbol(checkpoint: RecoveryCheckpoint, symbol: str) -> None:
    symbol_upper = symbol.upper()
    if symbol_upper not in checkpoint.failed_symbols:
        checkpoint.failed_symbols.append(symbol_upper)


def checkpoint_stage_stats(checkpoint: RecoveryCheckpoint, stage: str) -> StageStats:
    stats = checkpoint.stage_stats.get(stage)
    if stats is None:
        stats = StageStats()
        checkpoint.stage_stats[stage] = stats
    return stats


async def run_recovery(args: argparse.Namespace) -> int:
    symbols = await get_top_symbols(args.limit)
    if not symbols:
        logger.error("No symbols found for fundamentals recovery.")
        return 1

    selected_types = parse_types(args.types)
    stages = stage_order(args.include_quarterly_ratios, selected_types)
    batches = chunked(symbols, args.batch_size)

    checkpoint_file: Path = args.checkpoint_file
    if args.reset_checkpoint and checkpoint_file.exists():
        checkpoint_file.unlink()

    checkpoint = load_checkpoint(checkpoint_file)
    if checkpoint is None:
        checkpoint = checkpoint_default(stages, len(symbols))

    pipeline = DataPipeline()
    run_started_at = time.monotonic()
    processed_batches = 0
    stop_reason = "completed"

    def remaining_runtime_seconds() -> float | None:
        if args.max_runtime_minutes <= 0:
            return None
        return (args.max_runtime_minutes * 60) - (time.monotonic() - run_started_at)

    def compute_timeout() -> float | None:
        timeout: float | None = args.call_timeout_seconds if args.call_timeout_seconds > 0 else None
        remaining = remaining_runtime_seconds()
        if remaining is not None:
            if remaining <= 0:
                return 0
            timeout = min(timeout, remaining) if timeout is not None else remaining
        return timeout

    async def run_stage_with_timeout(stage: str, symbols_batch: list[str]) -> None:
        timeout = compute_timeout()
        if timeout is not None:
            if timeout <= 0:
                raise TimeoutError("runtime limit reached before stage call")
            try:
                await asyncio.wait_for(
                    run_stage(pipeline, stage, symbols_batch, args), timeout=timeout
                )
            except TimeoutError as exc:
                raise TimeoutError(
                    f"{stage} sync timed out after {timeout:.1f}s for {len(symbols_batch)} symbol(s)"
                ) from exc
            return

        await run_stage(pipeline, stage, symbols_batch, args)

    logger.info(
        "Starting fundamentals recovery: symbols=%s stages=%s batches_per_stage=%s max_runtime_minutes=%s max_batches=%s",
        len(symbols),
        ",".join(stages),
        len(batches),
        args.max_runtime_minutes if args.max_runtime_minutes > 0 else None,
        args.max_batches if args.max_batches > 0 else None,
    )

    start_stage_idx = stages.index(checkpoint.stage) if checkpoint.stage in stages else 0

    for stage_idx in range(start_stage_idx, len(stages)):
        stage = stages[stage_idx]
        start_batch = checkpoint.next_batch if stage == checkpoint.stage else 0
        checkpoint.stage = stage

        logger.info(
            "Stage %s/%s: %s (start_batch=%s)", stage_idx + 1, len(stages), stage, start_batch
        )

        for batch_idx in range(start_batch, len(batches)):
            if args.max_batches > 0 and processed_batches >= args.max_batches:
                stop_reason = "max_batches_reached"
                logger.info(
                    "Stopping early after %s processed batches (max_batches reached)",
                    processed_batches,
                )
                break

            if args.max_runtime_minutes > 0:
                elapsed_minutes = (time.monotonic() - run_started_at) / 60
                if elapsed_minutes >= args.max_runtime_minutes:
                    stop_reason = "max_runtime_reached"
                    logger.info(
                        "Stopping early at %.2f minutes (max-runtime-minutes reached)",
                        elapsed_minutes,
                    )
                    break

            batch_symbols = batches[batch_idx]
            stats = checkpoint_stage_stats(checkpoint, stage)
            logger.info(
                "Stage=%s batch %s/%s symbols=%s",
                stage,
                batch_idx + 1,
                len(batches),
                ", ".join(batch_symbols[:6]) + ("..." if len(batch_symbols) > 6 else ""),
            )

            try:
                await run_stage_with_timeout(stage, batch_symbols)
                stats.success_symbols += len(batch_symbols)
                checkpoint.completed_symbols += len(batch_symbols)
            except Exception as batch_exc:  # noqa: BLE001
                logger.warning("Stage %s batch failed; retrying per symbol: %s", stage, batch_exc)
                for symbol in batch_symbols:
                    if args.max_runtime_minutes > 0 and (remaining_runtime_seconds() or 0) <= 0:
                        stop_reason = "max_runtime_reached"
                        logger.info("Stopping symbol retries because runtime limit was reached")
                        break
                    try:
                        await run_stage_with_timeout(stage, [symbol])
                        stats.success_symbols += 1
                        checkpoint.completed_symbols += 1
                    except Exception as symbol_exc:  # noqa: BLE001
                        logger.warning(
                            "Stage %s failed for symbol %s: %s", stage, symbol, symbol_exc
                        )
                        stats.failed_symbols += 1
                        add_failed_symbol(checkpoint, symbol)

                if stop_reason == "max_runtime_reached":
                    checkpoint.next_batch = batch_idx
                    checkpoint.updated_at = datetime.now(UTC).isoformat()
                    save_checkpoint(checkpoint_file, checkpoint)
                    break

            stats.completed_batches += 1
            checkpoint.next_batch = batch_idx + 1
            checkpoint.updated_at = datetime.now(UTC).isoformat()
            save_checkpoint(checkpoint_file, checkpoint)
            processed_batches += 1

            if args.sleep_seconds > 0:
                await asyncio.sleep(args.sleep_seconds)

        if stop_reason != "completed":
            break

        checkpoint.next_batch = 0
        checkpoint.updated_at = datetime.now(UTC).isoformat()
        save_checkpoint(checkpoint_file, checkpoint)

    elapsed_seconds = round(time.monotonic() - run_started_at, 2)

    report = {
        "generated_at": datetime.now(UTC).isoformat(),
        "stages": stages,
        "limit": args.limit,
        "batch_size": args.batch_size,
        "total_symbols": len(symbols),
        "completed_symbols": checkpoint.completed_symbols,
        "failed_symbols_count": len(checkpoint.failed_symbols),
        "failed_symbols": checkpoint.failed_symbols,
        "stage_stats": {stage: asdict(stats) for stage, stats in checkpoint.stage_stats.items()},
        "checkpoint_file": str(checkpoint_file),
        "processed_batches": processed_batches,
        "elapsed_seconds": elapsed_seconds,
        "stop_reason": stop_reason,
        "max_runtime_minutes": args.max_runtime_minutes if args.max_runtime_minutes > 0 else None,
        "max_batches": args.max_batches if args.max_batches > 0 else None,
        "call_timeout_seconds": args.call_timeout_seconds
        if args.call_timeout_seconds > 0
        else None,
    }
    if args.report_json:
        output = Path(args.report_json)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, indent=2), encoding="utf-8")
        logger.info("Wrote report: %s", output)

    logger.info(
        "Fundamentals recovery finished: completed=%s failed=%s stop_reason=%s elapsed_seconds=%s",
        checkpoint.completed_symbols,
        len(checkpoint.failed_symbols),
        stop_reason,
        elapsed_seconds,
    )
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Resumable fundamentals recovery for Sprint V34")
    parser.add_argument("--limit", type=int, default=200)
    parser.add_argument("--batch-size", type=int, default=25)
    parser.add_argument("--news-limit", type=int, default=20)
    parser.add_argument("--events-limit", type=int, default=30)
    parser.add_argument("--include-quarterly-ratios", action="store_true")
    parser.add_argument(
        "--types",
        type=str,
        default="ratios,news,events",
        help="Comma-separated stages: ratios,news,events",
    )
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
        help="Timeout for each stage sync call (0 disables the limit)",
    )
    parser.add_argument(
        "--checkpoint-file",
        type=Path,
        default=Path("scripts/v34_backfill_fundamentals_checkpoint.json"),
    )
    parser.add_argument(
        "--report-json",
        type=Path,
        default=Path("scripts/v34_fundamentals_recovery_report.json"),
    )
    parser.add_argument("--reset-checkpoint", action="store_true")
    return parser.parse_args()


async def _main() -> int:
    args = parse_args()
    return await run_recovery(args)


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main()))
