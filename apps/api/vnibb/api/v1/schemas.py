from typing import Any, List, Optional, TypeVar, Generic
from pydantic import BaseModel

T = TypeVar("T")


class MetaData(BaseModel):
    count: int
    page: Optional[int] = None
    limit: Optional[int] = None
    total_pages: Optional[int] = None
    symbol: Optional[str] = None
    data_points: Optional[int] = None
    last_data_date: Optional[str] = None


class StandardResponse(BaseModel, Generic[T]):
    data: T
    meta: Optional[MetaData] = None
    error: Optional[str] = None
