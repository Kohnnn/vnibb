import logging
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Query, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func, desc, or_
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.core.cache import cached
from vnibb.core.database import get_db
from vnibb.core.vn_sectors import get_all_sectors, get_sector_by_id
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models.stock import Stock
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


@router.get("/{sector}/stocks")
@cached(ttl=300, key_prefix="sector_stocks")
async def get_sector_stocks(
    sector: str,
    limit: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    sector_cfg = get_sector_by_id(sector)
    if not sector_cfg:
        raise HTTPException(status_code=404, detail=f"Unknown sector: {sector}")

    latest_snapshot_date = (
        await db.execute(select(func.max(ScreenerSnapshot.snapshot_date)))
    ).scalar()
    if latest_snapshot_date is None:
        return {"sector": sector, "count": 0, "data": []}

    stmt = (
        select(
            Stock.symbol,
            Stock.company_name,
            Stock.exchange,
            Stock.industry,
            ScreenerSnapshot.price,
            ScreenerSnapshot.market_cap,
            ScreenerSnapshot.pe,
            ScreenerSnapshot.pb,
            ScreenerSnapshot.roe,
            ScreenerSnapshot.revenue_growth,
        )
        .join(
            ScreenerSnapshot,
            (ScreenerSnapshot.symbol == Stock.symbol)
            & (ScreenerSnapshot.snapshot_date == latest_snapshot_date),
        )
        .order_by(desc(ScreenerSnapshot.market_cap))
        .limit(limit)
    )

    if sector_cfg.symbols:
        stmt = stmt.where(Stock.symbol.in_(sector_cfg.symbols))
    elif sector_cfg.keywords:
        keyword_filters = [Stock.industry.ilike(f"%{keyword}%") for keyword in sector_cfg.keywords]
        if keyword_filters:
            stmt = stmt.where(or_(*keyword_filters))

    rows = (await db.execute(stmt)).all()
    data = [
        {
            "symbol": row.symbol,
            "name": row.company_name,
            "exchange": row.exchange,
            "industry": row.industry,
            "price": row.price,
            "market_cap": row.market_cap,
            "pe": row.pe,
            "pb": row.pb,
            "roe": row.roe,
            "revenue_growth": row.revenue_growth,
        }
        for row in rows
    ]
    return {"sector": sector, "count": len(data), "data": data}
