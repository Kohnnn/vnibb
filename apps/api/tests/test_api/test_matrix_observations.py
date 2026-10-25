from datetime import date, datetime
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from vnibb.api.v1.matrix import router
from vnibb.core.database import get_db
from vnibb.models.financials import BalanceSheet, CashFlow, IncomeStatement
from vnibb.models.stock import Stock, StockPrice
from vnibb.models.trading import FinancialRatio
from vnibb.schemas.matrix import MatrixEvidence
from vnibb.services import matrix_service
from vnibb.services.matrix_observations import (
    ObservationBuilder,
    build_matrix_fixture,
    build_matrix_observations,
    canonical_decimal,
    display_decimal,
    prepare_matrix,
    retained_close_reference,
)
from vnibb.services.matrix_playbooks import classify_sector

CAPTURED = "2025-01-01T00:00:00+00:00"


@pytest.fixture(autouse=True)
def retained_mongo_is_opt_in(monkeypatch):
    monkeypatch.setattr("vnibb.services.matrix_observations.get_mongo_market_data_service", lambda: SimpleNamespace(enabled=False))
    monkeypatch.delenv("MATRIX_EXPORT_ALLOWED_SOURCES", raising=False)


def statement(model, *, year=2024, quarter=None, metadata=None, **values):
    return model(
        id=year * 10 + (quarter or 0),
        symbol="MXA",
        period=f"Q{quarter}-{year}" if quarter else str(year),
        period_type="quarter" if quarter else "year",
        fiscal_year=year,
        fiscal_quarter=quarter,
        source="test_seed",
        updated_at=datetime(2025, 1, 1),
        raw_data=metadata if metadata is not None else {"unit": "VND", "consolidation": "consolidated", "flow_basis": "single_quarter"},
        **values,
    )


def cell(result, entity, dimension):
    return next(item for item in result["cells"] if item["entity_id"] == entity and item["dimension_id"] == dimension)


def metric(result_cell, key):
    return next(item for item in result_cell["payload"]["metrics"] if item["key"] == key)


@pytest.mark.parametrize("value,canonical,display", [
    (Decimal("-1234567.895"), "-1234567.895", "-1,234,567.90 VND"),
    (Decimal("0.000"), "0", "0.00 VND"),
    (Decimal("1000.000"), "1000", "1,000.00 VND"),
    (float("nan"), None, "Unavailable"),
])
def test_decimal_values_and_display_preserve_signed_values(value, canonical, display):
    assert canonical_decimal(value) == canonical
    assert display_decimal(canonical, "VND") == display


@pytest.mark.parametrize("denominator,metadata,reason", [
    (0, None, "denominator must be positive"),
    (-1, None, "denominator must be positive"),
    (100, {}, "unit or accounting scope is unknown"),
    (100, {"unit": "VND"}, "unit or accounting scope is unknown"),
])
def test_derivations_withhold_unsafe_denominators_and_missing_basis(denominator, metadata, reason):
    row = statement(IncomeStatement, revenue=denominator, net_income=-10, metadata=metadata)
    builder = ObservationBuilder("MXA", "2024", {(IncomeStatement, False): row}, CAPTURED)
    profit = builder.observe(IncomeStatement, "net_income", "Net profit")
    revenue = builder.observe(IncomeStatement, "revenue", "Revenue")
    derived = builder.derive("margin", "Margin", [profit, revenue], "ratio", "%")
    assert derived["value"] is None
    assert reason in derived["basis"]
    assert derived["evidence_ids"] == []


def test_negative_numerator_and_exact_frozen_lineage_are_preserved():
    row = statement(IncomeStatement, revenue=100, net_income=-12.345)
    builder = ObservationBuilder("MXA", "2024", {(IncomeStatement, False): row}, CAPTURED)
    profit = builder.observe(IncomeStatement, "net_income", "Net profit")
    revenue = builder.observe(IncomeStatement, "revenue", "Revenue")
    derived = builder.derive("margin", "Margin", [profit, revenue], "ratio", "%")
    row.net_income = 999
    assert profit["value"] == "-12.345"
    assert derived["display"] == "-12.35%"
    evidence = builder.evidence[derived["evidence_ids"][0]]
    assert evidence["input_evidence_ids"] == [*profit["evidence_ids"], *revenue["evidence_ids"]]
    assert builder.evidence[profit["evidence_ids"][0]]["locator"] == "income_statements/row/20240/period/year/2024"
    assert builder.evidence[profit["evidence_ids"][0]]["field"] == "net_income"


