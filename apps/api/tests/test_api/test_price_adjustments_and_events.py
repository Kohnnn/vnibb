from vnibb.api.v1.equity import _apply_adjustment_mode_to_ohlc
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
