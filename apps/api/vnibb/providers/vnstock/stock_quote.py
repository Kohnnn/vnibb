"""
Stock Quote Provider - Real-time Single Stock Quotes via quote.history()

Provides real-time price quotes for a single stock symbol using
vnstock.quote.history() with today's date to get the latest trading data.
Extracts: price, change, change_pct, volume, high, low
"""

import asyncio
import logging
from datetime import date, datetime, timedelta
from typing import Optional

from pydantic import BaseModel, Field

from vnibb.core.exceptions import ProviderError

logger = logging.getLogger(__name__)


# =============================================================================
# DATA MODELS
# =============================================================================

class StockQuoteData(BaseModel):
    """Real-time quote data for a single stock extracted from quote.history()."""
    
    symbol: str = Field(..., description="Stock ticker symbol")
    
    # Price info
    price: Optional[float] = Field(None, description="Current/close price")
    open: Optional[float] = Field(None, description="Opening price")
    high: Optional[float] = Field(None, description="Day high")
    low: Optional[float] = Field(None, description="Day low")
    prev_close: Optional[float] = Field(None, alias="prevClose", description="Previous close")
    
    # Change
    change: Optional[float] = Field(None, description="Price change from previous close")
    change_pct: Optional[float] = Field(None, alias="changePct", description="Percent change")
    
    # Volume & Value
    volume: Optional[int] = Field(None, description="Trading volume")
    value: Optional[float] = Field(None, description="Trading value")
    
    # Metadata
    updated_at: Optional[datetime] = Field(None, description="Quote timestamp")
    
    model_config = {"populate_by_name": True}


# =============================================================================
# IN-MEMORY CACHE WITH TTL
# =============================================================================

class QuoteCache:
    """Simple in-memory cache with 30-second TTL for real-time quotes."""
    
    _cache: dict = {}
    _ttl_seconds: int = 30
    
    @classmethod
    def get(cls, symbol: str) -> Optional[tuple[StockQuoteData, datetime]]:
        """Get cached quote if not expired."""
        if symbol in cls._cache:
            data, timestamp = cls._cache[symbol]
            if datetime.utcnow() - timestamp < timedelta(seconds=cls._ttl_seconds):
                return data, timestamp
            # Expired, remove from cache
            del cls._cache[symbol]
        return None
    
    @classmethod
    def set(cls, symbol: str, data: StockQuoteData) -> None:
        """Store quote in cache."""
        cls._cache[symbol] = (data, datetime.utcnow())
    
    @classmethod
    def is_fresh(cls, symbol: str) -> bool:
        """Check if cache entry exists and is fresh."""
        return cls.get(symbol) is not None


# =============================================================================
# FETCHER
# =============================================================================

class VnstockStockQuoteFetcher:
    """
    Fetcher for real-time stock price quotes via vnstock quote.history().
    
    Uses today's date to fetch the latest trading data and extracts
    relevant quote fields. Implements 30-second caching for freshness.
    """
    
    @staticmethod
    async def fetch(
        symbol: str,
        source: str = "KBS",
        use_cache: bool = True,
    ) -> tuple[StockQuoteData, bool]:
        """
        Fetch real-time quote for a single stock.
        
        Args:
            symbol: Stock ticker symbol (e.g., 'VNM', 'FPT')
            source: Data source (KBS default)
            use_cache: Whether to use 30-second cache
        
        Returns:
            Tuple of (StockQuoteData, is_cached: bool)
        """

        symbol = symbol.upper().strip()
        
        # Check cache first
        if use_cache:
            cached = QuoteCache.get(symbol)
            if cached:
                data, _ = cached
                return data, True
        
        try:
            def _fetch():
                # Get today and yesterday for quote.history()
                today = date.today()
                # Fetch last 3 days to ensure we get data even on weekends/holidays
                start_date = today - timedelta(days=5)
                
                from vnstock import Vnstock
                stock = Vnstock().stock(
                    symbol=symbol,
                    source=source.upper(),
                )
                
                # Fetch historical data for recent days
                df = stock.quote.history(
                    start=start_date.isoformat(),
                    end=today.isoformat(),
                    interval="1D",
                )
                
                if df is None or df.empty:
                    return None
                
                # Get the latest record (most recent trading day)
                records = df.to_dict(orient="records")
                if not records:
                    return None
                
                latest = records[-1]  # Last record is most recent
                prev = records[-2] if len(records) >= 2 else None
                
                return latest, prev
            
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(None, _fetch)
            
            if not result:
                # Return empty quote if no data
                empty_quote = StockQuoteData(
                    symbol=symbol,
                    updated_at=datetime.utcnow(),
                )
                return empty_quote, False
            
            latest, prev = result
            
            # Extract close price
            price = float(latest.get("close") or latest.get("price") or 0)
            
            # Calculate prev_close and change
            prev_close = None
            change = None
            change_pct = None
            
            if prev:
                prev_close = float(prev.get("close") or prev.get("price") or 0)
                if prev_close > 0:
                    change = price - prev_close
                    change_pct = (change / prev_close) * 100
            
            quote_data = StockQuoteData(
                symbol=symbol,
                price=price,
                open=float(latest.get("open") or 0) if latest.get("open") else None,
                high=float(latest.get("high") or 0) if latest.get("high") else None,
                low=float(latest.get("low") or 0) if latest.get("low") else None,
                prev_close=prev_close,
                change=change,
                change_pct=round(change_pct, 2) if change_pct is not None else None,
                volume=int(latest.get("volume") or 0) if latest.get("volume") else None,
                value=float(latest.get("value") or 0) if latest.get("value") else None,
                updated_at=datetime.utcnow(),
            )
            
            # Store in cache
            if use_cache:
                QuoteCache.set(symbol, quote_data)
            
            return quote_data, False
            
        except Exception as e:
            logger.error(f"Stock quote fetch failed for {symbol}: {e}")
            # Return empty quote instead of raising - graceful degradation
            empty_quote = StockQuoteData(
                symbol=symbol,
                updated_at=datetime.utcnow(),
            )
            return empty_quote, False
