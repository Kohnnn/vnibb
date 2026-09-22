from __future__ import annotations

import importlib.util
from datetime import date, datetime, timedelta
from pathlib import Path

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from vnibb.api.v1.screener import _build_screener_meta
from vnibb.models.screener import ScreenerSnapshot
from vnibb.providers.vnstock.equity_screener import (
    ScreenerData,
    StockScreenerParams,
    VnstockScreenerFetcher,
)
from vnibb.services.cache_manager import CacheManager
from vnibb.services.data_pipeline import get_upsert_stmt

TODAY = datetime.utcnow().date()


def test_screener_transform_preserves_provider_trade_date():
    rows = VnstockScreenerFetcher.transform_data(
        StockScreenerParams(symbol="VNM"),
        [
            {
                "ticker": "VNM",
                "close": 60.3,
                "volume": 2_522_300,
                "trade_date": "2026-09-21",
            }
        ],
    )

    assert rows[0].trade_date == date(2026, 9, 21)


def test_screener_meta_prefers_market_trade_date_over_write_timestamp():
    meta = _build_screener_meta(
        [
            ScreenerData(
                symbol="VNM",
                price=60.3,
                tradeDate=date(2026, 9, 19),
                updated_at=datetime(2026, 9, 22, 1, 0),
            )
        ]
    )

    assert meta.last_data_date == "2026-09-19"


@pytest.mark.asyncio
async def test_cache_store_persists_row_trade_date(test_db: AsyncSession):
    manager = CacheManager(db=test_db)
    await manager.store_screener_data(
        [{"symbol": "VNM", "price": 60.3, "tradeDate": "2026-09-21"}],
        source="KBS",
    )

    row = (
        await test_db.execute(select(ScreenerSnapshot).where(ScreenerSnapshot.symbol == "VNM"))
    ).scalar_one()
    assert row.snapshot_date == TODAY
    assert row.trade_date == date(2026, 9, 21)


@pytest.mark.asyncio
async def test_cache_freshness_prefers_trade_date(test_db: AsyncSession):
    test_db.add(
        ScreenerSnapshot(
            symbol="VNM",
            snapshot_date=TODAY,
            trade_date=TODAY - timedelta(days=4),
            source="KBS",
            price=60.3,
        )
    )
    await test_db.commit()

    result = await CacheManager(db=test_db).get_screener_data(
        source="KBS", allow_stale=True
    )

    assert result.hit is True
    assert result.is_stale is True


@pytest.mark.asyncio
async def test_cache_freshness_falls_back_for_legacy_rows(test_db: AsyncSession):
    test_db.add(
        ScreenerSnapshot(
            symbol="VNM",
            snapshot_date=TODAY,
            trade_date=None,
            source="KBS",
            price=60.3,
        )
    )
    await test_db.commit()

    result = await CacheManager(db=test_db).get_screener_data(
        source="KBS", allow_stale=True
    )

    assert result.hit is True
    assert result.is_stale is False

@pytest.mark.asyncio
async def test_full_sync_upsert_cannot_split_existing_price_and_trade_date(
    test_db: AsyncSession,
):
    existing_trade_date = TODAY - timedelta(days=1)
    test_db.add(
        ScreenerSnapshot(
            symbol="VNM",
            snapshot_date=TODAY,
            trade_date=existing_trade_date,
            source="KBS",
            price=60.3,
        )
    )
    await test_db.commit()

    values = {
        "symbol": "VNM",
        "snapshot_date": TODAY,
        "trade_date": None,
        "source": "vnstock_ratio",
        "price": 60.4,
    }
    await test_db.execute(
        get_upsert_stmt(
            ScreenerSnapshot,
            ["symbol", "snapshot_date"],
            values,
            preserve_existing_on_null={"trade_date"},
            preserve_columns_without=("trade_date", {"price"}),
        )
    )
    await test_db.commit()

    row = (
        await test_db.execute(select(ScreenerSnapshot).where(ScreenerSnapshot.symbol == "VNM"))
    ).scalar_one()
    assert row.trade_date == existing_trade_date
    assert row.price == 60.3


@pytest.mark.asyncio
async def test_detailed_health_reports_trade_date_basis(
    client: AsyncClient, test_db: AsyncSession
):
    trade_date = TODAY - timedelta(days=2)
    test_db.add(
        ScreenerSnapshot(
            symbol="VNM",
            snapshot_date=TODAY,
            trade_date=trade_date,
            source="KBS",
            price=60.3,
        )
    )
    await test_db.commit()

    response = await client.get("/api/v1/health/detailed")
    assert response.status_code == 200
    database = response.json()["components"]["database"]
    assert database["screener_trade_date"] == trade_date.isoformat()
    assert database["screener_snapshot_age_days"] == 2
    assert database["screener_freshness_basis"] == "trade_date"


def test_trade_date_migration_is_nullable_expansion():
    migration_path = (
        Path(__file__).parents[2]
        / "migrations"
        / "versions"
        / "20260922_0200_add_screener_trade_date.py"
    )
    spec = importlib.util.spec_from_file_location("screener_trade_date_migration", migration_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    assert module.down_revision == "f0123456789a"
    assert module.COLUMN_NAME == "trade_date"
