"""Offline admission against explicitly supplied, disposable loopback stores."""

import ipaddress
import os
from copy import deepcopy
from datetime import UTC, date, datetime
from types import SimpleNamespace
from urllib.parse import urlsplit
from uuid import uuid4

import pytest
import sqlalchemy.ext.asyncio as sqlalchemy_async
from pymongo import MongoClient
from scripts.readiness_census import _admitted, _retained, reconcile_census
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
from vnibb.core.database import Base
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models.stock import Stock, StockPrice
from vnibb.models.sync_status import SyncStatus
from vnibb.services import cache_manager as cache_module
from vnibb.services import data_pipeline as pipeline_module
from vnibb.services.cache_manager import CacheManager
from vnibb.services.data_pipeline import DataPipeline
from vnibb.services.mongo_market_data_service import MongoMarketDataService
from vnibb.services.vietcap_client import VietcapClient

SESSION = date(2026, 10, 26)
OBSERVED = datetime(2026, 10, 26, 9, tzinfo=UTC)


def board_row(symbol):
    return {
        "listingInfo": {
            "symbol": symbol, "ticker": symbol, "stockType": "STOCK", "type": "STOCK",
            "isDelisted": 0, "tradingDate": SESSION.isoformat(),
            "receivedTime": "2026-10-26T01:44:00Z", "tradingStatus": "TRADING_ACTIVATED",
            "tradingStatusCode": "20", "securityStatus": "N",
        },
        "bidAsk": {"symbol": symbol, "session": "ENDED", "time": "2026-10-26T08:00:00Z", "receivedTime": "2026-10-26T08:00:03Z"},
        "matchPrice": {
            "symbol": symbol, "session": "ENDED", "time": "2026-10-26T08:00:00Z",
            "receivedTime": "2026-10-26T08:00:03Z", "openPrice": 10000,
            "highest": 12000, "lowest": 9000, "matchPrice": 11000, "accumulatedVolume": 100,
        },
    }


@pytest.fixture
async def admission_stores(monkeypatch):
    pg_url = os.environ.get("POSTGRES_CONTRACT_DATABASE_URL")
    mongo_url = os.environ.get("MONGODB_CONTRACT_URL")
    if os.environ.get("POSTGRES_CONTRACT") != "1" or not pg_url or not mongo_url:
        pytest.skip("Requires disposable POSTGRES_CONTRACT and MONGODB_CONTRACT_URL stores")
    for url in (pg_url, mongo_url):
        host = urlsplit(url).hostname
        assert host == "localhost" or (host and ipaddress.ip_address(host).is_loopback)
    schema = f"admission_{uuid4().hex}"
    admin = create_async_engine(pg_url, poolclass=NullPool)
    async with admin.begin() as connection:
        await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_async_engine(
        pg_url, poolclass=NullPool, connect_args={"server_settings": {"search_path": schema}},
    )
    client = MongoClient(mongo_url, serverSelectionTimeoutMS=5000)
    database = client[schema]
    service = MongoMarketDataService()
    monkeypatch.setattr(service, "_get_collection", lambda name: database[name])
    monkeypatch.setattr("vnibb.core.config.settings.mongodb_enabled", True)
    monkeypatch.setattr("vnibb.core.config.settings.mongodb_url", mongo_url)
    monkeypatch.setattr("vnibb.services.mongo_market_data_service.get_mongo_market_data_service", lambda: service)
    monkeypatch.setattr(pipeline_module, "engine", engine)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(pipeline_module, "async_session_maker", sessions)

    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return OBSERVED.astimezone(tz)

        @classmethod
        def utcnow(cls):
            return OBSERVED.replace(tzinfo=None)

    monkeypatch.setattr(pipeline_module, "datetime", FrozenDateTime)
    monkeypatch.setattr(cache_module, "datetime", FrozenDateTime)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    try:
        yield SimpleNamespace(sessions=sessions, mongo=database, service=service, pg_url=pg_url, mongo_url=mongo_url)
    finally:
        client.drop_database(schema)
        client.close()
        await engine.dispose()
        async with admin.begin() as connection:
            await connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        await admin.dispose()


async def run_board(stores, monkeypatch, symbols, rows):
    async with stores.sessions.begin() as session:
        session.add_all([Stock(symbol=symbol, is_active=1) for symbol in symbols])
    monkeypatch.setattr(VietcapClient, "get_price_board", lambda self, requested, **kwargs: deepcopy(rows))
    progress = {}
    count = await DataPipeline().sync_screener_data(
        enrich_ratios=False, acquire_sessions=True, progress=progress,
    )
    return count, progress


