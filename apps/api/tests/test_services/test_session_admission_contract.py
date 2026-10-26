"""Offline admission against explicitly supplied, disposable loopback stores."""

from copy import deepcopy
from datetime import UTC, date, datetime
import ipaddress
import os
from types import SimpleNamespace
from urllib.parse import urlsplit
from uuid import uuid4

import pytest
from pymongo import MongoClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from vnibb.core.database import Base
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models.stock import Stock, StockPrice
from vnibb.models.sync_status import SyncStatus
from vnibb.services import data_pipeline as pipeline_module
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
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    try:
        yield SimpleNamespace(sessions=sessions, mongo=database, service=service)
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
            [(row.symbol, row.price, row.volume, row.trade_date, row.extended_metrics) for row in snapshots],
            [(row.symbol, row.time, row.open, row.high, row.low, row.close, row.volume, row.source) for row in prices],
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