def test_different_scopes_and_units_are_not_comparable():
    income = statement(IncomeStatement, net_income=10)
    balance = statement(BalanceSheet, total_equity=100, metadata={"unit": "billion VND", "consolidation": "standalone"})
    builder = ObservationBuilder("MXA", "2024", {(IncomeStatement, False): income, (BalanceSheet, False): balance}, CAPTURED)
    profit = builder.observe(IncomeStatement, "net_income", "Profit")
    equity = builder.observe(BalanceSheet, "total_equity", "Equity")
    result = builder.derive("return", "Return", [profit, equity], "ratio", "%")
    assert result["value"] is None
    assert "differ" in result["basis"]


@pytest.mark.parametrize("industry,family,subtype", [
    (None, None, None), ("Other financial services", None, None),
    ("Ngân hàng", "bank", None), ("Securities", "securities", None),
    ("Bảo hiểm phi nhân thọ", "insurer", "non-life"),
    ("Software", "nonfinancial", None),
])
def test_unknown_classification_never_defaults_to_nonfinancial(industry, family, subtype):
    assert classify_sector(industry) == (family, subtype)


@pytest.mark.asyncio
@pytest.mark.parametrize("playbook,industry,dimension,expected_key", [
    ("nonfinancial", "Software", "growth", "revenue"),
    ("bank", "Banks", "capital", "equity_assets"),
    ("insurer", "Non-life insurance", "profitability", "net_income"),
    ("securities", "Securities", "profitability", "total_equity"),
])
async def test_each_playbook_builds_real_stored_observations(test_db, playbook, industry, dimension, expected_key):
    try:
        for index, symbol in enumerate(("MXA", "MXB")):
            test_db.add(Stock(id=990001 + index, symbol=symbol, company_name=f"Test {symbol}", industry=industry, sector=industry, is_active=1))
            for model, fields in ((IncomeStatement, {"revenue": 100, "net_income": -10}), (BalanceSheet, {"total_assets": 500, "total_equity": 100, "short_term_debt": 10, "long_term_debt": 20}), (CashFlow, {"operating_cash_flow": 25}), (FinancialRatio, {"pe_ratio": 10, "pb_ratio": 2})):
                row = statement(model, **fields)
                row.id, row.symbol = 990001 + index, symbol
                test_db.add(row)
        await test_db.flush()
        built = await build_matrix_observations(test_db, ["MXA", "MXB"], playbook, "2024", "year")
        observed = metric(cell(built, "MXA", dimension), expected_key)
        assert observed["value"] is not None
        assert observed["evidence_ids"]
        assert cell(built, "MXA", dimension)["state"] == "supported"
        assert cell(built, "MXA", "sources")["evidence_ids"] == []
        assert cell(built, "MXA", "artifact")["state"] == "unavailable"
        if playbook == "bank":
            assert observed["value"] == "20"
            assert metric(cell(built, "MXA", "credit"), "nim")["value"] is None
            assert metric(cell(built, "MXA", "funding"), "customer_loans")["value"] is None
        if playbook == "insurer":
            assert metric(cell(built, "MXA", "insurance"), "insurance_premiums")["value"] is None
        if playbook == "securities":
            assert metric(cell(built, "MXA", "securities"), "brokerage_revenue")["value"] is None
    finally:
        await test_db.rollback()