@pytest.mark.asyncio
async def test_invalid_row_retains_raw_and_49_independent_observations(admission_stores, monkeypatch):
    stores = admission_stores
    symbols = [f"B{index:02d}" for index in range(50)]
    rows = [board_row(symbol) for symbol in symbols]
    rows[-1]["matchPrice"]["accumulatedVolume"] = -1
    count, progress = await run_board(stores, monkeypatch, symbols, rows)

    raw = stores.mongo.market_vnstock_premium_records
    envelope = raw.find_one({"dataset": "equity.price_board_envelope"})
    assert envelope is not None and envelope["raw"] == rows
    assert count == 49
    assert progress["session_errors"] == [symbols[-1]]
    assert progress["error_count"] == 1
    assert progress["stage_stats"]["screener"]["base_errors"] == 1
    assert raw.count_documents({"dataset": "equity.price_board"}) == 49
    async with stores.sessions() as session:
        snapshots = (await session.scalars(select(ScreenerSnapshot))).all()
        prices = (await session.scalars(select(StockPrice))).all()
        receipts = (await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == "screener_universe"))).all()
    assert {row.symbol for row in snapshots if row.extended_metrics.get("market_session")} == set(symbols[:-1])
    assert {row.symbol for row in prices} == set(symbols[:-1])
    assert not receipts


@pytest.mark.asyncio
async def test_partially_applied_mongo_retains_only_acknowledged_observations(admission_stores, monkeypatch):
    stores = admission_stores
    collection = "market_vnstock_premium_records"
    stores.mongo.create_collection(collection, validator={"$or": [
        {"dataset": {"$ne": "equity.price_board"}}, {"symbol": {"$ne": "BBB"}},
    ]})
    count, progress = await run_board(stores, monkeypatch, ["AAA", "BBB"], [board_row("AAA"), board_row("BBB")])
    assert count == 1
    assert progress["session_errors"] == ["BBB"]
    assert progress["session_admitted"] == ["AAA"]
    assert progress["error_count"] == 1
    assert stores.mongo[collection].count_documents({"dataset": "equity.price_board_envelope"}) == 1
    assert stores.mongo[collection].count_documents({"dataset": "equity.price_board"}) == 1
    async with stores.sessions() as session:
        assert set(await session.scalars(select(StockPrice.symbol))) == {"AAA"}
        assert not (await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == "screener_universe"))).all()


@pytest.mark.asyncio
async def test_identical_incomplete_replay_preserves_values_and_lineage(admission_stores, monkeypatch):
    stores = admission_stores
    symbols = ["AAA", "BBB"]
    rows = [board_row("AAA"), board_row("BBB")]
    rows[-1]["matchPrice"]["accumulatedVolume"] = -1
    assert (await run_board(stores, monkeypatch, symbols, rows))[0] == 1

    async def durable_state():
        async with stores.sessions() as session:
            snapshots = (await session.scalars(select(ScreenerSnapshot))).all()
            prices = (await session.scalars(select(StockPrice))).all()
            receipts = (await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == "screener_universe"))).all()
        return (
            list(stores.mongo.market_vnstock_premium_records.find({}, {"_id": 0}).sort("recordKey")),
            [(row.id, row.symbol, row.price, row.volume, row.trade_date, row.extended_metrics, row.created_at) for row in snapshots],
            [(row.id, row.symbol, row.time, row.open, row.high, row.low, row.close, row.volume, row.source, row.created_at) for row in prices],
            len(receipts),
        )

    before = await durable_state()
    monkeypatch.setattr(pipeline_module.datetime, "now", classmethod(lambda cls, tz=None: datetime(2026, 10, 26, 10, tzinfo=UTC).astimezone(tz)))
    progress = {}
    assert await DataPipeline().sync_screener_data(enrich_ratios=False, acquire_sessions=True, progress=progress) == 1
    assert progress["session_errors"] == ["BBB"]
    assert progress["session_admitted"] == ["AAA"]
    assert progress["base_count"] == 1
    assert await durable_state() == before


