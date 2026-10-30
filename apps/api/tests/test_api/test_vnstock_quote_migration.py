from datetime import date
from types import SimpleNamespace

import pandas as pd
import pytest

from vnibb.core.exceptions import ProviderError
from vnibb.providers.vnstock import runtime
from vnibb.providers.vnstock.derivatives import VnstockDerivativesFetcher
from vnibb.providers.vnstock.foreign_trading import (
    ForeignTradingQueryParams,
    VnstockForeignTradingFetcher,
)
from vnibb.providers.vnstock.intraday import IntradayQueryParams, VnstockIntradayFetcher
from vnibb.providers.vnstock.market_overview import VnstockMarketOverviewFetcher
from vnibb.providers.vnstock.price_board import VnstockPriceBoardFetcher
from vnibb.providers.vnstock.price_depth import VnstockPriceDepthFetcher
from vnibb.providers.vnstock.stock_price import VnstockStockPriceFetcher


@pytest.mark.asyncio
async def test_foreign_trading_uses_vci_flow_and_maps_published_totals(monkeypatch):
    class Trading:
        def __init__(self, *, symbol, source):
            assert (symbol, source) == ("VNM", "VCI")

        def foreign_trade(self, *, limit):
            assert limit == 5
            frame = pd.DataFrame([{
                "trading_date": "2026-10-29", "fr_buy_volume_total": 100,
                "fr_sell_volume_total": 40, "fr_buy_value_total": 1000,
                "fr_sell_value_total": 400, "fr_net_value_total": 600,
            }])
            frame.attrs["value_unit"] = "VND"
            return frame

    monkeypatch.setattr(runtime, "get_trading_class", lambda: Trading)
    params = ForeignTradingQueryParams(symbol="VNM", limit=5)
    raw = await VnstockForeignTradingFetcher.extract_data(VnstockForeignTradingFetcher.transform_query(params))
    row = VnstockForeignTradingFetcher.transform_data(params, raw)[0]
    assert (row.date, row.buy_volume, row.sell_volume, row.net_volume, row.net_value) == (
        "2026-10-29", 100, 40, 60, 600,
    )


@pytest.mark.asyncio
async def test_intraday_uses_requested_page_size_and_canonical_side(monkeypatch):
    class Quote:
        def __init__(self, *, symbol, source):
            assert (symbol, source) == ("VNM", "VCI")

        def intraday(self, *, page_size):
            assert page_size == 250
            frame = pd.DataFrame([{"time": "09:30:00", "price": 50, "volume": 10, "match_type": "Buy"}])
            frame.attrs["price_unit"] = "VND"
            return frame

    monkeypatch.setattr(runtime, "get_quote_class", lambda: Quote)
    params = IntradayQueryParams(symbol="VNM", limit=250)
    raw = await VnstockIntradayFetcher.extract_data(VnstockIntradayFetcher.transform_query(params))
    assert VnstockIntradayFetcher.transform_data(params, raw)[0].match_type == "Buy"


@pytest.mark.asyncio
async def test_futures_and_indices_use_asset_specific_vci_routes(monkeypatch):
    calls = []

    class Market:
        def futures(self, symbol):
            calls.append(("futures", symbol))
            return SimpleNamespace(history=self.history)

        def index(self, symbol):
            calls.append(("index", symbol))
            return SimpleNamespace(history=self.history)

        def history(self, *, start, end, source, interval="1D"):
            assert source == "VCI"
            return pd.DataFrame([
                {"time": "2026-10-28", "close": 1200},
                {"time": "2026-10-29", "close": 1201},
            ])

    monkeypatch.setattr(runtime, "import_vnstock_symbol", lambda name: (Market, "vnstock"))
    # market_overview imports the helper at module load.
    monkeypatch.setattr("vnibb.providers.vnstock.market_overview.import_vnstock_symbol", lambda name: (Market, "vnstock"))
    futures = await VnstockDerivativesFetcher.fetch("VN30F1M", date(2026, 10, 28), date(2026, 10, 29))
    indices = await VnstockMarketOverviewFetcher.extract_data({})
    assert futures[-1].close == 1201
    assert len(indices) == 4
    assert ("futures", "VN30F1M") in calls
    assert ("index", "VNINDEX") in calls


@pytest.mark.asyncio
async def test_stock_price_requests_unified_board(monkeypatch):
    class Trading:
        def __init__(self, *, source):
            assert source == "VCI"

        def price_board(self, *, symbols_list, get_unified):
            assert symbols_list == ["VNM"] and get_unified is True
            frame = pd.DataFrame([{"symbol": "VNM", "match_price": 42, "accumulated_volume": 10}])
            frame.attrs.update(price_unit="VND", value_unit="VND")
            return frame

    monkeypatch.setattr(runtime, "get_trading_class", lambda: Trading)
    row = await VnstockStockPriceFetcher.fetch("vnm")
    assert (row.price, row.volume) == (42, 10)


