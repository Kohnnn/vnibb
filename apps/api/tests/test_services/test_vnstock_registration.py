from __future__ import annotations

import asyncio
import sys
import types

import pytest

from vnibb.services import vnstock_registration as registration


@pytest.fixture
def isolated_registration(monkeypatch):
    monkeypatch.setattr(registration.settings, "vnstock_api_key", "synthetic-key")
    monkeypatch.setattr(registration, "_local_registered", set())
    monkeypatch.setattr(registration, "_registration_tasks", {})
    monkeypatch.setattr(registration, "_local_lock", asyncio.Lock())
    monkeypatch.setattr(
        registration,
        "_acquire_lock",
        lambda _key: _acquired_lock(),
    )
    monkeypatch.setattr(registration, "_release_lock", _release_lock)



async def _acquired_lock():
    return registration._LockState(True, "test")


async def _release_lock(_key, _lock):
    return None


def _sdk(monkeypatch, **exports):
    module = types.ModuleType("vnstock")
    for name, value in exports.items():
        setattr(module, name, value)
    monkeypatch.setitem(sys.modules, "vnstock", module)
    return module


@pytest.mark.asyncio
@pytest.mark.parametrize(("answer", "expected"), [(True, True), (False, False)])
async def test_registration_keeps_v4_boolean_auth_result(isolated_registration, monkeypatch, answer, expected):
    calls = []
    _sdk(monkeypatch, change_api_key=lambda key: calls.append(key) or answer)

    result = await registration.ensure_vnstock_registration()

    assert result.registered is expected
    assert calls == ["synthetic-key"]


@pytest.mark.asyncio
async def test_registration_accepts_authenticated_v5_status(isolated_registration, monkeypatch):
    calls = []
    _sdk(monkeypatch, setup_api_key=lambda key: calls.append(key) or {"authenticated": True})

    result = await registration.ensure_vnstock_registration()

    assert result.registered is True
    assert result.reason == "registered"
    assert calls == ["synthetic-key"]


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [{"authenticated": False}, {}, None, "authenticated"])
async def test_registration_rejects_false_or_malformed_v5_status(
    isolated_registration, monkeypatch, status
):
    calls = []
    _sdk(monkeypatch, setup_api_key=lambda key: calls.append(key) or status)

    result = await registration.ensure_vnstock_registration()

    assert result.registered is False
    assert result.reason == "registration_failed"
    assert calls == ["synthetic-key"]


@pytest.mark.asyncio
@pytest.mark.parametrize("error", [SystemExit(67), KeyboardInterrupt()])
async def test_sdk_nonstandard_exit_is_registration_failure(isolated_registration, monkeypatch, error):
    calls = []

    def failed_auth(key):
        calls.append(key)
        raise error

    _sdk(monkeypatch, setup_api_key=failed_auth)

    result = await registration.ensure_vnstock_registration()

    assert result.registered is False
    assert result.reason == "registration_failed"
    assert calls == ["synthetic-key"]


@pytest.mark.asyncio
async def test_failed_v5_login_does_not_fall_back_to_v4(isolated_registration, monkeypatch):
    calls = []

    def failed_v5(key):
        calls.append(("v5", key))
        return {"authenticated": False}

    def forbidden_v4(key):
        calls.append(("v4", key))
        return True

    _sdk(monkeypatch, setup_api_key=failed_v5, change_api_key=forbidden_v4)

    result = await registration.ensure_vnstock_registration()

    assert result.registered is False
    assert calls == [("v5", "synthetic-key")]


