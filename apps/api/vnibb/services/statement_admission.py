"""Field- and comparison-level admission for persisted financial statements.

The statement endpoints serve typed, lineage-backed rows through
`financial_service.admit_statement_rows`. Consumers that read statement
*columns* directly (growth, earnings quality, valuation) could bypass that
gate: a populated lineage dictionary certified two unknown bases as
"confirmed", and a raw provider alias could republish a field the unit
admission had explicitly withheld (issues #245/#246/#257).

This module is the single admission primitive for those consumers. It answers
one question per field — is this number usable as a VND figure on a known
fiscal/unit/basis identity? — and one per comparison — are these two figures
comparable at all? It never guesses a currency, a scale or a sign from the
magnitude, never promotes raw evidence, and keeps reported zero, missing and
rejected distinct.

No router import lives here: `equity`, `quant` and the valuation loader may
import it directly.
"""

from __future__ import annotations

import math
import re
from typing import Any, Mapping, Sequence

from vnibb.services.financial_service import (
    _monetary_evidence_admitted,
    normalize_statement_period,
)

# Canonical metric -> raw provider aliases. Only the spellings the persisted
# rows and the premium-record corpus actually use; a spelling outside this table
# is not evidence of the metric.
FIELD_ALIASES: dict[str, tuple[str, ...]] = {
    "revenue": (
        "revenue", "netRevenue", "net_revenue", "net_sales",
        "total_operating_revenue", "total_operating_income", "net_interest_income",
    ),
    "net_income": (
        "net_income", "netIncome", "postTaxProfit", "post_tax_profit",
        "net_profit_after_tax", "share_holder_income", "profit_after_tax",
    ),
    "operating_cash_flow": (
        "operating_cash_flow", "operatingCashFlow", "fromOperating",
        "net_cash_flows_from_operating_activities", "cash_from_operations",
    ),
    "capex": (
        "capex", "capital_expenditure", "capitalExpenditure",
        "payment_for_fixed_assets_and_other_long_term_assets",
    ),
    "total_assets": ("total_assets", "totalAssets", "total_asset", "asset"),
    "eps": ("eps", "earningPerShare", "earningsPerShare", "basicEps"),
    "ebitda": ("ebitda", "EBITDA"),
}

# Declared unit labels -> VND multiplier. Only an explicit declaration scales a
# value; magnitude is never used as a hint.
_DECLARED_SCALES = {
    "vnd": 1.0, "vnd/share": 1.0,
    "thousand vnd": 1_000.0, "nghin vnd": 1_000.0,
    "million vnd": 1_000_000.0, "trieu vnd": 1_000_000.0,
    "billion vnd": 1_000_000_000.0, "bn vnd": 1_000_000_000.0,
    "ty vnd": 1_000_000_000.0,
}

_PER_SHARE_FIELDS = {"eps"}

# Period basis each statement kind must declare before a field may be used.
_FLOW_BASIS_BY_PERIOD = {
    "annual": "annual",
    "single_quarter": "single_quarter",
    "cumulative_ytd": "cumulative_ytd",
    "ttm": "trailing_twelve_months",
}

_BASIS_KEYS = ("currency", "value_unit", "consolidation_basis", "flow_basis")


def _value(row: Any, name: str, default: Any = None) -> Any:
    if isinstance(row, Mapping):
        return row.get(name, default)
    return getattr(row, name, default)