@pytest.mark.asyncio
@pytest.mark.parametrize("case", ["duplicate", "ambiguous", "missing", "unexpected", "malformed"])
async def test_source_identity_errors_retain_evidence_without_completion(admission_stores, monkeypatch, case):
    rows = [board_row("AAA"), board_row("BBB")]
    expected = {"AAA", "BBB"}
    if case == "duplicate":
        rows.append(board_row("AAA"))
        expected.remove("AAA")
    elif case == "ambiguous":
        rows[0]["matchPrice"]["symbol"] = "BBB"
        expected.clear()
    elif case == "missing":
        rows.pop()
        expected.remove("BBB")
    elif case == "unexpected":
        rows.append(board_row("CCC"))
    else:
        rows.append(None)
    # Exercise the real client boundary: it must return evidence, not discard it.
    monkeypatch.setattr(VietcapClient, "_request", lambda *args, **kwargs: deepcopy(rows))
    stores = admission_stores
    async with stores.sessions.begin() as session:
        session.add_all([Stock(symbol=symbol, is_active=1) for symbol in ["AAA", "BBB"]])
    progress = {}
    assert await DataPipeline().sync_screener_data(enrich_ratios=False, acquire_sessions=True, progress=progress) == len(expected)
    assert set(progress["session_admitted"]) == expected
    assert set(progress["session_errors"]) == {"AAA", "BBB"} - expected
    assert progress["session_input_complete"] is False
    envelope = stores.mongo.market_vnstock_premium_records.find_one({"dataset": "equity.price_board_envelope"})
    assert envelope is not None and envelope["raw"] == rows
    async with stores.sessions() as session:
        assert not (await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == "screener_universe"))).all()


@pytest.mark.asyncio
async def test_conflicting_same_session_input_cannot_replace_retained_lineage(admission_stores, monkeypatch):
    stores = admission_stores
    original = board_row("AAA")
    assert (await run_board(stores, monkeypatch, ["AAA"], [original]))[0] == 1
    collection = stores.mongo.market_vnstock_premium_records
    retained = collection.find_one({"dataset": "equity.price_board"})
    changed = deepcopy(original)
    changed["matchPrice"]["matchPrice"] = 10500
    monkeypatch.setattr(VietcapClient, "get_price_board", lambda *args, **kwargs: [changed])
    progress = {}
    assert await DataPipeline().sync_screener_data(enrich_ratios=False, acquire_sessions=True, progress=progress) == 0
    assert progress["session_errors"] == ["AAA"]
    assert progress["session_admitted"] == []
    assert collection.find_one({"dataset": "equity.price_board"}) == retained
    assert collection.count_documents({"dataset": "equity.price_board_envelope"}) == 2
    async with stores.sessions() as session:
        assert (await session.scalar(select(StockPrice.close))) == 11000
        assert len((await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == "screener_universe"))).all()) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["disabled", "envelope_rejected"])
async def test_missing_durable_envelope_fails_closed(admission_stores, monkeypatch, failure):
    stores = admission_stores
    if failure == "disabled":
        monkeypatch.setattr("vnibb.core.config.settings.mongodb_enabled", False)
    else:
        stores.mongo.create_collection("market_vnstock_premium_records", validator={
            "dataset": {"$ne": "equity.price_board_envelope"},
        })
    count, progress = await run_board(stores, monkeypatch, ["AAA"], [board_row("AAA")])
    assert count == 0
    assert progress["session_errors"] == ["AAA"]
    async with stores.sessions() as session:
        assert not (await session.scalars(select(StockPrice))).all()
        assert not (await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == "screener_universe"))).all()


@pytest.mark.asyncio
async def test_interrupted_same_day_rerun_preserves_admitted_cohort(admission_stores, monkeypatch):
    stores = admission_stores
    symbols = [f"B{index:02d}" for index in range(50)]
    async with stores.sessions.begin() as session:
        stocks = [Stock(symbol=symbol, is_active=1) for symbol in symbols]
        session.add_all(stocks)
        await session.flush()
        session.add_all([
            StockPrice(stock_id=stock.id, symbol=stock.symbol, time=date(2026, 10, 23),
                       open=10000, high=10000, low=10000, close=10000, volume=100,
                       interval="1D", source="vietcap_vnd")
            for stock in stocks
        ])
    pipeline = DataPipeline()
    pipeline.cache_writes_enabled = False
    assert await pipeline.sync_screener_data(enrich_ratios=False) == 50
    async with stores.sessions() as session:
        before = await CacheManager(db=session).get_screener_data()
        assert before.hit and len(before.data) == 50
        original = [(row.id, row.symbol, row.price, row.extended_metrics, row.created_at) for row in before.data]
    async with stores.sessions.begin() as session:
        await session.execute(text("UPDATE stock_prices SET close = 11000, high = 11000"))

    class Interrupted(BaseException):
        pass

    async def interrupt_progress(progress, *args, **kwargs):
        assert progress["stage_stats"]["screener"]["success"] == 20
        raise Interrupted()

    monkeypatch.setattr(pipeline, "_save_progress", interrupt_progress)
    with pytest.raises(Interrupted):
        await pipeline.sync_screener_data(enrich_ratios=False, progress={}, sync_id=123)
    async with stores.sessions() as session:
        after = await CacheManager(db=session).get_screener_data()
        assert after.hit
        assert [(row.id, row.symbol, row.price, row.extended_metrics, row.created_at) for row in after.data] == original
        assert len((await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == "screener_universe"))).all()) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("table", ["stock_prices", "screener_snapshots"])