@pytest.mark.asyncio
@pytest.mark.parametrize("source,close,expected_value,expected_unit,state", [
    ("vnstock_vnd:VCI", 72400, "72400", "VND", "non_comparable"),
    ("VCI", 72.4, "72400", "VND", "non_comparable"),
    ("vnstock", 72.4, "72.4", "unknown unit", "non_comparable"),
])
async def test_stored_close_uses_certified_source_units_and_daily_interval(
    test_db, source, close, expected_value, expected_unit, state,
):
    try:
        test_db.add(Stock(id=990001, symbol="MXA", industry="Software", is_active=1))
        test_db.add(StockPrice(
            id=995200, stock_id=990001, symbol="MXA", time=date(2024, 12, 30), interval="1D",
            open=close, high=close, low=close, close=close, volume=100,
            source=source, created_at=datetime(2025, 1, 1),
        ))
        test_db.add(StockPrice(
            id=995201, stock_id=990001, symbol="MXA", time=date(2024, 12, 31), interval="1W",
            open=999, high=999, low=999, close=999, volume=100,
            source="vnstock_vnd", created_at=datetime(2025, 1, 1),
        ))
        await test_db.flush()

        built = await build_matrix_observations(test_db, ["MXA"], "nonfinancial", "2024", "year")

        stored = cell(built, "MXA", "stored_close")
        observed = metric(stored, "close")
        evidence = next(item for item in built["evidence"] if item["evidence_id"] == observed["evidence_ids"][0])
        assert stored["state"] == state
        assert observed["value"] == expected_value
        assert observed["unit"] == expected_unit
        assert observed["as_of"] == "2024-12-30"
        assert evidence["source"] == f"stored.sql.stock_prices:{source}"
        assert evidence["unit"] == expected_unit
        assert evidence["value"] == expected_value
        assert any("Price scale" in limit for limit in evidence["limitations"]) == (expected_unit == "unknown unit")
        assert "observation_reference" not in evidence
    finally:
        await test_db.rollback()


@pytest.mark.asyncio
async def test_quarter_growth_uses_prior_year_same_quarter_not_annual_or_adjacent(test_db):
    try:
        test_db.add(Stock(id=990001, symbol="MXA", industry="Software", is_active=1))
        for year, quarter, revenue in ((2024, 2, 120), (2023, 2, 100), (2024, 1, 50), (2023, None, 1000)):
            test_db.add(statement(IncomeStatement, year=year, quarter=quarter, revenue=revenue, net_income=10))
        await test_db.flush()
        built = await build_matrix_observations(test_db, ["MXA"], "nonfinancial", "2024-Q2", "quarter")
        growth = metric(cell(built, "MXA", "growth"), "revenue_yoy")
        assert growth["value"] == "20"
        assert growth["period"] == "2024-Q2"
        direct_inputs = [item for item in built["evidence"] if item["field"] == "revenue"]
        assert {item["period"] for item in direct_inputs} == {"2024-Q2", "2023-Q2"}
    finally:
        await test_db.rollback()


@pytest.mark.asyncio
async def test_peers_exclude_unrelated_same_exchange_and_intersect_years(test_db):
    try:
        for index, (symbol, industry, years) in enumerate((("MXA", "Software", (2023, 2024)), ("MXB", "Software", (2023,)), ("MXC", "Banks", (2024,)))):
            test_db.add(Stock(id=990001 + index, symbol=symbol, industry=industry, exchange="HOSE", is_active=1))
            for year in years:
                row = statement(IncomeStatement, year=year, revenue=100)
                row.id, row.symbol = 990000 + index * 100 + year, symbol
                test_db.add(row)
        await test_db.flush()
        prepared = await prepare_matrix(test_db, "MXA")
        assert prepared["symbols"] == ["MXA", "MXB"]
        assert prepared["periods"] == ["2023"]
    finally:
        await test_db.rollback()


@pytest.mark.asyncio
async def test_prepare_exposes_per_symbol_years_and_independent_quarters(test_db):
    try:
        for index, (symbol, years, quarters) in enumerate((
            ("MXA", (2024, 2025), (1, 2)),
            ("MXB", (2024, 2025), (1,)),
            ("MXC", (2024,), (1,)),
        )):
            test_db.add(Stock(id=990001 + index, symbol=symbol, industry="Software", is_active=1))
            for year in years:
                row = statement(IncomeStatement, year=year, revenue=100)
                row.id, row.symbol = 991000 + index * 100 + year, symbol
                test_db.add(row)
            for quarter in quarters:
                row = statement(IncomeStatement, year=2025, quarter=quarter, net_income=10)
                row.id, row.symbol = 992000 + index * 100 + quarter, symbol
                test_db.add(row)
        await test_db.flush()
        app = FastAPI()
        app.include_router(router, prefix="/matrix")

        async def database():
            yield test_db

        app.dependency_overrides[get_db] = database
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://matrix.test") as client:
            response = await client.get("/matrix/prepare", params={"anchor_symbol": "MXA"})
        assert response.status_code == 200
        prepared = response.json()
        assert prepared["symbols"] == ["MXA", "MXB", "MXC"]
        assert prepared["periods"] == ["2024"]
        assert prepared["periods_by_symbol"] == {
            "MXA": {"year": ["2025", "2024"], "quarter": ["2025-Q2", "2025-Q1"]},
            "MXB": {"year": ["2025", "2024"], "quarter": ["2025-Q1"]},
            "MXC": {"year": ["2024"], "quarter": ["2025-Q1"]},
        }
    finally:
        await test_db.rollback()


