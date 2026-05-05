"""
Price Board Provider - Real-time Multi-Stock Prices

Provides real-time price board data for multiple symbols simultaneously.
Uses vnstock Trading.price_board() method.
"""

import asyncio
import logging
from typing import List, Optional

from pydantic import BaseModel, Field

from vnibb.core.exceptions import ProviderError

logger = logging.getLogger(__name__)


# =============================================================================
# DATA MODELS
# =============================================================================

class PriceBoardData(BaseModel):
    """Real-time price board data for a single stock."""
    symbol: str
    # Price info
    price: Optional[float] = None
    open: Optional[float] = None
    high: Optional[float] = None
    low: Optional[float] = None
    close: Optional[float] = None
    prev_close: Optional[float] = Field(None, alias="prevClose")
    # Change
    change: Optional[float] = None
    percent_change: Optional[float] = Field(None, alias="percentChange")
    # Volume
    volume: Optional[int] = None
    value: Optional[float] = None
    # Bid/Ask
    best_bid: Optional[float] = Field(None, alias="bestBid")
    best_ask: Optional[float] = Field(None, alias="bestAsk")
    best_bid_vol: Optional[int] = Field(None, alias="bestBidVol")
    best_ask_vol: Optional[int] = Field(None, alias="bestAskVol")
    # Foreign trading
    foreign_buy_vol: Optional[int] = Field(None, alias="foreignBuyVol")
    foreign_sell_vol: Optional[int] = Field(None, alias="foreignSellVol")
    # Reference prices
    ceiling: Optional[float] = None
    floor: Optional[float] = None
    reference: Optional[float] = None
    
    model_config = {"populate_by_name": True}


class PriceBoardQueryParams(BaseModel):
    """Query parameters for price board."""
    symbols: List[str]
    source: str = "KBS"



# =============================================================================
# FETCHER
# =============================================================================

class VnstockPriceBoardFetcher:
    """
    Fetcher for real-time price board data.
    
    Wraps vnstock Trading.price_board() for monitoring
    multiple stocks simultaneously.
    """
    
    @staticmethod
    async def fetch(
        symbols: List[str],
        source: str = "KBS",
    ) -> List[PriceBoardData]:

        """
        Fetch real-time price board for multiple symbols.
        
        Args:
            symbols: List of stock symbols (e.g., ['VNM', 'FPT', 'VIC'])
            source: Data source (VCI recommended)
        
        Returns:
            List of PriceBoardData records
        """
        if not symbols:
            return []
        
        try:
            def _fetch():
                from vnstock import Trading
                trading = Trading(source=source.upper())

                df = trading.price_board(
                    symbols_list=[s.upper() for s in symbols],
                    flatten_columns=True,
                    drop_levels=[0],
                )
                return df.to_dict(orient="records") if df is not None and len(df) > 0 else []
            
            loop = asyncio.get_event_loop()
            records = await loop.run_in_executor(None, _fetch)
            
            # Normalize column names and build response
            result = []
            for r in records:
                # Extract symbol from record
                symbol = r.get("symbol") or r.get("ticker") or r.get("code")
                if not symbol:
                    continue
                
                result.append(PriceBoardData(
                    symbol=symbol,
                    price=r.get("price") or r.get("matchPrice") or r.get("match_price"),
                    open=r.get("open") or r.get("openPrice"),
                    high=r.get("high") or r.get("highPrice"),
                    low=r.get("low") or r.get("lowPrice"),
                    close=r.get("close") or r.get("closePrice"),
                    prev_close=r.get("prevClose") or r.get("refPrice") or r.get("ref"),
                    change=r.get("change") or r.get("priceChange"),
                    percent_change=r.get("percentChange") or r.get("pctChange"),
                    volume=r.get("volume") or r.get("nmTotalTradedQty"),
                    value=r.get("value") or r.get("nmTotalTradedValue"),
                    best_bid=r.get("bestBid") or r.get("bidPrice1"),
                    best_ask=r.get("bestAsk") or r.get("offerPrice1"),
                    best_bid_vol=r.get("bestBidVol") or r.get("bidVol1"),
                    best_ask_vol=r.get("bestAskVol") or r.get("offerVol1"),
                    foreign_buy_vol=r.get("foreignBuyVol") or r.get("fBuyVol"),
                    foreign_sell_vol=r.get("foreignSellVol") or r.get("fSellVol"),
                    ceiling=r.get("ceiling") or r.get("ceilingPrice"),
                    floor=r.get("floor") or r.get("floorPrice"),
                    reference=r.get("reference") or r.get("refPrice"),
                ))
            
            return result
            
        except Exception as e:
            logger.error(f"Price board fetch failed: {e}")
            raise ProviderError(f"Failed to fetch price board: {e}")
