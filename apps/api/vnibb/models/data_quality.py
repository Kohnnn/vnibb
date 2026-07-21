from datetime import date, datetime
from typing import Any

from sqlalchemy import JSON, Date, DateTime, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from vnibb.core.database import Base


class DataQualityRun(Base):
    __tablename__ = "data_quality_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    started_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    source: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    dataset: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    observed_market_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    latest_market_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    market_day_staleness: Mapped[int | None] = mapped_column(Integer, nullable=True)
    summary_counts: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    error_category: Mapped[str | None] = mapped_column(String(64), nullable=True)

    __table_args__ = (
        Index("ix_data_quality_runs_source_completed", "source", "completed_at"),
        Index("ix_data_quality_runs_observed_completed", "observed_market_date", "completed_at"),
    )


class DataQualityBreachState(Base):
    __tablename__ = "data_quality_breach_states"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    breach_key: Mapped[str] = mapped_column(String(192), nullable=False)
    source: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    dataset: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    category: Mapped[str] = mapped_column(String(64), nullable=False)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    consecutive_runs: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    sustained_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    __table_args__ = (
        UniqueConstraint("breach_key", name="uq_data_quality_breach_states_key"),
        Index("ix_data_quality_breach_states_active", "source", "dataset", "resolved_at"),
    )