@pytest.mark.asyncio
async def test_manual_eleventh_peer_periods_and_ineligible_scope(test_db):
    try:
        symbols = ["MXA", *(f"MX{index}" for index in range(10)), "MXZ"]
        for index, symbol in enumerate(symbols):
            test_db.add(Stock(id=990001 + index, symbol=symbol, industry="Software", is_active=1))
            for quarter in (None, 2):
                row = statement(IncomeStatement, year=2025, quarter=quarter, revenue=100)
                row.id, row.symbol = 990100 + index * 10 + (quarter or 0), symbol
                test_db.add(row)
        test_db.add(Stock(id=990100, symbol="MXBANK", industry="Banks", is_active=1))
        test_db.add(Stock(id=990101, symbol="MXEMPTY", industry="Software", is_active=1))
        test_db.add(Stock(id=990102, symbol="MXRETAIL", industry="Retail", is_active=1))
        for symbol, row_id in (("MXBANK", 991000), ("MXRETAIL", 991001)):
            row = statement(IncomeStatement, year=2025, quarter=2, revenue=100)
            row.id, row.symbol = row_id, symbol
            test_db.add(row)
        await test_db.flush()
        app = FastAPI()
        app.include_router(router, prefix="/matrix")

        async def database():
            yield test_db

        app.dependency_overrides[get_db] = database
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://matrix.test") as client:
            preparation = (await client.get("/matrix/prepare", params={"anchor_symbol": "MXA"})).json()
            assert "MXZ" not in preparation["symbols"]
            response = await client.get("/matrix/periods", params=[("anchor_symbol", "MXA"), ("symbols", "MXA"), ("symbols", "MXZ")])
            assert response.status_code == 200
            assert response.json()["periods_by_symbol"] == {
                symbol: {"year": ["2025"], "quarter": ["2025-Q2"]} for symbol in ("MXA", "MXZ")
            }
            empty = await client.get("/matrix/periods", params=[("anchor_symbol", "MXA"), ("symbols", "MXA"), ("symbols", "MXEMPTY")])
            assert empty.status_code == 200
            assert empty.json()["periods_by_symbol"]["MXEMPTY"] == {"year": [], "quarter": []}
            for invalid in ("MXBANK", "MXRETAIL", "MISSING"):
                rejected = await client.get("/matrix/periods", params=[("anchor_symbol", "MXA"), ("symbols", "MXA"), ("symbols", invalid)])
                assert rejected.status_code == 422
        with pytest.raises(ValueError, match="classification"):
            await build_matrix_observations(test_db, ["MXA", "MXBANK"], "nonfinancial", "2025-Q2", "quarter", "MXA")
        built = await build_matrix_observations(test_db, ["MXA", "MXZ"], "nonfinancial", "2025-Q2", "quarter", "MXA")
        assert {entity["symbol"] for entity in built["entities"]} == {"MXA", "MXZ"}
        annual = await matrix_service.create_matrix_snapshot(test_db, "matrix-owner", {"anchor_symbol": "MXA", "symbols": ["MXA", "MXZ"], "playbook_id": "nonfinancial", "period": "2025", "period_type": "year"})
        quarterly = await matrix_service.create_matrix_snapshot(test_db, "matrix-owner", {"anchor_symbol": "MXA", "symbols": ["MXA", "MXZ"], "playbook_id": "nonfinancial", "period": "2025-Q2", "period_type": "quarter"})
        assert {entity["symbol"] for entity in annual["entities"]} == {"MXA", "MXZ"}
        assert quarterly["period"] == "2025-Q2"
    finally:
        await test_db.rollback()


