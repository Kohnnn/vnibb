"""
Derivatives API Endpoints

Provides endpoints for futures and derivatives data.
"""

from datetime import date, timedelta
from typing import List

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from vnibb.providers.vnstock.derivatives import (
    VnstockDerivativesFetcher,
    DerivativePriceData,
)
from vnibb.core.exceptions import ProviderError

router = APIRouter()


# =============================================================================
# RESPONSE MODELS
# =============================================================================

class DerivativesHistoryResponse(BaseModel):
    """Response for derivatives history."""
    symbol: str
    count: int
    data: List[DerivativePriceData]


class DerivativesContractsResponse(BaseModel):
    """Response for available contracts."""
    contracts: List[str]


# =============================================================================
# ENDPOINTS
# =============================================================================

@router.get(
    "/contracts",
    response_model=DerivativesContractsResponse,
    summary="List Available Contracts",
    description="Get list of available derivatives contract symbols.",
)
async def list_contracts() -> DerivativesContractsResponse:
    """List available derivatives contracts."""
    contracts = await VnstockDerivativesFetcher.list_contracts()
    return DerivativesContractsResponse(contracts=contracts)


@router.get(
    "/{symbol}/history",
    response_model=DerivativesHistoryResponse,
    summary="Get Derivatives History",
    description="Get historical price data for a futures contract.",
)
async def get_derivatives_history(
    symbol: str,
    start_date: date = Query(
        default_factory=lambda: date.today() - timedelta(days=365),
        description="Start date (YYYY-MM-DD)",
    ),
    end_date: date = Query(
        default_factory=date.today,
        description="End date (YYYY-MM-DD)",
    ),
    interval: str = Query(
        default="1D",
        pattern=r"^(1m|5m|15m|30m|1H|1D|1W|1M)$",
        description="Data interval",
    ),
) -> DerivativesHistoryResponse:
    """Fetch historical derivatives price data."""
    try:
        data = await VnstockDerivativesFetcher.fetch(
            symbol=symbol.upper(),
            start_date=start_date,
            end_date=end_date,
            interval=interval,
        )
        return DerivativesHistoryResponse(
            symbol=symbol.upper(),
            count=len(data),
            data=data,
        )
    except ProviderError as e:
        raise HTTPException(status_code=502, detail=f"Provider error: {e.message}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
