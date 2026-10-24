"""Public MCP contracts exercised against persisted SQL rows, not read stubs."""

from copy import deepcopy
from datetime import date, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import JSON, insert
from sqlalchemy.ext.asyncio import async_sessionmaker
from vnibb.mcp import server

ORIGINAL_COLLECTIONS = (
    "stocks", "stock_prices", "stock_indices", "income_statements",
    "balance_sheets", "cash_flows", "financial_ratios", "company_news",
    "company_events", "dividends", "insider_deals", "foreign_trading",
    "order_flow_daily", "market_sectors", "sector_performance", "screener_snapshots",
)
REFERENCE_COLLECTIONS = ("companies", "shareholders", "officers", "subsidiaries")
COLLECTIONS = ORIGINAL_COLLECTIONS + REFERENCE_COLLECTIONS
FINANCIAL_COLLECTIONS = (
    "income_statements", "balance_sheets", "cash_flows", "financial_ratios",
)
DATE_FIELDS = {
    "stock_prices": "time", "stock_indices": "time", "company_events": "event_date",
    "dividends": "exercise_date", "insider_deals": "announce_date",
    "foreign_trading": "trade_date", "order_flow_daily": "trade_date",
    "sector_performance": "trade_date", "screener_snapshots": "snapshot_date",
    "companies": "listing_date", "shareholders": "as_of_date", "officers": "appointment_date",
}
DATE_TIME_FIELDS = {"company_news": "published_date"}
ADVERTISED = server.list_supported_collections()["collections"]
FILTER_CASES = [
    pytest.param(collection, field, id=f"{collection}-{field}")
    for collection, spec in ADVERTISED.items()
    for field in spec["allowed_filters"]
]
SORT_CASES = [
    pytest.param(collection, field, descending, id=f"{collection}-{field}-{'desc' if descending else 'asc'}")
    for collection, spec in ADVERTISED.items()
    for field in spec["allowed_sort_fields"]
    for descending in (False, True)
]
PERIOD_ALIASES = (
    ("year", "year"), ("annual", "year"), ("yearly", "year"), ("fy", "year"),
    ("quarter", "quarter"), ("quarterly", "quarter"), ("q", "quarter"),
    (" YEAR ", "year"), ("Annual", "year"), ("Quarterly", "quarter"),
)
PERCENT_FIELDS = (
    "roe", "roa", "roic", "gross_margin", "net_margin", "operating_margin",
    "revenue_growth", "earnings_growth", "debt_assets",
)
DEEP_EVIDENCE = {
    "ratio_units": dict.fromkeys(PERCENT_FIELDS, "percent"),
    "_financial_lineage": {"unit_metadata": {"interest_expense": {
        "label": "interest_expense", "source_unit": "VND", "value_unit": "VND",
    }}},
    "nested": {"child": {"child": {"child": {"child": {"child": {
        "leaf": [None, 0, False, {"text": "  audit\n" + "evidence " * 150,
                                  "url": "https://example.test/report?unit=VND&basis=consolidated"}],
    }}}}}},
}


def _column_value(column, ordinal):
    if isinstance(column.type, JSON):
        return DEEP_EVIDENCE
    python_type = column.type.python_type
    if python_type is datetime:
        return datetime(2026, 1, 1, 12, 30, 45, 123456) + timedelta(days=ordinal)
    if python_type is date:
        return date(2026, 1, 1) + timedelta(days=ordinal)
    if python_type is bool:
        return bool(ordinal % 2)
    if python_type is int:
        return ordinal
    if python_type is float:
        return ordinal + 0.25
    if python_type is Decimal:
        return Decimal(f"{ordinal}.25")
    if python_type is dict:
        return DEEP_EVIDENCE
    if python_type is str:
        value = f"{ordinal:03d}-{column.name}"
        return value[:column.type.length] if column.type.length else value
    raise AssertionError(f"Add fixture value for {column.name}: {column.type}")


