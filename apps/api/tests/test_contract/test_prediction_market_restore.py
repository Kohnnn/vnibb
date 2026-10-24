"""Catalogue restore contracts against an isolated PostgreSQL schema."""

import asyncio
import hashlib
import json
import os
from datetime import datetime
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
from vnibb.models.prediction_market import PredictionMarket
from vnibb.models.prediction_market_archive import PredictionMarketArchive
from vnibb.services import prediction_market_retention as retention
from vnibb.services import prediction_market_service as service

pytestmark = [
    pytest.mark.postgres_contract,
    pytest.mark.asyncio,
    pytest.mark.skipif(
        os.environ.get("POSTGRES_CONTRACT") != "1",
        reason="requires a disposable PostgreSQL contract database",
    ),
]


@pytest.fixture
async def restore_store(test_engine, monkeypatch):
    schema = f"prediction_restore_{uuid4().hex}"
    async with test_engine.begin() as connection:
        await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_async_engine(
        test_engine.url,
        connect_args={"server_settings": {"search_path": schema}},
        poolclass=NullPool,
    )
    try:
        async with engine.begin() as connection:
            await connection.run_sync(PredictionMarket.__table__.create)
            await connection.run_sync(PredictionMarketArchive.__table__.create)
        factory = async_sessionmaker(engine, expire_on_commit=False)
        monkeypatch.setattr(retention, "async_session_maker", factory)
        yield factory
    finally:
        await engine.dispose()
        async with test_engine.begin() as connection:
            await connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))


def checksum(payload):
    data = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    return hashlib.sha256(data).hexdigest()


async def archive_document(factory, tmp_path, count, start_id=1000):
    entries = []
    for index in range(count):
        payload = {
            "id": start_id + index,
            "source": "kalshi",
            "source_id": f"KXHISTORY-{index}",
            "question": f"Historical policy decision {index}?",
            "slug": f"historical-policy-{index}",
            "description": "Provider resolution and original contract text",
            "category": "economic",
            "url": f"https://example.test/markets/{index}",
            "end_date": "2020-01-02T12:00:00+00:00",
            "active": False,
            "closed": True,
            "volume": 12345.5,
            "liquidity": 678.25,
            "outcomes": ["Yes", "No"],
            "outcome_prices": [1.0, 0.0],
            "extra": {"resolution": {"status": "resolved", "source": "provider", "outcome": "Yes"},
                      "provider_history": ["listed", "closed", "resolved"]},
            "is_synthetic": False,
            "created_at": "2019-01-01T10:00:00",
            "updated_at": "2020-01-03T09:30:00",
        }
        entries.append({"payload": payload, "sha256": checksum(payload)})
    batch_id = str(uuid4())
    async with factory() as session:
        database = (await session.execute(text("SELECT current_database()"))).scalar_one()
        session.add_all(PredictionMarketArchive(
            market_id=entry["payload"]["id"], batch_id=batch_id,
            payload=entry["payload"], sha256=entry["sha256"],
            archived_at=datetime(2026, 1, 1), backup_sha256="b" * 64,
        ) for entry in entries)
        await session.commit()
    document = {"batch_id": batch_id, "database": database, "backup_sha256": "b" * 64,
                "count": count, "entries": entries, "sha256": checksum(entries)}
    path = tmp_path / f"{batch_id}.json"
    path.write_text(json.dumps(document))
    return path, document


async def stored_rows(factory, model):
    async with factory() as session:
        rows = (await session.execute(select(model).order_by(*model.__table__.primary_key))).scalars().all()
        return [
            {column.name: value.isoformat() if isinstance(value, datetime) else value
             for column in model.__table__.columns
             for value in [getattr(row, column.name)]}
            for row in rows
        ]


async def stored_state(factory):
    return (await stored_rows(factory, PredictionMarket),
            await stored_rows(factory, PredictionMarketArchive))


async def seed_live(factory, **changes):
    values = {
        "source": "kalshi", "source_id": "KXLIVE", "question": "Current policy decision?",
        "active": True, "closed": False, "end_date": datetime(2099, 1, 1),
        "outcomes": ["Yes", "No"], "outcome_prices": [0.6, 0.4],
        "updated_at": datetime.utcnow(),
    }
    values.update(changes)
    async with factory() as session:
        session.add(PredictionMarket(**values))
        await session.commit()


