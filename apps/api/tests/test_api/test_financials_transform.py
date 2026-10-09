from vnibb.providers.vnstock.financials import (
    FinancialsQueryParams,
    StatementType,
    VnstockFinancialsFetcher,
)


def test_transform_data_pivots_income_statement_rows():
    params = FinancialsQueryParams(
        symbol="VNM", statement_type=StatementType.INCOME, period="year", limit=5
    )
    rows = [
        {"item_id": "revenue", "2023": 1000.0, "2024": 1200.0},
        {"item_id": "gross_profit", "2023": 420.0, "2024": 500.0},
        {"item_id": "profit_after_tax", "2023": 180.0, "2024": 220.0},
    ]

    data = VnstockFinancialsFetcher.transform_data(params, rows)

    assert len(data) == 2
    assert data[0].period == "2023"
    assert data[1].period == "2024"
    assert data[1].revenue == 1200.0
    assert data[1].gross_profit == 500.0
    assert data[1].net_income == 220.0


def test_transform_data_pivots_balance_sheet_and_sets_equity_aliases():
    params = FinancialsQueryParams(
        symbol="VNM", statement_type=StatementType.BALANCE, period="year", limit=5
    )
    rows = [
        {"item_id": "total_assets", "2024": 5500.0},
        {"item_id": "total_liabilities", "2024": 1900.0},
        {"item_id": "total_equity", "2024": 3600.0},
        {"item_id": "cash_and_cash_equivalents", "2024": 480.0},
    ]

    data = VnstockFinancialsFetcher.transform_data(params, rows)

    assert len(data) == 1
    assert data[0].total_assets == 5500.0
    assert data[0].total_liabilities == 1900.0
    assert data[0].total_equity == 3600.0
    assert data[0].equity == 3600.0
    assert data[0].cash_and_equivalents == 480.0
    assert data[0].cash == 480.0


def test_transform_data_pivots_cash_flow_rows():
    params = FinancialsQueryParams(
        symbol="VNM", statement_type=StatementType.CASHFLOW, period="year", limit=5
    )
    rows = [
        {"item_id": "operating_cash_flow", "2024": 800.0},
        {"item_id": "investing_cash_flow", "2024": -300.0},
        {"item_id": "financing_cash_flow", "2024": -450.0},
        {"item_id": "free_cash_flow", "2024": 220.0},
    ]

    data = VnstockFinancialsFetcher.transform_data(params, rows)

    assert len(data) == 1
    assert data[0].operating_cash_flow == 800.0
    assert data[0].investing_cash_flow == -300.0
    assert data[0].financing_cash_flow == -450.0
    assert data[0].free_cash_flow == 220.0


def test_transform_data_non_pivot_shape_maps_alias_fields():
    params = FinancialsQueryParams(
        symbol="VNM", statement_type=StatementType.INCOME, period="year", limit=5
    )
    rows = [
        {
            "period": "2024",
            "netRevenue": 1500.0,
            "grossProfit": 620.0,
            "operatingProfit": 330.0,
            "postTaxProfit": 260.0,
            "basicEps": 3500.0,
        }
    ]

    data = VnstockFinancialsFetcher.transform_data(params, rows)

    assert len(data) == 1
    assert data[0].period == "2024"
    assert data[0].revenue == 1500.0
    assert data[0].gross_profit == 620.0
    assert data[0].operating_income == 330.0
    assert data[0].net_income == 260.0
    assert data[0].eps == 3500.0


def test_transform_data_non_pivot_maps_earning_per_share_alias():
    params = FinancialsQueryParams(
        symbol="VNM", statement_type=StatementType.INCOME, period="year", limit=5
    )
    rows = [{"period": "2024", "netRevenue": 1500.0, "earningPerShare": 4100.0}]

    data = VnstockFinancialsFetcher.transform_data(params, rows)

    assert len(data) == 1
    assert data[0].eps == 4100.0


