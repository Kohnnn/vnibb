from types import SimpleNamespace
from datetime import date

import pytest

from vnibb.api.v1.schemas import StandardResponse
from vnibb.api.v1.equity import _normalize_statement_unit_outliers, _ratio_has_metric_value, _to_ratio_data
from vnibb.api.v1.equity import _enrich_missing_ratio_metrics
from vnibb.api.v1.equity import _compute_rolling_high_low, _load_mongo_financial_ratio_rows, _load_mongo_financial_statement_rows
from vnibb.api.v1.equity import get_fundamental_analysis
from vnibb.models.company import Company
from vnibb.models.financials import IncomeStatement, BalanceSheet, CashFlow
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models.stock import Stock, StockPrice
from vnibb.providers.vnstock.financial_ratios import FinancialRatioData
from vnibb.providers.vnstock.financials import FinancialStatementData


class FakeMongoMarketDataService:
    enabled = True

    def __init__(self, rows):
        self.rows = rows
        self.requests = []

    async def get_raw_dataset_records(self, symbol, *, dataset, variant=None, limit):
        self.requests.append({"symbol": symbol, "dataset": dataset, "variant": variant, "limit": limit})
        return self.rows

    async def get_eod_prices(self, symbol, *, lookback_days, limit):
        self.requests.append({"symbol": symbol, "dataset": "market_prices_eod", "lookback_days": lookback_days, "limit": limit})
        return self.rows


@pytest.mark.asyncio
async def test_fundamental_analysis_composes_sections_and_degrades(monkeypatch):
    async def fake_profile(symbol, refresh, db):
        return StandardResponse(data={"symbol": symbol, "company_name": "FPT Corp"})

    async def fake_ratios(symbol, period, db):
        return StandardResponse(data=[{"period": "2023", "pe": 10}, {"period": "2024", "pe": 12}])

    async def fake_financials(symbol, statement_type, period, limit, db):
        return StandardResponse(data=[{"period": "2024", "statement_type": statement_type}])

    async def fake_shareholders(symbol, db):
        return StandardResponse(data=[{"shareholder_name": "Holder"}])

    async def fake_officers(symbol):
        return StandardResponse(data=[{"name": "CEO"}])

    async def fake_subsidiaries(symbol):
        raise RuntimeError("subsidiaries unavailable")

    async def fake_news(symbol, limit):
        return StandardResponse(data=[{"title": "News"}])

    async def fake_events(symbol, limit, db):
        return StandardResponse(data=[], error="events unavailable")

    async def fake_snapshot(symbol):
        return {
            "symbol": symbol,
            "snapshotDate": "2026-06-14",
            "intrinsicValue": 120000,
            "marginOfSafety": 25.0,
            "valuationMethod": "dcf",
            "moat": "wide",
            "roe": 22.5,
            "netMargin": 15.0,
            "fcfPositive": True,
            "dividendYears": 5,
        }

    monkeypatch.setattr("vnibb.api.v1.equity.get_profile", fake_profile)
    monkeypatch.setattr("vnibb.api.v1.equity.get_financial_ratios", fake_ratios)
    monkeypatch.setattr("vnibb.api.v1.equity.get_financials", fake_financials)
    monkeypatch.setattr("vnibb.api.v1.equity.get_shareholders", fake_shareholders)
    monkeypatch.setattr("vnibb.api.v1.equity.get_officers", fake_officers)
    monkeypatch.setattr("vnibb.api.v1.equity.get_subsidiaries", fake_subsidiaries)
    monkeypatch.setattr("vnibb.api.v1.equity.get_company_news", fake_news)
    monkeypatch.setattr("vnibb.api.v1.equity.get_company_events", fake_events)
    monkeypatch.setattr("vnibb.api.v1.equity._load_latest_fundamental_snapshot", fake_snapshot)

    response = await get_fundamental_analysis("fpt", db=None)  # type: ignore[arg-type]

    assert response.data["symbol"] == "FPT"
    assert response.data["profile"]["company_name"] == "FPT Corp"
    assert response.data["latest_fundamental_snapshot"]["ratio"]["period"] == "2024"
    assert response.data["latest_fundamental_snapshot"]["financials"]["income"]["period"] == "2024"
    assert response.data["valuation"]["intrinsic_value"] == 120000
    assert response.data["valuation"]["valuation_method"] == "dcf"
    assert response.data["competitive_advantage"]["moat"] == "wide"
    assert "ROE 22.5%" in response.data["competitive_advantage"]["reasons"]
    assert response.data["subsidiaries"] == []
    assert response.data["section_errors"] == {
        "subsidiaries": "subsidiaries unavailable",
        "events": "events unavailable",
    }
    assert response.error == "Partial data unavailable"


