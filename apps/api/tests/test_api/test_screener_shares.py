import json
from datetime import date, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from vnibb.api.v1.screener import _hydrate_screener_rows
from vnibb.models.company import Company
from vnibb.providers.vnstock.equity_screener import ScreenerData
from vnibb.api.v1.screener import _to_screener_data_row, apply_advanced_filters
from vnibb.models.screener import ScreenerSnapshot
from vnibb.providers.vnstock.equity_screener import StockScreenerParams, VnstockScreenerFetcher
from vnibb.services.cache_manager import CacheManager


def certified(value=7):
    return {"shares_outstanding": value, "shares_unit": "shares", "shares_source": "issuer:shares",
            "shares_as_of": "2020-01-01", "share_basis": "outstanding"}


def provider(row):
    return VnstockScreenerFetcher.transform_data(StockScreenerParams(), [row])[0]


def filter_shares(rows, operator="gte", value=1):
    return apply_advanced_filters(rows, filters=json.dumps({"logic": "AND", "conditions": [
        {"field": "shares_outstanding", "operator": operator, "value": value}
    ]}))


def test_provider_share_admission_and_filtering():
    rows = [provider({"symbol": "RAW", "issue_share": 850.1}),
            provider({"symbol": "GOOD", **certified()}),
            provider({"symbol": "FUTURE", **certified(8), "shares_as_of": (date.today() + timedelta(days=3)).isoformat()}),
            provider({"symbol": "NO_SOURCE", **certified(9), "shares_source": None})]
    assert rows[0].shares_outstanding is None
    assert rows[0].shares_outstanding_provenance["observations"][0]["value"] == 850.1
    assert rows[1].shares_outstanding == 7
    assert [row.symbol for row in filter_shares(rows)] == ["GOOD"]
    assert not filter_shares(rows, "in", [None])
    assert [row.symbol for row in filter_shares(rows, "invalid", 0)] == ["GOOD"]
    group = {"logic": "OR", "conditions": [
        {"field": "shares_outstanding", "operator": "gte", "value": 1},
        {"field": "symbol", "operator": "eq", "value": "RAW"},
    ]}
    assert {row.symbol for row in apply_advanced_filters(rows, filters=json.dumps(group))} == {"RAW", "GOOD"}


def test_conflicting_provenance_does_not_certify_raw_count():
    original = provider({"symbol": "GOOD", **certified()}).shares_outstanding_provenance
    mismatched_count = provider({"symbol": "BAD", "shares_outstanding": 850.1,
                                 "shares_outstanding_provenance": original})
    mismatched_source = provider({"symbol": "BAD", **certified(), "shares_source": "different",
                                  "shares_outstanding_provenance": original})
    assert mismatched_count.shares_outstanding is None
    assert mismatched_source.shares_outstanding is None
    assert mismatched_count.shares_outstanding_provenance["observations"][-1]["value"] == 850.1


def test_conflict_with_matching_raw_count_stays_conflicting_through_filter():
    conflict = provider({"symbol": "CONFLICT", **certified(7), "outstanding_shares": 8})
    evidence = conflict.shares_outstanding_provenance
    assert evidence["status"] == "conflict"
    assert {item["value"] for item in evidence["observations"]} == {7, 8}
    row = provider({"symbol": "CONFLICT", **certified(7), "shares_outstanding_provenance": evidence})
    assert row.shares_outstanding is None
    assert row.shares_outstanding_provenance["status"] == "conflict"
    assert not filter_shares([row])
    assert {item["value"] for item in row.shares_outstanding_provenance["observations"]} == {7, 8}


