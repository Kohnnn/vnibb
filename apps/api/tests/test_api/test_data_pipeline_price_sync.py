import sys
import types
from datetime import date

import pandas as pd
import pytest

import vnibb.services.data_pipeline as data_pipeline_module
from vnibb.core.config import settings
from vnibb.providers.vnstock.price_board import PriceBoardData
from vnibb.services.data_pipeline import DataPipeline


@pytest.fixture(autouse=True)
def force_free_vci_history_fallback(monkeypatch):
    original_listing_fetch = DataPipeline._fetch_trading_listing_rows
    async def fetch_trading_listing_rows(self, client):
        return [{"symbol": "VNM", "type": "STOCK", "board": "HOSE"}]

    def unavailable_iq_ohlc(self, *args, **kwargs):
        raise RuntimeError("IQ unavailable in free VCI regression")

    monkeypatch.setattr(DataPipeline, "_fetch_trading_listing_rows", fetch_trading_listing_rows)
    monkeypatch.setattr("vnibb.services.vietcap_client.VietcapClient.get_ohlc", unavailable_iq_ohlc)
    monkeypatch.setattr(
        "vnibb.services.mongo_market_data_service.get_mongo_market_data_service",
        lambda: types.SimpleNamespace(enabled=False),
    )
    return original_listing_fetch


class FakeResult:
    def __init__(self, *, scalar_value=None, rows=None):
        self._scalar_value = scalar_value
        self._rows = rows or []

    def scalar(self):
        return self._scalar_value

    def scalar_one_or_none(self):
        if self._scalar_value is not None:
            return self._scalar_value
        return self._rows[-1] if self._rows else None

    def fetchall(self):
        return self._rows
    def scalars(self):
        return self

    def all(self):
        return self._rows


class FakeSession:
    def __init__(self):
        self._latest_price = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def execute(self, stmt, params=None):
        sql = str(stmt)
        if "SELECT" in sql and "FROM stocks" in sql:
            return FakeResult(scalar_value=1)
        if "INSERT INTO stock_prices" in sql:
            self._latest_price = types.SimpleNamespace(**stmt.compile().params)
            return FakeResult(rows=[1])
        if "SELECT" in sql and "FROM stock_prices" in sql and self._latest_price is not None:
            return FakeResult(rows=[self._latest_price])
        return FakeResult()

    async def commit(self):
        return None


@pytest.mark.asyncio
async def test_fetch_quote_history_frame_uses_community_quote_and_bypasses_retry(monkeypatch):

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

    community = types.ModuleType("vnstock")
    community.Quote = FakeQuote
    monkeypatch.setitem(sys.modules, "vnstock", community)
    monkeypatch.setattr(settings, "vnstock_source", "VCI")

    pipeline = DataPipeline()
    result = await pipeline._fetch_quote_history_frame(
        symbol="VNM",
        start="2026-03-01",
        end="2026-03-17",
        bypass_internal_retry=True,
    )

    assert captured == {"symbol": "VNM", "source": "VCI"}
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
                "adjusted_close": 98.5,
                "value": 123000,
                "price_unit": "VND",
                "price_source": "vnstock_history:VCI",
            }
        ]
    )
    fetch_calls = []
    cache_writes = []
    persisted = []

    class RecordingSession(FakeSession):
        async def execute(self, stmt, params=None):
            if "INSERT INTO stock_prices" in str(stmt):
                persisted.append(stmt.compile().params)
            return await super().execute(stmt, params)

    async def fake_wait_for_rate_limit(bucket):
        assert bucket == "prices"

    async def fake_cache_set_json(key, value, ttl, force=False):
        cache_writes.append((key, value))

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
    monkeypatch.setattr(data_pipeline_module, "async_session_maker", lambda: RecordingSession())

    total = await pipeline.sync_daily_prices(
        symbols=["VNM"],
        start_date=date(2026, 3, 16),
        end_date=date(2026, 3, 17),
        cache_recent=False,
    )

    assert total == 1
    assert fetch_calls == [("VNM", "2026-03-16", "2026-03-17", "1D", True)]
    assert persisted[0]["close"] == 100.5
    assert persisted[0]["source"] == "vnstock_vnd:VCI"
    assert cache_writes[0][1]["price_unit"] == "VND"
    assert cache_writes[0][1]["close"] == 100.5
    assert persisted[0]["adj_close"] == 98.5
    assert persisted[0]["value"] == 123000
    assert cache_writes[0][1]["adj_close"] == 98.5
    assert cache_writes[0][1]["value"] == 123000


@pytest.mark.asyncio
async def test_gap_fill_never_fetches_old_history_or_complete_windows(monkeypatch):
    pipeline = DataPipeline()
    queries = []
    fetches = []

    class HistorySession(FakeSession):
        async def execute(self, stmt, params=None):
            if "stock_prices.time" in str(stmt) and "SELECT" in str(stmt):
                queries.append(stmt.compile().params)
                # Include an old row to prove the planner independently stays bounded.
                return FakeResult(rows=[(date(2020, 1, 2),), (date(2026, 3, 16),), (date(2026, 3, 17),)])
            return await super().execute(stmt, params)

    async def fetch(**kwargs):
        fetches.append(kwargs)
        return pd.DataFrame()

    monkeypatch.setattr(data_pipeline_module, "async_session_maker", lambda: HistorySession())
    monkeypatch.setattr(pipeline, "_fetch_quote_history_frame", fetch)
    progress = {}
    await pipeline.sync_daily_prices(symbols=["VNM"], start_date=date(2026, 3, 16),
        end_date=date(2026, 3, 17), fill_missing_gaps=True, cache_recent=False, progress=progress)
    assert fetches == []
    assert date(2026, 3, 16) in queries[0].values()
    assert date(2026, 3, 17) in queries[0].values()
    assert progress["stage_stats"]["prices"]["success"] == 1
    assert not progress.get("error_count")


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



@pytest.mark.asyncio
@pytest.mark.parametrize("symbol,unit,close", [("VNM", "VND", 60500.0), ("VNINDEX", "index_points", 60.5)])
async def test_vci_history_retains_actual_price_contract(monkeypatch, symbol, unit, close):
    import vnibb.providers.vnstock.runtime as runtime

    sources = []

    class Quote:
        def __init__(self, symbol, source):
            sources.append(source)
            self.source = source

        def history(self, **kwargs):
            return pd.DataFrame([{"time": date(2026, 3, 17), "open": 60.0, "high": 61.0,
                                  "low": 59.0, "close": 60.5, "volume": 100}])

    monkeypatch.setattr(settings, "vnstock_source", "VCI")
    monkeypatch.setattr(runtime, "get_quote_class", lambda: Quote)
    pipeline = DataPipeline()
    frame = await pipeline._fetch_quote_history_frame(symbol, "2026-03-17", "2026-03-17")
    row = frame.iloc[0]
    assert sources == ["VCI"]
    assert row["close"] == close
    assert row["price_unit"] == unit
    assert row["price_source"] == "vnstock_history:VCI"


@pytest.mark.asyncio
@pytest.mark.parametrize("outcome", ["empty", "none", "failed"])
async def test_vci_history_never_attempts_banned_fallback(monkeypatch, outcome):
    import vnibb.providers.vnstock.runtime as runtime

    sources = []
    upstream_error = RuntimeError("VCI upstream failed")

    class Quote:
        def __init__(self, symbol, source):
            sources.append(source)

        def history(self, **kwargs):
            if outcome == "failed":
                raise upstream_error
            return pd.DataFrame() if outcome == "empty" else None

    monkeypatch.setattr(settings, "vnstock_source", "VCI")
    monkeypatch.setattr(runtime, "get_quote_class", lambda: Quote)
    pipeline = DataPipeline()
    error_type = RuntimeError if outcome == "failed" else ValueError
    message = "VCI upstream failed" if outcome == "failed" else r"empty data \(VCI\)"

    with pytest.raises(error_type, match=message) as raised:
        await pipeline._fetch_quote_history_frame("VNM", "2026-03-17", "2026-03-17")
    assert sources == ["VCI"]
    if outcome == "failed":
        assert raised.value is upstream_error


@pytest.mark.asyncio
@pytest.mark.parametrize("source", ["KBS", "TCBS", "MSN"])
async def test_history_rejects_banned_source_before_loading_quote(monkeypatch, source):
    import vnibb.providers.vnstock.runtime as runtime

    def forbidden_quote_class():
        raise AssertionError("banned sources must be rejected before loading Quote")

    monkeypatch.setattr(settings, "vnstock_source", source)
    monkeypatch.setattr(runtime, "get_quote_class", forbidden_quote_class)
    pipeline = DataPipeline()
    with pytest.raises(ValueError, match="only free VCI"):
        await pipeline._fetch_quote_history_frame("VNM", "2026-03-17", "2026-03-17")


