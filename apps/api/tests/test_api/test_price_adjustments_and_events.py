from datetime import date

from vnibb.api.v1.equity import (
    _apply_adjustment_mode_to_historical_row,
    _apply_adjustment_mode_to_ohlc,
    _apply_corporate_action_adjustments,
    _historical_adjustment_meta,
    _ratio_factor_for_action,
)
from vnibb.providers.vnstock.equity_historical import EquityHistoricalData
from vnibb.providers.vnstock.company_events import (
    _normalize_company_action_category,
    _parse_company_action_value,
)


def test_apply_adjustment_mode_to_ohlc_uses_adjusted_close_factor():
    adjusted_open, adjusted_high, adjusted_low, adjusted_close, factor, applied = (
        _apply_adjustment_mode_to_ohlc(
            open_value=100.0,
            high_value=120.0,
            low_value=90.0,
            close_value=110.0,
            adjusted_close=55.0,
            adjustment_mode="adjusted",
        )
    )

    assert applied is True
    assert factor == 0.5
    assert adjusted_open == 50.0
    assert adjusted_high == 60.0
    assert adjusted_low == 45.0
    assert adjusted_close == 55.0


def test_apply_adjustment_mode_to_ohlc_falls_back_to_raw_when_adjustment_missing():
    adjusted_open, adjusted_high, adjusted_low, adjusted_close, factor, applied = (
        _apply_adjustment_mode_to_ohlc(
            open_value=100.0,
            high_value=120.0,
            low_value=90.0,
            close_value=110.0,
            adjusted_close=None,
            adjustment_mode="adjusted",
        )
    )

    assert applied is False
    assert factor is None
    assert adjusted_open == 100.0
    assert adjusted_high == 120.0
    assert adjusted_low == 90.0
    assert adjusted_close == 110.0


def test_apply_adjustment_mode_to_historical_row_scales_provider_ohlc():
    row = EquityHistoricalData(
        symbol="VNM",
        time=date(2024, 1, 1),
        open=100,
        high=120,
        low=90,
        close=110,
        volume=1000,
        raw_close=110,
        adjusted_close=55,
    )

    adjusted = _apply_adjustment_mode_to_historical_row(row, "adjusted")
    raw = _apply_adjustment_mode_to_historical_row(row, "raw")

    assert (adjusted.open, adjusted.high, adjusted.low, adjusted.close) == (50, 60, 45, 55)
    assert adjusted.volume == 1000
    assert adjusted.adjustment_factor == 0.5
    assert adjusted.adjustment_applied is True
    assert (raw.open, raw.high, raw.low, raw.close) == (100, 120, 90, 110)
    assert raw.adjustment_applied is False


def test_historical_adjustment_meta_reports_partial_coverage():
    rows = [
        EquityHistoricalData(
            symbol="VNM",
            time=date(2024, 1, day),
            open=100,
            high=110,
            low=90,
            close=100,
            volume=1000,
            adjustment_applied=applied,
        )
        for day, applied in ((1, True), (2, False))
    ]

    meta = _historical_adjustment_meta(rows, "adjusted")

    assert meta.adjustment_requested_count == 2
    assert meta.adjustment_applied_count == 1
    assert meta.adjustment_coverage_pct == 50.0
    assert "1 raw row" in meta.adjustment_warning


def test_normalize_company_action_category_identifies_rights_issue():
    category, subtype = _normalize_company_action_category(
        "PHAT HANH THEM",
        "Issue rights to existing shareholders",
        "Quyen mua co phieu",
    )

    assert category == "issuance"
    assert subtype == "rights_issue"


def test_parse_company_action_value_handles_cash_and_ratio_formats():
    cash_amount, share_ratio = _parse_company_action_value("1,500 VND/share", None)
    assert cash_amount == 1500.0
    assert share_ratio is None

    cash_amount, share_ratio = _parse_company_action_value("2:1", None)
    assert cash_amount is None
    assert share_ratio == "2:1"


def test_ratio_factor_for_action_handles_split_and_stock_dividend():
    assert (
        _ratio_factor_for_action(action_category="split", action_subtype="split", share_ratio="2:1")
        == 0.5
    )
    assert (
        _ratio_factor_for_action(
            action_category="dividend", action_subtype="stock_dividend", share_ratio="10:3"
        )
        == 10 / 13
    )


def test_apply_corporate_action_adjustments_applies_split_factor_backward():
    rows = [
        EquityHistoricalData(
            symbol="VNM",
            time=date(2024, 1, 1),
            open=100,
            high=110,
            low=90,
            close=100,
            volume=1000,
            raw_close=100,
        ),
        EquityHistoricalData(
            symbol="VNM",
            time=date(2024, 1, 5),
            open=102,
            high=112,
            low=92,
            close=102,
            volume=1100,
            raw_close=102,
        ),
        EquityHistoricalData(
            symbol="VNM",
            time=date(2024, 1, 10),
            open=52,
            high=56,
            low=48,
            close=50,
            volume=2000,
            raw_close=50,
        ),
    ]
    actions = [
        {
            "effective_date": date(2024, 1, 10),
            "action_category": "split",
            "action_subtype": "split",
            "share_ratio": "2:1",
            "cash_amount_per_share": None,
            "percent_ratio": None,
        }
    ]

    adjusted = _apply_corporate_action_adjustments(rows, actions, "adjusted")

    assert adjusted[0].close == 50
    assert adjusted[1].close == 51
    assert adjusted[2].close == 50


def test_apply_corporate_action_adjustments_applies_cash_dividend_backward():
    rows = [
        EquityHistoricalData(
            symbol="VNM",
            time=date(2024, 1, 1),
            open=120,
            high=125,
            low=115,
            close=120,
            volume=1000,
            raw_close=120,
        ),
        EquityHistoricalData(
            symbol="VNM",
            time=date(2024, 1, 2),
            open=98,
            high=103,
            low=96,
            close=100,
            volume=1200,
            raw_close=100,
        ),
        EquityHistoricalData(
            symbol="VNM",
            time=date(2024, 1, 3),
            open=97,
            high=101,
            low=95,
            close=98,
            volume=1500,
            raw_close=98,
        ),
    ]
    actions = [
        {
            "effective_date": date(2024, 1, 3),
            "action_category": "dividend",
            "action_subtype": "cash_dividend",
            "share_ratio": None,
            "cash_amount_per_share": 2.0,
            "percent_ratio": None,
        }
    ]

    adjusted = _apply_corporate_action_adjustments(rows, actions, "adjusted")

    assert adjusted[0].close == 117.6
    assert adjusted[1].close == 98.0
    assert adjusted[2].close == 98.0
