"""Source-agnostic per-market intraday snapshot row.

A micro-snapshot is one (source, source_id) tuple's YES probability at a
specific 15-minute bucket. Intraday snapshots live alongside the nightly
``prediction_market_snapshots`` rows but with a much shorter retention
(default 7 days). The /movers endpoint can use these to power 1h / 4h /
24h diffs without forcing a re-pull of every nightly row.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, Index, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from vnibb.core.database import Base


class PredictionMarketIntradaySnapshot(Base):
    """Per-market intraday snapshot row.

    Cadence is 15 minutes (see ``PREDICTION_MARKET_INTRADAY_CADENCE_MINUTES``)
    but the ``captured_at`` field is the source of truth, not the wall clock.
    Retention is bounded by the intraday snapshot service itself (default 7
    days) and enforced by ``prediction_market_intraday_snapshot_service``.
    """

    __tablename__ = "prediction_market_intraday_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # Soft reference into prediction_markets; not enforced.
    market_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    source: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    source_id: Mapped[str] = mapped_column(String(128), nullable=False)
    category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    question: Mapped[str] = mapped_column(String(512), nullable=False)
    url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    yes_price: Mapped[float] = mapped_column(Float, nullable=False)
    volume: Mapped[float | None] = mapped_column(Float, nullable=True)
    liquidity: Mapped[float | None] = mapped_column(Float, nullable=True)
    extra: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    captured_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        index=True,
        default=datetime.utcnow,
    )


# Composite index supports the per-(source, source_id) "latest vs window ago"
# diff query used by /movers, /alerts and /history.
Index(
    "ix_prediction_market_intraday_snapshots_source_pair_captured",
    PredictionMarketIntradaySnapshot.source,
    PredictionMarketIntradaySnapshot.source_id,
    PredictionMarketIntradaySnapshot.captured_at,
)