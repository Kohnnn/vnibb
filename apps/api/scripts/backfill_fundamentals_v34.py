#!/usr/bin/env python3
# ruff: noqa: E402
"""
Resumable ratios/news/events recovery for Sprint V34.

Features:
- top-symbol selection from latest screener snapshot
- stage + batch checkpoints
- batch fallback to per-symbol retry
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import desc, func, select

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from vnibb.core.database import async_session_maker
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models.stock import Stock
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


def stage_order(include_quarterly_ratios: bool) -> list[str]:
    stages = ["ratios_year"]
    if include_quarterly_ratios:
        stages.append("ratios_quarter")
    stages.extend(["company_news", "company_events"])
    return stages


async def run_stage(pipeline: DataPipeline, stage: str, symbols: list[str], args: argparse.Namespace) -> None:
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

    stages = stage_order(args.include_quarterly_ratios)
    batches = chunked(symbols, args.batch_size)

    checkpoint_file: Path = args.checkpoint_file
    if args.reset_checkpoint and checkpoint_file.exists():
        checkpoint_file.unlink()

    checkpoint = load_checkpoint(checkpoint_file)
    if checkpoint is None:
        checkpoint = checkpoint_default(stages, len(symbols))

    pipeline = DataPipeline()
    logger.info(
        "Starting fundamentals recovery: symbols=%s stages=%s batches_per_stage=%s",
        len(symbols),
        ",".join(stages),
        len(batches),
    )

    start_stage_idx = stages.index(checkpoint.stage) if checkpoint.stage in stages else 0

    for stage_idx in range(start_stage_idx, len(stages)):
        stage = stages[stage_idx]
        start_batch = checkpoint.next_batch if stage == checkpoint.stage else 0
        checkpoint.stage = stage

        logger.info("Stage %s/%s: %s (start_batch=%s)", stage_idx + 1, len(stages), stage, start_batch)

        for batch_idx in range(start_batch, len(batches)):
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
                await run_stage(pipeline, stage, batch_symbols, args)
                stats.success_symbols += len(batch_symbols)
                checkpoint.completed_symbols += len(batch_symbols)
            except Exception as batch_exc:  # noqa: BLE001
                logger.warning("Stage %s batch failed; retrying per symbol: %s", stage, batch_exc)
                for symbol in batch_symbols:
                    try:
                        await run_stage(pipeline, stage, [symbol], args)
                        stats.success_symbols += 1
                        checkpoint.completed_symbols += 1
                    except Exception as symbol_exc:  # noqa: BLE001
                        logger.warning("Stage %s failed for symbol %s: %s", stage, symbol, symbol_exc)
                        stats.failed_symbols += 1
                        add_failed_symbol(checkpoint, symbol)

            stats.completed_batches += 1
            checkpoint.next_batch = batch_idx + 1
            checkpoint.updated_at = datetime.now(UTC).isoformat()
            save_checkpoint(checkpoint_file, checkpoint)

            if args.sleep_seconds > 0:
                await asyncio.sleep(args.sleep_seconds)

        checkpoint.next_batch = 0
        checkpoint.updated_at = datetime.now(UTC).isoformat()
        save_checkpoint(checkpoint_file, checkpoint)

    report = {
        "generated_at": datetime.now(UTC).isoformat(),
        "stages": stages,
        "limit": args.limit,
        "batch_size": args.batch_size,
        "total_symbols": len(symbols),
        "completed_symbols": checkpoint.completed_symbols,
        "failed_symbols_count": len(checkpoint.failed_symbols),
        "failed_symbols": checkpoint.failed_symbols,
        "stage_stats": {
            stage: asdict(stats) for stage, stats in checkpoint.stage_stats.items()
        },
        "checkpoint_file": str(checkpoint_file),
    }
    if args.report_json:
        output = Path(args.report_json)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, indent=2), encoding="utf-8")
        logger.info("Wrote report: %s", output)

    logger.info(
        "Fundamentals recovery finished: completed=%s failed=%s",
        checkpoint.completed_symbols,
        len(checkpoint.failed_symbols),
    )
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Resumable fundamentals recovery for Sprint V34")
    parser.add_argument("--limit", type=int, default=200)
    parser.add_argument("--batch-size", type=int, default=25)
    parser.add_argument("--news-limit", type=int, default=20)
    parser.add_argument("--events-limit", type=int, default=30)
    parser.add_argument("--include-quarterly-ratios", action="store_true")
    parser.add_argument("--sleep-seconds", type=float, default=0.5)
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
