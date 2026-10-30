"""Admit capitalization only with explicit currency, date and outstanding-share lineage."""

import math
from collections.abc import Mapping
from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

from vnibb.core.screener_shares import resolve_screener_shares


def _record(value: Any) -> dict[str, Any]:
    if isinstance(value, Mapping):
        row = dict(value)
    elif hasattr(value, "model_dump"):
        row = value.model_dump()
    else:
        row = dict(vars(value)) if value is not None and hasattr(value, "__dict__") else {}
    extended = row.get("extended_metrics")
    return {**(extended if isinstance(extended, dict) else {}), **row}


def _number(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return number if math.isfinite(number) else None


def _day(value: Any) -> str | None:
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).date().isoformat()
    except ValueError:
        return None


def _first_value(row: dict[str, Any], *keys: str) -> Any:
    return next((row[key] for key in keys if row.get(key) is not None), None)


def _share_fields(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "shares": _number(_first_value(row, "outstanding_shares", "shares_outstanding", "sharesOutstanding")),
        "shares_unit": row.get("shares_unit") or row.get("outstanding_shares_unit"),
        "shares_as_of": _day(row.get("shares_as_of") or row.get("outstanding_shares_as_of")),
        "shares_source": row.get("shares_source") or row.get("outstanding_shares_source"),
        "share_basis": row.get("share_basis"),
    }


def _certified(item: dict[str, Any]) -> bool:
    cap_date = _day(item.get("as_of"))
    shares = _number(item.get("shares"))
    value = _number(item.get("value"))
    if not (
        not item.get("shares_conflict") and value is not None and value > 0 and item.get("unit") == "VND"
        and item.get("currency") == "VND" and item.get("source_confirmed") is True
        and isinstance(item.get("source"), str) and item["source"].strip()
        and cap_date and cap_date <= datetime.now(ZoneInfo("Asia/Ho_Chi_Minh")).date().isoformat()
        and shares is not None and shares > 0
        and item.get("shares_unit") == "shares"
        and isinstance(item.get("shares_source"), str) and item["shares_source"].strip()
        and item.get("share_basis") == "outstanding"
        and _day(item.get("shares_as_of")) == cap_date
    ):
        return False
    if item.get("calculation"):
        price = _number(item.get("price"))
        return bool(
            item.get("calculation") == "price * outstanding_shares"
            and item.get("price_unit") == "VND" and item.get("price_source")
            and _day(item.get("price_as_of")) == cap_date and price is not None and price > 0
            and math.isclose(value, price * shares, rel_tol=1e-9, abs_tol=0.01)
        )
    return True


def _result(observations: list[dict[str, Any]]) -> dict[str, Any]:
    unique: list[dict[str, Any]] = []
    for observation in observations:
        if observation not in unique:
            unique.append(observation)
    admitted = [item for item in unique if _certified(item)]
    result = {
        "status": "unavailable", "value": None,
        "reason": "Market-cap currency, unit, observation date or dated outstanding-share basis is unverified.",
        "source": None, "currency": None, "unit": None, "as_of": None,
        "share_basis": None, "shares_as_of": None, "shares_unit": None, "shares_source": None,
        "observations": unique,
    }
    if not admitted:
        return result
    first = admitted[0]
    if any(
        _day(item.get("as_of")) != _day(first.get("as_of")) or item["share_basis"] != first["share_basis"]
        or _day(item.get("shares_as_of")) != _day(first.get("shares_as_of"))
        or not math.isclose(_number(item["shares"]), _number(first["shares"]), rel_tol=1e-9, abs_tol=0.01)
        or not math.isclose(_number(item["value"]), _number(first["value"]), rel_tol=1e-9, abs_tol=0.01)
        for item in admitted[1:]
    ):
        result.update(status="conflict", reason="Market-cap observations disagree on value, date or outstanding-share basis.")
        return result
    # A second unqualified capitalization cannot be reconciled merely because one source is certified.
    unverified_caps = [item for item in unique if item.get("value") is not None and not _certified(item)]
    if unverified_caps:
        result["reason"] = "Market-cap observations include an unverified currency, unit, date or share basis."
        return result
    result.update(
        status="available", value=_number(first["value"]), reason=None, source=first["source"],
        currency="VND", unit="VND", as_of=_day(first["as_of"]), share_basis="outstanding",
        shares_as_of=_day(first["shares_as_of"]), shares_unit="shares", shares_source=first["shares_source"],
    )
    return result


