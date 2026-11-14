"""Bounded-recovery receipt identity: exact membership, lineage, idempotent rerun.

Recovery is only idempotent if the same cohort yields the same receipt identity
and a rerun is recognised as a duplicate instead of admitting a second time. The
digest is derived from what the run actually covers — canonical membership, the
expected session, source and scope — never from a fetch clock, an attempt id or
row counts, so replays compare equal and different cohorts never collide.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import date
from typing import Any

OPERATION = "bounded_recovery"


def _symbols(symbols: Iterable[str]) -> list[str]:
    values = [str(symbol).strip().upper() for symbol in symbols]
    if not values or any(not value for value in values):
        raise ValueError("Recovery membership must be nonempty canonical symbols")
    if len(set(values)) != len(values):
        raise ValueError("Recovery membership contains duplicate symbols")
    return sorted(values)


def membership_digest(
    symbols: Iterable[str],
    *,
    session: date,
    source: str,
    scope: str,
) -> str:
    """Stable identity for one recovery cohort; independent of run metadata."""
    payload = {
        "membership": _symbols(symbols),
        "session": session.isoformat(),
        "source": str(source).strip().lower(),
        "scope": str(scope).strip().lower(),
    }
    if not payload["source"] or not payload["scope"]:
        raise ValueError("Recovery receipt requires an explicit source and scope")
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


@dataclass(frozen=True)
class RecoveryReceipt:
    """What a recovery run claims, separated from what it merely observed."""

    digest: str
    membership: tuple[str, ...]
    session: str
    source: str
    scope: str
    lineage: dict[str, Any]
    outcome: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "operation": OPERATION,
            "receipt_digest": self.digest,
            "membership": list(self.membership),
            "membership_count": len(self.membership),
            "session": self.session,
            "source": self.source,
            "scope": self.scope,
            "lineage": dict(self.lineage),
            "outcome": self.outcome,
        }


def build_receipt(
    symbols: Iterable[str],
    *,
    session: date,
    source: str,
    scope: str,
    lineage: Mapping[str, Any] | None = None,
    committed: bool,
) -> RecoveryReceipt:
    """Build the receipt for a recovery attempt.

    ``lineage`` carries source/session/unit evidence; it is recorded verbatim and
    never synthesised. A run that did not commit is still identified, so a rerun
    can distinguish "already done" from "never happened".
    """
    members = tuple(_symbols(symbols))
    digest = membership_digest(members, session=session, source=source, scope=scope)
    return RecoveryReceipt(
        digest=digest,
        membership=members,
        session=session.isoformat(),
        source=str(source).strip().lower(),
        scope=str(scope).strip().lower(),
        lineage=dict(lineage or {}),
        outcome="committed" if committed else "not_committed",
    )


def classify_rerun(
    receipt: RecoveryReceipt,
    prior: Iterable[Mapping[str, Any]],
) -> dict[str, Any]:
    """Decide whether a rerun is a duplicate, a new cohort, or a conflict.

    ``prior`` are stored receipts for the same operation. A committed prior with
    the same digest means the cohort is already admitted: the rerun must not
    re-admit or rewrite it. A prior digest differing only by session or
    membership is a different cohort and is allowed to proceed.
    """
    matches = [
        entry for entry in prior
        if str(entry.get("receipt_digest") or "") == receipt.digest
    ]
    committed = [entry for entry in matches if entry.get("outcome") == "committed"]
    if committed:
        return {
            "decision": "duplicate",
            "apply": False,
            "reason": "cohort_already_committed",
            "prior_outcomes": sorted(str(entry.get("outcome")) for entry in committed),
        }
    if matches:
        return {
            "decision": "retry_uncommitted",
            "apply": True,
            "reason": "prior_attempt_did_not_commit",
            "prior_outcomes": sorted(str(entry.get("outcome")) for entry in matches),
        }
    conflicting = [
        entry for entry in prior
        if entry.get("session") == receipt.session
        and entry.get("source") == receipt.source
        and entry.get("scope") == receipt.scope
        and entry.get("outcome") == "committed"
    ]
    if conflicting:
        return {
            "decision": "conflict",
            "apply": False,
            "reason": "a_different_membership_is_committed_for_this_session",
            "prior_outcomes": ["committed"],
        }
    return {
        "decision": "new",
        "apply": True,
        "reason": "no_prior_receipt_for_this_cohort",
        "prior_outcomes": [],
    }