def test_transform_data_applies_limit_on_pivot_periods():
    params = FinancialsQueryParams(
        symbol="VNM", statement_type=StatementType.INCOME, period="year", limit=2
    )
    rows = [
        {"item_id": "revenue", "2022": 900.0, "2023": 1000.0, "2024": 1200.0},
    ]

    data = VnstockFinancialsFetcher.transform_data(params, rows)

    assert len(data) == 2
    assert [item.period for item in data] == ["2023", "2024"]


def test_transform_data_supports_year_quarter_column_format():
    params = FinancialsQueryParams(
        symbol="VNM", statement_type=StatementType.INCOME, period="quarter", limit=4
    )
    rows = [
        {"item_id": "revenue", "2025-Q1": 100.0, "2025-Q2": 120.0},
        {"item_id": "gross_profit", "2025-Q1": 40.0, "2025-Q2": 46.0},
        {"item_id": "profit_after_tax", "2025-Q1": 20.0, "2025-Q2": 23.0},
    ]

    data = VnstockFinancialsFetcher.transform_data(params, rows)

    assert len(data) == 2
    assert [item.period for item in data] == ["2025-Q1", "2025-Q2"]
    assert data[1].revenue == 120.0
    assert data[1].gross_profit == 46.0
    assert data[1].net_income == 23.0


def test_transform_data_maps_bank_specific_income_aliases():
    params = FinancialsQueryParams(
        symbol="VCB", statement_type=StatementType.INCOME, period="year", limit=2
    )
    rows = [
        {
            "item_id": "interest_income_and_similar_income",
            "2024": 105_119_449_000_000,
        },
        {
            "item_id": "net_profit_atttributable_to_the_equity_holders_of_the_bank",
            "2024": 35_178_155_000_000,
        },
        {"item_id": "earning_per_share_vnd", "2024": 4210},
    ]

    data = VnstockFinancialsFetcher.transform_data(params, rows)

    assert len(data) == 1
    assert data[0].period == "2024"
    assert data[0].revenue == 105_119_449_000_000
    assert data[0].net_income == 35_178_155_000_000
    assert data[0].eps == 4210


def test_transform_data_non_pivot_maps_vietnamese_income_aliases():
    params = FinancialsQueryParams(
        symbol="VNM", statement_type=StatementType.INCOME, period="year", limit=5
    )
    rows = [
        {
            "period": "2024",
            "Doanh thu thuần": 1500.0,
            "Chi phí lãi vay": 42.0,
            "Chi phí thuế TNDN hiện hành": 28.0,
        }
    ]

    data = VnstockFinancialsFetcher.transform_data(params, rows)

    assert len(data) == 1
    assert data[0].revenue == 1500.0
    assert data[0].interest_expense == 42.0
    assert data[0].tax_expense == 28.0


def test_transform_data_non_pivot_maps_vietnamese_cashflow_aliases():
    params = FinancialsQueryParams(
        symbol="VNM", statement_type=StatementType.CASHFLOW, period="year", limit=5
    )
    rows = [
        {
            "period": "2024",
            "Lưu chuyển tiền tệ ròng từ các hoạt động SXKD": 620.0,
            "Lưu chuyển tiền thuần trong kỳ": -35.0,
            "Trả nợ gốc vay": -50.0,
        }
    ]

    data = VnstockFinancialsFetcher.transform_data(params, rows)

    assert len(data) == 1
    assert data[0].operating_cash_flow == 620.0
    assert data[0].net_change_in_cash == -35.0
    assert data[0].debt_repayment == -50.0


