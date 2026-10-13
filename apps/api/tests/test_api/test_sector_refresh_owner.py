from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.dialects import sqlite

from vnibb.core.vn_sectors import SectorConfig
from vnibb.providers.vnstock.equity_screener import VnstockScreenerFetcher
from vnibb.services import data_pipeline as pipeline_module
from vnibb.services import sector_service


class RecordingSession:
    def __init__(self, snapshots=()):
        self.snapshots = snapshots
        self.statements = []
        self.committed = False

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def scalar(self, statement):
        return max((row.snapshot_date for row in self.snapshots), default=None)

    async def execute(self, statement):
        if statement.is_select:
            return SimpleNamespace(all=lambda: [(row, None) for row in self.snapshots])
        self.statements.append(statement)

    async def commit(self):
        self.committed = True


@pytest.fixture
def owner(monkeypatch):
    session = RecordingSession()
    monkeypatch.setattr(pipeline_module, "async_session_maker", lambda: session)
    monkeypatch.setattr(pipeline_module, "engine", SimpleNamespace(dialect=sqlite.dialect()))
    monkeypatch.setattr(sector_service, "VN_SECTORS", {
        "banking": SectorConfig(name="Bank", name_en="Bank", keywords=["bank"]),
        "uncovered": SectorConfig(name="Other", name_en="Other", keywords=["other"]),
    })
    fetch = AsyncMock(return_value=[])
    monkeypatch.setattr(VnstockScreenerFetcher, "fetch", fetch)
    return pipeline_module.DataPipeline(), session, fetch


def values(session):
    return [stmt.compile(dialect=sqlite.dialect()).params for stmt in session.statements]


def constituent(index=0, **metrics):
    return {"symbol": f"B{index:02}", "industry_name": "bank", "trade_date": date(2026, 10, 9),
            "price": 100, "price_change_1d_pct": 1, **metrics}


@pytest.mark.asyncio
async def test_refresh_persists_all_members_not_top_ten_and_upserts_same_source_date(owner):
    pipeline, session, fetch = owner
    fetch.return_value = [constituent(index, volume=index, value_traded=index * 100)
                          for index in range(12)]
    assert await pipeline.sync_sector_performance() == 1
    assert await pipeline.sync_sector_performance() == 1
    first, second = values(session)
    assert first["total_volume"] == second["total_volume"] == 66
    assert first["total_value"] == second["total_value"] == 6600
    assert first["advance_count"] == 12
    assert first["trade_date"] == date(2026, 10, 9)
    assert first["sector_code"] == "banking"
    sql = str(session.statements[-1].compile(dialect=sqlite.dialect()))
    assert "ON CONFLICT (sector_code, trade_date) DO UPDATE" in sql
    assert "total_volume = excluded.total_volume" in sql
    assert "total_value = excluded.total_value" in sql
    assert session.committed
    params = fetch.call_args.args[0]
    assert params.exchange == "ALL" and params.limit == 2000


@pytest.mark.asyncio
@pytest.mark.parametrize("metrics,expected", [
    ({}, (None, None)),
    ({"volume": None, "value_traded": None}, (None, None)),
    ({"volume": 0, "value_traded": 0}, (0, 0)),
    ({"volume": 7, "value_traded": 99}, (7, 99)),
    ({"volume": 7}, (7, None)),
    ({"volume": float("nan"), "value_traded": float("inf")}, (None, None)),
])
async def test_refresh_preserves_missing_null_and_genuine_zero(owner, metrics, expected):
    pipeline, session, fetch = owner
    fetch.return_value = [constituent(**metrics)]
    assert await pipeline.sync_sector_performance() == 1
    row = values(session)[0]
    assert (row["total_volume"], row["total_value"]) == expected


