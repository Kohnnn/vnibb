"""Mongo-backed market microstructure analysis endpoints."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Query

from vnibb.core.cache import cached
from vnibb.services.market_session import intraday_market_session
from vnibb.services.microstructure_analysis import get_microstructure_analysis_service

router = APIRouter()


@cached(ttl=60, key_prefix="microstructure-availability")
async def _read_microstructure(
    symbol: str,
    features: str | None,
    interval: str,
    lookback_days: int,
    value_area_pct: float,
    fractal_window: int,
    imbalance_ratio: float,
):
    feature_set = {feature.strip().lower() for feature in features.split(",") if feature.strip()} if features else None
    data = await get_microstructure_analysis_service().analyze(
        symbol,
        features=feature_set,
        interval=interval,
        lookback_days=lookback_days,
        value_area_pct=value_area_pct,
        fractal_window=fractal_window,
        imbalance_ratio=imbalance_ratio,
    )
    feed = data.pop("trade_feed")
    errors = data.pop("input_errors")
    return {"error": "; ".join(errors) if errors else None, "data": data, "feed": feed}


@router.get("/{symbol}")
async def get_microstructure_analysis(
    symbol: str,
    features: str | None = Query(None, description="Comma-separated features to compute"),
    interval: str = Query("5m", pattern=r"^\d+[mh]$"),
    lookback_days: int = Query(7, ge=1, le=365),
    value_area_pct: float = Query(0.7, ge=0.5, le=0.95),
    fractal_window: int = Query(2, ge=1, le=10),
    imbalance_ratio: float = Query(3.0, ge=1.0, le=10.0),
):
    result = await _read_microstructure(
        symbol.upper(), features, interval, lookback_days, value_area_pct, fractal_window, imbalance_ratio,
    )
    return {
        "data": result["data"],
        "error": result["error"],
        "meta": {
            "feed": result["feed"],
            "market_session": intraday_market_session(datetime.now(UTC)),
            "lookback_days": lookback_days,
        },
    }
