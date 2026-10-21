from types import SimpleNamespace
from datetime import date
from unittest.mock import AsyncMock

import pytest

from vnibb.api.v1.schemas import StandardResponse
from vnibb.api.v1.equity import _enrich_financial_statement_rows, _ratio_has_metric_value, _to_ratio_data
from vnibb.api.v1.equity import _enrich_missing_ratio_metrics
from vnibb.api.v1.equity import _compute_rolling_high_low, _load_mongo_financial_ratio_rows, _load_mongo_financial_statement_rows
from vnibb.api.v1.equity import get_fundamental_analysis
from vnibb.models.company import Company
from vnibb.models.financials import IncomeStatement, BalanceSheet, CashFlow
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models.stock import Stock, StockPrice
from vnibb.providers.vnstock.financial_ratios import FinancialRatioData
from vnibb.providers.vnstock.financials import FinancialStatementData



@pytest.mark.asyncio
@pytest.mark.parametrize("preferred_units,preferred_roe,expected", [
    ({"roe": "unknown"}, None, None),
    ({"roe": "percent"}, 0.25, 0.25),
    ({}, 99.0, None),
])
async def test_ratio_endpoint_does_not_resurrect_rejected_merged_metrics(monkeypatch, test_db, preferred_units, preferred_roe, expected):
    from vnibb.api.v1 import equity
    from vnibb.models.trading import FinancialRatio

    test_db.add(FinancialRatio(id=901, symbol="VNM", period="2024", period_type="year", fiscal_year=2024, roe=25.0, pe_ratio=10.0, raw_data={"ratio_units": {"roe": "percent"}}))
    await test_db.commit()

    async def mongo_rows(*args, **kwargs):
        return [FinancialRatioData(symbol="VNM", period="2024", roe=preferred_roe, ratio_units=preferred_units)]

    async def latest_statement(*args, **kwargs):
        return 0

    async def unchanged(*args, **kwargs):
        return kwargs["rows"]

    monkeypatch.setattr(equity, "_load_mongo_financial_ratio_rows", mongo_rows)
    monkeypatch.setattr(equity, "_get_latest_statement_period_key", latest_statement)
    monkeypatch.setattr(equity, "_enrich_missing_ratio_metrics", unchanged)
    response = await equity.get_financial_ratios.__wrapped__(symbol="VNM", period="year", db=test_db)
    assert response.data[0].roe == expected
    assert response.data[0].pe == 10.0


@pytest.mark.asyncio
@pytest.mark.parametrize("value,unit,expected", [
    (0.25, "percent", 0.25),
    (47.02, "percent", 47.02),
    (0.0, "percent", 0.0),
    (47.02, "unknown", None),
    (0.25, None, None),
])
async def test_ratio_endpoint_preserves_declared_dividend_yield_without_scale_guesses(
    monkeypatch, test_db, value, unit, expected,
):
    from vnibb.api.v1 import equity
    from vnibb.models.trading import FinancialRatio

    units = {"dividend_yield": unit} if unit is not None else {}
    test_db.add(FinancialRatio(
        id=902, symbol="FPT", period="2025", period_type="year", fiscal_year=2025,
        source="vnstock", pe_ratio=14.64,
        raw_data={"dividend_yield": value, "ratio_units": units,
                  "provider_evidence": [{"dividendYield": value}]},
    ))
    await test_db.commit()
    monkeypatch.setattr(equity, "_load_mongo_financial_ratio_rows", AsyncMock(return_value=[]))
    monkeypatch.setattr(equity, "_get_latest_statement_period_key", AsyncMock(return_value=0))

    response = await equity.get_financial_ratios.__wrapped__(symbol="FPT", period="year", db=test_db)

    assert response.data[0].dividend_yield == expected
    assert response.data[0].pe == 14.64
    assert {"dividendYield": value} in response.data[0].provider_evidence


