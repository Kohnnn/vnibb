from vnibb.providers.vnstock.financial_ratios import (
    FinancialRatiosQueryParams,
    VnstockFinancialRatiosFetcher,
)


def test_financial_ratio_query_params_normalize_symbol():
    params = FinancialRatiosQueryParams(symbol=" vnm ", period="year")
    assert params.symbol == "VNM"


def test_transform_data_row_based_maps_key_metrics():
    params = FinancialRatiosQueryParams(symbol="VNM", period="year")
    raw_rows = [
        {"item_id": "p_e", "2023": 10.5, "2024": 12.0},
        {"item_id": "p_b", "2023": 1.2, "2024": 1.4},
        {"item_id": "roe", "2023": 18.1, "2024": 19.3},
    ]

    data = VnstockFinancialRatiosFetcher.transform_data(params, raw_rows)

    assert len(data) == 2
    assert data[0].period == "2024"
    assert data[0].pe == 12.0
    assert data[0].pb == 1.4
    assert data[0].roe == 19.3


def test_transform_data_row_based_computes_debt_equity_when_missing():
    params = FinancialRatiosQueryParams(symbol="VNM", period="year")
    raw_rows = [
        {"item_id": "liabilities", "2024": 240.0},
        {"item_id": "owners_equity", "2024": 120.0},
    ]

    data = VnstockFinancialRatiosFetcher.transform_data(params, raw_rows)

    assert len(data) == 1
    assert data[0].period == "2024"
    assert data[0].debt_equity == 2.0


def test_transform_data_row_based_returns_empty_without_period_columns():
    params = FinancialRatiosQueryParams(symbol="VNM", period="year")
    raw_rows = [{"item_id": "p_e", "latest": 12.4}]

    data = VnstockFinancialRatiosFetcher.transform_data(params, raw_rows)

    assert data == []


def test_transform_data_standard_shape_maps_alias_fields():
    params = FinancialRatiosQueryParams(symbol="VNM", period="year")
    raw_rows = [
        {
            "yearReport": 2024,
            "priceToEarning": 14.5,
            "priceToBook": 2.3,
            "postTaxMargin": 12.7,
            "currentRatio": 1.8,
            "ocfToDebt": 0.9,
        }
    ]

    data = VnstockFinancialRatiosFetcher.transform_data(params, raw_rows)

    assert len(data) == 1
    assert data[0].period == "2024"
    assert data[0].pe == 14.5
    assert data[0].pb == 2.3
    assert data[0].net_margin == 12.7
    assert data[0].current_ratio == 1.8
    assert data[0].ocf_debt == 0.9


def test_transform_data_standard_shape_maps_ev_sales_aliases():
    params = FinancialRatiosQueryParams(symbol="VNM", period="year")
    raw_rows = [{"yearReport": 2024, "enterpriseValueToSales": 2.6}]

    data = VnstockFinancialRatiosFetcher.transform_data(params, raw_rows)

    assert len(data) == 1
    assert data[0].ev_sales == 2.6


def test_transform_data_standard_shape_computes_ev_sales_from_ev_and_revenue():
    params = FinancialRatiosQueryParams(symbol="VNM", period="year")
    raw_rows = [{"yearReport": 2024, "enterpriseValue": 1000.0, "revenue": 250.0}]

    data = VnstockFinancialRatiosFetcher.transform_data(params, raw_rows)

    assert len(data) == 1
    assert data[0].ev_sales == 4.0


def test_transform_data_returns_empty_when_input_empty():
    params = FinancialRatiosQueryParams(symbol="VNM", period="year")
    assert VnstockFinancialRatiosFetcher.transform_data(params, []) == []
