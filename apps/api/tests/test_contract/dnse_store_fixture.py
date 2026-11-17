import ipaddress
import os
from contextlib import asynccontextmanager
from types import SimpleNamespace
from urllib.parse import urlsplit
from uuid import uuid4

import pytest
from pymongo import MongoClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
from vnibb.core import cache as cache_module
from vnibb.core.cache import RedisClient
from vnibb.core.config import settings
from vnibb.core.database import Base
from vnibb.services import data_pipeline as pipeline_module
from vnibb.services.mongo_market_data_service import MongoMarketDataService


def _loopback(url):
    host = urlsplit(url).hostname
    try:
        return host == "localhost" or bool(host and ipaddress.ip_address(host).is_loopback)
    except ValueError:
        return False


@asynccontextmanager
async def stores_context(monkeypatch):
    pg_url = os.environ.get("POSTGRES_CONTRACT_DATABASE_URL")
    mongo_url = os.environ.get("MONGODB_CONTRACT_URL")
    redis_url = os.environ.get("REDIS_CONTRACT_URL")
    if os.environ.get("POSTGRES_CONTRACT") != "1" or not pg_url or not mongo_url:
        pytest.skip("Requires disposable POSTGRES_CONTRACT_DATABASE_URL and MONGODB_CONTRACT_URL")
    for url in (pg_url, mongo_url, redis_url):
        if url:
            assert _loopback(url), "Contract store must be loopback"

    schema = f"dnse_admission_{uuid4().hex}"
    admin = create_async_engine(pg_url, poolclass=NullPool)
    async with admin.begin() as connection:
        await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_async_engine(
        pg_url, poolclass=NullPool, connect_args={"server_settings": {"search_path": schema}},
    )
    client = MongoClient(mongo_url, serverSelectionTimeoutMS=5000)
    database = client[schema]
    service = MongoMarketDataService()
    monkeypatch.setattr(service, "_get_collection", lambda name: database[name])
    monkeypatch.setattr(settings, "mongodb_enabled", True)
    monkeypatch.setattr(settings, "mongodb_url", mongo_url)
    monkeypatch.setattr(pipeline_module, "engine", engine)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(pipeline_module, "async_session_maker", sessions)
    redis_prefix = f"{schema}:cache"
    cache_attempts = []

    def redis_key(key):
        return f"{redis_prefix}:{key}"

    class IsolatedRedisClient(RedisClient):
        async def set_json(self, key, value, ttl=None):
            cache_attempts.append(key)
            return await super().set_json(redis_key(key), value, ttl=ttl)

    redis = IsolatedRedisClient(url=redis_url) if redis_url else None
    if redis:
        monkeypatch.setattr(settings, "redis_url", redis_url)
        monkeypatch.setattr(cache_module, "_redis_cache_enabled", lambda: True)
        monkeypatch.setattr(pipeline_module, "redis_client", redis)
    else:
        monkeypatch.setattr(settings, "redis_url", "")
    try:
        if redis:
            await redis.connect()
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        yield SimpleNamespace(
            sessions=sessions, mongo=database, service=service, redis=redis,
            redis_prefix=redis_prefix, redis_key=redis_key, cache_attempts=cache_attempts,
        )
    finally:
        try:
            if redis:
                try:
                    async for key in redis.client.scan_iter(f"{redis_prefix}:*"):
                        await redis.client.delete(key)
                finally:
                    await redis.disconnect()
        finally:
            client.drop_database(schema)
            client.close()
            await engine.dispose()
            async with admin.begin() as connection:
                await connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
            await admin.dispose()


@pytest.fixture
async def stores(monkeypatch):
    async with stores_context(monkeypatch) as instance:
        yield instance
