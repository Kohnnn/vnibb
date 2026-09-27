from datetime import datetime
from decimal import Decimal

import pytest
from vnibb.models.financials import BalanceSheet, CashFlow, IncomeStatement
from vnibb.models.stock import Stock
from vnibb.models.trading import FinancialRatio
from vnibb.services.matrix_observations import (
    ObservationBuilder,
    build_matrix_fixture,
    build_matrix_observations,
    canonical_decimal,
    display_decimal,
    prepare_matrix,
)
from vnibb.services.matrix_playbooks import classify_sector

CAPTURED = "2025-01-01T00:00:00+00:00"


def statement(model, *, year=2024, quarter=None, metadata=None, **values):
    return model(
        id=year * 10 + (quarter or 0),
        symbol="MXA",
        period=f"Q{quarter}-{year}" if quarter else str(year),
        period_type="quarter" if quarter else "year",
        fiscal_year=year,
        fiscal_quarter=quarter,
        source="test_seed",
        updated_at=datetime(2025, 1, 1),
        raw_data=metadata if metadata is not None else {"unit": "VND", "consolidation": "consolidated", "flow_basis": "single_quarter"},
        **values,
    )


def cell(result, entity, dimension):
    return next(item for item in result["cells"] if item["entity_id"] == entity and item["dimension_id"] == dimension)


def metric(result_cell, key):
    return next(item for item in result_cell["payload"]["metrics"] if item["key"] == key)


@pytest.mark.parametrize("value,canonical,display", [
    (Decimal("-1234567.895"), "-1234567.895", "-1,234,567.90 VND"),
    (Decimal("0.000"), "0", "0.00 VND"),
    (Decimal("1000.000"), "1000", "1,000.00 VND"),
    (float("nan"), None, "Unavailable"),
])
def test_decimal_values_and_display_preserve_signed_values(value, canonical, display):
    assert canonical_decimal(value) == canonical
    assert display_decimal(canonical, "VND") == display


@pytest.mark.parametrize("denominator,metadata,reason", [
    (0, None, "denominator must be positive"),
    (-1, None, "denominator must be positive"),
    (100, {}, "unit or accounting scope is unknown"),
    (100, {"unit": "VND"}, "unit or accounting scope is unknown"),
])
def test_derivations_withhold_unsafe_denominators_and_missing_basis(denominator, metadata, reason):
    row = statement(IncomeStatement, revenue=denominator, net_income=-10, metadata=metadata)
    builder = ObservationBuilder("MXA", "2024", {(IncomeStatement, False): row}, CAPTURED)
    profit = builder.observe(IncomeStatement, "net_income", "Net profit")
    revenue = builder.observe(IncomeStatement, "revenue", "Revenue")
    derived = builder.derive("margin", "Margin", [profit, revenue], "ratio", "%")
    assert derived["value"] is None
    assert reason in derived["basis"]
    assert derived["evidence_ids"] == []


def test_negative_numerator_and_exact_frozen_lineage_are_preserved():
    row = statement(IncomeStatement, revenue=100, net_income=-12.345)
    builder = ObservationBuilder("MXA", "2024", {(IncomeStatement, False): row}, CAPTURED)
    profit = builder.observe(IncomeStatement, "net_income", "Net profit")
    revenue = builder.observe(IncomeStatement, "revenue", "Revenue")
    derived = builder.derive("margin", "Margin", [profit, revenue], "ratio", "%")
    row.net_income = 999
    assert profit["value"] == "-12.345"
    assert derived["display"] == "-12.35%"
    evidence = builder.evidence[derived["evidence_ids"][0]]
    assert evidence["input_evidence_ids"] == [*profit["evidence_ids"], *revenue["evidence_ids"]]
    assert builder.evidence[profit["evidence_ids"][0]]["locator"] == "income_statements/row/20240/period/year/2024"
    assert builder.evidence[profit["evidence_ids"][0]]["field"] == "net_income"


