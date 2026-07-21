import pytest

from vnibb.providers.vnstock.foreign_trading import (
    ForeignTradingQueryParams,
    VnstockForeignTradingFetcher,
)
from vnibb.providers.vnstock.price_board import VnstockPriceBoardFetcher


def test_transform_data_normalizes_dates_and_net_values():
    params = ForeignTradingQueryParams(symbol="vnm", limit=5)
    raw_rows = [
        {
            "foreignBuyVolume": "1000",
            "foreignSellVolume": "400",
            "foreignBuyValue": "1000000",
            "foreignSellValue": "300000",
            "date": "074500016",
        },
        {
            "foreignBuyVolume": 2000,
            "foreignSellVolume": 500,
            "foreignBuyValue": 2000000,
            "foreignSellValue": 500000,
            "date": "20250227",
        },
    ]

    data = VnstockForeignTradingFetcher.transform_data(params, raw_rows)

    assert len(data) == 2
    assert data[0].date is None
    assert data[0].net_volume == 600.0
    assert data[0].net_value == 700000.0
    assert data[1].date == "2025-02-27"


def test_transform_data_accepts_iso_datetime_strings():
    params = ForeignTradingQueryParams(symbol="VNM", limit=1)
    raw_rows = [
        {
            "foreignBuyVolume": 10,
            "foreignSellVolume": 2,
            "foreignBuyValue": 1000,
            "foreignSellValue": 200,
            "time": "2025-03-01 09:15:00",
        }
    ]

    data = VnstockForeignTradingFetcher.transform_data(params, raw_rows)

    assert len(data) == 1
    assert data[0].date == "2025-03-01"


@pytest.mark.asyncio
async def test_price_board_normalizes_foreign_value_aliases(monkeypatch):
    class FakeFrame:
        def __len__(self):
            return 2

        def to_dict(self, orient):
            assert orient == "records"
            return [
                {
                    "symbol": "VNM",
                    "foreign_buy_value": 1_500.0,
                    "foreign_sell_value": 600.0,
                },
                {
                    "symbol": "FPT",
                    "fBuyValue": 900.0,
                    "fSellValue": 400.0,
                },
            ]

    class FakeTrading:
        def __init__(self, source):
            assert source == "KBS"

        def price_board(self, **kwargs):
            assert kwargs["symbols_list"] == ["VNM", "FPT"]
            return FakeFrame()

    monkeypatch.setattr(
        "vnibb.providers.vnstock.runtime.get_trading_class",
        lambda: FakeTrading,
    )

    rows = await VnstockPriceBoardFetcher.fetch(["VNM", "FPT"])

    assert [row.foreign_buy_value for row in rows] == [1_500.0, 900.0]
    assert [row.foreign_sell_value for row in rows] == [600.0, 400.0]
