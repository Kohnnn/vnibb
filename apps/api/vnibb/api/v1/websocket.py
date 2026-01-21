"""
WebSocket API for Real-time Price Updates

Provides WebSocket endpoint for streaming live stock prices.
Supports multiple symbol subscriptions per connection.
Auto start/stop during market hours (9 AM - 3 PM VNT).
"""

from datetime import datetime
import json
import logging
import asyncio
from typing import Set, Dict

import pytz
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from vnibb.core.config import settings
from vnibb.providers.vnstock.equity_screener import VnstockScreenerFetcher, StockScreenerParams
from vnibb.services.websocket_service import manager, PriceUpdate, ConnectionManager, VN_TZ

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ws", tags=["WebSocket"])


def is_market_open() -> bool:
    """Check if Vietnam stock market is currently open.
    
    Market hours: 9:00 AM - 3:00 PM VNT, Monday-Friday
    """
    now = datetime.now(VN_TZ)
    
    # Weekday check (Mon=0, Sun=6)
    if now.weekday() >= 5:
        return False
    
    # Time check (9:00 - 15:00)
    market_open = now.replace(hour=9, minute=0, second=0, microsecond=0)
    market_close = now.replace(hour=15, minute=0, second=0, microsecond=0)
    
    return market_open <= now <= market_close


def get_market_status() -> dict:
    """Get detailed market status information."""
    now = datetime.now(VN_TZ)
    is_open = is_market_open()
    
    return {
        "is_open": is_open,
        "current_time": now.isoformat(),
        "timezone": "Asia/Ho_Chi_Minh",
        "message": "Market is open" if is_open else "Market is closed"
    }


async def fetch_and_broadcast_prices():
    """Background task to fetch and broadcast prices.
    
    Only fetches during market hours to avoid unnecessary API calls.
    """
    while True:
        try:
            symbols = manager.get_all_subscribed_symbols()
            # Always include major indices in broadcast
            major_indices = {"VNINDEX", "VN30", "HNXINDEX", "UPCOMINDEX", "VN-INDEX", "HNX-INDEX"}
            symbols.update(major_indices)
            
            market_open = is_market_open()
            
            if symbols and market_open:
                # Fetch current prices for subscribed symbols
                for symbol in symbols:
                    try:
                        # Create proper query params object
                        params = StockScreenerParams(
                            symbol=symbol,
                            limit=1,
                            source=settings.vnstock_source
                        )
                        results = await VnstockScreenerFetcher.fetch(params)
                        
                        if results:
                            stock = results[0]
                            # ScreenerData has price and volume, but not daily change
                            # Change is calculated client-side from previous price
                            update = PriceUpdate(
                                symbol=symbol,
                                price=float(stock.price) if stock.price else 0.0,
                                change=0.0,  # Not available from screener
                                change_pct=0.0,  # Not available from screener
                                volume=int(stock.volume) if stock.volume else 0,
                                timestamp=datetime.now(VN_TZ).isoformat()
                            )
                            await manager.broadcast_price(symbol, update)
                    except Exception as e:
                        logger.debug(f"Price fetch failed for {symbol}: {e}")
                    
                    await asyncio.sleep(0.1)  # Rate limiting between symbols
            
            # Update every 5 seconds during market hours, 30 seconds otherwise
            sleep_time = 5 if market_open else 30
            await asyncio.sleep(sleep_time)
            
        except Exception as e:
            logger.error(f"Price broadcast error: {e}")
            await asyncio.sleep(5)


@router.websocket("/prices")
async def websocket_prices(websocket: WebSocket):
    """
    WebSocket endpoint for real-time price updates.
    
    Client sends:
    - {"action": "subscribe", "symbols": ["VNM", "FPT"]}
    - {"action": "unsubscribe", "symbols": ["VNM"]}
    - {"action": "market_status"}
    
    Server sends:
    - {"symbol": "VNM", "price": 61000, "change": 500, "change_pct": 0.82, ...}
    - {"type": "market_status", "is_open": true, ...}
    """
    await manager.connect(websocket)
    
    # Send initial market status
    try:
        await websocket.send_json({
            "type": "market_status",
            **get_market_status()
        })
    except Exception:
        pass
    
    try:
        while True:
            # Receive message from client
            data = await websocket.receive_text()
            message = json.loads(data)
            
            action = message.get("action")
            symbols = set(s.upper() for s in message.get("symbols", []))
            
            if action == "subscribe":
                manager.subscribe(websocket, symbols)
                # Send current cached prices immediately
                for symbol in symbols:
                    if symbol in manager._price_cache:
                        await manager.send_update(websocket, manager._price_cache[symbol])
            
            elif action == "unsubscribe":
                manager.unsubscribe(websocket, symbols)
            
            elif action == "ping":
                await websocket.send_json({"action": "pong"})
            
            elif action == "market_status":
                await websocket.send_json({
                    "type": "market_status",
                    **get_market_status()
                })
    
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(websocket)


# Start background price fetcher when module loads
_background_task = None

async def start_background_fetcher():
    """Start the background price fetcher task.
    
    Must be called from an async context (e.g., lifespan handler).
    """
    global _background_task
    if _background_task is None or _background_task.done():
        _background_task = asyncio.create_task(fetch_and_broadcast_prices())
        logger.info("Started WebSocket price fetcher background task")


async def stop_background_fetcher():
    """Stop the background price fetcher task gracefully."""
    global _background_task
    if _background_task is not None and not _background_task.done():
        _background_task.cancel()
        try:
            await _background_task
        except asyncio.CancelledError:
            pass
        logger.info("Stopped WebSocket price fetcher background task")
    _background_task = None
