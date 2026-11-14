"""Unit tests for the fundamental valuation engine.

Synthetic dicts only — no Mongo, no network. Expected DCF/RIM values are
recomputed independently inside the tests with closed-form loops so the
implementation cannot validate itself.
"""

from __future__ import annotations

from datetime import date
from typing import Any

import pytest

from vnibb.services.fundamental_valuation import (
    FundamentalInputs,
    ValuationConfig,
    _normalize_statement_rows,
    admit_fundamental_snapshot,

    assess_cagr_coverage,
    assess_fcf_coverage,
    compute_cagr_over_years,
    compute_dividend_years,
    compute_fcf_positive,
    compute_fundamental_snapshot,
    compute_intrinsic_value_dcf,
    compute_intrinsic_value_rim,
    compute_margin_of_safety,
    compute_moat,
    compute_moat_factors,
    compute_valuation_verdict,
    fundamental_valuation_unavailable_reason,
    load_fundamental_inputs,
    to_document,
)
from vnibb.services.statement_admission import admit_valuation_field


def _income_row(year: int, revenue: float | None, npat: float | None) -> dict[str, Any]:
    return {
        "yearReport": year,
        "revenue": revenue,
        "net_profit_after_tax": npat,
        "currency_unit": "VND",
    }


def _balance_row(
    year: int, equity: float | None, assets: float | None, liabilities: float | None = None
) -> dict[str, Any]:
    return {
        "yearReport": year,
        "owners_equity": equity,
        "total_assets": assets,
        "total_liabilities": liabilities,
        "currency_unit": "VND",
    }


def _cash_row(
    year: int,
    ocf: float | None = None,
    capex: float | None = None,
    dividends: float | None = None,
) -> dict[str, Any]:
    return {
        "yearReport": year,
        "net_cash_flows_from_operating_activities": ocf,
        "purchase_of_fixed_assets": capex,
        "dividends_paid": dividends,
        "currency_unit": "VND",
    }


def test_statement_values_are_not_rescaled_from_magnitude() -> None:
    rows = [
        {"yearReport": 2022, "revenue": 10_000_000_000},
        {"yearReport": 2023, "revenue": 11_000_000_000},
        {"yearReport": 2024, "revenue": 12_000_000_000_000},
    ]
    normalized = _normalize_statement_rows([{"raw": row} for row in rows])
    assert normalized[2]["revenue"] == rows[2]["revenue"]
    assert normalized[2]["_valuation_unit_lineage"]["revenue"]["scaleToVnd"] is None


# --- DCF ---------------------------------------------------------------------


class TestDcf:
    def test_constant_growth_hand_computed(self) -> None:
        """g0 == terminal == 3% removes fade ambiguity; verify against closed form."""

        base_fcf = 100.0
        rate = 0.12
        growth = 0.03
        horizon = 10
        shares = 10.0

        # Independent closed-form computation.
        expected_pv = 0.0
        fcf = base_fcf
        for year in range(1, horizon + 1):
            fcf = fcf * (1.0 + growth)
            expected_pv += fcf / (1.0 + rate) ** year
        terminal = (fcf * (1.0 + growth) / (rate - growth)) / (1.0 + rate) ** horizon
        expected_iv = (expected_pv + terminal) / shares

        config = ValuationConfig(terminal_growth=growth, horizon_years=horizon)
        actual = compute_intrinsic_value_dcf(
            base_fcf, growth, shares, discount_rate=rate, config=config
        )
        assert actual == pytest.approx(expected_iv, rel=1e-6)

    def test_negative_base_fcf_returns_none(self) -> None:
        assert (
            compute_intrinsic_value_dcf(-5.0, 0.05, 10.0, discount_rate=0.12) is None
        )

    def test_zero_base_fcf_returns_none(self) -> None:
        assert compute_intrinsic_value_dcf(0.0, 0.05, 10.0, discount_rate=0.12) is None

    def test_missing_shares_returns_none(self) -> None:
        assert compute_intrinsic_value_dcf(100.0, 0.05, None, discount_rate=0.12) is None

    def test_discount_not_above_terminal_returns_none(self) -> None:
        config = ValuationConfig(terminal_growth=0.03)
        assert (
            compute_intrinsic_value_dcf(100.0, 0.05, 10.0, discount_rate=0.03, config=config)
            is None
        )

    def test_growth_clamped_to_max(self) -> None:
        config = ValuationConfig(max_growth=0.15)
        capped = compute_intrinsic_value_dcf(
            100.0, 0.50, 10.0, discount_rate=0.12, config=config
        )
        at_max = compute_intrinsic_value_dcf(
            100.0, 0.15, 10.0, discount_rate=0.12, config=config
        )
        assert capped == pytest.approx(at_max, rel=1e-9)


# --- RIM ---------------------------------------------------------------------


class TestRim:
    def test_known_value_with_linear_fade(self) -> None:
        bvps = 100.0
        current_roe = 0.20
        rate = 0.13
        horizon = 10

        expected = bvps
        for year in range(1, horizon + 1):
            roe = current_roe + (rate - current_roe) * (year - 1) / (horizon - 1)
            expected += bvps * (roe - rate) / (1.0 + rate) ** year

        config = ValuationConfig(horizon_years=horizon)
        actual = compute_intrinsic_value_rim(
            bvps, current_roe, discount_rate=rate, config=config
        )
        assert actual == pytest.approx(expected, rel=1e-6)

    def test_roe_equal_to_discount_rate_gives_bvps(self) -> None:
        actual = compute_intrinsic_value_rim(50.0, 0.13, discount_rate=0.13)
        assert actual == pytest.approx(50.0, rel=1e-9)

    def test_missing_bvps_returns_none(self) -> None:
        assert compute_intrinsic_value_rim(None, 0.2, discount_rate=0.13) is None

    def test_missing_roe_returns_none(self) -> None:
        assert compute_intrinsic_value_rim(100.0, None, discount_rate=0.13) is None


# --- CAGR ---------------------------------------------------------------------


class TestCagrOverYears:
    def test_elapsed_years_not_point_count(self) -> None:
        # 2020 -> 2024 is four years regardless of how many rows exist.
        assert compute_cagr_over_years([(2020, 100.0), (2024, 146.41)]) == pytest.approx(
            10.0, rel=1e-9
        )

    def test_missing_intermediate_year_does_not_shorten_span(self) -> None:
        points = [(2020, 100.0), (2022, 121.0), (2024, 146.41)]
        assert compute_cagr_over_years(points) == pytest.approx(10.0, rel=1e-9)

    def test_single_point_or_zero_span_is_none(self) -> None:
        assert compute_cagr_over_years([(2024, 100.0)]) is None
        assert compute_cagr_over_years([(2024, 100.0), (2024, 121.0)]) is None

    def test_nonpositive_endpoints_are_none(self) -> None:
        assert compute_cagr_over_years([(2020, 0.0), (2024, 100.0)]) is None
        assert compute_cagr_over_years([(2020, 100.0), (2024, -1.0)]) is None


