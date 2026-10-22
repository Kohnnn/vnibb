"""
VnStock Major Shareholders Fetcher

Fetches major shareholders/ownership data for Vietnam-listed companies.
"""

import asyncio
import logging
import math
import numbers
from typing import Any, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator

from vnibb.providers.base import BaseFetcher
from vnibb.core.config import settings
from vnibb.core.exceptions import ProviderError, ProviderTimeoutError

logger = logging.getLogger(__name__)


def _parse_number(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, numbers.Real):
        return float(value)
    if isinstance(value, str):
        cleaned = value.strip().replace(",", "")
        if not cleaned:
            return None
        if cleaned.endswith("%"):
            cleaned = cleaned[:-1]
        try:
            return float(cleaned)
        except ValueError:
            return None
    return None


OWNERSHIP_VALUE_KEYS = (
    "ratio",
    "ownership",
    "ownership_percentage",
    "ownershipRatio",
    "ownershipPercent",
    "tyLe",
    "tyLeSoHuu",
    "ownership_pct",
    "share_own_percent",
    "percent_owned",
    "percent",
)


def _extract_ownership(row: dict[str, Any]) -> tuple[Optional[float], Optional[str]]:
    for key in OWNERSHIP_VALUE_KEYS:
        raw = row.get(key)
        parsed = _parse_number(raw)
        if parsed is None:
            continue
        unit = row.get("ownership_unit")
        if isinstance(raw, str) and raw.strip().endswith("%"):
            unit = "percent"
        value = parsed * 100 if unit == "ratio" else parsed
        admitted = unit in ("percent", "ratio") and math.isfinite(value) and 0 <= value <= 100
        return (value if admitted else None), key
    return None, None


class ShareholdersQueryParams(BaseModel):
    """Query parameters for shareholders data."""

    symbol: str = Field(..., min_length=1, max_length=10)

    @field_validator("symbol")
    @classmethod
    def uppercase_symbol(cls, v: str) -> str:
        return v.upper().strip()


class ShareholderData(BaseModel):
    """Standardized shareholder data."""

    symbol: str
    shareholder_name: Optional[str] = None
    shares_owned: Optional[float] = None
    ownership_pct: Optional[float] = None
    ownership_unit: Optional[Literal["percent"]] = None
    ownership_unit_status: Literal["explicit", "unverified"] = "unverified"
    ownership_source_field: Optional[str] = None
    ownership_source: Optional[str] = None
    raw_data: Optional[dict[str, Any]] = None
    shareholder_type: Optional[str] = None  # Major, Insider, Foreign, etc.

    model_config = {
        "json_schema_extra": {
            "example": {
                "symbol": "VNM",
                "shareholder_name": "SCIC",
                "shares_owned": 725000000,
                "ownership_pct": 36.0,
                "shareholder_type": "State",
            }
        }
    }


class VnstockShareholdersFetcher(BaseFetcher[ShareholdersQueryParams, ShareholderData]):
    """Fetcher for major shareholders via vnstock."""

    provider_name = "vnstock"
    requires_credentials = False

    @staticmethod
    def transform_query(params: ShareholdersQueryParams) -> dict[str, Any]:
        return {"symbol": params.symbol.upper()}

    @staticmethod
    async def extract_data(
        query: dict[str, Any],
        credentials: Optional[dict[str, str]] = None,
    ) -> List[dict[str, Any]]:
        loop = asyncio.get_event_loop()

        def _fetch_sync() -> List[dict]:
            try:
                from vnibb.providers.vnstock.runtime import create_reference_company

                company = create_reference_company(query["symbol"], settings.vnstock_source)
                df = company.shareholders()

                if df is None or df.empty:
                    return []

                return df.to_dict("records")
            except Exception as e:
                logger.error(f"vnstock shareholders fetch error: {e}")
                raise ProviderError(
                    message=str(e), provider="vnstock", details={"symbol": query["symbol"]}
                )

        try:
            return await asyncio.wait_for(
                loop.run_in_executor(None, _fetch_sync),
                timeout=settings.vnstock_timeout,
            )
        except asyncio.TimeoutError:
            raise ProviderTimeoutError(provider="vnstock", timeout_seconds=settings.vnstock_timeout)

    @staticmethod
    def transform_data(
        params: ShareholdersQueryParams,
        data: List[dict[str, Any]],
    ) -> List[ShareholderData]:
        results = []
        for row in data:
            shares_owned = _parse_number(
                row.get("shares")
                or row.get("share")
                or row.get("quantity")
                or row.get("holding")
                or row.get("owned")
                or row.get("soLuong")
                or row.get("share_own")
                or row.get("shareOwn")
                or row.get("shares_owned")
                or row.get("sharesOwned")
                or row.get("owned_shares")
                or row.get("numberOfShares")
                or row.get("number_of_shares")
            )
            ownership_pct, ownership_source_field = _extract_ownership(row)
            try:
                results.append(
                    ShareholderData(
                        symbol=params.symbol.upper(),
                        shareholder_name=row.get("name")
                        or row.get("share_holder")
                        or row.get("shareholder")
                        or row.get("holder")
                        or row.get("shareholderName")
                        or row.get("shareholder_name")
                        or row.get("tenCoDonh"),
                        shares_owned=shares_owned,
                        ownership_pct=ownership_pct,
                        ownership_unit="percent" if ownership_pct is not None else None,
                        ownership_unit_status="explicit" if ownership_pct is not None else "unverified",
                        ownership_source_field=ownership_source_field,
                        ownership_source=f"vnstock:{settings.vnstock_source}",
                        raw_data=row,
                        shareholder_type=row.get("type")
                        or row.get("shareholderType")
                        or row.get("owner_type")
                        or row.get("ownerType"),
                    )
                )
            except Exception as e:
                logger.warning(f"Skipping invalid shareholder row: {e}")
        return results
