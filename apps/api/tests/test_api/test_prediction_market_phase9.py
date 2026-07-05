"""Tests for the Phase 9 prediction-market ingest services.

Coverage:
  * PredictIt normaliser handles missing prices (drops the row)
  * Limitless normaliser derives No price when Yes is provided
  * Limitless normaliser drops markets without a Yes price
"""

from __future__ import annotations

from datetime import datetime

import pytest

from vnibb.services.limitless_service import (
    LimitlessMarketPayload,
    LimitlessPrices,
    normalize_limitless_market,
)
from vnibb.services.predictit_service import (
    PredictItContractPayload,
    PredictItMarketPayload,
    normalize_predictit_market,
)


def test_predictit_normalizer_drops_market_without_priced_contracts():
    payload = PredictItMarketPayload(
        id=1,
        name="Will X happen?",
        contracts=[],
    )
    assert normalize_predictit_market(payload) is None


def test_predictit_normalizer_averages_contracts():
    payload = PredictItMarketPayload(
        id=42,
        name="Will it rain in DC tomorrow?",
        contracts=[
            PredictItContractPayload(id=101, name="Rain 1+ inch", latest_yes_price=0.30),
            PredictItContractPayload(id=102, name="Rain < 1 inch", latest_yes_price=0.55),
        ],
    )
    market = normalize_predictit_market(payload)
    assert market is not None
    assert market.source == "predictit"
    assert market.source_id == "42"
    assert market.category in ("general", "politics", "sports", "economic")
    assert market.outcome_prices[0] == pytest.approx((0.30 + 0.55) / 2, abs=0.001)
    assert market.outcome_prices[1] == pytest.approx(1.0 - (0.30 + 0.55) / 2, abs=0.001)


def test_limitless_normalizer_derives_no_price():
    payload = LimitlessMarketPayload(
        id=7,
        title="BTC > 100k by year-end",
        slug="btc-100k",
        prices=LimitlessPrices(yes=0.65, no=None),
    )
    market = normalize_limitless_market(payload)
    assert market is not None
    assert market.source == "limitless"
    assert market.outcome_prices[0] == 0.65
    assert market.outcome_prices[1] == pytest.approx(0.35, abs=0.001)
    assert market.url is not None and "limitless.exchange" in market.url


def test_limitless_normalizer_drops_unpriced_market():
    payload = LimitlessMarketPayload(
        id=8,
        title="Newly listed market without a Yes price yet",
        prices=LimitlessPrices(yes=None, no=None),
    )
    assert normalize_limitless_market(payload) is None


def test_limitless_normalizer_uses_url_when_present():
    payload = LimitlessMarketPayload(
        id=9,
        title="ETH close > $5000",
        url="https://example.com/markets/9",
        prices=LimitlessPrices(yes=0.45, no=0.55),
    )
    market = normalize_limitless_market(payload)
    assert market is not None
    assert market.url == "https://example.com/markets/9"