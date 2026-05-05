"""
General Rating Provider - Company Analyst Ratings

Provides analyst ratings and recommendations for stocks.
Uses vnstock company.general_rating() method.
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

class GeneralRatingData(BaseModel):
    """Company general rating data."""
    symbol: str
    # Valuation scores (1-5 or similar)
    valuation_score: Optional[float] = Field(None, alias="valuationScore")
    financial_health_score: Optional[float] = Field(None, alias="financialHealthScore")
    business_model_score: Optional[float] = Field(None, alias="businessModelScore")
    business_operation_score: Optional[float] = Field(None, alias="businessOperationScore")
    # Overall
    overall_score: Optional[float] = Field(None, alias="overallScore")
    industry_rank: Optional[int] = Field(None, alias="industryRank")
    industry_total: Optional[int] = Field(None, alias="industryTotal")
    # Recommendation
    recommendation: Optional[str] = None  # Buy, Hold, Sell
    target_price: Optional[float] = Field(None, alias="targetPrice")
    upside_pct: Optional[float] = Field(None, alias="upsidePct")
    
    model_config = {"populate_by_name": True}


class GeneralRatingQueryParams(BaseModel):
    """Query parameters for general rating."""
    symbol: str


# =============================================================================
# FETCHER
# =============================================================================

class VnstockGeneralRatingFetcher:
    """
    Fetcher for company general ratings.
    
    Wraps vnstock company.general_rating() method (VCI source).
    """
    
    @staticmethod
    async def fetch(symbol: str) -> GeneralRatingData:
        """
        Fetch general rating for a company.
        
        Args:
            symbol: Stock symbol
        
        Returns:
            GeneralRatingData record
        """
        try:
            def _fetch():
                from vnstock import Vnstock
                stock = Vnstock().stock(symbol=symbol.upper(), source=settings.vnstock_source)
                df = stock.company.general_rating()
                if df is None or len(df) == 0:
                    return {}
                return df.to_dict(orient="records")[0] if len(df) > 0 else {}
            
            loop = asyncio.get_event_loop()
            record = await loop.run_in_executor(None, _fetch)
            
            return GeneralRatingData(
                symbol=symbol.upper(),
                valuation_score=record.get("valuation") or record.get("valuationScore"),
                financial_health_score=record.get("financial_health") or record.get("financialHealthScore"),
                business_model_score=record.get("business_model") or record.get("businessModelScore"),
                business_operation_score=record.get("business_operation") or record.get("businessOperationScore"),
                overall_score=record.get("overall") or record.get("overallScore") or record.get("score"),
                industry_rank=record.get("industry_rank") or record.get("industryRank"),
                industry_total=record.get("industry_total") or record.get("industryTotal"),
                recommendation=record.get("recommendation") or record.get("action"),
                target_price=record.get("target_price") or record.get("targetPrice"),
                upside_pct=record.get("upside") or record.get("upsidePct"),
            )
            
        except Exception as e:
            logger.error(f"General rating fetch failed for {symbol}: {e}")
            raise ProviderError(f"Failed to fetch general rating for {symbol}: {e}")