@pytest.mark.asyncio
async def test_conflict_provenance_survives_snapshot_and_consumer_filter(test_db):
    row = provider({"symbol": "CONFLICT", **certified(7), "outstanding_shares": 8})
    manager = CacheManager(test_db)
    assert await manager.store_screener_data([row.model_dump(mode="json")])
    test_db.expire_all()
    snapshot = (await test_db.execute(select(ScreenerSnapshot).where(ScreenerSnapshot.symbol == "CONFLICT"))).scalar_one()
    consumer = _to_screener_data_row(snapshot)
    assert consumer.shares_outstanding is None
    assert consumer.shares_outstanding_provenance["status"] == "conflict"
    assert {item["value"] for item in consumer.shares_outstanding_provenance["observations"]} == {7, 8}
    assert not filter_shares([consumer])
    assert consumer.shares_outstanding_provenance["status"] == "conflict"


def test_snapshot_never_borrows_metadata_from_another_share_record():
    row = _to_screener_data_row(SimpleNamespace(symbol="BAD", shares_outstanding=850.1,
        extended_metrics=certified(7)))
    assert row.shares_outstanding is None
    assert row.shares_outstanding_provenance["observations"][0]["value"] == 850.1
    snapshot = _to_screener_data_row(SimpleNamespace(symbol="GOOD", extended_metrics=certified(7)))
    assert snapshot.shares_outstanding == 7
    assert [row.symbol for row in filter_shares([row, snapshot])] == ["GOOD"]


def test_snapshot_projection_retains_conflict_with_matching_raw_count():
    conflict = provider({"symbol": "BAD", **certified(7), "outstanding_shares": 8})
    row = _to_screener_data_row(SimpleNamespace(
        symbol="BAD", shares_outstanding=7,
        extended_metrics={"shares_outstanding_provenance": conflict.shares_outstanding_provenance},
    ))
    assert row.shares_outstanding is None
    assert row.shares_outstanding_provenance["status"] == "conflict"
    assert {item["value"] for item in row.shares_outstanding_provenance["observations"]} == {7, 8}
    assert not filter_shares([row])


@pytest.mark.asyncio
async def test_snapshot_share_evidence_replaced_atomically(test_db):
    manager = CacheManager(test_db)
    await manager.store_screener_data([{"symbol": "SHR", **certified()}])
    await manager.store_screener_data([{"symbol": "SHR", "shares_source": "different", "pe": 10}])
    test_db.expire_all()
    query = select(ScreenerSnapshot).where(ScreenerSnapshot.symbol == "SHR")
    snapshot = (await test_db.execute(query)).scalar_one()
    assert _to_screener_data_row(snapshot).shares_outstanding == 7
    await manager.store_screener_data([{"symbol": "SHR", "shares_outstanding": 850.1}])
    test_db.expire_all()
    snapshot = (await test_db.execute(query)).scalar_one()
    row = _to_screener_data_row(snapshot)
    assert row.shares_outstanding is None
    assert row.shares_outstanding_provenance["observations"][0]["value"] == 850.1
    assert not filter_shares([row])


@pytest.mark.asyncio
async def test_company_counts_are_not_substituted_for_snapshot_shares(test_db):
    test_db.add(Company(symbol="CMP", outstanding_shares=850.1, listed_shares=123))
    await test_db.commit()
    rows = await _hydrate_screener_rows([ScreenerData(symbol="CMP")], test_db)
    assert rows[0].shares_outstanding is None
    assert rows[0].shares_outstanding_provenance["observations"][0]["value"] == 850.1


@pytest.mark.asyncio
async def test_company_share_metadata_requires_matching_stored_count(test_db):
    test_db.add_all([
        Company(symbol="GOOD", outstanding_shares=7, raw_data=certified(7)),
        Company(symbol="BAD", outstanding_shares=850.1, raw_data=certified(7)),
        Company(symbol="LIST", listed_shares=7, raw_data=certified(7)),
    ])
    await test_db.commit()
    rows = await _hydrate_screener_rows([ScreenerData(symbol=s) for s in ("GOOD", "BAD", "LIST")], test_db)
    assert [row.shares_outstanding for row in rows] == [7, None, None]
    assert rows[1].shares_outstanding_provenance["observations"][0]["value"] == 850.1
    assert [row.symbol for row in filter_shares(rows)] == ["GOOD"]