def test_transform_data_maps_vietnamese_bank_income_aliases():
    params = FinancialsQueryParams(
        symbol="VCB", statement_type=StatementType.INCOME, period="year", limit=2
    )
    rows = [
        {"item_id": "thu_nhap_lai_thuan", "2024": 55_405_735_000_000},
        {"item_id": "chi_phi_lai_va_cac_khoan_tuong_tu", "2024": -38_249_106_000_000},
        {
            "item_id": "loi_nhuan_sau_thue_cua_co_dong_cong_ty_me_dong",
            "2024": 33_831_386_000_000,
        },
        {"item_id": "lai_co_ban_tren_co_phieu", "2024": 5571},
    ]

    data = VnstockFinancialsFetcher.transform_data(params, rows)

    assert len(data) == 1
    assert data[0].gross_profit == 55_405_735_000_000
    assert data[0].interest_expense == -38_249_106_000_000
    assert data[0].net_income == 33_831_386_000_000
    assert data[0].eps == 5571


def test_transform_data_maps_bank_customer_deposits_aliases():
    params = FinancialsQueryParams(
        symbol="VCB", statement_type=StatementType.BALANCE, period="year", limit=2
    )
    rows = [
        {"item_id": "tien_gui_cua_khach_hang", "_value_unit": "VND", "2024": 1_390_814_015_000_000},
        {"item_id": "deposits_from_customers", "_value_unit": "VND", "2025": 1_592_598_206_000_000},
    ]

    data = VnstockFinancialsFetcher.transform_data(params, rows)

    assert len(data) == 2
    assert data[0].period == "2024"
    assert data[0].customer_deposits == 1_390_814_015_000_000
    assert data[1].period == "2025"
    assert data[1].customer_deposits == 1_592_598_206_000_000


def test_transform_data_maps_kbs_short_term_trade_accounts_payable_alias():
    params = FinancialsQueryParams(
        symbol="VNM", statement_type=StatementType.BALANCE, period="year", limit=2
    )
    rows = [
        {
            "item_id": "n_1.short_term_trade_accounts_payable",
            "2025": 3_923_309.0,
            "_source": "KBS",
        },
        {
            "item_id": "n_3.intangible_fixed_assets",
            "2025": 1_030_797.45,
            "_source": "KBS",
        },
    ]
    for row in rows:
        row["_value_unit"] = "VND"

    data = VnstockFinancialsFetcher.transform_data(params, rows)

    assert len(data) == 1
    assert data[0].accounts_payable == 3_923_309.0
    assert data[0].intangible_assets == 1_030_797.45


def test_transform_data_maps_bank_balance_aliases():
    params = FinancialsQueryParams(
        symbol="TCB", statement_type=StatementType.BALANCE, period="year", limit=1
    )
    rows = [
        {
            "item_id": "OWNER'S EQUITY(Bn.VND)",
            "2025": 179_501_442_000.0,
            "_source": "VCI",
        },
        {
            "item_id": "Intagible fixed assets",
            "2025": 5_779_202_000.0,
            "_source": "VCI",
        },
        {
            "item_id": "Deposits from customers",
            "2025": 618_911_535_000.0,
            "_source": "VCI",
        },
    ]
    for row in rows:
        row["_value_unit"] = "VND"

    data = VnstockFinancialsFetcher.transform_data(params, rows)

    assert len(data) == 1
    assert data[0].total_equity == 179_501_442_000.0
    assert data[0].intangible_assets == 5_779_202_000.0
    assert data[0].customer_deposits == 618_911_535_000.0


def test_transform_data_maps_kbs_income_without_rescaling_provider_values():
    params = FinancialsQueryParams(
        symbol="VCI", statement_type=StatementType.INCOME, period="year", limit=2
    )
    rows = [
        {
            "item_id": "revenue_from_securities_business_01_11",
            "2024": 3_695_525_335.0,
            "_source": "KBS",
        },
        {"item_id": "ix.profit_before_tax", "2024": 1_089_337_105.0, "_source": "KBS"},
        {"item_id": "xi.net_profit_after_tax", "2024": 910_692_113.0, "_source": "KBS"},
        {
            "item_id": "vi.general_and_administrative_expenses",
            "2024": -129_175_258.0,
            "_source": "KBS",
        },
        {"item_id": "n_13.1.earning_per_share_vnd", "2024": 1540.0, "_source": "KBS"},
    ]
    for row in rows:
        row["_value_unit"] = "VND"

    data = VnstockFinancialsFetcher.transform_data(params, rows)

    assert len(data) == 1
    assert data[0].revenue == 3_695_525_335.0
    assert data[0].pre_tax_profit == 1_089_337_105.0
    assert data[0].net_income == 910_692_113.0
    assert data[0].selling_general_admin == -129_175_258.0
    assert data[0].eps == 1540.0


