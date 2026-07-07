"""Unit tests for the daily-freshness remediation (2026-06-09).

Covers the new canonical-Mongo wiring:
- mongo_eod_sync frame normalization + run loop (mocked fetcher/service)
- MongoMarketDataService.bulk_upsert_eod_prices document shape (mocked pymongo)
- market.py screener-universe staleness helpers
"""

from datetime import date, datetime

import pandas as pd
import pytest

from vnibb.api.v1.market import (
    _coerce_to_date,
    _expected_latest_trading_day,
    _freshest_snapshot_date,
)
from vnibb.services import mongo_eod_sync


# ---------------------------------------------------------------------------
# mongo_eod_sync frame normalization
# ---------------------------------------------------------------------------
def test_frame_to_rows_normalizes_and_skips_bad_dates():
    frame = pd.DataFrame(
        [
            {"time": "2026-06-05", "open": 1.0, "high": 2.0, "low": 0.5, "close": 1.5, "volume": 100, "value": 150.0},
            {"time": None, "open": 1, "high": 1, "low": 1, "close": 1, "volume": 1},  # dropped: no date
        ]
    )
    rows = mongo_eod_sync._frame_to_rows(frame)
    assert len(rows) == 1
    row = rows[0]
    assert isinstance(row["tradeDate"], datetime)
    assert row["tradeDate"].date() == date(2026, 6, 5)
    assert row["close"] == 1.5
    assert row["volume"] == 100
    assert row["value"] == 150.0


def test_frame_to_rows_handles_empty_and_none():
    assert mongo_eod_sync._frame_to_rows(None) == []
    assert mongo_eod_sync._frame_to_rows(pd.DataFrame()) == []


def test_coerce_float_rejects_nan():
    assert mongo_eod_sync._coerce_float(float("nan")) is None
    assert mongo_eod_sync._coerce_float("abc") is None
    assert mongo_eod_sync._coerce_float("3.5") == 3.5


@pytest.mark.asyncio
async def test_run_mongo_eod_sync_disabled_service(monkeypatch):
    class DisabledService:
        enabled = False

    monkeypatch.setattr(
        mongo_eod_sync, "get_mongo_market_data_service", lambda: DisabledService()
    )
    result = await mongo_eod_sync.run_mongo_eod_sync()
    assert result == {"symbols": 0, "rows": 0, "failures": 0}


@pytest.mark.asyncio
async def test_run_mongo_eod_sync_writes_explicit_symbols(monkeypatch):
    written: dict[str, int] = {}

    class FakeService:
        enabled = True

        async def bulk_upsert_eod_prices(self, symbol, rows):
            written[symbol] = len(rows)
            return len(rows)

    monkeypatch.setattr(
        mongo_eod_sync, "get_mongo_market_data_service", lambda: FakeService()
    )

    async def fake_wait(bucket):
        return None

    async def fake_fetch(*, symbol, start, end, interval, bypass_internal_retry):
        return pd.DataFrame(
            [{"time": "2026-06-05", "open": 1, "high": 2, "low": 1, "close": 1.5, "volume": 10, "value": 15}]
        )

    monkeypatch.setattr(mongo_eod_sync.data_pipeline, "_wait_for_rate_limit", fake_wait)
    monkeypatch.setattr(mongo_eod_sync.data_pipeline, "_fetch_quote_history_frame", fake_fetch)

    result = await mongo_eod_sync.run_mongo_eod_sync(symbols=["vci", "ssi"], window_days=5)
    assert result["symbols"] == 2
    assert result["rows"] == 2
    assert result["failures"] == 0
    assert written == {"VCI": 1, "SSI": 1}


@pytest.mark.asyncio
async def test_run_mongo_eod_sync_isolates_symbol_failures(monkeypatch):
    class FakeService:
        enabled = True

        async def bulk_upsert_eod_prices(self, symbol, rows):
            return len(rows)

    monkeypatch.setattr(
        mongo_eod_sync, "get_mongo_market_data_service", lambda: FakeService()
    )

    async def fake_wait(bucket):
        return None

    async def fake_fetch(*, symbol, start, end, interval, bypass_internal_retry):
        if symbol == "BAD":
            raise RuntimeError("provider down")
        return pd.DataFrame(
            [{"time": "2026-06-05", "open": 1, "high": 2, "low": 1, "close": 1.5, "volume": 10}]
        )

    monkeypatch.setattr(mongo_eod_sync.data_pipeline, "_wait_for_rate_limit", fake_wait)
    monkeypatch.setattr(mongo_eod_sync.data_pipeline, "_fetch_quote_history_frame", fake_fetch)

    result = await mongo_eod_sync.run_mongo_eod_sync(symbols=["GOOD", "BAD"], window_days=5)
    assert result["symbols"] == 1
    assert result["failures"] == 1


