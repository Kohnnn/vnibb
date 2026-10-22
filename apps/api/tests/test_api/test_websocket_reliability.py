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
        price_unit="VND",
        source="fixture",
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

    async def fake_fetch(*_):
        nonlocal current, peak
        current += 1
        peak = max(peak, current)
        if current == 2:
            started.set()
        await release.wait()
        current -= 1
        from vnibb.providers.vnstock.stock_quote import StockQuoteData
        return StockQuoteData(symbol="VNM"), False

    monkeypatch.setattr(websocket_api.VnstockStockQuoteFetcher, "fetch", fake_fetch)
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


@pytest.mark.asyncio
async def test_slow_clients_do_not_delay_healthy_clients(monkeypatch, connection_manager):
    monkeypatch.setattr(websocket_api.settings, "websocket_broadcast_concurrency", 1)
    slow = FakeWebSocket(block_send=True)
    healthy = FakeWebSocket()
    connection_manager.active_connections = {slow: {"VNM"}, healthy: {"VNM"}}
    task = asyncio.create_task(connection_manager.broadcast_price("VNM", price_update(), 0.2))
    for _ in range(10):
        await asyncio.sleep(0)
    assert healthy.sent[0]["price"] == 1.0
    assert not task.done()
    await task


@pytest.mark.asyncio
async def test_equity_deadlines_reuse_outstanding_job(monkeypatch):
    from vnibb.providers.vnstock.stock_quote import StockQuoteData
    release = asyncio.Event()
    calls = []
    async def fetch(*args):
        calls.append(args)
        await release.wait()
        return StockQuoteData(symbol="VNM"), False
    monkeypatch.setattr(websocket_api.VnstockStockQuoteFetcher, "fetch", fetch)
    monkeypatch.setattr(websocket_api.settings, "websocket_cycle_timeout_seconds", 0.01)
    await websocket_api._run_price_cycle({"VNM"}, True)
    await websocket_api._run_price_cycle({"VNM"}, True)
    assert len(calls) == 1
    release.set()
    await asyncio.gather(*websocket_api._equity_jobs.values())


@pytest.mark.asyncio
async def test_cached_delivery_preserves_observation_clock(connection_manager):
    update = price_update()
    websocket = FakeWebSocket()
    await connection_manager.send_update(websocket, update, 0.1)
    assert websocket.sent[0]["as_of"] == update.timestamp
    assert websocket.sent[0]["price_unit"] == "VND"
    assert websocket.sent[0]["stale"] is True


@pytest.mark.asyncio
async def test_subscription_wakes_idle_broadcaster(connection_manager):
    websocket = FakeWebSocket()
    connection_manager.active_connections[websocket] = set()
    connection_manager.subscribe(websocket, {"VNM"}, 10, 20)
    assert connection_manager.subscriptions_changed.is_set()


@pytest.mark.asyncio
async def test_existing_symbol_demand_does_not_wake_another_cycle(connection_manager):
    first, second = FakeWebSocket(), FakeWebSocket()
    connection_manager.active_connections = {first: set(), second: set()}
    connection_manager.subscribe(first, {"VNM"}, 10, 20)
    connection_manager.subscriptions_changed.clear()
    connection_manager.subscribe(second, {"VNM"}, 10, 20)
    assert not connection_manager.subscriptions_changed.is_set()
    assert connection_manager.active_connections[second] == {"VNM"}


@pytest.mark.asyncio
async def test_existing_socket_receives_session_transition(monkeypatch):
    manager = ConnectionManager()
    websocket = FakeWebSocket()
    manager.active_connections[websocket] = set()
    phase = {"value": "morning"}
    monkeypatch.setattr(websocket_api, "manager", manager)
    monkeypatch.setattr(websocket_api, "get_market_status", lambda: {
        "phase": phase["value"], "is_open": phase["value"] == "morning",
    })
    task = asyncio.create_task(websocket_api.fetch_and_broadcast_prices())
    try:
        for _ in range(10):
            await asyncio.sleep(0)
        assert websocket.sent[-1]["phase"] == "morning"
        phase["value"] = "lunch"
        manager.subscriptions_changed.set()
        for _ in range(20):
            await asyncio.sleep(0)
        assert websocket.sent[-1] == {"type": "market_status", "phase": "lunch", "is_open": False}
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task


@pytest.mark.asyncio
async def test_blocked_sync_worker_keeps_slot_and_does_not_duplicate(monkeypatch):
    import threading

    from vnibb.providers.vnstock.stock_quote import StockQuoteData
    release = threading.Event()
    calls = []
    def blocking_fetch(symbol):
        calls.append(symbol)
        release.wait()
    async def fetch(symbol, _source):
        await asyncio.to_thread(blocking_fetch, symbol)
        return StockQuoteData(symbol=symbol), False
    monkeypatch.setattr(websocket_api.VnstockStockQuoteFetcher, "fetch", fetch)
    monkeypatch.setattr(websocket_api.settings, "websocket_cycle_timeout_seconds", 0.01)
    monkeypatch.setattr(websocket_api, "_equity_slots", asyncio.Semaphore(1))
    try:
        await websocket_api._run_price_cycle({"VNM"}, True)
        await websocket_api._run_price_cycle({"VNM", "FPT"}, True)
        assert calls == ["VNM"]
        assert len(websocket_api._equity_jobs) == 2
    finally:
        release.set()
        await asyncio.gather(*list(websocket_api._equity_jobs.values()))
