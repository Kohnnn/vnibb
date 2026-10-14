from datetime import UTC, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker
from vnibb.models.sync_status import SyncStatus
from vnibb.services import sync_all_data, vietcap_ingestion


@pytest.mark.asyncio
async def test_iq_reference_cycle_is_separate_full_universe_bounded_owner(monkeypatch):
    symbols = [f"S{index:04d}" for index in range(801)]
    captured = {}

    async def universe(self, max_symbols=None):
        assert max_symbols is None
        return symbols

    async def acquire(symbol, dataset, progress):
        captured[dataset] = symbol
        return 1

    async def cycle(self, sync_type, selected, stages, budget_seconds, refresh_days, **kwargs):
        assert sync_type == "iq_reference_maintenance"
        assert selected == symbols
        assert budget_seconds == 600 and refresh_days == 7
        assert kwargs == {"max_attempts": 50, "allow_empty": True}
        for _, operation in stages:
            assert await operation("S0800", {}) == 1
        return sync_all_data.SyncResult(True, 2, 0, 0, [], False, 1600)

    monkeypatch.setattr(sync_all_data.FullMarketSync, "_get_seeded_symbols", universe)
    monkeypatch.setattr(sync_all_data.FullMarketSync, "run_maintenance_cycle", cycle)
    monkeypatch.setattr(vietcap_ingestion, "sync_vietcap_reference", acquire)
    result = await sync_all_data.run_iq_reference_sync()
    assert captured == {"iq_company_profile": "S0800", "iq_shareholder_structure": "S0800"}
    assert not result.complete and result.pending_count == 1600


@pytest.mark.asyncio
@pytest.mark.parametrize("empty", [False, True])
async def test_iq_source_datetime_evidence_survives_sql_checkpoint(test_engine, monkeypatch, empty):
    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(sync_all_data, "async_session_maker", sessions)
    monkeypatch.setattr("vnibb.services.data_pipeline.async_session_maker", sessions)
    observed = datetime(2026, 10, 13, 8, tzinfo=UTC)

    async def acquire(symbol, progress):
        progress["acquisition"] = {"source": "vietcap", "source_response": {"receivedAt": observed}, "outcome": "empty" if empty else "succeeded"}
        progress["empty_count"] = int(empty)
        return int(not empty)

    result = await sync_all_data.FullMarketSync().run_maintenance_cycle(
        "iq_json_fixture", ["VNM"], [("iq_company_profile", acquire)], 30, 7, allow_empty=True,
    )
    assert result.complete and result.success
    async with sessions() as session:
        row = (await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == "iq_json_fixture"))).one()
        receipt = row.additional_data["stages"]["iq_company_profile"]["receipts"]["VNM"]
        assert receipt["acquisition"]["source_response"]["receivedAt"] == observed.isoformat()
        assert receipt["outcome"] == ("empty" if empty else "succeeded")
