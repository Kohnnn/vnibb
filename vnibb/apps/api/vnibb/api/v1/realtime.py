"""
Real-time Data API Endpoints

Provides access to live market data and controls for streaming.
"""

import asyncio
import logging
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from vnibb.services.realtime_pipeline import get_realtime_pipeline

router = APIRouter()
logger = logging.getLogger(__name__)


class StreamingStatus(BaseModel):
    """Status of real-time streaming."""
    is_running: bool
    pipeline_available: bool
    data_types: List[str]
    message: str


class StreamingRequest(BaseModel):
    """Request to start streaming."""
    data_types: List[str] = ["stockps", "index", "board"]
    symbols: Optional[List[str]] = None


@router.post(
    "/realtime/start",
    response_model=StreamingStatus,
    summary="Start Real-time Streaming",
    description="Start WebSocket streaming for market data. Uses vnstock_pipeline if available.",
)
async def start_streaming(
    request: StreamingRequest = None,
) -> StreamingStatus:
    """Start WebSocket streaming for market data."""
    if request is None:
        request = StreamingRequest()
    
    pipeline = get_realtime_pipeline()
    if pipeline.is_running:
        return StreamingStatus(
            is_running=True,
            pipeline_available=pipeline._pipeline_available,
            data_types=request.data_types,
            message="Streaming already running",
        )
    
    # Start in background
    asyncio.create_task(
        pipeline.start_streaming(
            data_types=request.data_types,
            symbols=request.symbols,
        )
    )
    
    return StreamingStatus(
        is_running=True,
        pipeline_available=pipeline._pipeline_available,
        data_types=request.data_types,
        message="Streaming started" + (
            " (WebSocket)" if pipeline._pipeline_available else " (Polling fallback)"
        ),
    )


@router.post(
    "/realtime/stop",
    response_model=StreamingStatus,
    summary="Stop Real-time Streaming",
    description="Stop WebSocket streaming.",
)
async def stop_streaming() -> StreamingStatus:
    """Stop WebSocket streaming."""
    pipeline = get_realtime_pipeline()
    await pipeline.stop_streaming()
    
    return StreamingStatus(
        is_running=False,
        pipeline_available=pipeline._pipeline_available,
        data_types=[],
        message="Streaming stopped",
    )


@router.get(
    "/realtime/status",
    response_model=StreamingStatus,
    summary="Get Streaming Status",
    description="Get current real-time streaming status.",
)
async def get_status() -> StreamingStatus:
    """Get current streaming status."""
    pipeline = get_realtime_pipeline()
    status = pipeline.get_status()
    
    return StreamingStatus(
        is_running=status["is_running"],
        pipeline_available=status["pipeline_available"],
        data_types=["stockps", "index", "board"] if status["is_running"] else [],
        message="Running" if status["is_running"] else "Stopped",
    )

