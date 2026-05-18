from __future__ import annotations

from datetime import datetime

import pytest

from vnibb.services.insider_tracking import InsiderTrackingService


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
