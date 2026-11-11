"""Offline transforms for supplied FHSC payloads; no acquisition is performed."""

from __future__ import annotations

import math
import re
from datetime import date, datetime
from typing import Any

from vnibb.core.price_units import normalize_price_record

_PRICE_FIELDS = ("price", "open", "high", "low", "reference", "ceiling", "floor", "change", "change_percent", "volume")
_LISTING_NUMBERS = ("listing_reference_price", "listed_shares", "outstanding_shares", "treasury_shares", "free_float", "free_float_pct")


def _envelope(payload: Any, data_type: type) -> Any:
    if not isinstance(payload, dict) or not isinstance(payload.get("error_code"), str) or not isinstance(payload.get("message"), str):
        raise ValueError("Malformed FHSC envelope")
    if payload["error_code"] != "0":
        raise ValueError(f"FHSC error {payload['error_code']}: {payload['message']}")
    if not isinstance(payload.get("data"), data_type):
        raise ValueError("Malformed FHSC data")
    return payload["data"]


def _symbol(symbol: Any) -> str:
    if not isinstance(symbol, str) or not symbol.strip():
        raise ValueError("FHSC symbol is required")
    return symbol.strip().upper()


def _match_symbol(data: dict, symbol: str) -> str:
    actual = data.get("symbol")
    if not isinstance(actual, str) or not actual.strip() or _symbol(actual) != _symbol(symbol):
        raise ValueError("FHSC symbol mismatch or missing symbol")
    return actual


def _number(value: Any, field: str, *, nullable: bool = True) -> None:
    if value is None and nullable:
        return
    try:
        valid = not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)
    except OverflowError:
        valid = False
    if not valid:
        raise ValueError(f"Malformed FHSC numeric field: {field}")


def _optional_text(data: dict, *fields: str) -> None:
    for field in fields:
        if data.get(field) is not None and not isinstance(data[field], str):
            raise ValueError(f"Malformed FHSC text field: {field}")


def _unknown_price(raw: dict, symbol: str) -> dict:
    return {
        "source": "fhsc",
        "symbol": symbol,
        "raw_data": dict(raw),
        "price_unit": "unknown",
        "price_basis": "unknown",
        "adjustment_mode": "unknown",
        "finality": "unknown",
        "unavailable_reason": "unverified_price_unit_or_basis",
    }


def fhsc_history(symbol: str, payload: Any) -> list[dict]:
    """Keep provider bars as raw observations, not usable OHLC prices."""
    data = _envelope(payload, dict)
    actual = _match_symbol(data, symbol)
    _optional_text(data, "currency", "resolution")
    if not isinstance(data.get("series"), list):
        raise ValueError("Malformed FHSC history series")
    context = {key: value for key, value in data.items() if key != "series"}
    rows = []
    for bar in data["series"]:
        if not isinstance(bar, dict) or isinstance(bar.get("t"), bool) or not isinstance(bar.get("t"), int):
            raise ValueError("Malformed FHSC bar timestamp")
        for field in ("o", "h", "l", "c", "v", "yield"):
            _number(bar.get(field), field)
        row = _unknown_price(bar, actual)
        row.update({"t": bar["t"], "raw_context": context})
        rows.append(row)
    return rows


def fhsc_quote(symbol: str, payload: Any) -> dict:
    """Keep a quote's actual source timestamp and unverified prices as raw data."""
    data = _envelope(payload, dict)
    actual = _match_symbol(data, symbol)
    if "price" not in data:
        raise ValueError("Missing FHSC quote price")
    for field in _PRICE_FIELDS:
        _number(data.get(field), field, nullable=field != "price")
    _optional_text(data, "name", "exchange", "currency", "updated_at")
    timestamp = data.get("updated_at")
    if timestamp is not None:
        try:
            parsed = datetime.fromisoformat(timestamp)
            if parsed.utcoffset() is None:
                raise ValueError
        except ValueError as exc:
            raise ValueError("Malformed FHSC quote updated_at") from exc
    result = _unknown_price(data, actual)
    result["updated_at"] = timestamp
    return result