def _row(collection, ordinal, **overrides):
    model = server.COLLECTION_MODELS[collection]
    values = {column.name: _column_value(column, ordinal) for column in model.__table__.columns}
    canonical = {
        "symbol": f"S{ordinal:03d}", "stock_id": 1000 + ordinal,
        "company_id": 1000 + ordinal, "exchange": "HOSE", "interval": "1D",
        "period_type": "year", "period": str(2020 + ordinal),
        "fiscal_year": 2020 + ordinal, "fiscal_quarter": (ordinal - 1) % 4 + 1,
        "source": "vietcap_vnd" if collection == "stock_prices" else "vietcap",
    }
    values.update({key: value for key, value in canonical.items() if key in values})
    if collection == "financial_ratios":
        values["interest_coverage"] = None
    values.update(overrides)
    if collection in {"income_statements", "balance_sheets", "cash_flows"} and "raw_data" not in overrides:
        statement_type = {"income_statements": "income", "balance_sheets": "balance", "cash_flows": "cashflow"}[collection]
        raw = deepcopy(DEEP_EVIDENCE)
        units = {
            column.name: {"label": column.name, "unit": "VND/share" if column.name in {"eps", "eps_diluted", "book_value_per_share"} else "VND",
                          "source_unit": "VND/share" if column.name in {"eps", "eps_diluted", "book_value_per_share"} else "VND"}
            for column in model.__table__.columns if column.type.python_type in (float, Decimal)
        }
        raw["_financial_lineage"] = {"canonical_data": {
            **{name: values[name] for name in ("symbol", "period", "fiscal_year", "fiscal_quarter", "source")},
            "statement_type": statement_type, "currency": "VND", "value_unit": "VND",
            "consolidation_basis": "consolidated",
            "flow_basis": "single_quarter" if values["period_type"] == "quarter" else "annual",
            "unit_metadata": units,
        }}
        values["raw_data"] = raw
    return values


def _json_value(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, int) and not isinstance(value, bool) and abs(value) > 2**53 - 1:
        return str(value)
    if isinstance(value, dict):
        return {key: _json_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_value(item) for item in value]
    return value


def _expected_filters(collection, **filters):
    if collection in FINANCIAL_COLLECTIONS:
        filters["admitted_sources"] = ["vietcap", "VCI"]
    return filters


@pytest.fixture
async def sql_tool(monkeypatch, test_engine, test_db):
    monkeypatch.setattr(server, "async_session_maker", async_sessionmaker(test_engine, expire_on_commit=False))

    async def available():
        return True

    monkeypatch.setattr(server, "check_database_connection", available)

    async def seed(collection, rows):
        if collection in {"stock_prices", "shareholders", "officers"}:
            parent = "stocks" if collection == "stock_prices" else "companies"
            key = "stock_id" if parent == "stocks" else "company_id"
            parents = {}
            for row in rows:
                symbol = row["symbol"]
                if symbol not in parents:
                    parents[symbol] = _row(parent, row[key], id=row[key], symbol=symbol)
                row[key] = parents[symbol]["id"]
            await test_db.execute(insert(server.COLLECTION_MODELS[parent]), list(parents.values()))
        await test_db.execute(insert(server.COLLECTION_MODELS[collection]), rows)
        await test_db.commit()

    return seed


def test_public_collection_metadata_matches_sql_constraints():
    assert set(ADVERTISED) == set(COLLECTIONS)
    assert len(ORIGINAL_COLLECTIONS) == 16
    assert len(set(DATE_FIELDS) & set(ORIGINAL_COLLECTIONS)) == 9
    for collection, spec in ADVERTISED.items():
        columns = server.COLLECTION_MODELS[collection].__table__.columns
        assert set(spec["allowed_filters"]) <= set(columns.keys())
        assert set(spec["allowed_sort_fields"]) <= set(columns.keys())
        assert spec["default_order"] in spec["allowed_sort_fields"]
        assert spec["date_field"] == {**DATE_FIELDS, **DATE_TIME_FIELDS}.get(collection)
        if spec["date_field"]:
            expected_type = datetime if collection in DATE_TIME_FIELDS else date
            assert columns[spec["date_field"]].type.python_type is expected_type
        assert spec["guardrails"]["read_only"] is True
        assert spec["guardrails"]["max_limit"] == spec["max_limit"]
    assert ADVERTISED["screener_snapshots"]["allowed_filters"] == ("symbol", "exchange", "industry")
    assert "value" not in ADVERTISED["screener_snapshots"]["allowed_sort_fields"]
    assert {"total_volume", "total_value"} <= set(ADVERTISED["sector_performance"]["allowed_sort_fields"])


