"""Source-agnostic per-market snapshot row.

A snapshot is one (source, source_id) tuple's YES probability at a point in
time. The nightly snapshot job (apps/api/vnibb/services/prediction_market_snapshot_service.py)
appends new rows; the `/movers` endpoint diffs the latest snapshot against a
historical one.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from vnibb.core.database import Base


class PredictionMarketSnapshot(Base):
    """Per-market snapshot row used for movers and trend endpoints."""

    __tablename__ = "prediction_market_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # Soft reference into prediction_markets; we don't enforce FK to keep
    # ingestion robust if a market is removed.
    market_id: Mapped[int] = mapped_column(
        Integer,
        nullable=True,
        index=True,
    )
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
