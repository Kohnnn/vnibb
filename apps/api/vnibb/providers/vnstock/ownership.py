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
                    results.append(OwnershipData(
                        symbol=symbol.upper(),
                        owner_name=row.get("owner_name") or row.get("name") or row.get("shareholder"),
                        owner_type=row.get("owner_type") or row.get("type"),
                        shares=row.get("shares") or row.get("share_own"),
                        ownership_pct=row.get("ownership_pct") or row.get("share_own_percent") or row.get("percent"),
                        change_shares=row.get("change_shares") or row.get("share_own_change"),
                        change_pct=row.get("change_pct") or row.get("share_own_change_percent"),
                        report_date=str(row.get("report_date")) if row.get("report_date") else None,
                    ))
                except Exception as e:
                    logger.warning(f"Skipping invalid ownership row: {e}")
                    continue
            
            return results
            
        except Exception as e:
            logger.error(f"Ownership fetch failed for {symbol}: {e}")
            raise ProviderError(f"Failed to fetch ownership for {symbol}: {e}")
