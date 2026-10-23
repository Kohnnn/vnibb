"""
Stock Quote Provider - Real-time Single Stock Quotes via quote.history()

Provides real-time price quotes for a single stock symbol using
vnstock.quote.history() with today's date to get the latest trading data.
Extracts: price, change, change_pct, volume, high, low
"""

import logging
from datetime import date, datetime, timedelta
from typing import Optional

from pydantic import BaseModel, Field

from vnibb.core.config import settings
from vnibb.core.price_units import PriceUnit, history_price_records
from vnibb.providers.vnstock.runtime import run_reference_provider, validate_source

logger = logging.getLogger(__name__)


def _coerce_quote_timestamp(value: object, *, preserve_timezone: bool = False) -> Optional[datetime]:
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime.combine(value, datetime.min.time())
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        if text.endswith("Z"):
            text = f"{text[:-1]}+00:00"
        for parser in (
            lambda raw: datetime.fromisoformat(raw),
            lambda raw: datetime.strptime(raw, "%Y-%m-%d"),
        ):
            try:
                parsed = parser(text)
                return parsed if preserve_timezone else parsed.replace(tzinfo=None)
            except ValueError:
                continue
    return None


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
    price_unit: PriceUnit = Field(default="unknown", description="Canonical price unit")
    as_of: Optional[datetime] = Field(None, description="Admitted source observation time, not receipt time")
    upstream_source: Optional[str] = Field(None, description="Raw source lineage when supplied; not certified by serving storage")
    
    model_config = {"populate_by_name": True}


# =============================================================================
# IN-MEMORY CACHE WITH TTL
# =============================================================================

class QuoteCache:
    """Simple in-memory cache with 30-second TTL for real-time quotes."""
    
    _cache: dict = {}
    _ttl_seconds: int = 30
    _max_size: int = 50

    @classmethod
    def _prune_expired(cls, now: datetime) -> None:
        for key, (_, timestamp) in list(cls._cache.items()):
            if now - timestamp >= timedelta(seconds=cls._ttl_seconds):
                del cls._cache[key]
    
    @classmethod
    def get(cls, symbol: str) -> Optional[tuple[StockQuoteData, datetime]]:
        """Get cached quote if not expired."""
        cls._prune_expired(datetime.utcnow())
        return cls._cache.get(symbol)
    
    @classmethod
    def set(cls, symbol: str, data: StockQuoteData) -> None:
        """Store quote in cache."""
        now = datetime.utcnow()
        cls._prune_expired(now)
        if symbol not in cls._cache and len(cls._cache) >= cls._max_size:
            del cls._cache[next(iter(cls._cache))]
        cls._cache[symbol] = (data, now)
    
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
        source: str = "VCI",
        use_cache: bool = True,
        *,
        wait_for_completion: bool = False,
    ) -> tuple[StockQuoteData, bool]:
        """
        Fetch real-time quote for a single stock.
        
        Args:
            symbol: Stock ticker symbol (e.g., 'VNM', 'FPT')
            source: Free VCI data source
            use_cache: Whether to use 30-second cache
            wait_for_completion: Retain background ownership until the sync worker finishes
        
        Returns:
            Tuple of (StockQuoteData, is_cached: bool)
        """

        source = validate_source(source)
        symbol = symbol.upper().strip()
        cache_key = f"{source.upper()}:{symbol}"
        
        # Check cache first
        if use_cache:
            cached = QuoteCache.get(cache_key)
            if cached:
                data, _ = cached
                return data, True
        
        try:
            def _fetch():
                # Get today and yesterday for quote.history()
                today = date.today()
                # Fetch last 3 days to ensure we get data even on weekends/holidays
                start_date = today - timedelta(days=5)
                
                from vnibb.providers.vnstock.runtime import get_vnstock_class

                Vnstock = get_vnstock_class()
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
                
                records = history_price_records(df, symbol=symbol, source=source, provider=stock.quote)
                if not records:
                    return None
                
                latest = records[-1]  # Last record is most recent
                prev = records[-2] if len(records) >= 2 else None
                
                return latest, prev
            
            result = await run_reference_provider(
                _fetch, None if wait_for_completion else settings.vnstock_timeout,
                key=("stock_quote", source, symbol),
            )
            
            if not result:
                return StockQuoteData(symbol=symbol), False
            
            latest, prev = result
            
            # A missing close is not a zero-price trade.
            raw_price = latest.get("close")
            if raw_price is None:
                raw_price = latest.get("price")
            price = float(raw_price) if raw_price is not None else None
            if price is None:
                return StockQuoteData(symbol=symbol), False
            
            # Calculate prev_close and change
            prev_close = None
            change = None
            change_pct = None
            
            if prev and prev["price_unit"] == latest["price_unit"] and latest["price_unit"] != "unknown":
                raw_prev_close = prev.get("close")
                if raw_prev_close is None:
                    raw_prev_close = prev.get("price")
                prev_close = float(raw_prev_close) if raw_prev_close is not None else None
                if price is not None and prev_close is not None and prev_close > 0:
                    change = price - prev_close
                    change_pct = (change / prev_close) * 100
            
            quote_data = StockQuoteData(
                symbol=symbol,
                price_unit=latest["price_unit"],
                price=price,
                open=float(latest.get("open") or 0) if latest.get("open") else None,
                high=float(latest.get("high") or 0) if latest.get("high") else None,
                low=float(latest.get("low") or 0) if latest.get("low") else None,
                prev_close=prev_close,
                change=change,
                change_pct=round(change_pct, 2) if change_pct is not None else None,
                volume=int(latest.get("volume") or 0) if latest.get("volume") else None,
                value=float(latest.get("value") or 0) if latest.get("value") else None,
                updated_at=_coerce_quote_timestamp(
                    latest.get("updated_at") or latest.get("time") or latest.get("date")
                ),
                as_of=_coerce_quote_timestamp(latest.get("time") or latest.get("date"), preserve_timezone=True),
                upstream_source=latest.get("source"),
            )
            
            # Store in cache
            if use_cache and quote_data.price is not None:
                QuoteCache.set(cache_key, quote_data)
            
            return quote_data, False
            
        except Exception as e:
            error_text = str(e).lower()
            if "invalid symbol" in error_text or "symbol format" in error_text:
                logger.warning(f"Stock quote rejected for invalid symbol {symbol}: {e}")
            else:
                logger.error(f"Stock quote fetch failed for {symbol}: {e}")
            return StockQuoteData(symbol=symbol), False