async def test_postgres_constraint_failure_isolates_one_of_50_observations(admission_stores, monkeypatch, table):
    stores = admission_stores
    async with stores.sessions.begin() as session:
        await session.execute(text(f"ALTER TABLE {table} ADD CONSTRAINT reject_one_observation CHECK (symbol <> 'B00')"))
    symbols = [f"B{index:02d}" for index in range(50)]
    count, progress = await run_board(stores, monkeypatch, symbols, [board_row(symbol) for symbol in symbols])
    assert count == 49
    assert progress["committed_count"] == 49
    assert progress["base_count"] == 49
    assert progress["session_admitted"] == symbols[1:]
    assert progress["session_errors"] == ["B00"]
    assert progress["error_count"] == 1
    assert progress["stage_stats"]["screener"]["success"] == 49
    assert progress["stage_stats"]["screener"]["base_errors"] == 1
    async with stores.sessions() as session:
        assert set(await session.scalars(select(StockPrice.symbol))) == set(symbols[1:] if table == "stock_prices" else symbols)
        assert set(await session.scalars(select(ScreenerSnapshot.symbol))) == set(symbols[1:])
        assert not (await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == "screener_universe"))).all()


@pytest.mark.asyncio
@pytest.mark.parametrize("damage", ["raw", "envelope", "price", "active_membership"])
async def test_receipt_revalidates_durable_evidence_and_membership(admission_stores, monkeypatch, damage):
    stores = admission_stores
    symbols = [f"B{index:02d}" for index in range(50)]
    original = stores.service.retain_market_sessions

    def retain_then_damage(records):
        retained = original(records)
        if damage in {"raw", "envelope"}:
            dataset = "equity.price_board" if damage == "raw" else "equity.price_board_envelope"
            stores.mongo.market_vnstock_premium_records.delete_many({"dataset": dataset})
        return retained

    monkeypatch.setattr(stores.service, "retain_market_sessions", retain_then_damage)
    if damage in {"price", "active_membership"}:
        async with stores.sessions.begin() as session:
            statement = (
                "UPDATE stock_prices SET close = 1 WHERE symbol = NEW.symbol;"
                if damage == "price" else "UPDATE stocks SET is_active = 0 WHERE symbol = 'B49';"
            )
            await session.execute(text(f"CREATE FUNCTION damage_evidence() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN {statement} RETURN NEW; END $$"))
            await session.execute(text("CREATE TRIGGER damage_evidence AFTER INSERT ON screener_snapshots FOR EACH ROW EXECUTE FUNCTION damage_evidence()"))
    count, progress = await run_board(stores, monkeypatch, symbols, [board_row(symbol) for symbol in symbols])
    async with stores.sessions() as session:
        assert not (await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == "screener_universe"))).all()
        assert not (await CacheManager(db=session).get_screener_data()).hit
        assert len((await session.scalars(select(ScreenerSnapshot))).all()) == 50
    if damage != "active_membership":
        assert count == 0
        assert progress["base_count"] == 0
        assert progress["session_admitted"] == []
        assert progress["session_errors"] == symbols


@pytest.mark.asyncio
async def test_identical_complete_replay_preserves_cohort_identity(admission_stores, monkeypatch):
    stores = admission_stores
    assert (await run_board(stores, monkeypatch, ["AAA"], [board_row("AAA")]))[0] == 1

    async def durable_state():
        async with stores.sessions() as session:
            snapshot = await session.scalar(select(ScreenerSnapshot))
            price = await session.scalar(select(StockPrice))
            receipts = (await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == "screener_universe"))).all()
            return (
                (snapshot.id, snapshot.created_at, snapshot.extended_metrics, snapshot.price),
                (price.id, price.created_at, price.close, price.source),
                [(row.id, row.additional_data, row.completed_at) for row in receipts],
            )

    before = await durable_state()
    monkeypatch.setattr(pipeline_module.datetime, "utcnow", classmethod(lambda cls: datetime(2026, 10, 26, 10)))
    assert await DataPipeline().sync_screener_data(enrich_ratios=False, acquire_sessions=True) == 1
    assert await durable_state() == before