@pytest.mark.asyncio
@pytest.mark.parametrize("collection,null_field", [
    ("stocks", "isin"), ("stock_prices", "value"), ("stock_indices", "value"),
    ("income_statements", "fiscal_quarter"), ("balance_sheets", "fiscal_quarter"),
    ("cash_flows", "fiscal_quarter"), ("financial_ratios", "fiscal_quarter"),
    ("company_news", "summary"), ("company_events", "event_date"),
    ("dividends", "exercise_date"), ("insider_deals", "deal_method"),
    ("foreign_trading", "buy_volume"), ("order_flow_daily", "buy_volume"),
    ("market_sectors", "sector_name_en"), ("sector_performance", "change_pct"),
    ("screener_snapshots", "trade_date"), ("companies", "company_name"),
    ("shareholders", "shareholder_type"), ("officers", "title"),
    ("subsidiaries", "subsidiary_symbol"),
])
async def test_public_sql_preserves_complete_model_rows_after_early_null(sql_tool, collection, null_field):
    row = _row(collection, 1, **{null_field: None})
    await sql_tool(collection, [row])

    result = await server.query_database_collection(collection=collection, limit=1)

    assert result["collection"] == collection
    assert result["source"] == f"postgres:{collection}"
    assert result["row_count"] == len(result["items"]) == 1
    actual = result["items"][0]
    columns = set(server.COLLECTION_MODELS[collection].__table__.columns.keys())
    annotations = set()
    if collection == "stock_prices":
        annotations = {"price_unit"}
        assert actual["price_unit"] == "VND"
    elif collection in {"income_statements", "balance_sheets", "cash_flows"}:
        annotations = {
            "currency", "value_unit", "unit_metadata", "consolidation_basis",
            "flow_basis", "aggregation_basis", "source_periods", "unavailable_reason",
        }
        assert actual["currency"] == actual["value_unit"] == "VND"
        assert actual["consolidation_basis"] == "consolidated"
        assert actual["flow_basis"] == "annual"
        assert actual["unavailable_reason"] is None
    elif collection == "financial_ratios":
        annotations = {"dividend_yield", "payout_ratio"}
        assert actual["dividend_yield"] is actual["payout_ratio"] is None
    assert set(actual) == columns | annotations
    assert actual[null_field] is None
    assert {key: actual[key] for key in columns} == _json_value(row)


@pytest.mark.asyncio
@pytest.mark.parametrize("collection,zero_metric,value_metric", [
    ("income_statements", "revenue", "interest_expense"),
    ("balance_sheets", "total_assets", "total_equity"),
    ("cash_flows", "operating_cash_flow", "investing_cash_flow"),
    ("financial_ratios", "roe", "eps"),
])
async def test_public_financial_sql_preserves_admitted_zero_null_and_deep_evidence(
    sql_tool, collection, zero_metric, value_metric
):
    populated = _row(collection, 1, fiscal_quarter=None, **{zero_metric: 0, value_metric: 1.25})
    sparse = _row(collection, 2, fiscal_quarter=None)
    columns = server.COLLECTION_MODELS[collection].__table__.columns
    sparse.update({column.name: None for column in columns if column.nullable})
    await sql_tool(collection, [populated, sparse])

    result = await server.query_database_collection(collection=collection, limit=20)

    assert result["row_count"] == len(result["items"]) == 2
    assert result["source"] == f"postgres:{collection}"
    by_id = {item["id"]: item for item in result["items"]}
    assert by_id[1][zero_metric] == 0
    assert by_id[1][value_metric] == 1.25
    assert by_id[1]["period"] == "2021"
    assert by_id[1]["fiscal_quarter"] is None
    assert by_id[1]["raw_data"] == populated["raw_data"]
    assert by_id[1].get("data_status", "available") == "available"
    assert by_id[2][zero_metric] is None
    assert by_id[2][value_metric] is None
    assert by_id[2]["raw_data"] is None
    if collection != "financial_ratios":
        for column in columns:
            if column.type.python_type in (float, Decimal):
                assert by_id[1][column.name] == populated[column.name]
        assert by_id[1]["currency"] == by_id[1]["value_unit"] == "VND"
        assert by_id[1]["consolidation_basis"] == "consolidated"


