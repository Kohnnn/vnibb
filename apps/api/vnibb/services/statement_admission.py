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
from collections.abc import Mapping, Sequence
from typing import Any

from vnibb.services.financial_service import (
    _monetary_evidence_admitted,
    normalize_statement_period,
)

# Canonical metric -> raw provider aliases. Only the spellings the persisted
# rows and the premium-record corpus actually use; a spelling outside this table
# is not evidence of the metric. The statement readers and `fundamental_valuation`
# resolve one metric through this table, so admission and derivation agree.
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
        "net_cash_inflows_outflows_from_operating_activities",
        "lưu chuyển tiền thuần từ hoạt động kinh doanh",
    ),
    "capex": (
        "capex", "capital_expenditure", "capitalExpenditure",
        "payment_for_fixed_assets_and_other_long_term_assets",
        "purchase_of_fixed_assets", "purchases_of_fixed_assets",
        "payment_for_fixed_assets_constructions_and_other_long_term_assets",
    ),
    "total_assets": ("total_assets", "totalAssets", "total_asset", "asset"),
    "equity": (
        "equity", "total_equity", "owners_equity", "shareholders_equity",
        "owner_equity", "b_owners_equity", "viii_capital_and_funds",
    ),
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


_CROSS_STATEMENT_KEYS = ("currency", "value_unit", "consolidation_basis", "source")


