"""Canonical percent cells require explicit provider unit evidence."""

import math
import re
from collections.abc import Mapping
from typing import Any

PERCENT_RATIO_FIELDS = frozenset({
    "roe", "roa", "roic", "gross_margin", "net_margin", "operating_margin",
    "revenue_growth", "earnings_growth", "debt_assets",
})
_ALIASES = {
    "roe": {"roe"}, "roa": {"roa"}, "roic": {"roic"},
    "gross_margin": {"gross_margin", "gross_profit_margin", "grossmargin", "grossprofitmargin"},
    "net_margin": {"net_margin", "net_profit_margin", "netmargin", "posttaxmargin", "after_tax_profit_margin"},
    "operating_margin": {"operating_margin", "operatingmargin", "opmargin", "ebit_margin"},
    "revenue_growth": {"revenue_growth", "revenuegrowth"},
    "earnings_growth": {"earnings_growth", "earningsgrowth", "net_profit_growth", "netprofitgrowth"},
    "debt_assets": {"debt_assets", "debt_to_assets", "debt_to_asset", "debt_on_assets", "debt_on_asset", "debtonassets", "debtonasset", "debtassets", "debttoassets", "debttoasset"},
}

def admitted_ratio_value(
    value: Any, metric: str, *, ratio_units: Mapping[str, Any] | None = None,
    source: str | None = "vnstock",
) -> Any:
    if metric in PERCENT_RATIO_FIELDS and (
        (ratio_units and ratio_units.get(metric) != "percent")
        or (not ratio_units and source == "vnstock")
    ):
        return None
    return value



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


def normalize_ratio_payload(payload: Mapping[str, Any], evidence: list[dict], period: str | None = None, period_keys: list[Any] | None = None) -> dict:
    normalized = dict(payload)
    units = {}
    for metric in PERCENT_RATIO_FIELDS:
        candidates = []
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
                if value is None or not identities.intersection(_ALIASES[metric]):
                    continue
                try:
                    numeric = float(value)
                except (TypeError, ValueError):
                    continue
                if math.isfinite(numeric):
                    candidates.append((numeric, _declared_unit(key, unit)))
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