@pytest.mark.asyncio
@pytest.mark.parametrize("collection,metric", [
    ("income_statements", "revenue"), ("balance_sheets", "total_assets"),
    ("cash_flows", "operating_cash_flow"),
])
@pytest.mark.parametrize("rejection", [
    "currency", "flow_basis", "unit_metadata", "inherited", "lineage_inherited",
    "source", "symbol", "statement_type", "period", "metric_rejected",
])
async def test_statement_sql_projects_admission_without_replacing_identity_or_raw(
    sql_tool, collection, metric, rejection,
):
    row = _row(collection, 1, symbol="FPT", fiscal_quarter=None, **{metric: 0})
    raw = row["raw_data"]
    canonical = raw["_financial_lineage"]["canonical_data"]
    if rejection in {"currency", "flow_basis", "unit_metadata"}:
        canonical[rejection] = {} if rejection == "unit_metadata" else None
        if collection == "balance_sheets" and rejection == "flow_basis":
            canonical["consolidation_basis"] = None
    elif rejection == "inherited":
        canonical["unavailable_reason"] = "retained_rejection"
    elif rejection == "lineage_inherited":
        raw["_financial_lineage"]["unavailable_reason"] = "retained_rejection"
    elif rejection == "metric_rejected":
        canonical["unit_metadata"][metric]["unavailable_reason"] = "retained_metric_rejection"
    else:
        canonical[rejection] = {"source": "KBS", "symbol": "MSR", "statement_type": "other", "period": "2024"}[rejection]
    await sql_tool(collection, [row])

    result = await server.query_database_collection(collection, symbol="FPT", period_type="annual", limit=1)

    actual = result["items"][0]
    assert actual[metric] is None
    assert actual["raw_observation"][metric] == 0
    assert actual["unavailable_metrics"][metric]
    assert actual["raw_data"] == raw
    assert (actual["symbol"], actual["period"], actual["fiscal_year"], actual["fiscal_quarter"], actual["source"]) == ("FPT", "2021", 2021, None, "vietcap")
    if rejection not in {"unit_metadata", "metric_rejected"}:
        for column in server.COLLECTION_MODELS[collection].__table__.columns:
            if column.type.python_type in (float, Decimal):
                assert actual[column.name] is None
    if rejection in {"inherited", "lineage_inherited"}:
        assert actual["unavailable_reason"] == "retained_rejection"
        assert actual["value_unit"] == "VND"
    if rejection == "metric_rejected":
        assert actual["unavailable_metrics"][metric] == "retained_metric_rejection"


@pytest.mark.asyncio
@pytest.mark.parametrize("unit,expected", [("VND/share", 12.5), ("VND", None)])
async def test_statement_sql_book_value_requires_explicit_per_share_unit(sql_tool, unit, expected):
    row = _row("balance_sheets", 1, fiscal_quarter=None, book_value_per_share=12.5)
    metadata = row["raw_data"]["_financial_lineage"]["canonical_data"]["unit_metadata"]
    metadata["book_value_per_share"].update(unit=unit, source_unit=unit)
    await sql_tool("balance_sheets", [row])

    actual = (await server.query_database_collection("balance_sheets", limit=1))["items"][0]

    assert actual["book_value_per_share"] == expected
    assert actual["raw_data"] == row["raw_data"]
    if expected is None:
        assert actual["unavailable_metrics"]["book_value_per_share"] == "unverified_monetary_unit"


@pytest.mark.asyncio
@pytest.mark.parametrize("evidence", [
    {"unit": "VND", "source_unit": "VND", "unavailable_reason": "retained_alias_rejection"},
    {"unit": "USD", "source_unit": "USD"},
])
async def test_statement_sql_alias_metadata_cannot_erase_canonical_rejection(sql_tool, evidence):
    row = _row("income_statements", 1, fiscal_quarter=None, income_before_tax=25)
    row["raw_data"]["_financial_lineage"]["canonical_data"]["unit_metadata"]["pre_tax_profit"] = evidence
    await sql_tool("income_statements", [row])

    actual = (await server.query_database_collection("income_statements", limit=1))["items"][0]

    assert actual["income_before_tax"] is None
    assert actual["unavailable_metrics"]["income_before_tax"]
    assert actual["raw_observation"]["income_before_tax"] == 25
    assert actual["raw_data"] == row["raw_data"]


