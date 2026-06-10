from __future__ import annotations

import pytest

import vnibb.api.v1.screener as screener_module
from vnibb.api.v1.screener import (
    _apply_fundamental_filters,
    _merge_fundamental_snapshots,
)
from vnibb.providers.vnstock.equity_screener import ScreenerData


def _row(symbol: str = "VNM", **kwargs) -> ScreenerData:
    return ScreenerData(symbol=symbol, **kwargs)


def _no_params(rows):
    return _apply_fundamental_filters(
        rows,
        moat=None,
        margin_of_safety_min=None,
        margin_of_safety_max=None,
        dividend_years_min=None,
        fcf_positive=None,
    )


class TestApplyFundamentalFilters:
    def test_no_params_returns_rows_unchanged(self):
        rows = [_row("VNM"), _row("FPT", moat="wide")]
        assert _no_params(rows) == rows

    def test_no_params_keeps_null_field_rows(self):
        rows = [_row("VNM")]
        assert _no_params(rows) == rows

    def test_moat_filter_parses_csv_and_lowercases(self):
        rows = [
            _row("VNM", moat="wide"),
            _row("FPT", moat="narrow"),
            _row("HPG", moat="none"),
        ]
        result = _apply_fundamental_filters(
            rows,
            moat="Wide, NARROW",
            margin_of_safety_min=None,
            margin_of_safety_max=None,
            dividend_years_min=None,
            fcf_positive=None,
        )
        assert [r.symbol for r in result] == ["VNM", "FPT"]

    def test_moat_filter_excludes_null_moat(self):
        rows = [_row("VNM", moat="wide"), _row("FPT")]
        result = _apply_fundamental_filters(
            rows,
            moat="wide",
            margin_of_safety_min=None,
            margin_of_safety_max=None,
            dividend_years_min=None,
            fcf_positive=None,
        )
        assert [r.symbol for r in result] == ["VNM"]

    def test_margin_of_safety_min(self):
        rows = [
            _row("VNM", margin_of_safety=25.0),
            _row("FPT", margin_of_safety=5.0),
            _row("HPG"),
        ]
        result = _apply_fundamental_filters(
            rows,
            moat=None,
            margin_of_safety_min=10.0,
            margin_of_safety_max=None,
            dividend_years_min=None,
            fcf_positive=None,
        )
        assert [r.symbol for r in result] == ["VNM"]

    def test_margin_of_safety_max(self):
        rows = [
            _row("VNM", margin_of_safety=25.0),
            _row("FPT", margin_of_safety=5.0),
            _row("HPG"),
        ]
        result = _apply_fundamental_filters(
            rows,
            moat=None,
            margin_of_safety_min=None,
            margin_of_safety_max=10.0,
            dividend_years_min=None,
            fcf_positive=None,
        )
        assert [r.symbol for r in result] == ["FPT"]

    def test_dividend_years_min(self):
        rows = [
            _row("VNM", dividend_years=9),
            _row("FPT", dividend_years=2),
            _row("HPG"),
        ]
        result = _apply_fundamental_filters(
            rows,
            moat=None,
            margin_of_safety_min=None,
            margin_of_safety_max=None,
            dividend_years_min=5,
            fcf_positive=None,
        )
        assert [r.symbol for r in result] == ["VNM"]

    def test_fcf_positive_true_excludes_false_and_null(self):
        rows = [
            _row("VNM", fcf_positive=True),
            _row("FPT", fcf_positive=False),
            _row("HPG"),
        ]
        result = _apply_fundamental_filters(
            rows,
            moat=None,
            margin_of_safety_min=None,
            margin_of_safety_max=None,
            dividend_years_min=None,
            fcf_positive=True,
        )
        assert [r.symbol for r in result] == ["VNM"]

    def test_fcf_positive_false_keeps_only_explicit_false(self):
        rows = [
            _row("VNM", fcf_positive=True),
            _row("FPT", fcf_positive=False),
            _row("HPG"),
        ]
        result = _apply_fundamental_filters(
            rows,
            moat=None,
            margin_of_safety_min=None,
            margin_of_safety_max=None,
            dividend_years_min=None,
            fcf_positive=False,
        )
        assert [r.symbol for r in result] == ["FPT"]

    def test_combined_filters(self):
        rows = [
            _row("VNM", moat="wide", margin_of_safety=20.0, fcf_positive=True),
            _row("FPT", moat="wide", margin_of_safety=-5.0, fcf_positive=True),
            _row("HPG", moat="none", margin_of_safety=30.0, fcf_positive=True),
        ]
        result = _apply_fundamental_filters(
            rows,
            moat="wide",
            margin_of_safety_min=0.0,
            margin_of_safety_max=None,
            dividend_years_min=None,
            fcf_positive=True,
        )
        assert [r.symbol for r in result] == ["VNM"]


