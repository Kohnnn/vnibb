"""Tests for the election topic filter and the snapshot backfill."""

from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from vnibb.services.prediction_market_service import (
    canonical_topics,
    category_taxonomy,
)
from vnibb.services.prediction_market_snapshot_service import (
    backfill_prediction_market_snapshots,
    snapshot_row_count,
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


@pytest.mark.asyncio
async def test_snapshot_row_count_returns_int():
    """snapshot_row_count returns 0 when the table is empty (no exceptions)."""

    class _Result:
        def scalar(self):
            return 0

    session = SimpleNamespace(execute=AsyncExecute(_Result()))
    assert await snapshot_row_count(session) == 0


class AsyncExecute:
    def __init__(self, result):
        self._result = result

    async def __call__(self, *_args, **_kwargs):
        return self._result


@pytest.mark.asyncio
async def test_backfill_writes_expected_row_count(monkeypatch):
    """Backfill writes ``days * snapshots_per_day`` rows per active market."""
    now = datetime.now(timezone.utc)

    # Pin the drift sign so the series deterministically contains both an
    # upward and a downward snapshot. Otherwise the unseeded random.choice
    # can (1/64) push every sample the same direction and flake the
    # min < current <= max assertion below.
    import vnibb.services.prediction_market_snapshot_service as snapshot_service

    signs = iter([-1.0, 1.0] * 32)
    monkeypatch.setattr(
        snapshot_service.random, "choice", lambda _seq: next(signs)
    )

    market = SimpleNamespace(
        id=1,
        source="polymarket",
        source_id="p-1",
        category="economic",
        question="Will CPI exceed 3.0%?",
        url=None,
        outcome_prices=[0.4],
        volume=1000,
        liquidity=500,
        outcomes=["Yes", "No"],
        active=True,
    )

    class _Session:
        def __init__(self):
            self.added = []

        async def execute(self, _stmt):
            return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: [market]))

        def add_all(self, rows):
            self.added.extend(rows)

        async def commit(self):
            return None

    session = _Session()
    written = await backfill_prediction_market_snapshots(
        session, days=3, snapshots_per_day=2
    )
    assert written == 6  # 3 days * 2 snapshots per day * 1 market
    assert all(row.extra.get("backfill") is True for row in session.added)
    # Older rows should not equal the current price (drift applied).
    prices = [row.yes_price for row in session.added]
    assert min(prices) < 0.4 <= max(prices)