"""
Stock Price Provider - Real-time Single Stock Quotes

Provides real-time price quotes for a single stock symbol.
Optimized wrapper around Trading.price_board() for single-stock use case.
"""

import asyncio
import logging
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from vnibb.core.exceptions import ProviderError

logger = logging.getLogger(__name__)


# =============================================================================
# DATA MODELS
# =============================================================================

class StockQuoteQueryParams(BaseModel):
    """Query parameters for stock quote."""
    symbol: str
    source: str = "KBS"



class StockQuoteData(BaseModel):
    """Real-time quote data for a single stock."""
    
    symbol: str = Field(..., description="Stock ticker symbol")
    
    # Price info
    price: Optional[float] = Field(None, description="Current/last price")
    open: Optional[float] = Field(None, description="Opening price")
    high: Optional[float] = Field(None, description="Day high")
    low: Optional[float] = Field(None, description="Day low")
    prev_close: Optional[float] = Field(None, alias="prevClose", description="Previous close")
    
    # Change
    change: Optional[float] = Field(None, description="Price change")
    percent_change: Optional[float] = Field(None, alias="percentChange", description="Percent change")
    
    # Volume & Value
    volume: Optional[int] = Field(None, description="Trading volume")
    value: Optional[float] = Field(None, description="Trading value")
    
    # Bid/Ask
    best_bid: Optional[float] = Field(None, alias="bestBid", description="Best bid price")
    best_ask: Optional[float] = Field(None, alias="bestAsk", description="Best ask price")
    best_bid_vol: Optional[int] = Field(None, alias="bestBidVol", description="Best bid volume")
    best_ask_vol: Optional[int] = Field(None, alias="bestAskVol", description="Best ask volume")
    
    # Foreign trading
    foreign_buy_vol: Optional[int] = Field(None, alias="foreignBuyVol", description="Foreign buy volume")
    foreign_sell_vol: Optional[int] = Field(None, alias="foreignSellVol", description="Foreign sell volume")
    
    # Reference prices
    ceiling: Optional[float] = Field(None, description="Ceiling price")
    floor: Optional[float] = Field(None, description="Floor price")
    reference: Optional[float] = Field(None, description="Reference price")
    
    # Metadata
    updated_at: Optional[datetime] = Field(None, description="Quote timestamp")
    
    model_config = {"populate_by_name": True}


# =============================================================================
# FETCHER
# =============================================================================

class VnstockStockPriceFetcher:
    """
    Fetcher for real-time stock price quotes.
    
    Wraps vnstock Trading.price_board() for single-stock queries.
    Returns comprehensive quote data including bid/ask spreads.
    """
    
    @staticmethod
    async def fetch(
        symbol: str,
        source: str = "KBS",
    ) -> StockQuoteData:

        """
        Fetch real-time quote for a single stock.
        
        Args:
            symbol: Stock ticker symbol (e.g., 'VNM', 'FPT')
            source: Data source (VCI recommended)
        
        Returns:
            StockQuoteData with current price and market data
        """
        symbol = symbol.upper().strip()
        
        try:
            def _fetch():
                from vnstock import Trading
                trading = Trading(source=source.upper())

                df = trading.price_board(
                    symbols_list=[symbol],
                    flatten_columns=True,
                    drop_levels=[0],
                )
                if df is None or df.empty:
                    return None
                return df.to_dict(orient="records")[0]
            
            loop = asyncio.get_event_loop()
            record = await loop.run_in_executor(None, _fetch)
            
            if not record:
                # Return empty quote if no data
                return StockQuoteData(
                    symbol=symbol,
                    updated_at=datetime.utcnow(),
                )
            
            # Map vnstock column names to our schema
            # VCI uses snake_case, handle multiple possible column names
            return StockQuoteData(
                symbol=symbol,
                price=record.get("price") or record.get("match_price") or record.get("matchPrice"),
                open=record.get("open") or record.get("open_price") or record.get("openPrice"),
                high=record.get("high") or record.get("high_price") or record.get("highPrice"),
                low=record.get("low") or record.get("low_price") or record.get("lowPrice"),
                prev_close=record.get("prev_close") or record.get("ref_price") or record.get("refPrice"),
                change=record.get("change") or record.get("price_change") or record.get("priceChange"),
                percent_change=record.get("percent_change") or record.get("pct_change") or record.get("pctChange"),
                volume=record.get("volume") or record.get("total_volume") or record.get("nmTotalTradedQty"),
                value=record.get("value") or record.get("total_value") or record.get("nmTotalTradedValue"),
                best_bid=record.get("best_bid") or record.get("bid_1_price") or record.get("bidPrice1"),
                best_ask=record.get("best_ask") or record.get("ask_1_price") or record.get("offerPrice1"),
                best_bid_vol=record.get("best_bid_vol") or record.get("bid_1_volume") or record.get("bidVol1"),
                best_ask_vol=record.get("best_ask_vol") or record.get("ask_1_volume") or record.get("offerVol1"),
                foreign_buy_vol=record.get("foreign_buy_vol") or record.get("f_buy_vol") or record.get("fBuyVol"),
                foreign_sell_vol=record.get("foreign_sell_vol") or record.get("f_sell_vol") or record.get("fSellVol"),
                ceiling=record.get("ceiling") or record.get("ceiling_price") or record.get("ceilingPrice"),
                floor=record.get("floor") or record.get("floor_price") or record.get("floorPrice"),
                reference=record.get("reference") or record.get("ref_price") or record.get("refPrice"),
                updated_at=datetime.utcnow(),
            )
            
        except Exception as e:
            logger.error(f"Stock price fetch failed for {symbol}: {e}")
            raise ProviderError(f"Failed to fetch quote for {symbol}: {e}")
