import asyncio
import os
from datetime import date, datetime
from uuid import uuid4

import pytest
from sqlalchemy import inspect, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker

from vnibb.models.company import Company
from vnibb.models.stock import Stock
from vnibb.services.cache_manager import CacheManager
from vnibb.services.data_quality import complete_quality_run

pytestmark = pytest.mark.skipif(
    os.environ.get("POSTGRES_CONTRACT") != "1",
    reason="requires the PostgreSQL release-contract database",
)


@pytest.mark.postgres_contract
@pytest.mark.asyncio
async def test_companies_schema_supports_generated_ids_and_symbol_upserts(test_db):
    assert test_db.bind.dialect.name == "postgresql"
    id_generation = (await test_db.execute(text(
        "SELECT a.attidentity, pg_get_expr(d.adbin, d.adrelid) AS default_expression "
        "FROM pg_attribute a LEFT JOIN pg_attrdef d "
        "ON d.adrelid=a.attrelid AND d.adnum=a.attnum "
        "WHERE a.attrelid='companies'::regclass AND a.attname='id'"
    ))).one()
    assert id_generation.attidentity or id_generation.default_expression
    assert (await test_db.execute(text(
        "SELECT EXISTS (SELECT 1 FROM pg_index i JOIN pg_attribute a "
        "ON a.attrelid=i.indrelid AND a.attnum=i.indkey[0] "
        "WHERE i.indrelid='companies'::regclass AND a.attname='symbol' "
        "AND i.indisunique AND i.indisvalid AND i.indisready AND i.indimmediate "
        "AND i.indnkeyatts=1 AND i.indpred IS NULL AND i.indexprs IS NULL)"
    ))).scalar_one(), "companies requires an immediate unique symbol index for ON CONFLICT"


@pytest.mark.postgres_contract
@pytest.mark.asyncio
async def test_concurrent_first_cache_writes_are_atomic_and_persisted(test_db):
    symbol = f"C{uuid4().hex[:8]}".upper()
    session_factory = async_sessionmaker(test_db.bind, expire_on_commit=False)

    async def write_listing():
        async with session_factory() as session:
            return await CacheManager(session).store_listing_data(
                [{"symbol": symbol, "company_name": "Listing Company"}]
            )

    async def write_profile():
        async with session_factory() as session:
            return await CacheManager(session).store_profile_data(
                symbol, {"company_name": "Profile Company", "website": "https://example.test"}
            )

    try:
        assert await asyncio.gather(write_listing(), write_listing()) == [1, 1]
        assert await asyncio.gather(write_profile(), write_profile()) == [True, True]
        assert (await test_db.execute(select(Stock.symbol).where(Stock.symbol == symbol))).scalar_one() == symbol
        assert (await test_db.execute(select(Company.symbol).where(Company.symbol == symbol))).scalar_one() == symbol
    finally:
        await test_db.execute(Stock.__table__.delete().where(Stock.symbol == symbol))
        await test_db.execute(Company.__table__.delete().where(Company.symbol == symbol))
        await test_db.commit()


@pytest.mark.postgres_contract
@pytest.mark.asyncio
async def test_postgres_release_contract_uses_migrated_tables_and_api_routes(client, admin_client, test_db):
    assert test_db.bind is not None
    assert test_db.bind.dialect.name == "postgresql"

    table_names = await test_db.run_sync(lambda session: inspect(session.bind).get_table_names())

    assert {"stocks", "sync_status", "data_quality_runs", "data_quality_breach_states"} <= set(table_names)

    screener_columns = await test_db.run_sync(
        lambda session: {
            column["name"]
            for column in inspect(session.bind).get_columns("screener_snapshots")
        }
    )
    assert "trade_date" in screener_columns

    await complete_quality_run(
        test_db,
        run_id="postgres-contract:2026-07-16",
        status="ok",
        completed_at=datetime(2026, 7, 16, 10, 0),
        observed_market_date=date(2026, 7, 16),
        latest_market_date=date(2026, 7, 16),
        market_day_staleness_value=0,
        summary_counts={"warning_count": 0},
        error_category=None,
    )

    ready = await client.get("/ready")
    detailed = await client.get("/health/detailed")
    data_health = await admin_client.get("/api/v1/admin/data-health")

    assert ready.status_code == 200
    assert ready.json()["ready"] is True
    assert detailed.status_code == 200
    assert detailed.json()["components"]["database"]["status"] == "healthy"
    assert data_health.status_code == 200
    assert data_health.json()["data_quality"]["last_successful_run"]["run_id"] == "postgres-contract:2026-07-16"


