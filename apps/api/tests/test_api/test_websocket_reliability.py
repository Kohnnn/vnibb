import asyncio
import json

import pytest
from fastapi import WebSocketDisconnect
from vnibb.api.v1 import websocket as websocket_api
from vnibb.services.websocket_service import ConnectionManager, PriceUpdate


class FakeWebSocket:
    def __init__(self, messages=(), fail_send=False, block_send=False, keep_open=False):
        self.headers = {}
        self.messages = iter(messages)
        self.sent = []
        self.fail_send = fail_send
        self.block_send = block_send
        self.closed_code = None
        self.keep_open = keep_open
        self.waiting = asyncio.Event()
        self.received_update = asyncio.Event()

    async def accept(self):
        pass

    async def close(self, code):
        self.closed_code = code

    async def receive_text(self):
        try:
            return next(self.messages)
        except StopIteration as exc:
            if self.keep_open:
                self.waiting.set()
                await asyncio.Event().wait()
            raise WebSocketDisconnect() from exc

    async def send_json(self, payload):
        if self.fail_send:
            raise RuntimeError("closed")
        if self.block_send:
            await asyncio.Event().wait()
        self.sent.append(payload)
        if "symbol" in payload:
            self.received_update.set()


@pytest.fixture(autouse=True)
def isolated_price_jobs(monkeypatch):
    async def no_stored_quote(_symbol):
        return None, None

    monkeypatch.setattr(websocket_api, "_load_stored_quote", no_stored_quote)
    monkeypatch.setattr(websocket_api, "is_market_open", lambda: True)
    monkeypatch.setattr(websocket_api, "_equity_jobs", {})
    monkeypatch.setattr(websocket_api, "_equity_slots", None)
    monkeypatch.setattr(websocket_api, "_snapshot_jobs", {})
    monkeypatch.setattr(websocket_api, "_snapshot_slots", None)
    monkeypatch.setattr(websocket_api, "_index_job", None)
    monkeypatch.setattr(websocket_api, "_index_snapshot_job", None)


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

    async def fake_fetch(*_, **_kwargs):
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
    await asyncio.gather(*list(websocket_api._equity_jobs.values()))


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
    async def fetch(*args, **_kwargs):
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
    started = asyncio.Event()
    loop = asyncio.get_running_loop()
    calls = []
    def blocking_fetch(symbol):
        calls.append(symbol)
        loop.call_soon_threadsafe(started.set)
        release.wait()
    async def fetch(symbol, _source, **_kwargs):
        await asyncio.to_thread(blocking_fetch, symbol)
        return StockQuoteData(symbol=symbol), False
    monkeypatch.setattr(websocket_api.VnstockStockQuoteFetcher, "fetch", fetch)
    monkeypatch.setattr(websocket_api.settings, "websocket_cycle_timeout_seconds", 0.01)
    monkeypatch.setattr(websocket_api, "_equity_slots", asyncio.Semaphore(1))
    try:
        await websocket_api._run_price_cycle({"VNM"}, True)
        await asyncio.wait_for(started.wait(), 0.5)
        await websocket_api._run_price_cycle({"VNM", "FPT"}, True)
        assert calls == ["VNM"]
        assert len(websocket_api._equity_jobs) == 2
    finally:
        release.set()
        await asyncio.gather(*list(websocket_api._equity_jobs.values()))