def test_fixture_distinguishes_inventory_evidence_and_all_truthful_states():
    fixture = build_matrix_fixture()
    snapshot = fixture["snapshot"]
    assert snapshot["synthetic"] is True
    assert cell(snapshot, "DEMO_A", "number")["payload"]["metrics"][0]["display"] == "-1,234,567.90 VND"
    assert cell(snapshot, "DEMO_A", "source_set")["evidence_ids"] == []
    assert cell(snapshot, "DEMO_A", "artifact")["payload"]["artifact_ref"] is None
    assert {item["state"] for item in snapshot["cells"]} == {"supported", "unavailable", "non_comparable", "failed", "denied"}
    assert build_matrix_fixture() == fixture


@pytest.mark.asyncio
async def test_different_company_scopes_and_undated_valuation_are_noncomparable(test_db):
    try:
        for index, (symbol, scope) in enumerate((("MXA", "consolidated"), ("MXB", "standalone"))):
            test_db.add(Stock(id=990001 + index, symbol=symbol, industry="Software", is_active=1))
            for model, fields in ((IncomeStatement, {"revenue": 100, "net_income": 10}), (FinancialRatio, {"pe_ratio": 12, "pb_ratio": 2})):
                row = statement(model, metadata={"unit": "VND", "consolidation": scope}, **fields)
                row.id, row.symbol = 990001 + index, symbol
                test_db.add(row)
        await test_db.flush()
        result = await build_matrix_observations(test_db, ["MXA", "MXB"], "nonfinancial", "2024", "year")
        for symbol in ("MXA", "MXB"):
            assert cell(result, symbol, "growth")["state"] == "non_comparable"
            assert cell(result, symbol, "valuation")["state"] == "non_comparable"
        revenue_evidence = next(item for item in result["evidence"] if item["field"] == "revenue")
        assert revenue_evidence["source"] == "stored.sql.income_statements:test_seed"
    finally:
        await test_db.rollback()


def test_quarter_flow_basis_is_not_inferred_from_period_label():
    row = statement(IncomeStatement, quarter=2, revenue=100, net_income=10, metadata={"unit": "VND", "consolidation": "consolidated"})
    builder = ObservationBuilder("MXA", "2024-Q2", {(IncomeStatement, False): row}, CAPTURED)
    profit = builder.observe(IncomeStatement, "net_income", "Profit")
    revenue = builder.observe(IncomeStatement, "revenue", "Revenue")
    margin = builder.derive("margin", "Margin", [profit, revenue], "ratio", "%")
    assert margin["value"] is None
    assert "unknown quarterly flow basis" in profit["basis"]


def test_currency_metadata_cannot_label_bank_ratio_as_money():
    row = statement(FinancialRatio, roe=15)
    builder = ObservationBuilder("MXA", "2024", {(FinancialRatio, False): row}, CAPTURED)
    roe = builder.observe(FinancialRatio, "roe", "ROE")
    assert roe["unit"] == "unknown unit"
    assert roe["value"] == "15"


def test_exact_close_reference_requires_every_retained_field_and_keeps_numeric_identity():
    row = {"symbol": "MXA", "tradeDate": datetime(2024, 12, 30, 7), "close": Decimal("9007199254740993.125"), "priceUnit": "VND", "source": "vietcap", "sourceKey": "vietcap:MXA:eod:2024-12-30"}
    reference = retained_close_reference(row, "MXA", CAPTURED)
    assert reference == {
        "symbol": "MXA", "trade_date": "2024-12-30", "value": "9007199254740993.125", "currency": "VND", "price_unit": "VND",
        "source": "vietcap", "source_key": "vietcap:MXA:eod:2024-12-30", "collection": "market_prices_eod",
        "observation_revision": reference["observation_revision"], "retrieved_at": CAPTURED,
    }
    assert len(reference["observation_revision"]) == 64
    for key in ("symbol", "tradeDate", "close", "priceUnit", "source", "sourceKey"):
        assert retained_close_reference({name: value for name, value in row.items() if name != key}, "MXA", CAPTURED) is None
    for key, value in (("symbol", "MXB"), ("tradeDate", "not-a-date"), ("close", float("nan")), ("priceUnit", "THOUSAND_VND"), ("source", ""), ("sourceKey", "")):
        assert retained_close_reference({**row, key: value}, "MXA", CAPTURED) is None
    assert retained_close_reference(row, "MXA", "2026-01-01T00:00:00Z")["observation_revision"] == reference["observation_revision"]
    assert retained_close_reference({**row, "close": Decimal("9007199254740993.126")}, "MXA", CAPTURED)["observation_revision"] != reference["observation_revision"]


