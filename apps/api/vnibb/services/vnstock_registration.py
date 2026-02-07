"""
VNStock API key registration guard.

Prevents repeated device registration across workers by using a
cross-process lock (Redis) with DB fallback.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
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

REGISTRATION_TTL_SECONDS = 60 * 60 * 24 * 30
LOCK_TTL_SECONDS = 60

_local_lock = asyncio.Lock()
_local_registered: set[str] = set()


@dataclass
class RegistrationResult:
    registered: bool
    reason: str
    source: Optional[str] = None


def _fingerprint(api_key: str) -> str:
    return hashlib.sha256(api_key.encode("utf-8")).hexdigest()[:12]


def _registration_key(fingerprint: str) -> str:
    return build_cache_key("vnibb", "vnstock", "registration", fingerprint)


def _lock_key(fingerprint: str) -> str:
    return build_cache_key("vnibb", "vnstock", "registration_lock", fingerprint)


async def ensure_vnstock_registration() -> RegistrationResult:
    api_key = settings.vnstock_api_key
    if not api_key:
        return RegistrationResult(False, "no_api_key")

    fingerprint = _fingerprint(api_key)
    if fingerprint in _local_registered:
        return RegistrationResult(True, "cached_local")

    async with _local_lock:
        if fingerprint in _local_registered:
            return RegistrationResult(True, "cached_local")

        registration_key = _registration_key(fingerprint)
        existing = await _read_registration_state(registration_key)
        if existing:
            _local_registered.add(fingerprint)
            return RegistrationResult(True, "cached_persistent", existing.get("source"))

        lock_key = _lock_key(fingerprint)
        lock = await _acquire_lock(lock_key)
        if not lock.acquired:
            return RegistrationResult(False, "lock_busy", lock.source)

        try:
            os.environ["VNSTOCK_API_KEY"] = api_key
            registered = await asyncio.to_thread(_register_api_key, api_key)
            if not registered:
                return RegistrationResult(False, "registration_failed", lock.source)

            payload = {
                "status": "registered",
                "registered_at": datetime.utcnow().isoformat(),
                "api_key_fingerprint": fingerprint,
                "source": lock.source,
            }
            await _write_registration_state(registration_key, payload)
            _local_registered.add(fingerprint)
            return RegistrationResult(True, "registered", lock.source)
        except Exception as exc:
            logger.warning(f"VNStock API key registration failed: {exc}")
            return RegistrationResult(False, "exception", lock.source)
        finally:
            await _release_lock(lock_key, lock)


def _register_api_key(api_key: str) -> bool:
    from vnstock import change_api_key

    return bool(change_api_key(api_key))


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
        except Exception as exc:
            logger.warning(f"Redis lock failed for vnstock registration: {exc}")

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


async def _read_registration_state(key: str) -> Optional[dict[str, Any]]:
    redis = await _get_redis_client()
    if redis:
        try:
            raw = await redis.get(key)
            if raw:
                return json.loads(raw)
        except Exception:
            pass
    return await _read_db_state(key)


async def _write_registration_state(key: str, payload: dict[str, Any]) -> None:
    redis = await _get_redis_client()
    if redis:
        try:
            await redis.set(key, json.dumps(payload), ex=REGISTRATION_TTL_SECONDS)
        except Exception:
            pass
    await _write_db_state(key, payload)


async def _read_db_state(key: str) -> Optional[dict[str, Any]]:
    try:
        async with async_session_maker() as session:
            record = await session.get(AppKeyValue, key)
            if record:
                return record.value or None
    except SQLAlchemyError as exc:
        logger.warning(f"DB lookup failed for vnstock registration: {exc}")
    return None


async def _write_db_state(key: str, payload: dict[str, Any]) -> None:
    try:
        async with async_session_maker() as session:
            record = await session.get(AppKeyValue, key)
            now = datetime.utcnow()
            if record:
                record.value = payload
                record.updated_at = now
            else:
                session.add(AppKeyValue(key=key, value=payload, updated_at=now))
            await session.commit()
    except SQLAlchemyError as exc:
        logger.warning(f"DB write failed for vnstock registration: {exc}")


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
    except SQLAlchemyError as exc:
        logger.warning(f"DB lock failed for vnstock registration: {exc}")
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