@pytest.mark.asyncio
async def test_closed_market_subscriber_receives_stored_observation(monkeypatch):
    from datetime import datetime

    from vnibb.providers.vnstock.stock_quote import StockQuoteData

    manager = ConnectionManager()
    websocket = FakeWebSocket()
    manager.active_connections[websocket] = {"FPT"}

    async def stored(symbol):
        return StockQuoteData(
            symbol=symbol, price=57400, price_unit="VND",
            updated_at=datetime.fromisoformat("2026-10-22T00:00:00+07:00"),
        ), "postgres:stored_quote"

    async def provider(*args, **kwargs):
        pytest.fail("A closed-market snapshot must not acquire provider data")

    monkeypatch.setattr(websocket_api, "manager", manager)
    monkeypatch.setattr(websocket_api, "_load_stored_quote", stored, raising=False)
    monkeypatch.setattr(websocket_api.VnstockStockQuoteFetcher, "fetch", provider)
    await websocket_api._run_price_cycle({"FPT"}, False)

    assert len(websocket.sent) == 1
    assert websocket.sent[0]["price"] == 57400
    assert websocket.sent[0]["as_of"] == "2026-10-22T00:00:00+07:00"
    assert websocket.sent[0]["source"] == "postgres:stored_quote"
    assert websocket.sent[0]["stale"] is True
    assert websocket.sent[0]["change_pct"] is None


@pytest.mark.asyncio
async def test_public_closed_socket_shares_stored_equity_and_index(monkeypatch):
    from contextlib import asynccontextmanager
    from datetime import date, datetime

    from vnibb.providers.vnstock.stock_quote import StockQuoteData

    manager = ConnectionManager()
    calls = {"equity": 0, "index": 0}
    release = asyncio.Event()

    async def stored(symbol):
        calls["equity"] += 1
        await release.wait()
        return StockQuoteData(
            symbol=symbol, price=57400, price_unit="VND",
            updated_at=datetime.fromisoformat("2026-10-22T00:00:00+07:00"),
        ), "postgres:stored_quote"

    @asynccontextmanager
    async def session():
        yield object()

    async def indices(_db):
        calls["index"] += 1
        await release.wait()
        return [{"index_name": "VNINDEX", "current_value": 1760.63,
                 "time": date(2026, 10, 22)}]

    async def provider(*args, **kwargs):
        pytest.fail("Closed sockets must not acquire provider data")

    monkeypatch.setattr(websocket_api, "manager", manager)
    monkeypatch.setattr(websocket_api, "get_market_status", lambda: {
        "phase": "after-close", "is_open": False,
    })
    monkeypatch.setattr(websocket_api, "_load_stored_quote", stored)
    monkeypatch.setattr(websocket_api, "async_session_factory", session)
    monkeypatch.setattr(websocket_api, "_load_latest_market_indices_from_db", indices)
    monkeypatch.setattr(websocket_api, "_fetch_yahoo_market_indices", provider)
    monkeypatch.setattr(websocket_api.VnstockStockQuoteFetcher, "fetch", provider)
    monkeypatch.setattr(websocket_api.VnstockMarketOverviewFetcher, "fetch", provider)
    sockets = [FakeWebSocket(
        [json.dumps({"action": "subscribe", "symbols": ["FPT", "VNINDEX"]})],
        keep_open=True,
    ) for _ in range(2)]
    endpoints = [asyncio.create_task(websocket_api.websocket_prices(ws)) for ws in sockets]
    broadcaster = asyncio.create_task(websocket_api.fetch_and_broadcast_prices())
    try:
        await asyncio.wait_for(asyncio.gather(*(ws.waiting.wait() for ws in sockets)), 0.5)
        release.set()
        await asyncio.wait_for(asyncio.gather(*(ws.received_update.wait() for ws in sockets)), 0.5)
        await asyncio.wait_for(asyncio.gather(
            *list(websocket_api._snapshot_jobs.values()), websocket_api._index_snapshot_job
        ), 0.5)
        assert calls == {"equity": 1, "index": 1}
        for ws in sockets:
            updates = {row["symbol"]: row for row in ws.sent if "symbol" in row}
            assert updates["FPT"]["price"] == 57400
            assert updates["FPT"]["source"] == "postgres:stored_quote"
            assert updates["FPT"]["as_of"] == "2026-10-22T00:00:00+07:00"
            assert updates["FPT"]["stale"] is True
            assert updates["VNINDEX"]["price"] == 1760.63
            assert updates["VNINDEX"]["source"] == "database:stock_indices"
            assert updates["VNINDEX"]["as_of"] == "2026-10-22T00:00:00+07:00"
            assert updates["VNINDEX"]["stale"] is True
    finally:
        release.set()
        for task in [broadcaster, *endpoints]:
            task.cancel()
        await asyncio.gather(broadcaster, *endpoints, return_exceptions=True)