def test_different_scopes_and_units_are_not_comparable():
    income = statement(IncomeStatement, net_income=10)
    balance = statement(BalanceSheet, total_equity=100, metadata={"unit": "billion VND", "consolidation": "standalone"})
    builder = ObservationBuilder("MXA", "2024", {(IncomeStatement, False): income, (BalanceSheet, False): balance}, CAPTURED)
    profit = builder.observe(IncomeStatement, "net_income", "Profit")
    equity = builder.observe(BalanceSheet, "total_equity", "Equity")
    result = builder.derive("return", "Return", [profit, equity], "ratio", "%")
    assert result["value"] is None
    assert "differ" in result["basis"]


@pytest.mark.parametrize("industry,family,subtype", [
    (None, None, None), ("Other financial services", None, None),
    ("Ngân hàng", "bank", None), ("Securities", "securities", None),
    ("Bảo hiểm phi nhân thọ", "insurer", "non-life"),
    ("Software", "nonfinancial", None),
])
def test_unknown_classification_never_defaults_to_nonfinancial(industry, family, subtype):
    assert classify_sector(industry) == (family, subtype)


@pytest.mark.asyncio
@pytest.mark.parametrize("playbook,industry,dimension,expected_key", [
    ("nonfinancial", "Software", "growth", "revenue"),
    ("bank", "Banks", "capital", "equity_assets"),
    ("insurer", "Non-life insurance", "profitability", "net_income"),
    ("securities", "Securities", "profitability", "total_equity"),
])
async def test_each_playbook_builds_real_stored_observations(test_db, playbook, industry, dimension, expected_key):
    try:
        for index, symbol in enumerate(("MXA", "MXB")):
            test_db.add(Stock(id=990001 + index, symbol=symbol, company_name=f"Test {symbol}", industry=industry, sector=industry, is_active=1))
            for model, fields in ((IncomeStatement, {"revenue": 100, "net_income": -10}), (BalanceSheet, {"total_assets": 500, "total_equity": 100, "short_term_debt": 10, "long_term_debt": 20}), (CashFlow, {"operating_cash_flow": 25}), (FinancialRatio, {"pe_ratio": 10, "pb_ratio": 2})):
                row = statement(model, **fields)
                row.id, row.symbol = 990001 + index, symbol
                test_db.add(row)
        await test_db.flush()
        built = await build_matrix_observations(test_db, ["MXA", "MXB"], playbook, "2024", "year")
        observed = metric(cell(built, "MXA", dimension), expected_key)
        assert observed["value"] is not None
        assert observed["evidence_ids"]
        assert cell(built, "MXA", dimension)["state"] == "supported"
        assert cell(built, "MXA", "sources")["evidence_ids"] == []
        assert cell(built, "MXA", "artifact")["state"] == "unavailable"
        if playbook == "bank":
            assert observed["value"] == "20"
            assert metric(cell(built, "MXA", "credit"), "nim")["value"] is None
            assert metric(cell(built, "MXA", "funding"), "customer_loans")["value"] is None
        if playbook == "insurer":
            assert metric(cell(built, "MXA", "insurance"), "insurance_premiums")["value"] is None
        if playbook == "securities":
            assert metric(cell(built, "MXA", "securities"), "brokerage_revenue")["value"] is None
    finally:
        await test_db.rollback()


@pytest.mark.asyncio
async def test_quarter_growth_uses_prior_year_same_quarter_not_annual_or_adjacent(test_db):
    try:
        test_db.add(Stock(id=990001, symbol="MXA", industry="Software", is_active=1))
        for year, quarter, revenue in ((2024, 2, 120), (2023, 2, 100), (2024, 1, 50), (2023, None, 1000)):
            test_db.add(statement(IncomeStatement, year=year, quarter=quarter, revenue=revenue, net_income=10))
        await test_db.flush()
        built = await build_matrix_observations(test_db, ["MXA"], "nonfinancial", "2024-Q2", "quarter")
        growth = metric(cell(built, "MXA", "growth"), "revenue_yoy")
        assert growth["value"] == "20"
        assert growth["period"] == "2024-Q2"
        direct_inputs = [item for item in built["evidence"] if item["field"] == "revenue"]
        assert {item["period"] for item in direct_inputs} == {"2024-Q2", "2023-Q2"}
    finally:
        await test_db.rollback()