def test_transform_data_maps_kbs_cashflow_aliases_and_net_change():
    params = FinancialsQueryParams(
        symbol="VCI", statement_type=StatementType.CASHFLOW, period="year", limit=2
    )
    rows = [
        {
            "item_id": "net_cash_flows_from_securities_trading_activities",
            "2024": -4_657_314_437.0,
            "_source": "KBS",
        },
        {
            "item_id": "iv.net_cash_flows_during_the_period",
            "2024": 2_156_458_770.0,
            "_source": "KBS",
        },
        {
            "item_id": "n_1.payment_for_fixed_assets_constructions_and_other_long_term_assets",
            "2024": -57_598_155.0,
            "_source": "KBS",
        },
        {
            "item_id": "n_6.dividends_paid_profits_distributed_to_owners",
            "2024": -437_491_942.0,
            "_source": "KBS",
        },
        {"item_id": "n_4_principal_repayments", "2024": -7_858_500_000.0, "_source": "KBS"},
    ]
    for row in rows:
        row["_value_unit"] = "VND"

    data = VnstockFinancialsFetcher.transform_data(params, rows)

    assert len(data) == 1
    assert data[0].operating_cash_flow == -4_657_314_437.0
    assert data[0].net_change_in_cash == 2_156_458_770.0
    assert data[0].capex == -57_598_155.0
    assert data[0].dividends_paid == -437_491_942.0
    assert data[0].debt_repayment == -7_858_500_000.0


def test_kbs_vnm_source_lineage_survives_canonical_round_trip():
    params = FinancialsQueryParams(symbol="VNM", statement_type=StatementType.BALANCE, period="quarter")
    rows = [{"item_id": "total_assets", "item_en": "TOTAL ASSETS (Bn. VND)", "2026-Q2": 55_677_822_007_000,
        "_source": "KBS", "_value_unit": "VND", "_provider_value_multiplier": 1000,
        "_normalization_contract": "vnstock.kbs._fetch_series_data: ValueN * 1000",
        "_provider_attrs": {"source_reports": [{"Head": [{"YearPeriod": 2026, "TermCode": "Q2", "United": "HN",
            "PeriodBegin": "202604", "PeriodEnd": "202606"}], "Unit": [{"UnitedCode": "HN", "UnitedNameEN": "Consolidated"}]}]}}]
    row = VnstockFinancialsFetcher.transform_data(params, rows)[0]
    assert row.total_assets == 55_677_822_007_000
    assert row.unit_metadata["total_assets"]["raw_value"] == 55_677_822_007
    assert row.unit_metadata["total_assets"]["consolidation_basis"] == "Consolidated"
    assert row.flow_basis == "single_quarter"
    assert row.raw_data["provider_rows"][0]["item_en"] == "TOTAL ASSETS (Bn. VND)"
    repeated = VnstockFinancialsFetcher.transform_data(params, [row.model_dump(mode="json")])[0]
    assert repeated.total_assets == row.total_assets
    assert repeated.raw_data == row.raw_data


def test_unknown_provider_unit_withholds_values_without_magnitude_repair():
    params = FinancialsQueryParams(symbol="VNM", statement_type=StatementType.BALANCE, period="quarter")
    rows = [{"item_id": "total_assets", "2026-Q2": 55_677_822_007_000_000, "_source": "KBS"}]
    row = VnstockFinancialsFetcher.transform_data(params, rows)[0]
    assert row.total_assets is None
    assert row.unavailable_reason == "unknown_source_unit"
    assert row.raw_data["provider_rows"] == rows