@pytest.mark.postgres_contract
@pytest.mark.asyncio
async def test_session_timeouts_survive_rollback_commit_and_pool_reuse():
    from vnibb.core import database
    from vnibb.core.config import settings

    expected = {
        "statement_timeout": settings.db_statement_timeout_ms,
        "lock_timeout": settings.db_lock_timeout_ms,
        "idle_in_transaction_session_timeout": settings.db_idle_in_tx_timeout_ms,
    }
    assert all(value > 0 for value in expected.values()), "Contract requires nonzero timeouts"
    timeout_query = text(
        "SELECT name, setting::integer FROM pg_settings WHERE name IN "
        "('statement_timeout', 'lock_timeout', 'idle_in_transaction_session_timeout')"
    )
    pid_query = text("SELECT pg_backend_pid()")

    await database.engine.dispose()
    database.sync_engine.dispose()
    try:
        async with database.async_session_factory() as session:
            async_pid = (await session.execute(pid_query)).scalar_one()
            assert dict((await session.execute(timeout_query)).all()) == expected
            await session.rollback()
            assert dict((await session.execute(timeout_query)).all()) == expected
            await session.commit()
            assert dict((await session.execute(timeout_query)).all()) == expected
        async with database.async_session_factory() as session:
            assert (await session.execute(pid_query)).scalar_one() == async_pid
            assert dict((await session.execute(timeout_query)).all()) == expected

        with database.sync_session_factory() as session:
            sync_pid = session.execute(pid_query).scalar_one()
            assert dict(session.execute(timeout_query).all()) == expected
            session.rollback()
            assert dict(session.execute(timeout_query).all()) == expected
            session.commit()
            assert dict(session.execute(timeout_query).all()) == expected
        with database.sync_session_factory() as session:
            assert session.execute(pid_query).scalar_one() == sync_pid
            assert dict(session.execute(timeout_query).all()) == expected
    finally:
        await database.engine.dispose()
        database.sync_engine.dispose()


@pytest.mark.postgres_contract
@pytest.mark.asyncio
async def test_screener_quote_base_preserves_ratio_metadata_on_postgres(test_db, monkeypatch):
    from vnibb.models.screener import ScreenerSnapshot
    from vnibb.models.stock import StockPrice
    from vnibb.providers.vnstock import runtime
    from vnibb.services import data_pipeline as pipeline_module

    symbol = f"S{uuid4().hex[:8]}".upper()
    today = datetime.utcnow().date()
    trade_date = date(2026, 10, 14)
    sessions = async_sessionmaker(test_db.bind, expire_on_commit=False)
    monkeypatch.setattr(pipeline_module, "async_session_maker", sessions)
    monkeypatch.setattr(pipeline_module, "engine", test_db.bind)

    class NoProvider:
        def __init__(self, *args, **kwargs):
            raise AssertionError("Retained quote assembly must not acquire provider data")

    async def no_cache(*args, **kwargs):
        return None

    monkeypatch.setattr(runtime, "get_listing_class", lambda: NoProvider)
    monkeypatch.setattr(runtime, "import_vnstock_symbol", lambda name: (NoProvider, "vnstock"))
    monkeypatch.setattr(runtime, "get_quote_class", lambda: NoProvider)
    pipeline = pipeline_module.DataPipeline()
    monkeypatch.setattr(pipeline, "_cache_set_json", no_cache)
    evidence = [{"source": "fixture", "observation_date": "2025-12-31"}]
    try:
        stock = Stock(symbol=symbol, is_active=1)
        test_db.add(stock)
        await test_db.flush()
        test_db.add_all([
            StockPrice(stock_id=stock.id, symbol=symbol, time=trade_date,
                       open=100, high=100, low=100, close=100, volume=0,
                       interval="1D", source="vnstock_vnd:VCI"),
            ScreenerSnapshot(symbol=symbol, snapshot_date=today, trade_date=trade_date,
                             price=90, pe=12, roe=15, extended_metrics={
                                 "price_unit": "VND", "price_source": "vnstock_vnd:VCI",
                                 "ratio_units": {"roe": "percent"}, "provider_evidence": evidence,
                             }),
        ])
        await test_db.commit()
        progress = {}
        assert await pipeline.sync_screener_data(symbols=[symbol], progress=progress, enrich_ratios=False) == 1
        async with sessions() as session:
            row = (await session.scalars(select(ScreenerSnapshot).where(ScreenerSnapshot.symbol == symbol))).one()
            assert row.price == 100 and row.volume == 0 and row.trade_date == trade_date
            assert row.pe == 12 and row.roe == 15 and row.market_cap is None
            assert row.extended_metrics["price_unit"] == "VND"
            assert row.extended_metrics["ratio_units"] == {"roe": "percent"}
            assert row.extended_metrics["provider_evidence"] == evidence
    finally:
        await test_db.execute(ScreenerSnapshot.__table__.delete().where(ScreenerSnapshot.symbol == symbol))
        await test_db.execute(StockPrice.__table__.delete().where(StockPrice.symbol == symbol))
        await test_db.execute(Stock.__table__.delete().where(Stock.symbol == symbol))
        await test_db.commit()