@pytest.mark.asyncio
async def test_public_new_subscribers_receive_snapshot_while_provider_stalls(monkeypatch):
    from datetime import datetime

    from vnibb.providers.vnstock.stock_quote import StockQuoteData

    manager = ConnectionManager()
    provider_started, release_provider = asyncio.Event(), asyncio.Event()
    calls = {"provider": 0, "stored": 0}
    observation = {"price": 57400}

    async def provider(symbol, _source, **_kwargs):
        calls["provider"] += 1
        provider_started.set()
        await release_provider.wait()
        return StockQuoteData(symbol=symbol), False

    async def stored(symbol):
        calls["stored"] += 1
        return StockQuoteData(
            symbol=symbol, price=observation["price"], price_unit="VND",
            updated_at=datetime.fromisoformat("2026-10-22T00:00:00+07:00"),
        ), "postgres:stored_quote"

    monkeypatch.setattr(websocket_api, "manager", manager)
    monkeypatch.setattr(websocket_api, "get_market_status", lambda: {
        "phase": "morning", "is_open": True,
    })
    monkeypatch.setattr(websocket_api, "_load_stored_quote", stored)
    monkeypatch.setattr(websocket_api.VnstockStockQuoteFetcher, "fetch", provider)
    monkeypatch.setattr(websocket_api, "_equity_slots", asyncio.Semaphore(1))
    await websocket_api._run_price_cycle({"VNM"}, True)
    await asyncio.wait_for(provider_started.wait(), 0.5)
    calls["stored"] = 0
    sockets = [FakeWebSocket(
        [json.dumps({"action": "subscribe", "symbols": ["FPT"]})], keep_open=True,
    ) for _ in range(2)]
    endpoints = [asyncio.create_task(websocket_api.websocket_prices(ws)) for ws in sockets]
    broadcaster = asyncio.create_task(websocket_api.fetch_and_broadcast_prices())
    try:
        await asyncio.wait_for(asyncio.gather(*(ws.received_update.wait() for ws in sockets)), 0.5)
        assert calls == {"provider": 1, "stored": 1}
        assert all(ws.sent[-1]["price"] == 57400 for ws in sockets)
        await asyncio.gather(*list(websocket_api._snapshot_jobs.values()))
        sockets[0].received_update.clear()
        observation["price"] = 57600
        await websocket_api._run_price_cycle({"FPT"}, True)
        await asyncio.wait_for(sockets[0].received_update.wait(), 0.5)
        assert calls["provider"] == 1
        assert all(ws.sent[-1]["price"] == 57600 for ws in sockets)
    finally:
        release_provider.set()
        for task in [broadcaster, *endpoints]:
            task.cancel()
        await asyncio.gather(broadcaster, *endpoints, return_exceptions=True)
        await asyncio.gather(*list(websocket_api._equity_jobs.values()))


@pytest.mark.asyncio
async def test_equal_time_stored_replay_does_not_downgrade_live_quote(connection_manager):
    from datetime import UTC, datetime

    websocket = FakeWebSocket()
    connection_manager.active_connections[websocket] = {"VNM"}
    live = price_update().model_copy(update={
        "timestamp": datetime.now(UTC).isoformat(), "source": "provider:live",
    })
    stored = live.model_copy(update={"source": "database:stored", "stale": True})

    await connection_manager.broadcast_price("VNM", live, 0.1)
    await connection_manager.broadcast_price("VNM", stored, 0.1)

    assert connection_manager._price_cache["VNM"] is live
    assert len(websocket.sent) == 1
    assert websocket.sent[0]["source"] == "provider:live"
    assert websocket.sent[0]["stale"] is False


