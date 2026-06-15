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
    _normalize_statement_unit_outliers,
    compute_cagr,
    compute_dividend_years,
    compute_fcf_positive,
    compute_fundamental_snapshot,
    compute_intrinsic_value_dcf,
    compute_intrinsic_value_rim,
    compute_margin_of_safety,
    compute_moat,
    compute_moat_factors,
    compute_valuation_verdict,
    to_document,
)


def _income_row(year: int, revenue: float | None, npat: float | None) -> dict[str, Any]:
    return {"yearReport": year, "revenue": revenue, "net_profit_after_tax": npat}


def _balance_row(
    year: int, equity: float | None, assets: float | None, liabilities: float | None = None
) -> dict[str, Any]:
    return {
        "yearReport": year,
        "owners_equity": equity,
        "total_assets": assets,
        "total_liabilities": liabilities,
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
    }


def test_normalize_statement_unit_outliers_repairs_fundamental_raw_rows() -> None:
    rows = [
        {"yearReport": 2022, "revenue": 10_000_000_000, "net_profit_after_tax": 1_000_000_000},
        {"yearReport": 2023, "revenue": 11_000_000_000, "net_profit_after_tax": 1_100_000_000},
        {"yearReport": 2024, "revenue": 12_000_000_000_000, "net_profit_after_tax": 1_200_000_000_000},
    ]

    normalized = _normalize_statement_unit_outliers(rows)

    assert normalized[2]["revenue"] == 12_000_000_000
    assert normalized[2]["net_profit_after_tax"] == 1_200_000_000
    assert rows[2]["revenue"] == 12_000_000_000_000


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


class TestCagr:
    def test_happy_path(self) -> None:
        # 100 -> 144 over 2 periods: sqrt(1.44) - 1 = 20%.
        assert compute_cagr([100.0, 120.0, 144.0]) == pytest.approx(20.0, rel=1e-9)

    def test_two_periods_returns_none(self) -> None:
        assert compute_cagr([100.0, 144.0]) is None

    def test_sign_flip_returns_none(self) -> None:
        assert compute_cagr([100.0, 50.0, -25.0]) is None

    def test_negative_base_returns_none(self) -> None:
        assert compute_cagr([-100.0, 50.0, 80.0]) is None

    def test_zero_base_returns_none(self) -> None:
        assert compute_cagr([0.0, 50.0, 80.0]) is None

    def test_none_values_filtered(self) -> None:
        assert compute_cagr([100.0, None, 144.0]) is None  # only 2 usable points


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


# --- FCF flag -------------------------------------------------------------------


class TestFcfPositive:
    def test_true_when_ocf_exceeds_capex(self) -> None:
        assert compute_fcf_positive([_cash_row(2024, ocf=100.0, capex=-40.0)]) is True

    def test_false_when_capex_exceeds_ocf(self) -> None:
        assert compute_fcf_positive([_cash_row(2024, ocf=100.0, capex=-150.0)]) is False

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
    years = [2020, 2021, 2022, 2023, 2024]
    revenues = [1000.0, 1100.0, 1210.0, 1331.0, 1464.1]  # +10%/y
    npats = [200.0, 220.0, 242.0, 266.2, 292.82]
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
        ratios={"yearReport": 2024, "pe": 15.0, "pb": 3.0, "ps": 2.5, "ev_ebitda": 9.0},
        income_statements=income,
        balance_sheets=balance,
        cash_flows=cash,
        company_name="AAA Corp",
        exchange="HOSE",
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
        assert snapshot.net_margin == pytest.approx(292.82 / 1464.1 * 100.0)
        assert snapshot.debt_to_equity == pytest.approx(600.0 / 1200.0)
        assert snapshot.revenue_cagr_5y == pytest.approx(10.0, rel=1e-6)
        assert snapshot.profit_cagr_5y == pytest.approx(10.0, rel=1e-6)
        assert snapshot.dividend_yield == pytest.approx(50.0 / 5000.0 * 100.0)
        assert snapshot.dividend_years == 5
        assert snapshot.fcf_positive is True
        assert snapshot.moat == "wide"
        assert snapshot.moat_score is not None
        assert snapshot.moat_factors["sector_rank_score"] is not None
        assert snapshot.pe == 15.0
        assert snapshot.pb == 3.0
        assert snapshot.ps == 2.5
        assert snapshot.ev_ebitda == 9.0
        assert snapshot.inputs["periods_used"] == [2020, 2021, 2022, 2023, 2024]
        assert snapshot.inputs["discount_rate"] == 0.12
        assert snapshot.inputs["base_fcf"] == pytest.approx(200.0)
        # growth clamped to max_growth even though CAGR is 10% (< 15%, unchanged)
        assert snapshot.inputs["growth_rate"] == pytest.approx(0.10, rel=1e-6)
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
        assert doc["schemaVersion"] == 1
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
        assert doc["inputs"] == {
            "periodsUsed": [2020, 2021, 2022, 2023, 2024],
            "discountRate": 0.12,
            "terminalGrowth": 0.03,
            "baseFcf": pytest.approx(200.0),
            "growthRate": pytest.approx(0.10, rel=1e-6),
            "horizonYears": 10,
        }
        assert doc["valuationMethod"] == "dcf"
