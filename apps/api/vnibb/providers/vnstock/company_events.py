"""
VnStock Company Events Fetcher

Fetches corporate events (dividends, stock splits, AGMs, etc.)
for Vietnam-listed companies via vnstock library.
"""

import asyncio
import logging
from datetime import datetime
import re
from typing import Any, List, Optional

from pydantic import BaseModel, Field, field_validator

from vnibb.providers.base import BaseFetcher
from vnibb.core.config import settings
from vnibb.core.exceptions import ProviderError, ProviderTimeoutError
from vnibb.providers.vnstock.reference_fields import identity, supplied
from vnibb.providers.vnstock.runtime import run_reference_provider

logger = logging.getLogger(__name__)
RATIO_PATTERN = re.compile(r"(\d+(?:[\.,]\d+)?)\s*[:/]\s*(\d+(?:[\.,]\d+)?)")
NUMBER_PATTERN = re.compile(r"(\d+(?:[\.,]\d+)*)")


def _normalize_company_action_category(
    event_type: Optional[str],
    event_name: Optional[str],
    description: Optional[str],
) -> tuple[str, Optional[str]]:
    haystack = " ".join(filter(None, [event_type, event_name, description])).upper()

    if any(token in haystack for token in ["SPLIT", "TÁCH", "GỘP", "CHIA TÁCH"]):
        return "split", "split"
    if any(
        token in haystack for token in ["RIGHT", "QUYỀN MUA", "PHÁT HÀNH THÊM", "ISSUANCE", "ISSUE"]
    ):
        return "issuance", "rights_issue"
    if any(token in haystack for token in ["DIVIDEND", "CỔ TỨC", "THƯỞNG CỔ PHIẾU"]):
        if any(token in haystack for token in ["CASH", "TIỀN", "VND/SHARE"]):
            return "dividend", "cash_dividend"
        if any(token in haystack for token in ["STOCK", "CỔ PHIẾU", "BONUS", "THƯỞNG"]):
            return "dividend", "stock_dividend"
        return "dividend", None
    if any(token in haystack for token in ["AGM", "ĐẠI HỘI", "ĐHĐCĐ", "MEETING"]):
        return "meeting", None
    return "other", None


def _parse_company_action_value(
    value: Optional[str], description: Optional[str]
) -> tuple[Optional[float], Optional[str]]:
    primary = value or description or ""
    ratio_match = RATIO_PATTERN.search(primary)
    if ratio_match:
        left = ratio_match.group(1).replace(",", "")
        right = ratio_match.group(2).replace(",", "")
        return None, f"{left}:{right}"

    numeric_match = NUMBER_PATTERN.search(primary)
    if numeric_match:
        raw = numeric_match.group(1).replace(",", "")
        try:
            return float(raw), None
        except ValueError:
            return None, None

    return None, None


def _parse_sortable_event_date(value: Any) -> datetime | None:
    if value is None:
        return None

    raw = str(value).strip()
    if not raw or raw.lower() in {"none", "nan", "nat"}:
        return None

    normalized = raw.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(normalized)
    except ValueError:
        pass

    for fmt in (
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%d",
        "%d/%m/%Y %H:%M:%S",
        "%d/%m/%Y %H:%M",
        "%d/%m/%Y",
        "%d-%m-%Y %H:%M:%S",
        "%d-%m-%Y %H:%M",
        "%d-%m-%Y",
        "%Y%m%d",
    ):
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            continue

    return None


class CompanyEventsQueryParams(BaseModel):
    """Query parameters for company events."""

    symbol: str = Field(
        ...,
        min_length=1,
        max_length=10,
        description="Stock ticker symbol (e.g., VNM)",
    )
    limit: int = Field(
        default=30,
        ge=1,
        le=100,
        description="Maximum number of events to return",
    )

    @field_validator("symbol")
    @classmethod
    def uppercase_symbol(cls, v: str) -> str:
        return v.upper().strip()


class CompanyEventData(BaseModel):
    """
    Standardized company event data.

    Each item represents a corporate event like dividend, AGM, stock split, etc.
    """

    symbol: str = Field(..., description="Stock ticker symbol")
    event_type: Optional[str] = Field(None, description="Type of event")
    event_name: Optional[str] = Field(None, description="Event name/title")
    event_date: Optional[str] = Field(None, description="Event date")
    ex_date: Optional[str] = Field(None, description="Ex-dividend/Ex-rights date")
    record_date: Optional[str] = Field(None, description="Record date")
    payment_date: Optional[str] = Field(None, description="Payment date")
    description: Optional[str] = Field(None, description="Event description")
    value: Optional[str] = Field(None, description="Event value (dividend amount, ratio, etc.)")
    action_category: Optional[str] = Field(None, description="Normalized corporate action bucket")
    action_subtype: Optional[str] = Field(None, description="Refined corporate action subtype")
    effective_date: Optional[str] = Field(
        None, description="Best actionable date for chart markers and adjustments"
    )
    cash_amount_per_share: Optional[float] = Field(
        None, description="Parsed cash amount per share when available"
    )
    share_ratio: Optional[str] = Field(None, description="Parsed ratio text such as 2:1 or 10:3")
    raw_data: Optional[dict[str, Any]] = None

    model_config = {
        "json_schema_extra": {
            "example": {
                "symbol": "VNM",
                "event_type": "DIVIDEND",
                "event_name": "Cash Dividend Q3/2024",
                "event_date": "2024-10-15",
                "value": "1,500 VND/share",
            }
        }
    }


