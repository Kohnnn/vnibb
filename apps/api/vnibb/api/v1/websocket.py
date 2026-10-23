"""
WebSocket API for Real-time Price Updates

Provides WebSocket endpoint for streaming live stock prices.
Supports multiple symbol subscriptions per connection.
Streams active sessions and replays stored observations outside them.
"""

import asyncio
import json
import logging
import re
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from vnibb.api.v1.equity import _load_stored_quote
from vnibb.api.v1.market import (
    _fetch_yahoo_market_indices,
    _load_latest_market_indices_from_db,
    _merge_market_index_rows,
)
from vnibb.core.config import settings
from vnibb.core.database import async_session_factory
from vnibb.providers.vnstock.stock_quote import VnstockStockQuoteFetcher
from vnibb.providers.vnstock.market_overview import (
    MarketOverviewQueryParams,
    VnstockMarketOverviewFetcher,
)
from vnibb.services.websocket_service import VN_TZ, PriceUpdate, manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ws", tags=["WebSocket"])

ACTIVE_MARKET_SLEEP_SECONDS = 5
IDLE_SLEEP_SECONDS = 30
SNAPSHOT_TIMEOUT_SECONDS = 1.0

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


def _market_time(at: datetime | None = None) -> datetime:
    if at is None:
        return datetime.now(VN_TZ)
    return VN_TZ.localize(at) if at.tzinfo is None else at.astimezone(VN_TZ)


def get_market_phase(
    at: datetime | None = None,
) -> Literal["pre-open", "morning", "lunch", "afternoon", "post-close", "after-close", "weekend"]:
    now = _market_time(at)
    if now.weekday() >= 5:
        return "weekend"

    current_time = now.time()
    if current_time < now.replace(hour=9, minute=0, second=0, microsecond=0).time():
        return "pre-open"
    if current_time < now.replace(hour=11, minute=30, second=0, microsecond=0).time():
        return "morning"
    if current_time < now.replace(hour=13, minute=0, second=0, microsecond=0).time():
        return "lunch"
    if current_time < now.replace(hour=14, minute=45, second=0, microsecond=0).time():
        return "afternoon"
    if current_time < now.replace(hour=15, minute=0, second=0, microsecond=0).time():
        return "post-close"
    return "after-close"


def is_market_open(at: datetime | None = None) -> bool:
    return get_market_phase(at) in {"morning", "afternoon"}


def get_market_status(at: datetime | None = None) -> dict:
    now = _market_time(at)
    phase = get_market_phase(now)
    is_open = phase in {"morning", "afternoon"}
    messages = {
        "pre-open": "Market opens at 09:00 ICT",
        "morning": "Morning session is open",
        "lunch": "Lunch break; market resumes at 13:00 ICT",
        "afternoon": "Afternoon session is open",
        "post-close": "Trading is closed; final prices are settling until 15:00 ICT",
        "after-close": "Market is closed",
        "weekend": "Market is closed for the weekend",
    }

    return {
        "is_open": is_open,
        "phase": phase,
        "current_time": now.isoformat(),
        "timezone": "Asia/Ho_Chi_Minh",
        "schedule": "09:00–11:30 + 13:00–14:45 ICT, Mon–Fri",
        "message": messages[phase],
    }


def _normalize_index_symbol(symbol: str) -> str | None:
    normalized = str(symbol or "").strip().upper()
    return INDEX_SYMBOL_ALIASES.get(normalized)


def _validate_symbols(raw_symbols: Any) -> tuple[set[str], list[str]]:
    if not isinstance(raw_symbols, list):
        return set(), [str(raw_symbols)]
    symbols = {str(symbol).strip().upper() for symbol in raw_symbols}
    invalid_symbols = [
        symbol
        for symbol in symbols
        if not _normalize_index_symbol(symbol) and not re.fullmatch(r"[A-Z0-9]{3,6}", symbol)
    ]
    return symbols, sorted(invalid_symbols)


