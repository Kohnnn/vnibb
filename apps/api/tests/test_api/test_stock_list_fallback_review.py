from datetime import date

import pandas as pd
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from vnibb.core.config import settings
from vnibb.models.stock import Stock
from vnibb.providers.vnstock import runtime
from vnibb.services import data_pipeline as pipeline_module
from vnibb.services.data_pipeline import DataPipeline


@pytest.mark.asyncio
@pytest.mark.parametrize("unavailable", [None, "symbols_by_exchange", "symbols_by_industries"])
@pytest.mark.parametrize("already_inactive", [False, True])
async def test_fallback_preserves_status_and_persists_available_metadata(
    monkeypatch, tmp_path, unavailable, already_inactive,
):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'stocks.db'}")
    async with engine.begin() as connection:
        await connection.run_sync(Stock.__table__.create)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    delisted = date(2026, 3, 12)
    if already_inactive:
        async with sessions() as session:
            session.add(Stock(symbol="ZZZ", exchange="DELISTED", is_active=0, delisting_date=delisted))
            await session.commit()
    monkeypatch.setattr(pipeline_module, "engine", engine)
    monkeypatch.setattr(pipeline_module, "async_session_maker", sessions)
    monkeypatch.setattr(settings, "vnstock_source", "VCI")

    class Listing:
        def __init__(self, *, source):
            assert source == "VCI"

        def all_symbols(self):
            return pd.DataFrame([
                {"symbol": "ZZZ", "organName": "Test Company"},
                {"symbol": "ETF1", "organName": "Fund"},
                {"symbol": "YYY", "organName": "Unconfirmed"},
            ])

        def symbols_by_exchange(self):
            if unavailable == "symbols_by_exchange":
                raise RuntimeError("exchange unavailable")
            return pd.DataFrame([{"symbol": "ZZZ", "exchange": "HNX"}])

        def symbols_by_industries(self):
            if unavailable == "symbols_by_industries":
                raise RuntimeError("industry unavailable")
            return pd.DataFrame([{"symbol": "ZZZ", "industry": "Bank"}])

    async def confirmed(_client):
        return [
            {"symbol": "ZZZ", "type": "STOCK", "_listing_source": "VCI"},
            {"symbol": "ETF1", "type": "ETF", "_listing_source": "VCI"},
        ]

    writes = {}

    async def cache(key, value, ttl):
        writes[key] = value

    monkeypatch.setattr(runtime, "get_listing_class", lambda: Listing)
    pipeline = DataPipeline()
    monkeypatch.setattr(pipeline, "_fetch_trading_listing_rows", confirmed)
    monkeypatch.setattr(pipeline, "_cache_set_json", cache)
    progress = {}
    try:
        count = await pipeline.sync_stock_list(progress=progress)
        async with sessions() as session:
            stocks = (await session.scalars(select(Stock).order_by(Stock.symbol))).all()
        assert count == 1
        assert [stock.symbol for stock in stocks] == ["ZZZ"]
        assert stocks[0].is_active == (0 if already_inactive else 1)
        assert stocks[0].delisting_date == (delisted if already_inactive else None)
        expected_board = "UNKNOWN" if unavailable == "symbols_by_exchange" else "HNX"
        assert stocks[0].exchange == ("DELISTED" if already_inactive else expected_board)
        assert stocks[0].industry == (None if unavailable == "symbols_by_industries" else "Bank")
        assert stocks[0].sector == (None if unavailable == "symbols_by_industries" else "Ngân hàng")
        assert progress.get("error_count", 0) == (0 if unavailable is None else 1)
        assert progress["stage_stats"]["stock_list"] == {"success": 1, "errors": 0, "total": 1}
        if already_inactive:
            assert writes["vnibb:listing:symbols:VCI"] == []
            assert "vnibb:listing:symbol:ZZZ" not in writes
        else:
            assert writes["vnibb:listing:symbol:ZZZ"]["exchange"] == stocks[0].exchange
    finally:
        await engine.dispose()
