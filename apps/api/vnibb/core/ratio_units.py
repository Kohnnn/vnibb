"""Canonical percent cells require explicit provider unit evidence."""

import math
import re
from collections.abc import Mapping
from typing import Any

PERCENT_RATIO_FIELDS = frozenset({
    "roe", "roa", "roic", "gross_margin", "net_margin", "operating_margin",
    "revenue_growth", "earnings_growth", "debt_assets", "dividend_yield", "payout_ratio",
})
_ALIASES = {
    "roe": {"roe"}, "roa": {"roa"}, "roic": {"roic"},
    "gross_margin": {"gross_margin", "gross_profit_margin", "grossmargin", "grossprofitmargin"},
    "net_margin": {"net_margin", "net_profit_margin", "netmargin", "posttaxmargin", "after_tax_profit_margin"},
    "operating_margin": {"operating_margin", "operatingmargin", "opmargin", "ebit_margin"},
    "revenue_growth": {"revenue_growth", "revenuegrowth"},
    "earnings_growth": {"earnings_growth", "earningsgrowth", "net_profit_growth", "netprofitgrowth"},
    "debt_assets": {"debt_assets", "debt_to_assets", "debt_to_asset", "debt_on_assets", "debt_on_asset", "debtonassets", "debtonasset", "debtassets", "debttoassets", "debttoasset"},
    "dividend_yield": {"dividend_yield", "dividendyield", "dividend"},
    "payout_ratio": {"payout_ratio", "payoutratio", "dividend_payout_ratio", "dividendpayoutratio", "dividend_payout", "dividendpayout"},
}

FRACTION_RATIO_FIELDS = frozenset({"ocf_sales", "fcf_yield"})

def admitted_ratio_value(
    value: Any, metric: str, *, ratio_units: Mapping[str, Any] | None = None,
    source: str | None = "vnstock",
) -> Any:
    if metric in PERCENT_RATIO_FIELDS and (ratio_units or {}).get(metric) != "percent":
        return None
    return value


def declared_ratio_value(
    value: Any, metric: str, *, ratio_units: Mapping[str, Any] | None = None,
) -> Any:
    """Admit a percent cell only through its declared unit, converting fractions once.

    `percent` passes through, `fraction` is scaled to canonical percent, and a
    missing, `unknown` or `conflict` declaration is withheld rather than assumed.
    """
    if metric not in PERCENT_RATIO_FIELDS and metric not in FRACTION_RATIO_FIELDS:
        return value
    unit = (ratio_units or {}).get(metric)
    if unit == "percent":
        return value
    if unit == "fraction" and value is not None:
        try:
            return float(value) * 100
        except (TypeError, ValueError):
            return None
    return None


ADMITTED_RATIO_FIELDS = PERCENT_RATIO_FIELDS | FRACTION_RATIO_FIELDS


def admit_ratio_units(item: Any, fields: frozenset[str] = ADMITTED_RATIO_FIELDS) -> Any:
    """Admit every declared ratio cell once and stamp the canonical unit.

    Idempotent: an admitted cell is stamped `percent`, so a second pass is a
    no-op. That lets every publication point call this without knowing whether
    an earlier one already ran, which is why no row can be scaled twice.
    """
    units = getattr(item, "ratio_units", None)
    units = {} if units is None else dict(units)
    for metric in fields:
        declared = units.get(metric)
        if declared == "percent":
            continue
        if declared == "fraction" and getattr(item, metric, None) is not None:
            admitted = declared_ratio_value(
                getattr(item, metric, None), metric, ratio_units=units,
            )
            setattr(item, metric, admitted)
            # A failed conversion keeps the declaration visible as `unknown`.
            units[metric] = "unknown" if admitted is None else "percent"
            continue
        # No declaration means no unit evidence: withhold the value without
        # inventing a `ratio_units` entry, because merge treats a present key
        # as "this source has evidence" and would resurrect the cell.
        setattr(item, metric, None)
        if declared is not None:
            units[metric] = "unknown"
    item.ratio_units = units
    return item



def _identity(key: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(key).lower()).strip("_")


