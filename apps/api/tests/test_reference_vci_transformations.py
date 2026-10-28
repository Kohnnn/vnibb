"""Offline regression: pytest tests/test_reference_vci_transformations.py."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
import vnibb.services.data_pipeline as pipeline_module
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from vnibb.core.exceptions import ProviderError
from vnibb.providers.vnstock.company_events import (
    CompanyEventsQueryParams,
    VnstockCompanyEventsFetcher,
)
from vnibb.providers.vnstock.company_news import (
    CompanyNewsQueryParams,
    VnstockCompanyNewsFetcher,
)
from vnibb.providers.vnstock.officers import OfficersQueryParams, VnstockOfficersFetcher
from vnibb.providers.vnstock.shareholders import ShareholdersQueryParams, VnstockShareholdersFetcher
from vnibb.providers.vnstock.subsidiaries import (
    SubsidiariesQueryParams,
    VnstockSubsidiariesFetcher,
)
from vnibb.services.data_pipeline import DataPipeline

# SDK 4.0.9 company.py officers/subsidiaries rename maps and snake-case events/news
# output; news/event key names also occur in retained native VCI records.
CASES = [
    ("officers", VnstockOfficersFetcher, OfficersQueryParams, {
        "officer_name": "Example director", "officer_position": "Director",
        "officer_own_quantity": 0, "officer_own_percent": 0,
    }, {"name": "Example director", "position": "Director", "shares_owned": 0, "ownership_pct": None}),
    ("subsidiaries", VnstockSubsidiariesFetcher, SubsidiariesQueryParams, {
        "organ_name": "Example subsidiary", "ownership_percent": 0,
        "sub_organ_code": "SUB", "type": "subsidiary",
    }, {"company_name": "Example subsidiary", "ownership_pct": None,
        "subsidiary_symbol": "SUB", "relationship_type": "subsidiary"}),
    ("company_news", VnstockCompanyNewsFetcher, CompanyNewsQueryParams, {
        "news_title": "Issuer announcement", "news_source": "Issuer",
        "news_source_link": "https://example.test/announcement",
        "news_short_content": "Board resolution", "news_full_content": "Full resolution",
        "news_category_code": "CBTT", "public_date": "2026-10-15T09:30:00",
        "news_id": 0,
    }, {"title": "Issuer announcement", "source": "Issuer",
        "url": "https://example.test/announcement", "summary": "Board resolution",
        "category": "CBTT", "published_at": "2026-10-15T09:30:00", "news_id": 0}),
    ("company_events", VnstockCompanyEventsFetcher, CompanyEventsQueryParams, {
        "id": 123, "event_code": "DIV", "event_name_vi": "Cổ tức bằng tiền",
        "event_title_vi": "Trả cổ tức bằng tiền", "public_date": "2026-10-14",
        "exright_date": "2026-10-15", "record_date": "2026-10-16",
        "payout_date": "2026-10-30", "value_per_share": 0,
    }, {"event_type": "DIV", "event_name": "Trả cổ tức bằng tiền",
        "description": "Cổ tức bằng tiền", "event_date": "2026-10-14",
        "ex_date": "2026-10-15", "record_date": "2026-10-16",
        "payment_date": "2026-10-30", "value": "0", "cash_amount_per_share": None}),
]


@pytest.mark.parametrize("dataset,fetcher,params_type,row,expected", CASES)
def test_installed_vci_rows_preserve_business_fields(dataset, fetcher, params_type, row, expected):
    items = fetcher.transform_data(params_type(symbol="vnm"), [row])
    assert len(items) == 1
    payload = items[0].model_dump()
    assert {key: payload[key] for key in expected} == expected
    if dataset == "company_events":
        assert payload["raw_data"] == row


@pytest.mark.parametrize("dataset,fetcher,params_type,row,expected", CASES)
@pytest.mark.parametrize("mixed", [False, True])
def test_nonempty_unrecognized_rows_fail_whole_batch(dataset, fetcher, params_type, row, expected, mixed):
    rows = [row, {"unexpected_schema": "value"}] if mixed else [{"unexpected_schema": "value"}]
    with pytest.raises(ProviderError):
        fetcher.transform_data(params_type(symbol="VNM"), rows)
    assert fetcher.transform_data(params_type(symbol="VNM"), []) == []


@pytest.mark.parametrize("dataset,fetcher,params_type,row,expected", CASES)
@pytest.mark.asyncio
async def test_public_fetch_does_not_hide_unrecognized_rows(monkeypatch, dataset, fetcher, params_type, row, expected):
    monkeypatch.setattr(fetcher, "extract_data", AsyncMock(return_value=[{"unexpected_schema": "value"}]))
    with pytest.raises(ProviderError):
        await fetcher.fetch(params_type(symbol="VNM"))


@pytest.mark.parametrize("dataset,fetcher,params_type,row,expected", CASES)
@pytest.mark.parametrize("invalid", ["", "  ", "Unknown", "Untitled", "NaN", None])
def test_placeholder_identity_is_not_valid_reference_data(dataset, fetcher, params_type, row, expected, invalid):
    key = {"officers": "officer_name", "subsidiaries": "organ_name", "company_news": "news_title", "company_events": "event_title_vi"}[dataset]
    broken = {**row, key: invalid}
    if dataset == "company_events":
        broken["event_name_vi"] = invalid
    with pytest.raises(ProviderError):
        fetcher.transform_data(params_type(symbol="VNM"), [broken])


@pytest.mark.parametrize("dataset,fetcher,params_type,row,expected", CASES)
@pytest.mark.asyncio
async def test_real_writer_rejects_invalid_identity_before_replacing_rows(
    monkeypatch, dataset, fetcher, params_type, row, expected,
):
    engine = create_async_engine("sqlite+aiosqlite://")
    tables = {
        "officers": ("officers", "name", "'Existing director'"),
        "subsidiaries": ("subsidiaries", "subsidiary_name", "'Existing subsidiary'"),
        "company_news": ("company_news", "title", "'Existing article'"),
        "company_events": ("company_events", "event_type", "'DIV'"),
    }
    table, identity, original = tables[dataset]
    # A minimal real SQL table is sufficient: invalid input must never reach DML.
    async with engine.begin() as conn:
        await conn.execute(text(f"CREATE TABLE {table} (symbol TEXT, {identity} TEXT)"))
        await conn.execute(text(f"INSERT INTO {table} VALUES ('VNM', {original})"))
    monkeypatch.setattr(pipeline_module, "async_session_maker", async_sessionmaker(engine))
    monkeypatch.setattr(fetcher, "extract_data", AsyncMock(return_value=[]))
    bad = {"symbol": "VNM", "published_at": "2026-10-15", "event_date": "2026-10-15"}
    monkeypatch.setattr(fetcher, "transform_data", lambda params, rows: [SimpleNamespace(model_dump=lambda: bad)])
    instance = DataPipeline()
    monkeypatch.setattr(instance, "_wait_for_rate_limit", AsyncMock())
    monkeypatch.setattr(instance, "_get_or_create_company_id", AsyncMock(return_value=1))
    progress = {}
    try:
        assert await getattr(instance, f"sync_{dataset}")(symbols=["VNM"], progress=progress) == 0
        assert progress["stage_stats"][dataset]["errors"] == 1
        assert "identity" in progress["errors"][0]["error"].lower()
        async with engine.connect() as conn:
            assert (await conn.execute(text(f"SELECT {identity} FROM {table}"))).scalar_one() == original.strip("'")
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_news_writer_does_not_invent_publication_date(monkeypatch):
    monkeypatch.setattr(VnstockCompanyNewsFetcher, "extract_data", AsyncMock(return_value=[{"news_title": "Undated article"}]))
    session_factory = AsyncMock(side_effect=AssertionError("undated news must not open SQL session"))
    monkeypatch.setattr(pipeline_module, "async_session_maker", session_factory)
    instance = DataPipeline()
    monkeypatch.setattr(instance, "_wait_for_rate_limit", AsyncMock())
    progress = {}
    assert await instance.sync_company_news(symbols=["VNM"], progress=progress) == 0
    assert progress["error_count"] == 1
    session_factory.assert_not_called()


@pytest.mark.parametrize("dataset,fetcher,params_type,row,expected", CASES)
@pytest.mark.asyncio
async def test_installed_vci_rows_reach_sql_without_placeholders(monkeypatch, dataset, fetcher, params_type, row, expected):
    engine = create_async_engine("sqlite+aiosqlite://")
    ddl = {
        "officers": "company_id INTEGER, symbol TEXT, name TEXT, title TEXT, position_type TEXT, shares_held FLOAT, ownership_pct FLOAT, created_at DATETIME, updated_at DATETIME",
        "subsidiaries": "symbol TEXT, subsidiary_name TEXT, subsidiary_symbol TEXT, ownership_pct FLOAT, charter_capital FLOAT, relationship_type TEXT, business_description TEXT, created_at DATETIME, updated_at DATETIME",
        "company_news": "symbol TEXT, title TEXT, summary TEXT, source TEXT, url TEXT, published_date DATETIME, created_at DATETIME, news_id INTEGER, rsi FLOAT, rs FLOAT, price FLOAT, price_change FLOAT, price_change_ratio FLOAT, UNIQUE(symbol, title, published_date)",
        "company_events": "symbol TEXT, event_type TEXT, event_date DATE, ex_date DATE, record_date DATE, payment_date DATE, value FLOAT, description TEXT, raw_data JSON, created_at DATETIME, updated_at DATETIME, UNIQUE(symbol, event_type, event_date)",
    }
    async with engine.begin() as conn:
        await conn.execute(text(f"CREATE TABLE {dataset} ({ddl[dataset]})"))
    monkeypatch.setattr(pipeline_module, "async_session_maker", async_sessionmaker(engine))
    monkeypatch.setattr(fetcher, "extract_data", AsyncMock(return_value=[row]))
    instance = DataPipeline()
    monkeypatch.setattr(instance, "_wait_for_rate_limit", AsyncMock())
    monkeypatch.setattr(instance, "_get_or_create_company_id", AsyncMock(return_value=1))
    progress = {}
    try:
        assert await getattr(instance, f"sync_{dataset}")(symbols=["VNM"], progress=progress) == 1
        async with engine.connect() as conn:
            stored = (await conn.execute(text(f"SELECT * FROM {dataset}"))).mappings().one()
        if dataset == "officers":
            assert (stored["name"], stored["title"], stored["shares_held"], stored["ownership_pct"]) == ("Example director", "Director", 0, None)
        elif dataset == "subsidiaries":
            assert (stored["subsidiary_name"], stored["subsidiary_symbol"], stored["ownership_pct"], stored["relationship_type"]) == ("Example subsidiary", "SUB", None, "subsidiary")
        elif dataset == "company_news":
            assert (stored["title"], stored["summary"], stored["url"]) == ("Issuer announcement", "Board resolution", "https://example.test/announcement")
            assert str(stored["published_date"]).startswith("2026-10-15 09:30:00")
            assert stored["news_id"] == 0
        else:
            import json
            assert (stored["event_type"], str(stored["event_date"]), stored["value"]) == ("DIV", "2026-10-14", 0)
            assert json.loads(stored["raw_data"]) == row
    finally:
        await engine.dispose()


def test_retained_canonical_names_and_zero_values_survive():
    officer = VnstockOfficersFetcher.transform_data(OfficersQueryParams(symbol="VNM"), [{
        "name": "Retained director", "position": "Director", "shares_owned": 0, "ownership_pct": 0,
    }])[0]
    subsidiary = VnstockSubsidiariesFetcher.transform_data(SubsidiariesQueryParams(symbol="VNM"), [{
        "company_name": "Retained subsidiary", "charter_capital": 0, "ownership_pct": 0,
    }])[0]
    assert (officer.name, officer.shares_owned, officer.ownership_pct) == ("Retained director", 0, 0)
    assert (subsidiary.company_name, subsidiary.charter_capital, subsidiary.ownership_pct) == ("Retained subsidiary", 0, 0)


@pytest.mark.parametrize("dataset,fetcher,params_type,row,expected", CASES[:2])
def test_unitless_native_ownership_is_preserved_but_not_certified(dataset, fetcher, params_type, row, expected):
    item = fetcher.transform_data(params_type(symbol="VNM"), [row])[0]
    assert item.ownership_pct is None
    assert item.raw_data == row


@pytest.mark.parametrize("row,expected,source_field", [
    ({"ratio": 0.3}, None, "ratio"),
    ({"ownership_pct": 0.3}, None, "ownership_pct"),
    ({"percent": "0.3%"}, 0.3, "percent"),
    ({"ownership_pct": 0.3, "ownership_unit": "percent"}, 0.3, "ownership_pct"),
    ({"ratio": 0.3, "ownership_unit": "ratio"}, 30, "ratio"),
    ({"ratio": 0, "ownership_unit": "ratio"}, 0, "ratio"),
    ({"ownership_pct": 101, "ownership_unit": "percent"}, None, "ownership_pct"),
    ({"percent": "0%"}, 0, "percent"),
    ({"ownership_pct": float("nan"), "ownership_unit": "percent"}, None, "ownership_pct"),
])
def test_shareholder_percent_requires_explicit_unit_evidence(row, expected, source_field):
    item = VnstockShareholdersFetcher.transform_data(ShareholdersQueryParams(symbol="FPT"), [row])[0]
    assert item.ownership_pct == expected
    assert item.ownership_unit == ("percent" if expected is not None else None)
    assert item.ownership_unit_status == ("explicit" if expected is not None else "unverified")
    assert item.ownership_source_field == source_field
    assert item.raw_data == row


@pytest.mark.asyncio
async def test_sparse_insider_events_keep_unknown_source_values(monkeypatch):
    import pandas as pd
    from vnibb.providers.vnstock import runtime
    from vnibb.providers.vnstock.insider_deals import VnstockInsiderDealsFetcher

    rows = [
        {"id": 9321, "event_code": "DDINS", "action_type_vi": "Mua", "public_date": "2026-10-14"},
        {"id": 9707, "event_code": "DDINS", "event_title_vi": "Example director - Thưởng", "action_type_vi": "Thưởng", "public_date": "2026-10-15"},
    ]
    monkeypatch.setattr(runtime, "get_company_class", lambda: lambda **kwargs: SimpleNamespace(events=lambda: pd.DataFrame(rows)))
    deals = await VnstockInsiderDealsFetcher.fetch("VNM")
    assert len(deals) == 2
    assert deals[0].insider_name is None and deals[0].shares_registered is None
    assert deals[0].deal_action == "BUY"
    assert all(deal.deal_price is None and deal.deal_value is None for deal in deals)


def test_sql_event_reader_understands_preserved_native_raw_data():
    from datetime import date

    from vnibb.api.v1.equity import _build_event_row_from_db

    row = CASES[3][3]
    stored = SimpleNamespace(symbol="VNM", event_type="DIV", event_date=date(2026, 10, 14),
        ex_date=date(2026, 10, 15), record_date=date(2026, 10, 16), payment_date=date(2026, 10, 30),
        description="Trả cổ tức bằng tiền", value=0, raw_data=row)
    payload = _build_event_row_from_db(stored)
    assert payload["event_name"] == "Trả cổ tức bằng tiền"
    assert payload["action_category"] == "dividend"
    assert payload["value"] == "0"
    assert payload["cash_amount_per_share"] is None


def test_native_event_dates_normalize_for_sql_and_mixed_timezone_sorting():
    source = CASES[3][3]
    rows = [{**source, "public_date": "2026-10-14T09:30:00+07:00"},
            {**source, "public_date": "15/10/2026 09:30:00"}]
    items = VnstockCompanyEventsFetcher.transform_data(CompanyEventsQueryParams(symbol="VNM"), rows)
    assert [item.event_date for item in items] == ["2026-10-15", "2026-10-14"]


@pytest.mark.asyncio
async def test_unitless_native_event_value_cannot_adjust_historical_prices():
    from datetime import date

    from vnibb.api.v1.equity import _load_corporate_actions_for_adjustment

    raw = {**CASES[3][3], "value_per_share": 1500}
    event = SimpleNamespace(event_type="DIV", description="Cổ tức bằng tiền", value=1500,
        event_date=date(2026, 10, 14), ex_date=date(2026, 10, 15), record_date=None,
        payment_date=None, raw_data=raw)
    def result(rows):
        return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: rows))

    db = SimpleNamespace(execute=AsyncMock(side_effect=[result([]), result([event])]))
    actions = await _load_corporate_actions_for_adjustment(db, "VNM", date(2026, 10, 1), date(2026, 10, 31))
    assert len(actions) == 1
    assert actions[0]["cash_amount_per_share"] is None


def test_native_event_action_date_does_not_replace_missing_announcement_date():
    row = {**CASES[3][3], "public_date": None}
    with pytest.raises(ProviderError):
        VnstockCompanyEventsFetcher.transform_data(CompanyEventsQueryParams(symbol="VNM"), [row])


def test_native_news_epoch_milliseconds_use_explicit_utc_basis():
    # SDK reference notebook output: public_date=1775756849000 (epoch ms).
    row = {**CASES[2][3], "public_date": 1775756849000}
    item = VnstockCompanyNewsFetcher.transform_data(CompanyNewsQueryParams(symbol="TCB"), [row])[0]
    assert item.published_at == "2026-04-09T17:47:29"


@pytest.mark.parametrize("published", [None, "", "not-a-date", float("inf"), 1775756849000.5])
def test_news_transform_rejects_missing_or_invalid_publication(published):
    row = {**CASES[2][3], "public_date": published}
    with pytest.raises(ProviderError):
        VnstockCompanyNewsFetcher.transform_data(CompanyNewsQueryParams(symbol="VNM"), [row])