@pytest.mark.asyncio
@pytest.mark.parametrize("source", ["VCI", "KBS", "TCBS"])
async def test_recent_cache_normalizes_source_marked_rows_without_double_scaling(monkeypatch, source):
    from types import SimpleNamespace

    stored = [
        SimpleNamespace(symbol="VNM", time=date(2026, 3, 16), open=60, high=61, low=59,
                        close=60.5, volume=100, source=source),
        SimpleNamespace(symbol="VNM", time=date(2026, 3, 17), open=60000, high=61000, low=59000,
                        close=60500, volume=100, source=f"vnstock_vnd:{source}"),
    ]
    writes = {}

    class Session(FakeSession):
        async def execute(self, stmt, params=None):
            if "SELECT" in str(stmt) and "FROM stock_prices" in str(stmt):
                return FakeResult(rows=stored)
            return await super().execute(stmt, params)

    async def fetch(**kwargs):
        return pd.DataFrame([{**vars(stored[-1]), "price_unit": "VND", "price_source": "vnstock_history:VCI"}])

    async def cache(key, value, ttl, **kwargs):
        writes[key] = value

    async def wait(bucket):
        pass

    pipeline = DataPipeline()
    monkeypatch.setattr(data_pipeline_module, "async_session_maker", lambda: Session())
    monkeypatch.setattr(pipeline, "_fetch_quote_history_frame", fetch)
    monkeypatch.setattr(pipeline, "_cache_set_json", cache)
    monkeypatch.setattr(pipeline, "_wait_for_rate_limit", wait)
    await pipeline.sync_daily_prices(["VNM"], start_date=date(2026, 3, 16), end_date=date(2026, 3, 17))
    recent = next(value for key, value in writes.items() if ":recent:" in key)
    assert [row["close"] for row in recent] == [60500, 60500]
    assert all(row["price_unit"] == "VND" for row in recent)


@pytest.mark.asyncio
async def test_history_derivative_category_stays_in_points(monkeypatch):
    import vnibb.providers.vnstock.runtime as runtime

    class Quote:
        asset_type = "derivative"

        def __init__(self, **kwargs):
            pass

        def history(self, **kwargs):
            return pd.DataFrame([{"time": date(2026, 3, 17), "open": 1200, "high": 1210,
                                  "low": 1190, "close": 1205, "volume": 100}])

    monkeypatch.setattr(runtime, "get_quote_class", lambda: Quote)
    frame = await DataPipeline()._fetch_quote_history_frame("VN30F2610", "2026-03-17", "2026-03-17")
    assert frame.iloc[0]["close"] == 1205
    assert frame.iloc[0]["price_unit"] == "index_points"


@pytest.mark.parametrize("marker,expected,unit", [(None, 60300, "unknown"), ("VND", 60300, "VND")])
def test_stored_sponsor_history_requires_explicit_unit_marker(marker, expected, unit):
    from vnibb.core.price_units import history_price_records

    frame = pd.DataFrame([{"time": date(2026, 3, 17), "open": 60000, "high": 61000,
                           "low": 59000, "close": 60300, "volume": 100}])
    frame.attrs["source"] = "VCI"
    if marker:
        frame.attrs["price_unit"] = marker

    row = history_price_records(
        frame, symbol="VNM", source="KBS", provider="vnstock_data.explorer.kbs.quote"
    )[0]
    assert row["close"] == expected
    assert row["price_unit"] == unit
    assert row["price_source"] == "vnstock_data_history:VCI"


@pytest.mark.asyncio
async def test_daily_ingestion_does_not_persist_unknown_source_contract(monkeypatch):
    inserted = []

    class Session(FakeSession):
        async def execute(self, stmt, params=None):
            if "INSERT INTO stock_prices" in str(stmt):
                inserted.append(stmt)
            return await super().execute(stmt, params)

    async def fetch(**kwargs):
        return pd.DataFrame([{"time": date(2026, 3, 17), "open": 60, "high": 61,
                              "low": 59, "close": 60.3, "volume": 100,
                              "price_unit": "unknown", "price_source": "vnstock_data_history:KBS"}])

    async def wait(bucket):
        pass

    pipeline = DataPipeline()
    monkeypatch.setattr(data_pipeline_module, "async_session_maker", lambda: Session())
    monkeypatch.setattr(pipeline, "_fetch_quote_history_frame", fetch)
    monkeypatch.setattr(pipeline, "_wait_for_rate_limit", wait)
    assert await pipeline.sync_daily_prices(["VNM"], cache_recent=False) == 0
    assert inserted == []