@pytest.mark.asyncio
async def test_ratio_endpoint_withholds_unverified_statement_and_current_valuation_fallbacks(monkeypatch, test_db):
    from vnibb.api.v1 import equity
    from vnibb.models.trading import FinancialRatio

    test_db.add_all([
        Stock(id=903, symbol="FPT", exchange="HOSE"),
        Company(id=903, symbol="FPT", outstanding_shares=20),
        FinancialRatio(id=903, symbol="FPT", period="2020", period_type="year", fiscal_year=2020,
                       source="vnstock", pe_ratio=0.03),
        IncomeStatement(id=903, symbol="FPT", period="2020", period_type="year", fiscal_year=2020,
                        revenue=100, net_income=10, ebitda=20, source="vnstock"),
        ScreenerSnapshot(id=903, symbol="FPT", snapshot_date=date(2026, 10, 17),
                         price=100, market_cap=1000),
    ])
    await test_db.commit()
    monkeypatch.setattr(equity, "_load_mongo_financial_ratio_rows", AsyncMock(return_value=[]))
    monkeypatch.setattr(equity, "_get_latest_statement_period_key", AsyncMock(return_value=0))

    response = await equity.get_financial_ratios.__wrapped__(symbol="FPT", period="year", db=test_db)

    row = response.data[0]
    assert row.pe == 0.03
    assert (row.ps, row.ev_sales, row.eps, row.net_margin) == (None, None, None, None)
    assert any(item.get("unavailable_reason") == "unverified_statement_basis" for item in row.provider_evidence)


def test_ratio_merge_retains_fallback_cell_evidence():
    from vnibb.api.v1.equity import _merge_ratio_rows

    fallback = FinancialRatioData(symbol="VNM", period="2024", roe=0.25, roa=0.5, ratio_units={"roe": "percent", "roa": "percent"}, provider_evidence=[{"roe_percent": 0.25}])
    preferred = FinancialRatioData(symbol="VNM", period="2024", roe=None, ratio_units={"roe": "unknown"}, provider_evidence=[{"roe": 99}])
    merged = _merge_ratio_rows(preferred, fallback)
    assert merged.roe is None
    assert merged.roa == 0.5
    assert merged.ratio_units == {"roe": "unknown", "roa": "percent"}
    assert merged.provider_evidence == [{"roe_percent": 0.25}, {"roe": 99}]

@pytest.mark.parametrize("raw,expected", [
    ({"yearReport": 2025, "pe": 14.64}, 0.25),
    ({"yearReport": 2025, "pe": 14.64, "dividendYield": 47.02}, None),
])
def test_ratio_merge_distinguishes_omitted_yield_from_unit_rejection(raw, expected):
    from vnibb.api.v1.equity import _merge_ratio_rows
    from vnibb.providers.vnstock.financial_ratios import FinancialRatiosQueryParams, VnstockFinancialRatiosFetcher

    preferred = VnstockFinancialRatiosFetcher.transform_data(FinancialRatiosQueryParams(symbol="FPT"), [raw])[0]
    fallback = FinancialRatioData(symbol="FPT", period="2025", dividend_yield=0.25,
                                 ratio_units={"dividend_yield": "percent"})
    assert _merge_ratio_rows(preferred, fallback).dividend_yield == expected


class FakeMongoMarketDataService:
    enabled = True

    def __init__(self, rows):
        self.rows = rows
        self.requests = []

    async def get_raw_dataset_records_precise(self, symbol, *, dataset, variant=None, limit):
        self.requests.append({"symbol": symbol, "dataset": dataset, "variant": variant, "limit": limit})
        return self.rows

    async def get_eod_prices(self, symbol, *, lookback_days, limit):
        self.requests.append({"symbol": symbol, "dataset": "market_prices_eod", "lookback_days": lookback_days, "limit": limit})
        return self.rows