def reconcile_market_caps(*results: dict[str, Any]) -> dict[str, Any]:
    combined = _result([item for result in results for item in result.get("observations", [])])
    if any(result.get("status") == "conflict" for result in results):
        combined.update(status="conflict", value=None, reason="Market-cap observations conflict; no value is admitted.")
    return combined


def resolve_market_cap(
    record: Any, *, source: str, price_record: Any = None, shares_record: Any = None,
) -> dict[str, Any]:
    row = _record(record)
    shares = _record(shares_record) if shares_record is not None else row
    shares_conflict = resolve_screener_shares(row, source=source)["status"] == "conflict" or (
        shares_record is not None and resolve_screener_shares(shares, source=source)["status"] == "conflict"
    )

    def with_share_conflict(result: dict[str, Any]) -> dict[str, Any]:
        if shares_conflict:
            result.update(status="conflict", value=None, reason="Outstanding-share observations conflict; no capitalization is admitted.")
        return result
    existing = row.get("market_cap_provenance")
    raw_value = _number(_first_value(row, "market_cap", "marketCap"))
    stored_result = None
    if isinstance(existing, dict) and isinstance(existing.get("observations"), list):
        observations = [dict(item) for item in existing["observations"] if isinstance(item, dict)]
        stored_result = _result(observations)
        declared_value = _number(existing.get("value"))
        admitted_value = _number(stored_result.get("value"))
        if existing.get("status") == "conflict" or (
            declared_value is not None and admitted_value is not None and declared_value != admitted_value
        ) or (raw_value is not None and declared_value is not None and raw_value != declared_value):
            stored_result.update(status="conflict", value=None, reason="Stored market-cap value and provenance conflict.")
        if raw_value is not None and not any(_number(item.get("value")) == raw_value for item in observations):
            observations.append({"value": raw_value, "source": source, "source_confirmed": False})
            stored_result.update(status="conflict", value=None, reason="Stored market-cap value lacks matching provenance.")
        if price_record is None and shares_record is None:
            return with_share_conflict(reconcile_market_caps(stored_result, _result(observations)))
    else:
        observations = []
        if raw_value is not None:
            observations.append({
                "value": raw_value, "source": row.get("market_cap_source") or source,
                "source_confirmed": bool(row.get("market_cap_source")),
                "unit": row.get("market_cap_unit"), "currency": row.get("market_cap_currency"),
                "as_of": _day(row.get("market_cap_as_of")), **_share_fields(row), "shares_conflict": shares_conflict,
                "price": None, "price_unit": None, "price_as_of": None,
                "price_source": None, "calculation": None,
            })
    price = _record(price_record) if price_record is not None else row
    price_value = _number(_first_value(price, "price", "close"))
    share_fields = _share_fields(shares)
    if price_value is not None or (not observations and share_fields["shares"] is not None):
        price_date = _day(price.get("price_as_of") or price.get("as_of") or price.get("trade_date") or price.get("time"))
        candidate = {
            "value": None, "source": f"derived:{source}", "source_confirmed": True,
            "unit": "VND" if price.get("price_unit") == "VND" else None,
            "currency": "VND" if price.get("price_unit") == "VND" else None,
            "as_of": price_date, **share_fields, "shares_conflict": shares_conflict,
            "price": price_value, "price_unit": price.get("price_unit"),
            "price_as_of": price_date, "price_source": price.get("price_source") or price.get("upstream_source"),
            "calculation": "price * outstanding_shares",
        }
        if price_value is not None and share_fields["shares"] is not None:
            computed = price_value * share_fields["shares"]
            candidate["value"] = computed if math.isfinite(computed) else None
            if not _certified(candidate) and not shares_conflict:
                candidate["value"] = None
        observations.append(candidate)
    resolved = _result(observations)
    return with_share_conflict(reconcile_market_caps(stored_result, resolved) if stored_result is not None else resolved)