def _revenue_years(mapping: dict[int, float | None]) -> list[dict[str, Any]]:
    return [_income_row(year, value, 1.0) for year, value in sorted(mapping.items())]


class TestCagrCoverage:
    def test_sparse_three_points_are_not_labelled_five_year(self) -> None:
        coverage = assess_cagr_coverage(
            _revenue_years({2020: 100.0, 2022: 121.0, 2024: 146.41}), "revenue"
        )

        assert coverage["value"] == pytest.approx(10.0, rel=1e-9)
        assert coverage["published"] is None
        assert coverage["spanYears"] == 4
        assert coverage["coverage"] == "gapped"
        assert coverage["reason"] == "insufficient_span:4y"

    def test_complete_five_year_span_publishes(self) -> None:
        values = {2020: 100.0, 2021: 110.0, 2022: 121.0, 2023: 133.1, 2024: 146.41, 2025: 161.051}
        coverage = assess_cagr_coverage(_revenue_years(values), "revenue")

        assert coverage["status"] == "complete"
        assert coverage["coverage"] == "complete"
        assert coverage["spanYears"] == 5
        assert coverage["published"] == pytest.approx(10.0, rel=1e-9)

    def test_five_rows_four_intervals_do_not_publish_five_year(self) -> None:
        values = {2020: 100.0, 2021: 110.0, 2022: 121.0, 2023: 133.1, 2024: 146.41}
        coverage = assess_cagr_coverage(_revenue_years(values), "revenue")

        assert coverage["published"] is None
        assert coverage["value"] == pytest.approx(10.0, rel=1e-9)
        assert coverage["reason"] == "insufficient_span:4y"

    def test_gap_inside_five_year_span_does_not_publish(self) -> None:
        values = {2020: 100.0, 2021: 110.0, 2023: 133.1, 2024: 146.41, 2025: 161.051}
        coverage = assess_cagr_coverage(_revenue_years(values), "revenue")

        assert coverage["published"] is None
        assert coverage["coverage"] == "gapped"
        assert coverage["reason"] == "incomplete_intermediate_coverage"
        assert coverage["value"] == pytest.approx(((161.051 / 100.0) ** 0.2 - 1) * 100)

    def test_null_intermediate_value_is_excluded_and_disclosed(self) -> None:
        values = {2020: 100.0, 2021: None, 2022: 121.0, 2023: 133.1, 2024: 146.41, 2025: 161.051}
        coverage = assess_cagr_coverage(_revenue_years(values), "revenue")

        assert coverage["published"] is None
        assert {"year": 2021, "field": "revenue", "reason": "missing"} in coverage["excluded"]
        assert coverage["spanYears"] == 5

    def test_restated_duplicate_fiscal_year_withholds_that_year(self) -> None:
        rows = [
            _income_row(2020, 100.0, 1.0),
            _income_row(2021, 110.0, 1.0),
            _income_row(2022, 121.0, 1.0),
            _income_row(2023, 133.1, 1.0),
            _income_row(2024, 146.41, 1.0),
            _income_row(2025, 161.051, 1.0),
            _income_row(2025, 999.0, 1.0),
        ]
        coverage = assess_cagr_coverage(rows, "revenue")

        assert coverage["published"] is None
        assert coverage["excluded"][-1] == {
            "year": 2025, "field": "revenue", "reason": "ambiguous_restatement",
        }
        assert coverage["endYear"] == 2024

    def test_nonpositive_endpoint_withholds_value(self) -> None:
        values = {2020: 0.0, 2021: 10.0, 2022: 20.0, 2023: 30.0, 2024: 40.0, 2025: 50.0}
        coverage = assess_cagr_coverage(_revenue_years(values), "revenue")

        assert coverage["published"] is None
        assert coverage["value"] is None
        assert coverage["reason"] == "nonpositive_endpoint"

    def test_unadmitted_scale_is_excluded_not_coerced(self) -> None:
        rows = [{"yearReport": year, "revenue": value} for year, value in
                {2020: 100.0, 2021: 110.0, 2022: 121.0, 2023: 133.1, 2024: 146.41, 2025: 161.051}.items()]
        coverage = assess_cagr_coverage(rows, "revenue")

        assert coverage["published"] is None
        assert {item["reason"] for item in coverage["excluded"]} == {"declared_scale_unknown"}

    def test_declared_unit_alone_admits_values(self) -> None:
        rows = [{"yearReport": year, "revenue": value} for year, value in
                {2020: 100.0, 2021: 110.0, 2022: 121.0, 2023: 133.1, 2024: 146.41, 2025: 161.051}.items()]
        coverage = assess_cagr_coverage(rows, "revenue", declared_statement_unit="VND")

        assert coverage["published"] == pytest.approx(10.0, rel=1e-9)

    def test_case_and_spaced_keys_preserve_cagr(self) -> None:
        rows = [{"yearReport": year, "Revenue": 100.0 * 1.1 ** (year - 2020),
                 "currency_unit": "VND"} for year in range(2020, 2026)]

        coverage = assess_cagr_coverage(rows, "revenue")

        assert coverage["published"] == pytest.approx(10.0)
        assert coverage["excluded"] == []

    @pytest.mark.parametrize(
        ("evidence", "reason"),
        [
            ({"unit_metadata": {"netRevenue": {"unavailable_reason": "unit_mismatch"}}},
             "rejected:unit_mismatch"),
            ({"_financial_lineage": {"unit_metadata": {
                "netRevenue": {"unavailable_reason": "unit_mismatch"},
            }}}, "rejected:unit_mismatch"),
            ({"unit_metadata": {
                "revenue": {"value_unit": "VND"},
                "net_sales": {"unavailable_reason": "unit_mismatch"},
            }}, "rejected:unit_mismatch"),
            ({"unit_metadata": {
                "Revenue": {"value_unit": "VND"},
                "Net Sales": {"unavailable_reason": "unit_mismatch"},
            }}, "rejected:unit_mismatch"),
            ({"currency_unit": "USD"}, "unknown_currency"),
        ],
    )
    def test_rejected_alias_and_foreign_currency_cannot_publish_cagr(
        self, evidence: dict[str, Any], reason: str,
    ) -> None:
        rows = _revenue_years({year: 100.0 * 1.1 ** (year - 2020)
                               for year in range(2020, 2026)})
        rows[2].update(evidence)

        coverage = assess_cagr_coverage(rows, "revenue", declared_statement_unit="VND")

        assert coverage["published"] is None
        assert {"year": 2022, "field": "revenue", "reason": reason} in coverage["excluded"]

# --- field admission ------------------------------------------------------------