@pytest.mark.asyncio
@pytest.mark.parametrize("rights_verified", [False, True])
async def test_retained_mongo_close_freezes_exact_citation_and_display(test_db, monkeypatch, rights_verified):
    if rights_verified:
        monkeypatch.setenv("MATRIX_EXPORT_ALLOWED_SOURCES", "stored.mongo.market_prices_eod:vietcap")
    async def retained(*args, **kwargs):
        assert kwargs == {"start_date": date(2024, 1, 1), "end_date": date(2024, 12, 31), "limit": 370, "include_provenance": True}
        return [{"symbol": "MXA", "tradeDate": datetime(2024, 12, 30, 7), "close": Decimal("9007199254740993.125"), "priceUnit": "VND", "source": "vietcap", "sourceKey": "vietcap:MXA:eod:2024-12-30"}]

    monkeypatch.setattr("vnibb.services.matrix_observations.get_mongo_market_data_service", lambda: SimpleNamespace(enabled=True, get_eod_prices_between=retained))
    test_db.add(Stock(id=990001, symbol="MXA", industry="Software", is_active=1))
    await test_db.flush()
    built = await build_matrix_observations(test_db, ["MXA"], "nonfinancial", "2024", "year")
    close = cell(built, "MXA", "stored_close")
    observed = metric(close, "close")
    evidence = next(item for item in built["evidence"] if item["evidence_id"] == observed["evidence_ids"][0])
    assert close["state"] == ("supported" if rights_verified else "non_comparable")
    assert observed["display"] == f"{observed['value']} VND" == "9007199254740993.125 VND"
    assert evidence["observation_reference"]["value"] == observed["value"]
    assert MatrixEvidence.model_validate(evidence).observation_state == ("exact" if rights_verified else "rights_unverified")
    with pytest.raises(ValueError, match="every frozen"):
        MatrixEvidence.model_validate({**evidence, "value": "1"})
    await test_db.rollback()


@pytest.mark.asyncio
@pytest.mark.parametrize("sql_day,mongo_day,complete,expected_value,expected_date,has_reference", [
    (31, 30, True, "110", "2024-12-31", False),
    (30, 30, True, "100", "2024-12-30", True),
    (29, 30, True, "100", "2024-12-30", True),
    (29, 30, False, None, "2024-12-30", False),
])
async def test_stored_close_selects_latest_trade_date_before_metadata_completeness(
    test_db, monkeypatch, sql_day, mongo_day, complete, expected_value, expected_date, has_reference,
):
    row = {"symbol": "MXA", "tradeDate": datetime(2024, 12, mongo_day, 7), "close": 100, "priceUnit": "VND", "source": "vietcap"}
    if complete:
        row["sourceKey"] = f"vietcap:MXA:eod:2024-12-{mongo_day}"
    async def retained(*args, **kwargs):
        return [row]
    monkeypatch.setattr("vnibb.services.matrix_observations.get_mongo_market_data_service", lambda: SimpleNamespace(enabled=True, get_eod_prices_between=retained))
    try:
        test_db.add(Stock(id=990001, symbol="MXA", industry="Software", is_active=1))
        test_db.add(StockPrice(
            id=995200, stock_id=990001, symbol="MXA", time=date(2024, 12, sql_day), interval="1D",
            open=110, high=110, low=110, close=110, volume=100,
            source="vnstock_vnd:VCI", created_at=datetime(2025, 1, 1),
        ))
        await test_db.flush()
        built = await build_matrix_observations(test_db, ["MXA"], "nonfinancial", "2024", "year")
        close = cell(built, "MXA", "stored_close")
        observed = metric(close, "close")
        assert observed["value"] == expected_value
        assert observed["as_of"] == expected_date
        selected = [item for item in built["evidence"] if item["evidence_id"] in close["evidence_ids"]]
        assert any(item.get("observation_reference") for item in selected) == has_reference
        if expected_value is None:
            assert close["state"] == "unavailable" and not selected
        elif not has_reference:
            assert selected[0]["source"] == "stored.sql.stock_prices:vnstock_vnd:VCI"
            assert close["state"] == "non_comparable"
    finally:
        await test_db.rollback()


