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
        test_db.add(_market(source="polymarket", source_id=source_id, question="CPI?", yes_price=price))
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
    assert [row["source_id"] for row in calibration["markets"]] == ["k-1", "p-2"]
    assert calibration["consensus_yes_price"] == pytest.approx(0.625)

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
    archived.is_synthetic = False
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
    assert all_rows["data"] == []
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
async def test_history_preserves_observed_zero_and_timestamps_without_filling_gaps(client, test_db):
    now = datetime.now(UTC).replace(microsecond=0)
    test_db.add(_market(source="kalshi", source_id="observed", question="CPI?", yes_price=0))
    test_db.add(_market(source="kalshi", source_id="missing", question="CPI?"))
    for captured_at, price in ((now - timedelta(days=3), 0.4), (now, 0.0)):
        test_db.add(PredictionMarketSnapshot(
            source="kalshi", source_id="observed", question="CPI?",
            yes_price=price, captured_at=captured_at,
        ))
    for captured_at, price in ((now - timedelta(hours=1), 0.2), (now, 0.0)):
        test_db.add(PredictionMarketIntradaySnapshot(
            source="kalshi", source_id="observed", question="CPI?",
            yes_price=price, captured_at=captured_at,
        ))
    await test_db.commit()
    response = await client.get("/api/v1/prediction-markets/kalshi/observed/history")
    assert response.status_code == 200
    points = response.json()["points"]
    assert [point["yes_price"] for point in points] == [0.4, 0.2, 0.0]
    assert [datetime.fromisoformat(point["captured_at"]).replace(tzinfo=UTC) for point in points] == [
        now - timedelta(days=3), now - timedelta(hours=1), now,
    ]
    short = await client.get("/api/v1/prediction-markets/kalshi/observed/history", params={"days": 1})
    assert [point["yes_price"] for point in short.json()["points"]] == [0.2, 0.0]
    missing = await client.get("/api/v1/prediction-markets/kalshi/missing/history")
    assert missing.json()["points"] == []


@pytest.mark.asyncio
async def test_current_reads_share_genuine_fresh_eligibility(client, test_db):
    from vnibb.services.prediction_market_estimator import _load_active_markets

    now = datetime.now(UTC)
    genuine = _market(source="polymarket", source_id="live", question="CPI above 3%?", yes_price=0.4)
    genuine.description = "Resolves from the official release."
    genuine.extra = {"canonical_topics": ["macro"]}
    rows = [genuine]
    for source_id, changes in (
        ("fixture", {"is_synthetic": True}),
        ("stale", {"updated_at": now - timedelta(hours=25)}),
        ("expired", {"end_date": now - timedelta(seconds=1)}),
        ("closed", {"closed": True}),
        ("inactive", {"active": False}),
    ):
        row = _market(source="polymarket", source_id=source_id, question="CPI above 3%?", yes_price=0.9)
        for key, value in changes.items():
            setattr(row, key, value)
        rows.append(row)
    rows.append(_market(source="kalshi", source_id="KXMV-COMBO", question="CPI above 3%?"))
    test_db.add_all(rows)
    await test_db.commit()
    catalogue = (await client.get("/api/v1/prediction-markets")).json()
    assert [row["source_id"] for row in catalogue["data"]] == ["live"]
    assert catalogue["data"][0]["description"] == genuine.description
    assert catalogue["data"][0]["extra"] == genuine.extra
    detail = await client.get("/api/v1/prediction-markets/polymarket/live")
    assert detail.json()["outcome_prices"] == [0.4, 0.6]
    assert (await client.get("/api/v1/prediction-markets/polymarket/fixture")).status_code == 404
    calibration = (await client.get("/api/v1/prediction-markets/calibration")).json()
    assert calibration["n_markets"] == 1
    assert calibration["consensus_yes_price"] == 0.4
    consensus = (await client.get("/api/v1/prediction-markets/consensus", params={"query": "CPI"})).json()
    assert consensus["n_markets"] == 1
    assert consensus["consensus_yes_price"] == 0.4
    assert consensus["sources"][0]["volume"] is None
    cross = (await client.get("/api/v1/prediction-markets/cross-calibration")).json()
    assert cross["topics"][0]["sources"][0]["n_markets"] == 1
    assert [row.source_id for row in await _load_active_markets(test_db)] == ["live"]


@pytest.mark.asyncio
async def test_all_sources_without_fresh_genuine_rows_report_no_live_data(client, test_db):
    for source in router.KNOWN_PREDICTION_MARKET_SOURCES:
        fixture = _market(source=source, source_id="fixture", question="CPI?")
        fixture.is_synthetic = True
        stale = _market(source=source, source_id="stale", question="CPI?")
        stale.updated_at = datetime.now(UTC) - timedelta(days=2)
        test_db.add_all([fixture, stale])
    await test_db.commit()
    rows = (await client.get("/api/v1/prediction-markets/source-health")).json()["sources"]
    assert {row["source"] for row in rows} == set(router.KNOWN_PREDICTION_MARKET_SOURCES)
    assert all(row["status"] == "empty" and row["live_market_count"] == 0 for row in rows)


@pytest.mark.asyncio
async def test_candidates_bound_each_source_before_analysis_filters(client, test_db, monkeypatch):
    from vnibb.services import prediction_market_policy as policy
    from vnibb.services.prediction_market_estimator import _load_active_markets

    monkeypatch.setattr(policy, "SNAPSHOT_SOURCE_LIMIT", 2)
    now = datetime.now(UTC)
    for source in ("kalshi", "polymarket"):
        for index, question in enumerate(("CPI old?", "CPI recent?", "Weather recent?")):
            row = _market(source=source, source_id=str(index), question=question)
            row.updated_at = now - timedelta(minutes=3 - index)
            test_db.add(row)
    await test_db.commit()
    rows = await _load_active_markets(test_db)
    assert {(row.source, row.source_id) for row in rows} == {
        (source, source_id) for source in ("kalshi", "polymarket") for source_id in ("1", "2")
    }
    calibration = (await client.get("/api/v1/prediction-markets/calibration", params={"limit": 1})).json()
    assert calibration["n_markets"] == 1
    assert calibration["markets"][0]["source_id"] == "1"


@pytest.mark.asyncio
async def test_missing_price_vector_is_not_zero_probability(client, test_db):
    from vnibb.services.prediction_market_estimator import _load_active_markets

    missing = _market(source="kalshi", source_id="missing-price", question="CPI?", volume=1000)
    missing.outcome_prices = [0, 0]
    zero = _market(source="kalshi", source_id="observed-zero", question="CPI?", yes_price=0, volume=1)
    test_db.add_all([missing, zero])
    await test_db.commit()
    consensus = (await client.get("/api/v1/prediction-markets/consensus", params={"query": "CPI"})).json()
    assert consensus["consensus_yes_price"] == 0
    assert consensus["sources"][0]["volume"] == 1
    assert [row.source_id for row in await _load_active_markets(test_db)] == ["observed-zero"]