class TestAdmitValuationField:
    def test_absent_capex_is_missing_not_zero(self) -> None:
        assert admit_valuation_field({"yearReport": 2024, "operating_cash_flow": 300.0}, "capex") == (
            None, "missing",
        )

    def test_blank_capex_is_blank_not_zero(self) -> None:
        assert admit_valuation_field({"yearReport": 2024, "capex": "   "}, "capex") == (
            None, "blank",
        )

    def test_reported_zero_capex_is_admitted(self) -> None:
        assert admit_valuation_field(
            {"yearReport": 2024, "capex": 0.0, "currency_unit": "VND"}, "capex"
        ) == (0.0, None)

    def test_rejected_field_never_returns_through_alias(self) -> None:
        row = {
            "yearReport": 2024,
            "capex": 100.0,
            "currency_unit": "VND",
            "unit_metadata": {"capex": {"unavailable_reason": "unit_mismatch"}},
        }
        assert admit_valuation_field(row, "capex") == (None, "rejected:unit_mismatch")

    def test_unknown_currency_is_not_assumed(self) -> None:
        row = {"yearReport": 2024, "capex": 100.0, "currency_unit": "USD"}
        assert admit_valuation_field(row, "capex") == (None, "unknown_currency")

    def test_declared_thousand_scale_is_converted_once(self) -> None:
        row = {"yearReport": 2024, "capex": 1.5, "units": {"capex": "thousand VND"}}
        assert admit_valuation_field(row, "capex") == (1500.0, None)

    def test_normalized_row_scale_is_not_applied_twice(self) -> None:
        normalized = _normalize_statement_rows(
            [{"raw": {"yearReport": 2024, "purchase_of_fixed_assets": 2, "currency_unit": "million VND"}}]
        )
        assert admit_valuation_field(normalized[0], "capex") == (2_000_000.0, None)


def _cash_year(year: int, ocf: float | None, capex: float | None) -> dict[str, Any]:
    return _cash_row(year, ocf=ocf, capex=capex)


class TestFcfCoverage:
    def test_missing_capex_makes_fcf_unknown_and_blocks_dcf_base(self) -> None:
        coverage = assess_fcf_coverage([_cash_year(2024, 300.0, None)])

        assert coverage["positive"] is None
        assert coverage["baseFcf"] is None
        assert coverage["status"] == "partial"
        assert coverage["excluded"] == [{
            "year": 2024,
            "incomplete": [{"component": "capex", "reason": "missing"}],
        }]
        assert coverage["reason"].startswith("insufficient_complete_cash_flow_years")

    def test_latest_incomplete_year_does_not_inherit_older_fcf(self) -> None:
        coverage = assess_fcf_coverage([
            _cash_year(2022, 300.0, -100.0),
            _cash_year(2023, 300.0, -100.0),
            _cash_year(2024, 300.0, None),
        ])

        assert coverage["positive"] is None
        assert coverage["positiveReason"].startswith("latest_year_incomplete:capex=missing")
        assert coverage["baseFcf"] is None
        assert coverage["status"] == "partial"

    def test_complete_three_rows_provide_base_fcf(self) -> None:
        coverage = assess_fcf_coverage([
            _cash_year(2022, 300.0, -100.0),
            _cash_year(2023, 320.0, -120.0),
            _cash_year(2024, 340.0, -140.0),
        ])

        assert coverage["status"] == "complete"
        assert coverage["positive"] is True
        assert coverage["baseFcf"] == pytest.approx((200.0 + 200.0 + 200.0) / 3)
        assert coverage["baseYears"] == [2022, 2023, 2024]

    def test_case_and_spaced_keys_preserve_fcf(self) -> None:
        rows = [{"yearReport": year, "Operating Cash Flow": 300.0,
                 "Purchase_Of_Fixed_Assets": -100.0, "currency_unit": "VND"}
                for year in (2022, 2023, 2024)]

        coverage = assess_fcf_coverage(rows)

        assert coverage["baseFcf"] == 200.0
        assert coverage["positive"] is True
        assert coverage["excluded"] == []
    def test_explicit_zero_capex_is_a_valid_complete_row(self) -> None:
        coverage = assess_fcf_coverage([
            _cash_year(2022, 300.0, 0.0),
            _cash_year(2023, 300.0, 0.0),
            _cash_year(2024, 300.0, 0.0),
        ])

        assert coverage["status"] == "complete"
        assert coverage["positive"] is True
        assert coverage["baseFcf"] == pytest.approx(300.0)


# --- dividend streak -----------------------------------------------------------


class TestDividendYears:
    def test_streak_counts_recent_consecutive_outflows(self) -> None:
        cash = [
            _cash_row(2020, dividends=-10.0),
            _cash_row(2021, dividends=-10.0),
            _cash_row(2022, dividends=-10.0),
        ]
        assert compute_dividend_years(cash) == 3

    def test_gap_resets_streak(self) -> None:
        cash = [
            _cash_row(2020, dividends=-10.0),
            _cash_row(2021, dividends=-10.0),
            _cash_row(2022, dividends=None),  # gap
            _cash_row(2023, dividends=-10.0),
            _cash_row(2024, dividends=-10.0),
        ]
        assert compute_dividend_years(cash) == 2

    def test_latest_year_without_dividend_is_zero(self) -> None:
        cash = [_cash_row(2023, dividends=-10.0), _cash_row(2024, dividends=0.0)]
        assert compute_dividend_years(cash) == 0

    def test_empty_returns_none(self) -> None:
        assert compute_dividend_years([]) is None


class TestFcfPositive:
    def test_true_when_ocf_exceeds_capex(self) -> None:
        assert compute_fcf_positive([_cash_row(2024, ocf=100.0, capex=-40.0)]) is True

    def test_false_when_capex_exceeds_ocf(self) -> None:
        assert compute_fcf_positive([_cash_row(2024, ocf=100.0, capex=-150.0)]) is False

    def test_none_when_capex_missing(self) -> None:
        assert compute_fcf_positive([_cash_row(2024, ocf=300.0, capex=None)]) is None

    def test_true_with_reported_zero_capex(self) -> None:
        assert compute_fcf_positive([_cash_row(2024, ocf=300.0, capex=0.0)]) is True

    def test_none_when_ocf_missing(self) -> None:
        assert compute_fcf_positive([_cash_row(2024, ocf=None, capex=-150.0)]) is None

    def test_none_when_no_rows(self) -> None:
        assert compute_fcf_positive([]) is None


# --- moat ------------------------------------------------------------------------


