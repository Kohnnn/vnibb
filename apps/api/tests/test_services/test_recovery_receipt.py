"""Recovery receipt identity must be exact and its rerun decision idempotent (#171)."""

from datetime import date

import pytest

from vnibb.services import recovery_receipt as rr

SESSION = date(2026, 11, 13)
MEMBERS = ["FPT", "VCB", "HPG"]


def receipt(committed=True, symbols=MEMBERS, session=SESSION, lineage=None):
    return rr.build_receipt(
        symbols, session=session, source="vietcap", scope="vietcap_board",
        lineage=lineage, committed=committed,
    )


def test_same_cohort_yields_the_same_digest_regardless_of_order():
    forward = rr.membership_digest(MEMBERS, session=SESSION, source="vietcap", scope="vietcap_board")
    reversed_ = rr.membership_digest(
        list(reversed(MEMBERS)), session=SESSION, source="vietcap", scope="vietcap_board"
    )
    assert forward == reversed_


@pytest.mark.parametrize(
    "change",
    [
        {"symbols": ["FPT", "VCB"]},
        {"session": date(2026, 11, 12)},
    ],
)
def test_different_cohorts_never_share_a_digest(change):
    base = rr.membership_digest(MEMBERS, session=SESSION, source="vietcap", scope="vietcap_board")
    other = rr.membership_digest(
        change.get("symbols", MEMBERS),
        session=change.get("session", SESSION),
        source="vietcap",
        scope="vietcap_board",
    )
    assert base != other


def test_source_and_scope_are_part_of_the_identity():
    base = rr.membership_digest(MEMBERS, session=SESSION, source="vietcap", scope="vietcap_board")
    assert base != rr.membership_digest(MEMBERS, session=SESSION, source="fhsc", scope="vietcap_board")
    assert base != rr.membership_digest(MEMBERS, session=SESSION, source="vietcap", scope="whole_market")


def test_receipt_records_exact_membership_and_lineage_verbatim():
    lineage = {"price_unit": "VND", "price_source": "vietcap_board", "session_qualified": 3}
    built = receipt(lineage=lineage).as_dict()
    assert built["membership"] == sorted(MEMBERS)  # canonical order, not input order
    assert built["membership_count"] == 3
    assert built["session"] == "2026-11-13"
    assert built["lineage"] == lineage
    assert built["source"] == "vietcap" and built["scope"] == "vietcap_board"


def test_uncommitted_attempt_is_still_identified_but_not_claimed():
    assert receipt(committed=False).as_dict()["outcome"] == "not_committed"


def test_rerun_after_commit_is_a_duplicate_and_must_not_reapply():
    first = receipt(committed=True)
    decision = rr.classify_rerun(receipt(), [first.as_dict()])
    assert decision["decision"] == "duplicate"
    assert decision["apply"] is False


def test_rerun_after_failed_attempt_may_apply_again():
    decision = rr.classify_rerun(receipt(), [receipt(committed=False).as_dict()])
    assert decision["decision"] == "retry_uncommitted"
    assert decision["apply"] is True


def test_different_membership_for_a_committed_session_is_a_conflict():
    other = receipt(symbols=["VCB", "FPT"])
    decision = rr.classify_rerun(receipt(), [other.as_dict()])
    assert decision["decision"] == "conflict"
    assert decision["apply"] is False


def test_no_prior_receipt_is_a_new_cohort():
    decision = rr.classify_rerun(receipt(), [])
    assert decision["decision"] == "new" and decision["apply"] is True


def test_reruns_are_stable_across_repeated_evaluation():
    prior = [receipt().as_dict()]
    first = rr.classify_rerun(receipt(), prior)
    second = rr.classify_rerun(receipt(), prior)
    assert first == second


@pytest.mark.parametrize(
    "symbols",
    [["FPT", "FPT"], [], [""], ["FPT", " "]],
)
def test_membership_must_be_unique_and_nonempty(symbols):
    with pytest.raises(ValueError):
        receipt(symbols=symbols)


def test_missing_source_or_scope_is_refused():
    with pytest.raises(ValueError):
        rr.membership_digest(MEMBERS, session=SESSION, source="", scope="vietcap_board")
