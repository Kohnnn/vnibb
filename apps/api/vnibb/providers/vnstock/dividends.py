"""
Dividends Provider - Dividend History

Provides access to dividend payment history.
Uses vnstock company.dividends() method.
"""

import asyncio
import logging
from typing import List, Optional

from pydantic import BaseModel, Field

from vnibb.core.config import settings
from vnibb.core.exceptions import ProviderError

logger = logging.getLogger(__name__)


# =============================================================================
# DATA MODELS
# =============================================================================

class DividendData(BaseModel):
    """Dividend payment record."""
    symbol: str
    # Dates
    ex_date: Optional[str] = Field(None, alias="exDate")
    record_date: Optional[str] = Field(None, alias="recordDate")
    payment_date: Optional[str] = Field(None, alias="paymentDate")
    # Dividend info
    dividend_type: Optional[str] = Field(None, alias="type")
    cash_dividend: Optional[float] = Field(None, alias="cashDividend")
    stock_dividend: Optional[float] = Field(None, alias="stockDividend")
    dividend_ratio: Optional[str] = Field(None, alias="ratio")
    # Year
    fiscal_year: Optional[int] = Field(None, alias="year")
    issue_year: Optional[int] = Field(None, alias="issueYear")
    # Description
    description: Optional[str] = None
    
    model_config = {"populate_by_name": True}


class DividendsQueryParams(BaseModel):
    """Query parameters for dividends."""
    symbol: str


# =============================================================================
# FETCHER
# =============================================================================

class VnstockDividendsFetcher:
    """
    Fetcher for dividend payment history.
    
    Wraps vnstock company.dividends() method.
    """
    
    @staticmethod
    async def fetch(
        symbol: str,
    ) -> List[DividendData]:
        """
        Fetch dividend history for a company.
        
        Args:
            symbol: Stock symbol
        
        Returns:
            List of DividendData records
        """
        try:
            def _fetch():
                from vnstock import Vnstock
                # Prefer settings source
                try:
                    stock = Vnstock().stock(symbol=symbol.upper(), source=settings.vnstock_source)
                    # Try direct dividends first
                    df = stock.company.dividends()
                    if df is not None and len(df) > 0:
                        return df.to_dict(orient="records")
                    
                    # Fallback to events for VCI
                    df_events = stock.company.events()
                    if df_events is not None and len(df_events) > 0:
                        dividend_events = df_events[df_events["eventType"].str.contains("dividend", case=False, na=False)]
                        if len(dividend_events) > 0:
                            return dividend_events.to_dict(orient="records")
                except Exception as e:
                    logger.debug(f"{settings.vnstock_source} dividends failed for {symbol}: {e}")

                # Fallback to TCBS (though it may fail)
                try:
                    stock = Vnstock().stock(symbol=symbol.upper(), source="TCBS")
                    df = stock.company.dividends()
                    if df is not None and len(df) > 0:
                        return df.to_dict(orient="records")
                except:
                    pass
                
                return []
            
            loop = asyncio.get_event_loop()
            records = await loop.run_in_executor(None, _fetch)
            
            result = []
            for r in records:
                result.append(DividendData(
                    symbol=symbol.upper(),
                    ex_date=str(r.get("exDate") or r.get("exRightDate")) if r.get("exDate") or r.get("exRightDate") else None,
                    record_date=str(r.get("recordDate")) if r.get("recordDate") else None,
                    payment_date=str(r.get("paymentDate") or r.get("executeDate")) if r.get("paymentDate") or r.get("executeDate") else None,
                    dividend_type=r.get("type") or r.get("eventType"),
                    cash_dividend=r.get("cashDividend") or r.get("cashDividen"),
                    stock_dividend=r.get("stockDividend") or r.get("stockDividen"),
                    dividend_ratio=r.get("ratio") or r.get("dividendRatio"),
                    fiscal_year=r.get("year") or r.get("fiscalYear"),
                    issue_year=r.get("issueYear"),
                    description=r.get("description") or r.get("eventDesc"),
                ))
            
            return result
            
        except Exception as e:
            logger.error(f"Dividends fetch failed for {symbol}: {e}")
            raise ProviderError(f"Failed to fetch dividends for {symbol}: {e}")
