"""
Trading Stats Provider - Company Trading Statistics

The former company aggregate is not provided by vnstock 5 session statistics.
"""

from typing import Optional

from pydantic import BaseModel, Field

from vnibb.core.exceptions import ProviderError




# =============================================================================
# DATA MODELS
# =============================================================================

class TradingStatsData(BaseModel):
    """Company trading statistics."""
    symbol: str
    # Volume stats
    avg_volume_10d: Optional[int] = Field(None, alias="avgVolume10d")
    avg_volume_30d: Optional[int] = Field(None, alias="avgVolume30d")
    avg_volume_60d: Optional[int] = Field(None, alias="avgVolume60d")
    # Value stats
    avg_value_10d: Optional[float] = Field(None, alias="avgValue10d")
    avg_value_30d: Optional[float] = Field(None, alias="avgValue30d")
    # Price stats
    high_52w: Optional[float] = Field(None, alias="high52w")
    low_52w: Optional[float] = Field(None, alias="low52w")
    price_change_1m: Optional[float] = Field(None, alias="priceChange1m")
    price_change_3m: Optional[float] = Field(None, alias="priceChange3m")
    price_change_6m: Optional[float] = Field(None, alias="priceChange6m")
    price_change_1y: Optional[float] = Field(None, alias="priceChange1y")
    # Foreign ownership
    foreign_percent: Optional[float] = Field(None, alias="foreignPercent")
    foreign_room: Optional[int] = Field(None, alias="foreignRoom")
    # Beta
    beta: Optional[float] = None
    
    model_config = {"populate_by_name": True}


class TradingStatsQueryParams(BaseModel):
    """Query parameters for trading stats."""
    symbol: str


# =============================================================================
# FETCHER
# =============================================================================

class VnstockTradingStatsFetcher:
    """
    Fetcher for the removed company trading-statistics aggregate.
    """
    
    @staticmethod
    async def fetch(
        symbol: str,
    ) -> TradingStatsData:
        """
        Fetch trading statistics for a company.
        
        Args:
            symbol: Stock symbol
        
        Returns:
            TradingStatsData record
        """
        raise ProviderError(
            f"Company trading statistics are unavailable in vnstock 5 for {symbol.upper()}",
            provider="vnstock",
        )