async def test_restore_exact_capacity_preserves_full_terminal_history_without_live_slots(
    restore_store, tmp_path, monkeypatch
):
    path, document = await archive_document(restore_store, tmp_path, retention.MAX_BATCH)
    await seed_live(restore_store)
    _, unrelated = await archive_document(restore_store, tmp_path, 1, start_id=9999)
    monkeypatch.setattr(service, "MAX_SOURCE_MARKETS", 1)
    monkeypatch.setattr(service, "_catalogue_storage_bytes", AsyncMock(
        return_value=service.MAX_CATALOGUE_RELATION_BYTES - retention.MAX_BATCH * 256 * 1024
    ))

    assert await retention.restore(path) == {"restored": retention.MAX_BATCH, "batch_id": document["batch_id"]}

    catalogue, archived = await stored_state(restore_store)
    assert [row for row in catalogue if row["id"] >= 1000] == [entry["payload"] for entry in document["entries"]]
    assert len(catalogue) == retention.MAX_BATCH + 1
    assert [(row["market_id"], row["batch_id"]) for row in archived] == [(9999, unrelated["batch_id"])]


async def test_restore_over_capacity_preserves_catalogue_and_archive(restore_store, tmp_path, monkeypatch):
    path, _ = await archive_document(restore_store, tmp_path, 2)
    await seed_live(restore_store)
    before = await stored_state(restore_store)
    monkeypatch.setattr(service, "_catalogue_storage_bytes", AsyncMock(
        return_value=service.MAX_CATALOGUE_RELATION_BYTES - 2 * 256 * 1024 + 1
    ))

    with pytest.raises(service.PredictionMarketAdmissionError, match="storage ceiling"):
        await retention.restore(path)

    assert await stored_state(restore_store) == before


@pytest.mark.parametrize("count", [0, retention.MAX_BATCH + 1])
async def test_restore_rejects_out_of_bounds_manifest_without_mutation(restore_store, tmp_path, count):
    path, _ = await archive_document(restore_store, tmp_path, count)
    await seed_live(restore_store)
    before = await stored_state(restore_store)

    with pytest.raises(ValueError, match="between 1 and"):
        await retention.restore(path)

    assert await stored_state(restore_store) == before


async def test_restore_conflict_rolls_back_every_insert_and_archive_deletion(restore_store, tmp_path, monkeypatch):
    path, document = await archive_document(restore_store, tmp_path, 2)
    collision = document["entries"][1]["payload"]
    await seed_live(restore_store, source_id=collision["source_id"], question="Re-ingested row stays intact")
    before = await stored_state(restore_store)
    monkeypatch.setattr(service, "_catalogue_storage_bytes", AsyncMock(return_value=0))

    with pytest.raises(IntegrityError):
        await retention.restore(path)

    assert await stored_state(restore_store) == before


async def test_concurrent_ingest_and_restore_share_the_last_catalogue_capacity(
    restore_store, tmp_path, monkeypatch
):
    path, _ = await archive_document(restore_store, tmp_path, 1)

    async def remaining_capacity(session, dialect_name):
        count = len((await session.execute(select(PredictionMarket.id))).scalars().all())
        return service.MAX_CATALOGUE_RELATION_BYTES - 256 * 1024 + count * 256 * 1024

    monkeypatch.setattr(service, "_catalogue_storage_bytes", remaining_capacity)

    async def ingest():
        async with restore_store() as session:
            return await service.persist_prediction_markets(session, [{
                "source": "kalshi", "source_id": "KXLIVE", "question": "Current policy decision?",
                "active": True, "closed": False, "end_date": datetime(2099, 1, 1),
                "outcomes": ["Yes", "No"], "outcome_prices": [0.6, 0.4],
                "updated_at": datetime.utcnow(),
            }])

    results = await asyncio.gather(ingest(), retention.restore(path), return_exceptions=True)
    assert sum(isinstance(result, service.PredictionMarketAdmissionError) for result in results) == 1
    assert all(not isinstance(result, BaseException) or isinstance(result, service.PredictionMarketAdmissionError)
               for result in results)
    catalogue, archived = await stored_state(restore_store)
    assert len(catalogue) == 1
    assert len(archived) == (1 if catalogue[0]["source_id"] == "KXLIVE" else 0)
