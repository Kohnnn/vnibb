"""Full-fidelity terminal prediction market archive for historical reads."""

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from vnibb.core.database import Base


class PredictionMarketArchive(Base):
    __tablename__ = "prediction_market_archive"

    market_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    batch_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    archived_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    backup_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
