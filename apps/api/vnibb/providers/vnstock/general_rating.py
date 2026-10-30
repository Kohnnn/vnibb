"""
General Rating Provider - Company Analyst Ratings

The vnstock 5 SDK does not expose the former general-rating dataset.
"""


from pydantic import BaseModel, Field

from vnibb.core.exceptions import ProviderError

# =============================================================================
# DATA MODELS
# =============================================================================

class GeneralRatingData(BaseModel):
    """Company general rating data."""
    symbol: str
    # Valuation scores (1-5 or similar)
    valuation_score: float | None = Field(None, alias="valuationScore")
    financial_health_score: float | None = Field(None, alias="financialHealthScore")
    business_model_score: float | None = Field(None, alias="businessModelScore")
    business_operation_score: float | None = Field(None, alias="businessOperationScore")
    # Overall
    overall_score: float | None = Field(None, alias="overallScore")
    industry_rank: int | None = Field(None, alias="industryRank")
    industry_total: int | None = Field(None, alias="industryTotal")
    # Recommendation
    recommendation: str | None = None  # Buy, Hold, Sell
    target_price: float | None = Field(None, alias="targetPrice")
    upside_pct: float | None = Field(None, alias="upsidePct")

    model_config = {"populate_by_name": True}


class GeneralRatingQueryParams(BaseModel):
    """Query parameters for general rating."""
    symbol: str


# =============================================================================
# FETCHER
# =============================================================================

class VnstockGeneralRatingFetcher:
    """
    Fetcher for the removed company general-ratings dataset.
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
        raise ProviderError(
            f"General ratings are unavailable in vnstock 5 for {symbol.upper()}",
            provider="vnstock",
        )
