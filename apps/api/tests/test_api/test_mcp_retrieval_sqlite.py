"""#255/#262 retrieval selection against persisted SQLite rows.

The default test environment is SQLite-in-memory; this file still creates its
own engine so persisted rows, not a read stub, drive the handlers.
"""

import pytest
import pytest_asyncio
from mcp_retrieval_cases import (
    check_price_selection,
    check_timeline_selection,
    seed_rows,
)
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool
from vnibb.core.database import Base
from vnibb.mcp import server

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def seed(monkeypatch):
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(server, "async_session_maker", session_factory)

    async def available():
        return True

    monkeypatch.setattr(server, "check_database_connection", available)

    async def seed_collection(collection: str, rows: list[dict]) -> None:
        async with session_factory() as db:
            await seed_rows(db, collection, rows)

    try:
        yield seed_collection
    finally:
        await engine.dispose()


async def test_recent_price_selection_is_latest_retained(seed):
    await check_price_selection(seed)


async def test_corporate_timeline_uses_effective_date_before_cap(seed):
    await check_timeline_selection(seed)