def _declared_unit(key: Any, unit: Any) -> str:
    text = str(unit or "").strip().lower()
    label = str(key).lower()
    percent_label = "%" in label or bool(re.search(r"(?:percent|pct)(?:\W|$)", label))
    if text in {"fraction", "decimal"}:
        return "conflict" if percent_label else "fraction"
    if text in {"%", "percent", "percentage", "pct"}:
        return "percent"
    if percent_label:
        return "percent" if not text else "conflict"
    return "unknown"


def _field_unit(unit: Any) -> str:
    """Classify a declared unit for an id-resolved percent field.

    Only an explicit percentage is admitted for a percent field; a ratio label
    such as `lần`/`times` contradicts it and withholds the value.
    """
    text = str(unit or "").strip().lower()
    if text in {"%", "percent", "percentage", "pct"}:
        return "percent"
    if text in {"fraction", "decimal"}:
        return "fraction"
    return "conflict" if text else "unknown"


def normalize_ratio_payload(
    payload: Mapping[str, Any],
    evidence: list[dict],
    period: str | None = None,
    period_keys: list[Any] | None = None,
    field_ids: Mapping[str, str] | None = None,
) -> dict:
    """Admit ratio cells and stamp canonical units.

    `field_ids` maps a canonical field name to the provider id that was already
    resolved for it (e.g. `{"roe": "RT_PRT_ROE"}`). When present the stable
    provider id, not a localized `name`, is the identity: a row whose id matches
    is admitted for that field, and only unit compatibility is checked. A unit
    that contradicts the field's expected type still withholds the value.
    """
    normalized = dict(payload)
    units = {}
    for metric in PERCENT_RATIO_FIELDS:
        candidates = []
        field_id = _identity(field_ids.get(metric)) if field_ids and field_ids.get(metric) else None
        for row in evidence:
            declarations = [row[key] for key in ("unit", "Unit") if key in row] or [None]
            if "item_id" in row:
                cells = [((row["item_id"], row.get("item", ""), row.get("item_en", "")), row.get(key), unit) for key in (period_keys or [period]) for unit in declarations]
            else:
                cells = [(key, value, unit) for key, value in row.items() for unit in declarations]
            for key, value, unit in cells:
                parts = key if isinstance(key, tuple) else (key,)
                identities = {_identity(part) for part in parts}
                identities |= {re.sub(r"_?(percent|pct)$", "", identity) for identity in identities}
                if value is None:
                    continue
                if field_id is not None:
                    # The stable provider id decides the field; the localized
                    # name is evidence only and never gates admission.
                    if field_id not in identities:
                        continue
                elif not identities.intersection(_ALIASES[metric]):
                    continue
                try:
                    numeric = float(value)
                except (TypeError, ValueError):
                    continue
                if math.isfinite(numeric):
                    declared = _declared_unit(key, unit)
                    if field_id is not None:
                        # The id selects the field; the explicit unit string
                        # governs the type, with the label used only when the
                        # row carries no unit of its own.
                        explicit = _field_unit(unit)
                        declared = explicit if explicit != "unknown" else _declared_unit(key, None)
                    candidates.append((numeric, declared))
        if metric == "dividend_yield" and not candidates and payload.get(metric) is None:
            normalized[metric] = None
            continue
        canonical = [value * 100 if unit == "fraction" else value
                     for value, unit in candidates if unit in {"fraction", "percent"}]
        conflicted = any(unit not in {"fraction", "percent"} for _, unit in candidates) or any(
            not math.isclose(value, canonical[0], rel_tol=1e-12, abs_tol=1e-12)
            for value in canonical[1:]
        )
        if not canonical or conflicted:
            normalized[metric] = None
            units[metric] = "unknown"
        else:
            normalized[metric] = canonical[0]
            units[metric] = "percent"
    normalized["ratio_units"] = units
    normalized["provider_evidence"] = [
        {(" / ".join(map(str, key)) if isinstance(key, tuple) else str(key)): value for key, value in row.items()}
        for row in evidence
    ]
    return normalized


def ratio_method_kwargs(method: Any, kwargs: dict) -> dict:
    """KBS STD drops per-item Unit; ALL preserves it without a data request."""
    import inspect
    parameters = inspect.signature(method).parameters
    kwargs = dict(kwargs)
    if "display_mode" in parameters or any(parameter.kind == inspect.Parameter.VAR_KEYWORD for parameter in parameters.values()):
        kwargs["display_mode"] = "all"
    return kwargs
