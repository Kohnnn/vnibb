"""Consumer-visible retrieval-selection checks shared by the SQLite and
PostgreSQL regressions for #255 (recent price selection) and #262 (corporate
timeline effective-date selection).

Both stores must select the same rows and report the same selection contract,
so the assertions live here once and each backend only supplies a seeded
session through the ``seed(collection, rows)`` callable.
"""

from datetime import date, timedelta

from vnibb.mcp import server

PRICE_DAYS = [date(year, 1, 2) for year in range(2020, 2026)]


def price_rows() -> list[dict]:
    return [
        {
            "id": ordinal,
            "stock_id": 1,
            "symbol": "FPT",
            "time": day,
            "interval": "1D",
            "open": 1.0 + ordinal,
            "high": 2.0 + ordinal,
            "low": 0.5 + ordinal,
            "close": 1.5 + ordinal,
            "volume": 1000 * ordinal,
            "source": "vietcap_vnd",
        }
        for ordinal, day in enumerate(PRICE_DAYS, start=1)
    ]


async def seed_rows(db, collection: str, rows: list[dict]) -> None:
    """Insert fixture rows through the ORM so model defaults are applied."""
    if collection == "stock_prices":
        db.add(server.COLLECTION_MODELS["stocks"](
            id=1, symbol="FPT", exchange="HOSE", is_active=1))
        await db.flush()
    db.add_all([server.COLLECTION_MODELS[collection](**row) for row in rows])
    await db.commit()


async def check_price_selection(seed) -> None:
    await seed("stock_prices", price_rows())

    latest = await server.get_symbol_prices("FPT", limit=3)
    assert [item["time"] for item in latest["items"]] == [
        "2023-01-02", "2024-01-02", "2025-01-02"]
    assert [item["id"] for item in latest["items"]] == [4, 5, 6]
    assert latest["row_count"] == len(latest["items"]) == 3
    assert latest["descending"] is False
    assert latest["source"] == "postgres:stock_prices"
    assert latest["retrieved_at"]
    assert latest["selection"]["order"] == "time_asc"
    assert latest["selection"]["limit_applies_to"] == "latest_retained_in_window"
    assert latest["selection"]["explicit_range"] is False
    assert latest["selection"]["retained_dates_are_source_dates"] is True
    assert latest["selection"]["freshness"].startswith("not_assessed")
    assert latest["selection"]["limit_saturated"] is True
    assert all(item["source"] == "vietcap_vnd" for item in latest["items"])
    assert all(item["id"] and item["volume"] for item in latest["items"])

    # A larger limit extends the same membership, chronological either way.
    larger = await server.get_symbol_prices("FPT", limit=5)
    assert [item["id"] for item in larger["items"]] == [2, 3, 4, 5, 6]

    # Presentation order is independent of membership: same latest 3 rows.
    newest_first = await server.get_symbol_prices("FPT", limit=3, descending=True)
    assert [item["id"] for item in newest_first["items"]] == [6, 5, 4]
    assert newest_first["selection"]["order"] == "time_desc"
    assert newest_first["selection"]["limit_applies_to"] == "latest_retained_in_window"
    assert {item["id"] for item in newest_first["items"]} == {
        item["id"] for item in latest["items"]}

    windowed = await server.get_symbol_prices(
        "FPT", start_date="2021-01-02", end_date="2024-01-02", limit=10)
    assert [item["id"] for item in windowed["items"]] == [2, 3, 4, 5]
    assert windowed["selection"]["explicit_range"] is True
    assert windowed["selection"]["limit_saturated"] is False

    # An explicit range wider than the cap keeps its newest observations only.
    capped = await server.get_symbol_prices(
        "FPT", start_date="2020-01-02", end_date="2025-01-02", limit=2)
    assert [item["id"] for item in capped["items"]] == [5, 6]
    assert capped["selection"]["limit_saturated"] is True
    assert capped["selection"]["limit_saturation_note"].startswith("the cap was met")

    capped_descending = await server.get_symbol_prices(
        "FPT", start_date="2020-01-02", end_date="2025-01-02", limit=2, descending=True)
    assert [item["id"] for item in capped_descending["items"]] == [6, 5]

    empty = await server.get_symbol_prices("FPT", limit=0)
    assert empty["row_count"] == 0 and empty["items"] == [] and empty["limit"] == 0

    whole = await server.get_symbol_prices("FPT", limit=260)
    assert whole["limit"] == 250 and whole["row_count"] == 6
    assert [item["id"] for item in whole["items"]] == [1, 2, 3, 4, 5, 6]
    assert whole["selection"]["limit_saturated"] is False