class _FakeMongoService:
    def __init__(self, *, enabled: bool = True, docs: dict | None = None, error: bool = False):
        self.enabled = enabled
        self._docs = docs or {}
        self._error = error
        self.requested_symbols: list[str] | None = None

    async def get_latest_fundamental_snapshots(self, symbols=None):
        if self._error:
            raise RuntimeError("mongo down")
        self.requested_symbols = symbols
        return self._docs


_CANNED_DOC = {
    "symbol": "VNM",
    "snapshotDate": "2026-06-10",
    "intrinsicValue": 78200.0,
    "marginOfSafety": 16.9,
    "moat": "narrow",
    "dividendYears": 9,
    "fcfPositive": True,
    "valuationMethod": "dcf",
}


@pytest.mark.asyncio
async def test_merge_attaches_fundamental_fields(monkeypatch):
    svc = _FakeMongoService(docs={"VNM": dict(_CANNED_DOC)})
    monkeypatch.setattr(screener_module, "get_mongo_market_data_service", lambda: svc)

    rows = [_row("VNM"), _row("FPT")]
    result = await _merge_fundamental_snapshots(rows)

    merged = result[0]
    assert merged.intrinsic_value == 78200.0
    assert merged.margin_of_safety == 16.9
    assert merged.moat == "narrow"
    assert merged.dividend_years == 9
    assert merged.fcf_positive is True
    assert merged.valuation_method == "dcf"
    assert merged.fundamental_as_of == "2026-06-10"
    assert svc.requested_symbols == ["VNM", "FPT"]

    untouched = result[1]
    assert untouched.intrinsic_value is None
    assert untouched.moat is None


@pytest.mark.asyncio
async def test_merge_skips_none_doc_values(monkeypatch):
    doc = dict(_CANNED_DOC)
    doc["moat"] = None
    doc["intrinsicValue"] = None
    svc = _FakeMongoService(docs={"VNM": doc})
    monkeypatch.setattr(screener_module, "get_mongo_market_data_service", lambda: svc)

    result = await _merge_fundamental_snapshots([_row("VNM")])

    assert result[0].moat is None
    assert result[0].intrinsic_value is None
    assert result[0].margin_of_safety == 16.9


@pytest.mark.asyncio
async def test_merge_returns_rows_unchanged_when_service_disabled(monkeypatch):
    svc = _FakeMongoService(enabled=False, docs={"VNM": dict(_CANNED_DOC)})
    monkeypatch.setattr(screener_module, "get_mongo_market_data_service", lambda: svc)

    rows = [_row("VNM")]
    result = await _merge_fundamental_snapshots(rows)

    assert result == rows
    assert result[0].intrinsic_value is None
    assert svc.requested_symbols is None


@pytest.mark.asyncio
async def test_merge_returns_rows_on_service_failure(monkeypatch):
    svc = _FakeMongoService(error=True)
    monkeypatch.setattr(screener_module, "get_mongo_market_data_service", lambda: svc)

    rows = [_row("VNM")]
    result = await _merge_fundamental_snapshots(rows)

    assert result == rows
    assert result[0].intrinsic_value is None


@pytest.mark.asyncio
async def test_merge_empty_rows_skips_service(monkeypatch):
    def _boom():
        raise AssertionError("service should not be requested for empty rows")

    monkeypatch.setattr(screener_module, "get_mongo_market_data_service", _boom)

    assert await _merge_fundamental_snapshots([]) == []


def test_cached_dict_without_fundamental_fields_still_validates():
    # Cache round-trip safety: old cached model_dump() dicts predate the
    # fundamental fields and must still validate to None defaults.
    legacy = _row("VNM", pe=15.2).model_dump()
    for key in (
        "intrinsic_value",
        "margin_of_safety",
        "moat",
        "dividend_years",
        "fcf_positive",
        "valuation_method",
        "fundamental_as_of",
    ):
        legacy.pop(key, None)

    revived = ScreenerData(**legacy)
    assert revived.intrinsic_value is None
    assert revived.moat is None
    assert revived.pe == 15.2
