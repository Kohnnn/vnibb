import sys
import types
from datetime import date

import pandas as pd
import pytest

import vnibb.services.data_pipeline as data_pipeline_module
from vnibb.core.config import settings
from vnibb.providers.vnstock.price_board import PriceBoardData
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
async def test_fetch_quote_history_frame_uses_premium_quote_and_bypasses_retry(monkeypatch):
    # Premium vnstock_data v3 exposes Quote(symbol=, source=).history() directly
    # and has NO Vnstock wrapper; the sync must route through Quote, not the
    # dead free vnstock.Vnstock().stock() path that froze stock_prices.
    captured = {}

    class FakeQuote:
        def __init__(self, symbol, source):
            captured["symbol"] = symbol
            captured["source"] = source

        def history(self, **kwargs):
            raise AssertionError("wrapped vnstock retry path should be bypassed")

    def fake_unwrapped_history(self, **kwargs):
        return {"path": "unwrapped", "kwargs": kwargs}

    FakeQuote.history.__wrapped__ = fake_unwrapped_history

    fake_vnstock_data = types.ModuleType("vnstock_data")
    fake_vnstock_data.Quote = FakeQuote
    monkeypatch.setitem(sys.modules, "vnstock_data", fake_vnstock_data)

    pipeline = DataPipeline()
    result = await pipeline._fetch_quote_history_frame(
        symbol="VNM",
        start="2026-03-01",
        end="2026-03-17",
        bypass_internal_retry=True,
    )

    assert captured == {"symbol": "VNM", "source": (settings.vnstock_source or "KBS").upper()}
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
async def test_sync_foreign_trading_persists_derived_values(monkeypatch):
    pipeline = DataPipeline()
    statements = []

    class CapturingSession(FakeSession):
        async def execute(self, stmt, params=None):
            statements.append(stmt)
            return FakeResult()

    async def fake_fetch(symbols, source):
        assert symbols == ["VNM", "FPT"]
        return [
            PriceBoardData(
                symbol="VNM",
                foreign_buy_vol=100,
                foreign_sell_vol=40,
                foreign_buy_value=1_500.0,
                foreign_sell_value=600.0,
            ),
            PriceBoardData(
                symbol="FPT",
                foreign_buy_vol=80,
                foreign_sell_vol=20,
                foreign_buy_value=900.0,
            ),
        ]

    async def fake_wait_for_rate_limit(bucket):
        assert bucket == "price_board"

    monkeypatch.setattr(
        "vnibb.providers.vnstock.price_board.VnstockPriceBoardFetcher.fetch",
        fake_fetch,
    )
    monkeypatch.setattr(pipeline, "_wait_for_rate_limit", fake_wait_for_rate_limit)
    monkeypatch.setattr(data_pipeline_module, "async_session_maker", lambda: CapturingSession())
    monkeypatch.setattr(settings, "cache_foreign_trading_chunked", False)

    count = await pipeline.sync_foreign_trading(
        trade_date=date(2026, 3, 17),
        symbols=["VNM", "FPT"],
    )

    compiled = [statement.compile().params for statement in statements]
    vnm = next(values for values in compiled if values.get("symbol") == "VNM")
    fpt = next(values for values in compiled if values.get("symbol") == "FPT")
    assert count == 2
    assert vnm["buy_value"] == 1_500.0
    assert vnm["sell_value"] == 600.0
    assert vnm["net_value"] == 900.0
    assert vnm["net_volume"] == 60
    assert fpt["net_value"] is None

