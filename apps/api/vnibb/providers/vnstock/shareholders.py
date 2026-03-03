"""
VnStock Major Shareholders Fetcher

Fetches major shareholders/ownership data for Vietnam-listed companies.
"""

import asyncio
import logging
import numbers
from datetime import datetime
from typing import Any, List, Optional

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


def _extract_ownership_raw(row: dict[str, Any]) -> Optional[float]:
    for key in OWNERSHIP_VALUE_KEYS:
        parsed = _parse_number(row.get(key))
        if parsed is not None:
            return parsed
    return None


def _normalize_ownership_pct(parsed: Optional[float], assume_ratio: bool) -> Optional[float]:
    if parsed is None:
        return None
    return parsed * 100 if assume_ratio else parsed


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
                from vnstock import Vnstock

                stock = Vnstock().stock(symbol=query["symbol"], source=settings.vnstock_source)
                df = stock.company.shareholders()

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
            raise ProviderTimeoutError(provider="vnstock", timeout=settings.vnstock_timeout)

    @staticmethod
    def transform_data(
        params: ShareholdersQueryParams,
        data: List[dict[str, Any]],
    ) -> List[ShareholderData]:
        prepared_rows: list[tuple[dict[str, Any], Optional[float], Optional[float]]] = []
        ownership_samples: list[float] = []

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
            ownership_raw = _extract_ownership_raw(row)
            if ownership_raw is not None:
                ownership_samples.append(abs(ownership_raw))
            prepared_rows.append((row, shares_owned, ownership_raw))

        # VCI often returns ratio values (0.36 = 36%), while KBS can return percentages
        # directly (22.29 = 22.29%). Detect shape at dataset level to avoid 100x errors.
        assume_ratio_ownership = bool(ownership_samples) and max(ownership_samples) <= 1

        results = []
        for row, shares_owned, ownership_raw in prepared_rows:
            try:
                ownership_pct = _normalize_ownership_pct(
                    ownership_raw, assume_ratio=assume_ratio_ownership
                )
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
                        shareholder_type=row.get("type")
                        or row.get("shareholderType")
                        or row.get("owner_type")
                        or row.get("ownerType"),
                    )
                )
            except Exception as e:
                logger.warning(f"Skipping invalid shareholder row: {e}")
        return results
