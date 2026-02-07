"""
Application Key-Value Store

Stores lightweight application metadata that should persist across restarts
(e.g., provider registration state).
"""

from datetime import datetime
from typing import Any, Optional

from sqlalchemy import DateTime, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from vnibb.core.database import Base


class AppKeyValue(Base):
    """Simple key-value metadata store."""

    __tablename__ = "app_kv"

    key: Mapped[str] = mapped_column(String(200), primary_key=True)
    value: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )
