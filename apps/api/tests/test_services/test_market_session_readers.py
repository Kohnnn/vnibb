"""Stored source-session evidence must survive writes and qualify every member."""

from copy import deepcopy
from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace

import pytest
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models.stock import Stock
from vnibb.models.sync_status import SyncStatus
from vnibb.providers.vnstock.equity_screener import ScreenerData
from vnibb.services.cache_manager import CacheManager
from vnibb.services.market_session import qualify_market_session

SESSION = date(2026, 10, 26)
OBSERVED = datetime(2026, 10, 26, 8, 12, tzinfo=UTC)


@pytest.fixture(autouse=True)
def completed_session_clock(monkeypatch):
    from vnibb.api.v1 import health, market, screener
    from vnibb.services import cache_manager

    class FrozenDateTime(datetime):
        @classmethod
        def utcnow(cls):
            return cls(2026, 10, 26, 9)

        @classmethod
        def now(cls, tz=None):
            return cls(2026, 10, 26, 9, tzinfo=UTC).astimezone(tz)

    monkeypatch.setattr(cache_manager, "datetime", FrozenDateTime)
    monkeypatch.setattr(health, "datetime", FrozenDateTime)
    monkeypatch.setattr(market, "datetime", FrozenDateTime)
    monkeypatch.setattr(screener, "datetime", FrozenDateTime)


def _record(symbol, status="traded"):
    traded = status == "traded"
    raw = {
        "listingInfo": {
            "symbol": symbol, "ticker": symbol, "stockType": "STOCK", "type": "STOCK",
            "isDelisted": 0, "tradingDate": SESSION.isoformat(),
            "receivedTime": "2026-10-26T01:44:00Z",
            "tradingStatus": "TRADING_SUSPENSION" if status == "suspended" else "TRADING_ACTIVATED",
            "tradingStatusCode": "110" if status == "suspended" else "20",
            "securityStatus": "Y" if status == "suspended" else "N",
        },
        "bidAsk": {
            "symbol": symbol, "session": "ENDED", "time": "2026-10-26T08:00:00Z",
            "receivedTime": "2026-10-26T08:00:03Z",
        },
        "matchPrice": {
            "symbol": symbol, "session": "ENDED", "time": "2026-10-26T08:00:00Z",
            "receivedTime": "2026-10-26T08:00:03Z",
            "matchPrice": 10000 if traded else 0, "openPrice": 10000 if traded else None,
            "highest": 11000 if traded else 0, "lowest": 9000 if traded else 0,
            "accumulatedVolume": 100 if traded else 0,
        },
    }
    if status == "suspended":
        raw["matchPrice"]["receivedTime"] = "2026-10-20T08:00:03Z"
    return qualify_market_session(raw, symbol, SESSION, OBSERVED)


def _row(symbol, status="traded"):
    traded = status == "traded"
    return ScreenerSnapshot(
        symbol=symbol, snapshot_date=SESSION, created_at=OBSERVED.replace(tzinfo=None),
        trade_date=SESSION if traded else SESSION - timedelta(days=6),
        price=10000 if traded else 9000, volume=100 if traded else 0,
        source="vietcap_vnd",
        extended_metrics={
            "price_unit": "VND", "price_source": "vietcap_vnd",
            "market_session": _record(symbol, status),
        },
    )


def _receipt(symbols, *, typed=True):
    metadata = {
        "snapshot_date": SESSION.isoformat(), "expected_symbols": list(symbols),
        "expected_count": len(symbols),
    }
    if typed:
        metadata["market_session_date"] = SESSION.isoformat()
    return SyncStatus(
        sync_type="screener_universe", status="completed", error_count=0,
        success_count=len(symbols), completed_at=OBSERVED.replace(tzinfo=None),
        additional_data=metadata,
    )


async def _seed(db, rows, *, typed=True, expected=None):
    symbols = [row.symbol for row in rows]
    db.add_all([Stock(symbol=symbol, is_active=1) for symbol in symbols])
    db.add_all(rows)
    db.add(_receipt(symbols if expected is None else expected, typed=typed))
    await db.commit()


