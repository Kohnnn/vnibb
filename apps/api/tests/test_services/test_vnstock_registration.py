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
async def test_free_tier_supplied_golden_key_persists_nothing(isolated_registration, monkeypatch):
    persisted = {"value": None}
    _sdk(
        monkeypatch,
        setup_api_key=lambda key: (persisted.__setitem__("value", key), {"authenticated": True, "tier": "golden"})[1],
        login=lambda key: (persisted.__setitem__("value", key), {"authenticated": True, "tier": "golden"})[1],
        status=lambda: {"authenticated": False, "tier": "guest"},
        logout=lambda: None,
    )
    monkeypatch.setattr(registration.settings, "vnstock_runtime_tier", "free")
    monkeypatch.setenv("VNSTOCK_RUNTIME_TIER", "free")

    result = await registration.ensure_vnstock_registration()

    assert result.registered is False
    assert result.reason == "registration_failed"
    # The free runtime must never call a persisting login for a user-supplied key.
    assert persisted["value"] is None


@pytest.mark.asyncio
async def test_free_tier_without_persisting_validator_declines(isolated_registration, monkeypatch):
    calls = []
    _sdk(monkeypatch, setup_api_key=lambda key: calls.append(key) or {"authenticated": True, "tier": "free"})
    monkeypatch.setattr(registration.settings, "vnstock_runtime_tier", "free")
    monkeypatch.setenv("VNSTOCK_RUNTIME_TIER", "free")

    result = await registration.ensure_vnstock_registration()

    assert result.registered is False
    assert result.reason == "registration_failed"
    assert calls == []


@pytest.mark.asyncio
@pytest.mark.parametrize("tier, expected", [("golden", True), ("diamond", True), ("free", False), ("silver", False), (None, False)])
async def test_golden_registration_requires_entitled_sdk_status(isolated_registration, monkeypatch, tier, expected):
    monkeypatch.setenv("VNSTOCK_RUNTIME_TIER", "golden")
    monkeypatch.setattr(registration.settings, "vnstock_runtime_tier", "golden")
    cleared = []
    _sdk(
        monkeypatch,
        setup_api_key=lambda key: True,
        status=lambda: {"authenticated": True, "tier": tier},
        logout=lambda: cleared.append(True),
    )

    result = await registration.ensure_vnstock_registration()
    assert result.registered is expected
    if not expected:
        assert cleared == [True]


@pytest.mark.asyncio
async def test_sdk_auth_error_does_not_disclose_key(isolated_registration, monkeypatch, caplog):
    def failed_auth(key):
        raise RuntimeError(key)

    monkeypatch.setenv("VNSTOCK_RUNTIME_TIER", "golden")
    monkeypatch.setattr(registration.settings, "vnstock_runtime_tier", "golden")
    _sdk(monkeypatch, setup_api_key=failed_auth)
    result = await registration.ensure_vnstock_registration()
    assert not result.registered
    assert "synthetic-key" not in caplog.text
    assert "synthetic-key" not in repr(result)


@pytest.mark.asyncio
async def test_golden_registration_rejects_free_tier_status(isolated_registration, monkeypatch):
    monkeypatch.setenv("VNSTOCK_RUNTIME_TIER", "golden")
    monkeypatch.setattr(registration.settings, "vnstock_runtime_tier", "golden")
    cleared = []
    _sdk(
        monkeypatch,
        setup_api_key=lambda key: True,
        status=lambda: {"authenticated": True, "tier": "free"},
        logout=lambda: cleared.append(True),
    )
    assert not (await registration.ensure_vnstock_registration()).registered
    assert cleared == [True]


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [{"authenticated": False}, {}, None, "authenticated"])
async def test_registration_rejects_false_or_malformed_v5_status(
    isolated_registration, monkeypatch, status
):
    calls = []
    cleared = []
    monkeypatch.setenv("VNSTOCK_RUNTIME_TIER", "golden")
    monkeypatch.setattr(registration.settings, "vnstock_runtime_tier", "golden")
    _sdk(
        monkeypatch,
        setup_api_key=lambda key: calls.append(key) or True,
        status=lambda: status,
        logout=lambda: cleared.append(True),
    )

    result = await registration.ensure_vnstock_registration()

    assert result.registered is False
    assert result.reason == "registration_failed"
    assert calls == ["synthetic-key"]
    assert cleared == [True]


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [{"authenticated": True}, {"authenticated": True, "tier": ""}])
async def test_registration_rejects_authenticated_empty_tier(
    isolated_registration, monkeypatch, status
):
    cleared = []
    monkeypatch.setenv("VNSTOCK_RUNTIME_TIER", "golden")
    monkeypatch.setattr(registration.settings, "vnstock_runtime_tier", "golden")
    _sdk(
        monkeypatch,
        setup_api_key=lambda key: True,
        status=lambda: status,
        logout=lambda: cleared.append(True),
    )

    result = await registration.ensure_vnstock_registration()

    assert result.registered is False
    assert cleared == [True]

