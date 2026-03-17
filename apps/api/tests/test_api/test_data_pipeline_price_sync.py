import sys
import types
from datetime import date

import pandas as pd
import pytest

import vnibb.services.data_pipeline as data_pipeline_module
from vnibb.services.appwrite_price_service import AppwritePriceService
from vnibb.services.data_pipeline import DataPipeline


class FakeResult:
    def __init__(self, *, scalar_value=None, rows=None):
        self._scalar_value = scalar_value
        self._rows = rows or []

    def scalar(self):
        return self._scalar_value

    def fetchall(self):
        return self._rows


class FakeSession:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def execute(self, stmt, params=None):
        sql = str(stmt)
        if "SELECT" in sql and "FROM stocks" in sql:
            return FakeResult(scalar_value=1)
        return FakeResult()

    async def commit(self):
        return None


@pytest.mark.asyncio
async def test_fetch_quote_history_frame_bypasses_vnstock_retry_wrapper(monkeypatch):
    class FakeQuote:
        def history(self, **kwargs):
            raise AssertionError("wrapped vnstock retry path should be bypassed")

    def fake_unwrapped_history(self, **kwargs):
        return {"path": "unwrapped", "kwargs": kwargs}

    FakeQuote.history.__wrapped__ = fake_unwrapped_history

    class FakeStock:
        def __init__(self):
            self.quote = FakeQuote()

    class FakeVnstock:
        def stock(self, symbol, source):
            assert symbol == "VNM"
            assert source
            return FakeStock()

    fake_module = types.ModuleType("vnstock")
    fake_module.Vnstock = FakeVnstock
    monkeypatch.setitem(sys.modules, "vnstock", fake_module)

    pipeline = DataPipeline()
    result = await pipeline._fetch_quote_history_frame(
        symbol="VNM",
        start="2026-03-01",
        end="2026-03-17",
        bypass_internal_retry=True,
    )

    assert result == {
        "path": "unwrapped",
        "kwargs": {
            "start": "2026-03-01",
            "end": "2026-03-17",
            "interval": "1D",
        },
    }


def test_describe_provider_exception_includes_retry_root_cause():
    class FakeAttempt:
        def exception(self):
            return ValueError("bad upstream payload")

    class FakeRetryError(Exception):
        def __init__(self):
            super().__init__("RetryError[history failed]")
            self.last_attempt = FakeAttempt()

    details = DataPipeline._describe_provider_exception(FakeRetryError())

    assert "FakeRetryError: RetryError[history failed]" in details
    assert "ValueError: bad upstream payload" in details


@pytest.mark.asyncio
async def test_sync_daily_prices_uses_fast_fail_history_fetch(monkeypatch):
    pipeline = DataPipeline()
    frame = pd.DataFrame(
        [
            {
                "time": pd.Timestamp("2026-03-17"),
                "open": 100.0,
                "high": 101.0,
                "low": 99.0,
                "close": 100.5,
                "volume": 12345,
            }
        ]
    )
    fetch_calls = []

    async def fake_wait_for_rate_limit(bucket):
        assert bucket == "prices"

    async def fake_cache_set_json(key, value, ttl, force=False):
        return None

    async def fake_fetch_quote_history_frame(
        symbol,
        start,
        end,
        interval="1D",
        bypass_internal_retry=False,
    ):
        fetch_calls.append((symbol, start, end, interval, bypass_internal_retry))
        return frame

    monkeypatch.setattr(pipeline, "_wait_for_rate_limit", fake_wait_for_rate_limit)
    monkeypatch.setattr(pipeline, "_cache_set_json", fake_cache_set_json)
    monkeypatch.setattr(pipeline, "_fetch_quote_history_frame", fake_fetch_quote_history_frame)
    monkeypatch.setattr(data_pipeline_module, "async_session_maker", lambda: FakeSession())

    total = await pipeline.sync_daily_prices(
        symbols=["VNM"],
        start_date=date(2026, 3, 16),
        end_date=date(2026, 3, 17),
        cache_recent=False,
    )

    assert total == 1
    assert fetch_calls == [("VNM", "2026-03-16", "2026-03-17", "1D", True)]


@pytest.mark.asyncio
async def test_appwrite_price_service_syncs_provider_rows(monkeypatch):
    service = AppwritePriceService(source="KBS")
    captured = {}

    async def fake_resolve_symbols(symbols=None, max_symbols=None):
        return ["VNM"]

    async def fake_get_appwrite_stock_id(symbol):
        assert symbol == "VNM"
        return "84"

    async def fake_resolve_ranges(symbol, start_date, end_date, *, fill_missing_gaps):
        assert symbol == "VNM"
        assert fill_missing_gaps is True
        return [(start_date, end_date)]

    async def fake_fetch_rows(symbol, start_date, end_date):
        assert symbol == "VNM"
        return [
            {
                "id": "VNM:2019-01-02T17:00:00.000Z:1D",
                "symbol": "VNM",
                "time": "2019-01-02T17:00:00.000Z",
                "open": 100.0,
                "high": 101.0,
                "low": 99.0,
                "close": 100.5,
                "volume": 12345,
                "interval": "1D",
                "source": "vnstock",
                "created_at": "2026-03-17T00:00:00.000Z",
            }
        ]

    async def fake_upsert_rows(rows, *, appwrite_concurrency, appwrite_batch_size):
        captured["rows"] = rows
        captured["appwrite_concurrency"] = appwrite_concurrency
        captured["appwrite_batch_size"] = appwrite_batch_size
        return {"created": 1, "updated": 0, "failed": 0}

    async def fake_refresh_cache(symbol, end_date):
        captured["cache"] = (symbol, end_date.isoformat())

    monkeypatch.setattr(service, "_resolve_symbols", fake_resolve_symbols)
    monkeypatch.setattr(service, "_get_appwrite_stock_id", fake_get_appwrite_stock_id)
    monkeypatch.setattr(service, "_resolve_provider_fetch_ranges", fake_resolve_ranges)
    monkeypatch.setattr(service, "_fetch_provider_rows", fake_fetch_rows)
    monkeypatch.setattr(service, "_upsert_rows", fake_upsert_rows)
    monkeypatch.setattr(service, "_refresh_symbol_price_cache", fake_refresh_cache)

    stats = await service.sync_prices_from_provider(
        start_date=date(2019, 1, 1),
        end_date=date(2019, 1, 2),
        fill_missing_gaps=True,
        cache_recent=True,
        symbol_concurrency=1,
        appwrite_concurrency=4,
        appwrite_batch_size=120,
    )

    assert stats.symbols_requested == 1
    assert stats.symbols_processed == 1
    assert stats.rows_created == 1
    assert stats.rows_updated == 0
    assert stats.rows_failed == 0
    assert captured["rows"][0]["stock_id"] == "84"
    assert captured["appwrite_concurrency"] == 4
    assert captured["appwrite_batch_size"] == 120
    assert captured["cache"] == ("VNM", "2019-01-02")