@pytest.mark.asyncio
async def test_refresh_does_not_call_partial_observations_a_sector_total(owner):
    pipeline, session, fetch = owner
    fetch.return_value = [constituent(0, volume=10, value_traded=100), constituent(1)]
    assert await pipeline.sync_sector_performance() == 1
    row = values(session)[0]
    assert row["total_volume"] is None and row["total_value"] is None


@pytest.mark.asyncio
async def test_refresh_keeps_distinct_observation_dates(owner):
    pipeline, session, fetch = owner
    fetch.return_value = [constituent(volume=7, value_traded=70),
                         constituent(1, trade_date=date(2026, 10, 8), volume=3, value_traded=30)]
    assert await pipeline.sync_sector_performance() == 2
    assert {(row["trade_date"], row["total_volume"]) for row in values(session)} == {
        (date(2026, 10, 9), 7), (date(2026, 10, 8), 3),
    }


@pytest.mark.asyncio
async def test_refresh_falls_back_to_dated_snapshot_with_exact_turnover(owner):
    pipeline, session, fetch = owner
    session.snapshots = [SimpleNamespace(
        symbol="B00", snapshot_date=date(2026, 10, 12), trade_date=date(2026, 10, 9),
        price=100, volume=0, industry="bank", extended_metrics={"value_traded": 0, "change_1d": 0},
    )]
    fetch.return_value = [constituent(trade_date=None)]
    assert await pipeline.sync_sector_performance() == 1
    row = values(session)[0]
    assert row["trade_date"] == date(2026, 10, 9)
    assert row["total_volume"] == row["total_value"] == 0
    assert row["unchanged_count"] == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("rows", [[], [constituent(trade_date=None)]])
async def test_refresh_reports_unavailable_without_dated_input(owner, rows):
    pipeline, session, fetch = owner
    fetch.return_value = rows
    with pytest.raises(ValueError, match="dated screener"):
        await pipeline.sync_sector_performance()
    assert not session.statements and not session.committed


@pytest.mark.asyncio
async def test_refresh_propagates_provider_error_without_writing(owner):
    pipeline, session, fetch = owner
    fetch.side_effect = RuntimeError("provider unavailable")
    with pytest.raises(RuntimeError, match="provider unavailable"):
        await pipeline.sync_sector_performance()
    assert not session.statements and not session.committed


@pytest.mark.asyncio
async def test_refresh_propagates_persistence_failure(owner, monkeypatch):
    pipeline, session, fetch = owner
    fetch.return_value = [constituent(volume=1, value_traded=100)]
    monkeypatch.setattr(session, "execute", AsyncMock(side_effect=RuntimeError("database unavailable")))
    with pytest.raises(RuntimeError, match="database unavailable"):
        await pipeline.sync_sector_performance()
    assert not session.committed


@pytest.mark.asyncio
async def test_refresh_never_uses_snapshot_acquisition_date_as_trade_date(owner):
    pipeline, session, _fetch = owner
    session.snapshots = [SimpleNamespace(
        symbol="B00", snapshot_date=date(2026, 10, 12), trade_date=None,
        price=100, volume=0, industry="bank", extended_metrics={"value_traded": 0},
    )]
    with pytest.raises(ValueError, match="dated screener"):
        await pipeline.sync_sector_performance()
    assert not session.statements and not session.committed


@pytest.mark.asyncio
async def test_static_master_refresh_updates_existing_natural_key(owner, monkeypatch):
    pipeline, session, _fetch = owner
    config = SectorConfig(name="Bank", name_en="Banking", icb_codes=["8300"])
    monkeypatch.setattr("vnibb.core.vn_sectors.get_all_sectors", lambda: {"banking": config})
    assert await pipeline.sync_market_sectors() == 1
    config.name = "Updated Bank"
    assert await pipeline.sync_market_sectors() == 1
    assert values(session)[-1]["sector_name"] == "Updated Bank"
    assert "ON CONFLICT (sector_code) DO UPDATE" in str(session.statements[-1].compile(dialect=sqlite.dialect()))