@pytest.mark.postgres_contract
@pytest.mark.asyncio
@pytest.mark.parametrize("refresh", [
    "quote_less", "changed_quote", "changed_session", "concurrent_publication", "locked_publication", "mixed_ownership",
])
async def test_postgres_request_refresh_preserves_admitted_session(test_db, monkeypatch, refresh):
    from datetime import UTC

    from vnibb.models.screener import ScreenerSnapshot
    from vnibb.models.sync_status import SyncStatus
    from vnibb.providers.vnstock.equity_screener import ScreenerData
    from vnibb.services import cache_manager
    from vnibb.services.market_session import qualify_market_session

    minute = [0]

    class FrozenDateTime(datetime):
        @classmethod
        def utcnow(cls):
            return cls(2026, 10, 26, 9, minute[0])

    monkeypatch.setattr(cache_manager, "datetime", FrozenDateTime)
    symbol = f"S{uuid4().hex[:8]}".upper()
    legacy_symbol = f"{symbol}L"
    session_date = date(2026, 10, 26)
    observed = datetime(2026, 10, 26, 8, 12, tzinfo=UTC)
    raw = {
        "listingInfo": {
            "symbol": symbol, "ticker": symbol, "stockType": "STOCK", "type": "STOCK",
            "isDelisted": 0, "tradingDate": "2026-10-26", "receivedTime": "2026-10-26T01:44:00Z",
            "tradingStatus": "TRADING_ACTIVATED", "tradingStatusCode": "20", "securityStatus": "N",
        },
        "bidAsk": {"symbol": symbol, "session": "ENDED", "time": "2026-10-26T08:00:00Z", "receivedTime": "2026-10-26T08:00:03Z"},
        "matchPrice": {
            "symbol": symbol, "session": "ENDED", "time": "2026-10-26T08:00:00Z", "receivedTime": "2026-10-26T08:00:03Z",
            "matchPrice": 10000, "openPrice": 10000, "highest": 11000, "lowest": 9000, "accumulatedVolume": 100,
        },
    }
    evidence = qualify_market_session(raw, symbol, session_date, observed)
    assert evidence is not None
    receipt = SyncStatus(
        sync_type="screener_universe", status="completed", error_count=0, success_count=1,
        completed_at=observed.replace(tzinfo=None),
        additional_data={"snapshot_date": session_date.isoformat(), "market_session_date": session_date.isoformat(),
                         "expected_symbols": [symbol], "expected_count": 1},
    )
    row = ScreenerSnapshot(
        symbol=symbol, snapshot_date=session_date, trade_date=session_date,
        price=10000, volume=100, source="vietcap_vnd", created_at=observed.replace(tzinfo=None),
        extended_metrics={"price_unit": "VND", "price_source": "vietcap_vnd", "market_session": evidence},
    )
    try:
        payload = ScreenerData(symbol=symbol, pe=12).model_dump()
        if refresh in {"changed_quote", "concurrent_publication", "locked_publication", "mixed_ownership"}:
            payload.update(price=20000, volume=200, trade_date=session_date)
        elif refresh == "changed_session":
            payload["market_session"] = {**evidence, "session_date": "2026-10-23"}
        if refresh == "concurrent_publication":
            entered, release = asyncio.Event(), asyncio.Event()
            sessions = async_sessionmaker(test_db.bind, expire_on_commit=False)
            async with sessions() as writer:
                execute = writer.execute

                async def paused_execute(*args, **kwargs):
                    entered.set()
                    await release.wait()
                    return await execute(*args, **kwargs)

                monkeypatch.setattr(writer, "execute", paused_execute)
                refresh_task = asyncio.create_task(CacheManager(db=writer).store_screener_data([payload], source="VCI"))
                try:
                    await asyncio.wait_for(entered.wait(), timeout=5)
                    minute[0] = 1
                    receipt.completed_at = FrozenDateTime.utcnow()
                    test_db.add_all([Stock(symbol=symbol, is_active=1), row, receipt])
                    await test_db.commit()
                finally:
                    release.set()
                    result = await refresh_task
                assert result == 1
        elif refresh == "locked_publication":
            sessions = async_sessionmaker(test_db.bind, expire_on_commit=False)
            async with sessions() as writer:
                writer_pid = await writer.scalar(text("SELECT pg_backend_pid()"))
                await test_db.execute(text("LOCK TABLE screener_snapshots IN SHARE ROW EXCLUSIVE MODE"))
                test_db.add_all([Stock(symbol=symbol, is_active=1), row, receipt])
                await test_db.flush()
                refresh_task = asyncio.create_task(CacheManager(db=writer).store_screener_data([payload], source="VCI"))

                async def wait_for_writer_lock():
                    while not await test_db.scalar(text(
                        "SELECT EXISTS (SELECT 1 FROM pg_locks WHERE pid=:pid "
                        "AND relation='screener_snapshots'::regclass AND NOT granted)"
                    ), {"pid": writer_pid}):
                        await asyncio.sleep(0.01)

                try:
                    await asyncio.wait_for(wait_for_writer_lock(), timeout=5)
                    assert not refresh_task.done()
                finally:
                    await test_db.commit()
                    result = await refresh_task
                assert result == 1
        else:
            test_db.add_all([Stock(symbol=symbol, is_active=1), row, receipt])
            if refresh == "mixed_ownership":
                test_db.add(ScreenerSnapshot(
                    symbol=legacy_symbol, snapshot_date=session_date, trade_date=session_date,
                    price=9000, volume=90, source="legacy",
                    extended_metrics={"price_unit": "VND", "price_source": "vnstock_vnd:VCI"},
                ))
            await test_db.commit()
            admitted = await CacheManager(db=test_db).get_screener_data(symbol=symbol, source=None, allow_stale=False)
            assert admitted.hit and not admitted.is_stale
            payloads = [payload]
            if refresh == "mixed_ownership":
                payloads.append({"symbol": legacy_symbol, "price": 11000, "volume": 110, "trade_date": session_date, "pe": 13})
            assert await CacheManager(db=test_db).store_screener_data(payloads, source="VCI") == len(payloads)
            if refresh == "mixed_ownership":
                legacy = (await test_db.scalars(select(ScreenerSnapshot).where(ScreenerSnapshot.symbol == legacy_symbol))).one()
                await test_db.refresh(legacy)
                assert (legacy.price, legacy.volume, legacy.pe) == (11000, 110, 13)
        await test_db.refresh(row)
        cached = await CacheManager(db=test_db).get_screener_data(symbol=symbol, source=None, allow_stale=False)
        assert cached.hit and not cached.is_stale
        assert (row.price, row.volume, row.trade_date, row.pe) == (10000, 100, session_date, 12)
        assert row.created_at == observed.replace(tzinfo=None)
        assert row.extended_metrics["market_session"] == evidence
        assert row.extended_metrics["price_unit"] == "VND"
        assert row.extended_metrics["price_source"] == "vietcap_vnd"
    finally:
        await test_db.execute(ScreenerSnapshot.__table__.delete().where(ScreenerSnapshot.symbol.in_([symbol, legacy_symbol])))
        if receipt.id is not None:
            await test_db.execute(SyncStatus.__table__.delete().where(SyncStatus.id == receipt.id))
        await test_db.execute(Stock.__table__.delete().where(Stock.symbol == symbol))
        await test_db.commit()
