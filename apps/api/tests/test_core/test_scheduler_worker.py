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