@pytest.mark.asyncio
@pytest.mark.parametrize("snapshot_inputs,valuation_available", [
    ({}, False),
    ({"unitQuality": "unknown", "comparisonUnavailableReason": "Price currency/scale is unknown; margin of safety cannot be compared in VND."}, False),
    ({"unitQuality": "verified", "unitLineage": {"price": {"unit": "unknown"}}}, False),
    ({"unitQuality": "verified", "unitLineage": {"price": {"unit": "VND"}}, "comparisonUnavailableReason": "Statement currency/scale is unknown."}, False),
    ({"unitQuality": "verified", "unitLineage": {"price": {"unit": "VND"}}}, True),
])
async def test_fundamental_analysis_composes_sections_and_degrades(monkeypatch, snapshot_inputs, valuation_available):
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
            "price": 90000,
            "inputs": snapshot_inputs,
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
    if valuation_available:
        assert response.data["valuation"]["intrinsic_value"] == 120000
        assert response.data["valuation"]["valuation_method"] == "dcf"
    else:
        assert response.data["valuation"] is None
        assert response.data["section_errors"].pop("valuation")
    assert response.data["fundamental_snapshot"]["intrinsicValue"] == 120000
    assert response.data["fundamental_snapshot"]["inputs"] == snapshot_inputs
    assert response.data["latest_fundamental_snapshot"]["derived"] == (
        response.data["fundamental_snapshot"] if valuation_available else None
    )
    assert response.data["competitive_advantage"]["moat"] == "wide"
    assert "ROE 22.5%" in response.data["competitive_advantage"]["reasons"]
    assert response.data["subsidiaries"] == []
    assert response.data["section_errors"] == {
        "subsidiaries": "subsidiaries unavailable",
        "events": "events unavailable",
    }
    assert response.error == "Partial data unavailable"


