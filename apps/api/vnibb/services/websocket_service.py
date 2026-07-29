"""
WebSocket Service

Manages WebSocket connections and subscriptions for real-time updates.
Extracted from api/v1/websocket.py to avoid circular imports.
"""

import asyncio
import logging

import pytz
from fastapi import WebSocket
from pydantic import BaseModel

from vnibb.core.config import settings

logger = logging.getLogger(__name__)

# Vietnam timezone
VN_TZ = pytz.timezone("Asia/Ho_Chi_Minh")


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
        self.active_connections: dict[WebSocket, set[str]] = {}
        self._price_cache: dict[str, PriceUpdate] = {}
        self._update_task = None

    async def connect(self, websocket: WebSocket) -> bool:
        """Accept a connection unless the process limit is reached."""
        await websocket.accept()
        if len(self.active_connections) >= settings.websocket_max_connections:
            await websocket.close(code=1013)
            return False
        self.active_connections[websocket] = set()
        logger.info(f"WebSocket connected: {len(self.active_connections)} active")
        return True

    def disconnect(self, websocket: WebSocket):
        """Remove connection."""
        if websocket in self.active_connections:
            del self.active_connections[websocket]
        logger.info(f"WebSocket disconnected: {len(self.active_connections)} active")

    def subscribe(
        self,
        websocket: WebSocket,
        symbols: set[str],
        max_symbols_per_connection: int,
        max_active_symbols: int,
    ) -> str | None:
        """Subscribe connection to symbols within connection and process limits."""
        current_symbols = self.active_connections.get(websocket)
        if current_symbols is None:
            return "Connection is not active"
        if len(current_symbols | symbols) > max_symbols_per_connection:
            return f"A connection may subscribe to at most {max_symbols_per_connection} symbols"
        if len(self.get_all_subscribed_symbols() | symbols) > max_active_symbols:
            return f"The server supports at most {max_active_symbols} active symbols"
        current_symbols.update(symbols)
        logger.info(f"Subscribed to {symbols}")
        return None

    def unsubscribe(self, websocket: WebSocket, symbols: Set[str]):
        """Unsubscribe connection from symbols."""
        if websocket in self.active_connections:
            self.active_connections[websocket] -= symbols

    async def send_json(self, websocket: WebSocket, payload: dict, timeout: float) -> bool:
        try:
            await asyncio.wait_for(websocket.send_json(payload), timeout=timeout)
            return True
        except Exception as error:
            logger.debug("Failed to send WebSocket message: %s", error)
            return False

    async def send_update(self, websocket: WebSocket, update: PriceUpdate, timeout: float) -> bool:
        """Send price update to a connection."""
        return await self.send_json(websocket, update.model_dump(), timeout)

    async def _broadcast(self, clients: list[WebSocket], payload: dict, timeout: float) -> None:
        for start in range(0, len(clients), settings.websocket_broadcast_concurrency):
            batch = clients[start : start + settings.websocket_broadcast_concurrency]
            sent = await asyncio.gather(*(self.send_json(ws, payload, timeout) for ws in batch))
            for websocket, succeeded in zip(batch, sent, strict=False):
                if not succeeded:
                    self.disconnect(websocket)

    async def broadcast_price(self, symbol: str, price_data: PriceUpdate, send_timeout: float):
        """Broadcast price update to all subscribers."""
        self._price_cache[symbol] = price_data
        clients = [
            websocket
            for websocket, symbols in self.active_connections.items()
            if symbol in symbols
        ]
        await self._broadcast(clients, price_data.model_dump(), send_timeout)

    def get_all_subscribed_symbols(self) -> set[str]:
        """Get all symbols with active subscribers."""
        all_symbols = set()
        for symbols in self.active_connections.values():
            all_symbols.update(symbols)
        return all_symbols

    def active_connection_count(self) -> int:
        """Return number of active websocket clients."""
        return len(self.active_connections)

    def total_subscription_count(self) -> int:
        """Return total symbol subscriptions across all clients."""
        return sum(len(symbols) for symbols in self.active_connections.values())

    async def broadcast_alert(self, alert_data: dict):
        """Broadcast insider alert to all connected clients."""
        await self._broadcast(
            list(self.active_connections),
            {"type": "insider_alert", **alert_data},
            settings.websocket_send_timeout_seconds,
        )

    async def broadcast_sync_status(self, status_data: dict):
        """Broadcast sync status update to all connected clients."""
        await self._broadcast(
            list(self.active_connections),
            {"type": "sync_status", **status_data},
            settings.websocket_send_timeout_seconds,
        )


# Global connection manager
manager = ConnectionManager()