class TestMoat:
    @staticmethod
    def _statements(
        npats: list[float], revenues: list[float], equities: list[float]
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        years = range(2020, 2020 + len(npats))
        income = [
            _income_row(y, rev, npat)
            for y, rev, npat in zip(years, revenues, npats, strict=True)
        ]
        balance = [_balance_row(y, eq, eq * 2) for y, eq in zip(years, equities, strict=True)]
        return income, balance

    def test_wide(self) -> None:
        # ROE 20% every year, net margin 20%, stable.
        income, balance = self._statements(
            npats=[200.0] * 5, revenues=[1000.0] * 5, equities=[1000.0] * 5
        )
        assert compute_moat(income, balance) == "wide"

    def test_narrow(self) -> None:
        # ROE 12% (below wide's 15% bar), margin 12% >= 5%.
        income, balance = self._statements(
            npats=[120.0] * 5, revenues=[1000.0] * 5, equities=[1000.0] * 5
        )
        assert compute_moat(income, balance) == "narrow"

    def test_none_label(self) -> None:
        # ROE 4%, margin 4% — fails everything.
        income, balance = self._statements(
            npats=[40.0] * 5, revenues=[1000.0] * 5, equities=[1000.0] * 5
        )
        assert compute_moat(income, balance) == "none"

    def test_eroding(self) -> None:
        # First 3 years ROE 20%; latest collapses to 4% (< 60% of the 20% peak)
        # with margin 4% so the narrow rule does not absorb it.
        income, balance = self._statements(
            npats=[200.0, 200.0, 200.0, 100.0, 40.0],
            revenues=[1000.0] * 5,
            equities=[1000.0] * 5,
        )
        assert compute_moat(income, balance) == "eroding"

    def test_insufficient_history_returns_none(self) -> None:
        income, balance = self._statements(
            npats=[200.0, 200.0], revenues=[1000.0] * 2, equities=[1000.0] * 2
        )
        assert compute_moat(income, balance) is None

    def test_multi_factor_score_uses_margin_coverage_roic_and_rank(self) -> None:
        income, balance = self._statements(
            npats=[180.0] * 5, revenues=[1000.0] * 5, equities=[1000.0] * 5
        )
        for row in income:
            row["gross_profit"] = 420.0
            row["ebit"] = 160.0
            row["interest_expense"] = -20.0
            row["unit_metadata"] = {"interest_expense": {
                "label": "interest_expense", "source_unit": "VND", "value_unit": "VND",
            }}

        score, factors = compute_moat_factors(
            income,
            balance,
            {"roic": 0.18},
            discount_rate=0.12,
        )

        assert score is not None and score > 75.0
        assert factors["gross_margin_stability"] == pytest.approx(100.0)
        assert factors["interest_coverage"] == pytest.approx(8.0)
        assert factors["roic"] == pytest.approx(18.0)
        assert factors["roic_spread"] == pytest.approx(6.0)
        assert factors["sector_rank_score"] == pytest.approx(90.0)

    @pytest.mark.parametrize("interest_fields", [
        {"interest_expense": -20.0},
        {"interest_expense": -20.0, "unit_metadata": {"interest_expense": {"value_unit": "VND"}}},
        {"interest_expense": -20.0, "_valuation_unit_lineage": {
            "interest_expense": {"rawValue": -20.0, "rawUnit": "VND", "scaleToVnd": 1},
        }},
        {"interest_expense": -20.0, "unit_metadata": {"interest_expense": {
            "label": "financial_expenses", "source_unit": "VND", "value_unit": "VND",
            "unavailable_reason": "ambiguous_interest_expense_semantics",
        }}},
        {"finance_cost": -20.0, "unit": "VND"},
        {"financial_expenses": -20.0, "unit": "VND"},
    ])
    def test_unproven_interest_is_not_a_moat_factor(self, interest_fields) -> None:
        income, balance = self._statements(
            npats=[180.0] * 5, revenues=[1000.0] * 5, equities=[1000.0] * 5
        )
        for row in income:
            row.update(gross_profit=420.0, ebit=160.0)
        baseline_score, baseline_factors = compute_moat_factors(
            income, balance, {"roic": 0.18}, discount_rate=0.12,
        )
        income[-1].update(interest_fields)

        score, factors = compute_moat_factors(
            income, balance, {"roic": 0.18}, discount_rate=0.12,
        )

        assert "interest_coverage" not in factors
        assert score == pytest.approx(baseline_score)
        assert factors == baseline_factors
        assert factors["gross_margin_avg"] == pytest.approx(42.0)
        assert factors["roe_avg"] == pytest.approx(18.0)
        assert factors["roic_spread"] == pytest.approx(6.0)

    @pytest.mark.parametrize("unit", ["VND", "million VND"])
    @pytest.mark.parametrize("interest_key", ["interest_expense", "interestExpense"])
    def test_normalized_interest_requires_original_semantics_and_unit(self, unit, interest_key) -> None:
        income, balance = self._statements(
            npats=[180.0] * 5, revenues=[1000.0] * 5, equities=[1000.0] * 5
        )
        for row in income:
            row.update(gross_profit=420.0, ebit=160.0, unit=unit)
            row[interest_key] = -20.0

        _, factors = compute_moat_factors(_normalize_statement_rows([{"raw": row} for row in income]), balance)

        assert factors["interest_coverage"] == pytest.approx(8.0)

    def test_normalization_does_not_override_explicit_interest_rejection(self) -> None:
        income, balance = self._statements(
            npats=[180.0] * 5, revenues=[1000.0] * 5, equities=[1000.0] * 5
        )
        for row in income:
            row.update(gross_profit=420.0, ebit=160.0, interest_expense=-20.0, unit="VND")
            row["unit_metadata"] = {"interest_expense": {
                "label": "financial_expenses", "source_unit": "VND", "value_unit": "VND",
                "unavailable_reason": "ambiguous_interest_expense_semantics",
            }}

        _, factors = compute_moat_factors(_normalize_statement_rows([{"raw": row} for row in income]), balance)

        assert "interest_coverage" not in factors
        assert factors["gross_margin_avg"] == pytest.approx(42.0)


# --- margin of safety --------------------------------------------------------------


class TestMarginOfSafety:
    def test_plain_value(self) -> None:
        assert compute_margin_of_safety(100.0, 80.0) == pytest.approx(20.0)

    def test_clamped_at_minus_100(self) -> None:
        # (100 - 500) / 100 * 100 = -400 -> clamped.
        assert compute_margin_of_safety(100.0, 500.0) == -100.0

    def test_upper_bound_never_exceeds_100(self) -> None:
        result = compute_margin_of_safety(1_000_000.0, 1e-6)
        assert result is not None
        assert result <= 100.0
        assert result == pytest.approx(100.0, abs=1e-6)

    def test_none_when_price_missing(self) -> None:
        assert compute_margin_of_safety(100.0, None) is None

    def test_none_when_iv_missing(self) -> None:
        assert compute_margin_of_safety(None, 80.0) is None

    def test_none_when_iv_non_positive(self) -> None:
        assert compute_margin_of_safety(0.0, 80.0) is None
        assert compute_margin_of_safety(-10.0, 80.0) is None

    @pytest.mark.parametrize(
        ("mos", "verdict"),
        [(35.0, "undervalued"), (12.0, "fair_plus"), (0.0, "fair"), (-20.0, "expensive"), (-35.0, "stretched")],
    )
    def test_valuation_verdict(self, mos: float, verdict: str) -> None:
        assert compute_valuation_verdict(mos) == verdict


# --- full snapshot -------------------------------------------------------------------


def _happy_inputs() -> FundamentalInputs:
    # Six annual rows: a full five-year span (2020 -> 2025) with all six
    # intermediate observations, so the 5Y fields and DCF growth are admissible.
    years = [2020, 2021, 2022, 2023, 2024, 2025]
    revenues = [1000.0, 1100.0, 1210.0, 1331.0, 1464.1, 1610.51]  # +10%/y
    npats = [200.0, 220.0, 242.0, 266.2, 292.82, 322.102]
    income = [_income_row(y, r, n) for y, r, n in zip(years, revenues, npats, strict=True)]
    balance = [_balance_row(y, 1000.0 + 50 * i, 2000.0 + 50 * i, 600.0) for i, y in enumerate(years)]
    cash = [_cash_row(y, ocf=300.0, capex=-100.0, dividends=-50.0) for y in years]
    return FundamentalInputs(
        symbol="AAA",
        sector="Consumer Goods",
        industry="Food & Beverage",
        price=50.0,
        shares_outstanding=100.0,
        market_cap=5000.0,
        ratios={"yearReport": 2025, "pe": 15.0, "pb": 3.0, "ps": 2.5, "ev_ebitda": 9.0},
        income_statements=income,
        balance_sheets=balance,
        cash_flows=cash,
        company_name="AAA Corp",
        exchange="HOSE",
        price_unit="VND",
        shares_unit="shares",
        statement_unit="VND",
    )


class TestComputeFundamentalSnapshot:
    def test_happy_path(self) -> None:
        snapshot = compute_fundamental_snapshot(_happy_inputs())

        assert snapshot.symbol == "AAA"
        assert snapshot.valuation_method == "dcf"
        assert snapshot.intrinsic_value is not None and snapshot.intrinsic_value > 0
        assert snapshot.margin_of_safety is not None
        assert snapshot.valuation_verdict is not None
        assert snapshot.roe is not None and snapshot.roe > 0
        assert snapshot.roa is not None
        assert snapshot.net_margin == pytest.approx(322.102 / 1610.51 * 100.0)
        assert snapshot.debt_to_equity == pytest.approx(600.0 / 1250.0)
        assert snapshot.revenue_cagr_5y == pytest.approx(10.0, rel=1e-6)
        assert snapshot.profit_cagr_5y == pytest.approx(10.0, rel=1e-6)
        assert snapshot.dividend_yield == pytest.approx(50.0 / 5000.0 * 100.0)
        assert snapshot.dividend_years == 6
        assert snapshot.fcf_positive is True
        assert snapshot.moat == "wide"
        assert snapshot.moat_score is not None
        assert snapshot.moat_factors["sector_rank_score"] is not None
        assert snapshot.pe == 15.0
        assert snapshot.pb == 3.0
        assert snapshot.ps == 2.5
        assert snapshot.ev_ebitda == 9.0
        assert snapshot.inputs["periods_used"] == [2020, 2021, 2022, 2023, 2024, 2025]
        assert snapshot.inputs["discount_rate"] == 0.12
        assert snapshot.inputs["base_fcf"] == pytest.approx(200.0)
        assert snapshot.inputs["growth_rate"] == pytest.approx(0.10, rel=1e-6)
        coverage = snapshot.inputs["derived_coverage"]
        assert coverage["cagr"]["revenue"]["status"] == "complete"
        assert coverage["cagr"]["revenue"]["startYear"] == 2020
        assert coverage["cagr"]["revenue"]["endYear"] == 2025
        assert coverage["cagr"]["revenue"]["spanYears"] == 5
        assert coverage["fcf"]["status"] == "complete"
        assert coverage["fcf"]["baseYears"] == [2023, 2024, 2025]
        assert coverage["growth"]["source"] == "net_income_cagr"
        assert snapshot.inputs["derived_unavailable_reason"] is None
        assert "roe" in snapshot.computed_fields
        assert "intrinsic_value" in snapshot.computed_fields

    def test_missing_capex_withholds_fcf_valuation_and_margin(self) -> None:
        inputs = FundamentalInputs(
            symbol="QAZ",
            price=50.0,
            shares_outstanding=100.0,
            market_cap=5000.0,
            price_unit="VND",
            shares_unit="shares",
            statement_unit="VND",
            cash_flows=[{"yearReport": 2024, "operating_cash_flow": 300.0, "currency_unit": "VND"}],
        )
        snapshot = compute_fundamental_snapshot(inputs)

        assert snapshot.fcf_positive is None
        assert snapshot.inputs["base_fcf"] is None
        assert snapshot.intrinsic_value is None
        assert snapshot.margin_of_safety is None
        assert snapshot.valuation_method is None
        assert snapshot.valuation_verdict is None
        assert "Free cash flow is unavailable" in snapshot.inputs["derived_unavailable_reason"]
        assert snapshot.inputs["derived_coverage"]["fcf"]["excluded"] == [{
            "year": 2024,
            "incomplete": [{"component": "capex", "reason": "missing"}],
        }]
        assert snapshot.inputs["unit_quality"] == "verified"
        assert snapshot.inputs["comparison_unavailable_reason"] is None

    def test_reported_zero_capex_still_values(self) -> None:
        inputs = _happy_inputs()
        inputs.cash_flows = [_cash_row(y, ocf=300.0, capex=0.0) for y in (2020, 2021, 2022, 2023, 2024, 2025)]
        snapshot = compute_fundamental_snapshot(inputs)

        assert snapshot.fcf_positive is True
        assert snapshot.inputs["base_fcf"] == pytest.approx(300.0)
        assert snapshot.intrinsic_value is not None

    def test_four_year_span_does_not_publish_five_year_or_seed_dcf(self) -> None:
        inputs = _happy_inputs()
        inputs.income_statements = inputs.income_statements[1:]
        inputs.cash_flows = inputs.cash_flows[:5]
        snapshot = compute_fundamental_snapshot(inputs)

        assert snapshot.revenue_cagr_5y is None
        assert snapshot.profit_cagr_5y is None
        revenue_block = snapshot.inputs["derived_coverage"]["cagr"]["revenue"]
        assert revenue_block["value"] == pytest.approx(10.0, rel=1e-6)
        assert revenue_block["spanYears"] == 4
        assert revenue_block["reason"] == "insufficient_span:4y"
        assert snapshot.inputs["derived_coverage"]["growth"]["source"] == "none"
        assert snapshot.inputs["growth_rate"] == 0.0
        assert snapshot.valuation_method == "dcf"

        assert "roe" in snapshot.computed_fields
        assert "intrinsic_value" in snapshot.computed_fields

    def test_financial_sector_uses_rim(self) -> None:
        inputs = _happy_inputs()
        inputs.sector = "Ngân hàng"
        snapshot = compute_fundamental_snapshot(inputs)
        assert snapshot.valuation_method == "rim"
        assert snapshot.intrinsic_value is not None
        assert snapshot.inputs["discount_rate"] == 0.13

    def test_sector_discount_override(self) -> None:
        config = ValuationConfig(sector_discount_overrides={"consumer goods": 0.10})
        snapshot = compute_fundamental_snapshot(_happy_inputs(), config)
        assert snapshot.inputs["discount_rate"] == 0.10

    def test_totally_empty_inputs_never_raises(self) -> None:
        snapshot = compute_fundamental_snapshot(FundamentalInputs(symbol="XXX"))
        assert snapshot.symbol == "XXX"
        assert snapshot.roe is None
        assert snapshot.roa is None
        assert snapshot.net_margin is None
        assert snapshot.debt_to_equity is None
        assert snapshot.revenue_cagr_5y is None
        assert snapshot.profit_cagr_5y is None
        assert snapshot.dividend_yield is None
        assert snapshot.dividend_years is None
        assert snapshot.fcf_positive is None
        assert snapshot.intrinsic_value is None
        assert snapshot.margin_of_safety is None
        assert snapshot.valuation_method is None
        assert snapshot.valuation_verdict is None
        assert snapshot.moat is None
        assert snapshot.computed_fields == []

    def test_garbage_rows_never_raise(self) -> None:
        inputs = FundamentalInputs(
            symbol="JNK",
            ratios={"pe": "not-a-number"},
            income_statements=[{"yearReport": "??", "revenue": "abc"}, {"foo": 1}],
            balance_sheets=[{"yearReport": 2024, "owners_equity": "x"}],
            cash_flows=[{"yearReport": 2024, "dividends_paid": "?"}],
        )
        snapshot = compute_fundamental_snapshot(inputs)
        assert snapshot.symbol == "JNK"
        assert snapshot.intrinsic_value is None


# --- document shape ---------------------------------------------------------------------


class TestToDocument:
    def test_camel_case_shape(self) -> None:
        snapshot = compute_fundamental_snapshot(_happy_inputs())
        doc = to_document(snapshot, date(2026, 6, 10))

        assert doc["symbol"] == "AAA"
        assert doc["snapshotDate"] == "2026-06-10"
        assert doc["source"] == "vnibb-fundamental-engine"
        assert doc["schemaVersion"] == 4
        assert doc["observedAt"] is not None
        assert doc["updatedAt"] is not None
        for key in (
            "companyName",
            "exchange",
            "industry",
            "price",
            "marketCap",
            "pe",
            "pb",
            "ps",
            "evEbitda",
            "roe",
            "roa",
            "netMargin",
            "debtToEquity",
            "revenueCagr5y",
            "profitCagr5y",
            "dividendYield",
            "dividendYears",
            "fcfPositive",
            "intrinsicValue",
            "marginOfSafety",
            "valuationMethod",
            "valuationVerdict",
            "moat",
            "moatScore",
            "moatFactors",
            "computedFields",
        ):
            assert key in doc, f"missing {key}"
        inputs = doc["inputs"]
        assert inputs["periodsUsed"] == [2020, 2021, 2022, 2023, 2024, 2025]
        assert inputs["discountRate"] == 0.12
        assert inputs["terminalGrowth"] == 0.03
        assert inputs["baseFcf"] == pytest.approx(200.0)
        assert inputs["growthRate"] == pytest.approx(0.10, rel=1e-6)
        assert inputs["horizonYears"] == 10
        assert inputs["unitQuality"] == "verified"
        assert inputs["comparisonUnavailableReason"] is None
        assert inputs["derivedUnavailableReason"] is None
        assert inputs["unitLineage"] == {
            "price": {"unit": "VND"}, "shares": {"unit": "shares"}, "statements": {"unit": "VND"},
        }
        coverage = inputs["derivedCoverage"]
        assert coverage["fcf"]["status"] == "complete"
        assert coverage["cagr"]["revenue"]["published"] == pytest.approx(10.0, rel=1e-6)
        assert doc["valuationMethod"] == "dcf"


# --- retained snapshot admission ------------------------------------------------


def _v3_doc() -> dict[str, Any]:
    return {
        "symbol": "AAA",
        "snapshotDate": "2026-06-10",
        "schemaVersion": 3,
        "moat": "wide",
        "moatScore": 71.0,
        "dividendYears": 5,
        "intrinsicValue": 30.482968633288355,
        "marginOfSafety": -64.02601925521924,
        "valuationMethod": "dcf",
        "valuationVerdict": "stretched",
        "revenueCagr5y": 21.0,
        "profitCagr5y": 21.0,
        "fcfPositive": True,
        "inputs": {"unitQuality": "verified", "unitLineage": {"price": {"unit": "VND"}}},
    }


class TestAdmitFundamentalSnapshot:
    def test_old_formula_derived_values_are_withheld_with_reason(self) -> None:
        admitted = admit_fundamental_snapshot(_v3_doc())

        for field in (
            "intrinsicValue",
            "marginOfSafety",
            "valuationMethod",
            "valuationVerdict",
            "revenueCagr5y",
            "profitCagr5y",
            "fcfPositive",
        ):
            assert admitted[field] is None, field
        assert admitted["symbol"] == "AAA"
        assert admitted["moat"] == "wide"
        assert admitted["moatScore"] == 71.0
        assert admitted["dividendYears"] == 5
        assert "schema" in admitted["inputs"]["derivedUnavailableReason"]
        assert admitted["inputs"]["derivedWithheldFields"]

    def test_withheld_snapshot_reports_valuation_unavailable(self) -> None:
        reason = fundamental_valuation_unavailable_reason(admit_fundamental_snapshot(_v3_doc()))

        assert reason is not None
        assert "schema" in reason

    def test_current_schema_document_is_returned_unchanged(self) -> None:
        doc = to_document(compute_fundamental_snapshot(_happy_inputs()), date(2026, 6, 10))
        assert admit_fundamental_snapshot(doc) is doc
        assert fundamental_valuation_unavailable_reason(doc) is None

    def test_v4_schema_without_coverage_block_is_still_withheld(self) -> None:
        doc = _v3_doc()
        doc["schemaVersion"] = 4
        admitted = admit_fundamental_snapshot(doc)

        assert admitted["intrinsicValue"] is None
        assert admitted["revenueCagr5y"] is None

    def test_admission_is_idempotent(self) -> None:
        once = admit_fundamental_snapshot(_v3_doc())
        twice = admit_fundamental_snapshot(once)

        assert twice == once

    def test_missing_capex_snapshot_never_republishes_a_value(self) -> None:
        inputs = FundamentalInputs(
            symbol="QAZ", price=50.0, shares_outstanding=100.0, market_cap=5000.0,
            price_unit="VND", shares_unit="shares", statement_unit="VND",
            cash_flows=[{"yearReport": 2024, "operating_cash_flow": 300.0, "currency_unit": "VND"}],
        )
        doc = to_document(compute_fundamental_snapshot(inputs), date(2026, 6, 10))

        assert doc["intrinsicValue"] is None
        assert doc["marginOfSafety"] is None
        assert doc["fcfPositive"] is None
        assert admit_fundamental_snapshot(doc) is doc
        assert fundamental_valuation_unavailable_reason(doc)


class _PriceCorpus:
    def __init__(self, prices):
        self.prices = prices

    async def get_raw_dataset_records(self, _symbol, *, dataset, **_kwargs):
        if dataset == "company.info":
            return [{"raw": {"issue_share": 1_000_000, "units": {"issue_share": "shares"}}}]
        return []

    async def get_eod_prices(self, _symbol, **_kwargs):
        return self.prices


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("record", "expected"),
    [
        ({"close": 70.8, "priceUnit": "THOUSAND_VND"}, 70_800),
        ({"close": 70.8, "source": "vnstock_history:KBS"}, 70_800),
        ({"close": 80, "priceUnit": "VND"}, 80),
        ({"close": 70_800, "priceUnit": "VND"}, 70_800),
    ],
)
async def test_valuation_reads_explicit_or_source_backed_vnd(record, expected):
    inputs = await load_fundamental_inputs("FPT", _PriceCorpus([record]))

    assert inputs.price == pytest.approx(expected)
    assert inputs.market_cap == pytest.approx(expected * 1_000_000)


