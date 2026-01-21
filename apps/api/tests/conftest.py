"""
FastAPI Testing Fixtures.
Provides async engine, session and test client for API integration tests.
Uses SQLite in-memory for testing.
"""
import os
import asyncio
from typing import AsyncGenerator

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

import sys
from unittest.mock import MagicMock

# Mock vnstock before any imports
mock_vnstock = MagicMock()
sys.modules["vnstock"] = mock_vnstock
sys.modules["vnstock_pipeline"] = MagicMock()
sys.modules["vnstock_data"] = MagicMock()
sys.modules["vnstock_ta"] = MagicMock()
sys.modules["vnstock_news"] = MagicMock()

# Set environment variables for testing BEFORE importing anything
os.environ["ENVIRONMENT"] = "test"
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"
os.environ["REDIS_URL"] = ""
os.environ["REDIS_HOST"] = ""
os.environ["REDIS_PORT"] = "0"
os.environ["SENTRY_DSN"] = ""
os.environ["VNSTOCK_API_KEY"] = "mock_key"
os.environ["GEMINI_API_KEY"] = "mock_key"
os.environ["OPENAI_API_KEY"] = "mock_key"

from vnibb.api.main import app
from vnibb.core.database import Base, get_db
from vnibb.models import *  # Ensure all models are loaded for metadata

# Use SQLite in-memory for fast testing
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

@pytest.fixture(scope="session")
def event_loop():
    """Create an instance of the default event loop for each test case."""
    policy = asyncio.get_event_loop_policy()
    loop = policy.new_event_loop()
    yield loop
    loop.close()

@pytest.fixture(scope="session")
async def test_engine():
    """Create a persistent test database engine."""
    engine = create_async_engine(
        TEST_DATABASE_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        echo=False,
    )
    yield engine
    await engine.dispose()

@pytest.fixture(autouse=True)
async def setup_tables(test_engine):
    """Create tables for each test and drop them after."""
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

@pytest.fixture
async def test_db(test_engine) -> AsyncGenerator[AsyncSession, None]:
    """Create a new database session for a test."""
    async_session = async_sessionmaker(
        test_engine, class_=AsyncSession, expire_on_commit=False
    )
    
    async with async_session() as session:
        yield session
        # No rollback needed since tables are dropped

@pytest.fixture
async def client(test_db) -> AsyncGenerator[AsyncClient, None]:
    """FastAPI test client with dependency overrides."""
    
    # Override get_db to use our test session
    async def override_get_db():
        yield test_db
    
    app.dependency_overrides[get_db] = override_get_db
    
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    
    # Clean up overrides
    app.dependency_overrides.clear()