def _create_stock_price_tables_for_sqlite(conn):
    """Create stocks/stock_prices with an INTEGER autoincrement id.

    Production models use ``BigInteger`` primaries (PostgreSQL/Supabase), which
    SQLite refuses to autoincrement -> ``NOT NULL constraint failed`` on insert.
    The Alembic migration already declares the portable variant
    ``sa.BigInteger().with_variant(sa.Integer, "sqlite")``; this mirrors that
    variant for the tables under test without changing production schema.
    """
    from sqlalchemy import BigInteger, Integer
    from sqlalchemy.dialects import sqlite as sqlite_dialect
    from sqlalchemy.schema import CreateIndex, CreateTable

    from vnibb.models.stock import Stock, StockPrice

    dialect = sqlite_dialect.dialect()
    for table in (Stock.__table__, StockPrice.__table__):
        id_col = table.c.id
        original_type = id_col.type
        id_col.type = BigInteger().with_variant(Integer, "sqlite")
        try:
            ddl = [str(CreateTable(table).compile(dialect=dialect))]
            ddl += [str(CreateIndex(index).compile(dialect=dialect)) for index in table.indexes]
        finally:
            id_col.type = original_type
        for statement in ddl:
            conn.exec_driver_sql(statement.replace("BIGINT", "INTEGER"))


@pytest.mark.asyncio
async def test_daily_writer_persists_sparse_value_and_clears_absent_adj_close(
    monkeypatch, tmp_path
):
    # Exercise the real scheduled SQL writer and SQLite insert path, including
    # sparse-value preservation and absent-adj_close clearing end to end.
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
    from vnibb.models.stock import Stock, StockPrice

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'prices.db'}")
    session_maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(lambda sync_conn: _create_stock_price_tables_for_sqlite(sync_conn))

    async with session_maker() as session:
        session.add(Stock(id=1, symbol="VNM", exchange="HOSE", is_active=1))
        await session.commit()

    frames = [
        pd.DataFrame(
            [
                {
                    "time": pd.Timestamp("2026-03-17"),
                    "open": 60000.0,
                    "high": 61000.0,
                    "low": 59000.0,
                    "close": 60500.0,
                    "volume": 100,
                    "value": 123000,
                    "adj_close": 98.5,
                    "price_unit": "VND",
                    "price_source": "vnstock_history:VCI",
                }
            ]
        ),
        pd.DataFrame(
            [
                {
                    "time": pd.Timestamp("2026-03-17"),
                    "open": 60000.0,
                    "high": 61000.0,
                    "low": 59000.0,
                    "close": 60500.0,
                    "volume": 100,
                    "price_unit": "VND",
                    "price_source": "vnstock_history:VCI",
                }
            ]
        ),
    ]
    fetch_calls = {"n": 0}

    async def fake_fetch(**kwargs):
        frame = frames[min(fetch_calls["n"], len(frames) - 1)]
        fetch_calls["n"] += 1
        return frame

    async def fake_wait(bucket):
        assert bucket == "prices"

    async def noop_cache(*args, **kwargs):
        return None

    pipeline = DataPipeline()
    monkeypatch.setattr(data_pipeline_module, "async_session_maker", session_maker)
    monkeypatch.setattr(pipeline, "_fetch_quote_history_frame", fake_fetch)
    monkeypatch.setattr(pipeline, "_wait_for_rate_limit", fake_wait)
    monkeypatch.setattr(pipeline, "_cache_set_json", noop_cache)

    total = await pipeline.sync_daily_prices(
        symbols=["VNM"],
        start_date=date(2026, 3, 17),
        end_date=date(2026, 3, 17),
        cache_recent=False,
    )
    assert total == 1

    async with session_maker() as session:
        row = (
            await session.execute(
                select(StockPrice).where(
                    StockPrice.symbol == "VNM",
                    StockPrice.time == date(2026, 3, 17),
                )
            )
        ).scalar_one()
        assert row.id is not None
        assert row.close == 60500.0
        assert row.source == "vnstock_vnd:VCI"
        assert row.value == 123000
        assert row.adj_close == 98.5

    # Second pass with a sparse frame: absent value must be preserved, absent
    # adj_close must be cleared to NULL.
    total = await pipeline.sync_daily_prices(
        symbols=["VNM"],
        start_date=date(2026, 3, 17),
        end_date=date(2026, 3, 17),
        cache_recent=False,
    )
    assert total == 1

    async with session_maker() as session:
        rows = (
            await session.execute(
                select(StockPrice).where(StockPrice.symbol == "VNM")
            )
        ).scalars().all()
        assert len(rows) == 1
        assert rows[0].close == 60500.0
        assert rows[0].value == 123000
        assert rows[0].adj_close is None

    await engine.dispose()



