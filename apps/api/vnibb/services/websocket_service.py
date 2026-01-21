"""
WebSocket Service

Manages WebSocket connections and subscriptions for real-time updates.
Extracted from api/v1/websocket.py to avoid circular imports.
"""

import logging
import asyncio
from typing import Set, Dict, Any
from datetime import datetime
import pytz

from fastapi import WebSocket
from pydantic import BaseModel

logger = logging.getLogger(__name__)

# Vietnam timezone
VN_TZ = pytz.timezone('Asia/Ho_Chi_Minh')


class PriceUpdate(BaseModel):
    """Real-time price update message."""
    symbol: str
    price: float
    change: float
    change_pct: float
    volume: int
    timestamp: str


class ConnectionManager:
    """Manages WebSocket connections and subscriptions."""
    
    def __init__(self):
        self.active_connections: Dict[WebSocket, Set[str]] = {}
        self._price_cache: Dict[str, PriceUpdate] = {}
        self._update_task = None
    
    async def connect(self, websocket: WebSocket):
        """Accept new connection."""
        await websocket.accept()
        self.active_connections[websocket] = set()
        logger.info(f"WebSocket connected: {len(self.active_connections)} active")
    
    def disconnect(self, websocket: WebSocket):
        """Remove connection."""
        if websocket in self.active_connections:
            del self.active_connections[websocket]
        logger.info(f"WebSocket disconnected: {len(self.active_connections)} active")
    
    def subscribe(self, websocket: WebSocket, symbols: Set[str]):
        """Subscribe connection to symbols."""
        if websocket in self.active_connections:
            self.active_connections[websocket].update(symbols)
            logger.info(f"Subscribed to {symbols}")
    
    def unsubscribe(self, websocket: WebSocket, symbols: Set[str]):
        """Unsubscribe connection from symbols."""
        if websocket in self.active_connections:
            self.active_connections[websocket] -= symbols
    
    async def send_update(self, websocket: WebSocket, update: PriceUpdate):
        """Send price update to a connection."""
        try:
            await websocket.send_json(update.model_dump())
        except Exception as e:
            logger.debug(f"Failed to send update: {e}")
    
    async def broadcast_price(self, symbol: str, price_data: PriceUpdate):
        """Broadcast price update to all subscribers."""
        self._price_cache[symbol] = price_data
        
        for ws, symbols in list(self.active_connections.items()):
            if symbol in symbols:
                try:
                    await self.send_update(ws, price_data)
                except Exception:
                    self.disconnect(ws)
    
    def get_all_subscribed_symbols(self) -> Set[str]:
        """Get all symbols with active subscribers."""
        all_symbols = set()
        for symbols in self.active_connections.values():
            all_symbols.update(symbols)
        return all_symbols
    
    async def broadcast_alert(self, alert_data: dict):
        """
        Broadcast insider alert to all connected clients.
        
        Args:
            alert_data: Alert data dictionary
        """
        disconnected = []
        
        for ws in list(self.active_connections.keys()):
            try:
                await ws.send_json({
                    "type": "insider_alert",
                    **alert_data
                })
            except Exception as e:
                logger.debug(f"Failed to send alert: {e}")
                disconnected.append(ws)
        
        # Clean up disconnected clients
        for ws in disconnected:
            self.disconnect(ws)
        
        if disconnected:
            logger.info(f"Cleaned up {len(disconnected)} disconnected clients")

    async def broadcast_sync_status(self, status_data: dict):
        """
        Broadcast sync status update to all connected clients.
        
        Args:
            status_data: Sync status dictionary
        """
        disconnected = []
        
        for ws in list(self.active_connections.keys()):
            try:
                await ws.send_json({
                    "type": "sync_status",
                    **status_data
                })
            except Exception as e:
                logger.debug(f"Failed to send sync status: {e}")
                disconnected.append(ws)
        
        for ws in disconnected:
            self.disconnect(ws)



# Global connection manager
manager = ConnectionManager()
