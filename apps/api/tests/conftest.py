import asyncio
import ipaddress
import os
import sys
from collections.abc import AsyncGenerator
from unittest.mock import MagicMock
from urllib.parse import urlsplit

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

POSTGRES_CONTRACT = os.environ.get("POSTGRES_CONTRACT") == "1"


def postgres_contract_database_url(environ: dict[str, str] | None = None) -> str:
    value = (environ or os.environ).get("POSTGRES_CONTRACT_DATABASE_URL", "").strip()
    if not value:
        raise RuntimeError("POSTGRES_CONTRACT_DATABASE_URL is required when POSTGRES_CONTRACT=1")
    parsed = urlsplit(value)
    host = parsed.hostname
    if not host or not parsed.scheme.startswith("postgres"):
        raise RuntimeError("POSTGRES_CONTRACT_DATABASE_URL must be a PostgreSQL URL")
    if host.lower() != "localhost":
        try:
            if not ipaddress.ip_address(host).is_loopback:
                raise ValueError
        except ValueError as exc:
            raise RuntimeError("POSTGRES_CONTRACT_DATABASE_URL host must be loopback") from exc
    return value


mock_vnstock = MagicMock()
sys.modules["vnstock"] = mock_vnstock
sys.modules["vnstock_pipeline"] = MagicMock()
sys.modules["vnstock_data"] = MagicMock()
sys.modules["vnstock_ta"] = MagicMock()
sys.modules["vnstock_news"] = MagicMock()

os.environ["ENVIRONMENT"] = "test"
if POSTGRES_CONTRACT:
    os.environ["DATABASE_URL"] = postgres_contract_database_url()
else:
    os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"
os.environ["REDIS_URL"] = ""
os.environ["REDIS_HOST"] = ""
os.environ["REDIS_PORT"] = "0"
os.environ["SENTRY_DSN"] = ""
os.environ["VNSTOCK_API_KEY"] = "mock_key"
os.environ["OPENROUTER_API_KEY"] = "mock_openrouter_key"
os.environ["GEMINI_API_KEY"] = "mock_key"
os.environ["OPENAI_API_KEY"] = "mock_key"
os.environ["VNIBB_MCP_URL"] = ""
os.environ["ADMIN_API_KEY"] = "test-admin-key"
os.environ["DATA_BACKEND"] = "postgres"
os.environ["MONGODB_ENABLED"] = "false"
os.environ["APPWRITE_ENDPOINT"] = ""
os.environ["APPWRITE_PROJECT_ID"] = ""
os.environ["APPWRITE_API_KEY"] = ""
os.environ["APPWRITE_DATABASE_ID"] = ""
os.environ["APPWRITE_WRITE_ENABLED"] = "false"

from vnibb.api.main import app
from vnibb.core.database import Base, get_db
from vnibb.middleware.rate_limit import RateLimitMiddleware
from vnibb.models import *

TEST_DATABASE_URL = os.environ["DATABASE_URL"] if POSTGRES_CONTRACT else "sqlite+aiosqlite:///:memory:"


@pytest.fixture(scope="session")
def event_loop():
    policy = asyncio.get_event_loop_policy()
    loop = policy.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="session")
async def test_engine():
    engine_kwargs = {"echo": False}
    if not POSTGRES_CONTRACT:
        engine_kwargs.update(
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
    engine = create_async_engine(TEST_DATABASE_URL, **engine_kwargs)
    yield engine
    await engine.dispose()


@pytest.fixture(autouse=True)
def relax_rate_limit_buckets(monkeypatch, request):
    if request.node.path.name == "test_rate_limit.py":
        return

    original_resolve_bucket = RateLimitMiddleware._resolve_bucket

    def _resolve_bucket(self, path: str):
        bucket, _ = original_resolve_bucket(self, path)
        return bucket, 1000

    monkeypatch.setattr(RateLimitMiddleware, "_resolve_bucket", _resolve_bucket)


@pytest.fixture(autouse=True)
async def setup_tables(test_engine):
    if POSTGRES_CONTRACT:
        yield
        return
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest.fixture
async def test_db(test_engine) -> AsyncGenerator[AsyncSession, None]:
    async_session = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as session:
        yield session


@pytest.fixture
async def client(test_db) -> AsyncGenerator[AsyncClient, None]:
    async def override_get_db():
        yield test_db

    app.dependency_overrides[get_db] = override_get_db

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"X-Admin-Key": "test-admin-key"},
    ) as ac:
        yield ac

    app.dependency_overrides.clear()