@pytest.mark.asyncio
@pytest.mark.parametrize("outcome", ["empty", "incomplete", "failure"])
async def test_missing_or_unreadable_close_never_gains_exact_reference(test_db, monkeypatch, outcome):
    from vnibb.services.mongo_market_data_service import MongoReadError

    async def retained(*args, **kwargs):
        if outcome == "failure":
            raise MongoReadError("unavailable")
        return [] if outcome == "empty" else [{"symbol": "MXA", "tradeDate": datetime(2024, 12, 30), "close": 10, "priceUnit": "VND", "source": "vietcap"}]

    monkeypatch.setattr("vnibb.services.matrix_observations.get_mongo_market_data_service", lambda: SimpleNamespace(enabled=True, get_eod_prices_between=retained))
    test_db.add(Stock(id=990001, symbol="MXA", industry="Software", is_active=1))
    await test_db.flush()
    built = await build_matrix_observations(test_db, ["MXA"], "nonfinancial", "2024", "year")
    close = cell(built, "MXA", "stored_close")
    assert close["state"] == ("failed" if outcome == "failure" else "unavailable")
    assert metric(close, "close")["value"] is None
    assert close["evidence_ids"] == []
    assert ("not an empty result" in close["limitations"][0]) == (outcome == "failure")
    await test_db.rollback()


@pytest.mark.asyncio
async def test_bank_regulatory_dimensions_are_unavailable_without_accounting_proxies(test_db):
    test_db.add(Stock(id=990001, symbol="MXA", industry="Banks", is_active=1))
    test_db.add(statement(BalanceSheet, total_assets=500, total_equity=100, metadata={"unit": "VND", "consolidation": "consolidated", "customer_deposits": 200}))
    await test_db.flush()
    built = await build_matrix_observations(test_db, ["MXA"], "bank", "2024", "year")
    regulatory = cell(built, "MXA", "regulatory")
    assert regulatory["state"] == "unavailable"
    metrics = regulatory["payload"]["metrics"]
    assert {item["key"] for item in metrics} == {"car", "cet1", "tier1", "rwa", "reported_npl", "npl_coverage", "regulatory_ldr", "regulatory_liquidity"}
    for item in metrics:
        assert item["value"] is None and item["display"] == "Unavailable" and item["evidence_ids"] == []
        basis = item["regulatory_basis"]
        assert basis["circular_versions"] and basis["source_urls"]
        assert all(basis[key] is None for key in ("method", "perimeter", "observation_date", "reported_or_derived"))
    await test_db.rollback()


def test_nonfinancial_playbook_never_omits_a_dimension_and_missing_baseline_is_not_zero():
    from vnibb.services.matrix_observations import _financial_metrics

    builder = ObservationBuilder("MXA", "2024", {(IncomeStatement, False): statement(IncomeStatement, revenue=100, net_income=0)}, CAPTURED)
    metrics = _financial_metrics(builder, "nonfinancial")
    assert set(metrics) == {"growth", "profitability", "cash", "leverage", "valuation"}
    assert next(item for item in metrics["growth"] if item["key"] == "revenue_yoy")["value"] is None
    revenue = metrics["growth"][0]
    mismatched = {**revenue, "period": "2023"}
    derived = builder.derive("margin", "Margin", [revenue, mismatched], "ratio", "%")
    assert derived["value"] is None
    assert "fiscal periods differ" in derived["basis"]
    from vnibb.services.matrix_observations import _metric_cell

    derived["basis"] = "Comparison blocked without English mismatch keywords"
    assert "margin" in builder.incompatible_metrics
    assert _metric_cell("MXA", "profitability", [revenue, derived], compatible=False)["state"] == "non_comparable"
    absent = {**derived, "basis": "Input labels differ, but one input is simply absent"}
    assert _metric_cell("MXA", "profitability", [revenue, absent])["state"] == "supported"
