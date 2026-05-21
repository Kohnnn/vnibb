"""Persist weekly RS snapshots so the Relative Rotation Graph trail
renders as a meaningful polyline (QA-v3 E.4).

Run it on Friday close (or whenever close is available). Idempotent:
re-running the same snapshot_date upserts.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Iterable

import numpy as np
import pandas as pd
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from vnibb.core.database import async_session_maker
from vnibb.models.market import RsSnapshot
from vnibb.models.stock import StockPrice

logger = logging.getLogger(__name__)


def _compute_rs_pair(symbol_returns: pd.Series, bench_returns: pd.Series) -> tuple[float | None, float | None]:
    """Compute (RS-Ratio, RS-Momentum) on a 13-week / ~63-trading-day window.

    Following the standard RRG definition: cumulative relative
    performance vs benchmark, normalised so 100 = parity. RS-Ratio is
    the smoothed level; RS-Momentum is the rate of change.
    """

    window = 63
    if len(symbol_returns) < window + 5:
        return None, None
    aligned = pd.concat([symbol_returns, bench_returns], axis=1, join="inner").dropna()
    if len(aligned) < window + 5:
        return None, None
    aligned.columns = ["symbol", "bench"]
    rel = (1 + aligned["symbol"]) / (1 + aligned["bench"]) - 1
    rs_ratio_raw = (1 + rel.rolling(window).sum()) * 100
    rs_momentum_raw = rs_ratio_raw / rs_ratio_raw.shift(10) * 100

    last_ratio = rs_ratio_raw.iloc[-1]
    last_momentum = rs_momentum_raw.iloc[-1]
    if not np.isfinite(last_ratio) or not np.isfinite(last_momentum):
        return None, None
    return float(last_ratio), float(last_momentum)


def _resolve_quadrant(rs_ratio: float, rs_momentum: float) -> str:
    if rs_ratio >= 100 and rs_momentum >= 100:
        return "Leading"
    if rs_ratio < 100 and rs_momentum >= 100:
        return "Improving"
    if rs_ratio < 100 and rs_momentum < 100:
        return "Lagging"
    return "Weakening"


async def take_rs_snapshot(
    *,
    symbols: Iterable[str] | None = None,
    benchmark: str = "VNINDEX",
    snapshot_date: date | None = None,
    lookback_days: int = 63,
) -> int:
    """Compute and upsert RS snapshots for the given symbols vs benchmark."""

    target_date = snapshot_date or date.today()

    async with async_session_maker() as session:
        # Pull benchmark close history (we use VNINDEX from `stock_indices`,
        # but if unavailable we fall back to a representative liquid stock).
        # Prefer the StockIndex table if VNINDEX is there.
        from vnibb.models.stock import StockIndex

        bench_q = (
            select(StockIndex.time, StockIndex.close)
            .where(StockIndex.index_code == benchmark)
            .order_by(StockIndex.time.asc())
        )
        bench_rows = (await session.execute(bench_q)).all()
        if not bench_rows:
            logger.warning("No benchmark history for %s; skipping RS snapshot", benchmark)
            return 0

        bench_series = pd.Series(
            {row.time: float(row.close) for row in bench_rows if row.close is not None}
        ).sort_index()
        bench_returns = bench_series.pct_change().dropna()

        if symbols is None:
            symbol_q = select(StockPrice.symbol).distinct()
            rows = (await session.execute(symbol_q)).all()
            symbols = sorted({row[0] for row in rows if row[0]})

        upserted = 0
        for symbol in symbols:
            sym_q = (
                select(StockPrice.time, StockPrice.close)
                .where(
                    StockPrice.symbol == symbol,
                    StockPrice.interval == "1D",
                )
                .order_by(StockPrice.time.asc())
            )
            sym_rows = (await session.execute(sym_q)).all()
            if not sym_rows:
                continue
            sym_series = pd.Series(
                {row.time: float(row.close) for row in sym_rows if row.close is not None}
            ).sort_index()
            sym_returns = sym_series.pct_change().dropna()

            ratio, momentum = _compute_rs_pair(sym_returns, bench_returns)
            if ratio is None or momentum is None:
                continue
            quadrant = _resolve_quadrant(ratio, momentum)

            stmt = (
                pg_insert(RsSnapshot)
                .values(
                    symbol=symbol,
                    benchmark=benchmark,
                    snapshot_date=target_date,
                    rs_ratio=round(ratio, 4),
                    rs_momentum=round(momentum, 4),
                    quadrant=quadrant,
                    lookback_days=lookback_days,
                )
                .on_conflict_do_update(
                    constraint="uq_rs_snapshot_symbol_benchmark_date",
                    set_={
                        "rs_ratio": round(ratio, 4),
                        "rs_momentum": round(momentum, 4),
                        "quadrant": quadrant,
                        "lookback_days": lookback_days,
                    },
                )
            )
            await session.execute(stmt)
            upserted += 1

        await session.commit()
        logger.info("RS snapshot complete: %d symbols upserted for %s", upserted, target_date)
        return upserted


async def get_rs_trail(
    symbol: str,
    *,
    benchmark: str = "VNINDEX",
    weeks: int = 12,
) -> list[dict[str, object]]:
    """Return the last N weekly RS snapshots for a symbol so the RRG widget
    can draw a polyline."""

    cutoff = date.today() - timedelta(weeks=weeks + 1)
    async with async_session_maker() as session:
        q = (
            select(
                RsSnapshot.snapshot_date,
                RsSnapshot.rs_ratio,
                RsSnapshot.rs_momentum,
                RsSnapshot.quadrant,
            )
            .where(
                RsSnapshot.symbol == symbol.upper(),
                RsSnapshot.benchmark == benchmark,
                RsSnapshot.snapshot_date >= cutoff,
            )
            .order_by(RsSnapshot.snapshot_date.asc())
        )
        rows = (await session.execute(q)).all()

    return [
        {
            "snapshot_date": row.snapshot_date.isoformat(),
            "rs_ratio": float(row.rs_ratio) if row.rs_ratio is not None else None,
            "rs_momentum": float(row.rs_momentum) if row.rs_momentum is not None else None,
            "quadrant": row.quadrant,
        }
        for row in rows
    ]