@pytest.mark.asyncio
async def test_volume_profile_is_not_mislabeled_as_order_book(monkeypatch):
    class Market:
        def equity(self, symbol):
            assert symbol == "VNM"
            return self

        def order_book(self, *, source):
            assert source == "VCI"
            frame = pd.DataFrame([{"price": "42", "volume": "100", "buy_volume": "60", "sell_volume": "40"}])
            frame.attrs["price_unit"] = "VND"
            return frame

    monkeypatch.setattr(runtime, "import_vnstock_symbol", lambda name: (Market, "vnstock"))
    with pytest.raises(ProviderError, match="Unrecognized VCI order book"):
        await VnstockPriceDepthFetcher.fetch("VNM")


@pytest.mark.asyncio
async def test_native_order_book_snake_case_is_parsed(monkeypatch):
    class Market:
        def equity(self, symbol):
            assert symbol == "VNM"
            return self

        def order_book(self, *, source):
            assert source == "VCI"
            frame = pd.DataFrame([{
                "bid_price_1": 39200.0, "bid_vol_1": 11200,
                "bid_price_2": 39100.0, "bid_vol_2": 500,
                "ask_price_1": 39300.0, "ask_vol_1": 800,
                "ask_price_2": 39400.0, "ask_vol_2": 300,
            }])
            frame.attrs["price_unit"] = "VND"
            return frame

    monkeypatch.setattr(runtime, "import_vnstock_symbol", lambda name: (Market, "vnstock"))
    depth = await VnstockPriceDepthFetcher.fetch("VNM")
    assert (depth.bid_1.price, depth.bid_1.volume) == (39200.0, 11200)
    assert (depth.ask_1.price, depth.ask_1.volume) == (39300.0, 800)
    assert (depth.bid_2.price, depth.ask_2.price) == (39100.0, 39400.0)
    assert depth.total_bid_volume == 11700
    assert depth.total_ask_volume == 1100


@pytest.mark.asyncio
async def test_empty_foreign_flow_does_not_substitute_ohlcv(monkeypatch):
    class Trading:
        def __init__(self, *, symbol, source):
            assert (symbol, source) == ("VNM", "VCI")

        def foreign_trade(self, *, limit):
            return pd.DataFrame()

    monkeypatch.setattr(runtime, "get_trading_class", lambda: Trading)
    assert await VnstockForeignTradingFetcher.extract_data({"symbol": "VNM", "limit": 5}) == []


@pytest.mark.asyncio
async def test_unmarked_intraday_price_is_unavailable(monkeypatch):
    class Quote:
        def __init__(self, *, symbol, source):
            assert source == "VCI"

        def intraday(self, *, page_size):
            return pd.DataFrame([{"price": 42, "volume": 10}])

    monkeypatch.setattr(runtime, "get_quote_class", lambda: Quote)
    with pytest.raises(ProviderError, match="price unit is unavailable"):
        await VnstockIntradayFetcher.extract_data({"symbol": "VNM", "limit": 10})


@pytest.mark.asyncio
async def test_unmarked_board_price_is_unavailable(monkeypatch):
    class Trading:
        def __init__(self, *, source):
            assert source == "VCI"

        def price_board(self, *, symbols_list, get_unified):
            return pd.DataFrame([{"symbol": "VNM", "match_price": 42}])

    monkeypatch.setattr(runtime, "get_trading_class", lambda: Trading)
    with pytest.raises(ProviderError, match="price unit is unavailable"):
        await VnstockStockPriceFetcher.fetch("VNM")


@pytest.mark.asyncio
async def test_unmarked_foreign_values_are_not_reported_as_vnd(monkeypatch):
    class Trading:
        def __init__(self, *, symbol, source):
            assert source == "VCI"

        def foreign_trade(self, *, limit):
            return pd.DataFrame([{"trading_date": "2026-10-29", "fr_buy_volume_total": 10,
                                  "fr_buy_value_total": 420}])

    monkeypatch.setattr(runtime, "get_trading_class", lambda: Trading)
    params = ForeignTradingQueryParams(symbol="VNM", limit=5)
    raw = await VnstockForeignTradingFetcher.extract_data(VnstockForeignTradingFetcher.transform_query(params))
    row = VnstockForeignTradingFetcher.transform_data(params, raw)[0]
    assert row.buy_volume == 10 and row.buy_value is None


@pytest.mark.asyncio
async def test_unmarked_batch_board_and_order_book_are_unavailable(monkeypatch):
    class Trading:
        def __init__(self, *, source):
            assert source == "VCI"

        def price_board(self, *, symbols_list, get_unified):
            return pd.DataFrame([{"symbol": "VNM", "match_price": 42}])

    class Market:
        def equity(self, symbol):
            return self

        def order_book(self, *, source):
            assert source == "VCI"
            return pd.DataFrame([{"side": "bid", "price": 42, "volume": 10}])

    monkeypatch.setattr(runtime, "get_trading_class", lambda: Trading)
    monkeypatch.setattr(runtime, "import_vnstock_symbol", lambda name: (Market, "vnstock"))
    with pytest.raises(ProviderError, match="price unit is unavailable"):
        await VnstockPriceBoardFetcher.fetch(["VNM"])
    with pytest.raises(ProviderError, match="price unit is unavailable"):
        await VnstockPriceDepthFetcher.fetch("VNM")