@pytest.mark.asyncio
async def test_shutdown_cancels_snapshots_without_releasing_provider_slot(monkeypatch):
    release = asyncio.Event()
    snapshot = asyncio.create_task(asyncio.Event().wait())
    index_snapshot = asyncio.create_task(asyncio.Event().wait())
    provider = asyncio.create_task(release.wait())
    monkeypatch.setattr(websocket_api, "_background_task", None)
    websocket_api._snapshot_jobs["FPT"] = snapshot
    websocket_api._equity_jobs["VNM"] = provider
    monkeypatch.setattr(websocket_api, "_index_snapshot_job", index_snapshot)
    try:
        await websocket_api.stop_background_fetcher()

        assert snapshot.cancelled()
        assert index_snapshot.cancelled()
        assert websocket_api._snapshot_jobs == {}
        assert websocket_api._index_snapshot_job is None
        assert websocket_api._equity_jobs["VNM"] is provider
        assert not provider.done()
    finally:
        release.set()
        await provider


@pytest.mark.asyncio
async def test_public_quote_socket_owns_worker_past_provider_deadline(client, monkeypatch):
    import threading
    from datetime import datetime
    from types import SimpleNamespace

    from vnibb.api.v1 import equity
    from vnibb.providers.vnstock import runtime
    from vnibb.providers.vnstock.stock_quote import QuoteCache, VnstockStockQuoteFetcher

    loop = asyncio.get_running_loop()
    release = threading.Event()
    started = asyncio.Event()
    submitted = []
    workers = []
    calls = []
    run_in_executor = loop.run_in_executor

    def submit(executor, operation, *args):
        future = run_in_executor(executor, operation, *args)
        if getattr(operation, "__name__", None) == "_fetch":
            submitted.append(operation)
            workers.append(future)
        return future

    class History:
        empty = False

        def __init__(self, price):
            self.price = price

        def to_dict(self, orient):
            return [{"time": datetime.now().isoformat(), "close": self.price, "volume": 123}]

    class Provider:
        def stock(self, **kwargs):
            calls.append(kwargs)
            price = 70.1
            if kwargs["symbol"] == "FPT":
                price = 57.4 if sum(call["symbol"] == "FPT" for call in calls) == 1 else 57.6

            def history(**_kwargs):
                loop.call_soon_threadsafe(started.set)
                if not release.wait(5):
                    raise TimeoutError("Test did not release quote worker")
                return History(price)

            return SimpleNamespace(quote=SimpleNamespace(history=history))

    async def no_quote(*_args, **_kwargs):
        return None

    async def http_deadline(awaitable, timeout):
        return await asyncio.wait_for(awaitable, timeout=min(timeout, 0.05))

    manager = ConnectionManager()
    socket = FakeWebSocket(
        [json.dumps({"action": "subscribe", "symbols": [" fpt "]})], keep_open=True,
    )
    second_socket = FakeWebSocket(
        [json.dumps({"action": "subscribe", "symbols": ["VNM"]})], keep_open=True,
    )
    monkeypatch.setattr(loop, "run_in_executor", submit)
    monkeypatch.setattr(runtime, "get_vnstock_class", lambda: Provider)
    monkeypatch.setattr(runtime, "_reference_jobs", {})
    monkeypatch.setattr(QuoteCache, "_cache", {})
    monkeypatch.setattr(QuoteCache, "_ttl_seconds", 0)
    monkeypatch.setattr(equity, "asyncio", SimpleNamespace(wait_for=http_deadline))
    monkeypatch.setattr(equity, "_load_quote_from_database", no_quote)
    monkeypatch.setattr(equity, "_load_quote_from_mongo", no_quote)
    monkeypatch.setattr(equity, "_load_latest_screener_snapshot_quote", no_quote)
    monkeypatch.setattr(websocket_api, "manager", manager)
    monkeypatch.setattr(websocket_api, "get_market_status", lambda: {
        "phase": "morning", "is_open": True,
    })
    monkeypatch.setattr(websocket_api.settings, "vnstock_timeout", 0.1)
    monkeypatch.setattr(websocket_api.settings, "websocket_fetch_concurrency", 1)
    monkeypatch.setattr(websocket_api.settings, "vnstock_source", "VCI")
    first_http = asyncio.create_task(client.get("/api/v1/equity/fpt/quote?refresh=true"))
    tasks = [first_http]
    try:
        await asyncio.wait_for(started.wait(), 0.5)
        endpoint = asyncio.create_task(websocket_api.websocket_prices(socket))
        broadcaster = asyncio.create_task(websocket_api.fetch_and_broadcast_prices())
        tasks.extend([endpoint, broadcaster])
        await asyncio.wait_for(socket.waiting.wait(), 0.5)
        await websocket_api._run_price_cycle({"FPT"}, True)
        assert websocket_api._equity_slots.locked()
        second_endpoint = asyncio.create_task(websocket_api.websocket_prices(second_socket))
        tasks.append(second_endpoint)
        await asyncio.wait_for(second_socket.waiting.wait(), 0.5)
        responses = [await first_http]
        for _ in range(2):
            responses.append(await client.get("/api/v1/equity/FPT/quote?refresh=true"))

        cancelled = asyncio.create_task(VnstockStockQuoteFetcher.fetch(" fpt ", " vci "))
        tasks.append(cancelled)
        await asyncio.sleep(0)
        cancelled.cancel()
        with pytest.raises(asyncio.CancelledError):
            await cancelled

        # Keep the synchronous acquisition held beyond the provider's own deadline,
        # not just the shorter HTTP/cycle deadline.
        await asyncio.sleep(0.12)
        assert all(response.status_code == 200 for response in responses)
        assert all(response.json()["data"] is None for response in responses)
        assert all(response.json()["error"] == "Quote unavailable." for response in responses)
        assert len(submitted) == 1
        assert calls == [{"symbol": "FPT", "source": "VCI"}]
        assert not workers[0].done()
        assert not websocket_api._equity_jobs["FPT"].done()
        assert "VNM" in websocket_api._equity_jobs
        assert not second_socket.received_update.is_set()

        release.set()
        await asyncio.wait_for(socket.received_update.wait(), 0.5)
        await asyncio.wait_for(second_socket.received_update.wait(), 0.5)
        await asyncio.gather(*list(websocket_api._equity_jobs.values()))
        assert socket.sent[-1]["symbol"] == "FPT"
        assert socket.sent[-1]["price"] == 57400
        assert socket.sent[-1]["source"] == "vnstock:VCI:quote.history"
        assert second_socket.sent[-1]["price"] == 70100
        assert len(submitted) == 2
        assert calls == [{"symbol": "FPT", "source": "VCI"}, {"symbol": "VNM", "source": "VCI"}]
        assert workers[0].done()
        assert websocket_api._equity_jobs == {}
        assert runtime._reference_jobs == {}

        response = await client.get("/api/v1/equity/fpt/quote?refresh=true")
        assert response.status_code == 200
        assert response.json()["data"]["price"] == 57600
        assert len(submitted) == 3
        assert calls == [
            {"symbol": "FPT", "source": "VCI"}, {"symbol": "VNM", "source": "VCI"},
            {"symbol": "FPT", "source": "VCI"},
        ]
        assert runtime._reference_jobs == {}
    finally:
        release.set()
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await asyncio.gather(*list(websocket_api._equity_jobs.values()), return_exceptions=True)
        await asyncio.gather(*workers, return_exceptions=True)
