import asyncio
from datetime import datetime

import pytest

from vnibb.api.v1.equity import _growth_detail, _growth_rate, _merge_financial_statement_rows, _build_ttm_financial_statement_rows, _enrich_financial_statement_rows
from vnibb.providers.vnstock.financials import FinancialStatementData, StatementType
from vnibb.services.financial_service import (
    _build_ytd_snapshot,
    calculate_ttm,
    get_financials_with_ttm,
    normalize_statement_period,
)


@pytest.mark.asyncio
async def test_get_financials_with_ttm_caps_quarter_fetch_limit(monkeypatch):
    captured: list[int] = []

    async def fake_fetch(params, credentials=None):
        captured.append(params.limit)
        return [
            FinancialStatementData(
                symbol="VNM",
                period="2025",
                statement_type=StatementType.BALANCE.value,
                total_assets=100.0,
                updated_at=datetime.utcnow(),
            )
        ]

    async def fake_inject(symbol, statement_type, annual_rows, limit):
        return annual_rows

    monkeypatch.setattr(
        "vnibb.services.financial_service.VnstockFinancialsFetcher.fetch",
        fake_fetch,
    )
    monkeypatch.setattr(
        "vnibb.services.financial_service._inject_latest_ytd_row",
        fake_inject,
    )

    data = await get_financials_with_ttm(
        symbol="VNM",
        statement_type=StatementType.BALANCE.value,
        period="year",
        limit=5,
    )

    assert captured == [5]
    assert len(data) == 1
    assert data[0].period == "2025"


@pytest.mark.parametrize("statement_type", ["income", "cashflow"])
def test_ytd_preserves_absent_metrics_and_actual_zero(statement_type):
    quarters = [
        FinancialStatementData(
            symbol="VCI", period="Q2-2026", statement_type=statement_type,
            value_unit="VND", consolidation_basis="Consolidated", flow_basis="single_quarter",
            revenue=120.0 if statement_type == "income" else None,
            operating_cash_flow=0.0 if statement_type == "cashflow" else None,
        ),
        FinancialStatementData(
            symbol="VCI", period="Q1-2026", statement_type=statement_type,
            value_unit="VND", consolidation_basis="Consolidated", flow_basis="single_quarter",
            revenue=80.0 if statement_type == "income" else None,
            operating_cash_flow=0.0 if statement_type == "cashflow" else None,
        ),
    ]

    ytd = _build_ytd_snapshot("VCI", statement_type, 2026, quarters)

    assert ytd is not None
    assert ytd.ebitda is None
    assert ytd.pre_tax_profit is None
    if statement_type == "income":
        assert ytd.revenue == 200.0
        assert ytd.operating_cash_flow is None
    else:
        assert ytd.operating_cash_flow == 0.0
        assert ytd.revenue is None
        assert ytd.net_cash_flow is None

    quarters[1].operating_cash_flow = None
    incomplete = _build_ytd_snapshot("VCI", statement_type, 2026, quarters)
    assert incomplete is not None
    assert incomplete.operating_cash_flow is None


@pytest.mark.parametrize("statement_type", ["income", "cashflow"])
@pytest.mark.asyncio
async def test_ttm_preserves_absent_metrics_and_real_zero(monkeypatch, statement_type):
    async def fake_fetch(params):
        return [
            FinancialStatementData(
                symbol="VCI", period=f"Q{quarter}-2026", statement_type=statement_type,
                value_unit="VND", consolidation_basis="Consolidated", flow_basis="single_quarter",
                revenue=10.0 if statement_type == "income" else None,
                operating_cash_flow=0.0 if statement_type == "cashflow" else None,
            )
            for quarter in range(4, 0, -1)
        ]

    monkeypatch.setattr(
        "vnibb.services.financial_service.VnstockFinancialsFetcher.fetch", fake_fetch
    )
    data = await calculate_ttm("VCI", statement_type)
    assert len(data) == 1
    assert data[0].ebitda is None
    if statement_type == "income":
        assert data[0].revenue == 40.0
        assert data[0].operating_cash_flow is None
    else:
        assert data[0].operating_cash_flow == 0.0
        assert data[0].revenue is None


