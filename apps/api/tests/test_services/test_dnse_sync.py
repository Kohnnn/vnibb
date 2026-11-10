"""DNSE import: additive writes, unit scaling, receipt, no overwrites, no credential echo."""

from datetime import date
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from vnibb.core import database
from vnibb.core.database import Base
from vnibb.models.stock import Stock, StockPrice
from vnibb.models.sync_status import SyncStatus
from vnibb.services import dnse_sync

BARS = [
    {"time": date(2026, 10, 1), "open": 59.4, "high": 59.6, "low": 58.5, "close": 58.6,
     "volume": 3690200, "price_unit": "THOUSAND_VND", "price_source": "dnse"},
    {"time": date(2026, 10, 2), "open": 59.0, "high": 59.0, "low": 57.3, "close": 57.3,
     "volume": 3579300, "price_unit": "THOUSAND_VND", "price_source": "dnse"},
]
KEY = "DNSE-KEY-SENTINEL-7f3a"
SECRET = "DNSE-SECRET-SENTINEL-91c2"


@pytest.fixture
async def service_engine():
    # The service opens its own sessions, so it gets its own in-memory database.
    engine = create_async_engine(database.settings.database_url, poolclass=StaticPool,
                                 connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


@pytest.fixture(autouse=True)
def use_test_engine(service_engine, monkeypatch):
    # dnse_sync binds both names at import, so patch them on that module.
    maker = async_sessionmaker(service_engine, expire_on_commit=False)
    monkeypatch.setattr(dnse_sync, "async_session_maker", maker)
    monkeypatch.setattr(dnse_sync, "engine", service_engine)
    monkeypatch.setattr(database, "async_session_maker", maker)


@pytest.fixture
async def seeded():
    async with dnse_sync.async_session_maker.begin() as session:
        session.add(Stock(symbol="VNM", exchange="HOSE"))


async def one(stmt):
    async with dnse_sync.async_session_maker() as session:
        return (await session.execute(stmt)).scalar_one()


async def all_rows(stmt):
    async with dnse_sync.async_session_maker() as session:
        return (await session.execute(stmt)).scalars().all()


@pytest.mark.asyncio
async def test_import_scales_thousand_vnd_and_leaves_turnover_null(seeded):
    with patch.object(dnse_sync.dnse, "fetch_daily_bars", AsyncMock(return_value=BARS)):
        receipt = await dnse_sync.sync_daily_prices(["vnm"], date(2026, 10, 1), date(2026, 10, 2))

    assert receipt["status"] == "completed"
    assert receipt["imported"] == 2
    row = await one(select(StockPrice).where(StockPrice.time == date(2026, 10, 1)))
    assert row.close == 58600.0
    assert row.volume == 3690200
    assert isinstance(row.volume, int)
    assert row.value is None
    assert row.source == "dnse_vnd"


@pytest.mark.asyncio
async def test_import_never_overwrites_an_existing_bar(seeded):
    async with dnse_sync.async_session_maker.begin() as session:
        session.add(StockPrice(stock_id=1, symbol="VNM", time=date(2026, 10, 1),
                               open=1.0, high=1.0, low=1.0, close=1.0, volume=5,
                               interval="1D", source="vietcap_vnd"))
    with patch.object(dnse_sync.dnse, "fetch_daily_bars", AsyncMock(return_value=BARS)):
        receipt = await dnse_sync.sync_daily_prices(["VNM"], date(2026, 10, 1), date(2026, 10, 2))

    assert (receipt["imported"], receipt["skipped_existing"]) == (1, 1)
    kept = await one(select(StockPrice).where(StockPrice.time == date(2026, 10, 1)))
    assert (kept.close, kept.source) == (1.0, "vietcap_vnd")


@pytest.mark.asyncio
async def test_rerun_is_idempotent_and_records_a_receipt(seeded):
    with patch.object(dnse_sync.dnse, "fetch_daily_bars", AsyncMock(return_value=BARS)):
        await dnse_sync.sync_daily_prices(["VNM"], date(2026, 10, 1), date(2026, 10, 2))
        second = await dnse_sync.sync_daily_prices(["VNM"], date(2026, 10, 1), date(2026, 10, 2))

    assert (second["imported"], second["skipped_existing"]) == (0, 2)
    assert len(await all_rows(select(StockPrice))) == 2
    receipts = await all_rows(select(SyncStatus).where(SyncStatus.sync_type == "dnse_daily_prices"))
    assert len(receipts) == 2


@pytest.mark.asyncio
async def test_unknown_symbol_is_reported_not_imported(seeded):
    fetch = AsyncMock(return_value=BARS)
    with patch.object(dnse_sync.dnse, "fetch_daily_bars", fetch):
        receipt = await dnse_sync.sync_daily_prices(["NOPE"], date(2026, 10, 1), date(2026, 10, 2))

    assert receipt["status"] == "partial"
    assert receipt["errors"] == {"NOPE": "symbol_not_in_stocks"}
    fetch.assert_not_awaited()


@pytest.mark.asyncio
async def test_one_failing_symbol_does_not_abort_the_run(seeded):
    async def fetch(symbol: str, *args, **kwargs):
        if symbol == "ERR":
            raise dnse_sync.dnse.ProviderError("DNSE /price/ohlc returned HTTP 500", "dnse")
        return BARS

    async with dnse_sync.async_session_maker.begin() as session:
        session.add(Stock(symbol="ERR", exchange="HOSE"))
    with patch.object(dnse_sync.dnse, "fetch_daily_bars", AsyncMock(side_effect=fetch)):
        receipt = await dnse_sync.sync_daily_prices(
            ["VNM", "ERR"], date(2026, 10, 1), date(2026, 10, 2)
        )

    assert receipt["status"] == "partial"
    assert receipt["imported"] == 2
    assert receipt["errors"] == {"ERR": "DNSE /price/ohlc returned HTTP 500"}


@pytest.mark.asyncio
async def test_disabled_client_fails_the_run_before_any_write(seeded):
    with pytest.raises(dnse_sync.dnse.DNSEConfigError):
        with patch.object(
            dnse_sync.dnse,
            "fetch_daily_bars",
            AsyncMock(side_effect=dnse_sync.dnse.DNSEConfigError("acquisition is disabled", "dnse")),
        ):
            await dnse_sync.sync_daily_prices(["VNM"], date(2026, 10, 1), date(2026, 10, 2))
    assert await all_rows(select(StockPrice)) == []


@pytest.mark.asyncio
async def test_persist_failure_is_reported_and_a_receipt_is_still_written(seeded):
    from sqlalchemy.exc import IntegrityError

    def failing_insert(*args, **kwargs):
        raise IntegrityError("INSERT INTO stock_prices", {}, Exception("constraint"))

    with patch.object(dnse_sync.dnse, "fetch_daily_bars", AsyncMock(return_value=BARS)), \
         patch.object(dnse_sync, "_dialect_insert", return_value=failing_insert):
        receipt = await dnse_sync.sync_daily_prices(["VNM"], date(2026, 10, 1), date(2026, 10, 2))

    assert receipt["status"] == "partial"
    assert receipt["imported"] == 0
    assert receipt["errors"] == {"VNM": "persist_failed:IntegrityError"}
    assert await all_rows(select(StockPrice)) == []
    stored = await one(select(SyncStatus).where(SyncStatus.sync_type == "dnse_daily_prices"))
    assert stored.error_count == 1


@pytest.mark.asyncio
async def test_receipt_never_contains_credentials_or_upstream_bodies(seeded, monkeypatch):
    """#231: only the provider's status/code reaches durable storage."""
    monkeypatch.setattr(dnse_sync.dnse.settings, "dnse_enabled", True)
    monkeypatch.setattr(dnse_sync.dnse.settings, "dnse_api_key", KEY)
    monkeypatch.setattr(dnse_sync.dnse.settings, "dnse_api_secret", SECRET)
    error = dnse_sync.dnse.ProviderError("DNSE /price/ohlc returned HTTP 401 (OA-401)", "dnse")
    with patch.object(dnse_sync.dnse, "fetch_daily_bars", AsyncMock(side_effect=error)):
        receipt = await dnse_sync.sync_daily_prices(["VNM"], date(2026, 10, 1), date(2026, 10, 2))

    stored = await one(select(SyncStatus).where(SyncStatus.sync_type == "dnse_daily_prices"))
    rendered = repr(receipt) + repr(stored.additional_data)
    for sentinel in (KEY, SECRET):
        assert sentinel not in rendered
    assert receipt["errors"] == {"VNM": "DNSE /price/ohlc returned HTTP 401 (OA-401)"}
