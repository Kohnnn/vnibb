from unittest.mock import AsyncMock

import pytest

from vnibb.core import scheduler, scheduler_lock
from vnibb.core.config import settings
from vnibb.core.scheduler_lock import DistributedJobLock


class FakeRedis:
    def __init__(self):
        self.values = {}
        self.expiries = {}

    @property
    def client(self):
        return self

    async def connect(self):
        return None

    async def set(self, key, value, nx=False, ex=None):
        if nx and key in self.values:
            return False
        self.values[key] = value
        self.expiries[key] = ex
        return True

    async def eval(self, script, count, key, token):
        if self.values.get(key) != token:
            return 0
        del self.values[key]
        self.expiries.pop(key, None)
        return 1


@pytest.fixture
def fake_redis(monkeypatch):
    client = FakeRedis()
    monkeypatch.setattr(scheduler_lock, "redis_client", client)
    return client


@pytest.mark.asyncio
async def test_lock_releases_only_its_owner(fake_redis):
    owner = DistributedJobLock("daily_sync", 10)
    assert await owner.acquire() == "acquired"
    assert await owner.release()
    assert owner.key not in fake_redis.values
    assert await owner.acquire() == "acquired"
    replacement = DistributedJobLock("daily_sync", 10)
    replacement.token = "replacement-token"
    fake_redis.values[owner.key] = replacement.token
    assert not await owner.release()
    assert fake_redis.values[owner.key] == replacement.token


@pytest.mark.asyncio
async def test_lock_contention_and_expiry_allow_next_owner(fake_redis):
    first = DistributedJobLock("hourly_news", 10)
    second = DistributedJobLock("hourly_news", 10)
    assert await first.acquire() == "acquired"
    assert fake_redis.expiries[first.key] == 70
    assert await second.acquire() == "contended"
    fake_redis.values.pop(first.key)
    assert await second.acquire() == "acquired"


@pytest.mark.asyncio
async def test_required_mode_skips_when_redis_is_unavailable(monkeypatch):
    class UnavailableLock:
        def __init__(self, *args):
            pass

        async def acquire(self):
            return "unavailable"

        async def release(self):
            return True

    runner = AsyncMock()
    scheduler._job_guards.clear()
    monkeypatch.setattr(settings, "scheduler_lock_mode", "required")
    monkeypatch.setattr(scheduler, "DistributedJobLock", UnavailableLock)
    await scheduler._run_guarded_job("required_job", runner, 10)
    runner.assert_not_awaited()


@pytest.mark.asyncio
async def test_best_effort_mode_runs_when_redis_is_unavailable(monkeypatch):
    class UnavailableLock:
        def __init__(self, *args):
            pass

        async def acquire(self):
            return "unavailable"

        async def release(self):
            return True

    runner = AsyncMock()
    scheduler._job_guards.clear()
    monkeypatch.setattr(settings, "scheduler_lock_mode", "best_effort")
    monkeypatch.setattr(scheduler, "DistributedJobLock", UnavailableLock)
    await scheduler._run_guarded_job("best_effort_job", runner, 10)
    runner.assert_awaited_once()