def cross_statement_basis(rows: Sequence[Any]) -> tuple[dict[str, Any] | None, str | None]:
    """The shared basis of one period's income/cash-flow/balance rows.

    Combining statements is only arithmetic on one reporting basis. Rows that
    disagree on currency, scale, consolidation or source cannot be mixed, and
    the balance sheet's instantaneous basis is not compared to a flow basis.
    An absent or `unknown` declaration is not equality: two unknowns are not
    evidence of a shared basis.

    Source equality is the only identity evidence persisted rows expose, so a
    match here confirms the source, not a report revision.
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
    if period_kind not in {"single_quarter", "cumulative_ytd"}:
        return True
    # A cumulative YTD figure is also anchored to a fiscal quarter: Q3-2025
    # cumulative is not comparable with Q2-2024 cumulative.
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


def _normalized_key(key: Any) -> str:
    """One comparison form for a persisted key (`Purchase Of X` == `purchase_of_x`)."""
    return str(key).strip().lower().replace(" ", "_")


def _pick_alias(row: Mapping[str, Any], aliases: Sequence[str]) -> tuple[Any, Any]:
    """The first alias that names a non-null value, with the row's actual key.

    Persisted premium records keep their provider spelling, so a metric may be
    stored as `Revenue` or `Purchase_Of_Fixed_Assets`. The actual key is
    returned because the scale and unit evidence are keyed by it.
    """
    index: dict[str, Any] = {}
    for key in row:
        index.setdefault(_normalized_key(key), key)
    for alias in aliases:
        actual = index.get(_normalized_key(alias))
        if actual is not None and row.get(actual) is not None:
            return actual, row.get(actual)
    return None, None


def _evidence_entry(evidence: Any, names: set[str]) -> Mapping[str, Any] | None:
    """The evidence entry for any spelling of a metric in `names`."""
    if not isinstance(evidence, Mapping):
        return None
    wanted = {_normalized_key(name) for name in names}
    for key, entry in evidence.items():
        if isinstance(entry, Mapping) and _normalized_key(key) in wanted:
            return entry
    return None


def _declared_scale(row: Mapping[str, Any], alias: Any) -> tuple[float | None, Any]:
    units = row.get("units")
    declared = None
    if isinstance(units, Mapping):
        for key, unit in units.items():
            if _normalized_key(key) == _normalized_key(alias):
                declared = unit
                break
    for key in ("currency_unit", "unit", "_value_unit", "value_unit"):
        if declared is not None:
            break
        declared = row.get(key)
    if declared is None:
        return None, None
    return _DECLARED_SCALES.get(_normalized_key(declared).replace("_", " ")), declared


def _names_vnd(declared: Any) -> bool:
    label = str(declared).strip().lower().replace("_", " ")
    return any(token in label for token in ("vnd", "vnđ", "đồng", "dong"))


def _valuation_lineage_scale(row: Mapping[str, Any], alias: Any) -> float | None:
    lineage = row.get("_valuation_unit_lineage")
    if not isinstance(lineage, Mapping):
        return None
    evidence = _evidence_entry(lineage, {str(alias)})
    scale = (evidence or {}).get("scaleToVnd")
    return float(scale) if isinstance(scale, (int, float)) else None


def admit_valuation_field(
    row: Mapping[str, Any],
    field: str,
    *,
    declared_statement_unit: str | None = None,
) -> tuple[float | None, str | None]:
    """Admit one raw annual valuation-row field as VND.

    `declared_statement_unit` is the statement's own declared unit: when the
    row carries no per-field scale, a caller that already admitted the whole
    statement as VND may supply it instead of withholding the field.

    Reasons: `missing`, `blank`, `nonfinite`, `rejected:<reason>`,
    `declared_scale_unknown`, `unknown_currency`.
    """
    if not isinstance(row, Mapping):
        return None, "missing"
    # Keys keep their provider spelling, so a metric is matched case- and
    # space-insensitively and the row's actual key carries its unit evidence.
    alias, raw_value = _pick_alias(row, FIELD_ALIASES.get(field, (field,)))
    if alias is None:
        return None, "missing"
    if isinstance(raw_value, str) and not raw_value.strip():
        return None, "blank"
    value = _number(raw_value)
    if value is None:
        return None, "nonfinite"

    # One rejection, under any spelling of the metric and in any evidence
    # location, keeps the field out: an alias must never re-enter a metric the
    # unit admission withheld.
    names = {field, alias, *(name for name in FIELD_ALIASES.get(field, ()))}
    raw_data = row.get("raw_data") if isinstance(row.get("raw_data"), Mapping) else {}
    lineage_block = raw_data.get("_financial_lineage")
    if not isinstance(lineage_block, Mapping):
        lineage_block = row.get("_financial_lineage")
    lineage_block = lineage_block if isinstance(lineage_block, Mapping) else {}
    canonical = lineage_block.get("canonical_data")
    wanted = {_normalized_key(name) for name in names}
    for evidence in (
        row.get("unit_metadata") or {},
        canonical.get("unit_metadata") if isinstance(canonical, Mapping) else {},
        lineage_block.get("unit_metadata") or {},
    ):
        if not isinstance(evidence, Mapping):
            continue
        # Every matching entry is scanned, not the first: an accepted canonical
        # spelling must not hide a rejection recorded under another alias.
        for key, entry in evidence.items():
            if not isinstance(entry, Mapping):
                continue
            if _normalized_key(key) not in wanted:
                continue
            if entry.get("unavailable_reason"):
                return None, f"rejected:{entry['unavailable_reason']}"

    normalized_scale = _valuation_lineage_scale(row, alias)
    if normalized_scale is not None:
        # Already normalized by the valuation loader; scaling again would be a
        # 10^3-10^9 error.
        return value, None
    scale, declared = _declared_scale(row, alias)
    if scale is None:
        vnd_labelled = declared is None or _names_vnd(declared)
        # The statement-level declaration only stands in for a *VND* scale gap.
        # A field that names another currency is still not VND and is withheld.
        if declared_statement_unit == "VND" and vnd_labelled:
            return value, None
        return None, "declared_scale_unknown" if vnd_labelled else "unknown_currency"
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
    if any(right[0] != left[0] + 1 for left, right in zip(window, window[1:], strict=False)):
        return None, f"non_consecutive_annual_periods_for_{field}"
    values: list[float] = []
    for year, row in window:
        value, reason = admit_valuation_field(row, field)
        if reason:
            return None, f"{reason}_for_{field}_{year}"
        values.append(float(value))
    return values, None


# --------------------------------------------------------------------------
# Persisted-row reading: the one path every column reader shares.
# --------------------------------------------------------------------------

# Model field -> SQL column for the financial fields whose names differ. The
# MCP reader applies the same mapping, so both readers resolve one column.
STATEMENT_SQL_COLUMNS: dict[str, str] = {
    "pre_tax_profit": "income_before_tax",
    "profit_before_tax": "income_before_tax",
    "tax_expense": "income_tax",
    "long_term_liabilities": "non_current_liabilities",
}

# A semantic alias names the same metric, so one decision covers every spelling.
STATEMENT_CANONICAL_ALIASES: dict[str, str] = {
    "profit_before_tax": "pre_tax_profit", "pre_tax_profit": "profit_before_tax",
    "cash": "cash_and_equivalents", "cash_and_equivalents": "cash",
    "equity": "total_equity", "total_equity": "equity",
    "net_cash_flow": "net_change_in_cash", "net_change_in_cash": "net_cash_flow",
    "capital_expenditure": "capex", "capex": "capital_expenditure",
}

# Metrics whose admitted unit is per-share, not VND.
PER_SHARE_FIELDS = frozenset({"eps", "eps_diluted", "book_value_per_share"})


def statement_identity(item: Any) -> tuple[str, int, int]:
    """Normalized (period, fiscal year, fiscal quarter) of a statement row."""
    period_text = normalize_statement_period(
        _value(item, "period") or "",
        fiscal_year=_value(item, "fiscal_year"),
        fiscal_quarter=_value(item, "fiscal_quarter"),
    ) or str(_value(item, "period") or "")
    year_match = re.search(r"(20\d{2})", period_text.upper())
    quarter_match = re.search(r"Q([1-4])", period_text.upper())
    fiscal_year = _value(item, "fiscal_year")
    fiscal_quarter = _value(item, "fiscal_quarter")
    return (
        period_text,
        int(fiscal_year or (int(year_match.group(1)) if year_match else 0)),
        int(fiscal_quarter or (int(quarter_match.group(1)) if quarter_match else 0)),
    )


def stored_row_statement(row: Any, statement_type: str) -> Any:
    """One persisted ORM row as a statement record, columns only.

    This is a projection, not an admission: the result still carries the row's
    raw lineage untouched so the shared restoration can decide what it backs.
    """
    from vnibb.providers.vnstock.financials import FinancialStatementData

    payload: dict[str, Any] = {
        "symbol": row.symbol,
        "period": row.period,
        "statement_type": statement_type,
        "fiscal_year": row.fiscal_year,
        "fiscal_quarter": row.fiscal_quarter,
    }
    for name in FinancialStatementData.model_fields:
        if name in payload or name == "raw_data":
            continue
        column = STATEMENT_SQL_COLUMNS.get(name, name)
        value = getattr(row, column, None)
        # Only a persisted number is a projection of a column; an absent column
        # stays unstated so the model default applies.
        if value is not None:
            payload[name] = value
    # Aliased spellings that have no column of their own read their target.
    for alias, target in STATEMENT_CANONICAL_ALIASES.items():
        if alias in payload:
            continue
        column = STATEMENT_SQL_COLUMNS.get(target, target)
        value = getattr(row, column, None)
        if value is not None:
            payload[alias] = value
    payload["raw_data"] = getattr(row, "raw_data", None)
    return FinancialStatementData(**payload)


def restore_lineage_statement(row: Any, raw: dict[str, Any], restored: Any) -> Any:
    """Serve a stored row from its `canonical_data` while the two agree.

    A sync can leave a canonical that no longer describes the row the upsert
    kept. Restoring such a canonical would serve a value its lineage does not
    back, and copying the stored column over it while keeping the canonical's
    provenance certifies it anyway. Only the disagreeing metrics are withheld,
    each with its own unavailable reason, so the rest of the statement stays
    readable.
    """
    from vnibb.providers.vnstock.financials import FinancialStatementData

    unavailable = dict(restored.unit_metadata)
    cleared: dict[str, Any] = {}
    withheld: dict[str, Any] = {}
    seen: set[str] = set()
    for name in FinancialStatementData.model_fields:
        if name in seen or name in {"fiscal_year", "fiscal_quarter"}:
            continue
        family = {name, *(alias for alias, target in STATEMENT_CANONICAL_ALIASES.items()
                          if target == name)}
        seen |= family
        # The SQL column may be named for any spelling in the family (`capex`
        # has no column; `capital_expenditure` does).
        column = next((STATEMENT_SQL_COLUMNS.get(field, field) for field in sorted(family)
                       if hasattr(row, STATEMENT_SQL_COLUMNS.get(field, field))
                       and isinstance(getattr(row, STATEMENT_SQL_COLUMNS.get(field, field)), (int, float))),
                      STATEMENT_SQL_COLUMNS.get(name, name))
        stored_value = getattr(row, column, None)
        if not isinstance(stored_value, (int, float)):
            # No stored value: the canonical is the only copy and is served as
            # it is, which is what enriches a row that predates a metric.
            continue
        stated_fields = [field for field in family if field in restored.model_fields_set]
        stated = sorted({value for field in stated_fields
                         if isinstance(value := getattr(restored, field, None), (int, float))})
        # Only a field the canonical actually states can disagree. The sync dumps
        # every field, but a partial canonical may omit a metric entirely; that
        # says nothing about the column, so the stored value is served as it is.
        # A stated null is an explicit no-value and disagrees; an omitted metric
        # says nothing and leaves the stored observation served.
        disagrees = stated != [stored_value] if stated_fields else False
        if disagrees:
            for field in family:
                cleared[field] = None
                unavailable[field] = {
                    **unavailable.get(field, {}),
                    "unavailable_reason": "stored_statement_disagrees_with_lineage",
                }
            withheld[column] = stored_value
        else:
            # Stated-and-agreeing, or omitted: serve the stored observation under
            # every spelling the canonical may be read by.
            for field in family:
                cleared[field] = stored_value
    if cleared:
        restored = restored.model_copy(update={**cleared, "unit_metadata": unavailable})
    # The withheld column value is still a real stored observation; disclose it
    # rather than dropping it from the response.
    restored.raw_data = {**raw, **({"withheld_observations": withheld} if withheld else {})}
    return restored


def admit_persisted_statement(
    row: Any, statement_type: str, period: str,
) -> Any:
    """One stored ORM row through the loader's own restoration + admission.

    Column readers (growth, earnings quality) call this instead of trusting a
    populated lineage dictionary: the canonical copy is restored and reconciled
    against the stored column, the fiscal identity is checked, and the row goes
    through `admit_statement_rows`. Whatever the statement endpoint would
    withhold, these readers therefore cannot publish.
    """
    from vnibb.services.financial_service import admit_statement_rows

    statement = stored_row_statement(row, statement_type)
    raw = statement.raw_data if isinstance(statement.raw_data, Mapping) else {}
    lineage = raw.get("_financial_lineage") or {}
    canonical = lineage.get("canonical_data") if isinstance(lineage, Mapping) else None
    if isinstance(canonical, Mapping):
        from vnibb.providers.vnstock.financials import FinancialStatementData

        restored = FinancialStatementData.model_validate(canonical)
        if statement_identity(statement) != statement_identity(restored):
            restored = admit_statement_rows([restored.model_copy(update={
                "period": statement.period,
                "fiscal_year": restored.fiscal_year,
                "fiscal_quarter": restored.fiscal_quarter,
            })], period)[0]
            restored.unavailable_reason = "conflicting_fiscal_identity"
            for name in FinancialStatementData.model_fields:
                if name not in {"fiscal_year", "fiscal_quarter"} and isinstance(getattr(restored, name, None), (int, float)):
                    setattr(restored, name, None)
        statement = restore_lineage_statement(row, raw, restored)
    else:
        statement.source = getattr(row, "source", None)
        # No accepted lineage: the row's basis is unconfirmed, so `currency` and
        # `value_unit` stay unset here. This annotation is the row's contract.
        statement.unit_metadata = {"basis": {"unavailable_reason": "legacy_unit_basis_unconfirmed"}}
    statement.updated_at = getattr(row, "updated_at", None)
    return admit_statement_rows([statement], period)[0]
