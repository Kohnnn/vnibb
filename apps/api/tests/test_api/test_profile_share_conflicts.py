from vnibb.core.market_cap import reconcile_market_caps, resolve_market_cap
from vnibb.providers.vnstock.equity_profile import (
    EquityProfileQueryParams,
    VnstockEquityProfileFetcher,
)


def profile(row):
    return VnstockEquityProfileFetcher.transform_data(EquityProfileQueryParams(symbol="VCI"), [row])[0]


def share_row():
    return {
        "outstanding_shares": 1_152_231_925,
        "shares_outstanding": 1_152_231_925,
        "shares_unit": "shares",
        "shares_source": "issuer:outstanding_shares",
        "shares_as_of": "2020-01-01",
        "share_basis": "outstanding",
        "price": 19_150,
        "price_unit": "VND",
        "price_source": "exchange:quote",
        "trade_date": "2020-01-01",
    }


def test_conflicting_aliases_keep_raw_evidence_without_certifying_shares_or_cap():
    row = share_row()
    row["shares_outstanding"] = 1_152_231_926
    result = profile(row)
    assert result.outstanding_shares is None
    assert result.market_cap is None
    assert result.market_cap_provenance["status"] == "conflict"
    evidence = result.shares_outstanding_provenance
    assert evidence["status"] == "conflict"
    assert {(item["alias"], item["raw_value"]) for item in evidence["observations"]} == {
        ("outstanding_shares", 1_152_231_925), ("shares_outstanding", 1_152_231_926),
    }
    assert all(item["source"] == "issuer:outstanding_shares" and item["as_of"] == "2020-01-01"
               and item["share_basis"] == "outstanding" for item in evidence["observations"])
    serialized = result.model_dump(mode="json")
    cap = resolve_market_cap(serialized, source="postgres:company_profile", price_record=row)
    assert cap["status"] == "conflict"
    assert cap["value"] is None
    assert reconcile_market_caps(cap)["status"] == "conflict"


def test_equal_aliases_remain_admissible():
    result = profile(share_row())
    assert result.outstanding_shares == 1_152_231_925
    assert result.shares_outstanding_provenance["status"] == "available"
    assert result.market_cap == 22_065_241_363_750
    assert result.market_cap_provenance["status"] == "available"


def test_conflict_provenance_blocks_matching_raw_share_on_later_cap_derivation():
    row = share_row()
    row["shares_outstanding"] = 1_152_231_926
    evidence = profile(row).shares_outstanding_provenance
    row["shares_outstanding"] = row["outstanding_shares"]
    row["shares_outstanding_provenance"] = evidence
    cap = resolve_market_cap({}, source="postgres:company_profile", price_record=row, shares_record=row)
    assert cap["status"] == "conflict"
    assert cap["value"] is None
    assert cap["observations"][0]["shares"] == 1_152_231_925
    assert cap["observations"][0]["shares_conflict"] is True


def test_stored_certified_cap_cannot_override_share_conflict():
    row = share_row()
    available = profile(row)
    row["shares_outstanding"] += 1
    evidence = profile(row).shares_outstanding_provenance
    stored = available.model_dump(mode="json")
    stored["shares_outstanding_provenance"] = evidence
    cap = resolve_market_cap(stored, source="postgres:company_profile")
    assert cap["status"] == "conflict"
    assert cap["value"] is None
    assert cap["observations"] == available.market_cap_provenance["observations"]
    assert reconcile_market_caps(cap)["status"] == "conflict"
