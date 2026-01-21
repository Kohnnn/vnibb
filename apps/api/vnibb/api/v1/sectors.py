from fastapi import APIRouter, Query
from typing import List, Optional, Literal
from pydantic import BaseModel
from vnibb.core.vn_sectors import VN_SECTORS, get_all_sectors
from vnibb.providers.vnstock.top_movers import VnstockTopMoversFetcher, SectorTopMoversData as ProviderSectorData
from datetime import datetime

from vnibb.core.cache import cached

router = APIRouter(prefix="/sectors", tags=["Sectors"])

class SectorTopMoversResponse(BaseModel):
    count: int
    type: str
    sectors: List[ProviderSectorData]
    updated_at: str

@router.get("/top-movers", response_model=SectorTopMoversResponse)
@cached(ttl=60, key_prefix="sector_top_movers")
async def get_sector_top_movers(
    type: Literal["gainers", "losers"] = Query(default="gainers"),
    limit: int = Query(5, ge=1, le=10),
):
    """
    Get top gainers and losers grouped by sector/industry using vnstock.
    """
    data = await VnstockTopMoversFetcher.fetch_sector_top_movers(
        type=type,
        limit_per_sector=limit
    )
    
    return SectorTopMoversResponse(
        count=len(data),
        type=type,
        sectors=data,
        updated_at=datetime.now().isoformat(),
    )

@router.get("")
async def list_sectors():
    """List all available sectors."""
    return get_all_sectors()
