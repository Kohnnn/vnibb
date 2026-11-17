from copy import deepcopy
from datetime import UTC, date, datetime
from uuid import uuid4

import pandas as pd
import pytest
from dnse_store_fixture import stores as stores
from dnse_store_fixture import stores_context
from vnibb.core.cache import build_cache_key
from vnibb.models.stock import Stock
from vnibb.services.data_pipeline import DataPipeline


@pytest.mark.asyncio
async def test_simultaneous_fixtures_preserve_foreign_cache_and_other_prefix(stores):
    if stores.redis is None:
        pytest.skip("Requires disposable REDIS_CONTRACT_URL")
    key = build_cache_key("vnibb", "price", "latest", "FPT")
    foreign_key = f"dnse-test-sentinel:{uuid4().hex}"
    await stores.redis.client.set(foreign_key, "unchanged")
    try:
        with pytest.MonkeyPatch.context() as other_patch:
            async with stores_context(other_patch) as other:
                first_key = stores.redis_key(key)
                second_key = other.redis_key(key)
                assert first_key != second_key
                assert first_key.startswith(f"{stores.redis_prefix}:")
                assert second_key.startswith(f"{other.redis_prefix}:")
                assert await stores.redis.set_json(key, {"close": 11000})
                assert await other.redis.set_json(key, {"close": 21000})
                assert await stores.redis.client.get(first_key) == '{"close": 11000}'
                assert await stores.redis.client.get(second_key) == '{"close": 21000}'
                assert await stores.redis.client.get(foreign_key) == "unchanged"
        assert await stores.redis.client.get(first_key) == '{"close": 11000}'
        assert await stores.redis.client.get(second_key) is None
        assert await stores.redis.client.get(foreign_key) == "unchanged"
    finally:
        await stores.redis.client.delete(foreign_key)


@pytest.mark.asyncio
async def test_admitted_pipeline_writes_both_keys_and_only_its_namespace_is_cleaned(stores):
    if stores.redis is None:
        pytest.skip("Requires disposable REDIS_CONTRACT_URL")
    day = date(2026, 10, 26)
    symbol = "FPT"
    latest = build_cache_key("vnibb", "price", "latest", symbol)
    recent = build_cache_key("vnibb", "price", "recent", symbol)
    foreign_key = f"dnse-test-sentinel:{uuid4().hex}"
    await stores.redis.client.set(foreign_key, "unchanged")
    try:
        with pytest.MonkeyPatch.context() as other_patch:
            async with stores_context(other_patch) as other:
                await stores.redis.set_json(latest, {"close": 999})
                async with other.sessions.begin() as session:
                    session.add(Stock(symbol=symbol, is_active=1))
                row = {
                    "symbol": symbol, "time": datetime(2026, 10, 26, tzinfo=UTC),
                    "source": "vnstock-data", "providerSource": "VCI", "price_source": "vnstock5_history:VCI",
                    "price_unit": "VND", "open": 10000, "high": 12000, "low": 9000,
                    "close": 11000, "volume": 100, "value": None, "adj_close": None,
                }
                pipeline = DataPipeline()

                async def listing(_client):
                    return [{"symbol": symbol, "type": "STOCK"}]

                async def history(*args, **kwargs):
                    return pd.DataFrame([deepcopy(row)])

                async def wait(_bucket):
                    return None

                other_patch.setattr(pipeline, "_fetch_trading_listing_rows", listing)
                other_patch.setattr(pipeline, "_fetch_stock_history_frame", history)
                other_patch.setattr(pipeline, "_wait_for_rate_limit", wait)
                assert await pipeline.sync_daily_prices(
                    [symbol], start_date=day, end_date=day, cache_recent=True,
                ) == 1
                assert other.cache_attempts == [latest, recent]
                assert await other.redis.client.get(other.redis_key(latest)) is not None
                assert await other.redis.client.get(other.redis_key(recent)) is not None
                assert await stores.redis.client.get(stores.redis_key(latest)) == '{"close": 999}'
                assert await stores.redis.client.get(foreign_key) == "unchanged"
                owned_latest, owned_recent = other.redis_key(latest), other.redis_key(recent)
        assert await stores.redis.client.get(owned_latest) is None
        assert await stores.redis.client.get(owned_recent) is None
        assert await stores.redis.client.get(stores.redis_key(latest)) == '{"close": 999}'
        assert await stores.redis.client.get(foreign_key) == "unchanged"
    finally:
        await stores.redis.client.delete(foreign_key)
