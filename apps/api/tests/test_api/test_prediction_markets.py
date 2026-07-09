from __future__ import annotations

import importlib.util
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest
from sqlalchemy import select

from vnibb.models.prediction_market import PredictionMarket
from vnibb.models.prediction_market_snapshot import PredictionMarketSnapshot
from vnibb.services.prediction_market_service import (
    GammaMarketPayload,
    ingest_polymarket_gamma_markets,
    normalize_gamma_market,
)

GAMMA_MARKET = {
    "id": "512345",
    "question": "Will the Fed cut rates in July?",
    "slug": "fed-cut-july",
    "description": "Fed policy market",
    "category": "Economics",
    "url": "https://polymarket.com/event/fed-2026",
    "endDate": "2026-07-31T00:00:00Z",
    "active": True,
    "closed": False,
    "volume": "1234.5",
    "liquidity": "987.6",
    "outcomes": '["Yes", "No"]',
    "outcomePrices": '["0.61", "0.39"]',
}


@dataclass(frozen=True, slots=True)
class SnapshotFixture:
    market_id: int
    source: str
    source_id: str
    category: str
    question: str
    yes_price: float
    captured_at: datetime
    volume: float = 100.0


def make_snapshot(fixture: SnapshotFixture) -> PredictionMarketSnapshot:
    return PredictionMarketSnapshot(
        market_id=fixture.market_id,
        source=fixture.source,
        source_id=fixture.source_id,
        category=fixture.category,
        question=fixture.question,
        url=f"https://example.com/{fixture.source_id}",
        yes_price=fixture.yes_price,
        volume=fixture.volume,
        liquidity=None,
        extra={},
        captured_at=fixture.captured_at,
    )


@pytest.mark.asyncio
async def test_normalize_gamma_market_when_payload_has_stringified_outcomes() -> None:
    # Given: a Gamma market payload with stringified list fields.
    payload = GammaMarketPayload.model_validate(GAMMA_MARKET)

    # When: it is normalized for source-agnostic storage.
    market = normalize_gamma_market(payload)

    # Then: source/source_id identify the market and prices are numeric.
    assert market.source == "polymarket"
    assert market.source_id == "512345"
    assert market.question == "Will the Fed cut rates in July?"
    assert market.slug == "fed-cut-july"
    assert market.url == "https://polymarket.com/event/fed-2026"
    assert market.outcomes == ("Yes", "No")
    assert market.outcome_prices == (0.61, 0.39)
    assert market.end_date == datetime.fromisoformat("2026-07-31T00:00:00+00:00")


@pytest.mark.asyncio
async def test_ingest_polymarket_gamma_markets_when_market_repeats_updates_db_row(test_db) -> None:
    # Given: Gamma returns the same source_id with newer values on the second request.
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        payload = dict(GAMMA_MARKET)
        payload["question"] = "Updated question" if calls == 2 else GAMMA_MARKET["question"]
        payload["url"] = "https://polymarket.com/event/fed-2026-updated" if calls == 2 else GAMMA_MARKET["url"]
        return httpx.Response(200, json=[payload])

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport, base_url="https://gamma-api.polymarket.com") as client:
        # When: ingestion runs twice.
        first_count = await ingest_polymarket_gamma_markets(test_db, client, 10)
        second_count = await ingest_polymarket_gamma_markets(test_db, client, 10)

    # Then: the existing row is updated instead of duplicated.
    rows = (await test_db.execute(select(PredictionMarket))).scalars().all()
    assert first_count == 1
    assert second_count == 1
    assert len(rows) == 1
    assert rows[0].source == "polymarket"
    assert rows[0].source_id == "512345"
    assert rows[0].question == "Updated question"
    assert rows[0].url == "https://polymarket.com/event/fed-2026-updated"


@pytest.mark.asyncio
async def test_prediction_markets_route_when_db_has_polymarket_rows_returns_normalized_payload(
    client,
    test_db,
) -> None:
    # Given: a persisted Polymarket row.
    test_db.add(
        PredictionMarket(
            source="polymarket",
            source_id="512345",
            question="Will the Fed cut rates in July?",
            slug="fed-cut-july",
            description="Fed policy market",
            category="Economics",
            url="https://polymarket.com/event/fed-2026",
            end_date=datetime.fromisoformat("2026-07-31T00:00:00+00:00"),
            active=True,
            closed=False,
            volume=1234.5,
            liquidity=987.6,
            outcomes=["Yes", "No"],
            outcome_prices=[0.61, 0.39],
        )
    )
    await test_db.commit()

    # When: the v1 read API is called.
    response = await client.get("/api/v1/prediction-markets", params={"source": "polymarket"})

    # Then: it serves DB-backed source-agnostic market data.
    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 1
    assert payload["data"][0]["source"] == "polymarket"
    assert payload["data"][0]["source_id"] == "512345"
    assert payload["data"][0]["url"] == "https://polymarket.com/event/fed-2026"
    assert payload["data"][0]["outcomes"] == ["Yes", "No"]
    assert payload["data"][0]["outcome_prices"] == [0.61, 0.39]


