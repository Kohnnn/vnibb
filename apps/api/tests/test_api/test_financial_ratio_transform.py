import pytest
from vnibb.providers.vnstock.financial_ratios import (
    FinancialRatiosQueryParams,
    VnstockFinancialRatiosFetcher,
)


def test_financial_ratio_query_params_normalize_symbol():
    params = FinancialRatiosQueryParams(symbol=" vnm ", period="year")
    assert params.symbol == "VNM"


@pytest.mark.parametrize("value,unit,expected", [
    (0.25, "percent", 0.25),
    (47.02, "percent", 47.02),
    (0.4702, "fraction", 47.02),
    (0.0, "percent", 0.0),
    (0.25, None, None),
])
@pytest.mark.parametrize("shape", ["standard", "row_item"])
def test_transform_dividend_yield_requires_declared_units(value, unit, expected, shape):
    if shape == "standard":
        raw = {"yearReport": 2025, "dividendYield": value, "unit": unit}
    else:
        raw = {"item_id": "dividend_yield", "2025": value, "unit": unit}

    rows = VnstockFinancialRatiosFetcher.transform_data(
        FinancialRatiosQueryParams(symbol="FPT", period="year"), [raw],
    )

    assert rows[0].dividend_yield == expected
    assert rows[0].ratio_units["dividend_yield"] == ("percent" if expected is not None else "unknown")
    assert rows[0].provider_evidence == [raw]


@pytest.mark.parametrize("value,unit,expected", [
    (6.3257, None, None), (0.0287, None, None), (0.0395, None, None), (9.951, None, None),
    (0.25, "fraction", 25.0), (0.25, "percent", 0.25), (0.0, "percent", 0.0),
    (632.57, "percent", 632.57),
])
@pytest.mark.parametrize("shape", ["standard", "row_item"])
def test_transform_payout_requires_explicit_units_without_magnitude_guessing(value, unit, expected, shape):
    raw = ({"yearReport": 2025, "payoutRatio": value, "unit": unit} if shape == "standard"
           else {"item_id": "payout_ratio", "2025": value, "unit": unit})
    rows = VnstockFinancialRatiosFetcher.transform_data(
        FinancialRatiosQueryParams(symbol="FPT", period="year"), [raw],
    )
    assert rows[0].payout_ratio == expected
    assert rows[0].ratio_units["payout_ratio"] == ("percent" if expected is not None else "unknown")
    assert rows[0].provider_evidence == [raw]


def test_transform_data_row_based_maps_key_metrics():
    params = FinancialRatiosQueryParams(symbol="VNM", period="year")
    raw_rows = [
        {"item_id": "p_e", "2023": 10.5, "2024": 12.0},
        {"item_id": "p_b", "2023": 1.2, "2024": 1.4},
        {"item_id": "roe", "unit": "%", "2023": 18.1, "2024": 19.3},
    ]

    data = VnstockFinancialRatiosFetcher.transform_data(params, raw_rows)

    assert len(data) == 2
    assert data[0].period == "2024"
    assert data[0].pe == 12.0
    assert data[0].pb == 1.4
    assert data[0].roe == 19.3


def test_transform_data_does_not_infer_debt_equity_from_unitless_liabilities():
    params = FinancialRatiosQueryParams(symbol="VNM", period="year")
    raw_rows = [
        {"item_id": "liabilities", "2024": 240.0},
        {"item_id": "owners_equity", "2024": 120.0},
    ]

    data = VnstockFinancialRatiosFetcher.transform_data(params, raw_rows)

    # Unitless liabilities/equity carry no mapped ratio id, so the period is
    # withheld entirely instead of returning a null-laden success row.
    assert data == []


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
            "unit": "%",
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


def test_transform_data_does_not_divide_unitless_ev_and_revenue():
    params = FinancialRatiosQueryParams(symbol="VNM", period="year")
    raw_rows = [{"yearReport": 2024, "enterpriseValue": 1000.0, "revenue": 250.0}]

    data = VnstockFinancialRatiosFetcher.transform_data(params, raw_rows)

    assert len(data) == 1
    assert data[0].ev_sales is None


def test_transform_data_returns_empty_when_input_empty():
    params = FinancialRatiosQueryParams(symbol="VNM", period="year")
    assert VnstockFinancialRatiosFetcher.transform_data(params, []) == []


