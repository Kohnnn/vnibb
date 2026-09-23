"""Cross-process scheduler observations, not a queue or job execution log."""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from vnibb.core.database import Base


class SchedulerJobState(Base):
    __tablename__ = "scheduler_job_state"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    name: Mapped[str | None] = mapped_column(String(256))
    trigger: Mapped[str | None] = mapped_column(String(256))
    next_run: Mapped[datetime | None] = mapped_column(DateTime)
    last_outcome: Mapped[str | None] = mapped_column(String(16))
    last_detail: Mapped[str | None] = mapped_column(String(128))
    last_at: Mapped[datetime | None] = mapped_column(DateTime)
    consecutive_failures: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class SchedulerWorkerState(Base):
    __tablename__ = "scheduler_worker_state"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    heartbeat_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    running: Mapped[bool] = mapped_column(Boolean, nullable=False)
    missed_runs: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