@pytest.mark.asyncio
async def test_cache_failure_cannot_publish_partial_cohort(admission_stores, monkeypatch):
    stores = admission_stores
    symbols = [f"B{index:02d}" for index in range(50)]
    observed_counts = []

    async def unavailable_cache(*args, **kwargs):
        async with stores.sessions() as session:
            reader = await CacheManager(db=session).get_screener_data()
            observed_counts.append(len(reader.data) if reader.hit else 0)
        raise ConnectionError("Disposable cache unavailable")

    async def cache_ready(self):
        return True

    monkeypatch.setattr(pipeline_module.redis_client, "set_json", unavailable_cache)
    monkeypatch.setattr(DataPipeline, "_ensure_redis", cache_ready)
    assert (await run_board(stores, monkeypatch, symbols, [board_row(symbol) for symbol in symbols]))[0] == 50
    assert observed_counts and set(observed_counts) <= {0, 50}
    async with stores.sessions() as session:
        assert (await CacheManager(db=session).get_screener_data()).hit


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["missing", "active_membership", "complete"])
async def test_same_day_recovery_replaces_only_a_complete_cohort(admission_stores, monkeypatch, failure):
    stores = admission_stores
    symbols = [f"B{index:02d}" for index in range(50)]
    async with stores.sessions.begin() as session:
        stocks = [Stock(symbol=symbol, is_active=1) for symbol in symbols]
        session.add_all(stocks)
        await session.flush()
        session.add_all([
            StockPrice(stock_id=stock.id, symbol=stock.symbol, time=date(2026, 10, 23),
                       open=10000, high=10000, low=10000, close=10000, volume=100,
                       interval="1D", source="vietcap_vnd")
            for stock in stocks
        ])
    pipeline = DataPipeline()
    pipeline.cache_writes_enabled = False
    assert await pipeline.sync_screener_data(enrich_ratios=False) == 50
    async with stores.sessions() as session:
        before = [(row.id, row.price, row.extended_metrics, row.created_at) for row in (
            await session.scalars(select(ScreenerSnapshot).order_by(ScreenerSnapshot.symbol))
        ).all()]
    rows = [board_row(symbol) for symbol in symbols]
    if failure == "missing":
        rows.pop()
    if failure == "active_membership":
        async def deactivate_after_materialization(progress, *args, **kwargs):
            assert progress["stage_stats"]["screener"]["success"] >= 20
            async with stores.sessions.begin() as session:
                await session.execute(text("UPDATE stocks SET is_active = 0 WHERE symbol = 'B49'"))

        monkeypatch.setattr(pipeline, "_save_progress", deactivate_after_materialization)
    monkeypatch.setattr(VietcapClient, "get_price_board", lambda *args, **kwargs: deepcopy(rows))
    await pipeline.sync_screener_data(enrich_ratios=False, acquire_sessions=True, progress={}, sync_id=123 if failure == "active_membership" else None)
    async with stores.sessions() as session:
        snapshots = (await session.scalars(select(ScreenerSnapshot).order_by(ScreenerSnapshot.symbol))).all()
        receipts = (await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == "screener_universe"))).all()
        prices = set(await session.scalars(select(StockPrice.symbol).where(StockPrice.time == SESSION)))
        assert prices == set(symbols[:-1] if failure == "missing" else symbols)
        if failure == "complete":
            assert len(receipts) == 2
            assert all(row.price == 11000 and row.trade_date == SESSION for row in snapshots)
            assert [row.id for row in snapshots] == [row[0] for row in before]
            assert [row.created_at for row in snapshots] == [row[3] for row in before]
            reader = await CacheManager(db=session).get_screener_data()
            assert reader.hit and not reader.is_stale
        else:
            assert len(receipts) == 1
            assert [(row.id, row.price, row.extended_metrics, row.created_at) for row in snapshots] == before


