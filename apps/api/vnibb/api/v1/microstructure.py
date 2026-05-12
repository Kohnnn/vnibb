"""Mongo-backed market microstructure analysis endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Query

from vnibb.core.cache import cached
from vnibb.services.microstructure_analysis import get_microstructure_analysis_service

router = APIRouter()


@router.get("/{symbol}")
@cached(ttl=60, key_prefix="microstructure")
async def get_microstructure_analysis(
    symbol: str,
    interval: str = Query("5m", pattern=r"^\d+[mh]$"),
    lookback_days: int = Query(7, ge=1, le=365),
    value_area_pct: float = Query(0.7, ge=0.5, le=0.95),
    fractal_window: int = Query(2, ge=1, le=10),
    imbalance_ratio: float = Query(3.0, ge=1.0, le=10.0),
):
    service = get_microstructure_analysis_service()
    data = await service.analyze(
        symbol,
        interval=interval,
        lookback_days=lookback_days,
        value_area_pct=value_area_pct,
        fractal_window=fractal_window,
        imbalance_ratio=imbalance_ratio,
    )
    return {"error": False, "data": data}
