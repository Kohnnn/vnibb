<<<<<<< Updated upstream
from typing import Any, List, Optional, TypeVar, Generic
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
=======
from typing import Any, List, Optional, TypeVar, Generic
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
>>>>>>> Stashed changes
