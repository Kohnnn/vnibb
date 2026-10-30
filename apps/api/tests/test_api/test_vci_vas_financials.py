import math

import pytest

from vnibb.providers.vnstock.financials import (
    FinancialsQueryParams,
    StatementType,
    VnstockFinancialsFetcher,
)
from vnibb.services.financial_service import admit_statement_rows


def rows(report, *items, basis=True, symbol="HPG"):
    attrs = {"source": "vci", "symbol": symbol, "report": report, "format": "long", "taxonomy_version": "vas-test"}
    if basis:
        attrs.update(consolidation_basis="consolidated", flow_basis="annual")
    return [{"period": period, "id": item, "name": item, "order": index, "level": 1,
             "unit": unit, "value": value, "_provider_attrs": attrs, "_source": "VCI",
             **({"off_balance": False} if report == "balance_sheet" else {})}
            for index, (period, item, unit, value) in enumerate(items)]


def transform(statement, data, period="year", limit=5, symbol="HPG"):
    params = FinancialsQueryParams(symbol=symbol, statement_type=statement, period=period, limit=limit)
    return VnstockFinancialsFetcher.transform_data(params, data)


@pytest.mark.parametrize("statement,report,item,metric", [
    (StatementType.INCOME, "income_statement", "IS_NET_REVENUE", "revenue"),
    (StatementType.BALANCE, "balance_sheet", "BS_TOTAL_ASSETS", "total_assets"),
    (StatementType.CASHFLOW, "cash_flow", "CF_NET_CASH_FLOWS_FROM_OPERATING_ACTIVITIES", "operating_cash_flow"),
])
def test_vas_period_grouping_limit_and_provenance(statement, report, item, metric):
    data = rows(report, ("2023", item, "VNĐ", 10), ("2025", item, "VNĐ", 30),
                ("2025", "UNKNOWN_ID", "VNĐ", 99), ("2024", item, "VNĐ", 20),
                ("2025-Q1", item, "VNĐ", 999))
    result = transform(statement, data, limit=2)
    assert [row.period for row in result] == ["2025", "2024"]
    assert [getattr(row, metric) for row in result] == [30, 20]
    assert result[0].raw_data["provider_rows"] == data[1:3]
    assert result[0].raw_data["provider_attrs"]["taxonomy_version"] == "vas-test"
    assert result[0].unit_metadata[metric]["source_unit"] == "VNĐ"
    assert getattr(admit_statement_rows(result, "year")[0], metric) == 30


def test_vas_unknown_unit_duplicate_off_balance_and_missing_value():
    data = rows("balance_sheet", ("2025", "BS_TOTAL_ASSETS", "mystery", 50),
                ("2025", "BS_INVENTORIES", "VNĐ", 10), ("2025", "BS_INVENTORIES", "VNĐ", 11),
                ("2025", "BS_FIXED_ASSETS", "VNĐ", 12), ("2025", "BS_SHORT_TERM_ASSETS", "VNĐ", float("nan")))
    data[3]["off_balance"] = True
    result = transform(StatementType.BALANCE, data)[0]
    assert result.total_assets is None
    assert result.inventory is None
    assert result.fixed_assets is None
    assert result.current_assets is None
    assert result.unit_metadata["total_assets"]["unavailable_reason"] == "unknown_source_unit"
    assert result.unit_metadata["inventory"]["unavailable_reason"] == "conflicting_metric_rows"
    assert math.isnan(result.raw_data["provider_rows"][4]["value"])


def test_vas_missing_basis_does_not_admit_even_when_record_looks_standardized():
    data = rows("income_statement", ("2025", "IS_NET_REVENUE", "VNĐ", 100), basis=False)
    data[0].update(statement_type="income", unit_metadata={})
    result = transform(StatementType.INCOME, data)[0]
    assert result.revenue is None
    assert result.unit_metadata["revenue"]["unavailable_reason"] == "unverified_statement_basis"
    assert result.raw_data["provider_rows"][0]["value"] == 100


@pytest.mark.parametrize("change", [
    {"symbol": "VNM"}, {"_source": "KBS"}, {"report": "cash_flow"}, {"fiscal_year": 2024},
])
def test_vas_conflicting_identity_withholds_period(change):
    data = rows("income_statement", ("2025", "IS_NET_REVENUE", "VNĐ", 100))
    data[0].update(change)
    result = transform(StatementType.INCOME, data)[0]
    assert result.revenue is None
    assert result.unavailable_reason


def test_vas_quarter_needs_explicit_flow_basis():
    data = rows("income_statement", ("2025-Q2", "IS_NET_REVENUE", "VNĐ", 100))
    data[0]["_provider_attrs"].pop("flow_basis")
    result = transform(StatementType.INCOME, data, period="quarter")[0]
    assert result.period == "Q2-2025"
    assert result.revenue is None
    assert result.unit_metadata["revenue"]["unavailable_reason"] == "unknown_quarterly_flow_basis"