def test_explicit_source_unit_scales_only_monetary_field():
    params = FinancialsQueryParams(symbol="VNM", statement_type=StatementType.INCOME)
    rows = [{"item_id": "revenue", "unit": "Bn. VND", "2025": 53_312.370717301, "_source": "fixture"}]
    row = VnstockFinancialsFetcher.transform_data(params, rows)[0]
    assert row.revenue == 53_312_370_717_301
    assert row.unit_metadata["revenue"]["normalization_multiplier"] == 1_000_000_000


def test_kbs_eps_undoes_only_documented_library_multiplier():
    params = FinancialsQueryParams(symbol="VNM", statement_type=StatementType.INCOME)
    rows = [{"item_id": "earning_per_share_vnd", "2025": 1_540_000, "_source": "KBS", "_value_unit": "VND",
        "_provider_value_multiplier": 1000, "_normalization_contract": "vnstock.kbs._fetch_series_data: ValueN * 1000"}]
    row = VnstockFinancialsFetcher.transform_data(params, rows)[0]
    assert row.eps == 1540
    assert row.unit_metadata["eps"]["value_unit"] == "VND/share"
    assert row.unit_metadata["eps"]["normalization_multiplier"] == 0.001


def test_source_head_cumulative_basis_is_not_treated_as_single_quarter():
    params = FinancialsQueryParams(symbol="VNM", statement_type=StatementType.CASHFLOW, period="quarter")
    rows = [{"item_id": "operating_cash_flow", "2026-Q2": 100, "_source": "KBS", "_value_unit": "VND",
        "_provider_attrs": {"source_reports": [{"Head": [{"YearPeriod": 2026, "TermCode": "Q2", "United": "HN",
            "PeriodBegin": "202601", "PeriodEnd": "202606"}], "Unit": [{"UnitedCode": "HN", "UnitedNameEN": "Consolidated"}]}]}}]
    row = VnstockFinancialsFetcher.transform_data(params, rows)[0]
    assert row.flow_basis == "cumulative_ytd"
    assert row.consolidation_basis == "Consolidated"
    assert row.unit_metadata["operating_cash_flow"]["source_head"]["PeriodBegin"] == "202601"


def test_kbs_headings_and_cash_component_do_not_conflict_with_aggregates():
    params = FinancialsQueryParams(symbol="VNM", statement_type=StatementType.BALANCE, period="quarter")
    rows = [
        {"item_id": "total_assets", "item": "TÀI SẢN", "2026-Q2": float("nan")},
        {"item_id": "total_assets", "item": "TỔNG CỘNG TÀI SẢN", "2026-Q2": 55_677_822_007_000},
        {"item_id": "cash", "item": "1. Tiền", "2026-Q2": 1_427_466_367_000},
        {"item_id": "cash_and_cash_equivalents", "item": "I. Tiền và các khoản tương đương tiền", "2026-Q2": 5_154_466_367_000},
    ]
    for row in rows:
        row.update(_source="KBS", _value_unit="VND")
    statement = VnstockFinancialsFetcher.transform_data(params, rows)[0]
    assert statement.total_assets == 55_677_822_007_000
    assert statement.cash_and_equivalents == 5_154_466_367_000
    assert statement.value_unit == "VND"
    assert statement.unavailable_reason is None
    assert len(statement.raw_data["provider_rows"]) == 4


def test_conflicting_financial_metric_does_not_withhold_unrelated_confirmed_values():
    params = FinancialsQueryParams(symbol="VNM", statement_type=StatementType.BALANCE, period="quarter")
    rows = [{"item_id": field, "2026-Q2": value, "_source": "KBS", "_value_unit": "VND"}
            for field, value in [("total_assets", 55_677_822_007_000), ("total_equity", 10), ("total_equity", 20)]]
    statement = VnstockFinancialsFetcher.transform_data(params, rows)[0]
    assert statement.total_assets == 55_677_822_007_000
    assert statement.total_equity is None
    assert statement.unit_metadata["total_equity"]["unavailable_reason"] == "conflicting_metric_rows"
    assert statement.value_unit == "VND"


