"""
Listing Provider - Stock Symbol Listings

Provides access to stock listings by exchange, index group, and industry classification.
Uses vnstock Listing class.
"""

import asyncio
import logging
from typing import List, Optional

from pydantic import BaseModel, Field
from vnstock import Listing

from vnibb.core.exceptions import ProviderError
from vnibb.core.config import settings


logger = logging.getLogger(__name__)



# =============================================================================
# DATA MODELS
# =============================================================================

class SymbolData(BaseModel):
    """Basic stock symbol data."""
    symbol: str
    organ_name: Optional[str] = Field(None, alias="organName")
    exchange: Optional[str] = None
    industry: Optional[str] = None
    
    model_config = {"populate_by_name": True}


class ExchangeSymbolData(BaseModel):
    """Symbol data with exchange details."""
    symbol: str
    organ_name: Optional[str] = Field(None, alias="organName")
    en_organ_name: Optional[str] = Field(None, alias="enOrganName")
    short_name: Optional[str] = Field(None, alias="organShortName")
    exchange: Optional[str] = None
    status: Optional[str] = None
    listing_date: Optional[str] = Field(None, alias="listingDate")
    delisting_date: Optional[str] = Field(None, alias="delistingDate")
    
    model_config = {"populate_by_name": True}


class IndexGroupSymbolData(BaseModel):
    """Symbol data for index group membership."""
    symbol: str
    organ_name: Optional[str] = Field(None, alias="organName")
    group: str
    
    model_config = {"populate_by_name": True}


class IndustryData(BaseModel):
    """ICB Industry classification."""
    icb_code: str = Field(alias="icbCode")
    icb_name: Optional[str] = Field(None, alias="icbName")
    en_icb_name: Optional[str] = Field(None, alias="enIcbName")
    level: Optional[int] = None
    
    model_config = {"populate_by_name": True}


# =============================================================================
# QUERY PARAMS
# =============================================================================

class ListingQueryParams(BaseModel):
    """Query parameters for listing endpoints."""
    source: str = "KBS"

class SymbolsByExchangeQueryParams(BaseModel):
    """Query parameters for symbols by exchange."""
    source: str = "KBS"
    lang: str = "en"

class SymbolsByGroupQueryParams(BaseModel):
    """Query parameters for symbols by index group."""
    source: str = "KBS"
    group: str = "VN30"



# =============================================================================
# FETCHER
# =============================================================================

class VnstockListingFetcher:
    """
    Fetcher for Vietnam stock listings.
    
    Wraps vnstock Listing class for:
    - All symbols
    - Symbols by exchange (HOSE, HNX, UPCOM)
    - Symbols by index group (VN30, VN100, VNMidCap, VNSmallCap)
    - Industry classification (ICB codes)
    """
    
    @staticmethod
    async def fetch_all_symbols(
        source: str = "KBS",
    ) -> List[SymbolData]:
        """
        Fetch all stock symbols.
        
        Args:
            source: Data source (VCI, VND)
        
        Returns:
            List of SymbolData records
        """
        try:
            def _fetch():
                listing = Listing(source=source.lower())
                df = listing.all_symbols(to_df=True)
                return df.to_dict(orient="records") if df is not None and len(df) > 0 else []
            
            loop = asyncio.get_event_loop()
            records = await loop.run_in_executor(None, _fetch)
            
            return [SymbolData(**r) for r in records]
            
        except Exception as e:
            logger.error(f"Listing fetch failed: {e}")
            raise ProviderError(f"Failed to fetch symbol listing: {e}", provider="vnstock")
    
    @staticmethod
    async def fetch_symbols_by_exchange(
        source: str = "KBS",
        lang: str = "en",
    ) -> List[ExchangeSymbolData]:

        """
        Fetch symbols categorized by exchange.
        
        Args:
            source: Data source (VCI, VND)
            lang: Language for names (en, vi)
        
        Returns:
            List of ExchangeSymbolData records
        """
        try:
            def _fetch():
                listing = Listing(source=source.lower())
                df = listing.symbols_by_exchange(lang=lang)
                return df.to_dict(orient="records") if df is not None and len(df) > 0 else []
            
            loop = asyncio.get_event_loop()
            records = await loop.run_in_executor(None, _fetch)
            
            return [ExchangeSymbolData(**r) for r in records]
            
        except Exception as e:
            logger.error(f"Symbols by exchange fetch failed: {e}")
            raise ProviderError(f"Failed to fetch symbols by exchange: {e}", provider="vnstock")
    
    @staticmethod
    async def fetch_symbols_by_group(
        group: str = "VN30",
        source: str = "KBS",
    ) -> List[IndexGroupSymbolData]:

        """
        Fetch symbols in a specific index group.
        
        Args:
            group: Index group name (VN30, VN100, VNMidCap, VNSmallCap, VNAllShare, VN30F1M, ETF, HNX30)
            source: Data source
        
        Returns:
            List of IndexGroupSymbolData records
        """
        try:
            def _fetch():
                listing = Listing(source=source.lower())
                df = listing.symbols_by_group(group=group)
                if df is None or len(df) == 0:
                    return []
                records = df.to_dict(orient="records")
                # Add group to each record
                for r in records:
                    r["group"] = group
                return records
            
            loop = asyncio.get_event_loop()
            records = await loop.run_in_executor(None, _fetch)
            
            return [IndexGroupSymbolData(**r) for r in records]
            
        except Exception as e:
            logger.error(f"Symbols by group fetch failed: {e}")
            raise ProviderError(f"Failed to fetch symbols by group {group}: {e}", provider="vnstock")
    
    @staticmethod
    async def fetch_industries_icb(
        source: str = "KBS",
    ) -> List[IndustryData]:

        """
        Fetch ICB industry classification.
        
        Args:
            source: Data source
        
        Returns:
            List of IndustryData records
        """
        try:
            def _fetch():
                listing = Listing(source=source.lower())
                df = listing.industries_icb()
                return df.to_dict(orient="records") if df is not None and len(df) > 0 else []
            
            loop = asyncio.get_event_loop()
            records = await loop.run_in_executor(None, _fetch)
            
            return [IndustryData(**r) for r in records]
            
        except Exception as e:
            logger.error(f"Industries ICB fetch failed: {e}")
            raise ProviderError(f"Failed to fetch industries ICB: {e}", provider="vnstock")