@pytest.mark.asyncio
async def test_valuation_preserves_low_vnd_after_legitimate_split():
    inputs = await load_fundamental_inputs("LOW", _PriceCorpus([
        {"close": 100_000, "priceUnit": "VND"},
        {"close": 100, "priceUnit": "VND", "volume": 50},
    ]))

    assert inputs.price == 100
    assert inputs.volume == 50
    assert inputs.market_cap == 100_000_000


@pytest.mark.asyncio
async def test_valuation_skips_unknown_units_without_numeric_inference():
    inputs = await load_fundamental_inputs("FPT", _PriceCorpus([
        {"close": 80, "priceUnit": "VND"},
        {"close": 80_000, "source": "vnstock"},
    ]))

    assert inputs.price == 80


@pytest.mark.asyncio
@pytest.mark.parametrize("record", [{"close": 80_000}, {"close": 1250, "priceUnit": "index_points"}])
async def test_valuation_does_not_value_unknown_units_or_index_points(record):
    inputs = await load_fundamental_inputs("FPT", _PriceCorpus([record]))

    assert inputs.price is None
    assert inputs.market_cap is None


@pytest.mark.parametrize("missing", ["price_unit", "shares_unit", "statement_unit"])
def test_unknown_unit_disables_comparison_with_specific_reason(missing):
    inputs = _happy_inputs()
    setattr(inputs, missing, None)
    snapshot = compute_fundamental_snapshot(inputs)
    assert snapshot.margin_of_safety is None
    assert snapshot.valuation_verdict is None
    assert snapshot.inputs["unit_quality"] == "unknown"
    assert "unknown" in snapshot.inputs["comparison_unavailable_reason"]
    if missing != "price_unit":
        assert snapshot.intrinsic_value is None
    else:
        assert snapshot.intrinsic_value is not None


