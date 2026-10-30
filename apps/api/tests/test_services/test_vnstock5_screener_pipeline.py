from datetime import date
from unittest.mock import AsyncMock

import pandas as pd
import pytest
from sqlalchemy import select
from vnibb.core.config import settings
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models.stock import Stock
from vnibb.providers.vnstock import runtime
from vnibb.services.pipeline.screener_pipeline import ScreenerPipeline


class EntitlementError(Exception):
    code = "VNSTOCK_TIER_ROUTE"


def _configure(monkeypatch, test_db, frame=None, error=None):
    calls = []
    class Fundamental:
        def equity(self, symbol):
            calls.append(("equity", symbol))
            return self
        def ratio(self, *, source, period, lang, format):
            calls.append(("ratio", source, period, lang, format))
            if error:
                raise error
            return frame
    class Session:
        async def __aenter__(self):
            return test_db
        async def __aexit__(self, *args):
            return False
    monkeypatch.setattr(settings, "vnstock_source", "VCI")
    monkeypatch.setattr(runtime, "import_vnstock_symbol", lambda name: (Fundamental, "vnstock"))
    pipeline = ScreenerPipeline()
    monkeypatch.setattr(pipeline, "_get_session", lambda: Session())
    monkeypatch.setattr(pipeline, "_wait_for_rate_limit", AsyncMock())
    return pipeline, calls


@pytest.mark.asyncio
async def test_pipeline_uses_latest_long_ratio_without_erasing_existing_quote(test_db, monkeypatch):
    test_db.add(Stock(symbol="VNM", is_active=1))
    test_db.add(ScreenerSnapshot(symbol="VNM", snapshot_date=date.today(), price=60300, volume=100,
                                 extended_metrics={"price_unit": "VND", "price_source": "stored_quote"}))
    await test_db.commit()
    frame = pd.DataFrame([
        {"id": "p_e", "period": "2024", "value": 10.0},
        {"id": "p_e", "period": "2025", "value": 12.0},
        {"id": "roe", "period": "2025", "unit": "fraction", "value": 0.25},
        {"id": "roa", "period": "2025", "value": 0.2},
    ])
    pipeline, calls = _configure(monkeypatch, test_db, frame)
    assert await pipeline.sync_screener_data(symbols=["VNM"]) == 1
    test_db.expire_all()
    row = (await test_db.execute(select(ScreenerSnapshot).where(ScreenerSnapshot.symbol == "VNM"))).scalar_one()
    assert calls == [("equity", "VNM"), ("ratio", "VCI", "year", "en", "long")]
    assert (row.price, row.volume, row.pe, row.roe, row.roa) == (60300, 100, 12, 25, None)
    assert row.extended_metrics["price_source"] == "stored_quote"
    assert row.extended_metrics["ratio_units"]["roa"] == "unknown"


@pytest.mark.asyncio
async def test_pipeline_propagates_plan_tier_failure_without_writes(test_db, monkeypatch):
    test_db.add(Stock(symbol="VNM", is_active=1))
    await test_db.commit()
    pipeline, calls = _configure(monkeypatch, test_db, error=EntitlementError("VNSTOCK_TIER_ROUTE"))
    with pytest.raises(EntitlementError, match="VNSTOCK_TIER_ROUTE"):
        await pipeline.sync_screener_data(symbols=["VNM"])
    assert len(calls) == 2
    assert (await test_db.execute(select(ScreenerSnapshot))).scalars().all() == []
