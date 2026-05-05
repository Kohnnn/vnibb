"""
FastAPI Dependency Injection utilities.

Provides common dependencies for:
- Database sessions
- Authentication (future)
- Rate limiting (future)
- Pagination
"""

from typing import Annotated, Optional

from fastapi import Depends, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.core.database import get_db


# Type alias for database dependency
DatabaseDep = Annotated[AsyncSession, Depends(get_db)]


class PaginationParams(BaseModel):
    """Standard pagination parameters."""
    
    offset: int = 0
    limit: int = 100
    
    @property
    def skip(self) -> int:
        """Alias for offset (SQLAlchemy style)."""
        return self.offset


def get_pagination(
    offset: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(100, ge=1, le=1000, description="Maximum records to return"),
) -> PaginationParams:
    """FastAPI dependency for pagination parameters."""
    return PaginationParams(offset=offset, limit=limit)


PaginationDep = Annotated[PaginationParams, Depends(get_pagination)]


class DateRangeParams(BaseModel):
    """Standard date range parameters."""
    
    start_date: Optional[str] = None
    end_date: Optional[str] = None


def get_date_range(
    start_date: Optional[str] = Query(None, description="Start date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="End date (YYYY-MM-DD)"),
) -> DateRangeParams:
    """FastAPI dependency for date range parameters."""
    return DateRangeParams(start_date=start_date, end_date=end_date)


DateRangeDep = Annotated[DateRangeParams, Depends(get_date_range)]