@pytest.mark.asyncio
async def test_prediction_markets_route_when_table_missing_returns_empty_payload(
    client,
    test_engine,
) -> None:
    # Given: the prediction_markets schema has not been applied.
    async with test_engine.begin() as conn:
        await conn.run_sync(PredictionMarket.__table__.drop)

    # When: the filtered v1 read API is called.
    response = await client.get(
        "/api/v1/prediction-markets",
        params={"source": "polymarket", "active": "true", "limit": "5"},
    )

    # Then: the route degrades to an empty successful result.
    assert response.status_code == 200
    assert response.json() == {"count": 0, "data": []}


@pytest.mark.asyncio
async def test_source_health_route_when_rows_exist_returns_all_known_sources(
    client,
    test_db,
) -> None:
    # Given: one market source has current market and snapshot rows.
    now = datetime.now(UTC)
    test_db.add(
        PredictionMarket(
            source="polymarket",
            source_id="512345",
            question="Will the Fed cut rates in July?",
            slug="fed-cut-july",
            description="Fed policy market",
            category="Economics",
            url="https://polymarket.com/event/fed-2026",
            end_date=datetime.fromisoformat("2026-07-31T00:00:00+00:00"),
            active=True,
            closed=False,
            volume=1234.5,
            liquidity=987.6,
            outcomes=["Yes", "No"],
            outcome_prices=[0.61, 0.39],
        )
    )
    test_db.add(
        PredictionMarketSnapshot(
            market_id=1,
            source="polymarket",
            source_id="512345",
            category="Economics",
            question="Will the Fed cut rates in July?",
            url="https://polymarket.com/event/fed-2026",
            yes_price=0.61,
            volume=1234.5,
            liquidity=987.6,
            extra={},
            captured_at=now,
        )
    )
    await test_db.commit()

    # When: source health is requested.
    response = await client.get("/api/v1/prediction-markets/source-health")

    # Then: every known source is present and empty sources stay visible.
    assert response.status_code == 200
    sources = {row["source"]: row for row in response.json()["sources"]}
    assert set(sources) == {"polymarket", "kalshi", "predictit", "limitless", "manifold"}
    assert sources["polymarket"]["status"] == "synced"
    assert sources["polymarket"]["market_count"] == 1
    assert sources["polymarket"]["snapshot_count"] == 1
    assert sources["polymarket"]["latest_snapshot_at"] is not None
    assert sources["polymarket"]["stale_after_seconds"] == 86400
    assert sources["kalshi"] == {
        "source": "kalshi",
        "status": "empty",
        "market_count": 0,
        "snapshot_count": 0,
        "latest_snapshot_at": None,
        "stale_after_seconds": 86400,
    }


@pytest.mark.asyncio
async def test_source_health_route_when_tables_missing_returns_empty_sources(
    client,
    test_engine,
) -> None:
    # Given: prediction market tables have not been applied.
    async with test_engine.begin() as conn:
        await conn.run_sync(PredictionMarketSnapshot.__table__.drop)
        await conn.run_sync(PredictionMarket.__table__.drop)

    # When: source health is requested.
    response = await client.get("/api/v1/prediction-markets/source-health")

    # Then: the route returns empty health rows instead of a server error.
    assert response.status_code == 200
    assert response.json() == {
        "sources": [
            {
                "source": source,
                "status": "empty",
                "market_count": 0,
                "snapshot_count": 0,
                "latest_snapshot_at": None,
                "stale_after_seconds": 86400,
            }
            for source in ("polymarket", "kalshi", "predictit", "limitless", "manifold")
        ]
    }


