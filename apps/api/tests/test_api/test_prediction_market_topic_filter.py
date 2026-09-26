"""Tests for prediction-market topic tagging."""

from __future__ import annotations


import pytest
from vnibb.services.prediction_market_service import (
    canonical_topics,
)


@pytest.mark.parametrize(
    "question,expected_topics",
    [
        ("Will Donald Trump win the 2028 election?", ["election"]),
        ("Will the Fed cut rates in 2026?", ["macro"]),
        ("Will Argentina win the 2026 FIFA World Cup?", ["sports"]),
        ("Will Bitcoin hit $1m before GTA VI?", ["crypto"]),
        ("Will Apple release the iPhone 17?", []),
    ],
)
def test_canonical_topics(question, expected_topics):
    topics = canonical_topics(question)
    for topic in expected_topics:
        assert topic in topics


def test_canonical_topics_includes_explicit_categories():
    topics = canonical_topics("Will Republicans win the 2026 midterm?", category="Politics")
    assert "election" in topics


