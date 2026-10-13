from datetime import date, datetime
from unittest.mock import AsyncMock

import pandas as pd
import pytest

from vnibb.services.trading_acquisition import acquire_session_trades, persist_trade_stores


def test_paginated_session_above_tail_limit_preserves_whole_session():
    rows = [{"id": str(i), "time": datetime(2026, 10, 13, 9, 0) + pd.Timedelta(seconds=i), "price": 10000, "volume": 1, "match_type": "BU"} for i in range(601)]
    calls = []
    def fetch(page_size=100, last_time=None):
        calls.append((page_size, last_time))
        frame = pd.DataFrame(rows[-page_size:])
        frame.attrs["complete_session"] = True
        return frame
    observed, coverage = acquire_session_trades(fetch, date(2026, 10, 13), 500, session_closed=True)
    assert len(observed) == 601
    assert coverage["scope"] == "full_session"
    assert coverage["observed_trade_count"] == 601
    assert coverage["denominator_trade_count"] == 601
    assert [call[0] for call in calls] == [500, 1000]


def test_exhausted_upstream_retained_window_is_still_sampled():
    def fetch(page_size=500):
        return pd.DataFrame([{"time": datetime(2026, 10, 13, 14, 0), "price": 10000, "volume": 1}])
    observed, coverage = acquire_session_trades(fetch, date(2026, 10, 13), 500, session_closed=True)
    assert len(observed) == 1
    assert coverage["provider_exhausted"] is True
    assert coverage["scope"] == "sampled"
    assert coverage["denominator_trade_count"] is None


def test_tail_only_provider_does_not_fabricate_session_denominator():
    def fetch():
        return pd.DataFrame([{"time": datetime(2026, 10, 13, 14, 0), "price": 10000, "volume": 1}] * 601)
    observed, coverage = acquire_session_trades(fetch, date(2026, 10, 13), 500, session_closed=True)
    assert len(observed) == 500
    assert coverage["scope"] == "sampled"
    assert coverage["denominator_trade_count"] is None
    assert coverage["session_fraction"] is None


def test_recent_acquisition_cannot_relabel_old_session():
    def fetch(page_size=100, last_time=None):
        return pd.DataFrame([{"time": datetime(2026, 10, 12, 14, 0), "price": 10000, "volume": 1}])
    observed, coverage = acquire_session_trades(fetch, date(2026, 10, 13), 500, session_closed=True)
    assert observed == []
    assert coverage["scope"] == "unknown"
    assert coverage["session_date"] == "2026-10-12"
    assert not coverage["completed_session"]


@pytest.mark.asyncio
@pytest.mark.parametrize("failed", ["sql_ticks", "mongo_ticks"])
async def test_store_failure_does_not_skip_independent_store(failed):
    writers = {"sql_ticks": AsyncMock(return_value=2), "mongo_ticks": AsyncMock(return_value=2)}
    writers[failed].side_effect = RuntimeError("store unavailable")
    outcomes = await persist_trade_stores(writers)
    assert outcomes[failed]["status"] == "failed"
    other = "mongo_ticks" if failed == "sql_ticks" else "sql_ticks"
    assert outcomes[other]["status"] == "persisted"
    writers[other].assert_awaited_once()


@pytest.mark.asyncio
async def test_both_store_failures_remain_independent_failures():
    outcomes = await persist_trade_stores({"sql_ticks": AsyncMock(side_effect=RuntimeError("sql")), "mongo_ticks": AsyncMock(side_effect=RuntimeError("mongo"))})
    assert {key: value["status"] for key, value in outcomes.items()} == {"sql_ticks": "failed", "mongo_ticks": "failed"}