def test_merge_financial_statement_rows_handles_provider_rows_without_fiscal_metadata():
    primary = [
        FinancialStatementData(
            symbol="VNM",
            period="2025",
            statement_type=StatementType.BALANCE.value,
            accounts_payable=100.0,
        )
    ]
    fallback = [
        FinancialStatementData(
            symbol="VNM",
            period="2025",
            statement_type=StatementType.BALANCE.value,
            goodwill=50.0,
        )
    ]

    merged = _merge_financial_statement_rows(primary, fallback)

    assert len(merged) == 1
    assert merged[0].accounts_payable == 100.0
    assert merged[0].goodwill == 50.0


def test_merge_financial_statement_rows_dedupes_mixed_quarter_formats():
    primary = [
        FinancialStatementData(
            symbol="VNM",
            period="2025-Q2",
            statement_type=StatementType.INCOME.value,
            revenue=200.0,
        )
    ]
    fallback = [
        FinancialStatementData(
            symbol="VNM",
            period="Q2-2025",
            statement_type=StatementType.INCOME.value,
            gross_profit=90.0,
        )
    ]

    merged = _merge_financial_statement_rows(primary, fallback)

    assert len(merged) == 1
    assert merged[0].revenue == 200.0
    assert merged[0].gross_profit == 90.0


def test_merge_and_enrichment_do_not_restore_provider_rejected_metric():
    primary = [
        FinancialStatementData(
            symbol="VNM",
            period="2026-Q2",
            statement_type=StatementType.BALANCE.value,
            total_assets=55_677_822_007_000.0,
            total_liabilities=10_000.0,
            total_equity=None,
            unit_metadata={
                "total_assets": {"value_unit": "VND"},
                "total_equity": {"unavailable_reason": "conflicting_metric_rows"},
            },
        )
    ]
    fallback = [
        FinancialStatementData(
            symbol="VNM",
            period="2026-Q2",
            statement_type=StatementType.BALANCE.value,
            total_equity=20.0,
            unit_metadata={"total_equity": {"value_unit": "VND"}},
        )
    ]

    merged = _enrich_financial_statement_rows(_merge_financial_statement_rows(primary, fallback))

    assert merged[0].total_assets == 55_677_822_007_000.0
    assert merged[0].total_equity is None
    assert merged[0].equity is None
    assert (
        merged[0].unit_metadata["total_equity"]["unavailable_reason"]
        == "conflicting_metric_rows"
    )


def test_compatible_merge_still_fills_genuinely_missing_metric():
    primary = [
        FinancialStatementData(
            symbol="VNM",
            period="2026-Q2",
            statement_type=StatementType.BALANCE.value,
            total_assets=55_677_822_007_000.0,
        )
    ]
    fallback = [
        FinancialStatementData(
            symbol="VNM",
            period="2026-Q2",
            statement_type=StatementType.BALANCE.value,
            inventory=42.0,
        )
    ]

    merged = _merge_financial_statement_rows(primary, fallback)

    assert merged[0].total_assets == 55_677_822_007_000.0
    assert merged[0].inventory == 42.0


def test_normalize_statement_period_handles_mixed_formats():
    assert normalize_statement_period("2025-Q2") == "Q2-2025"
    assert normalize_statement_period("Q2/2025") == "Q2-2025"
    assert normalize_statement_period("2", fiscal_year=2025, period_type="quarter") == "Q2-2025"


def test_normalize_statement_period_prefers_quarter_metadata_over_bare_year():
    assert (
        normalize_statement_period(
            "2024",
            fiscal_year=2024,
            fiscal_quarter=1,
            period_type="quarter",
        )
        == "Q1-2024"
    )


@pytest.mark.asyncio
async def test_get_financials_with_ttm_filters_specific_quarter_after_normalization(monkeypatch):
    async def fake_fetch(params, credentials=None):
        return [
            FinancialStatementData(
                symbol="VNM",
                period="2023-Q2",
                statement_type=StatementType.INCOME.value,
                revenue=100.0,
                updated_at=datetime.utcnow(),
            ),
            FinancialStatementData(
                symbol="VNM",
                period="Q2-2024",
                statement_type=StatementType.INCOME.value,
                revenue=120.0,
                updated_at=datetime.utcnow(),
            ),
            FinancialStatementData(
                symbol="VNM",
                period="Q3-2024",
                statement_type=StatementType.INCOME.value,
                revenue=140.0,
                updated_at=datetime.utcnow(),
            ),
        ]

    monkeypatch.setattr(
        "vnibb.services.financial_service.VnstockFinancialsFetcher.fetch",
        fake_fetch,
    )

    data = await get_financials_with_ttm(
        symbol="VNM",
        statement_type=StatementType.INCOME.value,
        period="Q2",
        limit=5,
    )

    assert [row.period for row in data] == ["Q2-2024", "Q2-2023"]