async def check_timeline_selection(seed) -> None:
    await seed("dividends", [
        {"id": 1, "symbol": "FPT", "exercise_date": None,
         "payment_date": date(2025, 1, 2), "cash_year": 2024, "issue_method": "cash"},
        {"id": 2, "symbol": "FPT", "exercise_date": None,
         "payment_date": date(2026, 1, 2), "cash_year": 2025, "issue_method": "cash"},
        {"id": 3, "symbol": "FPT", "exercise_date": date(2024, 6, 1),
         "payment_date": date(2024, 7, 1), "cash_year": 2023, "issue_method": "stock"},
        {"id": 4, "symbol": "FPT", "exercise_date": None, "payment_date": None,
         "cash_year": 2019, "issue_method": "cash"},
        # Same effective date: deterministic primary-key tie, lower id first.
        {"id": 10, "symbol": "TIE", "exercise_date": date(2025, 5, 5),
         "payment_date": None, "cash_year": 2024, "issue_method": "cash"},
        {"id": 11, "symbol": "TIE", "exercise_date": None,
         "payment_date": date(2025, 5, 5), "cash_year": 2024, "issue_method": "cash"},
        # Cross-category tie on one date.
        {"id": 21, "symbol": "XTIE", "exercise_date": None,
         "payment_date": date(2025, 2, 2), "cash_year": 2024, "issue_method": "cash"},
    ])
    await seed("company_events", [
        {"id": 5, "symbol": "FPT", "event_type": "AGM", "event_date": date(2025, 3, 1)},
        {"id": 6, "symbol": "FPT", "event_type": "split", "event_date": None},
        {"id": 20, "symbol": "XTIE", "event_type": "AGM", "event_date": date(2025, 2, 2)},
    ])
    await seed("insider_deals", [
        {"id": 7, "symbol": "FPT", "announce_date": date(2025, 4, 1), "deal_action": "BUY"},
        {"id": 22, "symbol": "XTIE", "announce_date": date(2025, 2, 2), "deal_action": "BUY"},
    ])

    # A payment-only dividend is selected by its own timeline date before the cap.
    newest = await server.get_corporate_timeline("FPT", limit=1)
    assert [item["date"] for item in newest["items"]] == ["2026-01-02"]
    assert newest["items"][0]["payload"]["id"] == 2

    prefix = await server.get_corporate_timeline("FPT", limit=2)
    assert [item["payload"]["id"] for item in prefix["items"]] == [2, 7]

    merged = await server.get_corporate_timeline("FPT", limit=30)
    ordered = merged["items"]
    assert [item["payload"]["id"] for item in ordered] == [2, 7, 5, 1, 3, 6, 4]
    assert [item["date"] for item in ordered] == [
        "2026-01-02", "2025-04-01", "2025-03-01", "2025-01-02",
        "2024-06-01", None, None]
    assert [item["kind"] for item in ordered] == [
        "dividend", "insider_deal", "company_event", "dividend",
        "dividend", "company_event", "dividend"]
    assert merged["row_count"] == 7
    assert merged["selection"]["order"] == "effective_date_desc"
    assert merged["selection"]["dividend_date_rule"] == "exercise_date, else payment_date"
    assert merged["selection"]["undated_candidate_count"] == 2

    # Exercise date outranks its own later payment date.
    stock_dividend = next(item for item in ordered if item["payload"]["id"] == 3)
    assert stock_dividend["date"] == "2024-06-01"
    assert stock_dividend["payload"]["payment_date"] == "2024-07-01"

    # Undated rows sort last and keep their raw date evidence.
    undated = next(item for item in ordered if item["payload"]["id"] == 4)
    assert undated["date"] is None
    assert undated["payload"]["exercise_date"] is None
    assert undated["payload"]["payment_date"] is None
    assert undated["payload"]["cash_year"] == 2019

    # Same effective date: primary-key order, not insertion order.
    tie = await server.get_corporate_timeline("TIE", limit=30)
    assert [item["payload"]["id"] for item in tie["items"]] == [10, 11]
    assert {item["date"] for item in tie["items"]} == {"2025-05-05"}

    # Cross-category tie: events, then dividends, then insider deals.
    cross = await server.get_corporate_timeline("XTIE", limit=30)
    assert [item["kind"] for item in cross["items"]] == [
        "company_event", "dividend", "insider_deal"]
    assert {item["date"] for item in cross["items"]} == {"2025-02-02"}

    repeated = await server.get_corporate_timeline("FPT", limit=30)
    assert [item["payload"]["id"] for item in repeated["items"]] == [
        item["payload"]["id"] for item in ordered]

    empty = await server.get_corporate_timeline("FPT", limit=0)
    assert empty["row_count"] == 0 and empty["items"] == [] and empty["limit"] == 0

    # The merged cap still bounds the newest rows across sources.
    await seed("company_events", [
        {"id": 100 + offset, "symbol": "VCB", "event_type": "AGM",
         "event_date": date(2020, 1, 1) + timedelta(days=10 * offset)}
        for offset in range(31)
    ])
    capped = await server.get_corporate_timeline("VCB", limit=30)
    assert capped["row_count"] == len(capped["items"]) == 30
    assert capped["items"][0]["date"] == "2020-10-27"
    assert capped["items"][-1]["date"] == "2020-01-11"
    dates = [item["date"] for item in capped["items"]]
    assert dates == sorted(dates, reverse=True)
