from datetime import date
from typing import Generic, Literal, Optional, TypeVar

from pydantic import BaseModel, ConfigDict

T = TypeVar("T")


class MetaData(BaseModel):
    # Allow per-endpoint extension fields (e.g. `full_ratio_coverage_starts`,
    # `is_last_session`, etc.) without churning the base schema.
    model_config = ConfigDict(extra="allow")

    count: int
    page: Optional[int] = None
    limit: Optional[int] = None
    total_pages: Optional[int] = None
    symbol: Optional[str] = None
    data_points: Optional[int] = None
    last_data_date: Optional[str] = None
    full_ratio_coverage_starts: Optional[str] = None


class StandardResponse(BaseModel, Generic[T]):
    data: T
    meta: Optional[MetaData] = None
    error: Optional[str] = None


class HistoricalMetaData(MetaData):
    excluded_row_count: int
    replaced_excluded_dates: list[date]
    unresolved_excluded_dates: list[date]
    unresolved_session_count: int
    calendar_verified: bool | None
    expected_session_dates: list[date] | None
    missing_session_count: int | None
    missing_leading_sessions: int | None
    missing_interior_sessions: int | None
    missing_trailing_sessions: int | None
    session_basis: Literal["adjusted", "mixed", "unverified", "not_applicable"]


class HistoricalResponse(StandardResponse[T]):
    meta: HistoricalMetaData