@pytest.mark.asyncio
async def test_complete_session_discloses_old_and_missing_actual_prices(client, test_db):
    rows = [_row("AAA"), _row("BBB", "no_trade"), _row("CCC", "suspended")]
    rows[-1].trade_date = None
    rows[-1].price = None
    rows[-1].extended_metrics["price_unit"] = "unknown"
    rows[-1].extended_metrics.pop("price_source")
    await _seed(test_db, rows)

    cached = await CacheManager(db=test_db).get_screener_data(allow_stale=False)
    response = await client.get("/api/v1/health/detailed")
    database = response.json()["components"]["database"]

    assert cached.hit and not cached.is_stale
    assert cached.market_session_counts == {"qualified": 3, "traded": 1, "no_trade": 1, "suspended": 1}
    assert response.json()["status"] == "degraded"
    assert database["screener_freshness_basis"] == "verified_universe_vietcap_board_session"
    assert database["screener_trade_date"] == "2026-10-20"
    assert database["screener_snapshot_age_days"] == 6
    assert database["screener_missing_trade_dates"] == 1
    assert database["screener_missing_actual_prices"] == 1
    assert database["screener_qualified_session_count"] == 3
    assert database["screener_session_counts"] == {"traded": 1, "no_trade": 1, "suspended": 1}
    assert database["screener_calendar"]["exchange_calendar_verified"] is True
    assert database["market_data_coverage_verified"] is False
    assert database["market_data_coverage_reason"] == "provider_scope_only"
    assert database["provider_session_coverage"] == {
        "source": "vietcap", "scope": "vietcap_board", "session_date": SESSION.isoformat(),
        "verified": True, "qualified_count": 3, "expected_count": 3,
    }
    assert database["screener_stale_actual_trade_dates"] == 1
    assert "freshness_breach" not in database


@pytest.mark.asyncio
@pytest.mark.parametrize("damage", [
    "raw_tamper", "wrong_symbol", "missing_raw", "stale_session", "future_observation",
    "wrong_source", "missing_session", "mixed_legacy", "stored_price", "stored_volume",
    "stored_trade_date", "unknown_unit", "unproven_price_source", "future_trade_date",
    "missing_scope", "wrong_scope", "raw_stale_date", "status_tamper",
])
async def test_one_invalid_constituent_degrades_typed_partition(client, test_db, damage):
    rows = [_row("AAA"), _row("BBB")]
    metrics = deepcopy(rows[-1].extended_metrics)
    record = metrics["market_session"]
    if damage == "raw_tamper":
        record["raw"]["matchPrice"]["accumulatedVolume"] = 0
    elif damage == "wrong_symbol":
        record["raw"]["listingInfo"]["symbol"] = "AAA"
    elif damage == "missing_raw":
        record.pop("raw")
    elif damage == "stale_session":
        record["session_date"] = "2026-10-23"
    elif damage == "future_observation":
        record["observed_at"] = "2026-10-27T09:00:00+00:00"
    elif damage == "wrong_source":
        record["source"] = "unverified"
    elif damage == "missing_scope":
        record.pop("scope")
    elif damage == "wrong_scope":
        record["scope"] = "whole_market"
    elif damage == "raw_stale_date":
        record["raw"]["listingInfo"]["tradingDate"] = "2026-10-23"
    elif damage == "status_tamper":
        record["status"] = "no_trade"
    elif damage == "missing_session":
        metrics["market_session"] = None
    elif damage == "mixed_legacy":
        metrics.pop("market_session")
    elif damage == "stored_price":
        rows[-1].price = 10001
    elif damage == "stored_volume":
        rows[-1].volume = 101
    elif damage == "stored_trade_date":
        rows[-1].trade_date = SESSION - timedelta(days=1)
    elif damage == "unknown_unit":
        metrics["price_unit"] = "unknown"
    elif damage == "unproven_price_source":
        metrics["price_source"] = "vietcap_unverified"
    elif damage == "future_trade_date":
        rows[-1].trade_date = SESSION + timedelta(days=1)
    rows[-1].extended_metrics = metrics
    await _seed(test_db, rows)

    cached = await CacheManager(db=test_db).get_screener_data()
    fresh = await CacheManager(db=test_db).get_screener_data(allow_stale=False)
    response = await client.get("/api/v1/health/detailed")
    database = response.json()["components"]["database"]

    assert cached.hit and cached.is_stale
    assert cached.market_session_counts["qualified"] == 1
    assert not fresh.hit and fresh.is_stale
    assert response.json()["status"] == "degraded"
    assert database["screener_qualified_session_count"] == 1
    assert database["screener_missing_session_coverage"] == 1
    assert database["freshness_breach"] is True


@pytest.mark.asyncio
async def test_receipt_marker_prevents_all_missing_evidence_becoming_legacy(test_db):
    rows = [_row("AAA")]
    rows[0].extended_metrics.pop("market_session")
    await _seed(test_db, rows)

    cached = await CacheManager(db=test_db).get_screener_data()

    assert cached.hit and cached.is_stale
    assert cached.market_session_counts["qualified"] == 0


@pytest.mark.asyncio
async def test_legacy_receipt_keeps_oldest_actual_trade_freshness(test_db):
    rows = [_row("AAA"), _row("BBB")]
    for row in rows:
        row.extended_metrics.pop("market_session")
    rows[-1].trade_date = SESSION - timedelta(days=2)
    await _seed(test_db, rows, typed=False)

    cached = await CacheManager(db=test_db).get_screener_data()

    assert cached.hit and cached.is_stale
    assert cached.market_session_counts is None
    assert cached.freshness_basis == "verified_universe_oldest_trade_date"


@pytest.mark.asyncio
@pytest.mark.parametrize("membership", ["missing_receipt_member", "extra_receipt_member", "missing_partition_row"])
async def test_session_evidence_never_replaces_exact_membership_receipt(test_db, membership):
    rows = [_row("AAA"), _row("BBB")]
    expected = ["AAA"] if membership == "missing_receipt_member" else ["AAA", "BBB", "CCC"]
    if membership == "missing_partition_row":
        test_db.add(Stock(symbol="CCC", is_active=1))
    await _seed(test_db, rows, expected=expected)

    cached = await CacheManager(db=test_db).get_screener_data()

    assert not cached.hit
    assert cached.data is None


@pytest.mark.asyncio
async def test_full_active_universe_session_count_has_no_fixed_denominator(client, test_db):
    rows = [_row(f"S{index:04}", ("traded", "no_trade", "suspended")[index % 3]) for index in range(1519)]
    await _seed(test_db, rows)

    response = await client.get("/api/v1/health/detailed")
    database = response.json()["components"]["database"]

    assert response.json()["status"] == "degraded"
    assert database["provider_session_coverage"]["verified"] is True
    assert database["market_data_coverage_verified"] is False
    assert "freshness_breach" not in database
    assert database["screener_verified_count"] == 1519
    assert database["screener_qualified_session_count"] == 1519
    assert sum(database["screener_session_counts"].values()) == 1519


@pytest.mark.asyncio
async def test_cache_write_preserves_native_session_evidence(test_db):
    record = _record("AAA", "no_trade")
    await CacheManager(db=test_db).store_screener_data([
        {"symbol": "AAA", "volume": 0, "market_session": record},
    ], source="vietcap_vnd")

    cached = await CacheManager(db=test_db).get_screener_data(symbol="AAA", source=None)

    assert cached.hit and not cached.is_stale
    assert cached.data[0].price is None
    assert cached.data[0].trade_date is None
    assert cached.data[0].extended_metrics["market_session"] == record


@pytest.mark.asyncio
@pytest.mark.parametrize("refresh", ["quote_less", "changed_quote", "changed_session"])
async def test_request_refresh_preserves_admitted_quote_and_session(test_db, refresh):
    row = _row("AAA")
    evidence = deepcopy(row.extended_metrics)
    await _seed(test_db, [row])
    admitted = await CacheManager(db=test_db).get_screener_data(allow_stale=False)
    assert admitted.hit and not admitted.is_stale
    payload = ScreenerData(symbol="AAA", pe=12).model_dump()
    if refresh == "changed_quote":
        payload.update(price=20000, volume=200, trade_date=SESSION)
    elif refresh == "changed_session":
        payload["market_session"] = _record("AAA", "no_trade")

    assert await CacheManager(db=test_db).store_screener_data([payload], source="VCI") == 1
    await test_db.refresh(row)
    cached = await CacheManager(db=test_db).get_screener_data(allow_stale=False)

    assert cached.hit and not cached.is_stale
    assert cached.market_session_counts == {"qualified": 1, "traded": 1, "no_trade": 0, "suspended": 0}
    assert (row.price, row.volume, row.trade_date, row.source, row.created_at) == (
        10000, 100, SESSION, "vietcap_vnd", OBSERVED.replace(tzinfo=None),
    )
    assert row.extended_metrics["market_session"] == evidence["market_session"]
    assert row.extended_metrics["price_unit"] == evidence["price_unit"]
    assert row.extended_metrics["price_source"] == evidence["price_source"]
    assert row.pe == 12

@pytest.mark.asyncio
async def test_admitted_quote_survives_cap_and_share_reconciliation(test_db):
    row = _row("AAA")
    evidence = deepcopy(row.extended_metrics["market_session"])
    await _seed(test_db, [row])
    manager = CacheManager(db=test_db)
    capital = {
        "market_cap": 5730, "market_cap_source": "issuer:capitalization",
        "market_cap_unit": "VND", "market_cap_currency": "VND",
        "market_cap_as_of": "2020-01-02", "share_basis": "outstanding",
        "outstanding_shares": 100, "shares_unit": "shares",
        "shares_as_of": "2020-01-02", "shares_source": "issuer:shares",
    }
    assert await manager.store_screener_data([
        {"symbol": "AAA", "price": 20000, "volume": 200, "trade_date": SESSION, **capital},
        {"symbol": "AAA", **capital, "market_cap": 6000},
    ], source="VCI") == 2
    await test_db.refresh(row)

    assert (row.price, row.volume, row.trade_date, row.created_at) == (
        10000, 100, SESSION, OBSERVED.replace(tzinfo=None),
    )
    assert row.extended_metrics["market_session"] == evidence
    assert row.extended_metrics["shares_outstanding_provenance"]["value"] == 100
    cap = row.extended_metrics["market_cap_provenance"]
    assert cap["status"] == "conflict" and row.market_cap is None
    assert {observation["value"] for observation in cap["observations"]} >= {5730, 6000}


@pytest.mark.asyncio
@pytest.mark.parametrize("receipt_kind", ["unrelated_member", "different_session", "legacy"])
async def test_request_quote_update_requires_matching_typed_admission(test_db, receipt_kind):
    row = _row("AAA")
    receipt = _receipt(["BBB"] if receipt_kind == "unrelated_member" else ["AAA"], typed=receipt_kind != "legacy")
    if receipt_kind == "different_session":
        receipt.additional_data["market_session_date"] = "2026-10-23"
    test_db.add_all([Stock(symbol="AAA", is_active=1), row, receipt])
    await test_db.commit()

    assert await CacheManager(db=test_db).store_screener_data([
        {"symbol": "AAA", "price": 10001, "volume": 101, "trade_date": SESSION, "pe": 12},
    ], source="VCI") == 1
    await test_db.refresh(row)

    assert (row.price, row.volume, row.trade_date, row.pe) == (10001, 101, SESSION, 12)


@pytest.mark.asyncio
async def test_typed_admission_does_not_freeze_unrelated_legacy_quote(test_db):
    admitted, legacy = _row("AAA"), _row("BBB")
    legacy.extended_metrics.pop("market_session")
    await _seed(test_db, [admitted])
    test_db.add_all([Stock(symbol="BBB", is_active=0), legacy])
    await test_db.commit()

    assert await CacheManager(db=test_db).store_screener_data([
        {"symbol": "AAA", "price": 20000, "volume": 200, "trade_date": SESSION, "pe": 12},
        {"symbol": "BBB", "price": 11000, "volume": 110, "trade_date": SESSION, "pe": 13},
    ], source="VCI") == 2
    await test_db.refresh(admitted)
    await test_db.refresh(legacy)

    assert (admitted.price, admitted.volume, admitted.pe) == (10000, 100, 12)
    assert (legacy.price, legacy.volume, legacy.pe) == (11000, 110, 13)


@pytest.mark.asyncio
@pytest.mark.parametrize("damage", ["missing_date", "unknown_unit", "unknown_source", "nonzero_volume", "current_date", "zero_price"])
async def test_nontraded_session_cannot_certify_unqualified_retained_price(test_db, damage):
    row = _row("AAA", "no_trade")
    if damage == "missing_date":
        row.trade_date = None
    elif damage == "unknown_unit":
        row.extended_metrics["price_unit"] = "unknown"
    elif damage == "unknown_source":
        row.extended_metrics["price_source"] = "unknown"
    elif damage == "nonzero_volume":
        row.volume = 1
    elif damage == "current_date":
        row.trade_date = SESSION
    elif damage == "zero_price":
        row.price = 0
    await _seed(test_db, [row])

    cached = await CacheManager(db=test_db).get_screener_data()

    assert cached.hit and cached.is_stale
    assert cached.market_session_counts["qualified"] == 0


@pytest.mark.asyncio
async def test_health_does_not_certify_unpublished_future_calendar(client, monkeypatch):
    from vnibb.api.v1 import health

    monkeypatch.setattr(health, "expected_market_session", lambda **_: date(2027, 1, 4))
    response = await client.get("/api/v1/health/detailed")
    calendar = response.json()["components"]["database"]["screener_calendar"]

    assert calendar["year"] == 2027
    assert calendar["exchange_calendar_verified"] is False
    assert calendar["sources"] == []


@pytest.mark.asyncio
@pytest.mark.parametrize("receipt_date", [None, "2026-10-23", "2026-10-27"])
async def test_typed_receipt_date_must_match_qualified_session(test_db, receipt_date):
    row = _row("AAA")
    receipt = _receipt([row.symbol])
    receipt.additional_data["market_session_date"] = receipt_date
    test_db.add_all([Stock(symbol=row.symbol, is_active=1), row, receipt])
    await test_db.commit()

    cached = await CacheManager(db=test_db).get_screener_data()

    assert cached.hit and cached.is_stale
    assert cached.market_session_counts["qualified"] == 1


@pytest.mark.asyncio
async def test_valid_session_not_rejected_only_for_previous_write_partition(test_db):
    row = _row("AAA")
    row.snapshot_date = SESSION - timedelta(days=1)
    receipt = _receipt([row.symbol])
    receipt.additional_data["snapshot_date"] = row.snapshot_date.isoformat()
    test_db.add_all([Stock(symbol=row.symbol, is_active=1), row, receipt])
    await test_db.commit()

    cached = await CacheManager(db=test_db).get_screener_data(allow_stale=False)

    assert cached.hit and not cached.is_stale
    assert cached.market_session_counts["qualified"] == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("damage", ["future_completion", "duplicate_members"])
async def test_invalid_completed_receipt_cannot_certify_source_sessions(test_db, damage):
    row = _row("AAA")
    receipt = _receipt([row.symbol])
    if damage == "future_completion":
        receipt.completed_at = OBSERVED.replace(tzinfo=None) + timedelta(days=1)
    else:
        receipt.additional_data["expected_symbols"] = [row.symbol, row.symbol]
        receipt.additional_data["expected_count"] = 2
    test_db.add_all([Stock(symbol=row.symbol, is_active=1), row, receipt])
    await test_db.commit()

    cached = await CacheManager(db=test_db).get_screener_data()

    assert not cached.hit
    assert cached.data is None


