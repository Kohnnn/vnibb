from __future__ import annotations

from datetime import date, timedelta
from types import SimpleNamespace

import pytest

from vnibb.services import rs_rating_service
from vnibb.services.rs_rating_service import RSRatingService


class _ScalarResult:
    def __init__(self, value=None):
        self._value = value

    def scalar(self):
        return self._value

    def scalars(self):
        return self

    def all(self):
        return []


class _DummyDB:
    async def execute(self, _statement):
        return _ScalarResult(None)


class _DummyContext:
    def __init__(self, db):
        self._db = db

    async def __aenter__(self):
        return self._db

    async def __aexit__(self, exc_type, exc, tb):
        return False


@pytest.mark.asyncio
async def test_get_rs_leaders_falls_back_to_live_rankings_when_snapshots_missing(monkeypatch):
    dummy_db = _DummyDB()

    async def fake_build_live_rankings(self, db, calculation_date=None):
        assert db is dummy_db
        return [
            {
                "symbol": "FPT",
                "company_name": "FPT",
                "rs_rating": 99,
                "rs_rank": 1,
                "price": 120000.0,
                "industry": "Technology",
                "sector": "Technology",
            },
            {
                "symbol": "VNM",
                "company_name": "Vinamilk",
                "rs_rating": 84,
                "rs_rank": 2,
                "price": 63100.0,
                "industry": "Food",
                "sector": "Food",
            },
        ]

    monkeypatch.setattr(rs_rating_service, "get_db_context", lambda: _DummyContext(dummy_db))
    monkeypatch.setattr(RSRatingService, "_build_live_rankings", fake_build_live_rankings)

    leaders = await RSRatingService().get_rs_leaders(limit=1)

    assert leaders == [
        {
            "symbol": "FPT",
            "company_name": "FPT",
            "rs_rating": 99,
            "rs_rank": 1,
            "price": 120000.0,
            "industry": "Technology",
        }
    ]


@pytest.mark.asyncio
async def test_get_market_returns_falls_back_to_provider_history(monkeypatch):
    service = RSRatingService()
    dummy_db = _DummyDB()
    provider_rows = [
        SimpleNamespace(time=date(2025, 3, 1) + timedelta(days=index), close=1000.0 + index)
        for index in range(260)
    ]
    fetch_calls = 0

    async def fake_fetch(params):
        nonlocal fetch_calls
        fetch_calls += 1
        assert params.symbol == "VNINDEX"
        return provider_rows

    monkeypatch.setattr(
        rs_rating_service.VnstockEquityHistoricalFetcher,
        "fetch",
        fake_fetch,
    )

    returns = await service._get_market_returns(dummy_db, date(2026, 3, 15))

    assert fetch_calls == 1
    assert returns is not None
    assert set(returns.keys()) == {"3mo", "6mo", "9mo", "12mo"}
