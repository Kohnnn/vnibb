"""Offline second-source comparison and cutover gate (#234).

A live dual-read needs two independently authorized acquisitions, which is not
permitted today for any source pair. This module therefore compares *retained*
observations and *published schemas* only: it never fetches, never constructs an
HTTP client, and refuses to call itself a live dual-read. Every difference is
classified, and any unexplained difference blocks cutover by construction.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

#: Sampling roles the report must cover before it can describe the market.
REQUIRED_ROLES: tuple[str, ...] = ("bank", "large_cap", "mid_cap", "illiquid", "index")

#: Difference classes; ``unavailable`` never counts as agreement.
DIFFERENCE_CLASSES: tuple[str, ...] = (
    "unit_scale",
    "session_boundary",
    "adjustment",
    "rounding",
    "disagreement",
    "unavailable",
)

#: Fields compared per observation family.
FAMILY_FIELDS: dict[str, tuple[str, ...]] = {
    "bars": ("open", "high", "low", "close", "volume"),
    "quotes": ("price", "reference", "volume"),
    "listing": ("listing_reference_price", "listed_shares", "exchange"),
    "fundamentals": ("revenue", "net_income", "total_assets", "equity"),
}

_ROUNDING_TOLERANCE = 1e-6


def _side(value: Any, *, unit: str | None, session: str | None, adjustment: str | None) -> dict[str, Any]:
    return {
        "value": value,
        "unit": unit,
        "session": session,
        "adjustment": adjustment,
        "available": value is not None,
    }


def classify(incumbent: Mapping[str, Any], candidate: Mapping[str, Any]) -> dict[str, Any]:
    """Classify one field-level difference between two observations.

    ``unavailable`` is returned whenever either side lacks a value; a missing
    observation is never treated as agreement or as a zero.
    """
    left, right = incumbent.get("value"), candidate.get("value")
    if left is None or right is None:
        missing = [side for side, value in (("incumbent", left), ("candidate", right)) if value is None]
        return {"status": "unavailable", "cause": f"{'+'.join(missing)}_missing", "explained": True}
    if incumbent.get("unit") != candidate.get("unit"):
        return {
            "status": "unit_scale",
            "cause": f"unit {incumbent.get('unit')!r} vs {candidate.get('unit')!r}",
            "explained": False,
        }
    if incumbent.get("session") != candidate.get("session"):
        return {
            "status": "session_boundary",
            "cause": f"session {incumbent.get('session')!r} vs {candidate.get('session')!r}",
            "explained": False,
        }
    if incumbent.get("adjustment") != candidate.get("adjustment"):
        return {
            "status": "adjustment",
            "cause": (
                f"adjustment {incumbent.get('adjustment')!r} vs {candidate.get('adjustment')!r}"
            ),
            "explained": False,
        }
    if isinstance(left, (int, float)) and isinstance(right, (int, float)) and left == right:
        return {"status": "match", "cause": None, "explained": True}
    if (
        isinstance(left, (int, float)) and isinstance(right, (int, float))
        and abs(float(left) - float(right)) <= _ROUNDING_TOLERANCE * max(1.0, abs(float(left)))
    ):
        return {
            "status": "rounding",
            "cause": f"{left!r} vs {right!r} within rounding tolerance",
            "explained": True,
        }
    return {
        "status": "disagreement",
        "cause": f"incumbent {left!r} vs candidate {right!r} with matching unit/session/adjustment",
        "explained": False,
    }


def authorization_state(authorizations: Mapping[str, bool]) -> dict[str, Any]:
    """Describe which side, if either, is authorized for repeated retrieval."""
    incumbent = bool(authorizations.get("incumbent"))
    candidate = bool(authorizations.get("candidate"))
    if incumbent and candidate:
        return {"mode": "live_dual_read", "live": ["incumbent", "candidate"], "retained": []}
    if incumbent or candidate:
        live = "incumbent" if incumbent else "candidate"
        retained = "candidate" if incumbent else "incumbent"
        return {"mode": "partial_dual_read", "live": [live], "retained": [retained]}
    return {"mode": "offline_comparison", "live": [], "retained": ["incumbent", "candidate"]}


def build_report(
    observations: Sequence[Mapping[str, Any]],
    authorizations: Mapping[str, bool],
    *,
    incumbent_source: str,
    candidate_source: str,
) -> dict[str, Any]:
    """Compare retained observations and decide whether cutover may proceed.

    Each observation is ``{"role", "family", "field", "incumbent": {...},
    "candidate": {...}}`` where both sides carry ``value``/``unit``/``session``/
    ``adjustment``. Nothing is fetched here.
    """
    state = authorization_state(authorizations)
    findings: list[dict[str, Any]] = []
    for observation in observations:
        role = str(observation.get("role") or "").strip()
        family = str(observation.get("family") or "").strip()
        field = str(observation.get("field") or "").strip()
        if role not in REQUIRED_ROLES:
            raise ValueError(f"Unknown sampling role: {role!r}")
        if family not in FAMILY_FIELDS:
            raise ValueError(f"Unknown observation family: {family!r}")
        if field not in FAMILY_FIELDS[family]:
            raise ValueError(f"Field {field!r} is not documented for {family!r}")
        finding = {
            "role": role,
            "family": family,
            "field": field,
            **classify(
                _side(
                    observation.get("incumbent", {}).get("value"),
                    unit=observation.get("incumbent", {}).get("unit"),
                    session=observation.get("incumbent", {}).get("session"),
                    adjustment=observation.get("incumbent", {}).get("adjustment"),
                ),
                _side(
                    observation.get("candidate", {}).get("value"),
                    unit=observation.get("candidate", {}).get("unit"),
                    session=observation.get("candidate", {}).get("session"),
                    adjustment=observation.get("candidate", {}).get("adjustment"),
                ),
            ),
        }
        findings.append(finding)

    covered = {finding["role"] for finding in findings}
    unexplained = [f for f in findings if not f["explained"]]
    missing_roles = [role for role in REQUIRED_ROLES if role not in covered]
    return {
        "operation": "second_source_comparison",
        "live_dual_read": state["mode"] == "live_dual_read",
        "asymmetry": {
            "mode": state["mode"],
            "live_side": state["live"],
            "retained_side": state["retained"],
            "note": (
                "No side was acquired for this report; both sides are retained or "
                "published-schema evidence."
                if not state["live"] else
                "Only the named side was acquired; the other side is retained data, "
                "so this is not a full live dual-read."
            ),
        },
        "sources": {"incumbent": incumbent_source, "candidate": candidate_source},
        "findings": findings,
        "counts": {
            "total": len(findings),
            "unexplained": len(unexplained),
            "match": sum(f["status"] == "match" for f in findings),
            "unavailable": sum(f["status"] == "unavailable" for f in findings),
        },
        "missing_roles": missing_roles,
        "cutover_allowed": not unexplained and not missing_roles,
        "blocking_findings": unexplained + [
            {"status": "coverage_gap", "cause": f"role {role!r} not sampled", "role": role}
            for role in missing_roles
        ],
    }