def test_statement_enrichment_does_not_guess_scale_from_other_periods():
    rows = [
        FinancialStatementData(symbol="FPT", period="Q1-2025", statement_type="balance", total_assets=73_997_673_121_789, cash=5_342_746_710_936),
        FinancialStatementData(symbol="FPT", period="Q2-2025", statement_type="balance", total_assets=81_266_075_455_371, cash=7_755_450_852_909),
        FinancialStatementData(symbol="FPT", period="Q3-2025", statement_type="balance", total_assets=81_601_597_008_000_000, cash=7_755_450_853_000_000),
    ]

    normalized = _enrich_financial_statement_rows(rows)

    assert normalized[2].total_assets == 81_601_597_008_000_000
    assert normalized[2].cash == 7_755_450_853_000_000

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
    monkeypatch.setattr("vnibb.services.vietcap_financials.load_vietcap_financial_rows", AsyncMock(return_value=[]))
    fake_service = FakeMongoMarketDataService(
        [
            {
                "providerSource": "VCI",
                "raw": {
                    "yearReport": 2024,
                    "_value_unit": "VND",
                    "revenue": 1200.0,
                    "netIncome": 180.0,
                }
            },
            {
                "providerSource": "VCI",
                "raw": {
                    "yearReport": 2023,
                    "_value_unit": "VND",
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
    monkeypatch.setattr("vnibb.services.vietcap_financials.load_vietcap_financial_rows", AsyncMock(return_value=[]))
    fake_service = FakeMongoMarketDataService(
        [
            {"providerSource": "VCI", "raw": {"yearReport": 2024, "quarter": 1, "priceToEarning": 9.2, "priceToBook": 1.4}},
            {"providerSource": "VCI", "raw": {"yearReport": 2024, "quarter": 2, "priceToEarning": 9.6, "priceToBook": 1.5}},
            {"providerSource": "VCI", "raw": {"yearReport": 2023, "quarter": 1, "priceToEarning": 8.5, "priceToBook": 1.2}},
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
            {"high": 10.0, "low": 8.0, "priceUnit": "THOUSAND_VND"},
            {"high": 15.0, "low": 7.5, "priceUnit": "THOUSAND_VND"},
            {"high": 12.0, "low": 9.0, "priceUnit": "THOUSAND_VND"},
        ]
    )
    monkeypatch.setattr("vnibb.api.v1.equity.get_mongo_market_data_service", lambda: fake_service)

    high, low = await _compute_rolling_high_low(None, "VCI", trading_days=252)  # type: ignore[arg-type]

    assert high == pytest.approx(15_000.0)
    assert low == pytest.approx(7_500.0)
    assert fake_service.requests[0]["dataset"] == "market_prices_eod"


@pytest.mark.asyncio
@pytest.mark.parametrize("cost_of_revenue,gross_profit,expected_margin", [
    (-60.0, None, None),
    (60.0, None, None),
    (-60.0, 40.0, 40.0),
    (-60.0, 0.0, 0.0),
])
async def test_enrich_missing_ratio_metrics_requires_reported_gross_profit(
    test_db, cost_of_revenue, gross_profit, expected_margin,
):
    statement = FinancialStatementData(
        symbol="VNM", period="2024", fiscal_year=2024, statement_type="income", source="fixture",
        value_unit="VND", consolidation_basis="Consolidated", flow_basis="annual",
        revenue=100.0, cost_of_revenue=cost_of_revenue, gross_profit=gross_profit,
        operating_income=20.0,
    )
    test_db.add(IncomeStatement(
        id=900, symbol="VNM", period="2024", period_type="year", fiscal_year=2024,
        revenue=100.0, cost_of_revenue=cost_of_revenue, gross_profit=gross_profit,
        operating_income=20.0,
        raw_data={"_financial_lineage": {
            "value_unit": "VND", "canonical_data": statement.model_dump(mode="json"),
        }},
    ))
    await test_db.commit()

    enriched = await _enrich_missing_ratio_metrics(
        "VNM", "year", [FinancialRatioData(symbol="VNM", period="2024")], test_db,
    )
    item = enriched[0]

    assert item.operating_margin == pytest.approx(20.0)
    if expected_margin is None:
        assert item.gross_margin is None
        assert "gross_margin" not in item.ratio_units
    else:
        assert item.gross_margin == pytest.approx(expected_margin)
        assert item.ratio_units["gross_margin"] == "percent"


@pytest.mark.asyncio
async def test_enrich_missing_ratio_metrics_computes_certified_statement_metrics_without_current_valuation(test_db):
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
                raw_data={"_financial_lineage": {"value_unit": "VND", "canonical_data": FinancialStatementData(
                    symbol="VNM", period="2024", statement_type="income", source="fixture",
                    value_unit="VND", consolidation_basis="Consolidated", flow_basis="annual",
                    revenue=1200.0, operating_income=180.0, net_income=150.0,
                    cost_of_revenue=700.0, interest_expense=20.0, eps=5.0,
                    unit_metadata={"interest_expense": {"label": "interest_expense", "source_unit": "VND", "value_unit": "VND"}},
                ).model_dump(mode="json")}},
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
                raw_data={"_financial_lineage": {"value_unit": "VND", "canonical_data": FinancialStatementData(
                    symbol="VNM", period="2023", statement_type="income", source="fixture",
                    value_unit="VND", consolidation_basis="Consolidated", flow_basis="annual",
                    revenue=1000.0, net_income=120.0, eps=4.2,
                ).model_dump(mode="json")}},
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
                raw_data={"_financial_lineage": {"value_unit": "VND", "canonical_data": FinancialStatementData(
                    symbol="VNM", period="2024", statement_type="balance", source="fixture",
                    value_unit="VND", consolidation_basis="Consolidated", flow_basis="instantaneous",
                    total_assets=2000.0, total_liabilities=800.0, total_equity=1200.0,
                    cash_and_equivalents=100.0, inventory=200.0, accounts_receivable=240.0,
                    short_term_debt=50.0, long_term_debt=200.0,
                ).model_dump(mode="json")}},
            ),
            BalanceSheet(
                id=2,
                symbol="VNM",
                period="2023",
                period_type="year",
                fiscal_year=2023,
                inventory=180.0,
                accounts_receivable=220.0,
                raw_data={"_financial_lineage": {"value_unit": "VND", "canonical_data": FinancialStatementData(
                    symbol="VNM", period="2023", statement_type="balance", source="fixture",
                    value_unit="VND", consolidation_basis="Consolidated", flow_basis="instantaneous",
                    inventory=180.0, accounts_receivable=220.0,
                ).model_dump(mode="json")}},
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
                raw_data={"_financial_lineage": {"value_unit": "VND", "canonical_data": FinancialStatementData(
                    symbol="VNM", period="2024", statement_type="cashflow", source="fixture",
                    value_unit="VND", consolidation_basis="Consolidated", flow_basis="annual",
                    operating_cash_flow=210.0, free_cash_flow=130.0, capital_expenditure=-80.0,
                    dividends_paid=-40.0, debt_repayment=-30.0,
                ).model_dump(mode="json")}},
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
    assert item.debt_assets == pytest.approx(40.0)
    assert item.ratio_units["debt_assets"] == "percent"
    assert item.equity_multiplier == pytest.approx(2000.0 / 1200.0)
    assert item.roic == pytest.approx((150.0 / 1400.0) * 100)
    assert item.revenue_growth == pytest.approx(20.0)
    assert item.earnings_growth == pytest.approx(25.0)
    assert item.debt_service_coverage == pytest.approx(3.6)
    assert item.ocf_debt == pytest.approx(0.2625)
    assert item.ocf_sales == pytest.approx(0.175)
    assert item.pe == 10.0
    assert item.pb is None
    assert item.eps is None
    assert item.bvps is None
    assert item.ps is None
    assert item.ev_sales is None
    assert item.fcf_yield is None
    assert item.dps is None
    assert item.dividend_yield is None
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
                raw_data={"_financial_lineage": {"value_unit": "VND", "canonical_data": FinancialStatementData(
                    symbol="TCB", period="2024", statement_type="income", source="fixture",
                    value_unit="VND", consolidation_basis="Consolidated", flow_basis="annual",
                    revenue=200.0, operating_income=120.0, net_income=100.0, interest_expense=15.0,
                ).model_dump(mode="json")}},
            ),
            IncomeStatement(
                id=11,
                symbol="TCB",
                period="2023",
                period_type="year",
                fiscal_year=2023,
                revenue=150.0,
                net_income=80.0,
                raw_data={"_financial_lineage": {"value_unit": "VND", "canonical_data": FinancialStatementData(
                    symbol="TCB", period="2023", statement_type="income", source="fixture",
                    value_unit="VND", consolidation_basis="Consolidated", flow_basis="annual",
                    revenue=150.0, net_income=80.0,
                ).model_dump(mode="json")}},
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
                raw_data={"_financial_lineage": {"value_unit": "VND", "canonical_data": FinancialStatementData(
                    symbol="TCB", period="2024", statement_type="balance", source="fixture",
                    value_unit="VND", consolidation_basis="Consolidated", flow_basis="instantaneous",
                    total_assets=1000.0, total_liabilities=850.0, total_equity=150.0,
                    cash_and_equivalents=100.0,
                ).model_dump(mode="json")}},
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
                raw_data={"_financial_lineage": {"value_unit": "VND", "canonical_data": FinancialStatementData(
                    symbol="TCB", period="2024", statement_type="cashflow", source="fixture",
                    value_unit="VND", consolidation_basis="Consolidated", flow_basis="annual",
                    operating_cash_flow=90.0, free_cash_flow=80.0, capital_expenditure=-10.0,
                    dividends_paid=-5.0,
                ).model_dump(mode="json")}},
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
    assert item.pe == 8.0
    assert item.pb == 1.2
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
                raw_data={"_financial_lineage": {"value_unit": "VND", "canonical_data": {
                    **FinancialStatementData(
                        symbol="VCB", period="2024", statement_type="income", source="fixture",
                        value_unit="VND", consolidation_basis="Consolidated", flow_basis="annual",
                        revenue=120.0, net_income=30.0,
                    ).model_dump(mode="json"),
                    "net_interest_income": 80.0, "provision_for_credit_losses": -10.0,
                }}},
            ),
            IncomeStatement(
                id=21,
                symbol="VCB",
                period="2023",
                period_type="year",
                fiscal_year=2023,
                revenue=100.0,
                net_income=25.0,
                raw_data={"_financial_lineage": {"value_unit": "VND", "canonical_data": {
                    **FinancialStatementData(
                        symbol="VCB", period="2023", statement_type="income", source="fixture",
                        value_unit="VND", consolidation_basis="Consolidated", flow_basis="annual",
                        revenue=100.0, net_income=25.0,
                    ).model_dump(mode="json"),
                    "net_interest_income": 70.0, "provision_for_credit_losses": -8.0,
                }}},
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
                raw_data={"_financial_lineage": {"value_unit": "VND", "canonical_data": {
                    **FinancialStatementData(
                        symbol="VCB", period="2024", statement_type="balance", source="fixture",
                        value_unit="VND", consolidation_basis="Consolidated", flow_basis="instantaneous",
                        total_assets=1000.0, total_liabilities=850.0, total_equity=150.0,
                        accounts_receivable=700.0, customer_deposits=500.0,
                    ).model_dump(mode="json"),
                    "current_account_deposits": 150.0, "placements_with_banks": 100.0,
                    "investment_securities_total": 200.0, "loan_loss_reserve": -50.0,
                }}},
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
                raw_data={"_financial_lineage": {"value_unit": "VND", "canonical_data": {
                    **FinancialStatementData(
                        symbol="VCB", period="2023", statement_type="balance", source="fixture",
                        value_unit="VND", consolidation_basis="Consolidated", flow_basis="instantaneous",
                        total_assets=900.0, total_liabilities=770.0, total_equity=130.0,
                        accounts_receivable=630.0, customer_deposits=400.0,
                    ).model_dump(mode="json"),
                    "current_account_deposits": 120.0, "placements_with_banks": 80.0,
                    "investment_securities_total": 150.0, "loan_loss_reserve": -45.0,
                }}},
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
    assert item.pe == 10.0
    assert item.pb == 1.8


@pytest.mark.asyncio
async def test_enrich_missing_ratio_metrics_backfills_certified_statement_periods(test_db):
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
                raw_data={"_financial_lineage": {"value_unit": "VND", "canonical_data": FinancialStatementData(
                    symbol="VNM", period="2022", statement_type="income", source="fixture",
                    value_unit="VND", consolidation_basis="Consolidated", flow_basis="annual",
                    revenue=120.0, net_income=24.0,
                ).model_dump(mode="json")}},
            ),
            IncomeStatement(
                id=31,
                symbol="VNM",
                period="2021",
                period_type="year",
                fiscal_year=2021,
                revenue=100.0,
                net_income=20.0,
                raw_data={"_financial_lineage": {"value_unit": "VND", "canonical_data": FinancialStatementData(
                    symbol="VNM", period="2021", statement_type="income", source="fixture",
                    value_unit="VND", consolidation_basis="Consolidated", flow_basis="annual",
                    revenue=100.0, net_income=20.0,
                ).model_dump(mode="json")}},
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
                raw_data={"_financial_lineage": {"value_unit": "VND", "canonical_data": FinancialStatementData(
                    symbol="VNM", period="2022", statement_type="balance", source="fixture",
                    value_unit="VND", consolidation_basis="Consolidated", flow_basis="instantaneous",
                    total_assets=200.0, total_liabilities=80.0, total_equity=120.0,
                ).model_dump(mode="json")}},
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
                raw_data={"_financial_lineage": {"value_unit": "VND", "canonical_data": FinancialStatementData(
                    symbol="VNM", period="2021", statement_type="balance", source="fixture",
                    value_unit="VND", consolidation_basis="Consolidated", flow_basis="instantaneous",
                    total_assets=180.0, total_liabilities=70.0, total_equity=110.0,
                ).model_dump(mode="json")}},
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
@pytest.mark.parametrize("provider_pe,provider_pb", [(None, None), (12.0, 3.0)])
async def test_enrich_missing_ratio_metrics_requires_reported_valuation_with_unknown_price_basis(test_db, provider_pe, provider_pb):
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
                source="KBS",
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
                source="KBS",
            ),
        ]
    )
    await test_db.commit()

    rows = [FinancialRatioData(
        symbol="VNM", period="2022", eps=5_000.0, bvps=20_000.0,
        pe=provider_pe, pb=provider_pb,
    )]
    enriched = await _enrich_missing_ratio_metrics("VNM", "year", rows, test_db)
    item = enriched[0]

    assert item.eps == 5_000.0
    assert item.bvps == 20_000.0
    assert item.pe == provider_pe
    assert item.pb == provider_pb