def test_declared_provider_units_reach_stored_comparison_without_guessing():
    from copy import deepcopy

    from vnibb.models.trading import FinancialRatio
    from vnibb.services.comparison_service import _metric_from_ratio_row

    params = FinancialRatiosQueryParams(symbol="VNM", period="year")
    raw = [
        {"item_id": "roe", "unit": "fraction", "2024": 0.25},
        {"item_id": "roa", "unit": "%", "2024": 0.25},
        {"item_id": "roic", "unit": "%", "2024": 0.0},
        {"item_id": "net_profit_margin", "unit": "fraction", "2024": -0.05},
        {"item_id": "gross_profit_margin", "2024": 0.25},
        {"item_id": "p_e", "2024": 12.0},
        {"item_id": "liabilities", "2024": 240.0},
        {"item_id": "owners_equity", "2024": 120.0},
    ]
    evidence = deepcopy(raw)
    result = VnstockFinancialRatiosFetcher.transform_data(params, raw)[0]
    stored = FinancialRatio(
        symbol="VNM", period="2024", period_type="year", fiscal_year=2024,
        roe=result.roe, roa=result.roa, roic=result.roic,
        net_margin=result.net_margin, gross_margin=result.gross_margin,
        pe_ratio=result.pe, debt_to_equity=result.debt_equity,
        raw_data=result.model_dump(mode="json"),
    )
    assert _metric_from_ratio_row(stored, "roe") == 25.0
    assert _metric_from_ratio_row(stored, "roa") == 0.25
    assert _metric_from_ratio_row(stored, "roic") == 0.0
    assert _metric_from_ratio_row(stored, "net_margin") == -5.0
    assert _metric_from_ratio_row(stored, "gross_margin") is None
    assert _metric_from_ratio_row(stored, "pe") == 12.0
    assert _metric_from_ratio_row(stored, "debt_to_equity") is None
    assert raw == evidence
    assert stored.raw_data["ratio_units"]["roe"] == "percent"
    assert stored.raw_data["provider_evidence"][0]["2024"] == 0.25


def test_provider_percent_labels_and_suffixes_preserve_low_values():
    params = FinancialRatiosQueryParams(symbol="VNM", period="year")
    tuple_row = {("Meta", "yearReport"): 2024, ("Profit", "ROE (%)"): 0.25}
    assert VnstockFinancialRatiosFetcher.transform_data(params, [tuple_row])[0].roe == 0.25
    row = {"yearReport": 2024, "roicPercent": -0.25, "roe": 0.25}
    result = VnstockFinancialRatiosFetcher.transform_data(params, [row])[0]
    assert result.roic == -0.25
    assert result.roe is None


def test_conflicting_units_fail_closed_and_compatible_units_agree():
    from vnibb.models.trading import FinancialRatio
    from vnibb.services.comparison_service import _metric_from_ratio_row

    params = FinancialRatiosQueryParams(symbol="VNM", period="year")
    fraction = {"item_id": "roe", "unit": "fraction", "2024": 0.25}
    compatible = {"item_id": "roe", "unit": "%", "2024": 25.0}
    result = VnstockFinancialRatiosFetcher.transform_data(params, [fraction, compatible])[0]
    assert result.roe == 25.0
    incompatible = {**compatible, "2024": 0.25}
    result = VnstockFinancialRatiosFetcher.transform_data(params, [fraction, incompatible])[0]
    assert result.roe is None
    assert result.ratio_units["roe"] == "unknown"
    contradictory = {**fraction, "item": "ROE (%)"}
    assert VnstockFinancialRatiosFetcher.transform_data(params, [contradictory])[0].roe is None
    legacy = FinancialRatio(symbol="VNM", period="2024", period_type="year", fiscal_year=2024, source="vnstock", roe=0.25)
    assert _metric_from_ratio_row(legacy, "roe") is None
    from vnibb.api.v1.equity import _to_ratio_data
    assert _to_ratio_data(legacy).roe is None
    legacy.raw_data = {"ratio_units": {"roe": "percent"}}
    assert _to_ratio_data(legacy).roe == 0.25


