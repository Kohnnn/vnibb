import asyncio
import os
from datetime import date, datetime
from uuid import uuid4

import pytest
from sqlalchemy import inspect, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker

from vnibb.models.company import Company
from vnibb.models.stock import Stock
from vnibb.services.cache_manager import CacheManager
from vnibb.services.data_quality import complete_quality_run

pytestmark = pytest.mark.skipif(
    os.environ.get("POSTGRES_CONTRACT") != "1",
    reason="requires the PostgreSQL release-contract database",
)


@pytest.mark.postgres_contract
@pytest.mark.asyncio
async def test_companies_schema_supports_generated_ids_and_symbol_upserts(test_db):
    assert test_db.bind.dialect.name == "postgresql"
    id_generation = (await test_db.execute(text(
        "SELECT a.attidentity, pg_get_expr(d.adbin, d.adrelid) AS default_expression "
        "FROM pg_attribute a LEFT JOIN pg_attrdef d "
        "ON d.adrelid=a.attrelid AND d.adnum=a.attnum "
        "WHERE a.attrelid='companies'::regclass AND a.attname='id'"
    ))).one()
    assert id_generation.attidentity or id_generation.default_expression
    assert (await test_db.execute(text(
        "SELECT EXISTS (SELECT 1 FROM pg_index i JOIN pg_attribute a "
        "ON a.attrelid=i.indrelid AND a.attnum=i.indkey[0] "
        "WHERE i.indrelid='companies'::regclass AND a.attname='symbol' "
        "AND i.indisunique AND i.indisvalid AND i.indisready AND i.indimmediate "
        "AND i.indnkeyatts=1 AND i.indpred IS NULL AND i.indexprs IS NULL)"
    ))).scalar_one(), "companies requires an immediate unique symbol index for ON CONFLICT"


@pytest.mark.postgres_contract
@pytest.mark.asyncio
async def test_concurrent_first_cache_writes_are_atomic_and_persisted(test_db):
    symbol = f"C{uuid4().hex[:8]}".upper()
    session_factory = async_sessionmaker(test_db.bind, expire_on_commit=False)

    async def write_listing():
        async with session_factory() as session:
            return await CacheManager(session).store_listing_data(
                [{"symbol": symbol, "company_name": "Listing Company"}]
            )

    async def write_profile():
        async with session_factory() as session:
            return await CacheManager(session).store_profile_data(
                symbol, {"company_name": "Profile Company", "website": "https://example.test"}
            )

    try:
        assert await asyncio.gather(write_listing(), write_listing()) == [1, 1]
        assert await asyncio.gather(write_profile(), write_profile()) == [True, True]
        assert (await test_db.execute(select(Stock.symbol).where(Stock.symbol == symbol))).scalar_one() == symbol
        assert (await test_db.execute(select(Company.symbol).where(Company.symbol == symbol))).scalar_one() == symbol
    finally:
        await test_db.execute(Stock.__table__.delete().where(Stock.symbol == symbol))
        await test_db.execute(Company.__table__.delete().where(Company.symbol == symbol))
        await test_db.commit()


@pytest.mark.postgres_contract
@pytest.mark.asyncio
async def test_postgres_release_contract_uses_migrated_tables_and_api_routes(client, admin_client, test_db):
    assert test_db.bind is not None
    assert test_db.bind.dialect.name == "postgresql"

    table_names = await test_db.run_sync(lambda session: inspect(session.bind).get_table_names())

    assert {"stocks", "sync_status", "data_quality_runs", "data_quality_breach_states"} <= set(table_names)

    screener_columns = await test_db.run_sync(
        lambda session: {
            column["name"]
            for column in inspect(session.bind).get_columns("screener_snapshots")
        }
    )
    assert "trade_date" in screener_columns

    await complete_quality_run(
        test_db,
        run_id="postgres-contract:2026-07-16",
        status="ok",
        completed_at=datetime(2026, 7, 16, 10, 0),
        observed_market_date=date(2026, 7, 16),
        latest_market_date=date(2026, 7, 16),
        market_day_staleness_value=0,
        summary_counts={"warning_count": 0},
        error_category=None,
    )

    ready = await client.get("/ready")
    detailed = await client.get("/health/detailed")
    data_health = await admin_client.get("/api/v1/admin/data-health")

    assert ready.status_code == 200
    assert ready.json()["ready"] is True
    assert detailed.status_code == 200
    assert detailed.json()["components"]["database"]["status"] == "healthy"
    assert data_health.status_code == 200
    assert data_health.json()["data_quality"]["last_successful_run"]["run_id"] == "postgres-contract:2026-07-16"


@pytest.mark.postgres_contract
@pytest.mark.asyncio
async def test_session_timeouts_survive_rollback_commit_and_pool_reuse():
    from vnibb.core import database
    from vnibb.core.config import settings

    expected = {
        "statement_timeout": settings.db_statement_timeout_ms,
        "lock_timeout": settings.db_lock_timeout_ms,
        "idle_in_transaction_session_timeout": settings.db_idle_in_tx_timeout_ms,
    }
    assert all(value > 0 for value in expected.values()), "Contract requires nonzero timeouts"
    timeout_query = text(
        "SELECT name, setting::integer FROM pg_settings WHERE name IN "
        "('statement_timeout', 'lock_timeout', 'idle_in_transaction_session_timeout')"
    )
    pid_query = text("SELECT pg_backend_pid()")

    await database.engine.dispose()
    database.sync_engine.dispose()
    try:
        async with database.async_session_factory() as session:
            async_pid = (await session.execute(pid_query)).scalar_one()
            assert dict((await session.execute(timeout_query)).all()) == expected
            await session.rollback()
            assert dict((await session.execute(timeout_query)).all()) == expected
            await session.commit()
            assert dict((await session.execute(timeout_query)).all()) == expected
        async with database.async_session_factory() as session:
            assert (await session.execute(pid_query)).scalar_one() == async_pid
            assert dict((await session.execute(timeout_query)).all()) == expected

        with database.sync_session_factory() as session:
            sync_pid = session.execute(pid_query).scalar_one()
            assert dict(session.execute(timeout_query).all()) == expected
            session.rollback()
            assert dict(session.execute(timeout_query).all()) == expected
            session.commit()
            assert dict(session.execute(timeout_query).all()) == expected
        with database.sync_session_factory() as session:
            assert session.execute(pid_query).scalar_one() == sync_pid
            assert dict(session.execute(timeout_query).all()) == expected
    finally:
        await database.engine.dispose()
        database.sync_engine.dispose()
