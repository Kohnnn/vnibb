import logging
import secrets
from dataclasses import dataclass

from redis.exceptions import RedisError

from vnibb.core.cache import redis_client
from vnibb.core.config import settings

logger = logging.getLogger(__name__)

_RELEASE_SCRIPT = """
local token = redis.call('get', KEYS[1])
if not token or token ~= ARGV[1] then
    return 0
end
redis.call('del', KEYS[1])
return 1
"""
_RENEW_SCRIPT = """
local token = redis.call('get', KEYS[1])
if not token or token ~= ARGV[1] then
    return 0
end
redis.call('expire', KEYS[1], ARGV[2])
return 1
"""

_status = {"enabled": settings.scheduler_lock_enabled, "state": "not_used", "detail": None}


@dataclass
class DistributedJobLock:
    job_name: str
    timeout_seconds: int
    token: str | None = None

    @property
    def key(self) -> str:
        return f"{settings.scheduler_lock_key_prefix}:{self.job_name}"

    @property
    def ttl_seconds(self) -> int:
        return max(1, self.timeout_seconds + settings.scheduler_lock_ttl_margin_seconds)

    async def acquire(self) -> str:
        if not settings.scheduler_lock_enabled:
            _set_status("disabled", None)
            return "acquired"
        self.token = secrets.token_urlsafe(32)
        try:
            await redis_client.connect()
            acquired = await redis_client.client.set(
                self.key,
                self.token,
                nx=True,
                ex=self.ttl_seconds,
            )
        except (RedisError, RuntimeError) as exc:
            _set_status("unavailable", type(exc).__name__)
            logger.error("Scheduler lock unavailable for %s: %s", self.job_name, exc)
            return "unavailable"
        if acquired:
            _set_status("acquired", self.job_name)
            return "acquired"
        _set_status("contended", self.job_name)
        return "contended"

    async def renew(self) -> bool:
        if not self.token or not settings.scheduler_lock_enabled:
            return True
        try:
            renewed = await redis_client.client.eval(
                _RENEW_SCRIPT,
                1,
                self.key,
                self.token,
                self.ttl_seconds,
            )
        except (RedisError, RuntimeError) as exc:
            _set_status("renew_unavailable", type(exc).__name__)
            logger.error("Scheduler lock renewal failed for %s: %s", self.job_name, exc)
            return False
        if not renewed:
            _set_status("ownership_lost", self.job_name)
            logger.warning("Scheduler lock ownership lost before renewal for %s", self.job_name)
            return False
        _set_status("renewed", self.job_name)
        return True

    async def release(self) -> bool:
        if not self.token or not settings.scheduler_lock_enabled:
            return True
        try:
            released = await redis_client.client.eval(_RELEASE_SCRIPT, 1, self.key, self.token)
        except (RedisError, RuntimeError) as exc:
            _set_status("release_unavailable", type(exc).__name__)
            logger.error("Scheduler lock release failed for %s: %s", self.job_name, exc)
            return False
        if not released:
            _set_status("ownership_lost", self.job_name)
            logger.warning("Scheduler lock ownership lost before release for %s", self.job_name)
            return False
        self.token = None
        _set_status("released", self.job_name)
        return True


def get_scheduler_lock_status() -> dict[str, object]:
    return _status.copy()


def _set_status(state: str, detail: str | None) -> None:
    _status["state"] = state
    _status["detail"] = detail