@pytest.mark.parametrize("price", [50.0, 59_700_000.0])
def test_declared_vnd_valuation_is_not_forced_near_price(price):
    inputs = _happy_inputs()
    inputs.price = price
    snapshot = compute_fundamental_snapshot(inputs)
    # Independent model value: constant 200 VND annual FCF growing from 10%
    # to 3% over ten years, divided by 100 shares. No price-based rescaling.
    fcf, present_value = 200.0, 0.0
    for year in range(1, 11):
        fcf *= 1 + 0.10 + (0.03 - 0.10) * (year - 1) / 9
        present_value += fcf / 1.12 ** year
    expected = (present_value + fcf * 1.03 / 0.09 / 1.12 ** 10) / 100
    assert snapshot.intrinsic_value == pytest.approx(expected)
    assert snapshot.price == price
    assert snapshot.inputs["unit_quality"] == "verified"


class _ValuationCorpus(_PriceCorpus):
    def __init__(self, currency_unit="VND", shares_unit="shares"):
        super().__init__([{"close": 59_700, "priceUnit": "VND", "time": "2026-06-15"}])
        self.currency_unit = currency_unit
        self.shares_unit = shares_unit

    async def get_raw_dataset_records(self, _symbol, *, dataset, **_kwargs):
        if dataset == "company.info":
            return [{"raw": {"issued_share": 1_000_000, "industry": "Bank", "units": {"issued_share": self.shares_unit}}}]
        if dataset == "finance.balance_sheet":
            return [{"dataset": dataset, "datasetVariant": dataset + ".year", "source": "fixture",
                     "observedAt": "2026-06-15T00:00:00Z", "raw": {
                         "yearReport": 2025, "owners_equity": 20_000_000_000,
                         "total_assets": 30_000_000_000, "currency_unit": self.currency_unit}}]
        if dataset == "finance.income_statement":
            return [{"raw": {"yearReport": 2025, "net_profit_after_tax": 2_600_000_000,
                             "currency_unit": self.currency_unit}}]
        return []


