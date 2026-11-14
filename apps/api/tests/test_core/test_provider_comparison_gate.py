"""Second-source comparison must classify every difference and refuse on doubt (#234).

No network, no provider, no HTTP client: the report consumes retained rows or
published-schema values only, and must never present itself as a live dual-read
when a side was not acquired.
"""

import pytest

from vnibb.providers import comparison
from vnibb.providers.fhsc import capability_report


def obs(role, family, field, incumbent, candidate):
    return {
        "role": role, "family": family, "field": field,
        "incumbent": incumbent, "candidate": candidate,
    }


def side(value, unit="VND", session="2026-11-13", adjustment="raw"):
    return {"value": value, "unit": unit, "session": session, "adjustment": adjustment}


def full_set(**value_overrides):
    rows = []
    for role in comparison.REQUIRED_ROLES:
        family = "fundamentals" if role == "bank" else "bars"
        field = "revenue" if family == "fundamentals" else "close"
        value = value_overrides.get(role, 100.0)
        rows.append(obs(role, family, field, side(value), side(value)))
    return rows


def test_identical_retained_observations_allow_cutover():
    report = comparison.build_report(
        full_set(), {}, incumbent_source="vci", candidate_source="fhsc"
    )
    assert report["live_dual_read"] is False
    assert report["counts"]["unexplained"] == 0
    assert report["cutover_allowed"] is True


def test_no_authorization_is_reported_as_offline_not_a_live_dual_read():
    report = comparison.build_report(full_set(), {}, incumbent_source="vci", candidate_source="fhsc")
    assert report["asymmetry"]["mode"] == "offline_comparison"
    assert report["asymmetry"]["live_side"] == []
    assert report["asymmetry"]["retained_side"] == ["incumbent", "candidate"]
    assert "No side was acquired" in report["asymmetry"]["note"]


def test_one_authorized_side_is_recorded_as_explicitly_asymmetric():
    report = comparison.build_report(
        full_set(), {"candidate": True}, incumbent_source="vci", candidate_source="fhsc"
    )
    assert report["asymmetry"]["mode"] == "partial_dual_read"
    assert report["asymmetry"]["live_side"] == ["candidate"]
    assert report["asymmetry"]["retained_side"] == ["incumbent"]
    assert report["live_dual_read"] is False


def test_unit_mismatch_is_classified_and_blocks_cutover():
    rows = full_set()
    rows[0] = obs("bank", "bars", "close", side(25_000.0, unit="VND"), side(25.0, unit="THOUSAND_VND"))
    report = comparison.build_report(rows, {}, incumbent_source="vci", candidate_source="fhsc")
    assert report["findings"][0]["status"] == "unit_scale"
    assert report["cutover_allowed"] is False


def test_session_and_adjustment_differences_are_distinct_causes():
    rows = [
        obs("large_cap", "bars", "close", side(100.0), side(100.0, session="2026-11-12")),
        obs("mid_cap", "bars", "close", side(100.0), side(100.0, adjustment="split_adjusted")),
    ]
    report = comparison.build_report(rows, {}, incumbent_source="vci", candidate_source="fhsc")
    statuses = {f["status"] for f in report["findings"]}
    assert statuses == {"session_boundary", "adjustment"}


def test_genuine_disagreement_blocks_but_rounding_does_not():
    agree = comparison.build_report(
        [obs("large_cap", "bars", "close", side(100.0), side(100.0 + 1e-9))],
        {}, incumbent_source="vci", candidate_source="fhsc",
    )
    disagree = comparison.build_report(
        [obs("large_cap", "bars", "close", side(100.0), side(101.0))],
        {}, incumbent_source="vci", candidate_source="fhsc",
    )
    assert agree["findings"][0]["status"] == "rounding"
    assert disagree["findings"][0]["status"] == "disagreement"
    assert disagree["findings"][0]["explained"] is False


def test_a_missing_side_is_unavailable_never_zero_agreement():
    report = comparison.build_report(
        [obs("illiquid", "bars", "volume", side(0.0), side(None))],
        {}, incumbent_source="vci", candidate_source="fhsc",
    )
    finding = report["findings"][0]
    assert finding["status"] == "unavailable"
    assert "candidate_missing" in finding["cause"]
    # A real zero on one side and a missing observation on the other are not a match.
    assert finding["status"] != "match"


def test_missing_sampling_role_blocks_cutover_with_a_coverage_gap():
    rows = [r for r in full_set() if r["role"] != "index"]
    report = comparison.build_report(rows, {}, incumbent_source="vci", candidate_source="fhsc")
    assert report["missing_roles"] == ["index"]
    assert report["cutover_allowed"] is False
    assert any(b["status"] == "coverage_gap" for b in report["blocking_findings"])


@pytest.mark.parametrize(
    ("role", "family", "field"),
    [("unicorn", "bars", "close"), ("bank", "trades", "close"), ("bank", "bars", "pe_ratio")],
)
def test_undocumented_role_family_or_field_is_rejected(role, family, field):
    with pytest.raises(ValueError):
        comparison.build_report(
            [obs(role, family, field, side(1.0), side(1.0))],
            {}, incumbent_source="vci", candidate_source="fhsc",
        )


def test_fhsc_capability_report_names_unavailable_capabilities():
    report = capability_report()
    assert report["acquisition"] == "offline_only"
    assert report["capabilities"]["bars"]["available"] is True
    assert "news" in report["unavailable"]
    assert report["capabilities"]["news"]["reason"].startswith("fhsc_")
    # An unavailable capability must carry a reason, never a value or a fallback.
    for name in report["unavailable"]:
        assert report["capabilities"][name]["reason"]
        assert "value" not in report["capabilities"][name]
