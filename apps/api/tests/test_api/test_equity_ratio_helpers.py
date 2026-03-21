from types import SimpleNamespace
from datetime import date

import pytest

from vnibb.api.v1.equity import _ratio_has_metric_value, _to_ratio_data
from vnibb.api.v1.equity import _enrich_missing_ratio_metrics
from vnibb.models.company import Company
from vnibb.models.financials import IncomeStatement, BalanceSheet, CashFlow
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models.stock import Stock
from vnibb.providers.vnstock.financial_ratios import FinancialRatioData


def make_ratio_row(**overrides):
    base = {
        "symbol": "VNM",
        "period": "2024",
        "fiscal_year": 2024,
        "fiscal_quarter": None,
        "pe_ratio": None,
        "pb_ratio": None,
        "ps_ratio": None,
        "ev_ebitda": None,
        "ev_sales": None,
        "roe": None,
        "roa": None,
        "eps": None,
        "bvps": None,
        "debt_to_equity": None,
        "debt_to_assets": None,
        "current_ratio": None,
        "quick_ratio": None,
        "cash_ratio": None,
        "gross_margin": None,
        "net_margin": None,
        "operating_margin": None,
        "interest_coverage": None,
        "revenue_growth": None,
        "earnings_growth": None,
        "raw_data": None,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def test_to_ratio_data_uses_fiscal_year_when_period_is_index():
    row = make_ratio_row(period="31", fiscal_year=2024)
    result = _to_ratio_data(row)
    assert result.period == "2024"


def test_to_ratio_data_uses_quarter_label_when_available():
    row = make_ratio_row(period="11", fiscal_year=2024, fiscal_quarter=2)
    result = _to_ratio_data(row)
    assert result.period == "Q2-2024"


def test_ratio_has_metric_value_returns_false_for_empty_row():
    item = FinancialRatioData(symbol="VNM", period="2024")
    assert _ratio_has_metric_value(item) is False


def test_ratio_has_metric_value_returns_true_for_zero_and_positive_values():
    item = FinancialRatioData(symbol="VNM", period="2024", pe=0.0)
    assert _ratio_has_metric_value(item) is True


def test_to_ratio_data_reads_ev_sales_from_raw_data_fallback():
    row = make_ratio_row(raw_data={"evToSales": 3.25})
    result = _to_ratio_data(row)
    assert result.ev_sales == 3.25


@pytest.mark.asyncio
async def test_enrich_missing_ratio_metrics_computes_extended_metrics(test_db):
    test_db.add(
        Company(
            symbol="VNM",
            outstanding_shares=2_000_000_000,
        )
    )
    test_db.add(
        ScreenerSnapshot(
            symbol="VNM",
            snapshot_date=date(2025, 1, 10),
            price=100.0,
            market_cap=2400.0,
        )
    )
    test_db.add_all(
        [
            IncomeStatement(
                id=1,
                symbol="VNM",
                period="2024",
                period_type="year",
                fiscal_year=2024,
                revenue=1200.0,
                operating_income=180.0,
                net_income=150.0,
                cost_of_revenue=700.0,
                interest_expense=20.0,
                eps=5.0,
            ),
            IncomeStatement(
                id=2,
                symbol="VNM",
                period="2023",
                period_type="year",
                fiscal_year=2023,
                revenue=1000.0,
                net_income=120.0,
                eps=4.2,
            ),
            BalanceSheet(
                id=1,
                symbol="VNM",
                period="2024",
                period_type="year",
                fiscal_year=2024,
                total_assets=2000.0,
                total_liabilities=800.0,
                total_equity=1200.0,
                cash_and_equivalents=100.0,
                inventory=200.0,
                accounts_receivable=240.0,
                short_term_debt=50.0,
                long_term_debt=200.0,
            ),
            BalanceSheet(
                id=2,
                symbol="VNM",
                period="2023",
                period_type="year",
                fiscal_year=2023,
                inventory=180.0,
                accounts_receivable=220.0,
            ),
            CashFlow(
                id=1,
                symbol="VNM",
                period="2024",
                period_type="year",
                fiscal_year=2024,
                operating_cash_flow=210.0,
                free_cash_flow=130.0,
                capital_expenditure=-80.0,
                dividends_paid=-40.0,
                debt_repayment=-30.0,
            ),
        ]
    )
    await test_db.commit()

    rows = [FinancialRatioData(symbol="VNM", period="2024", pe=10.0)]
    enriched = await _enrich_missing_ratio_metrics("VNM", "year", rows, test_db)
    item = enriched[0]

    assert item.operating_margin == pytest.approx(15.0)
    assert item.asset_turnover == pytest.approx(0.6)
    assert item.inventory_turnover == pytest.approx(700.0 / 190.0)
    assert item.receivables_turnover == pytest.approx(1200.0 / 230.0)
    assert item.debt_assets == pytest.approx(0.4)
    assert item.equity_multiplier == pytest.approx(2000.0 / 1200.0)
    assert item.roic == pytest.approx((150.0 / 1400.0) * 100)
    assert item.revenue_growth == pytest.approx(20.0)
    assert item.earnings_growth == pytest.approx(25.0)
    assert item.debt_service_coverage == pytest.approx(3.6)
    assert item.ocf_debt == pytest.approx(0.2625)
    assert item.ocf_sales == pytest.approx(0.175)
    assert item.ev_sales == pytest.approx((2400.0 + 250.0 - 100.0) / 1200.0)
    assert item.fcf_yield == pytest.approx(130.0 / 2400.0)
    assert item.dps == pytest.approx(0.00000002)
    assert item.dividend_yield == pytest.approx(0.00000002)
    assert item.payout_ratio == pytest.approx((40.0 / 150.0) * 100)
    assert item.peg_ratio == pytest.approx(0.4)


@pytest.mark.asyncio
async def test_enrich_missing_ratio_metrics_nulls_bank_only_metrics(test_db):
    test_db.add(
        Stock(
            symbol="TCB",
            exchange="HOSE",
            industry="Banking",
            sector="Banking",
        )
    )
    test_db.add(
        Company(
            symbol="TCB",
            outstanding_shares=1_000_000_000,
        )
    )
    test_db.add(
        ScreenerSnapshot(
            symbol="TCB",
            snapshot_date=date(2025, 1, 10),
            price=30.0,
            market_cap=1200.0,
            industry="Banking",
        )
    )
    test_db.add_all(
        [
            IncomeStatement(
                id=10,
                symbol="TCB",
                period="2024",
                period_type="year",
                fiscal_year=2024,
                revenue=200.0,
                operating_income=120.0,
                net_income=100.0,
                interest_expense=15.0,
            ),
            IncomeStatement(
                id=11,
                symbol="TCB",
                period="2023",
                period_type="year",
                fiscal_year=2023,
                revenue=150.0,
                net_income=80.0,
            ),
            BalanceSheet(
                id=10,
                symbol="TCB",
                period="2024",
                period_type="year",
                fiscal_year=2024,
                total_assets=1000.0,
                total_liabilities=850.0,
                total_equity=150.0,
                cash_and_equivalents=100.0,
            ),
            CashFlow(
                id=10,
                symbol="TCB",
                period="2024",
                period_type="year",
                fiscal_year=2024,
                operating_cash_flow=90.0,
                free_cash_flow=80.0,
                capital_expenditure=-10.0,
                dividends_paid=-5.0,
            ),
        ]
    )
    await test_db.commit()

    rows = [FinancialRatioData(symbol="TCB", period="2024", pe=8.0, pb=1.2)]
    enriched = await _enrich_missing_ratio_metrics("TCB", "year", rows, test_db)
    item = enriched[0]

    assert item.roe == pytest.approx((100.0 / 150.0) * 100)
    assert item.roa == pytest.approx(10.0)
    assert item.equity_multiplier == pytest.approx(1000.0 / 150.0)
    assert item.revenue_growth == pytest.approx((200.0 - 150.0) / 150.0 * 100)
    assert item.ps is None
    assert item.ev_sales is None
    assert item.ebitda is None
    assert item.roic is None
    assert item.current_ratio is None
    assert item.quick_ratio is None
    assert item.cash_ratio is None
    assert item.inventory_turnover is None
    assert item.gross_margin is None
    assert item.net_margin is None
    assert item.operating_margin is None
    assert item.debt_service_coverage is None
    assert item.ocf_debt is None
    assert item.ocf_sales is None
    assert item.fcf_yield is None
    assert item.debt_equity is None


@pytest.mark.asyncio
async def test_enrich_missing_ratio_metrics_computes_bank_native_kpis(test_db):
    test_db.add(
        Stock(
            symbol="VCB",
            exchange="HOSE",
            industry="Banking",
            sector="Banking",
        )
    )
    test_db.add_all(
        [
            IncomeStatement(
                id=20,
                symbol="VCB",
                period="2024",
                period_type="year",
                fiscal_year=2024,
                revenue=120.0,
                net_income=30.0,
                raw_data={"Net Interest Income": 80.0, "Provision for credit losses": -10.0},
            ),
            IncomeStatement(
                id=21,
                symbol="VCB",
                period="2023",
                period_type="year",
                fiscal_year=2023,
                revenue=100.0,
                net_income=25.0,
                raw_data={"Net Interest Income": 70.0, "Provision for credit losses": -8.0},
            ),
            BalanceSheet(
                id=20,
                symbol="VCB",
                period="2024",
                period_type="year",
                fiscal_year=2024,
                total_assets=1000.0,
                total_liabilities=850.0,
                total_equity=150.0,
                accounts_receivable=700.0,
                raw_data={
                    "Deposits from customers": 500.0,
                    "Demand deposits": 150.0,
                    "Placements with and loans to other credit institutions": 100.0,
                    "Investment Securities": 200.0,
                    "Less: Provision for losses on loans and advances to customers": -50.0,
                },
            ),
            BalanceSheet(
                id=21,
                symbol="VCB",
                period="2023",
                period_type="year",
                fiscal_year=2023,
                total_assets=900.0,
                total_liabilities=770.0,
                total_equity=130.0,
                accounts_receivable=630.0,
                raw_data={
                    "Deposits from customers": 400.0,
                    "Demand deposits": 120.0,
                    "Placements with and loans to other credit institutions": 80.0,
                    "Investment Securities": 150.0,
                    "Less: Provision for losses on loans and advances to customers": -45.0,
                },
            ),
        ]
    )
    await test_db.commit()

    rows = [FinancialRatioData(symbol="VCB", period="2024", pe=10.0, pb=1.8)]
    enriched = await _enrich_missing_ratio_metrics("VCB", "year", rows, test_db)
    item = enriched[0]

    assert item.loan_to_deposit == pytest.approx(700.0 / 500.0)
    assert item.casa_ratio == pytest.approx((150.0 / 500.0) * 100)
    assert item.deposit_growth == pytest.approx((500.0 - 400.0) / 400.0 * 100)
    assert item.equity_to_assets == pytest.approx((150.0 / 1000.0) * 100)
    assert item.asset_yield == pytest.approx((120.0 / 930.0) * 100)
    assert item.nim == pytest.approx((80.0 / 930.0) * 100)
    assert item.credit_cost == pytest.approx((10.0 / 665.0) * 100)
    assert item.provision_coverage == pytest.approx((50.0 / 700.0) * 100)