@pytest.mark.asyncio
async def test_public_sql_preserves_more_than_twenty_nested_original_envelopes_and_counts(sql_tool):
    original_response = {
        "count": 25,
        "data": {"records": [{"index": index, "value": None if index == 0 else index}
                             for index in range(25)]},
    }
    rows = [
        _row("income_statements", ordinal, period="2025", fiscal_year=2025,
             fiscal_quarter=None, raw_data={**DEEP_EVIDENCE,
                                           "original_response": original_response,
                                           "record_index": ordinal})
        for ordinal in range(1, 3)
    ]
    await sql_tool("income_statements", rows)

    result = await server.query_database_collection(
        "income_statements", limit=2, sort_by="fiscal_year", descending=False,
    )

    assert result["row_count"] == len(result["items"]) == len(rows) == 2
    assert [item["id"] for item in result["items"]] == [1, 2]
    for actual, expected in zip(result["items"], rows, strict=True):
        assert actual["raw_data"] == expected["raw_data"]
        envelope = actual["raw_data"]["original_response"]
        assert envelope == original_response
        assert envelope["count"] == len(envelope["data"]["records"]) == 25


@pytest.mark.asyncio
@pytest.mark.parametrize("collection,field", FILTER_CASES)
async def test_every_advertised_filter_constrains_real_rows_and_reports_normalized_value(sql_tool, collection, field):
    values = {
        "symbol": ("S001", "S002", " s001 "),
        "exchange": ("HOSE", "HNX", " hose "),
        "interval": ("1D", "1W", " 1d "),
        "period_type": ("year", "quarter", " annual "),
        "index_code": ("VNINDEX", "VN30", " vnindex "),
        "industry": ("Technology", "Banking", " Technology "),
        "sector": ("Financials", "Industrials", " Financials "),
        "source": ("vietcap", "VCI", " vietcap "),
        "event_type": ("dividend", "meeting", " dividend "),
    }
    matching, contrasting, requested = values[field]
    await sql_tool(collection, [_row(collection, 1, **{field: matching}), _row(collection, 2, **{field: contrasting})])

    result = await server.query_database_collection(collection=collection, **{field: requested})

    assert [item["id"] for item in result["items"]] == [1]
    assert result["row_count"] == 1
    assert result["items"][0][field] == matching
    assert result["filters_applied"] == _expected_filters(
        collection, **{field: matching}, sort_by=ADVERTISED[collection]["default_order"],
        descending=ADVERTISED[collection]["default_desc"],
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("collection,field,descending", SORT_CASES)
async def test_every_advertised_sort_orders_real_values_and_keeps_primary_key_ties_stable(sql_tool, collection, field, descending):
    column = server.COLLECTION_MODELS[collection].__table__.columns[field]
    low, high = _column_value(column, 1), _column_value(column, 3)
    rows = [_row(collection, 3, **{field: high}), _row(collection, 2, **{field: low}), _row(collection, 1, **{field: low})]
    if column.primary_key or column.unique:
        rows = [_row(collection, 3, **{field: high}), _row(collection, 1, **{field: low})]
    await sql_tool(collection, rows)

    result = await server.query_database_collection(collection=collection, sort_by=field, descending=descending)
    repeated = await server.query_database_collection(collection=collection, sort_by=field, descending=descending)

    expected_ids = [3, 1, 2] if descending else [1, 2, 3]
    if column.primary_key or column.unique:
        expected_ids = [3, 1] if descending else [1, 3]
    assert [item["id"] for item in result["items"]] == expected_ids
    assert [item["id"] for item in repeated["items"]] == expected_ids
    expected_values = sorted([row[field] for row in rows], reverse=descending)
    assert [item[field] for item in result["items"]] == _json_value(expected_values)
    assert result["row_count"] == len(rows)
    assert result["filters_applied"] == _expected_filters(collection, sort_by=field, descending=descending)


DATE_BOUND_CASES = (
    (None, None, [1, 2, 3, 4]),
    ("2026-01-02", None, [2, 3, 4]),
    (None, "2026-01-03", [1, 2, 3]),
    ("2026-01-02", "2026-01-03", [2, 3]),
    ("2026-01-03", "2026-01-03", [3]),
    ("2026-01-03", "2026-01-02", None),
    ("2026-02-30", None, None),
    (None, "2026-02-30", None),
    ("02/01/2026", None, None),
    (None, "2026-01-03T12:00:00", None),
)


@pytest.mark.asyncio
@pytest.mark.parametrize("collection,field", [*DATE_FIELDS.items(), *DATE_TIME_FIELDS.items()])
@pytest.mark.parametrize("start,end,expected_ids", DATE_BOUND_CASES)
async def test_public_sql_date_bounds_are_inclusive_and_invalid_ranges_raise(sql_tool, collection, field, start, end, expected_ids):
    is_datetime = collection in DATE_TIME_FIELDS
    days = [date(2026, 1, day) for day in range(1, 5)]
    moments = [datetime.combine(day, datetime.min.time()) for day in days]
    if is_datetime:
        moments[2] = datetime.combine(days[2], datetime.max.time())
    rows = [_row(collection, ordinal, **{field: moments[ordinal - 1] if is_datetime else days[ordinal - 1]}) for ordinal in range(1, 5)]
    await sql_tool(collection, rows)
    arguments = {"collection": collection, "start_date": start, "end_date": end, "sort_by": field, "descending": False}

    if expected_ids is None:
        with pytest.raises(ValueError):
            await server.query_database_collection(**arguments)
        return

    result = await server.query_database_collection(**arguments)

    assert [item["id"] for item in result["items"]] == expected_ids
    assert [item[field] for item in result["items"]] == [_json_value(rows[index - 1][field]) for index in expected_ids]
    expected_filters = {"sort_by": field, "descending": False}
    if start is not None:
        expected_filters["start_date"] = start
    if end is not None:
        expected_filters["end_date"] = end
    assert result["filters_applied"] == expected_filters
    assert result["row_count"] == len(expected_ids)


@pytest.mark.asyncio
@pytest.mark.parametrize("collection", [name for name in COLLECTIONS if name not in DATE_FIELDS and name not in DATE_TIME_FIELDS])
@pytest.mark.parametrize("bound", ["start_date", "end_date"])
async def test_public_sql_rejects_unadvertised_date_bounds(sql_tool, collection, bound):
    await sql_tool(collection, [_row(collection, 1)])
    with pytest.raises(ValueError, match="does not support date range"):
        await server.query_database_collection(collection=collection, **{bound: "2026-01-01"})


@pytest.mark.asyncio
@pytest.mark.parametrize("collection", FINANCIAL_COLLECTIONS)
@pytest.mark.parametrize("alias,canonical", PERIOD_ALIASES)
async def test_fiscal_aliases_select_exact_lowercase_persisted_periods(sql_tool, collection, alias, canonical):
    periods = ("year", "quarter", "yearly", "quarterly", "YEAR", "QUARTER", "ttm")
    rows = [_row(collection, ordinal, symbol="FPT", period_type=period) for ordinal, period in enumerate(periods, 1)]
    await sql_tool(collection, rows)

    result = await server.query_database_collection(collection=collection, symbol=" fpt ", period_type=alias)

    expected_id = 1 if canonical == "year" else 2
    assert [item["id"] for item in result["items"]] == [expected_id]
    assert result["items"][0]["period_type"] == canonical
    assert result["filters_applied"] == _expected_filters(
        collection, symbol="FPT", period_type=canonical,
        sort_by=ADVERTISED[collection]["default_order"], descending=ADVERTISED[collection]["default_desc"],
    )
    if collection == "financial_ratios":
        latest = await server.get_latest_financial_ratios("FPT", period_type=alias)
    else:
        statement = {"income_statements": "income_statement", "balance_sheets": "balance_sheet", "cash_flows": "cash_flow"}[collection]
        latest = await server.get_latest_financial_statement("FPT", statement=statement, period_type=alias)
    assert latest["found"] is True
    assert latest["period_type"] == canonical
    assert latest["item"]["id"] == expected_id
    columns = server.COLLECTION_MODELS[collection].__table__.columns.keys()
    assert {key: latest["item"][key] for key in columns} == _json_value(rows[expected_id - 1])


@pytest.mark.asyncio
@pytest.mark.parametrize("collection", FINANCIAL_COLLECTIONS)
@pytest.mark.parametrize("unsupported", ["ttm", "TTM", " trailing ", "monthly", "q1", "year-to-date"])
async def test_unsupported_fiscal_periods_raise_instead_of_returning_misleading_empty_rows(sql_tool, collection, unsupported):
    await sql_tool(collection, [_row(collection, 1, symbol="FPT", period_type="year")])
    with pytest.raises(ValueError, match="Unsupported period_type"):
        await server.query_database_collection(collection=collection, symbol="FPT", period_type=unsupported)
    with pytest.raises(ValueError, match="Unsupported period_type"):
        if collection == "financial_ratios":
            await server.get_latest_financial_ratios("FPT", period_type=unsupported)
        else:
            statement = {"income_statements": "income_statement", "balance_sheets": "balance_sheet", "cash_flows": "cash_flow"}[collection]
            await server.get_latest_financial_statement("FPT", statement=statement, period_type=unsupported)


@pytest.mark.asyncio
@pytest.mark.parametrize("limit", [0, 1, 19, 20, 21, 60, 250, 260])
async def test_dedicated_price_tool_returns_all_requested_full_rows_up_to_cap(sql_tool, limit):
    rows = [_row("stock_prices", ordinal, symbol="FPT", value=None if ordinal == 1 else ordinal + 0.25)
            for ordinal in range(1, 261)]
    await sql_tool("stock_prices", rows)

    result = await server.get_symbol_prices(" fpt ", interval="1d", limit=limit)

    expected_count = min(limit, 250)
    assert result["row_count"] == len(result["items"]) == expected_count
    assert result["limit"] == expected_count
    assert result["max_limit"] == 250
    assert result["symbol"] == "FPT"
    assert result["interval"] == "1D"
    assert [item["id"] for item in result["items"]] == list(range(1, expected_count + 1))
    columns = server.COLLECTION_MODELS["stock_prices"].__table__.columns.keys()
    for expected, actual in zip(rows[:expected_count], result["items"], strict=True):
        assert {key: actual[key] for key in columns} == _json_value(expected)


@pytest.mark.asyncio
@pytest.mark.parametrize("limit", [0, 1, 19, 20, 21, 60, 250])
async def test_dedicated_news_tool_returns_full_text_and_columns_up_to_cap(sql_tool, limit):
    rows = [_row("company_news", ordinal, symbol="FPT", summary="  full news\n" + "evidence " * 150)
            for ordinal in range(1, 61)]
    await sql_tool("company_news", rows)

    result = await server.get_company_news(" fpt ", limit=limit)

    expected_count = min(limit, 25)
    assert result["row_count"] == len(result["items"]) == expected_count
    assert result["limit"] == expected_count
    assert result["max_limit"] == 25
    assert [item["id"] for item in result["items"]] == list(range(60, 60 - expected_count, -1))
    columns = server.COLLECTION_MODELS["company_news"].__table__.columns.keys()
    for expected, actual in zip(list(reversed(rows))[:expected_count], result["items"], strict=True):
        assert {key: actual[key] for key in columns} == _json_value(expected)


@pytest.mark.asyncio
@pytest.mark.parametrize("limit", [0, 1, 19, 20, 21, 30, 60, 250])
async def test_dedicated_corporate_timeline_preserves_all_payload_columns_and_merged_cap(sql_tool, limit):
    expected = []
    kinds = (("company_events", "company_event", "event_date"),
             ("dividends", "dividend", "exercise_date"),
             ("insider_deals", "insider_deal", "announce_date"))
    for offset, (collection, kind, field) in enumerate(kinds):
        rows = [_row(collection, ordinal, symbol="FPT",
                     **{field: date(2026, 1, 1) + timedelta(days=ordinal * 3 + offset)})
                for ordinal in range(1, 13)]
        await sql_tool(collection, rows)
        expected.extend((row[field], kind, collection, row) for row in rows)
    expected.sort(key=lambda item: item[0], reverse=True)

    result = await server.get_corporate_timeline(" fpt ", limit=limit)

    expected_count = min(limit, 30)
    assert result["row_count"] == len(result["items"]) == expected_count
    assert result["limit"] == expected_count
    assert result["max_limit"] == 30
    for (day, kind, collection, row), item in zip(expected[:expected_count], result["items"], strict=True):
        assert item["kind"] == kind
        assert item["date"] == day.isoformat()
        columns = server.COLLECTION_MODELS[collection].__table__.columns.keys()
        assert {key: item["payload"][key] for key in columns} == _json_value(row)
