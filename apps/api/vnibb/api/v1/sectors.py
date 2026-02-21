import logging
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Query
from pydantic import BaseModel

from vnibb.core.cache import cached
from vnibb.core.vn_sectors import get_all_sectors
from vnibb.providers.vnstock.top_movers import (
    SectorTopMoversData as ProviderSectorData,
)
from vnibb.providers.vnstock.top_movers import (
    VnstockTopMoversFetcher,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Sectors"])


class SectorTopMoversResponse(BaseModel):
    count: int
    type: str
    sectors: list[ProviderSectorData]
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
    try:
        data = await VnstockTopMoversFetcher.fetch_sector_top_movers(
            type=type,
            limit_per_sector=limit,
        )
    except Exception as error:
        logger.warning(
            "Sector top movers fetch failed",
            extra={"type": type, "limit": limit, "error": str(error)},
        )
        data = []

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