class VnstockCompanyEventsFetcher(BaseFetcher[CompanyEventsQueryParams, CompanyEventData]):
    """
    Fetcher for company events via vnstock library.

    Returns corporate events like dividends, AGMs, stock splits, etc.
    """

    provider_name = "vnstock"
    requires_credentials = False
    propagate_provider_errors = True

    @staticmethod
    def transform_query(params: CompanyEventsQueryParams) -> dict[str, Any]:
        """Transform query params to vnstock-compatible format."""
        return {
            "symbol": params.symbol.upper(),
            "limit": params.limit,
        }

    @staticmethod
    async def extract_data(
        query: dict[str, Any],
        credentials: Optional[dict[str, str]] = None,
    ) -> List[dict[str, Any]]:
        """Fetch company events from vnstock."""

        def _fetch_sync() -> List[dict]:
            try:
                from vnibb.providers.vnstock.runtime import create_reference_company

                company = create_reference_company(query["symbol"], settings.vnstock_source)

                events_df = company.events()
                if events_df is None or events_df.empty:
                    logger.info(f"No events data for {query['symbol']}")
                    return []
                return events_df.to_dict("records")

            except Exception as e:
                logger.error(f"vnstock events fetch error: {e}")
                raise ProviderError(
                    message=str(e),
                    provider="vnstock",
                    details={"symbol": query["symbol"]},
                )

        try:
            return await run_reference_provider(
                _fetch_sync, settings.vnstock_timeout,
                key=("company_events", settings.vnstock_source, tuple(sorted(query.items()))),
            )
        except asyncio.TimeoutError:
            raise ProviderTimeoutError(provider="vnstock", timeout_seconds=settings.vnstock_timeout)

    @staticmethod
    def transform_data(
        params: CompanyEventsQueryParams,
        data: List[dict[str, Any]],
    ) -> List[CompanyEventData]:
        """Transform raw events data to standardized format."""
        results: List[CompanyEventData] = []

        for row in data:
            try:

                def _clean(value: Any) -> str | None:
                    if value is None:
                        return None
                    text = str(value).strip()
                    if text.lower() in {"", "none", "nan", "nat"}:
                        return None
                    return text

                def _date(*keys: str, source: dict[str, Any] = row) -> str | None:
                    for key in keys:
                        parsed = _parse_sortable_event_date(supplied(source, key))
                        if parsed is not None:
                            return parsed.date().isoformat()
                    return None

                event_date = _date("public_date", "display_date", "event_date", "eventDate", "date", "ngayGDKHQ")
                ex_date = _date("exright_date", "ex_date", "exDate", "exRightDate")
                event_item = CompanyEventData(
                    symbol=params.symbol.upper(),
                    event_type=identity(supplied(row, "event_code", "event_type", "eventType", "type", "loaiSuKien"), "event type"),
                    event_name=identity(supplied(row, "event_title_vi", "event_title_en", "event_name_vi", "event_name_en", "event_name", "eventName", "title", "noiDung"), "event"),
                    event_date=event_date,
                    ex_date=ex_date,
                    record_date=_date("record_date", "recordDate", "ngayDKCC"),
                    payment_date=_date("payout_date", "payment_date", "paymentDate", "ngayThanhToan"),
                    description=_clean(supplied(row, "event_name_vi", "event_name_en", "action_type_vi", "action_type_en", "description", "content", "ghiChu")),
                    value=_clean(supplied(row, "value_per_share", "exercise_ratio", "value", "ratio", "tyLe")),
                    raw_data=row,
                )
                if event_item.event_date is None:
                    raise ProviderError("Invalid event source date", provider="vnstock")
                action_category, action_subtype = _normalize_company_action_category(
                    event_item.event_type,
                    event_item.event_name,
                    event_item.description,
                )
                cash_amount_per_share, share_ratio = _parse_company_action_value(
                    event_item.value,
                    event_item.description,
                )
                if supplied(row, "value_per_share", "exercise_ratio") is not None:
                    cash_amount_per_share = None
                event_item = event_item.model_copy(
                    update={
                        "action_category": action_category,
                        "action_subtype": action_subtype,
                        "effective_date": event_item.ex_date
                        or event_item.event_date
                        or event_item.record_date
                        or event_item.payment_date,
                        "cash_amount_per_share": cash_amount_per_share,
                        "share_ratio": share_ratio,
                    }
                )
                results.append(event_item)

            except Exception as e:
                raise ProviderError("Invalid event row", provider="vnstock", cause=e) from e

        results.sort(
            key=lambda item: _parse_sortable_event_date(
                item.event_date or item.ex_date or item.record_date or item.payment_date
            )
            or datetime.min,
            reverse=True,
        )
        return results[: params.limit]