@pytest.mark.asyncio
async def test_concurrent_registration_shares_blocked_authentication(isolated_registration, monkeypatch):
    import threading

    loop = asyncio.get_running_loop()
    worker_started = asyncio.Event()
    unblock_worker = threading.Event()
    calls = []

    def blocked_auth(key):
        calls.append(key)
        loop.call_soon_threadsafe(worker_started.set)
        unblock_worker.wait()
        return {"authenticated": True}

    _sdk(monkeypatch, setup_api_key=blocked_auth)
    first = asyncio.create_task(registration.ensure_vnstock_registration())
    try:
        await asyncio.wait_for(worker_started.wait(), timeout=1)
        second = asyncio.create_task(registration.ensure_vnstock_registration())
        await asyncio.sleep(0)
        assert calls == ["synthetic-key"]
    finally:
        unblock_worker.set()

    first_result, second_result = await asyncio.gather(first, second)
    assert first_result.registered is True
    assert second_result.registered is True
    assert first_result.reason == second_result.reason == "registered"
    assert calls == ["synthetic-key"]


async def test_shared_persistent_state_does_not_skip_device_authentication(
    isolated_registration, monkeypatch
):
    import json

    calls = []
    cache_reads = []
    _sdk(monkeypatch, setup_api_key=lambda key: calls.append(key) or {"authenticated": False})

    class SharedCache:
        async def get(self, _key):
            cache_reads.append(True)
            return json.dumps({"status": "registered", "source": "legacy-4x"})

    async def get_shared_cache():
        return SharedCache()

    monkeypatch.setattr(registration, "_get_redis_client", get_shared_cache)

    result = await registration.ensure_vnstock_registration()

    assert result.registered is False
    assert result.reason == "registration_failed"
    assert calls == ["synthetic-key"]
    assert cache_reads == []

async def test_registration_cancellation_returns_before_worker_and_holds_lock(
    isolated_registration, monkeypatch
):
    import threading

    loop = asyncio.get_running_loop()
    worker_started = asyncio.Event()
    lock_released = asyncio.Event()
    unblock_worker = threading.Event()
    released = []

    def blocked_auth(_key):
        loop.call_soon_threadsafe(worker_started.set)
        unblock_worker.wait()
        return {"authenticated": True}

    async def release_lock(key, lock):
        released.append((key, lock))
        lock_released.set()

    _sdk(monkeypatch, setup_api_key=blocked_auth)
    monkeypatch.setattr(registration, "_release_lock", release_lock)
    task = asyncio.create_task(registration.ensure_vnstock_registration())

    try:
        await asyncio.wait_for(worker_started.wait(), timeout=1)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(task, timeout=0.1)
        assert released == []
    finally:
        unblock_worker.set()

    await asyncio.wait_for(lock_released.wait(), timeout=1)
    assert len(released) == 1



@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("setting", "value"),
    [("VNSTOCK_RUNTIME_TIER", "premium"), ("VNSTOCK_SOURCE", "KBS")],
)
async def test_environment_policy_rejects_registration_before_sdk_import(
    isolated_registration, monkeypatch, setting, value
):
    import builtins

    imports = []
    original_import = builtins.__import__

    def track_sdk_import(name, *args, **kwargs):
        if name == "vnstock":
            imports.append(name)
            raise AssertionError("SDK import must not run under non-free environment")
        return original_import(name, *args, **kwargs)

    monkeypatch.setenv(setting, value)
    monkeypatch.setattr(builtins, "__import__", track_sdk_import)

    result = await registration.ensure_vnstock_registration()

    assert result.registered is False
    assert imports == []


async def test_free_vci_guard_rejects_paid_runtime_before_sdk_import(isolated_registration, monkeypatch):
    import builtins

    from vnibb.providers.vnstock import runtime

    imports = []
    original_import = builtins.__import__

    def track_sdk_import(name, *args, **kwargs):
        if name == "vnstock":
            imports.append(name)
            raise AssertionError("SDK import must not run under paid runtime")
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(runtime, "find_spec", lambda name: object() if name == "vnstock_data" else None)
    monkeypatch.setattr(builtins, "__import__", track_sdk_import)

    result = await registration.ensure_vnstock_registration()

    assert result.registered is False
    assert imports == []
