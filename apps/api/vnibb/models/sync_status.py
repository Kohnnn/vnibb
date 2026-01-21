"""
Sync Status ORM Model

Tracks database synchronization operations:
- Sync type (full, incremental, screener, etc.)
- Start/end timestamps
- Success/error counts
- Error details for debugging
"""

from datetime import datetime
from typing import Optional, List, Dict, Any

from sqlalchemy import Column, String, Integer, DateTime, JSON, Text
from sqlalchemy.orm import Mapped, mapped_column

from vnibb.core.database import Base


class SyncStatus(Base):
    """
    Tracks sync job execution history.
    
    Used for:
    - Monitoring sync health
    - Debugging failed syncs
    - Determining if initial seed is needed
    """
    __tablename__ = "sync_status"
    
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    
    # Sync identification
    sync_type: Mapped[str] = mapped_column(
        String(50), nullable=False, index=True
    )  # 'full', 'incremental', 'screener', 'stocks', 'prices', etc.
    
    # Timing
    started_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    
    # Results
    success_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    error_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    
    # Status
    status: Mapped[str] = mapped_column(
        String(20), default="running", nullable=False
    )  # 'running', 'completed', 'failed', 'partial'
    
    # Error details (JSON array of error messages)
    errors: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)
    
    # Additional data
    additional_data: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)
    
    def __repr__(self) -> str:
        return f"<SyncStatus(type='{self.sync_type}', status='{self.status}', success={self.success_count})>"
    
    @property
    def duration_seconds(self) -> Optional[float]:
        """Calculate sync duration in seconds."""
        if self.completed_at and self.started_at:
            return (self.completed_at - self.started_at).total_seconds()
        return None
    
    @property
    def is_successful(self) -> bool:
        """Check if sync completed successfully."""
        return self.status == "completed" and self.error_count == 0
