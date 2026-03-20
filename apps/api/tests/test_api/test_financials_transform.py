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
        {"item_id": "tien_gui_cua_khach_hang", "2024": 1_390_814_015_000_000},
        {"item_id": "deposits_from_customers", "2025": 1_592_598_206_000_000},
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

    data = VnstockFinancialsFetcher.transform_data(params, rows)

    assert len(data) == 1
    assert data[0].accounts_payable == 3_923_309_000.0
    assert data[0].intangible_assets == 1_030_797_450.0


def test_transform_data_maps_kbs_income_aliases_and_scales_monetary_values():
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

    data = VnstockFinancialsFetcher.transform_data(params, rows)

    assert len(data) == 1
    assert data[0].revenue == 3_695_525_335_000.0
    assert data[0].pre_tax_profit == 1_089_337_105_000.0
    assert data[0].net_income == 910_692_113_000.0
    assert data[0].selling_general_admin == -129_175_258_000.0
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

    data = VnstockFinancialsFetcher.transform_data(params, rows)

    assert len(data) == 1
    assert data[0].operating_cash_flow == -4_657_314_437_000.0
    assert data[0].net_change_in_cash == 2_156_458_770_000.0
    assert data[0].capex == -57_598_155_000.0
    assert data[0].dividends_paid == -437_491_942_000.0
    assert data[0].debt_repayment == -7_858_500_000_000.0
