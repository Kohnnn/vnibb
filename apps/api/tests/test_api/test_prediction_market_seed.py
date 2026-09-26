"""Explicit fixture seeding is synthetic, never an implicit live observation."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from vnibb.models.prediction_market import PredictionMarket
from vnibb.services.prediction_market_policy import snapshot_eligibility
from vnibb.services.prediction_market_seed import seed_limitless_from_fixture


@pytest.mark.asyncio
async def test_explicit_fixture_seed_does_not_enter_live_snapshot(test_db, tmp_path):
    fixture = tmp_path / "limitless.json"
    fixture.write_text(json.dumps([{
        "id": "fixture-1", "title": "Will interest rates decline?",
        "prices": {"yes": 0.6, "no": 0.4},
    }]), encoding="utf-8")
    assert await seed_limitless_from_fixture(test_db, path=str(fixture)) == 1
    row = (await test_db.execute(select(PredictionMarket))).scalars().one()
    assert row.is_synthetic is True
    assert row.outcome_prices == [0.6, 0.4]
    assert (await test_db.execute(select(PredictionMarket.id).where(
        *snapshot_eligibility(datetime.now(UTC) + timedelta(minutes=1))
    ))).scalars().all() == []