@pytest.mark.asyncio
async def test_known_price_equity_and_share_units_preserve_rim_value():
    inputs = await load_fundamental_inputs("VNM", _ValuationCorpus())
    snapshot = compute_fundamental_snapshot(inputs)
    # ROE equals the 13% discount rate, hence residual income is zero.
    assert snapshot.intrinsic_value == pytest.approx(20_000)
    assert snapshot.price == 59_700
    assert snapshot.margin_of_safety == -100
    assert snapshot.inputs["unit_quality"] == "verified"
    doc = to_document(snapshot, date(2026, 6, 15))
    assert doc["inputs"]["unitLineage"]["statements"][1]["fields"]["owners_equity"] == {
        "rawValue": 20_000_000_000, "rawUnit": "VND", "scaleToVnd": 1}


@pytest.mark.asyncio
@pytest.mark.parametrize("currency_unit,shares_unit", [(None, "shares"), ("VND", None)])
async def test_loaded_unknown_units_do_not_publish_intrinsic_or_comparison(currency_unit, shares_unit):
    inputs = await load_fundamental_inputs("VNM", _ValuationCorpus(currency_unit, shares_unit))
    snapshot = compute_fundamental_snapshot(inputs)
    assert snapshot.intrinsic_value is None
    assert snapshot.margin_of_safety is None
    assert snapshot.inputs["unit_quality"] == "unknown"
    assert snapshot.inputs["comparison_unavailable_reason"]


