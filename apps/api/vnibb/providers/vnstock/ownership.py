"""
Ownership Provider - Company Ownership Structure

Provides ownership data including major shareholders and foreign ownership.
Uses vnstock company.ownership() method.
"""

import asyncio
import logging
from typing import List, Optional

from pydantic import BaseModel, Field

from vnibb.core.config import settings
from vnibb.core.exceptions import ProviderError

logger = logging.getLogger(__name__)


def _parse_number(value) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
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


def _to_int(value) -> Optional[int]:
    parsed = _parse_number(value)
    if parsed is None:
        return None
    return int(parsed)


def _normalize_pct(value) -> Optional[float]:
    parsed = _parse_number(value)
    if parsed is None:
        return None
    if parsed <= 1:
        return parsed * 100
    return parsed


# =============================================================================
# DATA MODELS
# =============================================================================


class OwnershipData(BaseModel):
    """Company ownership structure data."""

    symbol: str
    owner_name: Optional[str] = Field(None, alias="ownerName")
    owner_type: Optional[str] = Field(None, alias="ownerType")  # Individual, Institution, State
    shares: Optional[int] = None
    ownership_pct: Optional[float] = Field(None, alias="ownershipPct")
    change_shares: Optional[int] = Field(None, alias="changeShares")
    change_pct: Optional[float] = Field(None, alias="changePct")
    report_date: Optional[str] = Field(None, alias="reportDate")

    model_config = {"populate_by_name": True}


class OwnershipQueryParams(BaseModel):
    """Query parameters for ownership."""

    symbol: str


# =============================================================================
# FETCHER
# =============================================================================


class VnstockOwnershipFetcher:
    """
    Fetcher for company ownership data.

    Wraps vnstock company.ownership() method (VCI source).
    """

    @staticmethod
    async def fetch(symbol: str) -> List[OwnershipData]:
        """
        Fetch ownership data for a company.

        Args:
            symbol: Stock symbol

        Returns:
            List of OwnershipData records
        """
        try:

            def _fetch():
                from vnstock import Vnstock

                stock = Vnstock().stock(symbol=symbol.upper(), source=settings.vnstock_source)
                df = stock.company.ownership()
                if df is None or len(df) == 0:
                    return []
                return df.to_dict(orient="records")

            loop = asyncio.get_event_loop()
            records = await loop.run_in_executor(None, _fetch)

            results = []
            for row in records:
                try:
                    results.append(
                        OwnershipData(
                            symbol=symbol.upper(),
                            owner_name=row.get("owner_name")
                            or row.get("name")
                            or row.get("shareholder"),
                            owner_type=row.get("owner_type") or row.get("type"),
                            shares=_to_int(
                                row.get("shares") or row.get("share_own") or row.get("quantity")
                            ),
                            ownership_pct=_normalize_pct(
                                row.get("ownership_pct")
                                or row.get("share_own_percent")
                                or row.get("percent")
                                or row.get("ratio")
                            ),
                            change_shares=_to_int(
                                row.get("change_shares") or row.get("share_own_change")
                            ),
                            change_pct=_normalize_pct(
                                row.get("change_pct") or row.get("share_own_change_percent")
                            ),
                            report_date=str(row.get("report_date"))
                            if row.get("report_date")
                            else None,
                        )
                    )
                except Exception as e:
                    logger.warning(f"Skipping invalid ownership row: {e}")
                    continue

            return results

        except Exception as e:
            logger.error(f"Ownership fetch failed for {symbol}: {e}")
            raise ProviderError(f"Failed to fetch ownership for {symbol}: {e}")