@pytest.mark.asyncio
async def test_peers_exclude_unrelated_same_exchange_and_intersect_years(test_db):
    try:
        for index, (symbol, industry, years) in enumerate((("MXA", "Software", (2023, 2024)), ("MXB", "Software", (2023,)), ("MXC", "Banks", (2024,)))):
            test_db.add(Stock(id=990001 + index, symbol=symbol, industry=industry, exchange="HOSE", is_active=1))
            for year in years:
                row = statement(IncomeStatement, year=year, revenue=100)
                row.id, row.symbol = 990000 + index * 100 + year, symbol
                test_db.add(row)
        await test_db.flush()
        prepared = await prepare_matrix(test_db, "MXA")
        assert prepared["symbols"] == ["MXA", "MXB"]
        assert prepared["periods"] == ["2023"]
    finally:
        await test_db.rollback()


def test_fixture_distinguishes_inventory_evidence_and_all_truthful_states():
    fixture = build_matrix_fixture()
    snapshot = fixture["snapshot"]
    assert snapshot["synthetic"] is True
    assert cell(snapshot, "DEMO_A", "number")["payload"]["metrics"][0]["display"] == "-1,234,567.90 VND"
    assert cell(snapshot, "DEMO_A", "source_set")["evidence_ids"] == []
    assert cell(snapshot, "DEMO_A", "artifact")["payload"]["artifact_ref"] is None
    assert {item["state"] for item in snapshot["cells"]} == {"supported", "unavailable", "non_comparable", "failed", "denied"}
    assert build_matrix_fixture() == fixture


@pytest.mark.asyncio
async def test_different_company_scopes_and_undated_valuation_are_noncomparable(test_db):
    try:
        for index, (symbol, scope) in enumerate((("MXA", "consolidated"), ("MXB", "standalone"))):
            test_db.add(Stock(id=990001 + index, symbol=symbol, industry="Software", is_active=1))
            for model, fields in ((IncomeStatement, {"revenue": 100, "net_income": 10}), (FinancialRatio, {"pe_ratio": 12, "pb_ratio": 2})):
                row = statement(model, metadata={"unit": "VND", "consolidation": scope}, **fields)
                row.id, row.symbol = 990001 + index, symbol
                test_db.add(row)
        await test_db.flush()
        result = await build_matrix_observations(test_db, ["MXA", "MXB"], "nonfinancial", "2024", "year")
        for symbol in ("MXA", "MXB"):
            assert cell(result, symbol, "growth")["state"] == "non_comparable"
            assert cell(result, symbol, "valuation")["state"] == "non_comparable"
        revenue_evidence = next(item for item in result["evidence"] if item["field"] == "revenue")
        assert revenue_evidence["source"] == "stored.sql.income_statements:test_seed"
    finally:
        await test_db.rollback()


def test_quarter_flow_basis_is_not_inferred_from_period_label():
    row = statement(IncomeStatement, quarter=2, revenue=100, net_income=10, metadata={"unit": "VND", "consolidation": "consolidated"})
    builder = ObservationBuilder("MXA", "2024-Q2", {(IncomeStatement, False): row}, CAPTURED)
    profit = builder.observe(IncomeStatement, "net_income", "Profit")
    revenue = builder.observe(IncomeStatement, "revenue", "Revenue")
    margin = builder.derive("margin", "Margin", [profit, revenue], "ratio", "%")
    assert margin["value"] is None
    assert "unknown quarterly flow basis" in profit["basis"]


def test_currency_metadata_cannot_label_bank_ratio_as_money():
    row = statement(FinancialRatio, roe=15)
    builder = ObservationBuilder("MXA", "2024", {(FinancialRatio, False): row}, CAPTURED)
    roe = builder.observe(FinancialRatio, "roe", "ROE")
    assert roe["unit"] == "unknown unit"
    assert roe["value"] == "15"
