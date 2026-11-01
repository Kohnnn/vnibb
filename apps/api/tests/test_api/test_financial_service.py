import asyncio
from datetime import datetime

import pytest

from vnibb.api.v1.equity import (
    _build_ttm_financial_statement_rows,
    _enrich_financial_statement_rows,
    _growth_detail,
    _growth_rate,
    _merge_financial_statement_rows,
)
from vnibb.providers.vnstock.financials import FinancialStatementData, StatementType
from vnibb.services.financial_service import (
    _build_ytd_snapshot,
    admit_statement_rows,
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
                source="VCI", currency="VND", value_unit="VND",
                consolidation_basis="consolidated",
                unit_metadata={"total_assets": {"source_unit": "VND", "value_unit": "VND"}},
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
            source="VCI", currency="VND", value_unit="VND",
            consolidation_basis="consolidated", flow_basis="single_quarter",
            unit_metadata={
                "revenue" if statement_type == "income" else "operating_cash_flow": {
                    "source_unit": "VND", "value_unit": "VND"}},
            revenue=120.0 if statement_type == "income" else None,
            operating_cash_flow=0.0 if statement_type == "cashflow" else None,
        ),
        FinancialStatementData(
            symbol="VCI", period="Q1-2026", statement_type=statement_type,
            source="VCI", currency="VND", value_unit="VND",
            consolidation_basis="consolidated", flow_basis="single_quarter",
            unit_metadata={
                "revenue" if statement_type == "income" else "operating_cash_flow": {
                    "source_unit": "VND", "value_unit": "VND"}},
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
                source="VCI", currency="VND", value_unit="VND",
                consolidation_basis="consolidated", flow_basis="single_quarter",
                unit_metadata={
                    "revenue" if statement_type == "income" else "operating_cash_flow": {
                        "source_unit": "VND", "value_unit": "VND"}},
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



def test_merge_cannot_keep_interest_rejected_by_other_observation():
    primary = FinancialStatementData(symbol="FPT", period="2025", statement_type="income",
        interest_expense=900, revenue=1000, source="VCI", value_unit="VND",
        unit_metadata={"interest_expense": {"label": "financial_expenses", "source_unit": "VND", "value_unit": "VND"}})
    fallback = primary.model_copy(deep=True)
    fallback.interest_expense = None
    fallback.unit_metadata["interest_expense"]["unavailable_reason"] = "interest_semantics_unverified"
    for first, second in ((primary, fallback), (fallback, primary)):
        row = _merge_financial_statement_rows([first], [second])[0]
        assert row.interest_expense is None
        assert row.revenue == 1000
        assert row.unit_metadata["interest_expense"]["unavailable_reason"] == "interest_semantics_unverified"


@pytest.mark.parametrize("fallback_scope,fallback_unit,expected", [
    ("separate", "VND", 100), ("consolidated", None, 100), ("consolidated", "VND", None),
])
def test_merge_rejection_only_applies_to_compatible_statement_basis(fallback_scope, fallback_unit, expected):
    primary = FinancialStatementData(symbol="FPT", period="2025", statement_type="income",
        source="VCI", value_unit="VND", consolidation_basis="consolidated", revenue=100,
        unit_metadata={"revenue": {"value_unit": "VND"}})
    fallback = primary.model_copy(deep=True, update={"consolidation_basis": fallback_scope,
        "value_unit": fallback_unit, "revenue": None})
    fallback.unit_metadata["revenue"]["unavailable_reason"] = "conflicting_metric_rows"
    result = _merge_financial_statement_rows([primary], [fallback])[0]
    assert result.revenue == expected
    assert primary.revenue == 100


@pytest.mark.parametrize("interest", [0, 12])
def test_derived_ytd_interest_keeps_original_component_evidence_at_final_admission(interest):
    quarters = [FinancialStatementData(symbol="FPT", period=f"Q{quarter}-2026", statement_type="income",
        source="VCI", currency="VND", value_unit="VND",
        consolidation_basis="consolidated", flow_basis="single_quarter",
        revenue=100, interest_expense=interest, unit_metadata={
            "revenue": {"source_unit": "VND", "value_unit": "VND"},
            "interest_expense": {"label": "interest_expense", "source_unit": "VND", "value_unit": "VND"}})
        for quarter in (2, 1)]
    ytd = _build_ytd_snapshot("FPT", "income", 2026, quarters)
    result = admit_statement_rows([ytd], "FY")[0]
    assert (result.revenue, result.interest_expense) == (200, 2 * interest)
    assert result.unit_metadata["interest_expense"]["components"] == [
        row.unit_metadata["interest_expense"] for row in quarters]
    assert result.raw_data["source_rows"][0]["period"] == "Q2-2026"


@pytest.mark.asyncio
@pytest.mark.parametrize("evidence,expected", [("certified", 0), ("unknown_flow", None), ("fiscal_conflict", None)])
async def test_financial_endpoint_preserves_canonical_ytd_after_repeated_admission(monkeypatch, evidence, expected):
    from unittest.mock import AsyncMock

    from vnibb.api.v1 import equity

    quarters = [FinancialStatementData(
        symbol="FPT", period=f"Q{quarter}-2026", statement_type="income",
        source="vietcap", currency="VND", value_unit="VND", consolidation_basis="consolidated",
        flow_basis="single_quarter", interest_expense=0,
        unit_metadata={"interest_expense": {"label": "interest_expense", "source_unit": "VND", "value_unit": "VND"}},
    ) for quarter in (2, 1)]
    ytd = _build_ytd_snapshot("FPT", "income", 2026, quarters)
    if evidence == "unknown_flow":
        ytd.flow_basis = None
    elif evidence == "fiscal_conflict":
        ytd.fiscal_year = 2025
    monkeypatch.setattr(equity, "_get_model_last_updated", AsyncMock(return_value=None))
    monkeypatch.setattr(equity, "_load_mongo_financial_statement_rows", AsyncMock(return_value=[ytd]))
    response = await equity.get_financials.__wrapped__("FPT", "income", "FY", 20, db=None)

    assert response.data[0].period == ("2026 (YTD)" if evidence == "fiscal_conflict" else "2026 YTD")
    assert response.data[0].interest_expense == expected
    repeated = admit_statement_rows(response.data, "FY")[0]
    assert repeated.interest_expense == expected
    assert repeated.raw_data == ytd.raw_data

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


def test_admission_uses_explicit_quarter_and_preserves_fy_separately():
    row = FinancialStatementData(symbol="FPT", period="2025", statement_type="income",
        fiscal_year=2025, fiscal_quarter=1, revenue=100,
        source="VCI", currency="VND", value_unit="VND",
        consolidation_basis="consolidated", flow_basis="single_quarter",
        unit_metadata={"revenue": {"source_unit": "VND", "value_unit": "VND"}})
    quarterly = admit_statement_rows([row], "quarter")[0]
    annual = admit_statement_rows([row.model_copy(update={"fiscal_quarter": None, "flow_basis": "annual"})], "FY")[0]
    assert (quarterly.period, quarterly.revenue, quarterly.unavailable_reason) == ("Q1-2025", 100, None)
    assert (annual.period, annual.revenue, annual.unavailable_reason) == ("2025", 100, None)


@pytest.mark.parametrize("value", [0, 42])
def test_interest_admission_preserves_certified_true_label_including_zero(value):
    row = FinancialStatementData(symbol="FPT", period="2025", statement_type="income",
        source="VCI", currency="VND", value_unit="VND",
        consolidation_basis="consolidated", flow_basis="annual",
        interest_expense=value, unit_metadata={"interest_expense": {
            "label": "interest_expense", "source_unit": "VND", "value_unit": "VND"}})
    assert admit_statement_rows([row], "FY")[0].interest_expense == value


@pytest.mark.parametrize("value", [0, -42, 100])
def test_issuer_statement_is_withheld_even_with_generic_unit_evidence(value):
    raw = {"issuer_evidence": {"document_hash": "abc", "page": 12, "currency": "VND", "value_unit": "VND"}}
    row = FinancialStatementData(symbol="FPT", period="2025", fiscal_year=2025,
        statement_type="income", source="issuer_report", currency="VND", value_unit="VND",
        consolidation_basis="consolidated", flow_basis="annual", revenue=value, raw_data=raw,
        unit_metadata={"revenue": {"source_unit": "VND", "value_unit": "VND"}})
    admitted = admit_statement_rows([row], "year")[0]
    assert admitted.revenue is None
    assert admitted.unavailable_reason == "issuer_field_evidence_not_admitted"
    assert admitted.raw_data == raw
    assert row.revenue == value

def test_statement_rejection_overrides_certified_fields_without_rewriting_evidence():
    raw = {"original_revenue": 100, "source_record": "FPT:2025"}
    row = FinancialStatementData(symbol="FPT", period="2025", fiscal_year=2025,
        statement_type="income", source="VCI", currency="VND", value_unit="VND",
        consolidation_basis="consolidated", flow_basis="annual", revenue=100,
        unavailable_reason="conflicting_statement_source", raw_data=raw,
        unit_metadata={"revenue": {"source_unit": "VND", "value_unit": "VND"}})
    admitted = admit_statement_rows([row], "year")[0]
    assert admitted.revenue is None
    assert admitted.unavailable_reason == "conflicting_statement_source"
    assert (admitted.currency, admitted.value_unit, admitted.fiscal_year) == ("VND", "VND", 2025)
    assert admitted.raw_data == raw
    assert row.revenue == 100



@pytest.mark.parametrize("raw", [{"yearReport": 2024, "lengthReport": 2}, {"yearReport": 2025, "lengthReport": 5}])
def test_quarter_admission_rejects_disagreeing_original_fiscal_evidence(raw):
    row = FinancialStatementData(symbol="FPT", period="Q1-2025", statement_type="income",
        fiscal_year=2025, fiscal_quarter=1, revenue=100, raw_data=raw,
        source="VCI", currency="VND", value_unit="VND",
        consolidation_basis="consolidated", flow_basis="single_quarter",
        unit_metadata={"revenue": {"source_unit": "VND", "value_unit": "VND"}})
    result = admit_statement_rows([row], "quarter")[0]
    assert result.revenue is None
    assert result.unavailable_reason == "conflicting_fiscal_identity"
    assert result.raw_data == raw

@pytest.mark.asyncio
async def test_get_financials_with_ttm_filters_specific_quarter_after_normalization(monkeypatch):
    async def fake_fetch(params, credentials=None):
        return [
            FinancialStatementData(
                symbol="VNM",
                period="2023-Q2",
                statement_type=StatementType.INCOME.value,
                source="VCI", currency="VND", value_unit="VND",
                consolidation_basis="consolidated", flow_basis="single_quarter",
                unit_metadata={"revenue": {"source_unit": "VND", "value_unit": "VND"}},
                revenue=100.0,
                updated_at=datetime.utcnow(),
            ),
            FinancialStatementData(
                symbol="VNM",
                period="Q2-2024",
                statement_type=StatementType.INCOME.value,
                source="VCI", currency="VND", value_unit="VND",
                consolidation_basis="consolidated", flow_basis="single_quarter",
                unit_metadata={"revenue": {"source_unit": "VND", "value_unit": "VND"}},
                revenue=120.0,
                updated_at=datetime.utcnow(),
            ),
            FinancialStatementData(
                symbol="VNM",
                period="Q3-2024",
                statement_type=StatementType.INCOME.value,
                source="VCI", currency="VND", value_unit="VND",
                consolidation_basis="consolidated", flow_basis="single_quarter",
                unit_metadata={"revenue": {"source_unit": "VND", "value_unit": "VND"}},
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
        source="VCI", currency="VND", value_unit="VND", consolidation_basis="consolidated",
        unit_metadata={"total_assets": {"source_unit": "Bn. VND", "value_unit": "VND"}},
        total_assets=55_677_822_007_000 if quarter == 2 else 53_312_370_717_301,
        raw_data={"source_label": "TOTAL ASSETS (Bn. VND)"}) for quarter in (1, 2)]
    result = _build_ttm_financial_statement_rows(rows, statement_type="balance")[0]
    assert result.total_assets == 55_677_822_007_000
    assert result.inventory is None
    assert result.aggregation_basis == "latest_quarter_snapshot"
    assert result.source_periods == ["Q2-2026"]
    assert result.raw_data["source_rows"][0]["period"] == "Q2-2026"
    assert result.raw_data["source_rows"][0]["raw_data"] == rows[1].raw_data


def test_ttm_flows_require_every_quarter_and_do_not_sum_eps():
    rows = [FinancialStatementData(symbol="MSR", period=f"Q{quarter}-2025", statement_type="income",
        source="VCI", currency="VND", value_unit="VND",
        consolidation_basis="consolidated", flow_basis="single_quarter",
        unit_metadata={
            "revenue": {"source_unit": "VND", "value_unit": "VND"},
            "net_income": {"source_unit": "VND", "value_unit": "VND"},
            "eps": {"source_unit": "VND/share", "value_unit": "VND/share"}},
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
    rows = [FinancialStatementData(symbol="VNM", period="Q2-2026", statement_type="balance", total_assets=value,
        source="VCI", currency="VND", value_unit="VND", consolidation_basis="consolidated",
        unit_metadata={"total_assets": {"source_unit": "VND", "value_unit": "VND"}})
        for value in (10, 20)]
    row = _build_ttm_financial_statement_rows(rows, statement_type="balance")[0]
    assert row.total_assets is None
    assert row.unavailable_reason == "conflicting_duplicate_period"


def test_ttm_cumulative_flows_are_differenced_not_summed():
    rows = [FinancialStatementData(symbol="VNM", period=period, statement_type="cashflow",
        source="VCI", currency="VND", value_unit="VND",
        consolidation_basis="consolidated", flow_basis="cumulative_ytd",
        unit_metadata={"operating_cash_flow": {"source_unit": "VND", "value_unit": "VND"}},
        operating_cash_flow=value) for period, value in [
            ("Q2-2026", 30), ("Q1-2026", 10), ("Q4-2025", 100), ("Q3-2025", 70), ("Q2-2025", 40)]]
    row = _build_ttm_financial_statement_rows(rows, statement_type="cashflow")[0]
    assert row.operating_cash_flow == 90
    assert row.source_periods == ["Q2-2026", "Q1-2026", "Q4-2025", "Q3-2025"]


def test_ttm_unknown_quarter_flow_basis_is_explicitly_unavailable():
    rows = [FinancialStatementData(symbol="VNM", period="Q2-2026", statement_type="income",
        source="VCI", currency="VND", value_unit="VND", consolidation_basis="consolidated", revenue=10,
        unit_metadata={"revenue": {"source_unit": "VND", "value_unit": "VND"}})]
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
        source="VCI", currency="VND", value_unit="VND",
        consolidation_basis="consolidated", flow_basis="single_quarter",
        unit_metadata={"revenue": {"source_unit": "VND", "value_unit": "VND"}},
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
        source="VCI", currency="VND", value_unit="VND", consolidation_basis="consolidated",
        flow_basis="trailing_twelve_months",
        unit_metadata={"revenue": {"source_unit": "VND", "value_unit": "VND"}},
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


@pytest.mark.parametrize(
    "column_value,canonical_metric,canonical_value,expected",
    [
        # A canonical that states the metric under a semantic alias still
        # describes the column, so an agreeing value is served.
        (444.0, "profit_before_tax", 444.0, 444.0),
        (444.0, "pre_tax_profit", 444.0, 444.0),
        # The alias does not license a disagreement; the row is withheld.
        (555.0, "profit_before_tax", 444.0, None),
        (555.0, "pre_tax_profit", 444.0, None),
        # The sync dumps every field, so a metric it holds as `None` is an
        # explicit "no value". Over a stored number that disagrees and must be
        # withheld on both surfaces, not read as an absent field.
        (555.0, "pre_tax_profit", None, None),
        (555.0, "profit_before_tax", None, None),
    ],
)
def test_lineage_alias_agreement_matches_between_readers(column_value, canonical_metric, canonical_value, expected):
    """REST and MCP resolve an aliased lineage the same way.

    A canonical may carry `profit_before_tax` while the column is
    `income_before_tax`. Both readers must agree on whether that value is
    backed, so a disagreement cannot be served by one surface and withheld by
    the other, and an explicit `None` must not be read as a missing field.
    """
    from types import SimpleNamespace

    from vnibb.api.v1.equity import _restore_lineage_statement
    from vnibb.mcp.server import _admit_statement_row
    from vnibb.models.financials import IncomeStatement

    # `model_dump` shape: every field present, unstated metrics explicit `None`.
    canonical = {field: None for field in FinancialStatementData.model_fields}
    canonical.update({
        "symbol": "HPG", "period": "2025", "period_type": "year", "fiscal_year": 2025,
        "source": "VCI", "currency": "VND", "value_unit": "VND", "statement_type": "income",
        "consolidation_basis": "consolidated", "flow_basis": "annual", "source_periods": [],
        canonical_metric: canonical_value,
        "unit_metadata": {"pre_tax_profit": {"source_unit": "VND", "value_unit": "VND"}},
    })
    row = SimpleNamespace(income_before_tax=column_value)
    restored = _restore_lineage_statement(
        row, {"_financial_lineage": {"canonical_data": canonical}}, IncomeStatement,
        FinancialStatementData(**canonical),
    )

    payload = {column.name: None for column in IncomeStatement.__table__.columns}
    payload.update(symbol="HPG", period="2025", fiscal_year=2025, source="VCI",
                   income_before_tax=column_value,
                   raw_data={"_financial_lineage": {"canonical_data": canonical}})
    admitted = _admit_statement_row(payload, IncomeStatement)

    assert restored.pre_tax_profit == expected
    # MCP serves the column name; both must resolve to the same decision.
    assert admitted.get("income_before_tax") == expected