@pytest.mark.parametrize("current,previous,expected,transition", [
    (11_292_963_000, -1_638_456_685_000, 100.68924391492229, "loss_to_profit"),
    (-20, 100, -120, "profit_to_loss"), (-50, -100, 50, None), (-150, -100, -50, None),
    (120, 100, 20, None), (0, -100, 100, None), (1, 0, None, None), (1, None, None, None),
])
def test_growth_absolute_prior_denominator(current, previous, expected, transition):
    result = _growth_rate(current, previous)
    assert result == pytest.approx(expected) if expected is not None else result is None
    detail = _growth_detail(current, previous)
    assert detail["transition"] == transition
    assert detail["negative_base"] == (previous is not None and previous < 0)


def test_ttm_latest_balance_snapshot_preserves_missing_inventory():
    rows = [FinancialStatementData(symbol="VNM", period=f"Q{quarter}-2026", statement_type="balance",
        value_unit="VND", consolidation_basis="Consolidated",
        total_assets=55_677_822_007_000 if quarter == 2 else 53_312_370_717_301,
        raw_data={"source_label": "TOTAL ASSETS (Bn. VND)"}) for quarter in (1, 2)]
    result = _build_ttm_financial_statement_rows(rows, statement_type="balance")[0]
    assert result.total_assets == 55_677_822_007_000
    assert result.inventory is None
    assert result.aggregation_basis == "latest_quarter_snapshot"
    assert result.source_periods == ["Q2-2026"]
    assert result.raw_data == rows[1].raw_data


def test_ttm_flows_require_every_quarter_and_do_not_sum_eps():
    rows = [FinancialStatementData(symbol="MSR", period=f"Q{quarter}-2025", statement_type="income",
        value_unit="VND", consolidation_basis="Consolidated", flow_basis="single_quarter",
        revenue=10, net_income=0 if quarter != 2 else None, eps=2) for quarter in (4, 3, 2, 1)]
    result = _build_ttm_financial_statement_rows(rows, statement_type="income")[0]
    assert result.revenue == 40
    assert result.net_income is None
    assert result.eps is None
    assert result.aggregation_basis == "four_quarter_flow_sum"
    assert len(result.raw_data["source_rows"]) == 4
    rows[2].period = "Q2-2024"
    assert _build_ttm_financial_statement_rows(rows, statement_type="income")[0].unavailable_reason == "missing_consecutive_quarters"


def test_ttm_withholds_conflicting_duplicate_quarter():
    rows = [FinancialStatementData(symbol="VNM", period="Q2-2026", statement_type="balance", total_assets=value)
            for value in (10, 20)]
    row = _build_ttm_financial_statement_rows(rows, statement_type="balance")[0]
    assert row.total_assets is None
    assert row.unavailable_reason == "conflicting_duplicate_period"


def test_ttm_cumulative_flows_are_differenced_not_summed():
    rows = [FinancialStatementData(symbol="VNM", period=period, statement_type="cashflow",
        value_unit="VND", consolidation_basis="Consolidated", flow_basis="cumulative_ytd",
        operating_cash_flow=value) for period, value in [
            ("Q2-2026", 30), ("Q1-2026", 10), ("Q4-2025", 100), ("Q3-2025", 70), ("Q2-2025", 40)]]
    row = _build_ttm_financial_statement_rows(rows, statement_type="cashflow")[0]
    assert row.operating_cash_flow == 90
    assert row.source_periods == ["Q2-2026", "Q1-2026", "Q4-2025", "Q3-2025"]


def test_ttm_unknown_quarter_flow_basis_is_explicitly_unavailable():
    rows = [FinancialStatementData(symbol="VNM", period="Q2-2026", statement_type="income", value_unit="VND",
                                  consolidation_basis="Consolidated", revenue=10)]
    row = _build_ttm_financial_statement_rows(rows, statement_type="income")[0]
    assert row.revenue is None
    assert row.unavailable_reason == "unknown_quarterly_flow_basis"