def _number(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def statement_lineage(row: Any) -> dict[str, Any]:
    """The unit/basis lineage persisted beside a statement row, when present."""
    raw = _value(row, "raw_data")
    if not isinstance(raw, Mapping):
        return {}
    lineage = raw.get("_financial_lineage")
    return dict(lineage) if isinstance(lineage, Mapping) else {}


def _field_evidence(row: Any, field: str) -> dict[str, Any] | None:
    """Field evidence from the row, its canonical copy or its lineage."""
    lineage = statement_lineage(row)
    canonical = lineage.get("canonical_data") or {}
    sources = (
        _value(row, "unit_metadata") or {},
        canonical.get("unit_metadata") if isinstance(canonical, Mapping) else {},
        lineage.get("unit_metadata") or {},
    )
    names = (field, *(name for name in FIELD_ALIASES.get(field, ()) if name != field))
    for source in sources:
        if not isinstance(source, Mapping):
            continue
        for name in names:
            if isinstance(source.get(name), Mapping):
                return dict(source[name])
    return None


def rejected_field_reason(row: Any, field: str) -> str | None:
    """The explicit rejection recorded for a field, in any of its spellings."""
    evidence = _field_evidence(row, field)
    reason = (evidence or {}).get("unavailable_reason")
    return str(reason) if reason else None


def basis_of(row: Any, key: str) -> Any:
    """A persisted basis declaration from the row or its lineage."""
    value = _value(row, key)
    return value if value is not None else statement_lineage(row).get(key)


_CROSS_STATEMENT_KEYS = ("currency", "value_unit", "consolidation_basis")


def cross_statement_basis(rows: Sequence[Any]) -> tuple[dict[str, Any] | None, str | None]:
    """The shared basis of one period's income/cash-flow/balance rows.

    Combining statements is only arithmetic on one reporting basis. Rows that
    disagree on currency, scale or consolidation cannot be mixed, and the
    balance sheet's instantaneous basis is not compared to a flow basis.
    """
    if not rows or any(row is None for row in rows):
        return None, "missing_cross_statement_period"
    bases = [{key: basis_of(row, key) for key in _CROSS_STATEMENT_KEYS} for row in rows]
    if any(base != bases[0] for base in bases[1:]):
        return None, "cross_statement_basis_mismatch"
    if any(value in (None, "", "unknown") for value in bases[0].values()):
        return None, "unverified_cross_statement_basis"
    return bases[0], None


def _fiscal_step_ok(current: Any, previous: Any, period_kind: str) -> bool:
    current_year = _value(current, "fiscal_year")
    previous_year = _value(previous, "fiscal_year")
    if not isinstance(current_year, int) or not isinstance(previous_year, int):
        return False
    if current_year != previous_year + 1:
        return False
    if period_kind != "single_quarter":
        return True
    current_quarter = _value(current, "fiscal_quarter")
    return (
        isinstance(current_quarter, int)
        and 1 <= current_quarter <= 4
        and _value(previous, "fiscal_quarter") == current_quarter
    )


def admit_statement_field(
    row: Any,
    field: str,
    *,
    statement_type: str,
    period_kind: str,
) -> tuple[float | None, str | None]:
    """Admit one statement field as a VND (or VND/share) figure.

    `period_kind` is one of `annual`, `single_quarter`, `cumulative_ytd`, `ttm`
    or `instant` (balance-sheet snapshots, which carry no flow basis). Returns
    `(value, None)` only for a value the lineage supports; otherwise
    `(None, reason)` with a machine-readable reason.
    """
    row_reason = _value(row, "unavailable_reason")
    if row_reason:
        return None, f"row_unavailable:{row_reason}"
    rejection = rejected_field_reason(row, field)
    if rejection:
        return None, f"rejected:{rejection}"

    raw_value = _value(row, field)
    if raw_value is None:
        for alias in FIELD_ALIASES.get(field, ()):
            if alias != field:
                raw_value = _value(row, alias)
                if raw_value is not None:
                    break
    if raw_value is None:
        return None, "missing"
    if isinstance(raw_value, str) and not raw_value.strip():
        return None, "blank"
    value = _number(raw_value)
    if value is None:
        return None, "nonfinite"

    lineage = statement_lineage(row)
    if not lineage:
        # No accepted lineage: the row's basis is unconfirmed, exactly as the
        # statement loader reports it.
        return None, "legacy_unit_basis_unconfirmed"
    currency = basis_of(row, "currency")
    value_unit = basis_of(row, "value_unit")
    if currency is None or value_unit is None:
        return None, "legacy_unit_basis_unconfirmed"
    if currency != "VND" or value_unit != "VND":
        return None, "unverified_statement_currency_or_unit"
    consolidation = basis_of(row, "consolidation_basis")
    if str(consolidation or "").lower() not in {"consolidated", "separate"}:
        return None, "unverified_statement_basis"
    expected_flow = _FLOW_BASIS_BY_PERIOD.get(period_kind)
    if expected_flow is not None and basis_of(row, "flow_basis") != expected_flow:
        return None, "incompatible_flow_basis"
    unit = "VND/share" if field in _PER_SHARE_FIELDS else "VND"
    if not _monetary_evidence_admitted(_field_evidence(row, field), unit):
        canonical = lineage.get("canonical_data") or {}
        canonical_evidence = (
            (canonical.get("unit_metadata") or {}).get(field)
            if isinstance(canonical, Mapping) else None
        )
        if not _monetary_evidence_admitted(canonical_evidence, unit):
            return None, "unverified_monetary_unit"
    return value, None


def comparison_detail(
    current: Any,
    previous: Any,
    field: str,
    *,
    statement_type: str,
    period_kind: str,
    require_fiscal_step: bool = True,
) -> dict[str, Any]:
    """Admit two rows for one comparable metric.

    Returns the admitted values, each side's field reason, the shared basis and
    one `unavailable_reason` naming the first fact that makes the pair
    non-comparable. Comparable-but-zero-base handling stays with the caller:
    this only decides whether the two numbers may be put in the same ratio.
    """
    current_value, current_reason = admit_statement_field(
        current, field, statement_type=statement_type, period_kind=period_kind,
    )
    previous_value, previous_reason = admit_statement_field(
        previous, field, statement_type=statement_type, period_kind=period_kind,
    )
    detail: dict[str, Any] = {
        "current": current_value,
        "previous": previous_value,
        "current_reason": current_reason,
        "previous_reason": previous_reason,
        "basis_status": "confirmed",
        "unavailable_reason": None,
        "currency": basis_of(current, "currency"),
        "value_unit": basis_of(current, "value_unit"),
        "consolidation_basis": basis_of(current, "consolidation_basis"),
        "flow_basis": basis_of(current, "flow_basis"),
        "source": _value(current, "source"),
    }
    if current is None or previous is None:
        detail.update(basis_status="unconfirmed", unavailable_reason="missing_comparison_period")
        return detail
    if current_reason or previous_reason:
        # Both sides unknown is not evidence of comparability.
        reason = current_reason or previous_reason
        detail.update(
            basis_status="unconfirmed",
            unavailable_reason=reason if not reason.startswith("rejected:") else "rejected_field",
        )
        detail["field_unavailable_reason"] = reason
        return detail
    if require_fiscal_step and not _fiscal_step_ok(current, previous, period_kind):
        detail.update(basis_status="unconfirmed", unavailable_reason="non_comparable_periods")
        return detail
    current_basis = {key: basis_of(current, key) for key in _BASIS_KEYS}
    previous_basis = {key: basis_of(previous, key) for key in _BASIS_KEYS}
    if (current_basis != previous_basis
            or _value(current, "source") != _value(previous, "source")):
        detail.update(basis_status="incompatible", unavailable_reason="incompatible_reporting_basis")
        return detail
    required = [key for key in _BASIS_KEYS if not (period_kind == "instant" and key == "flow_basis")]
    if any(current_basis[key] in (None, "", "unknown") for key in required):
        detail.update(basis_status="unconfirmed", unavailable_reason="unverified_comparison_basis")
    return detail


# --------------------------------------------------------------------------
# Valuation: raw annual records (no typed statement row exists for these).
# --------------------------------------------------------------------------


def _declared_scale(row: Mapping[str, Any], alias: str) -> tuple[float | None, Any]:
    units = row.get("units")
    declared = units.get(alias) if isinstance(units, Mapping) and alias in units else None
    for key in ("currency_unit", "unit", "_value_unit", "value_unit"):
        if declared is not None:
            break
        declared = row.get(key)
    if declared is None:
        return None, None
    return _DECLARED_SCALES.get(str(declared).strip().lower().replace("_", " ")), declared


def _valuation_lineage_scale(row: Mapping[str, Any], alias: str) -> float | None:
    lineage = row.get("_valuation_unit_lineage")
    if not isinstance(lineage, Mapping):
        return None
    evidence = lineage.get(alias)
    if not isinstance(evidence, Mapping):
        return None
    scale = evidence.get("scaleToVnd")
    return float(scale) if isinstance(scale, (int, float)) else None


def admit_valuation_field(row: Mapping[str, Any], field: str) -> tuple[float | None, str | None]:
    """Admit one raw annual valuation-row field as VND.

    Reasons: `missing`, `blank`, `nonfinite`, `rejected:<reason>`,
    `declared_scale_unknown`, `unknown_currency`.
    """
    if not isinstance(row, Mapping):
        return None, "missing"
    alias = next((name for name in FIELD_ALIASES.get(field, (field,)) if row.get(name) is not None), None)
    if alias is None:
        return None, "missing"
    raw_value = row.get(alias)
    if isinstance(raw_value, str) and not raw_value.strip():
        return None, "blank"
    value = _number(raw_value)
    if value is None:
        return None, "nonfinite"

    lineage = row.get("raw_data") if isinstance(row.get("raw_data"), Mapping) else {}
    for evidence in (
        row.get("unit_metadata") or {},
        ((lineage.get("_financial_lineage") or {}).get("canonical_data") or {}).get("unit_metadata") or {},
        (lineage.get("_financial_lineage") or {}).get("unit_metadata") or {},
    ):
        if isinstance(evidence, Mapping):
            entry = evidence.get(field) or evidence.get(alias)
            if isinstance(entry, Mapping) and entry.get("unavailable_reason"):
                return None, f"rejected:{entry['unavailable_reason']}"

    normalized_scale = _valuation_lineage_scale(row, alias)
    if normalized_scale is not None:
        # Already normalized by the valuation loader; scaling again would be a
        # 10^3-10^9 error.
        return value, None
    scale, declared = _declared_scale(row, alias)
    if scale is None:
        return None, "declared_scale_unknown" if declared is None else "unknown_currency"
    return value * scale, None


def admit_valuation_span(
    rows: Sequence[Mapping[str, Any]], field: str, *, count: int,
) -> tuple[list[float] | None, str | None]:
    """Ascending VND series for the `count` newest consecutive annual rows."""
    if not isinstance(rows, Sequence) or len(rows) < count:
        return None, f"insufficient_annual_periods_for_{field}"
    year_key = ("yearReport", "year_report", "year", "period")
    ordered: list[tuple[int, Mapping[str, Any]]] = []
    for row in rows:
        if not isinstance(row, Mapping):
            continue
        year = next((row.get(key) for key in year_key if row.get(key) is not None), None)
        match = re.search(r"(20\d{2})", str(year)) if year is not None else None
        if not match:
            continue
        ordered.append((int(match.group(1)), row))
    ordered.sort(key=lambda item: item[0])
    window = ordered[-count:]
    if len(window) < count:
        return None, f"insufficient_annual_periods_for_{field}"
    if any(right[0] != left[0] + 1 for left, right in zip(window, window[1:])):
        return None, f"non_consecutive_annual_periods_for_{field}"
    values: list[float] = []
    for year, row in window:
        value, reason = admit_valuation_field(row, field)
        if reason:
            return None, f"{reason}_for_{field}_{year}"
        values.append(float(value))
    return values, None
