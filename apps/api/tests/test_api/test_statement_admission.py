"""Focused regressions for the shared statement admission primitive.

Consumers that read statement columns directly (growth, earnings quality,
valuation) must not certify a figure from a populated lineage dictionary or
republish a field the unit admission withheld. These tests pin the primitive
itself; the router-level cases live beside each endpoint.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from vnibb.services import statement_admission as admission


def _evidence(unit: str = "VND") -> dict[str, str]:
    return {"source_unit": "VND", "value_unit": unit}


def _row(**overrides):
    """A persisted row: the basis lives in attributes and in its lineage."""
    payload = {
        "period": "2025",
        "fiscal_year": 2025,
        "currency": "VND",
        "value_unit": "VND",
        "consolidation_basis": "consolidated",
        "flow_basis": "annual",
        "source": "vietcap",
        "revenue": 100.0,
        "unit_metadata": {"revenue": _evidence()},
        "raw_data": {},
    }
    payload.update(overrides)
    payload.setdefault("raw_data", {})
    payload["raw_data"] = {
        **payload["raw_data"],
        "_financial_lineage": {
            "currency": payload["currency"],
            "value_unit": payload["value_unit"],
            "consolidation_basis": payload["consolidation_basis"],
            "flow_basis": payload["flow_basis"],
            "source": payload["source"],
        },
    }
    return SimpleNamespace(**payload)


def test_admitted_field_requires_a_declared_shared_basis():
    assert admission.admit_statement_field(
        _row(), "revenue", statement_type="income", period_kind="annual",
    ) == (100.0, None)


@pytest.mark.parametrize("overrides,reason", [
    ({"currency": None, "value_unit": None}, "legacy_unit_basis_unconfirmed"),
    ({"currency": "USD"}, "unverified_statement_currency_or_unit"),
    ({"value_unit": "million_VND"}, "unverified_statement_currency_or_unit"),
    ({"consolidation_basis": "unknown"}, "unverified_statement_basis"),
    ({"flow_basis": "cumulative_ytd"}, "incompatible_flow_basis"),
    ({"unavailable_reason": "duplicate_statement_period"}, "row_unavailable:duplicate_statement_period"),
    ({"revenue": None}, "missing"),
    ({"revenue": ""}, "blank"),
    ({"revenue": float("nan")}, "nonfinite"),
    ({"unit_metadata": {}}, "unverified_monetary_unit"),
])
def test_withheld_field_names_its_reason(overrides, reason):
    value, admitted_reason = admission.admit_statement_field(
        _row(**overrides), "revenue", statement_type="income", period_kind="annual",
    )
    assert value is None
    assert admitted_reason is not None and admitted_reason.startswith(reason.split(":")[0])


def test_reported_zero_is_admitted_and_not_missing():
    assert admission.admit_statement_field(
        _row(revenue=0.0), "revenue", statement_type="income", period_kind="annual",
    ) == (0.0, None)


def test_explicit_field_rejection_cannot_return_as_a_value():
    row = _row(unit_metadata={
        "revenue": {**_evidence(), "unavailable_reason": "unverified_statement_currency_or_unit"},
    })
    assert admission.admit_statement_field(
        row, "revenue", statement_type="income", period_kind="annual",
    ) == (None, "rejected:unverified_statement_currency_or_unit")


def test_two_unknowns_are_not_a_confirmed_comparison():
    current = _row(fiscal_year=2025, consolidation_basis="unknown")
    previous = _row(fiscal_year=2024, consolidation_basis="unknown")
    detail = admission.comparison_detail(
        current, previous, "revenue", statement_type="income", period_kind="annual",
    )
    assert detail["unavailable_reason"] == "unverified_statement_basis"
    assert detail["basis_status"] == "unconfirmed"


def test_comparison_requires_one_fiscal_year_step():
    current = _row(fiscal_year=2025)
    previous = _row(fiscal_year=2024)
    assert admission.comparison_detail(
        current, previous, "revenue", statement_type="income", period_kind="annual",
    )["unavailable_reason"] is None
    # A sequential quarter is not a year-over-year comparison.
    assert admission.comparison_detail(
        _row(fiscal_year=2025), _row(fiscal_year=2025), "revenue",
        statement_type="income", period_kind="annual",
    )["unavailable_reason"] == "non_comparable_periods"


def test_quarter_comparison_requires_the_same_fiscal_quarter():
    current = _row(fiscal_year=2025, fiscal_quarter=2, flow_basis="single_quarter")
    same_quarter = _row(fiscal_year=2024, fiscal_quarter=2, flow_basis="single_quarter")
    other_quarter = _row(fiscal_year=2024, fiscal_quarter=1, flow_basis="single_quarter")
    kwargs = {"statement_type": "income", "period_kind": "single_quarter"}
    assert admission.comparison_detail(current, same_quarter, "revenue", **kwargs)["unavailable_reason"] is None
    assert admission.comparison_detail(current, other_quarter, "revenue", **kwargs)["unavailable_reason"] == "non_comparable_periods"


def test_mismatched_basis_and_source_are_incomparable():
    detail = admission.comparison_detail(
        _row(fiscal_year=2025), _row(fiscal_year=2024, consolidation_basis="separate"),
        "revenue", statement_type="income", period_kind="annual",
    )
    assert (detail["basis_status"], detail["unavailable_reason"]) == (
        "incompatible", "incompatible_reporting_basis",
    )
    detail = admission.comparison_detail(
        _row(fiscal_year=2025), _row(fiscal_year=2024, source="vci"),
        "revenue", statement_type="income", period_kind="annual",
    )
    assert detail["unavailable_reason"] == "incompatible_reporting_basis"


def test_cross_statement_basis_rejects_mixed_units():
    income = _row(statement_type="income")
    cash_y_td = _row(
        statement_type="cashflow", flow_basis="cumulative_ytd",
        unit_metadata={"operating_cash_flow": _evidence()}, operating_cash_flow=80.0,
    )
    balance = _row(statement_type="balance", total_assets=200.0, flow_basis=None,
                   unit_metadata={"total_assets": _evidence()})
    assert admission.cross_statement_basis([income, cash_y_td, balance]) == (
        {
            "currency": "VND", "value_unit": "VND",
            "consolidation_basis": "consolidated", "source": "vietcap",
        },
        None,
    )
    balance_separate = _row(statement_type="balance", total_assets=200.0,
                            consolidation_basis="separate")
    assert admission.cross_statement_basis([income, balance_separate])[1] == "cross_statement_basis_mismatch"
    assert admission.cross_statement_basis([income, None])[1] == "missing_cross_statement_period"


def test_valuation_field_scales_only_from_a_declared_unit():
    assert admission.admit_valuation_field({"revenue": 1000, "unit": "million VND"}, "revenue") == (
        1_000_000_000.0, None,
    )
    assert admission.admit_valuation_field({"revenue": 1000}, "revenue") == (None, "declared_scale_unknown")
    assert admission.admit_valuation_field({"revenue": 1000, "unit": "USD"}, "revenue") == (None, "unknown_currency")
    assert admission.admit_valuation_field({"revenue": ""}, "revenue") == (None, "blank")
    assert admission.admit_valuation_field({"net_profit_after_tax": 5, "unit": "VND"}, "net_income") == (5.0, None)


def test_valuation_field_does_not_rescale_a_normalized_row():
    row = {
        "revenue": 1_000_000_000_000,
        "unit": "billion VND",
        "_valuation_unit_lineage": {"revenue": {"scaleToVnd": 1_000_000_000}},
    }
    assert admission.admit_valuation_field(row, "revenue") == (1_000_000_000_000.0, None)


def test_valuation_field_passes_a_rejection_through():
    row = {
        "revenue": 100, "unit": "VND",
        "unit_metadata": {"revenue": {"unavailable_reason": "unverified_monetary_unit"}},
    }
    assert admission.admit_valuation_field(row, "revenue") == (None, "rejected:unverified_monetary_unit")


def test_valuation_field_matches_provider_key_spellings():
    """Persisted keys keep their provider spelling; lookup must still find them.

    `_normalize_statement_rows` preserves keys like `Revenue`,
    `Purchase_Of_Fixed_Assets` or `Net Sales`, so an exact `row.get(alias)`
    would silently report `missing` for a row that states the metric.
    """
    assert admission.admit_valuation_field(
        {"Revenue": 1000, "unit": "million VND"}, "revenue",
    ) == (1_000_000_000.0, None)
    assert admission.admit_valuation_field(
        {"Purchase_Of_Fixed_Assets": 5, "unit": "VND"}, "capex",
    ) == (5.0, None)
    assert admission.admit_valuation_field(
        {"Net Sales": 7, "unit": "VND"}, "revenue",
    ) == (7.0, None)
    # The same value stays a foreign-currency refusal, not a silent pass.
    assert admission.admit_valuation_field({"Revenue": 1000, "unit": "USD"}, "revenue") == (
        None, "unknown_currency",
    )
    # The scale lineage is keyed by the provider's spelling too.
    assert admission.admit_valuation_field(
        {
            "Revenue": 1_000_000_000, "unit": "billion VND",
            "_valuation_unit_lineage": {"revenue": {"scaleToVnd": 1_000_000_000}},
        },
        "revenue",
    ) == (1_000_000_000.0, None)
    # A rejection is found under the row's spelling and under any alias.
    assert admission.admit_valuation_field(
        {"Revenue": 5, "unit": "VND",
         "unit_metadata": {"Revenue": {"unavailable_reason": "unverified_monetary_unit"}}},
        "revenue",
    ) == (None, "rejected:unverified_monetary_unit")
    assert admission.admit_valuation_field(
        {"Revenue": 5, "unit": "VND",
         "unit_metadata": {"Net_Sales": {"unavailable_reason": "unverified_statement_basis"}}},
        "revenue",
    ) == (None, "rejected:unverified_statement_basis")


def test_valuation_field_rejects_any_alias_and_top_level_lineage():
    """A rejection under another spelling, or in the row's own lineage, wins.

    The valuation helper is the one admission primitive, so it must honour the
    statement-side rule: a metric withheld under any alias stays withheld, and
    lineage carried at the row's top level counts as evidence too.
    """
    # `net_profit_after_tax` is a canonical alias of net income.
    assert admission.admit_valuation_field(
        {
            "net_income": 100, "unit": "VND",
            "unit_metadata": {"net_profit_after_tax": {"unavailable_reason": "unverified_monetary_unit"}},
        },
        "net_income",
    ) == (None, "rejected:unverified_monetary_unit")
    # The same rejection inside the row's own `_financial_lineage`.
    assert admission.admit_valuation_field(
        {
            "revenue": 100, "unit": "VND",
            "_financial_lineage": {"unit_metadata": {"net_sales": {"unavailable_reason": "unverified_statement_basis"}}},
        },
        "revenue",
    ) == (None, "rejected:unverified_statement_basis")
    # And through the nested canonical copy.
    assert admission.admit_valuation_field(
        {
            "revenue": 100, "unit": "VND",
            "raw_data": {"_financial_lineage": {"canonical_data": {
                "unit_metadata": {"revenue": {"unavailable_reason": "unverified_statement_currency_or_unit"}},
            }}},
        },
        "revenue",
    ) == (None, "rejected:unverified_statement_currency_or_unit")


def test_valuation_span_requires_consecutive_complete_years():
    rows = [
        {"yearReport": 2021, "revenue": 1, "unit": "VND"},
        {"yearReport": 2022, "revenue": 2, "unit": "VND"},
        {"yearReport": 2023, "revenue": 3, "unit": "VND"},
    ]
    values, reason = admission.admit_valuation_span(rows, "revenue", count=3)
    assert reason is None and values == [1.0, 2.0, 3.0]
    gap = [rows[0], rows[2]]
    assert admission.admit_valuation_span(gap, "revenue", count=2)[1] == "non_consecutive_annual_periods_for_revenue"
    assert admission.admit_valuation_span(rows, "revenue", count=4)[1] == "insufficient_annual_periods_for_revenue"
    unprovenanced = [rows[0], {"yearReport": 2022, "revenue": 2}]
    assert admission.admit_valuation_span(unprovenanced, "revenue", count=2)[1] == (
        "declared_scale_unknown_for_revenue_2022"
    )


def test_declared_statement_unit_is_the_scale_of_last_resort():
    """A caller that admitted the whole statement as VND needs no field scale.

    Without the declaration the same row is withheld; the reason vocabulary is
    shared with the valuation loader's own copy.
    """
    bare = {"revenue": 1_000}
    assert admission.admit_valuation_field(bare, "revenue") == (None, "declared_scale_unknown")
    assert admission.admit_valuation_field(bare, "revenue", declared_statement_unit="VND") == (
        1_000.0, None,
    )
    # The declaration excuses a missing scale, never a missing value. A unit
    # that names VND without a readable multiplier is a scale gap, not a
    # foreign currency: the statement declaration may stand in for it.
    assert admission.admit_valuation_field({}, "revenue", declared_statement_unit="VND") == (None, "missing")
    assert admission.admit_valuation_field({"revenue": 1_000, "unit": "VND (thousands)"}, "revenue") == (
        None, "declared_scale_unknown",
    )
    assert admission.admit_valuation_field(
        {"revenue": 1_000, "unit": "VND (thousands)"}, "revenue", declared_statement_unit="VND",
    ) == (1_000.0, None)
    assert admission.admit_valuation_field(
        {"revenue": 1_000, "unit": "USD"}, "revenue", declared_statement_unit="VND",
    ) == (None, "unknown_currency")
    assert admission.admit_valuation_field(
        {"revenue": 1_000, "unit": "million VND"}, "revenue", declared_statement_unit="VND",
    ) == (1_000_000_000.0, None)
