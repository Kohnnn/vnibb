import asyncio
import os
from copy import deepcopy
from uuid import uuid4

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
from vnibb.core.database import Base
from vnibb.models.app_kv import AppKeyValue
from vnibb.services import matrix_service as service
from vnibb.services.matrix_playbooks import PLAYBOOKS

pytestmark = [
    pytest.mark.postgres_contract,
    pytest.mark.asyncio,
    pytest.mark.skipif(
        os.environ.get("POSTGRES_CONTRACT") != "1",
        reason="requires disposable PostgreSQL contract database",
    ),
]

OWNER = "00000000-0000-4000-8000-000000000031"


@pytest_asyncio.fixture
async def matrix_engine(test_engine):
    schema = f"matrix_revoke_race_{uuid4().hex}"
    async with test_engine.begin() as connection:
        await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_async_engine(
        test_engine.url, poolclass=NullPool,
        connect_args={"server_settings": {"search_path": schema}},
    )
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        yield engine
    finally:
        await engine.dispose()
        async with test_engine.begin() as connection:
            await connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))


def snapshot_record():
    snapshot_id, revision = str(uuid4()), str(uuid4())
    dimension = deepcopy(PLAYBOOKS[0]["dimensions"][0])
    evidence_id = "FPT-revenue"
    cell = {
        "result_id": str(uuid4()), "result_revision": revision, "entity_id": "FPT",
        "dimension_id": dimension["dimension_id"], "state": "supported",
        "payload": {"kind": "number", "metrics": [{
            "key": "revenue", "label": "Revenue", "value": "123456789.125",
            "display": "123456789.125 VND", "unit": "VND", "period": "2025",
            "as_of": "2025-12-31", "basis": "consolidated", "evidence_ids": [evidence_id],
        }]},
        "evidence_ids": [evidence_id], "basis": "consolidated", "limitations": [],
        "review_state": "unreviewed",
    }
    evidence = {
        "evidence_id": evidence_id, "entity_id": "FPT",
        "source": "stored.sql.income_statements:matrix_seed", "locator": "income:FPT:2025",
        "field": "revenue", "value": "123456789.125", "unit": "VND", "period": "2025",
        "as_of": "2025-12-31", "captured_at": "2026-01-01T00:00:00Z",
        "provenance": "stored_observation", "formula": None, "input_evidence_ids": [],
        "limitations": [],
    }
    snapshot = {
        "schema_version": "matrix-v1", "matrix_id": str(uuid4()), "snapshot_id": snapshot_id,
        "revision": revision, "created_at": "2026-01-01T00:00:00Z", "synthetic": False,
        "anchor_symbol": "FPT", "playbook_id": "nonfinancial",
        "definition_revision": PLAYBOOKS[0]["definition_revision"], "period": "2025",
        "period_type": "year",
        "entities": [{"entity_id": "FPT", "symbol": "FPT", "name": "FPT", "sector": "Technology"}],
        "dimensions": [dimension], "cells": [cell], "limitations": [],
    }
    return {
        "owner_id": OWNER, "snapshot": snapshot, "evidence": [evidence],
    }


async def wait_until_blocked(engine, deadline_seconds: float = 15.0) -> None:
    """Block until a backend is genuinely waiting on another transaction's lock."""
    deadline = asyncio.get_running_loop().time() + deadline_seconds
    async with engine.connect() as observer:
        while asyncio.get_running_loop().time() < deadline:
            waiting = (await observer.execute(text(
                "SELECT count(*) FROM pg_stat_activity "
                "WHERE wait_event_type = 'Lock' AND state = 'active'"
            ))).scalar_one()
            if waiting:
                return
            await asyncio.sleep(0.05)
    raise AssertionError("The competing Matrix transaction never waited on the row lock")


@pytest.mark.asyncio
async def test_review_sees_a_revoke_committed_while_it_waited_for_the_lock(matrix_engine):
    record = snapshot_record()
    snapshot = record["snapshot"]
    result_id = snapshot["cells"][0]["result_id"]
    factory = async_sessionmaker(matrix_engine, expire_on_commit=False)
    async with factory() as setup:
        setup.add(AppKeyValue(key=f"matrix:snapshot:{snapshot['snapshot_id']}", value=record))
        await setup.commit()

    revoker, reviewer = factory(), factory()
    try:
        await revoker.begin()
        await revoker.execute(
            select(AppKeyValue)
            .where(AppKeyValue.key == f"matrix:snapshot:{snapshot['snapshot_id']}")
            .with_for_update()
        )
        review = asyncio.create_task(
            service.review_matrix_snapshot(
                reviewer, OWNER, snapshot["snapshot_id"],
                {"result_ids": [result_id], "state": "reviewed"},
            )
        )
        await wait_until_blocked(matrix_engine)
        revoker.add(AppKeyValue(key=f"matrix:revoked:{snapshot['snapshot_id']}", value={"owner_id": OWNER}))
        await revoker.commit()

        with pytest.raises(HTTPException) as error:
            await asyncio.wait_for(review, timeout=15)
        assert error.value.status_code == 404
        assert "Matrix reference not found" in error.value.detail
    finally:
        await reviewer.close()
        await revoker.close()

    async with factory() as check:
        events = (await check.execute(
            select(AppKeyValue).where(AppKeyValue.key.startswith(f"matrix:review:{snapshot['snapshot_id']}:"))
        )).scalars().all()
    assert events == []


@pytest.mark.asyncio
async def test_concurrent_duplicate_revoke_refuses_instead_of_duplicating_the_tombstone(matrix_engine):
    record = snapshot_record()
    snapshot = record["snapshot"]
    factory = async_sessionmaker(matrix_engine, expire_on_commit=False)
    async with factory() as setup:
        setup.add(AppKeyValue(key=f"matrix:snapshot:{snapshot['snapshot_id']}", value=record))
        await setup.commit()

    revoker, duplicate = factory(), factory()
    try:
        await revoker.begin()
        await revoker.execute(
            select(AppKeyValue)
            .where(AppKeyValue.key == f"matrix:snapshot:{snapshot['snapshot_id']}")
            .with_for_update()
        )
        second = asyncio.create_task(
            service.revoke_matrix_snapshot(duplicate, OWNER, snapshot["snapshot_id"])
        )
        await wait_until_blocked(matrix_engine)
        revoker.add(AppKeyValue(
            key=f"matrix:revoked:{snapshot['snapshot_id']}", value={"owner_id": OWNER},
        ))
        await revoker.commit()

        with pytest.raises(HTTPException) as error:
            await asyncio.wait_for(second, timeout=15)
        assert error.value.status_code == 404
        assert "Matrix reference not found" in error.value.detail
    finally:
        await duplicate.close()
        await revoker.close()

    async with factory() as check:
        tombstones = (await check.execute(
            select(AppKeyValue).where(AppKeyValue.key == f"matrix:revoked:{snapshot['snapshot_id']}")
        )).scalars().all()
    assert len(tombstones) == 1
