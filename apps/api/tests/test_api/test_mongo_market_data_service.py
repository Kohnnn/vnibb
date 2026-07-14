from datetime import date, datetime

import pytest

from vnibb.services.mongo_market_data_service import MongoMarketDataService


class Cursor:
    def __init__(self, rows):
        self.rows = rows
        self.sort_args = None
        self.limit_value = None

    def sort(self, *args):
        self.sort_args = args
        return self

    def limit(self, value):
        self.limit_value = value
        return self

    def __iter__(self):
        return iter(self.rows)


class Collection:
    def __init__(self, rows=None, error=None):
        self.rows = rows or []
        self.error = error
        self.query = None
        self.projection = None
        self.cursor = None

    def find(self, query, projection):
        if self.error:
            raise self.error
        self.query = query
        self.projection = projection
        self.cursor = Cursor(self.rows)
        return self.cursor


@pytest.mark.asyncio
async def test_get_source_latest_trade_date_returns_none_when_disabled():
    service = MongoMarketDataService()
    assert await service.get_source_latest_trade_date("vietcap") is None


@pytest.mark.asyncio
async def test_get_source_latest_trade_date_uses_source_descending_query(monkeypatch):
    collection = Collection([{"tradeDate": datetime(2026, 7, 8, 7)}])
    service = MongoMarketDataService()
    monkeypatch.setattr(MongoMarketDataService, "_get_collection", lambda *_: collection)

    assert await service.get_source_latest_trade_date(" vietcap ") == date(2026, 7, 8)
    assert collection.query == {"source": "vietcap"}
    assert collection.projection == {"_id": 0, "tradeDate": 1}
    assert collection.cursor.sort_args == ("tradeDate", -1)
    assert collection.cursor.limit_value == 1


@pytest.mark.asyncio
async def test_get_source_latest_trade_date_returns_none_on_read_error(monkeypatch):
    service = MongoMarketDataService()
    monkeypatch.setattr(
        MongoMarketDataService,
        "_get_collection",
        lambda *_: (_ for _ in ()).throw(RuntimeError("unavailable")),
    )

    assert await service.get_source_latest_trade_date("vietcap") is None
