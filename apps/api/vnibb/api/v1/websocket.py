"""
WebSocket API for Real-time Price Updates

Provides WebSocket endpoint for streaming live stock prices.
Supports multiple symbol subscriptions per connection.
Auto start/stop during market hours (9 AM - 3 PM VNT).
"""

import asyncio
import json
import logging
import re
from datetime import datetime
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from vnibb.api.v1.market import _fetch_yahoo_market_indices, _merge_market_index_rows
from vnibb.core.config import settings
from vnibb.providers.vnstock.equity_screener import StockScreenerParams, VnstockScreenerFetcher
from vnibb.providers.vnstock.market_overview import (
    MarketOverviewQueryParams,
    VnstockMarketOverviewFetcher,
)
from vnibb.services.websocket_service import VN_TZ, PriceUpdate, manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ws", tags=["WebSocket"])

ACTIVE_MARKET_SLEEP_SECONDS = 5
IDLE_SLEEP_SECONDS = 30
PER_SYMBOL_DELAY_SECONDS = 0.1

INDEX_SYMBOL_ALIASES = {
    "VNINDEX": "VNINDEX",
    "VN-INDEX": "VNINDEX",
    "VN30": "VN30",
    "HNX": "HNX",
    "HNXINDEX": "HNX",
    "HNX-INDEX": "HNX",
    "UPCOM": "UPCOM",
    "UPCOMINDEX": "UPCOM",
    "UPCOM-INDEX": "UPCOM",
}


def _is_allowed_ws_origin(origin: str) -> bool:
    """Match WebSocket origin against HTTP CORS allow-list and regex."""
    if not origin:
        return True

    if "*" in settings.cors_origins or origin in settings.cors_origins:
        return True

    if settings.cors_origin_regex and re.match(settings.cors_origin_regex, origin):
        return True

    return False


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
        "message": "Market is open" if is_open else "Market is closed",
    }


def _normalize_index_symbol(symbol: str) -> str | None:
    normalized = str(symbol or "").strip().upper()
    return INDEX_SYMBOL_ALIASES.get(normalized)


def _to_float(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed == parsed else None


def _to_int(value: Any) -> int:
    parsed = _to_float(value)
    return int(parsed) if parsed is not None else 0


async def _fetch_index_updates(index_codes: set[str]) -> list[PriceUpdate]:
    if not index_codes:
        return []

    try:
        yahoo_rows = await _fetch_yahoo_market_indices()
        yahoo_codes = {
            code
            for code in (
                _normalize_index_symbol(str(row.get("index_name") or "")) for row in yahoo_rows
            )
            if code
        }

        provider_rows: list[dict[str, Any]] = []
        if any(code not in yahoo_codes for code in index_codes):
            provider_data = await VnstockMarketOverviewFetcher.fetch(MarketOverviewQueryParams())
            provider_rows = [
                item.model_dump(mode="json", by_alias=False)
                if hasattr(item, "model_dump")
                else item
                for item in provider_data
            ]

        merged_rows = _merge_market_index_rows([], [*yahoo_rows, *provider_rows])
        updates: list[PriceUpdate] = []
        for row in merged_rows:
            symbol = _normalize_index_symbol(
                str(row.get("index_name") or row.get("index_code") or "")
            )
            if symbol not in index_codes:
                continue

            price = _to_float(row.get("current_value") or row.get("close") or row.get("price"))
            if price in (None, 0.0):
                continue

            timestamp = row.get("time") or row.get("updated_at") or datetime.now(VN_TZ).isoformat()
            updates.append(
                PriceUpdate(
                    symbol=symbol,
                    price=price,
                    change=_to_float(row.get("change")) or 0.0,
                    change_pct=_to_float(row.get("change_pct")) or 0.0,
                    volume=_to_int(row.get("volume")),
                    timestamp=str(timestamp),
                )
            )

        return updates
    except BaseException as e:
        if isinstance(e, (KeyboardInterrupt, GeneratorExit)):
            raise
        logger.debug("Index WebSocket fetch failed: %s", e)
        return []


async def fetch_and_broadcast_prices():
    """Background task to fetch and broadcast prices.

    Only fetches during market hours to avoid unnecessary API calls.
    """
    while True:
        try:
            connection_count = manager.active_connection_count()
            subscription_count = manager.total_subscription_count()
            if connection_count == 0 or subscription_count == 0:
                await asyncio.sleep(IDLE_SLEEP_SECONDS)
                continue

            symbols = manager.get_all_subscribed_symbols()

            market_open = is_market_open()

            index_symbols = {
                normalized
                for normalized in (_normalize_index_symbol(symbol) for symbol in symbols)
                if normalized
            }
            equity_symbols = {
                symbol for symbol in symbols if _normalize_index_symbol(symbol) is None
            }

            if market_open and index_symbols:
                index_updates = await _fetch_index_updates(index_symbols)
                for update in index_updates:
                    for subscribed_symbol in symbols:
                        if _normalize_index_symbol(subscribed_symbol) != update.symbol:
                            continue
                        await manager.broadcast_price(
                            subscribed_symbol,
                            PriceUpdate(
                                symbol=subscribed_symbol,
                                price=update.price,
                                change=update.change,
                                change_pct=update.change_pct,
                                volume=update.volume,
                                timestamp=update.timestamp,
                            ),
                        )

            if equity_symbols and market_open:
                # Fetch current prices for subscribed symbols
                for symbol in equity_symbols:
                    try:
                        # Create proper query params object
                        params = StockScreenerParams(
                            symbol=symbol, limit=1, source=settings.vnstock_source
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
                                timestamp=datetime.now(VN_TZ).isoformat(),
                            )
                            await manager.broadcast_price(symbol, update)
                    except BaseException as e:
                        logger.debug(f"Price fetch failed for {symbol}: {e}")

                    await asyncio.sleep(PER_SYMBOL_DELAY_SECONDS)

            # Update every 5 seconds during market hours, 30 seconds otherwise
            sleep_time = ACTIVE_MARKET_SLEEP_SECONDS if market_open else IDLE_SLEEP_SECONDS
            await asyncio.sleep(sleep_time)

        except BaseException as e:
            if isinstance(e, (KeyboardInterrupt, GeneratorExit)):
                raise
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
    origin = websocket.headers.get("origin", "")
    if not _is_allowed_ws_origin(origin):
        logger.warning("Rejected WebSocket origin: %s", origin)
        await websocket.close(code=1008)
        return

    await manager.connect(websocket)

    # Send initial market status
    try:
        await websocket.send_json({"type": "market_status", **get_market_status()})
    except Exception:
        pass

    try:
        while True:
            # Receive message from client
            data = await websocket.receive_text()
            message = json.loads(data)

            action = message.get("action")
            symbols = {s.upper() for s in message.get("symbols", [])}

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
                await websocket.send_json({"type": "market_status", **get_market_status()})

    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except BaseException as e:
        if isinstance(e, (KeyboardInterrupt, GeneratorExit)):
            raise
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
