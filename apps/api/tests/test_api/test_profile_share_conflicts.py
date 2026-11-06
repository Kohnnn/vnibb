from datetime import datetime
from unittest.mock import AsyncMock

import pytest
from vnibb.core.market_cap import reconcile_market_caps, resolve_market_cap
from vnibb.models.company import Company
from vnibb.models.stock import Stock
from vnibb.providers.vnstock.equity_profile import (
    EquityProfileData,
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


LEGAL_FORMS = ["JSC", " LLC ", "Limited Liability Company", "CORPORATION", "Cổ Phần", "co phan"]


@pytest.mark.asyncio
@pytest.mark.parametrize("legal_form", LEGAL_FORMS)
async def test_profile_paths_never_publish_legal_form_as_taxonomy(
    client, test_db, monkeypatch, legal_form
):
    """#207: legal-form aliases stay out of industry/sector in every path."""
    test_db.add(Stock(symbol="FPT", company_name="FPT", exchange="HOSE",
                      industry=legal_form, sector=legal_form))
    test_db.add(Company(symbol="FPT", company_name="FPT", exchange="HOSE",
                        industry=legal_form, sector=legal_form,
                        updated_at=datetime(2026, 11, 2)))
    await test_db.commit()
    monkeypatch.setattr("vnibb.api.v1.equity._schedule_refresh", AsyncMock())
    monkeypatch.setattr(
        "vnibb.api.v1.equity.VnstockEquityProfileFetcher.fetch",
        AsyncMock(return_value=[EquityProfileData(
            symbol="FPT", company_name="FPT", exchange="HOSE",
            industry=legal_form, sector=legal_form,
        )]),
    )

    for suffix in ("", "?refresh=true"):
        response = await client.get(f"/api/v1/equity/FPT/profile{suffix}")
        assert response.status_code == 200
        assert response.json()["data"]["industry"] is None
        assert response.json()["data"]["sector"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize("industry", ["JSC financial services", "Phân tích cổ phần"])
async def test_profile_keeps_classifications_that_contain_legal_form_words(
    client, test_db, monkeypatch, industry
):
    """The alias set matches whole normalized values, not substrings."""
    sector = f"{industry} sector"
    test_db.add(Stock(symbol="FPT", company_name="FPT", exchange="HOSE",
                      industry=industry, sector=sector))
    await test_db.commit()
    monkeypatch.setattr("vnibb.api.v1.equity._schedule_refresh", AsyncMock())

    response = await client.get("/api/v1/equity/FPT/profile")
    assert response.json()["data"]["industry"] == industry
    assert response.json()["data"]["sector"] == sector