def test_financial_merge_keeps_unknown_provider_basis_unavailable():
    primary = FinancialStatementData(symbol="VNM", period="2025", statement_type="cashflow", source="VCI",
        unavailable_reason="unknown_source_unit", raw_data={"source_value": 100_000_000_000})
    fallback = FinancialStatementData(symbol="VNM", period="2025", statement_type="cashflow", source="KBS",
        value_unit="VND", consolidation_basis="Consolidated", operating_cash_flow=100)
    result = _merge_financial_statement_rows([primary], [fallback])[0]
    assert result.operating_cash_flow is None
    assert result.unavailable_reason == "unknown_source_unit"
    assert result.raw_data == primary.raw_data


@pytest.mark.parametrize("reason", ["missing_quarterly_source_data", "ttm_calculation_failed"])
def test_financial_merge_uses_certified_ttm_when_provider_has_no_source(reason):
    primary = FinancialStatementData(symbol="VNM", period="TTM", statement_type="income",
        unavailable_reason=reason)
    quarters = [FinancialStatementData(symbol="VNM", period=f"Q{quarter}-2025", statement_type="income",
        source="VCI", value_unit="VND", consolidation_basis="Consolidated", flow_basis="single_quarter",
        revenue=10) for quarter in (4, 3, 2, 1)]
    fallback = _build_ttm_financial_statement_rows(quarters, statement_type="income")[0]

    assert _merge_financial_statement_rows([primary], [])[0].unavailable_reason == reason
    result = _merge_financial_statement_rows([primary], [fallback])
    assert len(result) == 1

    assert result[0].revenue == 40
    assert result[0].unavailable_reason is None


@pytest.mark.parametrize("primary_update,fallback_update", [
    ({"source": "VCI"}, {}),
    ({"raw_data": {"source_rows": [{"revenue": 10}]}}, {}),
    ({"unavailable_reason": "unknown_source_unit"}, {}),
    ({}, {"symbol": "MSR"}),
    ({}, {"statement_type": "cashflow"}),
    ({}, {"value_unit": None}),
    ({}, {"consolidation_basis": None}),
])
def test_financial_merge_keeps_ttm_unavailable_for_rejected_or_unsafe_fallback(primary_update, fallback_update):
    primary = FinancialStatementData(symbol="VNM", period="TTM", statement_type="income",
        unavailable_reason="missing_quarterly_source_data").model_copy(update=primary_update)
    fallback = FinancialStatementData(symbol="VNM", period="TTM", statement_type="income",
        source="VCI", value_unit="VND", consolidation_basis="Consolidated", flow_basis="trailing_twelve_months",
        aggregation_basis="four_quarter_flow_sum", source_periods=[f"Q{quarter}-2025" for quarter in (4, 3, 2, 1)],
        revenue=40).model_copy(update=fallback_update)

    result = _merge_financial_statement_rows([primary], [fallback])
    assert result == [primary]
    assert result[0].revenue is None
    assert result[0].unavailable_reason == primary.unavailable_reason


@pytest.mark.asyncio
async def test_get_financials_with_ttm_keeps_requested_identity_when_provider_empty(monkeypatch):
    async def fake_fetch(params):
        return []

    monkeypatch.setattr(
        "vnibb.services.financial_service.VnstockFinancialsFetcher.fetch", fake_fetch
    )

    data = await get_financials_with_ttm(symbol="VNM", statement_type="income", period="TTM")

    assert len(data) == 1
    row = data[0]
    assert (row.symbol, row.period, row.statement_type) == ("VNM", "TTM", "income")
    assert row.unavailable_reason
    assert row.revenue is None
    assert row.source is None


@pytest.mark.asyncio
async def test_get_financials_with_ttm_keeps_reason_when_calculation_aborts(monkeypatch):
    async def fake_calculate_ttm(symbol, statement_type):
        raise ValueError("provider exploded")

    monkeypatch.setattr(
        "vnibb.services.financial_service.calculate_ttm", fake_calculate_ttm
    )

    data = await get_financials_with_ttm(symbol="VNM", statement_type="income", period="TTM")

    assert len(data) == 1
    assert data[0].unavailable_reason == "ttm_calculation_failed"
    assert data[0].net_income is None


@pytest.mark.asyncio
async def test_get_financials_with_ttm_propagates_cancellation(monkeypatch):
    async def fake_calculate_ttm(symbol, statement_type):
        raise asyncio.CancelledError()

    monkeypatch.setattr(
        "vnibb.services.financial_service.calculate_ttm", fake_calculate_ttm
    )

    with pytest.raises(asyncio.CancelledError):
        await get_financials_with_ttm(symbol="VNM", statement_type="income", period="TTM")
