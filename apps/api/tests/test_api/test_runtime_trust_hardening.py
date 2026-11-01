from types import SimpleNamespace

import pytest
from fastapi import HTTPException, Request, Response

from vnibb.api.v1 import trading
from vnibb.core import cache
from vnibb.middleware.rate_limit import RateLimitMiddleware


@pytest.mark.asyncio
async def test_rate_limit_ignores_spoofed_forwarded_headers():
    middleware = RateLimitMiddleware(app=SimpleNamespace())

    async def call_next(_request):
        return Response()

    for forwarded, real_ip in ((b"203.0.113.10", b"198.51.100.20"), (b"192.0.2.30", b"192.0.2.40")):
        request = Request(
            {
                "type": "http",
                "headers": [(b"x-forwarded-for", forwarded), (b"x-real-ip", real_ip)],
                "client": ("172.16.0.2", 12345),
                "method": "GET",
                "path": "/api/v1/market",
                "query_string": b"",
                "scheme": "http",
                "server": ("testserver", 80),
            }
        )
        await middleware.dispatch(request, call_next)
        assert middleware._get_client_ip(request) == "172.16.0.2"


@pytest.mark.asyncio
async def test_cached_recomputes_error_result_and_caches_valid_result(monkeypatch):
    calls = 0
    cache._memory_cache.clear()
    monkeypatch.setattr(cache.settings, "environment", "development")
    monkeypatch.setattr(cache, "_redis_cache_enabled", lambda: False)

    @cache.cached(ttl=60, key_prefix="cache_error_result")
    async def fetch():
        nonlocal calls
        calls += 1
        return SimpleNamespace(error="provider unavailable") if calls == 1 else {"data": []}

    assert (await fetch()).error == "provider unavailable"
    assert await fetch() == {"data": []}
    assert await fetch() == {"data": []}
    assert calls == 2


@pytest.mark.asyncio
async def test_top_movers_uses_60_second_cache_ttl(monkeypatch):
    ttls = []

    async def get_json(_key):
        return None

    async def set_json(_key, _value, ttl):
        ttls.append(ttl)
        return True

    async def fetch(**_kwargs):
        return [
            trading.TopMoverData(
                symbol="VNM",
                index="VNINDEX",
                lastPrice=1,
                priceChange=1,
                priceChangePct=1,
            )
        ]

    monkeypatch.setattr(trading.redis_client, "get_json", get_json)
    monkeypatch.setattr(trading.redis_client, "set_json", set_json)
    monkeypatch.setattr(trading.VnstockTopMoversFetcher, "fetch", fetch)

    await trading.get_top_movers(type="gainer", index="VNINDEX", limit=1)

    assert ttls == [60]


@pytest.mark.asyncio
async def test_sector_top_movers_uses_60_second_cache_ttl(monkeypatch):
    ttls = []

    async def get_json(_key):
        return None

    async def set_json(_key, _value, ttl):
        ttls.append(ttl)
        return True

    async def fetch(**_kwargs):
        return [trading.SectorTopMoversData(sector="Banking", stocks=[])]

    monkeypatch.setattr(trading.redis_client, "get_json", get_json)
    monkeypatch.setattr(trading.redis_client, "set_json", set_json)
    monkeypatch.setattr(trading.VnstockTopMoversFetcher, "fetch_sector_top_movers", fetch)

    await trading.get_sector_top_movers(type="gainers", limit=1, source="VCI")

    assert ttls == [60]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("endpoint", "kwargs"),
    [
        (trading.get_top_movers, {"type": "gainer", "index": "VNINDEX", "limit": 1}),
        (trading.get_sector_top_movers, {"type": "gainers", "limit": 1, "source": "VCI"}),
    ],
)
async def test_trading_movers_return_sanitized_502_on_provider_failure(monkeypatch, endpoint, kwargs):
    async def get_json(_key):
        return None

    async def fail(**_kwargs):
        raise RuntimeError("provider secret")

    monkeypatch.setattr(trading.redis_client, "get_json", get_json)
    monkeypatch.setattr(trading.VnstockTopMoversFetcher, "fetch", fail)
    monkeypatch.setattr(trading.VnstockTopMoversFetcher, "fetch_sector_top_movers", fail)

    with pytest.raises(HTTPException) as error:
        await endpoint(**kwargs)

    assert error.value.status_code == 502
    assert "provider secret" not in error.value.detail


@pytest.mark.asyncio
async def test_top_movers_filters_exchange_when_group_unavailable(monkeypatch):
    import pandas as pd

    from vnibb.providers.vnstock import runtime
    from vnibb.providers.vnstock.top_movers import VnstockTopMoversFetcher

    seen = {}

    class Listing:
        def __init__(self, source):
            seen["listing_source"] = source

        def symbols_by_group(self, group):
            return pd.Series(dtype="object")

        def symbols_by_exchange(self):
            return pd.DataFrame({"symbol": ["AAA", "BBB"], "exchange": ["HOSE", "HNX"]})

    class Trading:
        def __init__(self, source):
            seen["trading_source"] = source

        def price_board(self, symbols_list):
            seen["symbols"] = symbols_list
            return pd.DataFrame({"symbol": symbols_list, "match_price": [11], "ref_price": [10]})

    monkeypatch.setattr(runtime, "get_listing_class", lambda: Listing)
    monkeypatch.setattr(runtime, "get_trading_class", lambda: Trading)
    result = await VnstockTopMoversFetcher.fetch(index="HNX")

    assert seen == {"listing_source": "VCI", "trading_source": "VCI", "symbols": ["BBB"]}
    assert [(item.symbol, item.price_change_pct) for item in result] == [("BBB", 10.0)]
    assert result[0].last_price is None
    assert result[0].price_change is None


def test_mover_board_price_requires_explicit_units():
    from vnibb.providers.vnstock.top_movers import _parse_price_board_record

    row = {"symbol": "AAA", "match_price": 11, "ref_price": 10}
    unknown = _parse_price_board_record(row)
    known = _parse_price_board_record({**row, "price_unit": "THOUSAND_VND"})

    assert unknown["price"] is None and unknown["change"] is None
    assert unknown["change_pct"] == 10
    assert known["price"] == 11000 and known["change"] == 1000
