from vnibb.providers.vnstock.foreign_trading import (
    ForeignTradingQueryParams,
    VnstockForeignTradingFetcher,
)


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
