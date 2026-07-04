"""Tests for the prediction-market estimators and the Kalshi normaliser."""

import asyncio
import pytest

from vnibb.services.prediction_market_estimator import (
    _extract_threshold,
    _infer_fomc_label,
    _infer_terminal_rate,
    _weighted_percentile,
    category_taxonomy,
)
from vnibb.services.prediction_market_service import category_taxonomy as pm_category_taxonomy


def test_category_taxonomy_canonical_aliases():
    """`category_taxonomy` returns one of the canonical buckets."""
    assert category_taxonomy("Economics") == "economic"
    assert category_taxonomy("Sports") == "sports"
    assert category_taxonomy("Politics") == "politics"
    assert category_taxonomy("US Current Affairs") == "politics"
    assert category_taxonomy("Pop Culture") == "general"
    assert category_taxonomy(None) == "general"
    assert category_taxonomy("") == "general"


def test_pm_and_estimator_taxonomy_agree():
    """Both modules must agree on the bucket mapping."""
    cases = (
        ("Crypto", "general"),
        ("Sports: NBA", "sports"),
        ("Inflation Watch", "economic"),
        ("Geopolitics: China", "politics"),
    )
    for raw, expected in cases:
        assert category_taxonomy(raw) == expected
        assert pm_category_taxonomy(raw) == expected


@pytest.mark.parametrize(
    "question,expected",
    [
        ("Will Core CPI YoY > 3.0%?", 3.0),
        ("Headline inflation above 2.5%?", 2.5),
        ("Headline cpi below 4% by year-end", 4.0),
        ("Will we see a Fed rate cut?", None),
    ],
)
def test_extract_threshold(question: str, expected: float | None):
    assert _extract_threshold(question) == expected


def test_weighted_percentile_interpolation():
    samples = [1.0, 2.0, 3.0, 4.0]
    weights = [1.0, 1.0, 1.0, 1.0]
    assert _weighted_percentile(samples, weights, 0.5) == pytest.approx(2.5, abs=0.001)
    assert _weighted_percentile(samples, [0.0, 0.0, 0.0, 5.0], 0.5) == pytest.approx(4.0, abs=0.001)


def test_terminal_rate_signs():
    """Cut → lower rate, hike → higher rate, hold → baseline 5.0%."""
    cut_bucket = {"cut": 1.0, "hold": 0.0, "hike": 0.0}
    hold_bucket = {"cut": 0.0, "hold": 1.0, "hike": 0.0}
    hike_bucket = {"cut": 0.0, "hold": 0.0, "hike": 1.0}
    assert _infer_terminal_rate(cut_bucket) < 5.0
    assert _infer_terminal_rate(hold_bucket) == 5.0
    assert _infer_terminal_rate(hike_bucket) > 5.0


def test_infer_fomc_label_parses_month_and_year():
    class _M:
        question = "Will the Fed cut rates in July 2026?"
        description = None
        end_date = None

    label = _infer_fomc_label(_M())  # type: ignore[arg-type]
    assert label == "2026-07-15"
