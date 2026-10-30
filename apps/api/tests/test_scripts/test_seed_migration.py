import importlib.util
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pandas as pd
import pytest


SCRIPTS = Path(__file__).resolve().parents[2] / "scripts"


def load_script(name):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.asyncio
async def test_metrics_uses_admission_aware_ratio_pipeline(monkeypatch):
    script = load_script("seed_metrics")
    sync = AsyncMock(return_value=2)
    monkeypatch.setattr(script, "data_pipeline", SimpleNamespace(sync_financial_ratios=sync))

    assert await script.seed_metrics(["FPT"]) == 2
    sync.assert_awaited_once_with(symbols=["FPT"], period="quarter")


@pytest.mark.asyncio
@pytest.mark.parametrize("name,function", [
    ("seed_screener_bulk", "seed_bulk"),
    ("seed_screener_fast", "seed_fast"),
])
async def test_screener_writers_use_admission_pipeline(monkeypatch, name, function):
    script = load_script(name)
    sync = AsyncMock(return_value=2)
    monkeypatch.setattr(script, "data_pipeline", SimpleNamespace(sync_screener_data=sync))
    assert await getattr(script, function)() == 2
    sync.assert_awaited_once_with()


@pytest.mark.asyncio
async def test_batch_seeder_preserves_limit_and_rejects_batch_size(monkeypatch):
    script = load_script("seed_screener_batch")
    sync = AsyncMock(return_value=2)
    monkeypatch.setattr(script, "data_pipeline", SimpleNamespace(sync_screener_data=sync))
    assert await script.seed_screener_batch(max_stocks=10)
    sync.assert_awaited_once_with(limit=10)
    with pytest.raises(ValueError, match="does not support batch_size"):
        await script.seed_screener_batch(batch_size=50)
    with pytest.raises(ValueError, match="max_stocks must be positive"):
        await script.seed_screener_batch(max_stocks=0)
    sync.assert_awaited_once()


@pytest.mark.asyncio
async def test_full_seed_uses_vci_index_ohlcv(monkeypatch):
    from vnibb.providers.vnstock import runtime
    from vnibb.services.data_pipeline import data_pipeline as shared_pipeline
    import sys

    pipeline_module = sys.modules[shared_pipeline.__class__.__module__]

    script = load_script("full_seed")
    calls = []
    writes = []

    class Market:
        def index(self, symbol):
            self.symbol = symbol
            return self

        def ohlcv(self, **kwargs):
            calls.append((self.symbol, kwargs))
            return pd.DataFrame([{
                "time": pd.Timestamp("2026-10-30"), "open": 100.0, "high": 102.0,
                "low": 99.0, "close": 101.0, "volume": 123,
            }])

    class Session:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def execute(self, statement):
            writes.append(statement)
            return SimpleNamespace(fetchall=lambda: [])

        commit = AsyncMock()

    monkeypatch.setattr(script, "async_session_maker", Session)
    monkeypatch.setattr(script, "data_pipeline", SimpleNamespace(
        sync_stock_list=AsyncMock(return_value=0),
        sync_screener_data=AsyncMock(return_value=0),
    ))
    monkeypatch.setattr(runtime, "import_vnstock_symbol", lambda name: (Market, "vnstock"))
    monkeypatch.setattr(pipeline_module, "get_upsert_stmt", lambda model, keys, values: values)

    await script.run_seeding()

    assert [symbol for symbol, _ in calls] == ["VNINDEX", "HNXINDEX", "UPCOMINDEX", "VN30INDEX"]
    assert all(kwargs["source"] == "VCI" and kwargs["floating"] is None for _, kwargs in calls)
    assert len(writes) == 5
    assert writes[1]["index_code"] == "VNINDEX"
    assert str(writes[1]["time"]) == "2026-10-30"
    assert writes[1]["close"] == 101.0
    assert writes[1]["volume"] == 123