@pytest.mark.asyncio
async def test_complete_cohort_preserves_null_no_trade_and_suspended_prices(admission_stores, monkeypatch):
    stores = admission_stores
    symbols = [f"B{index:02d}" for index in range(50)]
    rows = [board_row(symbol) for symbol in symbols]
    for row in rows[-2:]:
        row["matchPrice"].update(openPrice=None, highest=0, lowest=0, matchPrice=0, accumulatedVolume=0)
    rows[-1]["listingInfo"].update(tradingStatus="TRADING_SUSPENSION", tradingStatusCode="110", securityStatus="Y")
    assert (await run_board(stores, monkeypatch, symbols, rows))[0] == 50
    async with stores.sessions() as session:
        reader = await CacheManager(db=session).get_screener_data()
        assert reader.hit and not reader.is_stale
        assert reader.market_session_counts == {"qualified": 50, "traded": 48, "no_trade": 1, "suspended": 1}
        empty = [row for row in reader.data if row.symbol in symbols[-2:]]
        assert len(empty) == 2
        assert all(row.price is None and row.trade_date is None and row.volume == 0 for row in empty)
        assert len((await session.scalars(select(StockPrice))).all()) == 48

    def census_engine(url, **kwargs):
        assert url == stores.pg_url
        connect_args = {**kwargs.pop("connect_args", {}), "server_settings": {"search_path": stores.mongo.name}}
        return create_async_engine(url, **kwargs, connect_args=connect_args)

    monkeypatch.setattr(sqlalchemy_async, "create_async_engine", census_engine)
    settings = SimpleNamespace(database_url=stores.pg_url, mongodb_url=stores.mongo_url,
                               mongodb_database=stores.mongo.name, redis_url="")
    admitted = await _admitted(settings)
    assert admitted["hit"] and admitted["count"] == 50
    assert admitted["symbols"] == symbols
    assert admitted["market_session_counts"] == {"qualified": 50, "traded": 48, "no_trade": 1, "suspended": 1}
    assert admitted["whole_market_verified"] is False
    async with stores.sessions() as session:
        captured = [dict(row) for row in (await session.execute(text("""
            SELECT u.symbol, to_jsonb(s) snapshot_row, to_jsonb(p) price_row
            FROM stocks u LEFT JOIN screener_snapshots s ON s.symbol=u.symbol
            LEFT JOIN stock_prices p ON p.symbol=u.symbol WHERE u.is_active=1 ORDER BY u.symbol
        """))).mappings()]
        receipts = list(await session.scalars(text("SELECT to_jsonb(r) FROM sync_status r WHERE sync_type='screener_universe'")))
    stores.mongo.market_vnstock_premium_records.create_index(
        [("dataset", 1), ("symbol", 1), ("observedAt", -1)], name="idx_dataset_symbol_observedAt_desc",
    )
    stores.mongo.market_prices_eod.create_index(
        [("symbol", 1), ("tradeDate", -1)], name="idx_symbol_tradeDate_desc",
    )
    retained, cache, envelopes = _retained(settings, symbols, SESSION, 3000)
    report = reconcile_census(captured, retained, cache, receipts, admitted, SESSION, OBSERVED)
    assert report["durable"]["current_sql_session_qualified"] == 50
    assert report["durable"]["null_actual_snapshot_prices"] == 2
    assert not {"sql_session_invalid", "mongo_sql_session_lineage_mismatch", "not_in_admitted_universe"} & report["reason_counts"].keys()
    assert captured[0]["snapshot_row"]["trade_date"] == "2026-10-26"
    assert len(envelopes) == 1 and all(retained[symbol]["envelope_keys"] for symbol in symbols)

    collection = stores.mongo.market_vnstock_premium_records
    received = envelopes[0]
    for damage in ("empty", "unrelated", "changed", "unrequested", "wrong_session"):
        envelope = deepcopy(received)
        if damage == "empty":
            envelope["raw"] = []
        elif damage == "unrelated":
            envelope["raw"] = [board_row("OTHER")]
        elif damage == "changed":
            envelope["raw"][0]["matchPrice"]["matchPrice"] = 10500
        elif damage == "unrequested":
            envelope["requested_symbols"] = symbols[1:]
        else:
            envelope["session_date"] = "2026-10-23"
        collection.replace_one({"recordKey": received["recordKey"]}, envelope)
        retained, cache, _ = _retained(settings, symbols, SESSION, 3000)
        report = reconcile_census(captured, retained, cache, receipts, admitted, SESSION, OBSERVED)
        assert "mongo_received_envelope_missing" in report["rows"][0]["reasons"], damage


