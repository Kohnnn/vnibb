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
    def scalars(self):
        return self

    def all(self):
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
                "adjusted_close": 98.5,
                "value": 123000,
                "price_unit": "VND",
                "price_source": "vnstock_history:KBS",
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
    assert persisted[0]["source"] == "vnstock_vnd:KBS"
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
@pytest.mark.parametrize("pipeline_class", [DataPipeline, pytest.param(None, id="modular")])
@pytest.mark.parametrize("symbol,unit,close", [("VNM", "VND", 60500.0), ("VNINDEX", "index_points", 60.5)])
async def test_history_fallback_retains_actual_price_contract(monkeypatch, pipeline_class, symbol, unit, close):
    import vnibb.providers.vnstock.runtime as runtime
    from vnibb.services.pipeline.price_pipeline import PricePipeline

    class Quote:
        def __init__(self, symbol, source):
            self.source = source

        def history(self, **kwargs):
            if self.source == "KBS":
                raise ValueError("primary unavailable")
            return pd.DataFrame([{"time": date(2026, 3, 17), "open": 60.0, "high": 61.0,
                                  "low": 59.0, "close": 60.5, "volume": 100}])

    monkeypatch.setattr(settings, "vnstock_source", "KBS")
    monkeypatch.setattr(runtime, "get_quote_class", lambda: Quote)
    pipeline = (pipeline_class or PricePipeline)()
    frame = await pipeline._fetch_quote_history_frame(symbol, "2026-03-17", "2026-03-17")
    row = frame.iloc[0]
    assert row["close"] == close
    assert row["price_unit"] == unit
    assert row["price_source"] == "vnstock_history:VCI"


@pytest.mark.asyncio
async def test_recent_cache_normalizes_source_marked_rows_without_double_scaling(monkeypatch):
    from types import SimpleNamespace

    stored = [
        SimpleNamespace(symbol="VNM", time=date(2026, 3, 16), open=60, high=61, low=59,
                        close=60.5, volume=100, source="VCI"),
        SimpleNamespace(symbol="VNM", time=date(2026, 3, 17), open=60000, high=61000, low=59000,
                        close=60500, volume=100, source="vnstock_vnd:VCI"),
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


@pytest.mark.asyncio
@pytest.mark.parametrize("marker,expected,unit", [(None, 60300, "unknown"), ("VND", 60300, "VND")])
async def test_sponsor_history_requires_explicit_unit_marker(monkeypatch, marker, expected, unit):
    import vnibb.providers.vnstock.runtime as runtime

    class Quote:
        def __init__(self, **kwargs):
            pass

        def history(self, **kwargs):
            frame = pd.DataFrame([{"time": date(2026, 3, 17), "open": 60000, "high": 61000,
                                   "low": 59000, "close": 60300, "volume": 100}])
            frame.attrs["source"] = "VCI"
            if marker:
                frame.attrs["price_unit"] = marker
            return frame

    Quote.__module__ = "vnstock_data.explorer.kbs.quote"
    monkeypatch.setattr(runtime, "get_quote_class", lambda: Quote)
    monkeypatch.setattr(settings, "vnstock_source", "KBS")
    frame = await DataPipeline()._fetch_quote_history_frame("VNM", "2026-03-17", "2026-03-17")
    assert frame.iloc[0]["close"] == expected
    assert frame.iloc[0]["price_unit"] == unit
    assert frame.iloc[0]["price_source"] == "vnstock_data_history:VCI"


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
async def test_modular_daily_writer_persists_sparse_value_and_clears_absent_adj_close(
    monkeypatch, tmp_path
):
    # Regression: the modular PricePipeline previously called a 4-argument
    # upsert helper that its base module did not expose, so no valid frame
    # could be written. This exercises the real SQLite insert path and the
    # sparse-value / absent-adj_close semantics end to end.
    import vnibb.services.pipeline.price_pipeline as price_pipeline_module
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
    from vnibb.models.stock import Stock, StockPrice
    from vnibb.services.pipeline.price_pipeline import PricePipeline

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
                    "price_source": "vnstock_history:KBS",
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
                    "price_source": "vnstock_history:KBS",
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

    pipeline = PricePipeline()
    monkeypatch.setattr(price_pipeline_module, "async_session_maker", session_maker)
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
        assert row.source == "vnstock_vnd:KBS"
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

