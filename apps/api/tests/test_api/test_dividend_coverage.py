import json
from datetime import date
from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker
from vnibb.mcp import server
from vnibb.models.news import CompanyEvent, Dividend
from vnibb.models.stock import Stock, StockPrice
from vnibb.services import ai_context_service

FIXTURE = json.loads((Path(__file__).parent / "fixtures/dividend_coverage.json").read_text())
DATE_FIELDS = ("event_date", "exercise_date", "ex_date", "record_date", "payment_date")


def stored(model, payload):
    return model(**{
        key: date.fromisoformat(value) if key in DATE_FIELDS and value else value
        for key, value in payload.items()
    })


async def seed_app_observations(db):
    fixture = FIXTURE["app_observations"]
    stock = Stock(id=1, symbol="HPG", exchange="HOSE")
    db.add(stock)
    await db.flush()
    price = fixture["stale_price_observation"]
    db.add(StockPrice(
        id=1, stock_id=1, symbol="HPG", interval="1D", source="vnstock_vnd:VCI",
        time=date.fromisoformat(price["time"]), open=price["close"], high=price["close"],
        low=price["close"], close=price["close"], volume=1000,
    ))
    db.add_all(stored(Dividend, row) for row in fixture["retained"])
    db.add_all(stored(CompanyEvent, row) for row in fixture["calendar"])
    await db.commit()


@pytest.mark.asyncio
async def test_old_history_discloses_newer_unreconciled_app_records_and_withholds_yield(client, test_db):
    await seed_app_observations(test_db)

    response = await client.get("/api/v1/equity/HPG/dividends?limit=1")

    assert response.status_code == 200
    body = response.json()
    coverage = body["meta"]["coverage"]
    assert body["error"] is None
    assert coverage["status"] == "partial"
    assert coverage["latest_covered_date"] == "2022-07-06"
    assert coverage["latest_covered_date_type"] == "payment_date"
    assert coverage["admitted_count"] == 3
    assert body["meta"]["last_data_date"] is None  # a payout date is not the source clock
    assert any(
        item["code"] == "unverified_event" and item["observed_date"] == "2026-05-11"
        and item["observed_date_type"] == "ex_date"
        for item in coverage["discrepancies"]
    )
    assert coverage["yield_unavailable_reason"] == "uncertified_payout_window_and_price_basis"
    row, = body["data"]
    assert row["ex_date"] == "2022-06-17"
    assert row["cash_dividend"] == 500 and row["currency"] == "VND"
    assert row["dividend_yield"] is None and row["annual_dps"] is None


@pytest.mark.asyncio
async def test_primary_notices_keep_exact_typed_dates_without_certifying_app_ex_or_payment(client, test_db):
    await seed_app_observations(test_db)
    test_db.add_all(stored(CompanyEvent, row) for row in FIXTURE["notices"]["events"])
    await test_db.commit()

    payload = (await client.get("/api/v1/equity/HPG/dividends")).json()
    signed = {row["source_event_id"]: row for row in payload["data"] if row["source_event_id"]}
    cash, stock, old_stock = (signed[key] for key in ("195102", "195426", "hpg-fy2024-stock-notice"))
    assert len(payload["data"]) == 6
    assert cash["type"] == "cash" and cash["stock_dividend"] is None
    assert (cash["fiscal_year"], cash["ex_date"], cash["record_date"], cash["payment_date"]) == (
        2025, None, "2026-05-12", "2026-06-03",
    )
    assert cash["published_at"] == "2026-05-04T09:22:27"
    assert cash["event_date"] is None and cash["status"] == "announced"
    assert cash["source_url"] == "https://vsdc.vn/vi/ad/195102"
    assert (stock["fiscal_year"], stock["stock_dividend"], stock["cash_dividend"]) == (2025, 10, None)
    assert (stock["published_at"], stock["ex_date"], stock["record_date"], stock["payment_date"]) == (
        "2026-05-11T16:45:48", None, "2026-05-26", None,
    )
    assert (old_stock["fiscal_year"], old_stock["ex_date"], old_stock["stock_dividend"]) == (
        2024, "2025-06-26", 20,
    )
    assert all(row["dividend_yield"] is None for row in payload["data"])
    assert payload["meta"]["coverage"]["status"] == "partial"
    assert payload["meta"]["coverage"]["discrepancy_count"] == 3


@pytest.mark.asyncio
async def test_explicit_identity_controls_revisions_and_aliases_before_row_limit(client, test_db):
    fixture = FIXTURE["synthetic"]
    for row in fixture["cases"]:
        test_db.add(stored(CompanyEvent, {
            **row, "symbol": "FPT", "raw_data": {**fixture["cash_evidence"], **row["raw_data"]},
        }))
    await test_db.commit()

    all_rows = (await client.get("/api/v1/equity/FPT/dividends?limit=10")).json()
    small = (await client.get("/api/v1/equity/FPT/dividends?limit=1")).json()
    assert small["data"] == all_rows["data"][:1]
    rows = {row["source_event_id"]: row for row in all_rows["data"]}
    assert set(rows) == {"first", "distinct", "duplicate"}
    assert len(all_rows["data"]) == 3
    assert rows["first"]["revision"] == 2 and rows["first"]["cash_dividend"] == 750
    assert rows["first"]["ex_date"] is None  # do not borrow the superseded ex-date
    assert rows["first"]["record_date"] == rows["distinct"]["record_date"]
    assert rows["first"]["event_date"] != rows["first"]["payment_date"]
    discrepancies = {item["source_event_id"]: item["code"] for item in small["meta"]["coverage"]["discrepancies"]}
    assert discrepancies == {
        "second": "cancelled_event", "currency": "unsupported_cash_basis", "dates": "conflicting_date_basis",
        "type": "unsupported_distribution_type", "no-status": "unverified_status",
        "other-issuer": "issuer_mismatch", "untyped-cash": "unsupported_cash_basis",
        "collision": "conflicting_observations", "revised-unspecified": "unverified_status",
    }


@pytest.mark.asyncio
async def test_dividend_mcp_and_assistant_share_admission_but_raw_tools_disclose_scope(
    client, test_db, test_engine, monkeypatch,
):
    await seed_app_observations(test_db)
    test_db.add(stored(CompanyEvent, FIXTURE["notices"]["events"][0]))
    await test_db.commit()
    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(server, "async_session_maker", sessions)
    monkeypatch.setattr(ai_context_service, "async_session_maker", sessions)

    async def available():
        return True

    monkeypatch.setattr(server, "check_database_connection", available)

    route = (await client.get("/api/v1/equity/HPG/dividends?limit=4")).json()
    admitted = await server.get_dividend_history("HPG", limit=4)
    assert admitted["coverage"] == route["meta"]["coverage"]
    assert admitted["items"] == route["data"]
    snapshot = await ai_context_service.AIContextService()._build_database_snapshot_direct("HPG")
    assert snapshot["dividends"]["coverage"] == admitted["coverage"]
    assert snapshot["dividends"]["recent_dividends"] == admitted["items"]
    assert "summary" not in snapshot["dividends"]
    timeline = await server.get_corporate_timeline("HPG", limit=1)
    assert timeline["dividend_scope"] == "unreconciled_observations"
    raw = await server.query_database_collection_data(collection="dividends", symbol="HPG")
    assert raw["dividend_scope"] == "unreconciled_observations"
    assert raw["items"][0]["exercise_date"] == "2022-06-17"
