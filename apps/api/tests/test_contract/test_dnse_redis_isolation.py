from uuid import uuid4

import pytest

from vnibb.core.cache import build_cache_key

from dnse_store_fixture import stores, stores_context


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
