from __future__ import annotations

import pandas as pd
import pytest
from vnibb.providers.vnstock import runtime
from vnibb.providers.vnstock.top_movers import (
    VnstockTopMoversFetcher,
    _parse_price_board_record,
)


def test_board_value_is_withheld_without_explicit_vnd_unit():
    parsed = _parse_price_board_record({
        "symbol": "VNM", "match_price": 100_000.0, "price_unit": "VND",
        "match_accumulated_value": 5_000_000_000,
    })
    assert parsed["value"] is None

    certified = _parse_price_board_record({
        "symbol": "VNM", "match_price": 100_000.0, "price_unit": "VND",
        "value_unit": "VND", "match_accumulated_value": 5_000_000_000,
    })
    assert certified["value"] == 5_000_000_000


def test_board_value_with_non_vnd_unit_is_withheld():
    parsed = _parse_price_board_record({
        "symbol": "VNM", "match_price": 100_000.0, "price_unit": "VND",
        "value_unit": "THOUSAND_VND", "match_accumulated_value": 5_000,
    })
    assert parsed["value"] is None


@pytest.mark.asyncio
async def test_top_movers_value_ranks_only_certified_rows(monkeypatch):
    frame = pd.DataFrame([
        {"symbol": "AAA", "match_price": 10.0, "match_accumulated_value": 100.0},
        {"symbol": "BBB", "match_price": 10.0, "match_accumulated_value": 500.0},
    ])
    frame.attrs["price_unit"] = "VND"
    # No value_unit: the board cannot certify currency value.

    class Trading:
        def __init__(self, *, source):
            pass

        def price_board(self, *, symbols_list):
            return frame

    class Listing:
        def __init__(self, *, source):
            pass

        def symbols_by_group(self, *, group):
            return pd.Series(["AAA", "BBB"])

    async def run(operation, timeout, **kwargs):
        return operation()

    monkeypatch.setattr(runtime, "get_listing_class", lambda: Listing)
    monkeypatch.setattr(runtime, "get_trading_class", lambda: Trading)
    monkeypatch.setattr(runtime, "run_reference_provider", run)

    rows = await VnstockTopMoversFetcher.fetch(type="value", index="VNINDEX", limit=10)
    assert rows == []


@pytest.mark.asyncio
async def test_top_movers_fallback_normalizes_hsx_to_hose(monkeypatch):
    seen = {}

    class Listing:
        def __init__(self, *, source):
            pass

        def symbols_by_group(self, *, group):
            raise ValueError("no group data")

        def symbols_by_exchange(self):
            return pd.DataFrame([
                {"symbol": "VNM", "exchange": "HSX", "type": "STOCK"},
                {"symbol": "AAA", "exchange": "HNX", "type": "STOCK"},
            ])

    class Trading:
        def __init__(self, *, source):
            pass

        def price_board(self, *, symbols_list):
            seen["symbols"] = list(symbols_list)
            frame = pd.DataFrame([{"symbol": "VNM", "match_price": 100.0}])
            frame.attrs["price_unit"] = "VND"
            return frame

    async def run(operation, timeout, **kwargs):
        return operation()

    monkeypatch.setattr(runtime, "get_listing_class", lambda: Listing)
    monkeypatch.setattr(runtime, "get_trading_class", lambda: Trading)
    monkeypatch.setattr(runtime, "run_reference_provider", run)

    await VnstockTopMoversFetcher.fetch(type="gainer", index="VNINDEX", limit=10)
    assert seen["symbols"] == ["VNM"]
