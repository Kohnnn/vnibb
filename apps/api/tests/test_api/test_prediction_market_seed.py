"""Tests for the populate + seed path."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from vnibb.services.prediction_market_seed import (
    seed_limitless_from_fixture,
    seed_predictit_from_fixture,
)
from vnibb.services.populate_prediction_markets import (
    POPULATE_BACKFILL_DAYS,
    POPULATE_BACKFILL_SNAPSHOTS_PER_DAY,
    populate_prediction_markets_now,
)


class _FakeSession:
    def __init__(self) -> None:
        self.execute = AsyncMock()
        self.commit = AsyncMock()
        self._dialect_name = "sqlite"

    def get_bind(self):
        bind = MagicMock()
        bind.dialect.name = self._dialect_name
        return bind


@pytest.mark.asyncio
async def test_predictit_seed_fixture_is_present_and_valid_json():
    """The committed PredictIt fixture is valid JSON and contains markets."""
    from vnibb.services.prediction_market_seed import SEED_FIXTURE_DIR
    fixture_path = SEED_FIXTURE_DIR / "predictit_markets.json"
    payload = json.loads(fixture_path.read_text(encoding="utf-8"))
    assert isinstance(payload, list)
    assert len(payload) >= 10
    # Each entry must have an id, name, and at least one priced contract.
    for row in payload:
        assert "id" in row
        assert "name" in row
        contracts = row.get("contracts") or []
        assert any("LatestYesPrice" in c for c in contracts)


@pytest.mark.asyncio
async def test_limitless_seed_fixture_is_present_and_valid_json():
    from vnibb.services.prediction_market_seed import SEED_FIXTURE_DIR
    fixture_path = SEED_FIXTURE_DIR / "limitless_markets.json"
    payload = json.loads(fixture_path.read_text(encoding="utf-8"))
    assert isinstance(payload, list)
    assert len(payload) >= 5
    for row in payload:
        assert row.get("prices", {}).get("yes") is not None


@pytest.mark.asyncio
async def test_populate_prediction_markets_falls_back_to_seed(monkeypatch):
    """When live ingest returns 0 rows the offline seed path is used."""
    from vnibb.services import populate_prediction_markets as mod

    # Live ingests all fail or return 0; we expect the offline seed to step in.
    monkeypatch.setattr(
        mod,
        "ingest_polymarket_gamma_markets_with_default_client",
        AsyncMock(return_value=5),
    )
    monkeypatch.setattr(
        mod,
        "ingest_kalshi_markets_with_default_client",
        AsyncMock(return_value=2),
    )
    monkeypatch.setattr(
        mod,
        "ingest_predictit_markets_with_default_client",
        AsyncMock(side_effect=RuntimeError("api down")),
    )
    monkeypatch.setattr(
        mod,
        "ingest_limitless_markets_with_default_client",
        AsyncMock(return_value=0),
    )
    monkeypatch.setattr(
        mod,
        "ingest_manifold_markets_with_default_client",
        AsyncMock(side_effect=RuntimeError("api down")),
    )
    monkeypatch.setattr(
        mod,
        "snapshot_active_prediction_markets",
        AsyncMock(return_value=10),
    )
    monkeypatch.setattr(
        mod,
        "snapshot_active_prediction_markets_intraday",
        AsyncMock(return_value=MagicMock(rows_written=10, markets_seen=10, was_inserted=True, retried=False)),
    )
    monkeypatch.setattr(mod, "snapshot_row_count", AsyncMock(return_value=0))
    monkeypatch.setattr(mod, "backfill_prediction_market_snapshots", AsyncMock(return_value=50))

    session = _FakeSession()
    counts = await populate_prediction_markets_now(session)

    assert counts["polymarket"] == 5
    assert counts["kalshi"] == 2
    assert counts["predictit"] >= 10
    assert counts["limitless"] >= 5
    assert counts["manifold"] >= 5
    assert counts["nightly_snapshot"] == 10
    assert counts["backfill"] == 50
    assert counts["intraday_snapshot"] == 10


def test_populate_constants_sane():
    assert 1 <= POPULATE_BACKFILL_DAYS <= 30
    assert 1 <= POPULATE_BACKFILL_SNAPSHOTS_PER_DAY <= 12


@pytest.mark.asyncio
async def test_seed_predictit_from_fixture_writes_rows(monkeypatch):
    """The seed helper actually invokes the upsert SQL the same number of times as markets in the fixture."""
    upsert_mock = MagicMock()
    monkeypatch.setattr(
        "vnibb.services.prediction_market_seed._upsert_prediction_market",
        upsert_mock,
    )
    session = _FakeSession()
    count = await seed_predictit_from_fixture(session)
    # Each fixture row has at least one priced contract.
    from vnibb.services.prediction_market_seed import SEED_FIXTURE_DIR
    fixture_path = SEED_FIXTURE_DIR / "predictit_markets.json"
    expected = len(json.loads(fixture_path.read_text(encoding="utf-8")))
    assert count == expected
    assert upsert_mock.call_count == expected