@pytest.mark.asyncio
async def test_movers_route_when_multiple_baselines_exist_uses_one_nearest_per_market(
    client,
    test_db,
) -> None:
    # Given: one market has two historical baselines and another has a larger down move.
    now = datetime.now(UTC)
    snapshots = [
        make_snapshot(
            SnapshotFixture(
                market_id=1,
                source="polymarket",
                source_id="near-baseline",
                category="Economics",
                question="Will rates fall?",
                yes_price=0.60,
                captured_at=now,
            )
        ),
        make_snapshot(
            SnapshotFixture(
                market_id=1,
                source="polymarket",
                source_id="near-baseline",
                category="Economics",
                question="Will rates fall?",
                yes_price=0.55,
                captured_at=now - timedelta(hours=25),
            )
        ),
        make_snapshot(
            SnapshotFixture(
                market_id=1,
                source="polymarket",
                source_id="near-baseline",
                category="Economics",
                question="Will rates fall?",
                yes_price=0.10,
                captured_at=now - timedelta(hours=48),
            )
        ),
        make_snapshot(
            SnapshotFixture(
                market_id=2,
                source="predictit",
                source_id="down-move",
                category="Politics",
                question="Will a candidate win?",
                yes_price=0.35,
                captured_at=now,
                volume=200.0,
            )
        ),
        make_snapshot(
            SnapshotFixture(
                market_id=2,
                source="predictit",
                source_id="down-move",
                category="Politics",
                question="Will a candidate win?",
                yes_price=0.50,
                captured_at=now - timedelta(hours=25),
                volume=200.0,
            )
        ),
    ]
    test_db.add_all(snapshots)
    await test_db.commit()

    # When: movers are requested without filtering.
    response = await client.get(
        "/api/v1/prediction-markets/movers",
        params={"window": "24", "direction": "both", "limit": "10"},
    )

    # Then: each market has one mover row and baseline picks the nearest older snapshot.
    assert response.status_code == 200
    payload = response.json()
    assert payload["window_hours"] == 24
    assert payload["count"] == 2
    assert [row["source_id"] for row in payload["movers"]] == ["down-move", "near-baseline"]
    assert payload["movers"][0]["absolute_movement"] == pytest.approx(-0.15)
    assert payload["movers"][1]["previous_yes_price"] == pytest.approx(0.55)
    assert payload["movers"][1]["absolute_movement"] == pytest.approx(0.05)


@pytest.mark.asyncio
async def test_movers_route_respects_direction_limit_and_excluded_categories(
    client,
    test_db,
) -> None:
    # Given: three movers across categories and directions.
    now = datetime.now(UTC)
    test_db.add_all(
        [
            make_snapshot(
                SnapshotFixture(
                    market_id=1,
                    source="polymarket",
                    source_id="economic-up-big",
                    category="Economics",
                    question="Will GDP rise?",
                    yes_price=0.70,
                    captured_at=now,
                )
            ),
            make_snapshot(
                SnapshotFixture(
                    market_id=1,
                    source="polymarket",
                    source_id="economic-up-big",
                    category="Economics",
                    question="Will GDP rise?",
                    yes_price=0.50,
                    captured_at=now - timedelta(hours=25),
                )
            ),
            make_snapshot(
                SnapshotFixture(
                    market_id=2,
                    source="manifold",
                    source_id="sports-up-small",
                    category="Sports",
                    question="Will Team A win?",
                    yes_price=0.48,
                    captured_at=now,
                    volume=80.0,
                )
            ),
            make_snapshot(
                SnapshotFixture(
                    market_id=2,
                    source="manifold",
                    source_id="sports-up-small",
                    category="Sports",
                    question="Will Team A win?",
                    yes_price=0.40,
                    captured_at=now - timedelta(hours=25),
                    volume=80.0,
                )
            ),
            make_snapshot(
                SnapshotFixture(
                    market_id=3,
                    source="limitless",
                    source_id="general-down",
                    category="General",
                    question="Will it rain?",
                    yes_price=0.30,
                    captured_at=now,
                    volume=50.0,
                )
            ),
            make_snapshot(
                SnapshotFixture(
                    market_id=3,
                    source="limitless",
                    source_id="general-down",
                    category="General",
                    question="Will it rain?",
                    yes_price=0.45,
                    captured_at=now - timedelta(hours=25),
                    volume=50.0,
                )
            ),
        ]
    )
    await test_db.commit()

    # When: positive movers are requested with an excluded category and limit.
    response = await client.get(
        "/api/v1/prediction-markets/movers",
        params={
            "window": "24",
            "direction": "up",
            "exclude_categories": "Economics",
            "limit": "1",
        },
    )

    # Then: down movers and excluded categories are omitted before limiting.
    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 1
    assert payload["movers"][0]["source_id"] == "sports-up-small"
    assert payload["movers"][0]["absolute_movement"] == pytest.approx(0.08)


def test_postgres_conflict_constraint_migration_declares_required_unique_constraints() -> None:
    # Given: the remediation migration module.
    migration_path = (
        Path(__file__).parents[2]
        / "migrations"
        / "versions"
        / "20260701_0900_add_prediction_markets_and_conflict_constraints.py"
    )
    spec = importlib.util.spec_from_file_location("vnibb_conflict_constraints", migration_path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)

    # When: it is loaded.
    spec.loader.exec_module(module)

    # Then: it includes stale-data upsert constraints and future source-agnostic market identity.
    constraints = {
        (constraint.table_name, constraint.name, constraint.columns)
        for constraint in module.REQUIRED_UNIQUE_CONSTRAINTS
    }
    assert (
        "foreign_trading",
        "uq_foreign_trading_symbol_date",
        ("symbol", "trade_date"),
    ) in constraints
    assert ("market_news", "uq_market_news_url", ("url",)) in constraints
    assert (
        "stock_prices",
        "uq_stock_price_symbol_time_interval",
        ("symbol", "time", "interval"),
    ) in constraints
    assert (
        "prediction_markets",
        "uq_prediction_markets_source_id",
        ("source", "source_id"),
    ) in constraints
