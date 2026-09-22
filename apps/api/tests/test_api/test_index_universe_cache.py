"""`_resolve_index_universe` must cache the Mongo read without changing meaning.

Index membership was re-read from Mongo on every `universe != ALL` screener
request, which put seconds on the endpoint (measured 5.9 s average against a
24 ms `/profile` call). The fix caches that read in Redis. The risk in caching
a *derived* record is subtle: if the cached copy round-trips through JSON, the
consumer has to recompute or restore the fields it used to read directly.
That is exactly what broke the first attempt, so these tests pin the contract:

1. A cached record yields the same members and the same meta as a fresh one.
2. The staleness verdict is the service's, not a second rule invented here.
"""

from __future__ import annotations

from datetime import datetime

import pytest

from vnibb.api.v1.screener import _resolve_index_universe


class _IndexService:
    def __init__(self, record=None, *, enabled=True):
        self.enabled = enabled
        self.record = record
        self.calls = 0

    async def get_current_index_constituents(self, _group):
        self.calls += 1
        return self.record


def _fresh_record():
    return {
        "group": "VN30",
        "source": "vietcap",
        "members": ["VNM", "FPT"],
        "member_count": 2,
        "synced_at": datetime(2026, 9, 20),
        "stale": False,
    }


@pytest.mark.asyncio
async def test_cached_constituents_return_the_same_members_and_meta(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A Redis round-trip must not change the answer."""
    service = _IndexService(_fresh_record())
    monkeypatch.setattr(
        "vnibb.api.v1.screener.get_mongo_market_data_service", lambda: service
    )

    uncached_members, uncached_meta = await _resolve_index_universe("VN30")
    assert uncached_members == {"VNM", "FPT"}

    # Simulate the JSON round-trip Redis performs: datetimes become strings.
    as_stored = dict(_fresh_record())
    as_stored["synced_at"] = as_stored["synced_at"].isoformat()

    async def _cached(_key):
        return as_stored

    monkeypatch.setattr("vnibb.api.v1.screener.redis_client.get_json", _cached)

    cached_members, cached_meta = await _resolve_index_universe("VN30")

    assert cached_members == uncached_members
    assert cached_meta["membership_coverage"] == uncached_meta["membership_coverage"]
    assert cached_meta["membership_source"] == uncached_meta["membership_source"]
    assert cached_meta["membership_available"] == uncached_meta["membership_available"]


@pytest.mark.asyncio
async def test_stale_verdict_comes_from_the_service_not_a_local_recompute(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The service's `stale` flag is authoritative and must be passed through.

    The record's `synced_at` is deliberately old while `stale` is False. A
    local `now - synced_at > 7 days` recomputation would reject these members;
    the service already applied its own `max_age_days` and said they are fine.
    """
    record = _fresh_record()
    record["synced_at"] = datetime(2020, 1, 1)
    record["stale"] = False
    service = _IndexService(record)
    monkeypatch.setattr(
        "vnibb.api.v1.screener.get_mongo_market_data_service", lambda: service
    )

    members, meta = await _resolve_index_universe("VN30")

    assert members == {"VNM", "FPT"}
    assert meta["membership_stale"] is False
    assert meta["membership_available"] is True


@pytest.mark.asyncio
async def test_stale_record_excludes_members(monkeypatch: pytest.MonkeyPatch) -> None:
    """A record the service marks stale must not contribute members."""
    record = _fresh_record()
    record["stale"] = True
    service = _IndexService(record)
    monkeypatch.setattr(
        "vnibb.api.v1.screener.get_mongo_market_data_service", lambda: service
    )

    members, meta = await _resolve_index_universe("VN30")

    assert members == set()
    assert meta["membership_stale"] is True
    assert meta["membership_available"] is False


@pytest.mark.asyncio
async def test_cache_read_failure_falls_back_to_mongo(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A Redis outage must not break index universes."""
    service = _IndexService(_fresh_record())
    monkeypatch.setattr(
        "vnibb.api.v1.screener.get_mongo_market_data_service", lambda: service
    )

    async def _boom(_key):
        raise RuntimeError("redis down")

    monkeypatch.setattr("vnibb.api.v1.screener.redis_client.get_json", _boom)

    members, meta = await _resolve_index_universe("VN30")

    assert members == {"VNM", "FPT"}
    assert service.calls == 1
