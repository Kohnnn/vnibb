"""
Derivatives Provider - Futures Contract Data

Provides access to derivatives/futures price data.
Uses vnstock quote.history() for derivatives symbols like VN30F1M.
"""

import asyncio
import logging
from datetime import date, timedelta
from typing import List, Optional

from pydantic import BaseModel, Field

from vnibb.core.config import settings
from vnibb.core.exceptions import ProviderError

logger = logging.getLogger(__name__)


# =============================================================================
# DATA MODELS
# =============================================================================

class DerivativePriceData(BaseModel):
    """Derivatives/futures price data."""
    symbol: str
    time: str
    open: Optional[float] = None
    high: Optional[float] = None
    low: Optional[float] = None
    close: Optional[float] = None
    volume: Optional[int] = None
    open_interest: Optional[int] = Field(None, alias="openInterest")
    
    model_config = {"populate_by_name": True}


class DerivativeContractInfo(BaseModel):
    """Derivatives contract information."""
    symbol: str
    underlying: str = "VN30"
    contract_type: str = Field(alias="contractType")
    expiry_date: Optional[str] = Field(None, alias="expiryDate")
    
    model_config = {"populate_by_name": True}


class DerivativesQueryParams(BaseModel):
    """Query parameters for derivatives."""
    symbol: str
    start_date: date
    end_date: date
    interval: str = "1D"


# =============================================================================
# CONSTANTS
# =============================================================================

# Common derivatives symbols
DERIVATIVES_SYMBOLS = [
    "VN30F1M",   # VN30 Futures - 1st month
    "VN30F2M",   # VN30 Futures - 2nd month
    "VN30F1Q",   # VN30 Futures - 1st quarter
    "VN30F2Q",   # VN30 Futures - 2nd quarter
]


# =============================================================================
# FETCHER
# =============================================================================

class VnstockDerivativesFetcher:
    """
    Fetcher for derivatives/futures price data.
    
    Wraps vnstock quote.history() for derivatives symbols.
    """
    
    @staticmethod
    async def fetch(
        symbol: str,
        start_date: date,
        end_date: date,
        interval: str = "1D",
    ) -> List[DerivativePriceData]:
        """
        Fetch historical price data for a derivatives contract.
        
        Args:
            symbol: Derivatives symbol (e.g., VN30F1M, VN30F2411)
            start_date: Start date
            end_date: End date
            interval: Data interval (1D, 1H, etc.)
        
        Returns:
            List of DerivativePriceData records
        """
        try:
            def _fetch():
                stock = Vnstock().stock(symbol=symbol.upper(), source=settings.vnstock_source)
                df = stock.quote.history(
                    start=start_date.strftime("%Y-%m-%d"),
                    end=end_date.strftime("%Y-%m-%d"),
                    interval=interval,
                )
                return df.to_dict(orient="records") if df is not None and len(df) > 0 else []
            
            loop = asyncio.get_event_loop()
            records = await loop.run_in_executor(None, _fetch)
            
            result = []
            for r in records:
                result.append(DerivativePriceData(
                    symbol=symbol.upper(),
                    time=str(r.get("time") or r.get("date")),
                    open=r.get("open"),
                    high=r.get("high"),
                    low=r.get("low"),
                    close=r.get("close"),
                    volume=r.get("volume"),
                    open_interest=r.get("openInterest") or r.get("oi"),
                ))
            
            return result
            
        except Exception as e:
            logger.error(f"Derivatives fetch failed for {symbol}: {e}")
            raise ProviderError(f"Failed to fetch derivatives data for {symbol}: {e}")
    
    @staticmethod
    async def list_contracts() -> List[str]:
        """
        List available derivatives contract symbols.
        
        Returns:
            List of common derivatives symbols
        """
        return DERIVATIVES_SYMBOLS.copy()
