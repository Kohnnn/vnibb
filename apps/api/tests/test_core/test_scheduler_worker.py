from unittest.mock import AsyncMock, Mock

import pytest

from vnibb import scheduler_worker
from vnibb.api.main import should_start_scheduler
from vnibb.core.config import settings


@pytest.mark.asyncio
async def test_scheduler_worker_starts_scheduler_only_for_scheduler_role(monkeypatch):
    monkeypatch.setattr(settings, "scheduler_role", "scheduler")
    connect = AsyncMock()
    start_scheduler = Mock()
    pipeline = Mock(reconcile_streaming=AsyncMock())
    monkeypatch.setattr(scheduler_worker.redis_client, "connect", connect)
    monkeypatch.setattr(scheduler_worker, "start_scheduler", start_scheduler)
    monkeypatch.setattr(scheduler_worker, "get_realtime_pipeline", Mock(return_value=pipeline))

    await scheduler_worker.start()

    connect.assert_awaited_once()
    start_scheduler.assert_called_once()
    pipeline.reconcile_streaming.assert_awaited_once()


@pytest.mark.asyncio
async def test_scheduler_worker_rejects_api_role(monkeypatch):
    monkeypatch.setattr(settings, "scheduler_role", "api")

    with pytest.raises(RuntimeError, match="SCHEDULER_ROLE=scheduler"):
        await scheduler_worker.start()


def test_api_role_skips_scheduler_by_default(monkeypatch):
    monkeypatch.delenv("SKIP_SCHEDULER_STARTUP", raising=False)
    monkeypatch.setattr(settings, "scheduler_role", "api")

    assert not should_start_scheduler()


@pytest.mark.asyncio
async def test_scheduler_worker_registers_golden_before_starting_jobs(monkeypatch):
    """The scheduler process has no API lifespan; it must register Golden itself."""
    from vnibb.providers.vnstock import registration as vnstock_registration

    monkeypatch.setattr(settings, "scheduler_role", "scheduler")
    monkeypatch.setattr(settings, "vnstock_runtime_tier", "golden")
    order = []
    register = AsyncMock(side_effect=lambda: order.append("register") or
                         vnstock_registration.RegistrationResult(True, "registered"))
    start_scheduler = Mock(side_effect=lambda: order.append("start"))
    pipeline = Mock(reconcile_streaming=AsyncMock())
    monkeypatch.setattr(scheduler_worker.redis_client, "connect", AsyncMock())
    monkeypatch.setattr(scheduler_worker, "ensure_vnstock_registration", register)
    monkeypatch.setattr(scheduler_worker, "start_scheduler", start_scheduler)
    monkeypatch.setattr(scheduler_worker, "get_realtime_pipeline", Mock(return_value=pipeline))

    await scheduler_worker.start()

    assert order == ["register", "start"]
    register.assert_awaited_once()


@pytest.mark.asyncio
async def test_scheduler_worker_fails_closed_when_golden_registration_fails(monkeypatch):
    from vnibb.providers.vnstock import registration as vnstock_registration

    monkeypatch.setattr(settings, "scheduler_role", "scheduler")
    monkeypatch.setattr(settings, "vnstock_runtime_tier", "golden")
    start_scheduler = Mock()
    monkeypatch.setattr(scheduler_worker.redis_client, "connect", AsyncMock())
    monkeypatch.setattr(scheduler_worker, "ensure_vnstock_registration",
                        AsyncMock(return_value=vnstock_registration.RegistrationResult(False, "no_api_key")))
    monkeypatch.setattr(scheduler_worker, "start_scheduler", start_scheduler)
    monkeypatch.setattr(scheduler_worker, "get_realtime_pipeline", Mock(return_value=Mock(reconcile_streaming=AsyncMock())))

    with pytest.raises(RuntimeError, match="registration"):
        await scheduler_worker.start()
    start_scheduler.assert_not_called()


@pytest.mark.asyncio
async def test_scheduler_worker_free_tier_does_not_require_registration(monkeypatch):
    from vnibb.providers.vnstock import registration as vnstock_registration

    monkeypatch.setattr(settings, "scheduler_role", "scheduler")
    monkeypatch.setattr(settings, "vnstock_runtime_tier", "free")
    start_scheduler = Mock()
    monkeypatch.setattr(scheduler_worker.redis_client, "connect", AsyncMock())
    monkeypatch.setattr(scheduler_worker, "ensure_vnstock_registration",
                        AsyncMock(return_value=vnstock_registration.RegistrationResult(False, "no_api_key")))
    monkeypatch.setattr(scheduler_worker, "start_scheduler", start_scheduler)
    monkeypatch.setattr(scheduler_worker, "get_realtime_pipeline", Mock(return_value=Mock(reconcile_streaming=AsyncMock())))

    await scheduler_worker.start()

    start_scheduler.assert_called_once()
