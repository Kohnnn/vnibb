"""Tests for the Phase 10 Manifold ingest service."""

from __future__ import annotations

import pytest

from vnibb.services.manifold_service import (
    ManifoldMarketPayload,
    normalize_manifold_market,
)


def test_manifold_normalizer_drops_resolved_market():
    payload = ManifoldMarketPayload(
        id="abc-1",
        question="Resolved market?",
        is_resolved=True,
        probability=0.5,
    )
    assert normalize_manifold_market(payload) is None


def test_manifold_normalizer_drops_unpriced_market():
    payload = ManifoldMarketPayload(
        id="abc-2",
        question="No probability yet",
        probability=None,
    )
    assert normalize_manifold_market(payload) is None


def test_manifold_normalizer_maps_probability_to_yes_price():
    payload = ManifoldMarketPayload(
        id="abc-3",
        slug="will-it-rain",
        question="Will it rain tomorrow?",
        probability=0.42,
        category="Weather",
    )
    market = normalize_manifold_market(payload)
    assert market is not None
    assert market.source == "manifold"
    assert market.outcome_prices[0] == pytest.approx(0.42, abs=0.001)
    assert market.outcome_prices[1] == pytest.approx(0.58, abs=0.001)
    assert market.url is not None and "will-it-rain" in market.url