@pytest.mark.asyncio
async def test_modular_screener_uses_explicit_community_vci_finance(monkeypatch):
    from vnibb.services.pipeline.screener_pipeline import ScreenerPipeline

    calls = []

    class Finance:
        def __init__(self, symbol, source, period):
            calls.append(("finance", symbol, source, period))

        def ratio(self, period, lang):
            calls.append(("ratio", period, lang))
            return pd.DataFrame([{"pe": 12.0}])

    class ForbiddenClient:
        def __init__(self, **kwargs):
            raise AssertionError("screener must use Finance with an explicit VCI source")

    community = types.ModuleType("vnstock")
    community.Finance = Finance
    community.Vnstock = ForbiddenClient
    monkeypatch.setitem(sys.modules, "vnstock", community)
    monkeypatch.setattr(settings, "vnstock_source", "VCI")

    async def wait(bucket):
        assert bucket == "screener"

    pipeline = ScreenerPipeline()
    monkeypatch.setattr(pipeline, "_get_session", lambda: FakeSession())
    monkeypatch.setattr(pipeline, "_wait_for_rate_limit", wait)

    assert await pipeline.sync_screener_data(symbols=["vnm"]) == 1
    assert calls == [("finance", "VNM", "VCI", "year"), ("ratio", "year", "en")]


@pytest.fixture
async def scheduled_price_database(monkeypatch, tmp_path):
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from vnibb.models.stock import Stock

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'scheduled.db'}")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(_create_stock_price_tables_for_sqlite)
    async with sessions() as session:
        session.add_all([Stock(id=1, symbol="VNM", exchange="HOSE", is_active=1), Stock(id=2, symbol="FPT", exchange="HOSE", is_active=1)])
        await session.commit()
    monkeypatch.setattr(data_pipeline_module, "async_session_maker", sessions)
    monkeypatch.setattr(data_pipeline_module, "engine", engine)
    yield sessions
    await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize("outcome", ["live_iq", "cached_iq", "free_vci"])
async def test_scheduled_price_acquisition_ingests_real_sql_source_rows(monkeypatch, scheduled_price_database, outcome):
    from datetime import UTC, datetime

    from sqlalchemy import select

    from vnibb.models.stock import StockPrice
    from vnibb.services.vietcap_client import VietcapClient

    iq_calls, free_calls, cache_writes = [], [], {}
    epoch = int(datetime(2026, 3, 17, tzinfo=UTC).timestamp())

    def iq_history(self, symbol, **kwargs):
        iq_calls.append((symbol, kwargs))
        if outcome != "live_iq":
            raise RuntimeError("IQ outage")
        return {"o": [60000], "h": [61000], "l": [59000], "c": [60500], "v": [100], "t": [epoch]}

    class CachedCollection:
        def find(self, query, projection):
            assert query["source"] == "vietcap"
            return self

        def sort(self, *args):
            return [{"symbol": "VNM", "source": "vietcap", "priceUnit": "VND", "tradeDate": datetime(2026, 3, 17, 7), "open": 60000, "high": 61000, "low": 59000, "close": 60500, "volume": 100}]

    service = types.SimpleNamespace(enabled=outcome == "cached_iq", _get_collection=lambda name: CachedCollection())
    monkeypatch.setattr("vnibb.services.mongo_market_data_service.get_mongo_market_data_service", lambda: service)
    monkeypatch.setattr(VietcapClient, "get_ohlc", iq_history)
    pipeline = DataPipeline()

    async def free_history(*args, **kwargs):
        free_calls.append((args, kwargs))
        return pd.DataFrame([{"time": date(2026, 3, 17), "open": 60000, "high": 61000, "low": 59000, "close": 60500, "volume": 100, "price_unit": "VND", "price_source": "vnstock_history:VCI"}])

    async def cache(key, value, ttl, **kwargs):
        cache_writes[key] = value

    async def wait(bucket):
        pass

    monkeypatch.setattr(pipeline, "_fetch_quote_history_frame", free_history)
    monkeypatch.setattr(pipeline, "_cache_set_json", cache)
    monkeypatch.setattr(pipeline, "_wait_for_rate_limit", wait)
    count = await pipeline.sync_daily_prices(["VNM"], start_date=date(2026, 3, 17), end_date=date(2026, 3, 17), cache_recent=False)
    assert count == 1
    assert len(iq_calls) == 1
    assert bool(free_calls) == (outcome == "free_vci")
    assert iq_calls[0][1]["count_back"] == 1
    async with scheduled_price_database() as session:
        stored = (await session.execute(select(StockPrice))).scalar_one()
        assert stored.close == 60500
        assert stored.source == ("vnstock_vnd:VCI" if outcome == "free_vci" else "vietcap_vnd")
    latest = next(value for key, value in cache_writes.items() if ":latest:" in key)
    assert latest["close"] == 60500
    assert latest["price_unit"] == "VND"