@pytest.mark.asyncio
async def test_conflicting_stored_price_is_preserved_without_poisoning_later_rows(admission_stores, monkeypatch):
    stores = admission_stores
    async with stores.sessions.begin() as session:
        stocks = [Stock(symbol=symbol, is_active=1) for symbol in ["AAA", "BBB"]]
        session.add_all(stocks)
        await session.flush()
        price = StockPrice(
            stock_id=stocks[0].id, symbol="AAA", time=SESSION, open=10000,
            high=12000, low=9000, close=10500, volume=100, interval="1D", source="vietcap_vnd",
        )
        session.add(price)
        await session.flush()
        original = (price.id, price.created_at, price.close, price.source)
    monkeypatch.setattr(VietcapClient, "get_price_board", lambda *args, **kwargs: [board_row("AAA"), board_row("BBB")])
    progress = {}
    assert await DataPipeline().sync_screener_data(enrich_ratios=False, acquire_sessions=True, progress=progress) == 1
    assert progress["session_admitted"] == ["BBB"]
    assert progress["session_errors"] == ["AAA"]
    async with stores.sessions() as session:
        retained = await session.scalar(select(StockPrice).where(StockPrice.symbol == "AAA"))
        assert (retained.id, retained.created_at, retained.close, retained.source) == original
        assert set(await session.scalars(select(ScreenerSnapshot.symbol))) == {"BBB"}
        assert not (await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == "screener_universe"))).all()


@pytest.mark.asyncio
async def test_rejected_complete_membership_cannot_be_promoted_by_legacy_sync(admission_stores, monkeypatch):
    stores = admission_stores
    symbols = ["AAA", "BBB"]
    async with stores.sessions.begin() as session:
        stocks = [Stock(symbol=symbol, is_active=1) for symbol in symbols]
        session.add_all(stocks)
        await session.flush()
        session.add_all([
            StockPrice(stock_id=stock.id, symbol=stock.symbol, time=date(2026, 10, 23),
                       open=10000, high=10000, low=10000, close=10000, volume=100,
                       interval="1D", source="vietcap_vnd")
            for stock in stocks
        ])

    class PreviousDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 10, 23, 9, tzinfo=UTC).astimezone(tz)

        @classmethod
        def utcnow(cls):
            return datetime(2026, 10, 23, 9)

    current_datetime = pipeline_module.datetime
    monkeypatch.setattr(pipeline_module, "datetime", PreviousDateTime)
    monkeypatch.setattr(cache_module, "datetime", PreviousDateTime)
    pipeline = DataPipeline()
    pipeline.cache_writes_enabled = False
    assert await pipeline.sync_screener_data(enrich_ratios=False) == 2
    async with stores.sessions() as session:
        previous = await CacheManager(db=session).get_screener_data()
        assert previous.hit and not previous.is_stale
        original = [(row.id, row.symbol, row.price, row.trade_date, row.extended_metrics) for row in previous.data]
        original_receipts = [(row.id, row.additional_data) for row in (await session.scalars(
            select(SyncStatus).where(SyncStatus.sync_type == "screener_universe")
        )).all()]

    monkeypatch.setattr(pipeline_module, "datetime", current_datetime)
    monkeypatch.setattr(cache_module, "datetime", current_datetime)
    rows = [board_row(symbol) for symbol in symbols] + [{}]
    monkeypatch.setattr(VietcapClient, "get_price_board", lambda *args, **kwargs: deepcopy(rows))
    progress = {}
    assert await pipeline.sync_screener_data(enrich_ratios=False, acquire_sessions=True, progress=progress) == 2
    assert progress["session_admitted"] == symbols
    assert not progress["session_input_complete"]
    await pipeline.sync_screener_data(enrich_ratios=False, acquire_sessions=False)

    async with stores.sessions() as session:
        receipts = (await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == "screener_universe"))).all()
        assert [(row.id, row.additional_data) for row in receipts] == original_receipts
        fresh = await CacheManager(db=session).get_screener_data()
        assert not fresh.hit or fresh.is_stale
        previous = await CacheManager(db=session).get_screener_data(allow_stale=True)
        assert previous.hit and previous.is_stale
        assert [(row.id, row.symbol, row.price, row.trade_date, row.extended_metrics) for row in previous.data] == original