@pytest.mark.asyncio
async def test_statement_conversion_uses_only_declared_currency_scale():
    corpus = _ValuationCorpus("million VND")
    records = await corpus.get_raw_dataset_records("VNM", dataset="finance.balance_sheet")
    records[0]["raw"]["owners_equity"] = 20_000
    normalized = _normalize_statement_rows(records)
    assert normalized[0]["owners_equity"] == 20_000_000_000
    assert records[0]["raw"]["owners_equity"] == 20_000


def test_conflicting_same_year_statement_observations_do_not_choose_valuation_truth():
    records = [
        {"observedAt": date(2026, 6, 14), "raw": {"yearReport": 2025, "owners_equity": 20_000_000_000, "currency_unit": "VND"}},
        {"observedAt": date(2026, 6, 15), "raw": {"yearReport": 2025, "owners_equity": 21_000_000_000, "currency_unit": "VND"}},
    ]
    inputs = _happy_inputs()
    inputs.sector = "Bank"
    inputs.balance_sheets = _normalize_statement_rows(records)
    snapshot = compute_fundamental_snapshot(inputs)
    assert snapshot.intrinsic_value is None
    assert snapshot.margin_of_safety is None
    assert "no established revision order" in snapshot.inputs["comparison_unavailable_reason"]
    assert inputs.balance_sheets[0]["_valuation_observations"] == [row["raw"] for row in records]


class TestFcfNewestRowSelection:
    def test_newest_incomplete_row_is_not_bridged_with_older_complete_years(self) -> None:
        coverage = assess_fcf_coverage([
            _cash_year(2021, 300.0, -100.0),
            _cash_year(2022, 300.0, -100.0),
            _cash_year(2023, 300.0, -100.0),
            _cash_year(2024, None, -100.0),
        ])

        assert coverage["status"] == "partial"
        assert coverage["baseFcf"] is None
        assert coverage["baseYears"] == [2022, 2023]
        assert coverage["incompleteWindowYears"] == [2024]
        assert coverage["latestYear"] == 2024
        assert coverage["positive"] is None
        assert "2024" in coverage["reason"]

    def test_complete_newest_rows_still_value(self) -> None:
        coverage = assess_fcf_coverage([
            _cash_year(2021, 260.0, -100.0),
            _cash_year(2022, 280.0, -100.0),
            _cash_year(2023, 300.0, -100.0),
            _cash_year(2024, 320.0, -100.0),
            _cash_year(2025, 340.0, -100.0),
        ])

        assert coverage["status"] == "complete"
        assert coverage["baseYears"] == [2023, 2024, 2025]
        assert coverage["baseFcf"] == pytest.approx((200.0 + 220.0 + 240.0) / 3)
        assert coverage["incompleteWindowYears"] == []

    def test_conflicting_capex_observation_withholds_that_year(self) -> None:
        row = _cash_year(2025, 340.0, -100.0)
        row["_valuation_conflicting_observations"] = ["purchase_of_fixed_assets"]
        coverage = assess_fcf_coverage([
            _cash_year(2023, 300.0, -100.0),
            _cash_year(2024, 320.0, -100.0),
            row,
        ])

        assert coverage["status"] == "partial"
        assert coverage["baseFcf"] is None
        assert coverage["incompleteWindowYears"] == [2025]
        assert coverage["excluded"] == [{
            "year": 2025,
            "incomplete": [{"component": "capex", "reason": "conflicting_observations"}],
        }]
        assert coverage["positive"] is None


class TestSnapshotWithNewestIncompleteFcf:
    def test_unknown_newest_cash_flow_year_withholds_dcf_and_margin(self) -> None:
        inputs = _happy_inputs()
        inputs.cash_flows = inputs.cash_flows[:5] + [_cash_row(2025, ocf=300.0, capex=None)]
        snapshot = compute_fundamental_snapshot(inputs)

        assert snapshot.fcf_positive is None
        assert snapshot.inputs["base_fcf"] is None
        assert snapshot.intrinsic_value is None
        assert snapshot.margin_of_safety is None
        assert snapshot.valuation_method is None
        assert snapshot.valuation_verdict is None
        reason = snapshot.inputs["derived_unavailable_reason"]
        assert "Free cash flow is unavailable" in reason
        assert "2025" in reason
        assert snapshot.inputs["derived_coverage"]["fcf"]["incompleteWindowYears"] == [2025]
        # The 5Y CAGR fields are an independent lineage and stay published.
        assert snapshot.revenue_cagr_5y == pytest.approx(10.0, rel=1e-6)


class TestConflictingRestatementCoverage:
    @staticmethod
    def _normalized_income() -> list[dict[str, Any]]:
        records = [
            {
                "observedAt": date(2026, 6, 14),
                "raw": {"yearReport": year, "revenue": revenue, "currency_unit": "VND"},
            }
            for year, revenue in (
                (2020, 100.0), (2021, 110.0), (2022, 121.0),
                (2023, 133.1), (2024, 146.41), (2025, 161.051),
            )
        ]
        # A later restatement of the newest year carries no revision authority.
        records.append({
            "observedAt": date(2026, 6, 15),
            "raw": {"yearReport": 2025, "revenue": 999.0, "currency_unit": "VND"},
        })
        return _normalize_statement_rows(records)

    def test_loader_conflict_marker_withholds_the_year_from_cagr(self) -> None:
        rows = self._normalized_income()
        newest = next(row for row in rows if row["yearReport"] == 2025)
        assert newest["_valuation_conflicting_observations"] == ["revenue"]

        coverage = assess_cagr_coverage(rows, "revenue")

        assert coverage["published"] is None
        assert {
            "year": 2025, "field": "revenue", "reason": "conflicting_observations",
        } in coverage["excluded"]
        assert 999.0 not in [point["value"] for point in coverage["points"]]
        assert coverage["endYear"] == 2024

    def test_snapshot_from_loader_conflict_withholds_five_year_fields(self) -> None:
        inputs = _happy_inputs()
        inputs.income_statements = self._normalized_income()
        snapshot = compute_fundamental_snapshot(inputs)

        assert snapshot.revenue_cagr_5y is None
        assert snapshot.inputs["derived_coverage"]["cagr"]["revenue"]["published"] is None


class TestCagrMetadataIdentity:
    def test_long_history_reports_the_selected_window_not_the_full_extent(self) -> None:
        rows = [_income_row(year, value, 1.0) for year, value in (
            (2010, 10.0), (2011, 11.0), (2012, 12.0), (2013, 13.0), (2014, 14.0),
            (2020, 100.0), (2021, 110.0), (2022, 121.0), (2023, 133.1),
            (2024, 146.41), (2025, 161.051),
        )]
        coverage = assess_cagr_coverage(rows, "revenue")

        assert coverage["published"] == pytest.approx(10.0, rel=1e-6)
        assert (coverage["startYear"], coverage["endYear"], coverage["spanYears"]) == (2020, 2025, 5)
        assert (coverage["historyStartYear"], coverage["historyEndYear"]) == (2010, 2025)
