"""Tests for the Kalshi ingestion normaliser."""

import pytest

from vnibb.services.kalshi_service import KalshiMarketPayload, normalize_kalshi_market


@pytest.fixture
def sample_payload():
    return KalshiMarketPayload(
        ticker="KXINFLATION-26",
        event_ticker="KXINFLATION",
        title="Will Core CPI YoY > 3.0% by Dec 2026?",
        subtitle="Trimmed mean CPI for the trailing 12 months.",
        category="economics",
        tags=["cpi"],
        status="open",
        yes_bid=61.0,
        yes_ask=63.0,
        last_price=62.0,
        volume=12500,
        open_interest=5400,
        close_time=None,
    )


def test_normalize_kalshi_market_converts_price_to_probability(sample_payload):
    market = normalize_kalshi_market(sample_payload)
    assert market.source == "kalshi"
    assert market.source_id == "KXINFLATION-26"
    assert market.outcomes == ("Yes", "No")
    assert market.outcome_prices[0] == pytest.approx(0.62, abs=0.001)
    assert market.outcome_prices[1] == pytest.approx(0.38, abs=0.001)
    assert market.category == "economic"
    assert market.active is True
    assert market.url is not None and "kalshi.com" in market.url


def test_normalize_kalshi_handles_missing_yes_price():
    payload = KalshiMarketPayload(
        ticker="KXRECESSION-26",
        event_ticker="KXRECESSION",
        title="Will the US enter recession in 2026?",
        subtitle=None,
        category="economics",
        tags=["recession"],
        status="open",
        yes_bid=None,
        yes_ask=None,
        last_price=None,
        volume=None,
        open_interest=None,
        close_time=None,
    )
    market = normalize_kalshi_market(payload)
    assert market.outcome_prices[0] == 0.0
    assert market.outcome_prices[1] == 0.0
