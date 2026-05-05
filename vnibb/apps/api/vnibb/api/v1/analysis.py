"""
Analysis API Endpoints

Provides endpoints for stock analysis and comparison features.
"""

import logging
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query

from vnibb.services.comparison_service import (
    ComparisonService,
    ComparisonResponse,
    PeerCompany,
    PeersResponse,
    COMPARISON_METRICS,
    comparison_service,
)

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get(
    "/",
    response_model=ComparisonResponse,
    summary="Compare Multiple Stocks",
    description="Get side-by-side comparison of multiple stocks with key metrics and price performance.",
)
async def compare_stocks(
    symbols: str = Query(
        ...,
        description="Comma-separated stock symbols, e.g., VNM,FPT,VCB",
        examples=["VNM,FPT,VCB"],
    ),
    period: str = Query(
        default="1Y",
        pattern=r"^(1M|3M|6M|1Y|YTD|ALL)$",
        description="Time period for price performance normalization",
    ),
    source: str = Query(default="KBS", pattern=r"^(KBS|VCI|DNSE)$", description="Data source"),
) -> ComparisonResponse:
    """
    Compare multiple stocks side by side.

    Returns a matrix of metrics and normalized price history for all specified symbols.
    Maximum 6 symbols allowed per request for UI clarity.
    """
    # Parse symbols
    symbol_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]

    # Validate
    if not symbol_list:
        raise HTTPException(400, "At least one symbol is required")

    if len(symbol_list) > 6:
        raise HTTPException(400, "Maximum 6 symbols allowed per comparison")

    # Remove duplicates while preserving order
    seen = set()
    unique_symbols = []
    for s in symbol_list:
        if s not in seen:
            seen.add(s)
            unique_symbols.append(s)

    try:
        result = await comparison_service.compare(unique_symbols, source=source, period=period)
        return result
    except Exception as e:
        logger.error(f"Comparison failed for {symbols}: {e}")
        return ComparisonResponse(
            symbols=unique_symbols,
            metrics=COMPARISON_METRICS,
            data={},
            price_history=[],
            sector_averages={},
            generated_at=datetime.utcnow(),
        )


@router.get(
    "/peers/{symbol}",
    response_model=PeersResponse,
    summary="Get Peer Companies",
    description="Get auto-suggested peer companies based on industry/sector.",
)
async def get_peer_companies(
    symbol: str,
    limit: int = Query(default=5, ge=1, le=20, description="Max peers to return"),
) -> PeersResponse:
    """
    Find peer companies in the same industry/sector.

    Uses screener data to find companies with similar:
    - Industry classification (ICB)
    - Market cap range (within 5x)

    Results are sorted by market cap similarity.
    """
    symbol = symbol.strip().upper()
    logger.info(f"API: Getting peers for {symbol} (limit={limit})")

    try:
        peers = await comparison_service.get_peers(symbol, limit=limit)
        logger.info(f"API: Returning {peers.count} peers for {symbol}")
        return peers
    except Exception as e:
        logger.exception(f"API: Failed to get peers for {symbol}: {e}")
        raise HTTPException(500, f"Failed to get peer companies: {str(e)}")