# ---------------------------------------------------------------------------
# MongoMarketDataService.bulk_upsert_eod_prices document shape
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_bulk_upsert_eod_prices_builds_idempotent_ops(monkeypatch):
    import sys
    import types
    from unittest.mock import MagicMock

    captured = {}

    class FakeUpdateOne:
        def __init__(self, flt, update, upsert=False):
            self.filter = flt
            self.update = update
            self.upsert = upsert

    fake_pymongo = types.ModuleType("pymongo")
    fake_pymongo.UpdateOne = FakeUpdateOne
    monkeypatch.setitem(sys.modules, "pymongo", fake_pymongo)

    from vnibb.services.mongo_market_data_service import MongoMarketDataService

    svc = MongoMarketDataService()

    fake_coll = MagicMock()

    def fake_bulk_write(ops, ordered=False):
        captured["ops"] = ops

    fake_coll.bulk_write.side_effect = fake_bulk_write
    fake_coll.find.return_value = []
    monkeypatch.setattr(svc, "_get_collection", lambda name: fake_coll)
    monkeypatch.setattr(MongoMarketDataService, "enabled", property(lambda self: True))

    rows = [
        {"tradeDate": datetime(2026, 6, 5), "open": 1.0, "high": 2.0, "low": 0.5, "close": 1.5, "volume": 100, "value": 150.0},
        {"tradeDate": datetime(2026, 6, 6), "open": 1.5, "high": 2.5, "low": 1.0, "close": 2.0, "volume": 200, "value": 400.0},
        {"tradeDate": datetime(2026, 6, 7), "open": 2.0, "high": 2.0, "low": 2.0, "close": None, "volume": 0},  # dropped: null close
    ]
    written = await svc.bulk_upsert_eod_prices("vci", rows)
    assert written == 2

    ops = captured["ops"]
    assert len(ops) == 2
    first = ops[0]
    # Idempotency key matches the vnstock fallback source AND the corpus's
    # 07:00:00 tradeDate convention. Prices are converted from vnstock's
    # thousand-VND convention to the corpus's raw-VND convention.
    assert first.filter == {
        "symbol": "VCI",
        "tradeDate": datetime(2026, 6, 5, 7, 0, 0),
        "source": "vnstock-data",
    }
    assert first.upsert is True
    doc = first.update["$set"]
    assert doc["symbol"] == "VCI"
    assert doc["tradeDate"] == datetime(2026, 6, 5, 7, 0, 0)
    assert doc["close"] == 1500.0
    assert doc["open"] == 1000.0
    assert doc["value"] == 150.0
    assert doc["interval"] == "1D"
    assert doc["source"] == "vnstock-data"
    assert doc["priceUnit"] == "VND"
    assert doc["rescaledFromThousandVnd"] is True


@pytest.mark.asyncio
async def test_bulk_upsert_eod_prices_skips_existing_vietcap_dates(monkeypatch):
    import sys
    import types
    from unittest.mock import MagicMock

    captured = {}

    class FakeUpdateOne:
        def __init__(self, flt, update, upsert=False):
            self.filter = flt
            self.update = update
            self.upsert = upsert

    fake_pymongo = types.ModuleType("pymongo")
    fake_pymongo.UpdateOne = FakeUpdateOne
    monkeypatch.setitem(sys.modules, "pymongo", fake_pymongo)

    from vnibb.services.mongo_market_data_service import MongoMarketDataService

    svc = MongoMarketDataService()
    fake_coll = MagicMock()
    fake_coll.find.return_value = [{"tradeDate": datetime(2026, 6, 5, 7, 0, 0)}]

    def fake_bulk_write(ops, ordered=False):
        captured["ops"] = ops

    fake_coll.bulk_write.side_effect = fake_bulk_write
    monkeypatch.setattr(svc, "_get_collection", lambda name: fake_coll)
    monkeypatch.setattr(MongoMarketDataService, "enabled", property(lambda self: True))

    rows = [
        {"tradeDate": datetime(2026, 6, 5), "open": 1.0, "high": 2.0, "low": 0.5, "close": 1.5},
        {"tradeDate": datetime(2026, 6, 6), "open": 1.5, "high": 2.5, "low": 1.0, "close": 2.0},
    ]

    written = await svc.bulk_upsert_eod_prices("vci", rows)
    assert written == 1
    assert len(captured["ops"]) == 1
    assert captured["ops"][0].filter["tradeDate"] == datetime(2026, 6, 6, 7, 0, 0)