@pytest.mark.asyncio
async def test_login_succeeds_then_status_raises_clears_persisted_key(
    isolated_registration, monkeypatch
):
    cleared = []

    def exploding_status():
        raise RuntimeError("status transport down")

    monkeypatch.setenv("VNSTOCK_RUNTIME_TIER", "golden")
    monkeypatch.setattr(registration.settings, "vnstock_runtime_tier", "golden")
    _sdk(
        monkeypatch,
        setup_api_key=lambda key: True,
        status=exploding_status,
        logout=lambda: cleared.append(True),
    )

    result = await registration.ensure_vnstock_registration()

    assert result.registered is False
    assert result.reason == "registration_failed"
    # The persisted credential is cleared even though the status read raised.
    assert cleared == [True]



@pytest.mark.asyncio
@pytest.mark.parametrize("error", [SystemExit(67), KeyboardInterrupt()])
async def test_sdk_nonstandard_exit_is_registration_failure(isolated_registration, monkeypatch, error):
    calls = []

    def failed_auth(key):
        calls.append(key)
        raise error

    monkeypatch.setenv("VNSTOCK_RUNTIME_TIER", "golden")
    monkeypatch.setattr(registration.settings, "vnstock_runtime_tier", "golden")
    _sdk(monkeypatch, setup_api_key=failed_auth)

    result = await registration.ensure_vnstock_registration()

    assert result.registered is False
    assert result.reason == "registration_failed"
    assert calls == ["synthetic-key"]


@pytest.mark.asyncio
async def test_failed_v5_login_does_not_fall_back_to_v4(isolated_registration, monkeypatch):
    calls = []
    cleared = []

    def failed_v5(key):
        calls.append(("v5", key))
        return True

    def forbidden_v4(key):
        calls.append(("v4", key))
        return True

    monkeypatch.setenv("VNSTOCK_RUNTIME_TIER", "golden")
    monkeypatch.setattr(registration.settings, "vnstock_runtime_tier", "golden")
    _sdk(
        monkeypatch,
        setup_api_key=failed_v5,
        status=lambda: {"authenticated": False},
        logout=lambda: cleared.append(True),
        change_api_key=forbidden_v4,
    )

    result = await registration.ensure_vnstock_registration()

    assert result.registered is False
    assert calls == [("v5", "synthetic-key")]
    assert cleared == [True]


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
        return True

    monkeypatch.setenv("VNSTOCK_RUNTIME_TIER", "golden")
    monkeypatch.setattr(registration.settings, "vnstock_runtime_tier", "golden")
    _sdk(
        monkeypatch,
        setup_api_key=blocked_auth,
        status=lambda: {"authenticated": True, "tier": "golden"},
    )
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
    monkeypatch.setenv("VNSTOCK_RUNTIME_TIER", "golden")
    monkeypatch.setattr(registration.settings, "vnstock_runtime_tier", "golden")
    cache_reads = []
    _sdk(
        monkeypatch,
        setup_api_key=lambda key: calls.append(key) or True,
        status=lambda: {"authenticated": False},
        logout=lambda: None,
    )

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
        return True

    async def release_lock(key, lock):
        released.append((key, lock))
        lock_released.set()

    monkeypatch.setenv("VNSTOCK_RUNTIME_TIER", "golden")
    monkeypatch.setattr(registration.settings, "vnstock_runtime_tier", "golden")
    _sdk(
        monkeypatch,
        setup_api_key=blocked_auth,
        status=lambda: {"authenticated": True, "tier": "golden"},
    )
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


@pytest.mark.asyncio
@pytest.mark.parametrize("reason", ["no_api_key", "lock_busy", "registration_failed"])
async def test_golden_startup_rejects_unregistered_status(monkeypatch, reason):
    from vnibb.api import main

    monkeypatch.setattr(main.settings, "vnstock_runtime_tier", "golden")

    async def failed():
        return registration.RegistrationResult(False, reason)

    monkeypatch.setattr(registration, "ensure_vnstock_registration", failed)
    with pytest.raises(RuntimeError, match="VNStock Golden registration failed"):
        await main._register_vnstock_on_startup()


@pytest.mark.asyncio
async def test_golden_startup_sanitizes_registration_exception(monkeypatch, caplog):
    from vnibb.api import main

    monkeypatch.setattr(main.settings, "vnstock_runtime_tier", "golden")

    async def failed():
        raise RuntimeError("synthetic-secret")

    monkeypatch.setattr(registration, "ensure_vnstock_registration", failed)
    with pytest.raises(RuntimeError, match="VNStock Golden registration failed") as error:
        await main._register_vnstock_on_startup()
    assert error.value.__suppress_context__
    assert "synthetic-secret" not in caplog.text


@pytest.mark.asyncio
async def test_golden_startup_accepts_registered_status(monkeypatch):
    from vnibb.api import main

    monkeypatch.setattr(main.settings, "vnstock_runtime_tier", "golden")

    async def registered():
        return registration.RegistrationResult(True, "registered")

    monkeypatch.setattr(registration, "ensure_vnstock_registration", registered)
    await main._register_vnstock_on_startup()


def test_warmup_loads_facades_without_provider_requests(monkeypatch):
    from vnibb.api import main
    from vnibb.providers.vnstock import runtime

    names = []
    monkeypatch.setattr(runtime, "import_vnstock_symbol", lambda name: names.append(name))
    main._warmup_vnstock_sync()
    assert names == ["Company", "Finance", "Listing"]
