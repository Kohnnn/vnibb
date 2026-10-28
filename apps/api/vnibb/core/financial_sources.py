"""
Admitted financial source identities for statement and ratio rows.

The SQL statement writers stamp each row with `source`. Readers previously
restricted financial collections to the IQ primary (`vietcap`) and the free VCI
secondary. Recovery from reviewed issuer reports needs one explicit, evidence-
validated identity that readers can admit without relabelling it as an IQ
observation.

`issuer_report` is only admitted when the row carries retained document
evidence (see `issuer_evidence_admitted`). Rows with that source but no
evidence stay withheld.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

PRIMARY_FINANCIAL_SOURCES: tuple[str, ...] = ("vietcap",)
SECONDARY_FINANCIAL_SOURCES: tuple[str, ...] = ("VCI",)
ISSUER_SOURCE = "issuer_report"

# Order matters: readers pick the first source that has rows.
ADMITTED_FINANCIAL_SOURCES: tuple[str, ...] = (
    *PRIMARY_FINANCIAL_SOURCES,
    *SECONDARY_FINANCIAL_SOURCES,
    ISSUER_SOURCE,
)

MIN_EVIDENCE_FIELDS = ("document_sha256", "page", "currency", "value_unit")


def issuer_evidence_admitted(raw_data: object) -> bool:
    """True when an issuer-sourced row carries retained document evidence."""
    if not isinstance(raw_data, Mapping):
        return False
    lineage = raw_data.get("_financial_lineage")
    if not isinstance(lineage, Mapping):
        return False
    evidence = lineage.get("issuer_evidence")
    if not isinstance(evidence, Mapping):
        return False
    if evidence.get("unavailable_reason"):
        return False
    return all(evidence.get(field) not in (None, "") for field in MIN_EVIDENCE_FIELDS)


def row_source_admitted(source: Any, raw_data: object = None) -> bool:
    if source not in ADMITTED_FINANCIAL_SOURCES:
        return False
    if source == ISSUER_SOURCE:
        return issuer_evidence_admitted(raw_data)
    return True
