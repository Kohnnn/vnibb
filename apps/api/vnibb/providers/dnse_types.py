from datetime import datetime
from typing import Literal, TypedDict


class PriceObservation(TypedDict):
    symbol: str
    source: Literal["DNSE"]
    price_source: Literal["dnse_unknown"]
    price_unit: Literal["unknown"]
    unavailable_reason: Literal["unverified_price_volume_value_units"]
    raw_data: dict[object, object]
    open: None
    high: None
    low: None
    close: None
    price: None
    volume: None
    value: None


class HistoryObservation(PriceObservation):
    t: int
    time: datetime
    nextTime: int


class QuoteObservation(PriceObservation):
    boardId: str
    time: datetime


class ListingObservation(TypedDict):
    source: Literal["DNSE"]
    symbol: str
    marketId: str
    raw_data: dict[object, object]
    total: int
    page: int
    pageSize: int


class ListingAssembly(TypedDict):
    data: list[ListingObservation]
    total: int
    pageSize: int
    pages: int
    pagination_complete: Literal[True]


RequestHeaders = TypedDict(
    "RequestHeaders", {"Date": str, "X-Signature": str, "x-api-key": str, "version": str}
)


class SignedRequest(TypedDict):
    method: Literal["GET"]
    path: str
    query: str
    headers: RequestHeaders


class ProviderError(TypedDict):
    source: Literal["DNSE"]
    status: int
    reason: Literal[
        "rate_limited", "quota_exceeded", "forbidden", "authentication_failed",
        "provider_error", "request_rejected",
    ]


class UnavailableCapability(TypedDict):
    source: Literal["DNSE"]
    capability: str
    available: Literal[False]
    reason: Literal["not_available_from_offline_adapter"]