@pytest.mark.parametrize("raw", [
    [{"yearReport": 2024, "roe": 99, "roe_percent": 0.25}],
    [{"item_id": "roe", "unit": "%", "2024": 25}, {"item_id": "roe", "2024": 0.25}],
    [{"item_id": "roe", "unit": "%", "2024": 25}, {"item_id": "roe", "item_en": "ROE (%)", "unit": "fraction", "2024": 0.25}],
    [{"item_id": "roe", "item_en": "ROE (%)", "unit": "times", "2024": 25}],
    [{"item_id": "roe", "unit": "%", "Unit": "fraction", "2024": 25}],
])
def test_unresolved_alias_evidence_is_withheld_from_provider_and_comparison(raw):
    from vnibb.models.trading import FinancialRatio
    from vnibb.services.comparison_service import _metric_from_ratio_row

    result = VnstockFinancialRatiosFetcher.transform_data(FinancialRatiosQueryParams(symbol="VNM"), raw)[0]
    stored = FinancialRatio(symbol="VNM", period="2024", source="vnstock", roe=result.roe, raw_data=result.model_dump(mode="json"))
    assert result.roe is None
    assert result.ratio_units["roe"] == "unknown"
    assert _metric_from_ratio_row(stored, "roe") is None


@pytest.mark.parametrize("value,unit,expected", [(0.4, "fraction", 40.0), (0.4, "%", 0.4), (0.0, "%", 0.0), (0.4, None, None)])
def test_debt_assets_provider_storage_and_screener_use_canonical_percent(value, unit, expected):
    from vnibb.api.v1.equity import _to_ratio_data
    from vnibb.models.trading import FinancialRatio
    from vnibb.providers.vnstock.equity_screener import StockScreenerParams, VnstockScreenerFetcher
    from vnibb.services.comparison_service import _metric_from_ratio_row

    raw = {"yearReport": 2024, "debtOnAssets": value, "unit": unit}
    result = VnstockFinancialRatiosFetcher.transform_data(FinancialRatiosQueryParams(symbol="VNM"), [raw])[0]
    stored = FinancialRatio(symbol="VNM", period="2024", source="vnstock", debt_to_assets=result.debt_assets, raw_data=result.model_dump(mode="json"))
    screener = VnstockScreenerFetcher.transform_data(StockScreenerParams(), [{"symbol": "VNM", "debtOnAsset": value, "unit": unit}])[0]
    assert result.debt_assets == expected
    assert _to_ratio_data(stored).debt_assets == expected
    assert _metric_from_ratio_row(stored, "debt_assets") == expected
    assert screener.debt_to_asset == expected


def test_english_item_label_supplies_percent_evidence():
    raw = [{"item_id": "roe", "item_en": "ROE (%)", "2024": 0.25}]
    assert VnstockFinancialRatiosFetcher.transform_data(FinancialRatiosQueryParams(symbol="VNM"), raw)[0].roe == 0.25


def test_public_finance_adapter_receives_evidence_preserving_display_mode():
    from vnibb.core.ratio_units import ratio_method_kwargs

    def adapter(**kwargs):
        return kwargs

    assert adapter(**ratio_method_kwargs(adapter, {"period": "year"})) == {"period": "year", "display_mode": "all"}


@pytest.mark.parametrize("raw,period", [
    ({"period": "2020", "fiscalYear": 2022, "pe": 0.03}, "year"),
    ({"fiscalYear": 2025, "pe": 14.64}, "quarter"),
    ({"period": "2025-Q2", "fiscalYear": 2025, "fiscalQuarter": 3, "pe": 14.64}, "quarter"),
])
def test_provider_ratio_withholds_conflicting_or_missing_fiscal_identity(raw, period):
    assert VnstockFinancialRatiosFetcher.transform_data(
        FinancialRatiosQueryParams(symbol="FPT", period=period), [raw],
    ) == []


def test_provider_ratio_preserves_reported_zero_before_alias_fallbacks():
    rows = VnstockFinancialRatiosFetcher.transform_data(FinancialRatiosQueryParams(symbol="FPT"), [{
        "yearReport": 2025, "priceToEarning": 0, "pe": 14.64,
        "earningPerShare": 0, "eps": 4200, "dividendPerShare": 0, "dps": 2000,
    }])
    assert (rows[0].pe, rows[0].eps, rows[0].dps) == (0, 0, 0)
