"""Consumer contracts shared by SQLite and the migrated PostgreSQL test database."""

from datetime import UTC, datetime, timedelta

import httpx
import pytest
from vnibb.models.prediction_market import PredictionMarket


@pytest.mark.postgres_contract
@pytest.mark.asyncio
@pytest.mark.parametrize(
    "topic,positive_rows,negative_rows,consensus,source_consensus,source_counts",
    [
        (
            "cpi",
            [
                ("cpi", "polymarket", "CPI above 3%?", None, 0.2, 1),
                ("cpi-u", "kalshi", "Will CPI-U exceed 3%?", None, 0.4, 3),
                ("headline-inflation", "manifold", "Headline inflation below 3%?", None, 0.6, 2),
                ("description", "polymarket", "Will the threshold be met?", "Official INFLATION release.", 0.8, 3),
            ],
            [
                ("KXUSLGAME-26OCT30LFCPIT-LFC", "kalshi", "Louisville City wins", "KXUSLGAME-26OCT30LFCPIT"),
                ("KXUSLGAME-26OCT30LFCPIT-PIT", "kalshi", "Pittsburgh wins", "KXUSLGAME-26OCT30LFCPIT"),
                ("KXUSLGAME-26OCT30LFCPIT-TIE", "kalshi", "Tie is the result", "KXUSLGAME-26OCT30LFCPIT"),
                ("6Ap6u9RN0E", "manifold", "Will the NFL officially announce the 2027 Super Bowl halftime show headliner before the end of October 2026?", None),
                ("headline", "polymarket", "Will the band headline the festival?", None),
                ("slug-only", "kalshi", "Will the threshold be met?", "will-cpi-rise"),
                ("embedded", "polymarket", "Will SCPI win the game?", None),
            ],
            0.5,
            {"polymarket": 0.65, "kalshi": 0.4, "manifold": 0.6},
            {"polymarket": 2, "kalshi": 1, "manifold": 1},
        ),
        (
            "fed",
            [
                ("reserve", "polymarket", "Will the Federal Reserve lower rates?", None, 0.2, 1),
                ("fomc", "kalshi", "FOMC decision in December?", None, 0.4, 1),
                ("rate-cut", "polymarket", "A rate-cut in December?", None, 0.6, 3),
                ("rate-hike", "kalshi", "A rate-hike in December?", None, 0.8, 3),
                ("fed", "manifold", "Fed-decision before December?", None, 0.5, 1),
            ],
            [
                ("KXSERIEAGOAL-26OCT25INTFIO-INTFDIMAR32-1", "kalshi", "Federico Dimarco: 1+ goals", None),
                ("KXLIGAMXGOAL-26OCT24LEOTOL-TOLNCASTR8-1", "kalshi", "Nicolas Federico Castro: 1+ goals", None),
                ("AEdlgNRzL5", "manifold", "Will hemp-derived CBN sleep products still be federally legal as ‘hemp’ on Nov 12, 2026?", None),
                ("federal", "polymarket", "Will federal hemp legislation pass?", None),
                ("phrase-boundary", "polymarket", "Will the birthrate cutback continue?", None),
                ("slug-only", "kalshi", "Will the threshold be met?", "federal-reserve-rate-cut"),
            ],
            0.5,
            {"polymarket": 0.5, "kalshi": 0.7, "manifold": 0.5},
            {"polymarket": 2, "kalshi": 2, "manifold": 1},
        ),
    ],
    ids=["cpi-token-boundaries", "fed-phrase-boundaries"],
)
async def test_macro_topic_admission_and_consensus_inputs(
    client, test_db, monkeypatch, topic, positive_rows, negative_rows, consensus, source_consensus, source_counts
):
    async def no_provider(*args, **kwargs):
        raise AssertionError("Macro topic reads must not acquire provider data")

    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", no_provider)
    now = datetime.now(UTC).replace(tzinfo=None)
    markets = []
    for index, (source_id, source, question, description, price, volume) in enumerate(positive_rows):
        markets.append(PredictionMarket(
            source=source,
            source_id=source_id,
            question=question,
            description=description,
            active=True,
            closed=False,
            is_synthetic=False,
            outcome_prices=[price, 1 - price],
            volume=volume,
            extra={"canonical_topics": ["sports", "macro"]},
            updated_at=now - timedelta(minutes=1, seconds=index),
        ))
    for index, (source_id, source, question, slug) in enumerate(negative_rows):
        markets.append(PredictionMarket(
            source=source,
            source_id=source_id,
            question=question,
            slug=slug,
            active=True,
            closed=False,
            is_synthetic=False,
            outcome_prices=[0.99, 0.01],
            volume=100,
            extra={"canonical_topics": ["sports", "macro"]},
            updated_at=now - timedelta(seconds=index),
        ))
    test_db.add_all(markets)
    await test_db.flush()

    calibration = await client.get(
        "/api/v1/prediction-markets/calibration", params={"topic": topic, "limit": 100}
    )
    assert calibration.status_code == 200
    payload = calibration.json()
    assert [row["source_id"] for row in payload["markets"]] == [row[0] for row in positive_rows]
    assert payload["n_markets"] == len(positive_rows)
    assert payload["consensus_yes_price"] == pytest.approx(consensus)

    limited = await client.get(
        "/api/v1/prediction-markets/calibration", params={"topic": topic, "limit": 2}
    )
    assert limited.status_code == 200
    assert [row["source_id"] for row in limited.json()["markets"]] == [row[0] for row in positive_rows[:2]]
    assert limited.json()["n_markets"] == 2
    assert limited.json()["consensus_yes_price"] == pytest.approx(0.3)

    spread = await client.get("/api/v1/prediction-markets/spread", params={"window": 24})
    assert spread.status_code == 200
    spread_topic = next(row for row in spread.json()["topics"] if row["topic"] == topic)
    assert spread_topic["polymarket_consensus"] == pytest.approx(source_consensus["polymarket"])
    assert spread_topic["kalshi_consensus"] == pytest.approx(source_consensus["kalshi"])

    cross = await client.get("/api/v1/prediction-markets/cross-calibration")
    assert cross.status_code == 200
    cross_topic = next(row for row in cross.json()["topics"] if row["topic"] == topic)
    assert {row["source"]: row["n_markets"] for row in cross_topic["sources"]} == source_counts
    assert {row["source"]: row["consensus_yes_price"] for row in cross_topic["sources"]} == pytest.approx(source_consensus)