def test_vas_quarter_grouping_and_explicit_basis():
    data = rows("income_statement", ("2025-Q1", "IS_NET_REVENUE", "VNĐ", 100),
                ("2025", "IS_NET_REVENUE", "VNĐ", 999),
                ("2025-Q2", "IS_NET_REVENUE", "VNĐ", 120),
                ("2025-Q2", "IS_GROSS_PROFIT", "VNĐ", 40))
    data[0]["_provider_attrs"]["flow_basis"] = "single_quarter"
    result = transform(StatementType.INCOME, data, period="quarter", limit=1)
    assert len(result) == 1
    assert (result[0].period, result[0].revenue, result[0].gross_profit) == ("Q2-2025", 120, 40)
    assert [row["id"] for row in result[0].raw_data["provider_rows"]] == ["IS_NET_REVENUE", "IS_GROSS_PROFIT"]


def test_vas_names_and_frame_unit_do_not_certify_unknown_items_or_units():
    data = rows("income_statement", ("2025", "UNKNOWN_ID", "VNĐ", 200),
                ("2025", "IS_NET_REVENUE", "unknown", 100))
    data[0]["name"] = "revenue"
    data[1]["_value_unit"] = "VND"
    result = transform(StatementType.INCOME, data)[0]
    assert result.revenue is None
    assert result.unit_metadata["revenue"]["unavailable_reason"] == "unknown_source_unit"
    assert result.raw_data["provider_rows"][0]["name"] == "revenue"


def test_vas_bank_net_interest_income_stays_raw_without_revenue():
    data = rows("income_statement", ("2025", "IS_NET_INTEREST_INCOME", "VNĐ", 58), symbol="VCB")
    result = admit_statement_rows(transform(StatementType.INCOME, data, symbol="VCB"), "year")[0]
    assert result.revenue is None
    assert "revenue" not in result.unit_metadata
    assert result.raw_data["provider_rows"] == data
    assert result.raw_data["provider_attrs"] == data[0]["_provider_attrs"]


def test_vas_net_revenue_is_unaffected_by_unrelated_bank_id():
    data = rows("income_statement", ("2025", "IS_NET_REVENUE", "VNĐ", 100),
                ("2025", "IS_NET_INTEREST_INCOME", "VNĐ", 40))
    result = admit_statement_rows(transform(StatementType.INCOME, data), "year")[0]
    assert result.revenue == 100
    assert result.unit_metadata["revenue"]["source_id"] == "IS_NET_REVENUE"
    assert result.raw_data["provider_rows"] == data


def test_vas_broad_receivables_stay_raw_without_trade_receivables():
    data = rows("balance_sheet", ("2025", "BS_SHORT_TERM_RECEIVABLES", "VNĐ", 75))
    result = admit_statement_rows(transform(StatementType.BALANCE, data), "year")[0]
    assert result.accounts_receivable is None
    assert "accounts_receivable" not in result.unit_metadata
    assert result.raw_data["provider_rows"] == data


@pytest.mark.parametrize("reverse", [False, True])
def test_vas_accounts_receivable_uses_only_trade_receivables(reverse):
    data = rows("balance_sheet", ("2025", "BS_SHORT_TERM_RECEIVABLES", "VNĐ", 75),
                ("2025", "BS_TRADE_RECEIVABLES", "VNĐ", 25))
    if reverse:
        data.reverse()
    result = admit_statement_rows(transform(StatementType.BALANCE, data), "year")[0]
    assert result.accounts_receivable == 25
    assert result.unit_metadata["accounts_receivable"]["source_id"] == "BS_TRADE_RECEIVABLES"
    assert result.raw_data["provider_rows"] == data


def test_vas_annual_period_does_not_prove_annual_flow():
    data = rows("income_statement", ("2025", "IS_NET_REVENUE", "VNĐ", 100))
    data[0]["_provider_attrs"].pop("flow_basis")
    result = transform(StatementType.INCOME, data)[0]
    assert result.revenue is None
    assert result.unit_metadata["revenue"]["unavailable_reason"] == "unknown_annual_flow_basis"


def test_vas_mixed_basis_withholds_entire_period():
    data = rows("income_statement", ("2025", "IS_NET_REVENUE", "VNĐ", 100),
                ("2025", "IS_GROSS_PROFIT", "VNĐ", 40))
    data[1]["consolidation_basis"] = "separate"
    result = transform(StatementType.INCOME, data)[0]
    assert result.revenue is None
    assert result.gross_profit is None
    assert result.unavailable_reason == "conflicting_statement_basis"