@pytest.mark.asyncio
async def test_scheduled_secondary_preserves_iq_owner_and_reports_accepted_partial_rows(monkeypatch, scheduled_price_database):
    from sqlalchemy import select
    from vnibb.models.stock import StockPrice

    async with scheduled_price_database() as session:
        session.add(StockPrice(id=1, stock_id=1, symbol="VNM", time=date(2026, 3, 16), open=60000, high=61000, low=59000, close=60500, volume=100, source="vietcap_vnd", interval="1D"))
        await session.commit()
    pipeline = DataPipeline()
    caches = {}

    async def free_history(*args, **kwargs):
        return pd.DataFrame([{"time": day, "open": 62000, "high": 63000, "low": 61000, "close": 62500, "volume": 100, "price_unit": "VND", "price_source": "vnstock_history:VCI"} for day in [date(2026, 3, 16), date(2026, 3, 17)]])

    async def cache(key, value, ttl, **kwargs):
        caches[key] = value

    async def wait(bucket):
        pass

    monkeypatch.setattr(pipeline, "_fetch_quote_history_frame", free_history)
    monkeypatch.setattr(pipeline, "_cache_set_json", cache)
    monkeypatch.setattr(pipeline, "_wait_for_rate_limit", wait)
    progress = {}
    assert await pipeline.sync_daily_prices(["VNM"], start_date=date(2026, 3, 16), end_date=date(2026, 3, 17), progress=progress) == 1
    async with scheduled_price_database() as session:
        rows = (await session.execute(select(StockPrice).order_by(StockPrice.time))).scalars().all()
        assert [(row.close, row.source) for row in rows] == [(60500, "vietcap_vnd"), (62500, "vnstock_vnd:VCI")]
    assert progress["source_conflicts"][0]["persisted_rows"] == 1
    assert progress["stage_stats"]["prices"]["errors"] == 1
    recent = next(value for key, value in caches.items() if ":recent:" in key)
    assert [row["close"] for row in recent] == [60500, 62500]


@pytest.mark.asyncio
async def test_scheduled_cached_listing_confirms_stock_without_live_provider(monkeypatch, force_free_vci_history_fallback):
    from vnibb.services.vietcap_client import VietcapClient

    class Collection:
        def __init__(self, name):
            self.name = name

        def find(self, query, projection):
            assert query["source"] == "vietcap"
            return [] if self.name == "market_symbols" else [{"raw": {"trading": {"symbol": "VNM", "type": "STOCK", "board": "HOSE"}}}]

    def unavailable(self):
        raise RuntimeError("Trading unavailable")

    monkeypatch.setattr(VietcapClient, "get_all_symbols", unavailable)
    monkeypatch.setattr(DataPipeline, "_fetch_trading_listing_rows", force_free_vci_history_fallback)
    monkeypatch.setattr("vnibb.services.mongo_market_data_service.get_mongo_market_data_service", lambda: types.SimpleNamespace(enabled=True, _get_collection=Collection))
    rows = await DataPipeline()._fetch_trading_listing_rows(VietcapClient())
    assert rows == [{"symbol": "VNM", "type": "STOCK", "board": "HOSE"}]


