"""
Trading Stats Provider - Company Trading Statistics

Provides trading statistics for a company.
Uses vnstock company.trading_stats() method (VCI only).
"""

import asyncio
import logging
from typing import Optional

from pydantic import BaseModel, Field

from vnibb.core.config import settings
from vnibb.core.exceptions import ProviderError


logger = logging.getLogger(__name__)


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
    Fetcher for company trading statistics.
    
    Wraps vnstock company.trading_stats() method (VCI source only).
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
        try:
            def _fetch():
                from vnstock import Vnstock
                # trading_stats is primarily a VCI source feature
                # we try settings source first, then fallback to VCI if needed
                stock = Vnstock().stock(symbol=symbol.upper(), source=settings.vnstock_source)


                df = stock.company.trading_stats()
                if df is None or len(df) == 0:
                    return {}
                return df.to_dict(orient="records")[0] if len(df) > 0 else {}
            
            loop = asyncio.get_event_loop()
            record = await loop.run_in_executor(None, _fetch)
            
            return TradingStatsData(
                symbol=symbol.upper(),
                avg_volume_10d=record.get("avgVolume10d") or record.get("aveVolume10d"),
                avg_volume_30d=record.get("avgVolume30d") or record.get("aveVolume30d"),
                avg_volume_60d=record.get("avgVolume60d") or record.get("aveVolume60d"),
                avg_value_10d=record.get("avgValue10d") or record.get("aveValue10d"),
                avg_value_30d=record.get("avgValue30d") or record.get("aveValue30d"),
                high_52w=record.get("high52w") or record.get("highest52Week"),
                low_52w=record.get("low52w") or record.get("lowest52Week"),
                price_change_1m=record.get("priceChange1m") or record.get("percentChange1m"),
                price_change_3m=record.get("priceChange3m") or record.get("percentChange3m"),
                price_change_6m=record.get("priceChange6m") or record.get("percentChange6m"),
                price_change_1y=record.get("priceChange1y") or record.get("percentChange1y"),
                foreign_percent=record.get("foreignPercent") or record.get("foreignOwnership"),
                foreign_room=record.get("foreignRoom") or record.get("roomForeignRemain"),
                beta=record.get("beta"),
            )
            
        except Exception as e:
            logger.error(f"Trading stats fetch failed for {symbol}: {e}")
            raise ProviderError(f"Failed to fetch trading stats for {symbol}: {e}")
