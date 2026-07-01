"""Prediction market read endpoints."""

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.core.database import get_db
from vnibb.models.prediction_market import PredictionMarket

router = APIRouter()


class PredictionMarketRead(BaseModel):
    """Prediction market response row."""

    model_config = ConfigDict(from_attributes=True, frozen=True)

    source: str
    source_id: str
    question: str
    slug: str | None
    description: str | None
    category: str | None
    url: str | None
    end_date: datetime | None
    active: bool
    closed: bool
    volume: float | None
    liquidity: float | None
    outcomes: list[str]
    outcome_prices: list[float]
    updated_at: datetime


class PredictionMarketsResponse(BaseModel):
    """Prediction market list response."""

    model_config = ConfigDict(frozen=True)

    count: int
    data: list[PredictionMarketRead]


@router.get("", response_model=PredictionMarketsResponse)
async def list_prediction_markets(
    source: str | None = Query(default=None, pattern=r"^[a-z][a-z0-9_-]{1,31}$"),
    active: bool | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
) -> PredictionMarketsResponse:
    """Return persisted prediction markets from the database."""
    stmt = select(PredictionMarket).order_by(
        PredictionMarket.end_date.is_(None),
        PredictionMarket.end_date.asc(),
        PredictionMarket.id.asc(),
    )
    if source is not None:
        stmt = stmt.where(PredictionMarket.source == source)
    if active is not None:
        stmt = stmt.where(PredictionMarket.active.is_(active))
    try:
        result = await db.execute(stmt.limit(limit))
    except (OperationalError, ProgrammingError) as error:
        message = str(error.orig).lower()
        if "prediction_markets" in message and (
            "no such table" in message or "does not exist" in message
        ):
            return PredictionMarketsResponse(count=0, data=[])
        raise
    rows = result.scalars().all()
    data = [PredictionMarketRead.model_validate(row) for row in rows]
    return PredictionMarketsResponse(count=len(data), data=data)
