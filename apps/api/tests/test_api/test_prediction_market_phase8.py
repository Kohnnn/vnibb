"""Tests for the Phase 8 prediction-market endpoints.

Covers:
  * /prediction-markets/spread (multi-source consensus diff)
  * /prediction-markets/consensus (volume-weighted consensus)
  * /prediction-markets/alerts (intraday threshold diff)
  * /prediction-markets/{source}/{source_id}/history (per-market time series)
  * /prediction-markets/cross-calibration (Phase 10)
"""

from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.api.v1 import prediction_markets as router
from vnibb.models.prediction_market import PredictionMarket
from vnibb.models.prediction_market_intraday_snapshot import (
    PredictionMarketIntradaySnapshot,
)
from vnibb.models.prediction_market_snapshot import PredictionMarketSnapshot


def _market(
    *,
    source: str,
    source_id: str,
    question: str,
    category: str = "economic",
    yes_price: float = 0.5,
    volume: float | None = None,
) -> PredictionMarket:
    market = PredictionMarket(
        source=source,
        source_id=source_id,
        question=question,
        slug=None,
        description=None,
        category=category,
        url=f"https://example.com/{source}/{source_id}",
        end_date=None,
        active=True,
        closed=False,
        volume=volume,
        liquidity=None,
        outcomes=["Yes", "No"],
        outcome_prices=[yes_price, 1.0 - yes_price],
        updated_at=datetime.now(timezone.utc),
    )
    return market


@pytest.mark.asyncio
async def test_spread_endpoint_returns_topics(monkeypatch):
    """The /spread endpoint returns one row per macro topic."""
    poly = [
        _market(
            source="polymarket",
            source_id="p-cpi-1",
            question="Will CPI exceed 3.0% in July?",
            category="economic",
            yes_price=0.4,
            volume=100_000,
        ),
    ]
    kalshi = [
        _market(
            source="kalshi",
            source_id="k-cpi-1",
            question="Will CPI exceed 3.0%?",
            category="economic",
            yes_price=0.45,
            volume=80_000,
        ),
    ]

    async def fake_execute(_stmt):
        return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: poly + kalshi))

    session = SimpleNamespace(execute=fake_execute)
    response = await router.list_prediction_market_spread(window=24, db=session)
    assert response.window_hours == 24
    assert {t.topic for t in response.topics} == {"cpi", "fed", "recession"}
    cpi = next(t for t in response.topics if t.topic == "cpi")
    assert cpi.polymarket_consensus is not None
    assert cpi.kalshi_consensus is not None
    assert cpi.gap is not None


@pytest.mark.asyncio
async def test_consensus_endpoint_weights_by_volume(monkeypatch):
    """The /consensus endpoint returns volume-weighted consensus."""

    class _Result:
        def scalars(self):
            return SimpleNamespace(all=lambda: [
                _market(
                    source="polymarket",
                    source_id="p-1",
                    question="Will CPI be above 3.0%?",
                    yes_price=0.4,
                    volume=200_000,
                ),
                _market(
                    source="kalshi",
                    source_id="k-1",
                    question="Will CPI be above 3.0%?",
                    yes_price=0.5,
                    volume=100_000,
                ),
            ])

    async def fake_execute(_stmt):
        return _Result()

    session = SimpleNamespace(execute=fake_execute)
    response = await router.get_prediction_market_consensus(
        query="CPI be above 3.0%", db=session
    )
    assert response.n_markets == 2
    assert response.consensus_yes_price is not None
    # Volume-weighted: (0.4*200k + 0.5*100k)/(200k+100k) ~= 0.4333
    assert abs(response.consensus_yes_price - (0.4 * 200_000 + 0.5 * 100_000) / 300_000) < 0.001


@pytest.mark.asyncio
async def test_alerts_endpoint_filters_by_min_movement():
    """The /alerts endpoint filters by min_movement_bps threshold."""
    now = datetime.now(timezone.utc)
    latest = PredictionMarketIntradaySnapshot(
        source="polymarket",
        source_id="p-1",
        question="Will CPI be above 3.0%?",
        category="economic",
        url=None,
        yes_price=0.5,
        volume=None,
        liquidity=None,
        captured_at=now,
    )
    baseline = PredictionMarketIntradaySnapshot(
        source="polymarket",
        source_id="p-1",
        question="Will CPI be above 3.0%?",
        category="economic",
        url=None,
        yes_price=0.45,
        volume=None,
        liquidity=None,
        captured_at=now.replace(hour=now.hour - 1),
    )

    class _Result:
        def __init__(self, rows):
            self._rows = rows

        def scalars(self):
            return SimpleNamespace(all=lambda: self._rows)

    async def fake_execute(_stmt):
        return _Result([latest])

    # First call -> latest rows; second call -> baseline rows.
    executed: list[list[PredictionMarketIntradaySnapshot]] = [[latest], [baseline]]
    index = {"i": 0}

    async def fake_execute_seq(_stmt):
        result = executed[index["i"]]
        index["i"] += 1
        return _Result(result)

    session = SimpleNamespace(execute=fake_execute_seq)
    response = await router.list_prediction_market_alerts(
        window=1, min_movement_bps=200, limit=10, db=session
    )
    # 0.5 - 0.45 = 0.05 = 500bps > 200bps -> included
    assert response.count == 1
    assert response.alerts[0].direction == "up"


@pytest.mark.asyncio
async def test_history_endpoint_returns_time_series():
    """The /history endpoint returns one row per snapshot."""
    now = datetime.now(timezone.utc)

    class _Result:
        def __init__(self, rows):
            self._rows = rows

        def scalars(self):
            return SimpleNamespace(all=lambda: self._rows)

    rows = [
        PredictionMarketSnapshot(
            market_id=1,
            source="polymarket",
            source_id="p-1",
            category="economic",
            question="Will CPI be above 3.0%?",
            url=None,
            yes_price=0.4,
            volume=None,
            liquidity=None,
            extra={},
            captured_at=now,
        ),
        PredictionMarketSnapshot(
            market_id=1,
            source="polymarket",
            source_id="p-1",
            category="economic",
            question="Will CPI be above 3.0%?",
            url=None,
            yes_price=0.42,
            volume=None,
            liquidity=None,
            extra={},
            captured_at=now,
        ),
    ]

    async def fake_execute(_stmt):
        return _Result(rows)

    session = SimpleNamespace(execute=fake_execute)
    response = await router.get_prediction_market_history(
        source="polymarket",
        source_id="p-1",
        days=30,
        db=session,
    )
    assert len(response.points) == 2
    assert response.points[0].yes_price == 0.4
    assert response.points[1].yes_price == 0.42