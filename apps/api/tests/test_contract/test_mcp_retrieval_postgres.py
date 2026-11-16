"""#255/#262 retrieval selection against a real disposable PostgreSQL schema.

This exercises stored rows and the real handler SQL on PostgreSQL, so the
COALESCE effective-date ordering and NULLS LAST placement are proven by the
server rather than by SQLite's own NULL collation.
"""

import os
from uuid import uuid4

import pytest
import pytest_asyncio
from mcp_retrieval_cases import check_price_selection, check_timeline_selection, seed_rows
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
from vnibb.core.database import Base
from vnibb.mcp import server

pytestmark = [
    pytest.mark.postgres_contract,
    pytest.mark.asyncio,
    pytest.mark.skipif(
        os.environ.get("POSTGRES_CONTRACT") != "1",
        reason="requires disposable PostgreSQL contract database",
    ),
]


@pytest_asyncio.fixture
async def seed(test_engine, monkeypatch):
    schema = f"mcp_retrieval_{uuid4().hex}"
    async with test_engine.begin() as connection:
        await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_async_engine(
        test_engine.url,
        poolclass=NullPool,
        connect_args={"server_settings": {"search_path": schema}},
    )
    try:
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

        yield seed_collection
    finally:
        await engine.dispose()
        async with test_engine.begin() as connection:
            await connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))


async def test_recent_price_selection_is_latest_retained(seed):
    await check_price_selection(seed)


async def test_corporate_timeline_uses_effective_date_before_cap(seed):
    await check_timeline_selection(seed)
