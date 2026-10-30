"""
VNStock API key registration guard.

Serializes concurrent credential setup with a Redis lock and DB fallback.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Optional
from uuid import uuid4

from sqlalchemy.exc import SQLAlchemyError

from vnibb.core.cache import build_cache_key, redis_client
from vnibb.core.config import settings
from vnibb.core.database import async_session_maker
from vnibb.models.app_kv import AppKeyValue

logger = logging.getLogger(__name__)

LOCK_TTL_SECONDS = 60

_local_lock = asyncio.Lock()
_local_registered: set[str] = set()



@dataclass
class RegistrationResult:
    registered: bool
    reason: str
    source: Optional[str] = None
    retryable: bool = False


def _fingerprint(api_key: str) -> str:
    return hashlib.sha256(api_key.encode("utf-8")).hexdigest()[:12]



def _lock_key(fingerprint: str) -> str:
    return build_cache_key("vnibb", "vnstock", "registration_lock", fingerprint)


_registration_tasks: dict[str, asyncio.Task[RegistrationResult]] = {}


async def ensure_vnstock_registration() -> RegistrationResult:
    api_key = settings.vnstock_api_key
    if not api_key:
        return RegistrationResult(False, "no_api_key")

    fingerprint = _fingerprint(f"{settings.vnstock_runtime_tier}:{api_key}")
    if fingerprint in _local_registered:
        return RegistrationResult(True, "cached_local")

    async with _local_lock:
        if fingerprint in _local_registered:
            return RegistrationResult(True, "cached_local")
        task = _registration_tasks.get(fingerprint)
        if task is None:
            task = asyncio.create_task(_register_with_lock(api_key, fingerprint))
            _registration_tasks[fingerprint] = task
            task.add_done_callback(lambda done: _registration_finished(fingerprint, done))
    return await asyncio.shield(task)


def _registration_finished(fingerprint: str, task: asyncio.Task[RegistrationResult]) -> None:
    if _registration_tasks.get(fingerprint) is task:
        _registration_tasks.pop(fingerprint)
    if not task.cancelled():
        task.exception()

async def _register_with_lock(api_key: str, fingerprint: str) -> RegistrationResult:
    lock_key = _lock_key(_fingerprint(api_key))
    lock = await _acquire_lock(lock_key)
    if not lock.acquired:
        return RegistrationResult(False, "lock_busy", lock.source, retryable=True)

    try:
        registered = await asyncio.to_thread(_register_api_key, api_key)
        if not registered:
            return RegistrationResult(False, "registration_failed", lock.source)
        _local_registered.add(fingerprint)
        return RegistrationResult(True, "registered", lock.source)
    except Exception:
        logger.warning("VNStock API key registration failed")
        return RegistrationResult(False, "exception", lock.source, retryable=True)
    finally:
        await _release_lock(lock_key, lock)


def _register_api_key(api_key: str) -> bool:
    try:

        from vnibb.providers.vnstock.runtime import import_vnstock_symbol, validate_source

        validate_source(settings.vnstock_source)
        setup_api_key, _ = import_vnstock_symbol("setup_api_key")
        status = setup_api_key(api_key)
        if not isinstance(status, dict) or status.get("authenticated") is not True:
            return False
        if settings.vnstock_runtime_tier == "golden":
            return status.get("tier") in {"golden", "diamond"}
        return status.get("tier") == "free"
    except BaseException:
        logger.warning("VNStock API key authentication failed")
        return False


@dataclass
class _LockState:
    acquired: bool
    source: Optional[str]
    token: Optional[str] = None


async def _acquire_lock(lock_key: str) -> _LockState:
    redis = await _get_redis_client()
    if redis:
        token = uuid4().hex
        try:
            acquired = await redis.set(lock_key, token, nx=True, ex=LOCK_TTL_SECONDS)
            if acquired:
                return _LockState(True, "redis", token)
            return _LockState(False, "redis")
        except Exception:
            logger.warning("Redis lock failed for vnstock registration")

    acquired = await _acquire_db_lock(lock_key)
    return _LockState(acquired, "db" if acquired else None)


async def _release_lock(lock_key: str, lock: _LockState) -> None:
    if not lock.acquired:
        return
    if lock.source == "redis":
        await _release_redis_lock(lock_key, lock.token)
        return
    if lock.source == "db":
        await _release_db_lock(lock_key)


async def _release_redis_lock(lock_key: str, token: Optional[str]) -> None:
    redis = await _get_redis_client()
    if not redis or not token:
        return
    try:
        current = await redis.get(lock_key)
        if current == token:
            await redis.delete(lock_key)
    except Exception:
        return


async def _get_redis_client():
    if not settings.redis_url:
        return None
    try:
        await redis_client.connect()
        await redis_client.client.ping()
        return redis_client.client
    except Exception:
        return None



async def _acquire_db_lock(lock_key: str) -> bool:
    try:
        async with async_session_maker() as session:
            record = await session.get(AppKeyValue, lock_key)
            now = datetime.utcnow()
            if record and _lock_active(record.value):
                return False
            payload = {
                "locked_at": now.isoformat(),
                "ttl_seconds": LOCK_TTL_SECONDS,
            }
            if record:
                record.value = payload
                record.updated_at = now
            else:
                session.add(AppKeyValue(key=lock_key, value=payload, updated_at=now))
            await session.commit()
            return True
    except SQLAlchemyError:
        logger.warning("DB lock failed for vnstock registration")
        return False


async def _release_db_lock(lock_key: str) -> None:
    try:
        async with async_session_maker() as session:
            record = await session.get(AppKeyValue, lock_key)
            if record:
                await session.delete(record)
                await session.commit()
    except SQLAlchemyError:
        return


def _lock_active(payload: Optional[dict[str, Any]]) -> bool:
    if not payload:
        return False
    locked_at = payload.get("locked_at")
    if not locked_at:
        return False
    try:
        locked_dt = datetime.fromisoformat(locked_at)
    except ValueError:
        return False
    return datetime.utcnow() - locked_dt < timedelta(seconds=LOCK_TTL_SECONDS)
