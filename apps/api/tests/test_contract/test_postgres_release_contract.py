import os
from datetime import date, datetime

import pytest
from sqlalchemy import inspect

from vnibb.services.data_quality import complete_quality_run

pytestmark = pytest.mark.skipif(
    os.environ.get("POSTGRES_CONTRACT") != "1",
    reason="requires the PostgreSQL release-contract database",
)


@pytest.mark.postgres_contract
@pytest.mark.asyncio
async def test_postgres_release_contract_uses_migrated_tables_and_api_routes(client, test_db):
    assert test_db.bind is not None
    assert test_db.bind.dialect.name == "postgresql"

    table_names = await test_db.run_sync(lambda session: inspect(session.bind).get_table_names())

    assert {"stocks", "sync_status", "data_quality_runs", "data_quality_breach_states"} <= set(table_names)

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
    data_health = await client.get("/api/v1/admin/data-health")

    assert ready.status_code == 200
    assert ready.json()["ready"] is True
    assert detailed.status_code == 200
    assert detailed.json()["components"]["database"]["status"] == "healthy"
    assert data_health.status_code == 200
    assert data_health.json()["data_quality"]["last_successful_run"]["run_id"] == "postgres-contract:2026-07-16"