def fhsc_listing(symbol: str, payload: Any, *, view: str = "symbol_detail") -> dict:
    """Transform one symbol's listing; a listing is not a symbol universe."""
    if view != "symbol_detail":
        raise ValueError(f"FHSC listing view {view!r} unavailable: only per-symbol detail is documented")
    data = _envelope(payload, dict)
    actual = _match_symbol(data, symbol)
    _optional_text(data, "exchange", "listing_date")
    listing_date = data.get("listing_date")
    if listing_date is not None:
        try:
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", listing_date):
                raise ValueError
            date.fromisoformat(listing_date)
        except ValueError as exc:
            raise ValueError("Malformed FHSC listing_date") from exc
    for field in _LISTING_NUMBERS:
        _number(data.get(field), field)
    normalized = normalize_price_record(
        {"price": data.get("listing_reference_price"), "price_unit": "VND"}, source="fhsc"
    )
    return {
        "source": "fhsc",
        "symbol": actual,
        "raw_data": dict(data),
        "listing_reference_price": normalized["price"],
        "listing_reference_price_unit": normalized["price_unit"],
        "price_source": normalized["price_source"],
        "price_basis": "listing_reference",
        "adjustment_mode": "unknown",
        "finality": "unknown",
        "unavailable_reason": "unverified_adjustment_or_finality" if normalized["price"] is not None else "missing_listing_reference_price",
    }


_STATEMENT_TYPES = {"income-statement": "income", "balance-sheet": "balance", "cash-flow": "cashflow"}


def _financial_row(symbol: str, entry: Any, statement_type: str, period: str) -> Any:
    from vnibb.providers.vnstock.financials import FinancialStatementData

    if not isinstance(entry, dict):
        raise ValueError("Malformed FHSC statement row")
    year = entry.get("year")
    if isinstance(year, bool) or not isinstance(year, int) or not 1900 <= year <= 2100:
        raise ValueError("Malformed FHSC statement year")
    quarter = entry.get("quarter")
    if quarter is not None and (isinstance(quarter, bool) or not isinstance(quarter, int) or quarter not in (1, 2, 3, 4)):
        raise ValueError("Malformed FHSC statement quarter")
    if period == "quarter" and quarter is None:
        raise ValueError("FHSC quarterly row is missing quarter")
    if period == "year" and quarter is not None:
        raise ValueError("FHSC annual row contains quarter")
    codes = {}
    for code, value in entry.items():
        if code in {"year", "quarter"}:
            continue
        if not isinstance(code, str) or not code.strip():
            raise ValueError("Malformed FHSC metric code")
        _number(value, code)
        codes[code] = value
    period_label = f"Q{quarter}-{year}" if period == "quarter" else str(year)
    is_balance = statement_type == "balance"
    return FinancialStatementData(
        symbol=symbol,
        period=period_label,
        statement_type=statement_type,
        fiscal_year=year,
        fiscal_quarter=quarter if period == "quarter" else None,
        raw_data={"raw": dict(entry), "metric_codes": codes},
        source="fhsc",
        currency=None,
        value_unit=None,
        unit_metadata={
            code: {
                "source": "fhsc",
                "source_field": code,
                "source_unit": None,
                "value_unit": None,
                "unavailable_reason": "unknown_source_unit",
            }
            for code in codes
        },
        flow_basis="annual" if not is_balance and period == "year" else None,
        unavailable_reason="unknown_source_unit",
    )


def fhsc_financials(symbol: str, payload: Any, *, statement_type: str, period: str) -> list:
    """Keep documented metric codes raw; their unit and canonical identity stay unknown."""
    canonical_type = _STATEMENT_TYPES.get(statement_type, statement_type)
    if canonical_type not in _STATEMENT_TYPES.values():
        raise ValueError(f"FHSC statement type {statement_type!r} is not documented")
    if period not in {"year", "annual", "quarter", "quarterly"}:
        raise ValueError(f"FHSC statement period {period!r} is not documented")
    data = _envelope(payload, list)
    granularity = "quarter" if period.startswith("quarter") else "year"
    return [_financial_row(_symbol(symbol), entry, canonical_type, granularity) for entry in data]
