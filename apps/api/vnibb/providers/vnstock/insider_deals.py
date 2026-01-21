"""
Insider Deals Provider - Insider Trading Transactions

Provides access to insider trading transactions.
Uses vnstock company.insider_deals() method.
"""

import asyncio
import logging
from datetime import date
from typing import List, Optional

from pydantic import BaseModel, Field

from vnibb.core.config import settings
from vnibb.core.exceptions import ProviderError

logger = logging.getLogger(__name__)


# =============================================================================
# DATA MODELS
# =============================================================================

class InsiderDealData(BaseModel):
    """Insider trading transaction data."""
    symbol: str
    # Insider info
    insider_name: Optional[str] = Field(None, alias="insiderName")
    insider_position: Optional[str] = Field(None, alias="position")
    insider_relation: Optional[str] = Field(None, alias="relation")
    # Transaction details
    transaction_type: Optional[str] = Field(None, alias="dealType")
    transaction_date: Optional[str] = Field(None, alias="dealDate")
    registration_date: Optional[str] = Field(None, alias="registrationDate")
    # Shares
    shares_before: Optional[int] = Field(None, alias="sharesBefore")
    shares_registered: Optional[int] = Field(None, alias="sharesRegistered")
    shares_executed: Optional[int] = Field(None, alias="sharesExecuted")
    shares_after: Optional[int] = Field(None, alias="sharesAfter")
    # Ownership
    ownership_before: Optional[float] = Field(None, alias="ownershipBefore")
    ownership_after: Optional[float] = Field(None, alias="ownershipAfter")
    
    model_config = {"populate_by_name": True}


class InsiderDealsQueryParams(BaseModel):
    """Query parameters for insider deals."""
    symbol: str
    limit: int = 20


# =============================================================================
# FETCHER
# =============================================================================

class VnstockInsiderDealsFetcher:
    """
    Fetcher for insider trading transactions.
    
    Wraps vnstock company.insider_deals() method (VCI source).
    """
    
    @staticmethod
    async def fetch(
        symbol: str,
        limit: int = 20,
    ) -> List[InsiderDealData]:
        """
        Fetch insider deals for a company.
        
        Args:
            symbol: Stock symbol
            limit: Maximum number of records
        
        Returns:
            List of InsiderDealData records
        """
        try:
            def _fetch():
                from vnstock import Vnstock
                # Prefer settings source
                try:
                    stock = Vnstock().stock(symbol=symbol.upper(), source=settings.vnstock_source)
                    df = stock.company.insider_deals()
                    if df is not None and len(df) > 0:
                        return df.head(limit).to_dict(orient="records")
                except Exception as e:
                    logger.debug(f"{settings.vnstock_source} insider_deals failed for {symbol}: {e}")
                
                # Fallback to TCBS (though it may fail)
                try:
                    stock = Vnstock().stock(symbol=symbol.upper(), source="TCBS")
                    df = stock.company.insider_deals()
                    if df is not None and len(df) > 0:
                        return df.head(limit).to_dict(orient="records")
                except:
                    pass
                    
                return []
            
            loop = asyncio.get_event_loop()
            records = await loop.run_in_executor(None, _fetch)
            
            result = []
            for r in records:
                result.append(InsiderDealData(
                    symbol=symbol.upper(),
                    insider_name=r.get("insiderName") or r.get("insider_name") or r.get("name"),
                    insider_position=r.get("position") or r.get("insider_position") or r.get("title"),
                    insider_relation=r.get("relation") or r.get("insider_relation"),
                    transaction_type=r.get("dealType") or r.get("deal_type") or r.get("type"),
                    transaction_date=str(r.get("dealDate") or r.get("deal_date")) if r.get("dealDate") or r.get("deal_date") else None,
                    registration_date=str(r.get("registrationDate") or r.get("registration_date")) if r.get("registrationDate") or r.get("registration_date") else None,
                    shares_before=r.get("sharesBefore") or r.get("shares_before") or r.get("beforeVolume"),
                    shares_registered=r.get("sharesRegistered") or r.get("shares_registered") or r.get("registeredVolume"),
                    shares_executed=r.get("sharesExecuted") or r.get("shares_executed") or r.get("dealVolume"),
                    shares_after=r.get("sharesAfter") or r.get("shares_after") or r.get("afterVolume"),
                    ownership_before=r.get("ownershipBefore") or r.get("ownership_before") or r.get("beforeRatio"),
                    ownership_after=r.get("ownershipAfter") or r.get("ownership_after") or r.get("afterRatio"),
                ))
            
            return result
            
        except Exception as e:
            logger.error(f"Insider deals fetch failed for {symbol}: {e}")
            raise ProviderError(f"Failed to fetch insider deals for {symbol}: {e}")