@pytest.mark.asyncio
async def test_scheduled_unconfirmed_instruments_never_acquire_free_vci(monkeypatch):
    pipeline = DataPipeline()
    calls = []

    async def listings(client):
        return [{"symbol": "VNM", "type": "ETF"}]

    async def forbidden(*args, **kwargs):
        calls.append(kwargs)
        raise AssertionError("unsupported instrument reached free VCI")

    async def wait(bucket):
        pass

    monkeypatch.setattr(pipeline, "_fetch_trading_listing_rows", listings)
    monkeypatch.setattr(pipeline, "_fetch_quote_history_frame", forbidden)
    monkeypatch.setattr(pipeline, "_wait_for_rate_limit", wait)
    monkeypatch.setattr(data_pipeline_module, "async_session_maker", FakeSession)
    progress = {}
    assert await pipeline.sync_daily_prices(["VNM"], progress=progress, cache_recent=False) == 0
    assert calls == []
    assert progress["stage_stats"]["prices"]["errors"] == 1


@pytest.mark.asyncio
async def test_scheduled_listing_persists_trading_stocks_when_iq_descriptions_fail(monkeypatch, scheduled_price_database):
    from sqlalchemy import select
    from vnibb.models.stock import Stock
    from vnibb.services.cache_manager import CacheManager
    from vnibb.services.vietcap_client import VietcapClient

    async def cache_session(self):
        return scheduled_price_database()

    def unavailable(self):
        raise RuntimeError("IQ company descriptions unavailable")

    def forbidden_listing():
        raise AssertionError("free VCI must not replace acquired Trading listing")

    async def cache(*args, **kwargs):
        pass

    monkeypatch.setattr(CacheManager, "_get_session", cache_session)
    monkeypatch.setattr(VietcapClient, "get_company_search_bar", unavailable)
    monkeypatch.setattr("vnibb.providers.vnstock.runtime.get_listing_class", forbidden_listing)
    pipeline = DataPipeline()
    monkeypatch.setattr(pipeline, "_cache_set_json", cache)
    progress = {}
    assert await pipeline.sync_stock_list(progress=progress) == 1
    async with scheduled_price_database() as session:
        stock = (await session.execute(select(Stock).where(Stock.symbol == "VNM"))).scalar_one()
        assert stock.exchange == "HOSE"
    assert progress["stage_stats"]["stock_list"] == {"success": 1, "errors": 1, "total": 1}
    assert progress["error_count"] == 1


@pytest.mark.asyncio
async def test_scheduled_price_partial_failure_keeps_committed_symbol_rows(monkeypatch, scheduled_price_database):
    from datetime import UTC, datetime

    from sqlalchemy import select
    from vnibb.models.stock import StockPrice
    from vnibb.services.vietcap_client import VietcapClient

    listing_calls = []

    async def listing(client):
        listing_calls.append(client)
        return [{"symbol": symbol, "type": "STOCK"} for symbol in ("VNM", "FPT")]

    def iq_history(self, symbol, **kwargs):
        if symbol == "FPT":
            raise RuntimeError("IQ transport unavailable")
        epoch = int(datetime(2026, 3, 17, tzinfo=UTC).timestamp())
        return {"o": [60000], "h": [61000], "l": [59000], "c": [60500], "v": [100], "t": [epoch]}

    async def unavailable(*args, **kwargs):
        raise RuntimeError("free VCI transport unavailable")

    async def noop(*args, **kwargs):
        pass

    pipeline = DataPipeline()
    monkeypatch.setattr(pipeline, "_fetch_trading_listing_rows", listing)
    monkeypatch.setattr(VietcapClient, "get_ohlc", iq_history)
    monkeypatch.setattr(pipeline, "_fetch_quote_history_frame", unavailable)
    monkeypatch.setattr(pipeline, "_wait_for_rate_limit", noop)
    monkeypatch.setattr(pipeline, "_cache_set_json", noop)
    progress = {}
    assert await pipeline.sync_daily_prices(["VNM", "FPT"], start_date=date(2026, 3, 17), end_date=date(2026, 3, 17), progress=progress, cache_recent=False) == 1
    assert len(listing_calls) == 1
    async with scheduled_price_database() as session:
        rows = (await session.execute(select(StockPrice))).scalars().all()
        assert [(row.symbol, row.source) for row in rows] == [("VNM", "vietcap_vnd")]
    assert progress["stage_stats"]["prices"] == {"success": 1, "errors": 1, "total": 2}