@pytest.mark.asyncio
async def test_legacy_current_quotes_preserve_existing_health_behavior(client, test_db):
    row = _row("AAA")
    row.extended_metrics.pop("market_session")
    await _seed(test_db, [row], typed=False)

    response = await client.get("/api/v1/health/detailed")
    database = response.json()["components"]["database"]

    assert response.json()["status"] == "healthy"
    assert database["screener_freshness_basis"] == "verified_universe_oldest_trade_date"
    assert database["provider_session_coverage"] is None
    assert database["market_data_coverage_verified"] is False
    assert "freshness_breach" not in database


@pytest.mark.asyncio
@pytest.mark.parametrize("case", ["traded", "no_trade", "suspended", "unknown_price", "stored_tamper", "wrong_scope", "raw_tamper", "null_session", "legacy"])
async def test_api_session_projection_qualifies_quote_before_certification_and_returns(monkeypatch, case):
    from vnibb.api.v1 import market, screener
    from vnibb.api.v1.market_heatmap import enrich_heatmap_rows

    row = _row("AAA", case if case in {"no_trade", "suspended"} else "traded")
    row.extended_metrics.update({"change_1d": 4.5, "perf_1w": 8.0})
    if case == "unknown_price":
        row = _row("AAA", "no_trade")
        row.price = row.trade_date = None
        row.extended_metrics.update({"change_1d": 4.5, "perf_1w": 8.0})
    elif case == "stored_tamper":
        row.price += 1
    elif case == "wrong_scope":
        row.extended_metrics["market_session"]["scope"] = "whole_market"
    elif case == "legacy":
        row.extended_metrics.pop("market_session")
    elif case == "raw_tamper":
        row.extended_metrics["market_session"]["raw"]["matchPrice"]["accumulatedVolume"] = 0
    elif case == "null_session":
        row.extended_metrics["market_session"] = None

    class SnapshotSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            pass

        async def execute(self, _):
            return SimpleNamespace(all=lambda: [(
                row.symbol, row.price, row.volume, row.trade_date,
                row.snapshot_date, row.created_at, row.extended_metrics,
            )])

    monkeypatch.setattr(market, "async_session_maker", SnapshotSession)
    projected = screener._to_screener_data_row(row)
    normalized = market._normalize_screener_row(row)
    loaded = (await market._load_latest_snapshot_metrics([row.symbol]))[row.symbol]
    expected_change = 4.5 if case in {"traded", "legacy"} else None
    certified = case in {"traded", "no_trade", "suspended", "unknown_price"}

    for result, change in (
        (projected.model_dump(), projected.change_1d),
        (normalized, normalized["change_pct"]),
        (loaded, loaded["change_pct"]),
    ):
        assert change == expected_change
        assert (result["market_session"] is not None) is certified
        if certified:
            assert set(result["market_session"]) == {"session_date", "status", "source", "scope"}
            assert result["market_session"]["scope"] == "vietcap_board"
        assert result["price"] == row.price

    assert projected.trade_date == row.trade_date
    assert normalized["constituent_date"] == row.trade_date
    assert loaded["trade_date"] == (row.trade_date.isoformat() if row.trade_date else None)
    assert ("market_session" in projected.model_fields_set) is (case != "legacy")
    assert projected.perf_1w == (8.0 if expected_change is not None else None)
    enriched = enrich_heatmap_rows([normalized], {}, {row.symbol: 99.0})[0]
    assert enriched["change_pct"] == expected_change
    movers = market._apply_snapshot_metrics_to_movers([
        {"symbol": row.symbol, "price_change_pct": 4.5, "price_change": 450},
    ], {row.symbol: loaded})
    assert movers[0]["price_change_pct"] == expected_change