def test_normalize_statement_unit_outliers_repairs_single_1000x_row():
    rows = [
        FinancialStatementData(symbol="FPT", period="Q1-2025", statement_type="balance", total_assets=73_997_673_121_789, cash=5_342_746_710_936),
        FinancialStatementData(symbol="FPT", period="Q2-2025", statement_type="balance", total_assets=81_266_075_455_371, cash=7_755_450_852_909),
        FinancialStatementData(symbol="FPT", period="Q3-2025", statement_type="balance", total_assets=81_601_597_008_000_000, cash=7_755_450_853_000_000),
    ]

    normalized = _normalize_statement_unit_outliers(rows)

    assert normalized[2].total_assets == 81_601_597_008_000
    assert normalized[2].cash == 7_755_450_853_000

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


def test_to_ratio_data_prefers_quarter_metadata_over_bare_year():
    row = make_ratio_row(period="2024", fiscal_year=2024, fiscal_quarter=1, period_type="quarter")
    result = _to_ratio_data(row)
    assert result.period == "Q1-2024"


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
async def test_load_mongo_financial_statement_rows_transforms_raw_records(monkeypatch):
    fake_service = FakeMongoMarketDataService(
        [
            {
                "raw": {
                    "yearReport": 2024,
                    "revenue": 1200.0,
                    "netIncome": 180.0,
                }
            },
            {
                "raw": {
                    "yearReport": 2023,
                    "revenue": 1000.0,
                    "netIncome": 150.0,
                }
            },
        ]
    )
    monkeypatch.setattr("vnibb.api.v1.equity.get_mongo_market_data_service", lambda: fake_service)

    rows = await _load_mongo_financial_statement_rows("VCI", "income", "year", 10)

    assert [row.period for row in rows] == ["2023", "2024"]
    assert rows[-1].revenue == pytest.approx(1200.0)
    assert rows[-1].net_income == pytest.approx(180.0)
    assert fake_service.requests[0]["dataset"] == "finance.income_statement"
    assert fake_service.requests[0]["variant"] == "finance.income_statement.year"


@pytest.mark.asyncio
async def test_load_mongo_financial_ratio_rows_transforms_and_filters_raw_records(monkeypatch):
    fake_service = FakeMongoMarketDataService(
        [
            {"raw": {"yearReport": 2024, "quarter": 1, "priceToEarning": 9.2, "priceToBook": 1.4}},
            {"raw": {"yearReport": 2024, "quarter": 2, "priceToEarning": 9.6, "priceToBook": 1.5}},
            {"raw": {"yearReport": 2023, "quarter": 1, "priceToEarning": 8.5, "priceToBook": 1.2}},
        ]
    )
    monkeypatch.setattr("vnibb.api.v1.equity.get_mongo_market_data_service", lambda: fake_service)

    rows = await _load_mongo_financial_ratio_rows("VCI", "Q1", limit=10)

    assert [row.period for row in rows] == ["Q1-2023", "Q1-2024"]
    assert rows[-1].pe == pytest.approx(9.2)
    assert rows[-1].pb == pytest.approx(1.4)
    assert fake_service.requests[0]["dataset"] == "finance.ratio"
    assert fake_service.requests[0]["variant"] == "finance.ratio.quarter"