def _to_float(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed == parsed else None


def _to_int(value: Any) -> int:
    parsed = _to_float(value)
    return int(parsed) if parsed is not None else 0


async def _fetch_index_updates(index_codes: set[str], *, stored: bool = False) -> list[PriceUpdate]:
    if not index_codes:
        return []

    try:
        if stored:
            async with async_session_factory() as db:
                merged_rows = await _load_latest_market_indices_from_db(db)
        else:
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

            timestamp = row.get("time") or row.get("updated_at")
            if not timestamp:
                continue
            updates.append(
                PriceUpdate(
                    symbol=symbol,
                    price=price,
                    change=_to_float(row.get("change")),
                    change_pct=_to_float(row.get("change_pct")),
                    volume=_to_int(row.get("volume")),
                    timestamp=timestamp.isoformat() if hasattr(timestamp, "isoformat") else str(timestamp),
                    price_unit="index_points",
                    source=("database:stock_indices" if stored else
                            str(row.get("source") or f"vnstock:{settings.vnstock_source}:market_overview")),
                    timestamp_timezone="UTC" if row.get("source") == "yahoo_finance" else "Asia/Ho_Chi_Minh",
                    stale=stored,
                )
            )

        return updates
    except BaseException as error:
        if isinstance(error, (KeyboardInterrupt, GeneratorExit, asyncio.CancelledError)):
            raise
        logger.debug("Index WebSocket fetch failed: %s", error)
        return []


_equity_jobs: dict[str, asyncio.Task] = {}
_equity_slots: asyncio.Semaphore | None = None
_snapshot_jobs: dict[str, asyncio.Task] = {}
_snapshot_slots: asyncio.Semaphore | None = None
_index_job: asyncio.Task | None = None
_index_snapshot_job: asyncio.Task | None = None


async def _broadcast_stored_equity(symbol: str, semaphore: asyncio.Semaphore):
    async with semaphore:
        try:
            stored, source = await asyncio.wait_for(
                _load_stored_quote(symbol), timeout=SNAPSHOT_TIMEOUT_SECONDS
            )
            if (stored is not None and stored.price is not None and source
                    and stored.price_unit == "VND" and stored.updated_at is not None):
                await manager.broadcast_price(
                    symbol,
                    PriceUpdate(
                        symbol=symbol, price=stored.price, change=stored.change,
                        change_pct=stored.change_pct, volume=stored.volume,
                        timestamp=stored.updated_at.isoformat(), price_unit=stored.price_unit,
                        source=source, stale=True,
                    ),
                    settings.websocket_send_timeout_seconds,
                )
        except Exception as error:
            logger.debug("Stored quote unavailable for %s: %s", symbol, error)


async def _fetch_and_broadcast_equity(symbol: str, semaphore: asyncio.Semaphore):
    async with semaphore:
        if not is_market_open():
            return
        try:
            stock, _ = await VnstockStockQuoteFetcher.fetch(
                symbol, settings.vnstock_source, wait_for_completion=True,
            )
            if not is_market_open() or stock.price is None or stock.price_unit != "VND" or stock.updated_at is None:
                return
            await manager.broadcast_price(
                symbol,
                PriceUpdate(
                    symbol=symbol,
                    price=stock.price,
                    change=stock.change,
                    change_pct=stock.change_pct,
                    volume=stock.volume,
                    timestamp=stock.updated_at.isoformat(),
                    price_unit=stock.price_unit,
                    source=f"vnstock:{settings.vnstock_source}:quote.history",
                ),
                settings.websocket_send_timeout_seconds,
            )
        except Exception as error:
            logger.debug("Price fetch failed for %s: %s", symbol, error)


def _finish_job(jobs: dict[str, asyncio.Task], symbol: str, task: asyncio.Task):
    if jobs.get(symbol) is task:
        del jobs[symbol]
    if not task.cancelled():
        task.exception()


async def _broadcast_index_updates(symbols: set[str], *, stored: bool = False):
    if not stored and not is_market_open():
        return
    codes = {code for symbol in symbols if (code := _normalize_index_symbol(symbol))}
    updates = await _fetch_index_updates(codes, stored=stored)
    if not stored and not is_market_open():
        return
    for update in updates:
        for symbol in manager.get_all_subscribed_symbols():
            if _normalize_index_symbol(symbol) == update.symbol:
                await manager.broadcast_price(
                    symbol, update.model_copy(update={"symbol": symbol}),
                    settings.websocket_send_timeout_seconds,
                )


async def _fetch_and_broadcast_cycle(symbols: set[str], market_open: bool):
    index_symbols = {
        normalized
        for normalized in (_normalize_index_symbol(symbol) for symbol in symbols)
        if normalized
    }
    equity_symbols = {symbol for symbol in symbols if _normalize_index_symbol(symbol) is None}

    snapshots = []
    if equity_symbols:
        global _equity_slots, _snapshot_slots
        if _equity_slots is None:
            _equity_slots = asyncio.Semaphore(settings.websocket_fetch_concurrency)
        if _snapshot_slots is None:
            _snapshot_slots = asyncio.Semaphore(settings.websocket_fetch_concurrency)
        for symbol in equity_symbols:
            if symbol in _snapshot_jobs and _snapshot_jobs[symbol].done():
                _finish_job(_snapshot_jobs, symbol, _snapshot_jobs[symbol])
            if symbol not in _snapshot_jobs and len(_snapshot_jobs) < settings.websocket_max_active_symbols:
                task = asyncio.create_task(_broadcast_stored_equity(symbol, _snapshot_slots))
                _snapshot_jobs[symbol] = task
                task.add_done_callback(lambda done, code=symbol: _finish_job(_snapshot_jobs, code, done))
            if symbol in _snapshot_jobs:
                snapshots.append(_snapshot_jobs[symbol])
            if market_open and symbol not in _equity_jobs and len(_equity_jobs) < settings.websocket_max_active_symbols:
                task = asyncio.create_task(_fetch_and_broadcast_equity(symbol, _equity_slots))
                _equity_jobs[symbol] = task
                task.add_done_callback(lambda done, code=symbol: _finish_job(_equity_jobs, code, done))
    if index_symbols:
        global _index_job, _index_snapshot_job
        if _index_snapshot_job is None or _index_snapshot_job.done():
            _index_snapshot_job = asyncio.create_task(
                asyncio.wait_for(_broadcast_index_updates(symbols, stored=True), SNAPSHOT_TIMEOUT_SECONDS)
            )
        snapshots.append(_index_snapshot_job)
        if market_open and (_index_job is None or _index_job.done()):
            _index_job = asyncio.create_task(_broadcast_index_updates(symbols))
            _index_job.add_done_callback(lambda done: None if done.cancelled() else done.exception())

    # Provider jobs keep their slots until completion; stored delivery never waits for them.
    await asyncio.gather(*(asyncio.shield(task) for task in snapshots), return_exceptions=True)


async def _run_price_cycle(symbols: set[str], market_open: bool):
    try:
        await asyncio.wait_for(
            _fetch_and_broadcast_cycle(symbols, market_open),
            timeout=settings.websocket_cycle_timeout_seconds,
        )
    except TimeoutError:
        logger.warning(
            "Price broadcast cycle exceeded %.1f seconds",
            settings.websocket_cycle_timeout_seconds,
        )


async def fetch_and_broadcast_prices():
    """Poll once per subscribed symbol and publish session transitions."""
    last_phase = None
    while True:
        try:
            manager.subscriptions_changed.clear()
            status = get_market_status()
            if manager.active_connection_count() and status["phase"] != last_phase:
                await manager._broadcast(list(manager.active_connections),
                                         {"type": "market_status", **status},
                                         settings.websocket_send_timeout_seconds)
            last_phase = status["phase"]
            if manager.total_subscription_count():
                await _run_price_cycle(manager.get_all_subscribed_symbols(), status["is_open"])
            delay = ACTIVE_MARKET_SLEEP_SECONDS if status["is_open"] else IDLE_SLEEP_SECONDS
            try:
                await asyncio.wait_for(manager.subscriptions_changed.wait(), timeout=delay)
            except TimeoutError:
                pass
        except asyncio.CancelledError:
            raise
        except Exception as error:
            logger.error("Price broadcast error: %s", error)
            await asyncio.sleep(ACTIVE_MARKET_SLEEP_SECONDS)


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

    if not await manager.connect(websocket):
        return

    try:
        if not await manager.send_json(
            websocket,
            {"type": "market_status", **get_market_status()},
            settings.websocket_send_timeout_seconds,
        ):
            return

        while True:
            # Receive message from client
            data = await websocket.receive_text()
            message = json.loads(data)

            action = message.get("action")
            symbols, invalid_symbols = _validate_symbols(message.get("symbols", []))

            if action == "subscribe":
                if invalid_symbols:
                    await manager.send_json(websocket,
                        {
                            "type": "error",
                            "error": "invalid_symbols",
                            "message": "Symbols must be valid stock or index symbols",
                            "symbols": invalid_symbols,
                        }, settings.websocket_send_timeout_seconds
                    )
                    continue
                error = manager.subscribe(
                    websocket,
                    symbols,
                    settings.websocket_max_symbols_per_connection,
                    settings.websocket_max_active_symbols,
                )
                if error:
                    await manager.send_json(websocket,
                        {"type": "error", "error": "subscription_limit", "message": error},
                        settings.websocket_send_timeout_seconds,
                    )
                    continue
                for symbol in symbols:
                    if symbol in manager._price_cache and not await manager.send_update(
                        websocket,
                        manager._price_cache[symbol],
                        settings.websocket_send_timeout_seconds,
                    ):
                        return

            elif action == "unsubscribe":
                manager.unsubscribe(websocket, symbols)

            elif action == "ping":
                if not await manager.send_json(
                    websocket, {"action": "pong"}, settings.websocket_send_timeout_seconds
                ):
                    return

            elif action == "market_status":
                if not await manager.send_json(
                    websocket,
                    {"type": "market_status", **get_market_status()},
                    settings.websocket_send_timeout_seconds,
                ):
                    return

    except WebSocketDisconnect:
        pass
    except asyncio.CancelledError:
        raise
    except BaseException as error:
        if isinstance(error, (KeyboardInterrupt, GeneratorExit)):
            raise
        logger.error(f"WebSocket error: {error}")
    finally:
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
    global _background_task, _index_snapshot_job
    if _background_task is not None and not _background_task.done():
        _background_task.cancel()
        try:
            await _background_task
        except asyncio.CancelledError:
            pass
        logger.info("Stopped WebSocket price fetcher background task")
    _background_task = None
    snapshots = list(_snapshot_jobs.values())
    if _index_snapshot_job is not None:
        snapshots.append(_index_snapshot_job)
    for task in snapshots:
        task.cancel()
    await asyncio.gather(*snapshots, return_exceptions=True)
    _snapshot_jobs.clear()
    _index_snapshot_job = None
