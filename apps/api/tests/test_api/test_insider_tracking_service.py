from __future__ import annotations

from datetime import datetime

import pytest

from vnibb.services.insider_tracking import InsiderTrackingService
from fastapi import HTTPException

from vnibb.api.v1.insider import get_block_trades



class _FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def mappings(self):
        return self

    def all(self):
        return self._rows


class _FakeBlockTradeSession:
    def __init__(self):
        self.execute_count = 0
        self.rollback_count = 0

    async def execute(self, _stmt):
        self.execute_count += 1
        if self.execute_count == 1:
            raise RuntimeError("column block_trades.side does not exist")
        return _FakeResult(
            [
                {
                    "id": 42,
                    "symbol": "VCI",
                    "quantity": 100_000,
                    "price": 32_000.0,
                    "value": 3_200_000_000.0,
                    "trade_time": datetime(2026, 5, 18, 9, 30),
                }
            ]
        )

    async def rollback(self):
        self.rollback_count += 1


@pytest.mark.asyncio
async def test_recent_block_trades_falls_back_for_legacy_schema():
    db = _FakeBlockTradeSession()
    service = InsiderTrackingService(db)  # type: ignore[arg-type]

    rows = await service.get_recent_block_trades(symbol="VCI", limit=50)

    assert db.execute_count == 2
    assert db.rollback_count == 1
    assert rows == [
        {
            "id": 42,
            "symbol": "VCI",
            "quantity": 100_000,
            "price": 32_000.0,
            "value": 3_200_000_000.0,
            "trade_time": datetime(2026, 5, 18, 9, 30),
            "side": None,
            "volume_ratio": None,
            "is_foreign": False,
            "is_proprietary": False,
        }
    ]

@pytest.mark.asyncio
async def test_block_trade_query_failure_is_not_an_empty_tape():
    class FailedSession:
        async def execute(self, _stmt):
            raise RuntimeError("provider unavailable")

        async def rollback(self):
            pass

    with pytest.raises(RuntimeError, match="provider unavailable"):
        await InsiderTrackingService(FailedSession()).get_recent_block_trades()  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_block_trade_endpoint_distinguishes_failure_from_real_empty(monkeypatch):
    class Service:
        def __init__(self, _db):
            pass

        async def get_recent_block_trades(self, symbol, limit):
            if symbol == "FAIL":
                raise RuntimeError("provider private failure")
            return []

    monkeypatch.setattr("vnibb.api.v1.insider.InsiderTrackingService", Service)
    assert await get_block_trades(symbol="EMPTY", limit=100, db=None) == []
    with pytest.raises(HTTPException) as exc:
        await get_block_trades(symbol="FAIL", limit=100, db=None)
    assert exc.value.status_code == 503
    assert exc.value.detail == "Block-trade data unavailable"
