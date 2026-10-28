"""Admission and evidence for screener outstanding-share counts."""

import math
from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo


def _number(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return number if math.isfinite(number) else None


def _date(value: Any) -> str | None:
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).date().isoformat()
        except ValueError:
            pass
    return None


def resolve_screener_shares(record: dict[str, Any], *, source: str) -> dict[str, Any]:
    """Keep each value with its own evidence; never infer a unit or source."""
    raw_aliases = [(key, record[key]) for key in (
        "shares_outstanding", "outstanding_shares", "sharesOutstanding", "issue_share", "financial_ratio_issue_share"
    ) if record.get(key) is not None and not (
        isinstance(record[key], float) and math.isnan(record[key])
    ) and not (isinstance(record[key], str) and record[key].strip().lower() in {"", "nan", "none", "null"})]
    raw_values = [value for _, value in raw_aliases]
    raw = raw_values[0] if raw_values else None
    conflicting_values = len({_number(value) if _number(value) is not None else str(value) for value in raw_values}) > 1
    existing = record.get("shares_outstanding_provenance")
    observations = [dict(item) for item in existing.get("observations", []) if isinstance(item, dict)] if isinstance(existing, dict) and isinstance(existing.get("observations"), list) else []
    if raw is not None:
        raw = _number(raw) if _number(raw) is not None else str(raw)
    if conflicting_values:
        for key, original in raw_aliases:
            value = _number(original) if _number(original) is not None else str(original)
            observation = {
                "value": value, "raw_value": original, "alias": key,
                "unit": record.get("shares_unit") or record.get("outstanding_shares_unit"),
                "as_of": _date(record.get("shares_as_of") or record.get("outstanding_shares_as_of")),
                "source": record.get("shares_source") or record.get("outstanding_shares_source"),
                "share_basis": record.get("share_basis"), "record_source": source,
            }
            if observation not in observations:
                observations.append(observation)
    elif raw is not None and not any(item.get("value") == raw for item in observations):
        observations.append({
            "value": raw, "unit": record.get("shares_unit") or record.get("outstanding_shares_unit"),
            "as_of": _date(record.get("shares_as_of") or record.get("outstanding_shares_as_of")),
            "source": record.get("shares_source") or record.get("outstanding_shares_source"),
            "share_basis": record.get("share_basis"), "record_source": source,
        })
    today = datetime.now(ZoneInfo("Asia/Ho_Chi_Minh")).date().isoformat()
    admitted = [item for item in observations if (
        _number(item.get("value")) is not None and _number(item.get("value")) > 0
        and item.get("unit") == "shares" and item.get("share_basis") == "outstanding"
        and isinstance(item.get("source"), str) and item["source"].strip()
        and _date(item.get("as_of")) is not None and _date(item.get("as_of")) <= today
    )]
    # A stored numerical value must be certified by its own matching observation.
    if raw is not None:
        raw_number = _number(raw)
        admitted = [item for item in admitted if raw_number is not None and _number(item.get("value")) == raw_number]
        if conflicting_values:
            admitted = []
        metadata = {
            "unit": record.get("shares_unit") or record.get("outstanding_shares_unit"),
            "source": record.get("shares_source") or record.get("outstanding_shares_source"),
            "as_of": _date(record.get("shares_as_of") or record.get("outstanding_shares_as_of")),
            "share_basis": record.get("share_basis"),
        }
        admitted = [item for item in admitted if all(
            value is None or item.get(key) == value for key, value in metadata.items()
        )]
    elif isinstance(existing, dict):
        if existing.get("status") != "available" or existing.get("value") is None:
            admitted = []
        else:
            admitted = [item for item in admitted if _number(item.get("value")) == _number(existing["value"])]
    values = {_number(item["value"]) for item in admitted}
    conflict = conflicting_values or (isinstance(existing, dict) and existing.get("status") == "conflict") or len(values) > 1
    selected = admitted[0] if not conflict and len(values) == 1 else None
    return {
        "status": "conflict" if conflict else "available" if selected else "unavailable",
        "value": _number(selected["value"]) if selected else None,
        "unit": "shares" if selected else None,
        "source": selected["source"] if selected else None,
        "as_of": _date(selected["as_of"]) if selected else None,
        "share_basis": "outstanding" if selected else None,
        "observations": observations,
    }
