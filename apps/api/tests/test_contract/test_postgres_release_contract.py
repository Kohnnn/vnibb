import asyncio
import os
from datetime import date, datetime
from uuid import uuid4

import pytest
from sqlalchemy import inspect, select
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
