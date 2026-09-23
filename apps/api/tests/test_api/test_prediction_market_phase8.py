"""Tests for the Phase 8 prediction-market endpoints.

Covers:
  * /prediction-markets/spread (multi-source consensus diff)
  * /prediction-markets/consensus (volume-weighted consensus)
  * /prediction-markets/alerts (intraday threshold diff)
  * /prediction-markets/{source}/{source_id}/history (per-market time series)
  * /prediction-markets/cross-calibration (Phase 10)
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

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
        updated_at=datetime.now(UTC),
    )
    return market


@pytest.mark.asyncio
async def test_spread_and_consensus_aggregate_all_matching_markets(client, test_db):
    markets = [
        _market(source="polymarket", source_id="p-1", question="CPI above target?", yes_price=0.2, volume=1),
        _market(source="polymarket", source_id="p-2", question="CPI below target?", yes_price=0.8, volume=3),
        _market(source="kalshi", source_id="k-1", question="CPI above target?", yes_price=0.5, volume=2),
        _market(source="kalshi", source_id="k-2", question="Unrelated", yes_price=0.9, volume=9),
    ]
    invalid = _market(source="polymarket", source_id="p-invalid", question="CPI above target?", yes_price=0.2)
    invalid.outcome_prices = ["0.2", 0.8]
    markets.append(invalid)
    test_db.add_all(markets)
    await test_db.commit()

    spread = (await client.get("/api/v1/prediction-markets/spread")).json()
    cpi = next(row for row in spread["topics"] if row["topic"] == "cpi")
    assert cpi["n_polymarket"] == 3
    assert cpi["n_kalshi"] == 2
    assert cpi["polymarket_consensus"] == pytest.approx(0.65)
    assert cpi["kalshi_consensus"] == pytest.approx(0.5)
    assert cpi["gap"] == pytest.approx(0.15)

    consensus = (await client.get("/api/v1/prediction-markets/consensus", params={"query": "CPI"})).json()
    assert consensus["n_markets"] == 4
    assert consensus["consensus_yes_price"] == pytest.approx((0.2 + 0.8 * 3 + 0.5 * 2) / 6)
    assert len(consensus["sources"]) == 2


@pytest.mark.asyncio
async def test_alerts_select_nearest_baseline_and_rank_after_threshold(client, test_db):
    now = datetime.now(UTC)
    for source_id, price, previous in (("p-1", 0.6, 0.5), ("p-2", 0.9, 0.3), ("p-3", 0.51, 0.5)):
        for captured_at, yes_price in ((now, price), (now - timedelta(hours=2), previous)):
            test_db.add(PredictionMarketIntradaySnapshot(
                source="polymarket", source_id=source_id, question="CPI?", category="economic",
                yes_price=yes_price, captured_at=captured_at,
            ))
    test_db.add(PredictionMarketIntradaySnapshot(
        source="polymarket", source_id="p-1", question="CPI?", category="economic",
        yes_price=0.1, captured_at=now - timedelta(hours=3),
    ))
    await test_db.commit()
    response = await client.get("/api/v1/prediction-markets/alerts", params={
        "window_hours": 1, "min_movement_bps": 200, "limit": 1,
    })
    assert response.status_code == 200
    assert response.json()["count"] == 1
    assert response.json()["alerts"][0]["source_id"] == "p-2"
    assert response.json()["alerts"][0]["movement"] == pytest.approx(0.6)


@pytest.mark.asyncio
async def test_calibration_filters_before_limit_and_cross_calibration_counts_topics(client, test_db):
    markets = [
        _market(source="polymarket", source_id="irrelevant", question="Weather tomorrow?", yes_price=0.9),
        _market(source="polymarket", source_id="p-1", question="CPI rises?", yes_price=0.4, volume=3),
        _market(source="polymarket", source_id="p-2", question="Core inflation falls?", yes_price=0.8, volume=1),
        _market(source="kalshi", source_id="k-1", question="CPI rises?", yes_price=0.45, volume=2),
    ]
    test_db.add_all(markets)
    await test_db.commit()

    calibration = (await client.get("/api/v1/prediction-markets/calibration", params={"topic": "cpi", "limit": 2})).json()
    assert [row["source_id"] for row in calibration["markets"]] == ["p-1", "p-2"]
    assert calibration["consensus_yes_price"] == pytest.approx(0.6)

    cross = (await client.get("/api/v1/prediction-markets/cross-calibration")).json()
    cpi = next(row for row in cross["topics"] if row["topic"] == "cpi")
    assert cpi["n_sources"] == 2
    assert {row["source"]: row["n_markets"] for row in cpi["sources"]} == {"kalshi": 1, "polymarket": 2}
    assert {row["source"]: row["consensus_yes_price"] for row in cpi["sources"]} == pytest.approx({"kalshi": 0.45, "polymarket": 0.5})
    assert cross["last_updated"] is not None


@pytest.mark.asyncio
async def test_inactive_history_merges_live_and_archive_without_dropping_early_rows(client, test_db):
    from vnibb.models.prediction_market_archive import PredictionMarketArchive

    live = _market(source="kalshi", source_id="live-closed", question="Closed CPI?", yes_price=0.4)
    live.active = False
    live.end_date = datetime(2025, 6, 1)
    archived = _market(source="polymarket", source_id="archived-closed", question="Closed CPI?", yes_price=0.3)
    archived.active = False
    archived.end_date = datetime(2025, 1, 1)
    payload = {column.name: getattr(archived, column.name) for column in PredictionMarket.__table__.columns}
    for name in ("end_date", "created_at", "updated_at"):
        if payload[name] is not None:
            payload[name] = payload[name].isoformat()
    test_db.add(live)
    test_db.add(PredictionMarketArchive(
        market_id=42, batch_id="historical", payload=payload, sha256="a" * 64,
        archived_at=datetime.now(UTC), backup_sha256="b" * 64,
    ))
    await test_db.commit()

    inactive = (await client.get("/api/v1/prediction-markets", params={"active": "false", "limit": 1})).json()
    assert [row["source_id"] for row in inactive["data"]] == ["archived-closed"]
    all_rows = (await client.get("/api/v1/prediction-markets", params={"limit": 2})).json()
    assert [row["source_id"] for row in all_rows["data"]] == ["archived-closed", "live-closed"]
    active = (await client.get("/api/v1/prediction-markets", params={"active": "true"})).json()
    assert active["data"] == []


@pytest.mark.asyncio
async def test_alerts_accepts_window_hours_and_legacy_window_with_conflict_rejected(client):
    canonical = await client.get("/api/v1/prediction-markets/alerts", params={"window_hours": "1"})
    legacy = await client.get("/api/v1/prediction-markets/alerts", params={"window": "1"})
    conflict = await client.get(
        "/api/v1/prediction-markets/alerts",
        params={"window_hours": "1", "window": "2"},
    )

    assert canonical.status_code == 200
    assert canonical.json()["window_hours"] == 1
    assert legacy.status_code == 200
    assert legacy.json()["window_hours"] == 1
    assert conflict.status_code == 422


@pytest.mark.asyncio
async def test_history_endpoint_returns_time_series():
    """The /history endpoint returns one row per snapshot."""
    now = datetime.now(UTC)

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