def test_wide_row_alias_requires_unit_evidence_and_converts_once():
    """A camelCase alias is normalized like a mapped key, never certified blind.

    `totalAssets` is read by the wide-row constructor but was absent from
    `_metric_mapping`, so its value used to enter the statement with no lineage
    entry and the row was still certified VND (issue #106).
    """
    params = FinancialsQueryParams(
        symbol="VNM", statement_type=StatementType.BALANCE, period="year"
    )

    # Sourced but unitless: no unit evidence, so the alias value is withheld.
    withheld = VnstockFinancialsFetcher.transform_data(
        params, [{"period": "2025", "totalAssets": 53_312.37, "_source": "KBS"}]
    )[0]
    assert withheld.total_assets is None
    assert withheld.value_unit is None
    assert withheld.unavailable_reason == "unknown_source_unit"
    assert withheld.unit_metadata["total_assets"]["unavailable_reason"] == "unknown_source_unit"

    # Explicit unit: the alias value is converted exactly once.
    scaled = VnstockFinancialsFetcher.transform_data(
        params,
        [{"period": "2025", "totalAssets": 53_312.37, "_source": "fixture", "_value_unit": "Bn. VND"}],
    )[0]
    assert scaled.total_assets == 53_312_370_000_000
    assert scaled.value_unit == "VND"
    assert scaled.unit_metadata["total_assets"]["normalization_multiplier"] == 1_000_000_000

    # No source and no unit: unchanged contract, recorded rather than assumed.
    unitless = VnstockFinancialsFetcher.transform_data(
        params, [{"period": "2025", "totalAssets": 53_312.37}]
    )[0]
    assert unitless.total_assets == 53_312.37
    assert unitless.value_unit == "VND"
    assert unitless.unit_metadata["total_assets"]["source_unit"] == "VND"


def test_wide_row_alias_selection_is_independent_of_input_key_order():
    """The selected alias is the constructor's first argument, not the row's key order.

    `net_income` reads `netIncome` before `postTaxProfit`, so a row that carries both
    must resolve to `netIncome` whichever way the dict is written (issue #106).
    """
    params = FinancialsQueryParams(
        symbol="VNM", statement_type=StatementType.INCOME, period="year"
    )
    base = {"period": "2025", "_source": "fixture", "_value_unit": "VND"}

    forward = VnstockFinancialsFetcher.transform_data(
        params, [dict(base, netIncome=7.0, postTaxProfit=5.0)]
    )[0]
    reversed_keys = VnstockFinancialsFetcher.transform_data(
        params, [dict(base, postTaxProfit=5.0, netIncome=7.0)]
    )[0]

    assert forward.net_income == 7.0
    assert reversed_keys.net_income == 7.0
    assert forward.unit_metadata["net_income"]["label"] == "netIncome"
    assert reversed_keys.unit_metadata["net_income"]["label"] == "netIncome"


def test_wide_row_alias_does_not_fall_back_past_a_rejected_higher_priority_key():
    """A unit-rejected first alias withholds the metric instead of using a later alias."""
    params = FinancialsQueryParams(
        symbol="VNM", statement_type=StatementType.INCOME, period="year"
    )
    row = VnstockFinancialsFetcher.transform_data(
        params,
        [{"period": "2025", "netIncome": 7.0, "postTaxProfit": 5.0, "_source": "KBS"}],
    )[0]

    assert row.net_income is None
    assert row.value_unit is None
    assert row.unit_metadata["net_income"]["label"] == "netIncome"
    assert row.unit_metadata["net_income"]["unavailable_reason"] == "unknown_source_unit"
