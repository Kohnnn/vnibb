"""
VnStock Equity Profile Fetcher

Fetches company profile, overview, and shareholder information
for Vietnam-listed companies via vnstock library.
"""

import asyncio
import logging
from datetime import datetime
from typing import Any, List, Optional

from pydantic import BaseModel, Field, field_validator

from vnibb.providers.base import BaseFetcher
from vnibb.core.config import settings
from vnibb.core.exceptions import ProviderError, ProviderTimeoutError

logger = logging.getLogger(__name__)


class EquityProfileQueryParams(BaseModel):
    """Query parameters for company profile."""
    
    symbol: str = Field(
        ...,
        min_length=1,
        max_length=10,
        description="Stock ticker symbol (e.g., VNM)",
    )
    
    @field_validator("symbol")
    @classmethod
    def uppercase_symbol(cls, v: str) -> str:
        return v.upper().strip()


class EquityProfileData(BaseModel):
    """
    Standardized company profile data.
    
    Includes basic company info, industry classification, and key stats.
    """
    
    symbol: str = Field(..., description="Stock ticker symbol")
    company_name: Optional[str] = Field(None, description="Full company name")
    short_name: Optional[str] = Field(None, description="Short company name")
    exchange: Optional[str] = Field(None, description="Listed exchange")
    industry: Optional[str] = Field(None, description="Industry classification")
    sector: Optional[str] = Field(None, description="Sector classification")
    
    # Company details
    established_date: Optional[str] = Field(None, description="Date of establishment")
    listing_date: Optional[str] = Field(None, description="IPO/Listing date")
    website: Optional[str] = Field(None, description="Company website")
    description: Optional[str] = Field(None, description="Business description")
    
    # Key metrics
    outstanding_shares: Optional[float] = Field(None, description="Outstanding shares")
    listed_shares: Optional[float] = Field(None, description="Listed shares")
    market_cap: Optional[float] = Field(None, description="Market capitalization")
    
    # Contact
    address: Optional[str] = Field(None, description="Head office address")
    phone: Optional[str] = Field(None, description="Phone number")
    email: Optional[str] = Field(None, description="Email address")
    
    updated_at: Optional[datetime] = Field(None, description="Data timestamp")
    
    model_config = {
        "json_schema_extra": {
            "example": {
                "symbol": "VNM",
                "company_name": "Công ty Cổ phần Sữa Việt Nam",
                "short_name": "Vinamilk",
                "exchange": "HOSE",
                "industry": "Thực phẩm & Đồ uống",
            }
        }
    }


from vnibb.core.retry import vnstock_cb, circuit_breaker

class VnstockEquityProfileFetcher(BaseFetcher[EquityProfileQueryParams, EquityProfileData]):
    """
    Fetcher for company profile via vnstock library.
    
    Returns comprehensive company information including
    identification, classification, and key metrics.
    """
    
    provider_name = "vnstock"
    requires_credentials = False
    
    @staticmethod
    def transform_query(params: EquityProfileQueryParams) -> dict[str, Any]:
        """Transform query params to vnstock-compatible format."""
        return {"symbol": params.symbol.upper()}
    
    @staticmethod
    @circuit_breaker(vnstock_cb)
    async def extract_data(
        query: dict[str, Any],
        credentials: Optional[dict[str, str]] = None,
    ) -> List[dict[str, Any]]:
        """Fetch company profile from vnstock."""
        loop = asyncio.get_event_loop()
        
        def _fetch_sync() -> List[dict[str, Any]]:
            try:
                from vnstock import Listing, Vnstock
                
                stock = Vnstock().stock(symbol=query["symbol"], source=settings.vnstock_source)
                
                # Get company overview
                overview = stock.company.overview()
                
                if overview is None or overview.empty:
                    logger.warning(f"No profile data for {query['symbol']}")
                    return []
                
                record = overview.to_dict("records")[0]
                
                # Get company name from Listing (overview doesn't include it)
                try:
                    listing = Listing()
                    symbols_df = listing.all_symbols()
                    if symbols_df is not None and not symbols_df.empty:
                        match = symbols_df[symbols_df["symbol"] == query["symbol"]]
                        if not match.empty:
                            record["organ_name"] = match.iloc[0].get("organ_name", "")
                except Exception as e:
                    logger.debug(f"Failed to get company name from listing: {e}")
                
                return [record]
                
            except Exception as e:
                logger.error(f"vnstock profile fetch error: {e}")
                raise ProviderError(
                    message=str(e),
                    provider="vnstock",
                    details={"symbol": query["symbol"]},
                )
        
        try:
            return await asyncio.wait_for(
                loop.run_in_executor(None, _fetch_sync),
                timeout=settings.vnstock_timeout,
            )
        except asyncio.TimeoutError:
            raise ProviderTimeoutError(
                provider="vnstock",
                timeout=settings.vnstock_timeout,
            )
    
    @staticmethod
    def transform_data(
        params: EquityProfileQueryParams,
        data: List[dict[str, Any]],
    ) -> List[EquityProfileData]:
        """
        Transform raw profile data to standardized format.
        
        vnstock company.overview() field mapping:
        - symbol: stock ticker
        - organ_name: company name (from Listing)
        - company_profile: business description
        - icb_name2: sector (e.g., 'Thực phẩm và đồ uống')
        - icb_name3: industry (e.g., 'Sản xuất thực phẩm')
        - icb_name4: sub-industry (e.g., 'Thực phẩm')
        - issue_share: outstanding shares
        - charter_capital: charter capital (VND)
        """
        results: List[EquityProfileData] = []
        
        for row in data:
            try:
                profile = EquityProfileData(
                    symbol=params.symbol.upper(),
                    # Company name from Listing().all_symbols()
                    company_name=row.get("organ_name"),
                    short_name=None,  # Not available in VCI overview
                    exchange=None,  # Not directly in overview, could infer from symbol
                    # Industry classification from ICB levels
                    industry=row.get("icb_name3") or row.get("icb_name4"),
                    sector=row.get("icb_name2"),
                    established_date=None,  # Not in VCI overview
                    listing_date=None,  # Not in VCI overview
                    website=None,  # Not in VCI overview
                    # Business description
                    description=row.get("company_profile"),
                    # Share data
                    outstanding_shares=row.get("issue_share") or row.get("financial_ratio_issue_share"),
                    listed_shares=row.get("issue_share"),
                    # Charter capital as proxy (actual market cap needs price calculation)
                    market_cap=row.get("charter_capital"),
                    address=None,  # Not in VCI overview
                    phone=None,  # Not in VCI overview
                    email=None,  # Not in VCI overview
                    updated_at=datetime.utcnow(),
                )
                results.append(profile)
                
            except Exception as e:
                logger.warning(f"Skipping invalid profile row: {e}")
                continue
        
        return results
