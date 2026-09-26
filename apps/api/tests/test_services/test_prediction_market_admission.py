"""Storage admission and live prediction-market eligibility contracts."""

import asyncio
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from vnibb.models.prediction_market import PredictionMarket
from vnibb.services import prediction_market_service as service
from vnibb.services.prediction_market_policy import snapshot_eligibility


def market(source_id: str, **changes):
    row = {
        "source": "kalshi",
        "source_id": source_id,
        "question": "Will the policy rate rise?",
        "active": True,
        "closed": False,
        "end_date": datetime.now(UTC) + timedelta(days=1),
        "outcomes": ["Yes", "No"],
        "outcome_prices": [0.6, 0.4],
        "updated_at": datetime.utcnow(),
    }
    row.update(changes)
    return row


@pytest.mark.asyncio
async def test_source_cap_blocks_new_market_but_refreshes_existing(test_db, monkeypatch):
    monkeypatch.setattr(service, "MAX_SOURCE_MARKETS", 1)
    assert await service.persist_prediction_markets(test_db, [market("KXREAL-1")]) == 1
    with pytest.raises(service.PredictionMarketAdmissionError, match="blocked for 1 new markets.*refreshed 1"):
        await service.persist_prediction_markets(test_db, [
            market("KXREAL-1", question="Updated price and title"),
            market("KXREAL-2"),
        ])
    stored = (await test_db.execute(select(PredictionMarket))).scalars().all()
    assert [(row.source_id, row.question) for row in stored] == [("KXREAL-1", "Updated price and title")]

@pytest.mark.asyncio
async def test_legacy_multivariate_rows_do_not_consume_real_kalshi_slots(test_db, monkeypatch):
    monkeypatch.setattr(service, "MAX_SOURCE_MARKETS", 1)
    test_db.add(PredictionMarket(**market("KXMVECROSSCATEGORY-1")))
    test_db.add(PredictionMarket(**market("KXMVECROSSCATEGORY-2")))
    await test_db.commit()
    assert await service.persist_prediction_markets(test_db, [market("KXREAL-1")]) == 1
    assert (await test_db.execute(select(PredictionMarket.source_id).where(
        PredictionMarket.source_id == "KXREAL-1"
    ))).scalar_one() == "KXREAL-1"


@pytest.mark.asyncio
async def test_file_sqlite_concurrent_ingests_respect_source_cap(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "MAX_SOURCE_MARKETS", 1)
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'admission.db'}")
    try:
        async with engine.begin() as connection:
            await connection.run_sync(PredictionMarket.__table__.create)
        factory = async_sessionmaker(engine, expire_on_commit=False)

        async def admit(source_id: str):
            async with factory() as session:
                try:
                    return await service.persist_prediction_markets(session, [market(source_id)])
                except service.PredictionMarketAdmissionError:
                    return 0

        results = await asyncio.gather(admit("KXREAL-A"), admit("KXREAL-B"))
        async with factory() as session:
            admitted = (await session.execute(select(PredictionMarket.source_id))).scalars().all()
        assert results == [1, 0] or results == [0, 1]
        assert len(admitted) == 1
        assert admitted[0] in {"KXREAL-A", "KXREAL-B"}
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_expired_new_market_is_not_admitted_but_stale_feed_does_not_close_existing(test_db):
    assert await service.persist_prediction_markets(test_db, [market("KXREAL-1")]) == 1
    with pytest.raises(service.PredictionMarketAdmissionError, match="blocked for 1 new markets"):
        await service.persist_prediction_markets(test_db, [
            market("KXEXPIRED-1", end_date=datetime.now(UTC) - timedelta(minutes=1))
        ])
    stored = (await test_db.execute(select(PredictionMarket))).scalars().one()
    assert stored.source_id == "KXREAL-1"
    assert stored.active is True and stored.closed is False


@pytest.mark.asyncio
async def test_snapshot_policy_excludes_stale_expired_synthetic_closed_and_legacy_combos(test_db):
    now = datetime.now(UTC)
    cases = [
        ("KXREAL-1", {}, True),
        ("KXMVECROSSCATEGORY-1", {}, False),
        ("KXREAL-2", {"closed": True}, False),
        ("KXREAL-3", {"is_synthetic": True}, False),
        ("KXREAL-4", {"updated_at": now - timedelta(hours=25)}, False),
        ("KXREAL-5", {"end_date": now - timedelta(seconds=1)}, False),
    ]
    for source_id, changes, _ in cases:
        data = market(source_id, **changes)
        test_db.add(PredictionMarket(**data))
    await test_db.commit()
    eligible = (await test_db.execute(
        select(PredictionMarket.source_id).where(*snapshot_eligibility(now))
    )).scalars().all()
    assert eligible == ["KXREAL-1"]


@pytest.mark.asyncio
async def test_combo_market_cannot_bypass_provider_filter_via_shared_writer(test_db):
    with pytest.raises(service.PredictionMarketAdmissionError, match="combo"):
        await service.persist_prediction_markets(test_db, [market("KXMVECROSSCATEGORY-1")])
    assert (await test_db.execute(select(PredictionMarket.id))).scalars().all() == []