@pytest.mark.asyncio
async def test_compute_rolling_high_low_prefers_mongo_eod(monkeypatch):
    fake_service = FakeMongoMarketDataService(
        [
            {"high": 10.0, "low": 8.0},
            {"high": 15.0, "low": 7.5},
            {"high": 12.0, "low": 9.0},
        ]
    )
    monkeypatch.setattr("vnibb.api.v1.equity.get_mongo_market_data_service", lambda: fake_service)

    high, low = await _compute_rolling_high_low(None, "VCI", trading_days=252)  # type: ignore[arg-type]

    assert high == pytest.approx(15.0)
    assert low == pytest.approx(7.5)
    assert fake_service.requests[0]["dataset"] == "market_prices_eod"


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


@pytest.mark.asyncio
async def test_enrich_missing_ratio_metrics_backfills_missing_statement_periods(test_db):
    test_db.add(Stock(symbol="VNM", exchange="HOSE", industry="Consumer", sector="Staples"))
    test_db.add_all(
        [
            IncomeStatement(
                id=30,
                symbol="VNM",
                period="2022",
                period_type="year",
                fiscal_year=2022,
                revenue=120.0,
                net_income=24.0,
            ),
            IncomeStatement(
                id=31,
                symbol="VNM",
                period="2021",
                period_type="year",
                fiscal_year=2021,
                revenue=100.0,
                net_income=20.0,
            ),
            BalanceSheet(
                id=30,
                symbol="VNM",
                period="2022",
                period_type="year",
                fiscal_year=2022,
                total_assets=200.0,
                total_liabilities=80.0,
                total_equity=120.0,
            ),
            BalanceSheet(
                id=31,
                symbol="VNM",
                period="2021",
                period_type="year",
                fiscal_year=2021,
                total_assets=180.0,
                total_liabilities=70.0,
                total_equity=110.0,
            ),
        ]
    )
    await test_db.commit()

    rows = [FinancialRatioData(symbol="VNM", period="2022", pe=10.0)]
    enriched = await _enrich_missing_ratio_metrics("VNM", "year", rows, test_db)

    periods = {item.period for item in enriched}
    assert "2021" in periods

    backfilled_2021 = next(item for item in enriched if item.period == "2021")
    assert backfilled_2021.roe == pytest.approx((20.0 / 110.0) * 100)


@pytest.mark.asyncio
async def test_enrich_missing_ratio_metrics_uses_period_end_price_for_valuation(test_db):
    test_db.add(Stock(id=40, symbol="VNM", exchange="HOSE", company_name="Vinamilk"))
    test_db.add(
        Company(
            symbol="VNM",
            company_name="Vinamilk",
            exchange="HOSE",
            outstanding_shares=1_000_000,
        )
    )
    test_db.add_all(
        [
            StockPrice(
                id=400,
                stock_id=40,
                symbol="VNM",
                time=date(2022, 12, 30),
                open=50.0,
                high=51.0,
                low=49.0,
                close=50.0,
                volume=1000,
                interval="1D",
            ),
            StockPrice(
                id=401,
                stock_id=40,
                symbol="VNM",
                time=date(2024, 1, 2),
                open=80.0,
                high=81.0,
                low=79.0,
                close=80.0,
                volume=1000,
                interval="1D",
            ),
        ]
    )
    await test_db.commit()

    rows = [FinancialRatioData(symbol="VNM", period="2022", eps=5_000.0, bvps=20_000.0)]
    enriched = await _enrich_missing_ratio_metrics("VNM", "year", rows, test_db)
    item = enriched[0]

    assert item.pe == pytest.approx(10.0)
    assert item.pb == pytest.approx(2.5)
