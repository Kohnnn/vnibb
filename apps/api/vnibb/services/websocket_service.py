"""
WebSocket Service

Manages WebSocket connections and subscriptions for real-time updates.
Extracted from api/v1/websocket.py to avoid circular imports.
"""

import asyncio
import logging
import math
from datetime import datetime

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
    change: float | None = None
    change_pct: float | None = None
    volume: int | None = None
    timestamp: str
    price_unit: str
    source: str
    timestamp_timezone: str = "Asia/Ho_Chi_Minh"
    stale: bool = False

    def delivery_payload(self) -> dict:
        observed = datetime.fromisoformat(self.timestamp.replace("Z", "+00:00"))
        if observed.tzinfo is None:
            observed = pytz.timezone(self.timestamp_timezone).localize(observed)
        age = (datetime.now(VN_TZ) - observed).total_seconds()
        return {**self.model_dump(), "as_of": observed.isoformat(),
                "observation_age_seconds": max(0, age), "stale": self.stale or age > 60}


class ConnectionManager:
    """Manages WebSocket connections and subscriptions."""

    def __init__(self):
        self.active_connections: dict[WebSocket, set[str]] = {}
        self._price_cache: dict[str, PriceUpdate] = {}
        self._send_locks: dict[WebSocket, asyncio.Lock] = {}
        self.subscriptions_changed = asyncio.Event()

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
            self._send_locks.pop(websocket, None)
            del self.active_connections[websocket]
            self._prune_price_cache()
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
        active_symbols = self.get_all_subscribed_symbols()
        if len(active_symbols | symbols) > max_active_symbols:
            return f"The server supports at most {max_active_symbols} active symbols"
        current_symbols.update(symbols)
        if symbols - active_symbols:
            self.subscriptions_changed.set()
        logger.info(f"Subscribed to {symbols}")
        return None

    def unsubscribe(self, websocket: WebSocket, symbols: set[str]):
        """Unsubscribe connection from symbols."""
        if websocket in self.active_connections:
            self.active_connections[websocket] -= symbols
            self._prune_price_cache()

    def _prune_price_cache(self):
        subscribed = self.get_all_subscribed_symbols()
        for symbol in list(self._price_cache):
            if symbol not in subscribed:
                del self._price_cache[symbol]

    async def send_json(self, websocket: WebSocket, payload: dict, timeout: float) -> bool:
        if websocket not in self.active_connections:
            return False
        lock = self._send_locks.setdefault(websocket, asyncio.Lock())
        try:
            async def send():
                async with lock:
                    if websocket not in self.active_connections:
                        return False
                    await websocket.send_json(payload)
                    return True
            return await asyncio.wait_for(send(), timeout=timeout)
        except Exception as error:
            logger.debug("Failed to send WebSocket message: %s", error)
            if websocket in self.active_connections:
                self.disconnect(websocket)
                try:
                    await asyncio.wait_for(websocket.close(code=1013), timeout=timeout)
                except Exception as close_error:
                    logger.debug("Failed to close evicted WebSocket: %s", close_error)
            return False

    async def send_update(self, websocket: WebSocket, update: PriceUpdate, timeout: float) -> bool:
        """Send price update to a connection."""
        return await self.send_json(websocket, update.delivery_payload(), timeout)

    async def _broadcast(self, clients: list[WebSocket], payload: dict, timeout: float) -> None:
        await asyncio.gather(*(self.send_json(ws, payload, timeout) for ws in clients))

    async def broadcast_price(self, symbol: str, price_data: PriceUpdate, send_timeout: float):
        """Broadcast price update to all subscribers."""
        if (not math.isfinite(price_data.price) or price_data.price <= 0
                or price_data.price_unit not in {"VND", "index_points"}):
            return
        try:
            payload = price_data.delivery_payload()
        except (ValueError, TypeError):
            return
        if symbol not in self.get_all_subscribed_symbols():
            return
        previous = self._price_cache.get(symbol)
        if previous:
            observed = datetime.fromisoformat(payload["as_of"])
            previous_observed = datetime.fromisoformat(previous.delivery_payload()["as_of"])
            if observed < previous_observed or (
                observed == previous_observed and price_data.stale and not previous.stale
            ):
                return
        self._price_cache[symbol] = price_data
        clients = [
            websocket
            for websocket, symbols in self.active_connections.items()
            if symbol in symbols
        ]
        await self._broadcast(clients, payload, send_timeout)

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