@pytest.mark.asyncio
async def test_failed_board_fetch_preserves_independent_same_session_legacy_prices(admission_stores, monkeypatch):
    stores = admission_stores
    symbols = ["AAA", "BBB"]
    async with stores.sessions.begin() as session:
        stocks = [Stock(symbol=symbol, is_active=1) for symbol in symbols]
        session.add_all(stocks)
        await session.flush()
        session.add_all([
            StockPrice(stock_id=stock.id, symbol=stock.symbol, time=SESSION,
                       open=10000, high=12000, low=9000, close=11000, volume=100,
                       interval="1D", source="vietcap_vnd")
            for stock in stocks
        ])
    monkeypatch.setattr(VietcapClient, "get_price_board", lambda *args, **kwargs: [])
    pipeline = DataPipeline()
    pipeline.cache_writes_enabled = False
    progress = {}
    assert await pipeline.sync_screener_data(enrich_ratios=False, acquire_sessions=True, progress=progress) == 0
    assert progress["session_errors"] == symbols
    assert await pipeline.sync_screener_data(enrich_ratios=False, acquire_sessions=False) == 2
    async with stores.sessions() as session:
        result = await CacheManager(db=session).get_screener_data()
        assert result.hit and not result.is_stale
        assert {row.symbol for row in result.data} == set(symbols)
        assert all(row.price == 11000 and row.trade_date == SESSION for row in result.data)


@pytest.mark.asyncio
async def test_interrupted_board_acquisition_cannot_promote_inserted_prices(admission_stores, monkeypatch):
    stores = admission_stores
    symbols = [f"B{index:02d}" for index in range(20)]
    async with stores.sessions.begin() as session:
        session.add_all([Stock(symbol=symbol, is_active=1) for symbol in symbols])
    monkeypatch.setattr(VietcapClient, "get_price_board", lambda *args, **kwargs: [board_row(symbol) for symbol in symbols])
    pipeline = DataPipeline()
    pipeline.cache_writes_enabled = False

    class Interrupted(BaseException):
        pass

    async def interrupt_progress(*args, **kwargs):
        raise Interrupted()

    monkeypatch.setattr(pipeline, "_save_progress", interrupt_progress)
    with pytest.raises(Interrupted):
        await pipeline.sync_screener_data(enrich_ratios=False, acquire_sessions=True, progress={}, sync_id=123)
    await pipeline.sync_screener_data(enrich_ratios=False, acquire_sessions=False)
    async with stores.sessions() as session:
        assert not (await CacheManager(db=session).get_screener_data()).hit
        assert not (await session.scalars(select(SyncStatus).where(
            SyncStatus.sync_type == "screener_universe", SyncStatus.status == "completed"
        ))).all()


@pytest.mark.asyncio
async def test_old_no_trade_receipt_cannot_certify_later_rejected_traded_price(admission_stores, monkeypatch):
    stores = admission_stores
    symbols = ["AAA", "BBB"]
    no_trade = board_row("AAA")
    no_trade["matchPrice"].update(openPrice=None, highest=0, lowest=0, matchPrice=0, accumulatedVolume=0)
    assert (await run_board(stores, monkeypatch, symbols, [no_trade, board_row("BBB")]))[0] == 2
    async with stores.sessions() as session:
        before = await CacheManager(db=session).get_screener_data()
        assert before.hit and not before.is_stale
        original = {row.symbol: (row.id, row.price, row.trade_date, deepcopy(row.extended_metrics)) for row in before.data}
        assert original["AAA"][1:3] == (None, None)
        receipts = (await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == "screener_universe"))).all()
        original_receipts = [(row.id, deepcopy(row.additional_data)) for row in receipts]
        assert len(original_receipts) == 1

    deleted = stores.mongo.market_vnstock_premium_records.delete_one({
        "dataset": "equity.price_board", "symbol": "AAA", "session_date": SESSION.isoformat(),
    })
    assert deleted.deleted_count == 1
    monkeypatch.setattr(VietcapClient, "get_price_board", lambda *args, **kwargs: [board_row("AAA"), board_row("BBB"), {}])
    pipeline = DataPipeline()
    pipeline.cache_writes_enabled = False
    progress = {}
    assert await pipeline.sync_screener_data(enrich_ratios=False, acquire_sessions=True, progress=progress) == 2
    assert not progress["session_input_complete"]
    async with stores.sessions() as session:
        price = await session.scalar(select(StockPrice).where(StockPrice.symbol == "AAA", StockPrice.time == SESSION))
        assert price is not None and price.close == 11000

    await pipeline.sync_screener_data(enrich_ratios=False, acquire_sessions=False)
    async with stores.sessions() as session:
        receipts = (await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == "screener_universe"))).all()
        assert [(row.id, row.additional_data) for row in receipts] == original_receipts
        after = await CacheManager(db=session).get_screener_data()
        assert after.hit and not after.is_stale
        assert {row.symbol: (row.id, row.price, row.trade_date, row.extended_metrics) for row in after.data} == original