@pytest.mark.asyncio
async def test_bulk_upsert_eod_prices_empty_rows_returns_zero():
    from vnibb.services.mongo_market_data_service import MongoMarketDataService

    svc = MongoMarketDataService()
    assert await svc.bulk_upsert_eod_prices("VCI", []) == 0


# ---------------------------------------------------------------------------
# market.py staleness helpers
# ---------------------------------------------------------------------------
def test_expected_latest_trading_day_skips_weekend():
    # Saturday 2026-06-06 -> Friday 2026-06-05
    assert _expected_latest_trading_day(date(2026, 6, 6)) == date(2026, 6, 5)
    # Sunday 2026-06-07 -> Friday 2026-06-05
    assert _expected_latest_trading_day(date(2026, 6, 7)) == date(2026, 6, 5)
    # Monday stays Monday
    assert _expected_latest_trading_day(date(2026, 6, 8)) == date(2026, 6, 8)


def test_coerce_to_date_variants():
    assert _coerce_to_date(date(2026, 6, 5)) == date(2026, 6, 5)
    assert _coerce_to_date(datetime(2026, 6, 5, 12, 0)) == date(2026, 6, 5)
    assert _coerce_to_date("2026-06-05") == date(2026, 6, 5)
    assert _coerce_to_date(None) is None
    assert _coerce_to_date("not-a-date") is None


def test_freshest_snapshot_date_picks_max():
    rows = [
        {"snapshot_date": date(2026, 6, 3)},
        {"snapshot_date": "2026-06-05"},
        {"snapshot_date": None},
    ]
    assert _freshest_snapshot_date(rows) == date(2026, 6, 5)
    assert _freshest_snapshot_date([]) is None


# ---------------------------------------------------------------------------
# _dedup_eod_rows source-preference dedup
# ---------------------------------------------------------------------------
def test_dedup_eod_rows_prefers_vietcap_and_sorts():
    from vnibb.services.mongo_market_data_service import _dedup_eod_rows

    rows = [
        # Duplicate day: vnstock-data first, vietcap second -> vietcap wins
        {"tradeDate": datetime(2026, 6, 10), "close": 25.5, "source": "vnstock-data"},
        {"tradeDate": datetime(2026, 6, 10), "close": 25500.0, "source": "vietcap"},
        # Out-of-order unique day, unknown source kept
        {"tradeDate": datetime(2026, 6, 9), "close": 25000.0, "source": "other"},
        # Missing source treated as lowest priority but kept when alone
        {"tradeDate": datetime(2026, 6, 11), "close": 26000.0},
    ]
    deduped = _dedup_eod_rows(rows)
    assert [r["tradeDate"].day for r in deduped] == [9, 10, 11]
    assert deduped[1]["close"] == 25500.0  # vietcap bar won the duplicate day
    assert all("source" not in r for r in deduped)  # source stripped from output


def test_dedup_eod_rows_duplicate_same_rank_keeps_first():
    from vnibb.services.mongo_market_data_service import _dedup_eod_rows

    rows = [
        {"tradeDate": datetime(2026, 6, 10), "close": 1.0, "source": "vnstock-data"},
        {"tradeDate": datetime(2026, 6, 10), "close": 2.0, "source": "vnstock-data"},
    ]
    deduped = _dedup_eod_rows(rows)
    assert len(deduped) == 1
    assert deduped[0]["close"] == 1.0
