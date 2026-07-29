import asyncio
import json

import pytest
from fastapi import WebSocketDisconnect
from vnibb.api.v1 import websocket as websocket_api
from vnibb.services.websocket_service import ConnectionManager, PriceUpdate


class FakeWebSocket:
    def __init__(self, messages=(), fail_send=False, block_send=False):
        self.headers = {}
        self.messages = iter(messages)
        self.sent = []
        self.fail_send = fail_send
        self.block_send = block_send
        self.closed_code = None

    async def accept(self):
        pass

    async def close(self, code):
        self.closed_code = code

    async def receive_text(self):
        try:
            return next(self.messages)
        except StopIteration as exc:
            raise WebSocketDisconnect() from exc

    async def send_json(self, payload):
        if self.fail_send:
            raise RuntimeError("closed")
        if self.block_send:
            await asyncio.Event().wait()
        self.sent.append(payload)


@pytest.fixture
def connection_manager():
    return ConnectionManager()


def price_update():
    return PriceUpdate(
        symbol="VNM",
        price=1.0,
        change=0.0,
        change_pct=0.0,
        volume=0,
        timestamp="2026-01-01T00:00:00+07:00",
    )


@pytest.mark.asyncio
async def test_subscription_limits_preserve_existing_state(connection_manager):
    first = FakeWebSocket()
    second = FakeWebSocket()
    connection_manager.active_connections = {first: {"VNM"}, second: {"FPT"}}

    assert (
        connection_manager.subscribe(first, {"HPG"}, 1, 3)
        == "A connection may subscribe to at most 1 symbols"
    )
    assert connection_manager.active_connections[first] == {"VNM"}
    assert (
        connection_manager.subscribe(first, {"HPG"}, 2, 2)
        == "The server supports at most 2 active symbols"
    )
    assert connection_manager.active_connections[first] == {"VNM"}


@pytest.mark.asyncio
async def test_invalid_subscription_returns_error_payload(monkeypatch):
    websocket = FakeWebSocket([json.dumps({"action": "subscribe", "symbols": ["VNM", "bad!"]})])
    manager = ConnectionManager()
    monkeypatch.setattr(websocket_api, "manager", manager)

    await websocket_api.websocket_prices(websocket)

    assert websocket.sent[1] == {
        "type": "error",
        "error": "invalid_symbols",
        "message": "Symbols must be valid stock or index symbols",
        "symbols": ["BAD!"],
    }
    assert manager.active_connections == {}


@pytest.mark.asyncio
async def test_over_limit_subscription_returns_error_payload(monkeypatch):
    websocket = FakeWebSocket([json.dumps({"action": "subscribe", "symbols": ["VNM", "FPT"]})])
    manager = ConnectionManager()
    monkeypatch.setattr(websocket_api, "manager", manager)
    monkeypatch.setattr(websocket_api.settings, "websocket_max_symbols_per_connection", 1)

    await websocket_api.websocket_prices(websocket)

    assert websocket.sent[1] == {
        "type": "error",
        "error": "subscription_limit",
        "message": "A connection may subscribe to at most 1 symbols",
    }
    assert manager.active_connections == {}


@pytest.mark.asyncio
async def test_equity_fetches_respect_concurrency_cap(monkeypatch):
    current = 0
    peak = 0
    started = asyncio.Event()
    release = asyncio.Event()

    async def fake_fetch(_):
        nonlocal current, peak
        current += 1
        peak = max(peak, current)
        if current == 2:
            started.set()
        await release.wait()
        current -= 1
        return []

    monkeypatch.setattr(websocket_api.VnstockScreenerFetcher, "fetch", fake_fetch)
    monkeypatch.setattr(websocket_api.settings, "websocket_fetch_concurrency", 2)
    task = asyncio.create_task(
        websocket_api._fetch_and_broadcast_cycle({"VNM", "FPT", "HPG"}, True)
    )

    await asyncio.wait_for(started.wait(), timeout=0.2)
    assert peak == 2
    release.set()
    await task


@pytest.mark.asyncio
async def test_price_cycle_honors_deadline(monkeypatch):
    cancelled = asyncio.Event()

    async def slow_cycle(_, __):
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelled.set()
            raise

    monkeypatch.setattr(websocket_api, "_fetch_and_broadcast_cycle", slow_cycle)
    monkeypatch.setattr(websocket_api.settings, "websocket_cycle_timeout_seconds", 0.01)

    await websocket_api._run_price_cycle({"VNM"}, True)

    assert cancelled.is_set()


@pytest.mark.asyncio
async def test_dead_client_is_removed_after_send_failure(connection_manager):
    websocket = FakeWebSocket(fail_send=True)
    connection_manager.active_connections[websocket] = {"VNM"}

    await connection_manager.broadcast_price("VNM", price_update(), 0.01)

    assert websocket not in connection_manager.active_connections


@pytest.mark.asyncio
async def test_connection_limit_rejects_before_retaining(monkeypatch, connection_manager):
    monkeypatch.setattr(websocket_api.settings, "websocket_max_connections", 1)
    connection_manager.active_connections[FakeWebSocket()] = set()
    websocket = FakeWebSocket()

    assert not await connection_manager.connect(websocket)
    assert websocket.closed_code == 1013
    assert websocket not in connection_manager.active_connections


@pytest.mark.asyncio
async def test_initial_status_ping_and_sync_cleanup_timed_out_client(monkeypatch):
    monkeypatch.setattr(websocket_api.settings, "websocket_send_timeout_seconds", 0.01)
    manager = ConnectionManager()
    monkeypatch.setattr(websocket_api, "manager", manager)

    initial = FakeWebSocket(block_send=True)
    await websocket_api.websocket_prices(initial)
    assert initial not in manager.active_connections

    ping = FakeWebSocket([json.dumps({"action": "ping"})], block_send=True)
    await websocket_api.websocket_prices(ping)
    assert ping not in manager.active_connections

    sync = FakeWebSocket(block_send=True)
    manager.active_connections[sync] = set()
    await manager.broadcast_sync_status({"state": "running"})
    assert sync not in manager.active_connections


@pytest.mark.asyncio
async def test_index_fetch_reraises_cancellation(monkeypatch):
    async def cancelled_fetch():
        raise asyncio.CancelledError

    monkeypatch.setattr(websocket_api, "_fetch_yahoo_market_indices", cancelled_fetch)

    with pytest.raises(asyncio.CancelledError):
        await websocket_api._fetch_index_updates({"VNINDEX"})


@pytest.mark.asyncio
async def test_websocket_endpoint_reraises_cancellation(monkeypatch):
    manager = ConnectionManager()
    monkeypatch.setattr(websocket_api, "manager", manager)
    websocket = FakeWebSocket()

    async def cancelled_receive():
        raise asyncio.CancelledError

    websocket.receive_text = cancelled_receive
    with pytest.raises(asyncio.CancelledError):
        await websocket_api.websocket_prices(websocket)