@pytest.mark.asyncio
async def test_oversized_market_update_is_rejected_without_mutating_existing(test_db):
    await service.persist_prediction_markets(test_db, [market("KXREAL-1")])
    with pytest.raises(service.PredictionMarketAdmissionError, match="field size limit"):
        await service.persist_prediction_markets(test_db, [market("KXREAL-1", description="x" * 10000)])
    stored = (await test_db.execute(select(PredictionMarket))).scalars().one()
    assert stored.description is None


@pytest.mark.asyncio
async def test_physical_ceiling_blocks_updates_and_new_rows_without_partial_mutation(test_db, monkeypatch):
    await service.persist_prediction_markets(test_db, [market("KXREAL-1")])
    monkeypatch.setattr(service, "MAX_CATALOGUE_RELATION_BYTES", 1)
    with pytest.raises(service.PredictionMarketAdmissionError, match="storage ceiling"):
        await service.persist_prediction_markets(test_db, [
            market("KXREAL-1", question="Should not overwrite"), market("KXREAL-2")
        ])
    stored = (await test_db.execute(select(PredictionMarket))).scalars().all()
    assert [(row.source_id, row.question) for row in stored] == [("KXREAL-1", "Will the policy rate rise?")]


@pytest.mark.asyncio
async def test_source_cap_is_per_source_and_does_not_count_legacy_kalshi_combos(test_db, monkeypatch):
    monkeypatch.setattr(service, "MAX_SOURCE_MARKETS", 1)
    test_db.add(PredictionMarket(**market("KXMVECROSSCATEGORY-1")))
    await test_db.commit()
    assert await service.persist_prediction_markets(test_db, [market("KXREAL-1")]) == 1
    assert await service.persist_prediction_markets(test_db, [market("POLY-1", source="polymarket")]) == 1
    with pytest.raises(service.PredictionMarketAdmissionError, match="blocked for 1 new markets.*refreshed 1"):
        await service.persist_prediction_markets(test_db, [
            market("KXREAL-2"), market("KXREAL-1", question="Live refresh")
        ])
    assert (await test_db.execute(select(PredictionMarket.question).where(
        PredictionMarket.source_id == "KXREAL-1"
    ))).scalar_one() == "Live refresh"


@pytest.mark.asyncio
async def test_batch_cap_rejects_every_row_before_existing_refresh(test_db):
    await service.persist_prediction_markets(test_db, [market("KXREAL-1")])
    batch = [market("KXREAL-1", question="Should not overwrite")]
    batch.extend(market(f"KXREAL-{n}") for n in range(2, 1002))
    with pytest.raises(service.PredictionMarketAdmissionError, match="batch exceeds limit"):
        await service.persist_prediction_markets(test_db, batch)
    assert (await test_db.execute(select(PredictionMarket.question))).scalar_one() == "Will the policy rate rise?"


@pytest.mark.asyncio
async def test_snapshot_eligibility_is_fresh_per_source_and_rejects_inactive(test_db):
    now = datetime.now(UTC)
    for source in ("polymarket", "kalshi", "predictit", "limitless", "manifold"):
        test_db.add(PredictionMarket(**market(f"{source}-fresh", source=source, updated_at=now)))
        test_db.add(PredictionMarket(**market(f"{source}-inactive", source=source, active=False)))
    await test_db.commit()
    eligible = (await test_db.execute(select(PredictionMarket.source_id).where(
        *snapshot_eligibility(now)
    ))).scalars().all()
    assert set(eligible) == {f"{source}-fresh" for source in (
        "polymarket", "kalshi", "predictit", "limitless", "manifold"
    )}


@pytest.mark.asyncio
async def test_storage_ceiling_rejects_existing_updates_without_mutation(test_db, monkeypatch):
    await service.persist_prediction_markets(test_db, [market("KXREAL-1")])
    class _PostgresBind:
        dialect = type("_Dialect", (), {"name": "postgresql"})()
    monkeypatch.setattr(test_db, "get_bind", lambda: _PostgresBind())
    real_execute = test_db.execute
    async def capped_execute(statement, *args, **kwargs):
        if "pg_advisory_xact_lock" in str(statement):
            return None
        if "pg_total_relation_size" in str(statement):
            class Size:
                def scalar_one(self):
                    return service.MAX_CATALOGUE_RELATION_BYTES
            return Size()
        return await real_execute(statement, *args, **kwargs)
    monkeypatch.setattr(test_db, "execute", capped_execute)
    with pytest.raises(service.PredictionMarketAdmissionError, match="no markets mutated"):
        await service.persist_prediction_markets(test_db, [market("KXREAL-1", question="Should not persist")])
    stored = (await real_execute(select(PredictionMarket))).scalars().one()
    assert stored.question == "Will the policy rate rise?"
