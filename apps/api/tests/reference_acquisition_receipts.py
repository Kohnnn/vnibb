"""Run explicitly: pytest tests/reference_acquisition_receipts.py.

Covers the reference acquisition receipts and the insider identity/unit repair:
native provider admission, durable same-day identity against real SQL, and the
unknown-direction and 90-day window monetary admission contracts.
"""

from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
import vnibb.services.data_pipeline as pipeline_module
import vnibb.services.sync_all_data as sync_all_data_module
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from vnibb.core.exceptions import ProviderError
from vnibb.core.insider_units import admitted_deal_value, normalize_deal_action
from vnibb.models.news import InsiderDeal
from vnibb.providers.vnstock.company_news import VnstockCompanyNewsFetcher
from vnibb.providers.vnstock.dividends import VnstockDividendsFetcher
from vnibb.providers.vnstock.insider_deals import VnstockInsiderDealsFetcher
from vnibb.services.ai_context_service import _build_insider_context
from vnibb.services.data_pipeline import DataPipeline
from vnibb.services.insider_tracking import InsiderTrackingService
from vnibb.services.sync_all_data import FullMarketSync

WRITERS = [
    ("shareholders", "VnstockShareholdersFetcher"),
    ("officers", "VnstockOfficersFetcher"),
    ("subsidiaries", "VnstockSubsidiariesFetcher"),
    ("company_news", "VnstockCompanyNewsFetcher"),
    ("insider_deals", "VnstockInsiderDealsFetcher"),
]


class Session:
    """Fake session: empty-candidate default, recorded writes, no real SQL."""

    def __init__(self, candidates=None, fail_commit=False):
        self.candidates = list(candidates or [])
        self.statements = []
        self.added = []
        self.fail_commit = fail_commit

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def execute(self, statement):
        self.statements.append(statement)

    async def scalar(self, statement):
        self.statements.append(statement)
        return self.candidates[0] if self.candidates else None

    async def scalars(self, statement):
        self.statements.append(statement)
        return SimpleNamespace(all=lambda: list(self.candidates))

    def add(self, row):
        self.added.append(row)

    async def flush(self):
        return None

    async def commit(self):
        if self.fail_commit:
            raise RuntimeError("database rejected commit")


def pipeline(monkeypatch):
    instance = DataPipeline()
    monkeypatch.setattr(instance, "_wait_for_rate_limit", AsyncMock())
    monkeypatch.setattr(instance, "_get_or_create_company_id", AsyncMock(return_value=1))
    return instance


def stub_reference_fetch(monkeypatch, dataset, fetcher, **kwargs):
    path = f"vnibb.providers.vnstock.{dataset}.{fetcher}"
    if dataset == "insider_deals":
        monkeypatch.setattr(f"{path}.fetch", AsyncMock(**kwargs))
    else:
        monkeypatch.setattr(f"{path}.extract_data", AsyncMock(**kwargs))
        monkeypatch.setattr(f"{path}.transform_data", lambda params, rows: rows)


# ---------------------------------------------------------------------------
# Receipt honesty (all five reference writers)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("source,guard_error", [("KBS", None), ("VCI", RuntimeError("paid runtime forbidden"))])
def test_reference_company_guards_precede_provider_construction(monkeypatch, source, guard_error):
    import sys
    from unittest.mock import Mock

    from vnibb.providers.vnstock import runtime

    constructor = Mock(side_effect=AssertionError("rejected runtime must not construct a provider"))
    guarded_import = Mock(side_effect=guard_error)
    monkeypatch.setitem(sys.modules, "vnstock.explorer.vci", SimpleNamespace(Company=constructor))
    monkeypatch.setattr(runtime, "import_vnstock_symbol", guarded_import)

    with pytest.raises(RuntimeError if guard_error else ValueError):
        runtime.create_reference_company("VNM", source)

    constructor.assert_not_called()
    if guard_error:
        guarded_import.assert_called_once_with("Company")
    else:
        guarded_import.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("dataset,fetcher,method", [
    ("shareholders", "VnstockShareholdersFetcher", "shareholders"),
    ("officers", "VnstockOfficersFetcher", "officers"),
    ("subsidiaries", "VnstockSubsidiariesFetcher", "subsidiaries"),
    ("company_news", "VnstockCompanyNewsFetcher", "news"),
    ("company_events", "VnstockCompanyEventsFetcher", "events"),
])
async def test_reference_fetcher_constructs_only_company(monkeypatch, dataset, fetcher, method):
    import sys
    from importlib import import_module

    import pandas as pd
    from vnibb.providers.vnstock import runtime

    calls = []
    rows = [{"title": "Company announcement", "value": 1}]

    def fetch_rows():
        calls.append(method)
        return pd.DataFrame(rows)

    def company(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(**{method: fetch_rows})

    def forbid_legacy_client():
        raise AssertionError("Reference requests must not construct Finance through Vnstock")

    def guarded_import(name):
        calls.append(("guard", name))

    monkeypatch.setattr(runtime, "import_vnstock_symbol", guarded_import)
    monkeypatch.setitem(sys.modules, "vnstock.explorer.vci", SimpleNamespace(Company=company))
    monkeypatch.setattr(runtime, "get_vnstock_class", forbid_legacy_client)
    provider = getattr(import_module(f"vnibb.providers.vnstock.{dataset}"), fetcher)

    assert await provider.extract_data({"symbol": "VNM", "limit": 20}) == rows
    assert calls == [("guard", "Company"), {"symbol": "VNM"}, method]


@pytest.mark.asyncio
@pytest.mark.parametrize("provider_error", [ConnectionError("HTTP 418 denied"), TimeoutError("overview timed out")])
async def test_profile_receipt_preserves_overview_failure_without_optional_profile(monkeypatch, provider_error):
    class OverviewOnlyCompany:
        def __init__(self, **kwargs):
            pass

        def overview(self):
            raise provider_error

    async def run_provider(operation, timeout):
        return operation()

    monkeypatch.setattr("vnibb.providers.vnstock.runtime.get_company_class", lambda: OverviewOnlyCompany)
    monkeypatch.setattr("vnibb.providers.vnstock.runtime.run_financial_provider", run_provider)
    session_factory = AsyncMock(side_effect=AssertionError("failed fetch must not open a write session"))
    monkeypatch.setattr(pipeline_module, "async_session_maker", session_factory)
    progress = {}

    assert await pipeline(monkeypatch).sync_company_profiles(symbols=["VNM"], progress=progress) == 0
    assert progress["error_count"] == progress["stage_stats"]["profiles"]["errors"] == 1
    assert progress["errors"] == [{
        "symbol": "VNM", "dataset": "profiles",
        "error": f"{type(provider_error).__name__}: {provider_error}",
    }]
    session_factory.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("dataset,fetcher", WRITERS)
async def test_empty_reference_receipt_preserves_records(monkeypatch, dataset, fetcher):
    stub_reference_fetch(monkeypatch, dataset, fetcher, return_value=[])
    session_factory = AsyncMock(side_effect=AssertionError("empty fetch must not open a write session"))
    monkeypatch.setattr(pipeline_module, "async_session_maker", session_factory)
    progress = {}

    count = await getattr(pipeline(monkeypatch), f"sync_{dataset}")(symbols=["VNM"], progress=progress)

    assert count == 0
    assert {key: progress[key] for key in ("attempted_count", "succeeded_count", "empty_count", "error_count")} == {
        "attempted_count": 1, "succeeded_count": 0, "empty_count": 1, "error_count": 0,
    }
    session_factory.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("dataset,fetcher", WRITERS)
async def test_provider_failure_is_not_an_empty_receipt(monkeypatch, dataset, fetcher):
    stub_reference_fetch(monkeypatch, dataset, fetcher, side_effect=RuntimeError("upstream unavailable"))
    progress = {}

    count = await getattr(pipeline(monkeypatch), f"sync_{dataset}")(symbols=["VNM"], progress=progress)

    assert count == 0
    assert progress["attempted_count"] == progress["error_count"] == 1
    assert progress["empty_count"] == progress["succeeded_count"] == 0
    assert progress["failed_symbols"] == ["VNM"]
    assert "upstream unavailable" in progress["errors"][0]["error"]


@pytest.mark.asyncio
@pytest.mark.parametrize("dataset,fetcher", WRITERS)
async def test_failed_commit_does_not_count_rows_as_persisted(monkeypatch, dataset, fetcher):
    payload = {"title": "Results", "published_at": "2026-10-12", "transaction_date": "2026-10-12", "insider_name": "Director", "transaction_type": "Purchase"}
    stub_reference_fetch(monkeypatch, dataset, fetcher, return_value=[SimpleNamespace(model_dump=lambda: payload)])
    monkeypatch.setattr(pipeline_module, "async_session_maker", lambda: Session(fail_commit=True))
    progress = {}

    count = await getattr(pipeline(monkeypatch), f"sync_{dataset}")(symbols=["VNM"], progress=progress)

    assert count == 0
    assert progress["error_count"] == 1
    assert progress["succeeded_count"] == progress["empty_count"] == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("dataset,fetcher", WRITERS)
async def test_committed_reference_receipt_counts_success(monkeypatch, dataset, fetcher):
    payload = {"title": "Results", "published_at": "2026-10-12", "transaction_date": "2026-10-12", "insider_name": "Director", "transaction_type": "Purchase"}
    stub_reference_fetch(monkeypatch, dataset, fetcher, return_value=[SimpleNamespace(model_dump=lambda: payload)])
    monkeypatch.setattr(pipeline_module, "async_session_maker", lambda: Session())
    progress = {}

    assert await getattr(pipeline(monkeypatch), f"sync_{dataset}")(symbols=["VNM"], progress=progress) == 1
    assert progress["attempted_count"] == progress["succeeded_count"] == 1
    assert progress["error_count"] == progress["empty_count"] == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("dataset,fetcher", WRITERS)
async def test_empty_reference_receipt_still_checkpoints(monkeypatch, dataset, fetcher):
    stub_reference_fetch(monkeypatch, dataset, fetcher, return_value=[])
    instance = pipeline(monkeypatch)
    monkeypatch.setattr(instance, "_should_checkpoint", lambda *args: True)
    checkpoint = AsyncMock()
    monkeypatch.setattr(instance, "_checkpoint", checkpoint)
    progress = {}

    await getattr(instance, f"sync_{dataset}")(symbols=["VNM"], progress=progress, sync_id=7)

    assert progress["last_symbol"] == "VNM"
    checkpoint.assert_awaited_once_with(progress, 7)


@pytest.mark.asyncio
async def test_missing_company_identity_is_failed_not_empty(monkeypatch):
    stub_reference_fetch(monkeypatch, "shareholders", "VnstockShareholdersFetcher", return_value=[SimpleNamespace(model_dump=lambda: {})])
    monkeypatch.setattr(pipeline_module, "async_session_maker", lambda: Session())
    instance = pipeline(monkeypatch)
    monkeypatch.setattr(instance, "_get_or_create_company_id", AsyncMock(return_value=None))
    progress = {}

    assert await instance.sync_shareholders(symbols=["VNM"], progress=progress) == 0
    assert progress["error_count"] == 1
    assert progress["empty_count"] == 0


@pytest.mark.asyncio
async def test_insider_missing_source_date_is_failed_not_fabricated(monkeypatch):
    monkeypatch.setattr(VnstockInsiderDealsFetcher, "fetch", AsyncMock(return_value=[SimpleNamespace(model_dump=lambda: {"insider_name": "Director"})]))
    session = Session()
    monkeypatch.setattr(pipeline_module, "async_session_maker", lambda: session)
    progress = {}

    assert await pipeline(monkeypatch).sync_insider_deals(symbols=["VNM"], progress=progress) == 0
    assert progress["error_count"] == 1
    assert not session.added


# ---------------------------------------------------------------------------
# Native provider admission: units and direction
# ---------------------------------------------------------------------------

def _events_company(rows):
    import pandas as pd

    class Company:
        def __init__(self, **kwargs):
            pass

        def events(self):
            return pd.DataFrame(rows)

    return Company


@pytest.mark.asyncio
async def test_native_insider_action_is_canonical_buy_without_units(monkeypatch):
    from vnibb.providers.vnstock import runtime

    monkeypatch.setattr(runtime, "get_company_class", lambda: _events_company([
        {
            "id": "evt-1", "event_code": "DDINS", "ticker": "VNM",
            "event_title_vi": "Công ty ABC - Đăng kí Mua 400,000 VNM",
            "action_type_vi": "Mua", "public_date": "2026-07-09",
        },
    ]))
    monkeypatch.setattr(runtime, "validate_source", lambda source: source)

    payload = (await VnstockInsiderDealsFetcher.fetch("VNM"))[0].model_dump()

    assert payload["deal_action"] == "BUY"
    # No unit evidence in the source, so canonical money stays unset.
    assert payload["deal_price"] is None and payload["deal_value"] is None
    assert payload["price_unit"] == "unknown" and payload["value_unit"] == "unknown"
    assert payload["shares_registered"] == 400000
    assert payload["provider_record_id"] == "evt-1"
    assert payload["record_hash"]


@pytest.mark.asyncio
async def test_native_insider_admits_money_only_with_supplied_unit(monkeypatch):
    from vnibb.providers.vnstock import runtime

    rows = [
        {"id": "evt-a", "event_code": "DDIND", "event_title_vi": "X - Bán 1,000 VNM",
         "action_type_vi": "Bán", "public_date": "2026-07-01",
         "price": 25500, "price_unit": "VND", "value": 25500000, "value_unit": "VND"},
        {"id": "evt-b", "event_code": "DDIND", "event_title_vi": "Y - Mua 2,000 VNM",
         "action_type_vi": "Mua", "public_date": "2026-07-02", "price": 25500},
    ]
    monkeypatch.setattr(runtime, "get_company_class", lambda: _events_company(rows))
    monkeypatch.setattr(runtime, "validate_source", lambda source: source)

    admitted, withheld = (item.model_dump() for item in await VnstockInsiderDealsFetcher.fetch("VNM"))

    assert (admitted["deal_price"], admitted["deal_value"]) == (25500.0, 25500000.0)
    assert (admitted["price_unit"], admitted["value_unit"]) == ("VND", "VND")
    assert admitted["deal_action"] == "SELL"
    # Unit missing on the second row: value withheld, raw field preserved.
    assert withheld["deal_price"] is None and withheld["price_unit"] == "unknown"
    assert withheld["raw_data"]["price"] == 25500


@pytest.mark.asyncio
async def test_native_insider_distinct_same_day_records_stay_distinct(monkeypatch):
    from vnibb.providers.vnstock import runtime

    monkeypatch.setattr(runtime, "get_company_class", lambda: _events_company([
        {"id": "evt-1", "event_code": "DDINS", "event_title_vi": "A - Mua 100 VNM",
         "action_type_vi": "Mua", "public_date": "2026-07-09"},
        {"id": "evt-2", "event_code": "DDINS", "event_title_vi": "B - Bán 200 VNM",
         "action_type_vi": "Bán", "public_date": "2026-07-09"},
    ]))
    monkeypatch.setattr(runtime, "validate_source", lambda source: source)

    first, second = (item.model_dump() for item in await VnstockInsiderDealsFetcher.fetch("VNM"))

    assert first["provider_record_id"] != second["provider_record_id"]
    assert first["record_hash"] != second["record_hash"]
    assert (first["deal_action"], second["deal_action"]) == ("BUY", "SELL")


# ---------------------------------------------------------------------------
# Durable identity against real SQL (sqlite) — collision regression
# ---------------------------------------------------------------------------

_DDL = """
CREATE TABLE insider_deals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol VARCHAR(10) NOT NULL,
    announce_date DATE NOT NULL,
    deal_method VARCHAR(50),
    deal_action VARCHAR(50),
    deal_quantity FLOAT,
    deal_price FLOAT,
    deal_value FLOAT,
    deal_ratio FLOAT,
    insider_name VARCHAR(255),
    insider_position VARCHAR(100),
    raw_data JSON,
    created_at DATETIME
)
"""


async def _sqlite_writer(monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite://")
    async with engine.begin() as conn:
        await conn.execute(text(_DDL))
    monkeypatch.setattr(
        pipeline_module, "async_session_maker",
        async_sessionmaker(engine, expire_on_commit=False, autoflush=False),
    )
    return engine


def _insider_item(record_id, action, name, day, shares):
    payload = {
        "transaction_date": day,
        "insider_name": name,
        "deal_action": action,
        "provider_record_id": record_id,
        "record_hash": f"hash-{record_id}",
        "shares_registered": shares,
        "raw_data": {"action_type_vi": action, "provider_record_id": record_id, "record_hash": f"hash-{record_id}"},
    }
    return SimpleNamespace(model_dump=lambda: dict(payload))


@pytest.mark.asyncio
async def test_insider_same_day_identity_persists_distinct_rows_in_real_sql(monkeypatch):
    engine = await _sqlite_writer(monkeypatch)
    items = [
        _insider_item("evt-1", "Mua", "Director A", "2026-07-09", 100),
        _insider_item("evt-2", "Bán", "Director A", "2026-07-09", 200),
    ]
    monkeypatch.setattr(VnstockInsiderDealsFetcher, "fetch", AsyncMock(return_value=items))

    first = await pipeline(monkeypatch).sync_insider_deals(symbols=["VNM"])
    second = await pipeline(monkeypatch).sync_insider_deals(symbols=["VNM"])

    async with engine.connect() as conn:
        rows = (await conn.execute(text("SELECT deal_action, deal_quantity FROM insider_deals ORDER BY id"))).all()

    assert first == 2 and second == 2
    # Distinct same-day trades are preserved, not merged; rerun does not duplicate.
    assert [(row[0], row[1]) for row in rows] == [("BUY", 100.0), ("SELL", 200.0)]
    await engine.dispose()


@pytest.mark.asyncio
async def test_insider_rerun_updates_without_deleting_history(monkeypatch):
    engine = await _sqlite_writer(monkeypatch)
    monkeypatch.setattr(VnstockInsiderDealsFetcher, "fetch", AsyncMock(side_effect=[
        [_insider_item("evt-1", "Mua", "Director A", "2026-07-09", 100)],
        [_insider_item("evt-1", "Mua", "Director A", "2026-07-09", 150)],
    ]))

    await pipeline(monkeypatch).sync_insider_deals(symbols=["VNM"])
    await pipeline(monkeypatch).sync_insider_deals(symbols=["VNM"])

    async with engine.connect() as conn:
        rows = (await conn.execute(text("SELECT deal_quantity FROM insider_deals"))).all()

    assert rows == [(150.0,)]
    await engine.dispose()


# ---------------------------------------------------------------------------
# Directional consumer contract (Unknown must stay neutral)
# ---------------------------------------------------------------------------

def test_utility_normalizes_supplied_direction_and_preserves_unknown():
    assert normalize_deal_action("Mua") == "BUY"
    assert normalize_deal_action("Đăng ký bán") == "SELL"
    assert normalize_deal_action(None) is None
    assert normalize_deal_action("chuyển nhượng") == "UNKNOWN"


def test_admitted_deal_value_requires_finite_value_and_vnd_evidence():
    def deal(value, unit):
        raw = {} if unit is None else {"value_unit": unit}
        return SimpleNamespace(deal_value=value, raw_data=raw)

    assert admitted_deal_value(deal(1000.0, "VND")) == 1000.0
    assert admitted_deal_value(deal(0.0, "VND")) == 0.0
    assert admitted_deal_value(deal(1000.0, None)) is None
    assert admitted_deal_value(deal(1000.0, "unknown")) is None
    assert admitted_deal_value(deal(None, "VND")) is None
    assert admitted_deal_value(deal(float("nan"), "VND")) is None


def test_consumer_counts_sell_and_ignores_unknown_direction():
    context = _build_insider_context([
        {"announce_date": "2026-07-09", "deal_action": "Bán", "deal_value": 5},
        {"announce_date": "2026-07-09", "deal_action": "UNKNOWN", "deal_value": 9},
        {"announce_date": "2026-07-09", "deal_action": None, "deal_value": 7},
        {"announce_date": "2026-07-09", "deal_action": "Mua", "deal_value": 3},
    ])

    assert context is not None
    assert context["summary"]["buy_count"] == 1
    assert context["summary"]["sell_count"] == 1
    assert context["summary"]["total_disclosed_value"] == 24


# ---------------------------------------------------------------------------
# 90-day sentiment window against real SQL (no limit, no partial sums)
# ---------------------------------------------------------------------------

async def _sentiment_db():
    engine = create_async_engine("sqlite+aiosqlite://")
    async with engine.begin() as conn:
        await conn.execute(text(_DDL))
    return engine, async_sessionmaker(engine, expire_on_commit=False, autoflush=False)


def _stored_deal(symbol, days_ago, action, value, unit, name="Insider"):
    raw = {"action_type_vi": action}
    if unit is not None:
        raw["value_unit"] = unit
    return InsiderDeal(
        symbol=symbol,
        announce_date=date.today() - timedelta(days=days_ago),
        deal_action=action,
        deal_value=value,
        insider_name=name,
        raw_data=raw,
    )


@pytest.mark.asyncio
async def test_sentiment_withholds_money_when_any_classified_row_lacks_units():
    engine, session_factory = await _sentiment_db()
    async with session_factory() as session:
        session.add_all(
            [_stored_deal("VNM", day, "BUY", 1000.0, "VND") for day in range(1, 21)]
            + [_stored_deal("VNM", 25, "BUY", 1000.0, "unknown")]
        )
        await session.commit()
        sentiment = await InsiderTrackingService(session).calculate_insider_sentiment("VNM", 90)

    # The 21st row is inside the window; without a row limit it is seen, so the
    # partial sum is withheld instead of certified as VND.
    assert sentiment["total_deals"] == 21
    assert sentiment["buy_count"] == 21
    assert (sentiment["buy_value"], sentiment["sell_value"]) == (None, None)
    assert (sentiment["net_value"], sentiment["sentiment_score"]) == (None, None)
    assert sentiment["value_unit"] is None
    await engine.dispose()


@pytest.mark.asyncio
async def test_sentiment_certifies_money_and_keeps_admitted_zero():
    engine, session_factory = await _sentiment_db()
    async with session_factory() as session:
        session.add_all(
            [_stored_deal("VNM", day, "BUY", 1000.0, "VND") for day in range(1, 21)]
            + [_stored_deal("VNM", 25, "SELL", 1000.0, "VND")]
        )
        await session.commit()
        certified = await InsiderTrackingService(session).calculate_insider_sentiment("VNM", 90)

    assert certified["value_unit"] == "VND"
    assert certified["buy_value"] == 20000.0 and certified["sell_value"] == 1000.0
    assert certified["net_value"] == 19000.0
    assert certified["sell_count"] == 1 and certified["total_deals"] == 21

    async with session_factory() as session:
        session.add_all([
            _stored_deal("SSI", 1, "BUY", 0.0, "VND"),
            _stored_deal("SSI", 2, "SELL", 0.0, "VND"),
        ])
        await session.commit()
        zero = await InsiderTrackingService(session).calculate_insider_sentiment("SSI", 90)

    # An admitted zero stays zero; only the absent value/unit withholds money.
    assert (zero["buy_value"], zero["sell_value"], zero["net_value"]) == (0.0, 0.0, 0.0)
    assert zero["sentiment_score"] == 0.0 and zero["value_unit"] == "VND"
    await engine.dispose()


@pytest.mark.asyncio
async def test_sentiment_unknown_direction_counts_but_never_certifies_money():
    engine, session_factory = await _sentiment_db()
    async with session_factory() as session:
        session.add_all([
            _stored_deal("HPG", 1, "BUY", 500.0, "VND"),
            _stored_deal("HPG", 2, "chuyển nhượng", 500.0, None, name="Other"),
        ])
        await session.commit()
        sentiment = await InsiderTrackingService(session).calculate_insider_sentiment("HPG", 90)

    # UNKNOWN direction is neither a buy nor a sell, and its unadmitted value
    # does not poison the classified aggregate.
    assert sentiment["total_deals"] == 2
    assert (sentiment["buy_count"], sentiment["sell_count"]) == (1, 0)
    assert sentiment["buy_value"] == 500.0 and sentiment["value_unit"] == "VND"
    await engine.dispose()


# ---------------------------------------------------------------------------
# Company news natural-key idempotency against real SQL (sqlite)
# ---------------------------------------------------------------------------

_NEWS_DDL = """
CREATE TABLE company_news (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol VARCHAR(10) NOT NULL,
    title TEXT NOT NULL,
    summary TEXT,
    source VARCHAR(50),
    url TEXT,
    published_date DATETIME,
    rsi FLOAT,
    rs FLOAT,
    price FLOAT,
    price_change FLOAT,
    price_change_ratio FLOAT,
    news_id INTEGER,
    created_at DATETIME,
    CONSTRAINT uq_news_symbol_title_date UNIQUE (symbol, title, published_date)
)
"""


async def _news_sqlite_writer(monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite://")
    async with engine.begin() as conn:
        await conn.execute(text(_NEWS_DDL))
    monkeypatch.setattr(
        pipeline_module, "async_session_maker",
        async_sessionmaker(engine, expire_on_commit=False, autoflush=False),
    )
    return engine


def _news_item(title, published_at, summary=None, url=None):
    payload = {
        "symbol": "ARM",
        "title": title,
        "published_at": published_at,
        "summary": summary,
        "url": url,
        "source": "VCI",
    }
    return SimpleNamespace(model_dump=lambda: dict(payload))


@pytest.mark.asyncio
async def test_repeated_news_batch_persists_idempotently_without_losing_distinct_items(monkeypatch):
    # Mirrors the capture: the provider returns the same (symbol, title,
    # published_date) row twice in one batch plus a genuinely distinct article.
    # The old select-then-add path raised IntegrityError on the natural key.
    engine = await _news_sqlite_writer(monkeypatch)
    batch = [
        _news_item("Untitled", "2026-08-17 22:37", summary="first"),
        _news_item("Untitled", "2026-08-17 22:37", summary="first"),
        _news_item("Board approves dividend", "2026-08-18 09:00", url="https://vci/x"),
    ]
    monkeypatch.setattr(
        VnstockCompanyNewsFetcher, "extract_data", AsyncMock(return_value=batch),
    )
    monkeypatch.setattr(
        VnstockCompanyNewsFetcher, "transform_data", lambda params, rows: rows,
    )
    progress = {}

    first = await pipeline(monkeypatch).sync_company_news(symbols=["ARM"], progress=progress)
    second = await pipeline(monkeypatch).sync_company_news(symbols=["ARM"], progress={})
    async with engine.connect() as conn:
        rows = (
            await conn.execute(
                text("SELECT id, title, summary, url, published_date FROM company_news ORDER BY title")
            )
        ).all()

    assert first == 3 and second == 3
    assert progress["error_count"] == 0 and progress["succeeded_count"] == 1
    # One row per natural key even after the second identical delivery; the
    # duplicate observation neither duplicates the row nor mutates its identity.
    assert len(rows) == 2 and len({row[0] for row in rows}) == 2
    assert [(row[1], row[2], row[3]) for row in rows] == [
        ("Board approves dividend", None, "https://vci/x"),
        ("Untitled", "first", None),
    ]
    # published_date is derived deterministically from the provider timestamp.
    assert [str(row[4])[:10] for row in rows] == ["2026-08-18", "2026-08-17"]
    await engine.dispose()


@pytest.mark.asyncio
async def test_news_rerun_refreshes_observed_fields_and_keeps_unobserved_values(monkeypatch):
    engine = await _news_sqlite_writer(monkeypatch)
    batches = [
        [_news_item("Untitled", "2026-08-17 22:37", summary="first", url="https://vci/old")],
        [_news_item("Untitled", "2026-08-17 22:37", summary="revised")],
        [_news_item("Untitled", "2026-08-17 22:37", summary="revised")],
    ]
    monkeypatch.setattr(
        VnstockCompanyNewsFetcher, "extract_data", AsyncMock(side_effect=batches),
    )
    monkeypatch.setattr(
        VnstockCompanyNewsFetcher, "transform_data", lambda params, rows: rows,
    )

    await pipeline(monkeypatch).sync_company_news(symbols=["ARM"])
    # Columns the provider never re-sends (news_id, rsi) must survive a repeat
    # acquisition that carries NULL for them, instead of being nulled out.
    async with engine.begin() as conn:
        await conn.execute(text("UPDATE company_news SET news_id = 42, rsi = 1.5"))
    await pipeline(monkeypatch).sync_company_news(symbols=["ARM"])
    await pipeline(monkeypatch).sync_company_news(symbols=["ARM"])

    async with engine.connect() as conn:
        rows = (
            await conn.execute(text("SELECT id, summary, url, news_id, rsi FROM company_news"))
        ).all()

    # Observed summary refreshed, unobserved url/news_id/rsi preserved, one row.
    assert [(row[1], row[2], row[3], row[4]) for row in rows] == [
        ("revised", "https://vci/old", 42, 1.5),
    ]
    await engine.dispose()

# ---------------------------------------------------------------------------
# Dividend outcome honesty against real SQL (sqlite)
# ---------------------------------------------------------------------------

_DIVIDEND_DDL = """
CREATE TABLE dividends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol VARCHAR(10) NOT NULL,
    exercise_date DATE,
    cash_year INTEGER,
    dividend_rate FLOAT,
    dividend_value FLOAT,
    issue_method VARCHAR(50),
    record_date DATE,
    payment_date DATE,
    raw_data JSON,
    created_at DATETIME,
    CONSTRAINT uq_dividend_symbol_date_year UNIQUE (symbol, exercise_date, cash_year)
);
CREATE TABLE sync_status (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sync_type VARCHAR(50) NOT NULL,
    started_at DATETIME NOT NULL,
    completed_at DATETIME,
    success_count INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'running',
    errors JSON,
    additional_data JSON
)
"""


async def _dividend_sqlite_writer(monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite://")
    async with engine.begin() as conn:
        for statement in filter(None, (part.strip() for part in _DIVIDEND_DDL.split(";"))):
            await conn.execute(text(statement))
    sessions = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    monkeypatch.setattr(pipeline_module, "async_session_maker", sessions)
    monkeypatch.setattr(sync_all_data_module, "async_session_maker", sessions)
    monkeypatch.setattr(pipeline_module.data_pipeline, "_wait_for_rate_limit", AsyncMock())
    return engine


def _dividend_item(ex_date, year, cash):
    payload = {
        "symbol": "VNM",
        "ex_date": ex_date,
        "fiscal_year": year,
        "cash_dividend": cash,
        "dividend_type": "cash",
    }
    return SimpleNamespace(model_dump=lambda: dict(payload))


@pytest.mark.asyncio
async def test_confirmed_empty_dividend_source_is_empty_not_failed(monkeypatch):
    # A provider that answers with an empty history is a confirmed empty outcome;
    # the old code left empty_count unset, so run_maintenance_cycle reclassified
    # every no-dividend symbol as "acquisition unavailable or incomplete".
    engine = await _dividend_sqlite_writer(monkeypatch)
    monkeypatch.setattr(VnstockDividendsFetcher, "fetch", AsyncMock(return_value=[]))
    progress = {}

    count = await pipeline(monkeypatch).sync_dividends(symbols=["VNM"], progress=progress)

    assert count == 0
    assert progress["empty_count"] == 1 and progress["error_count"] == 0
    assert progress["stage_stats"]["dividends"]["empty"] == 1
    async with engine.connect() as conn:
        rows = (await conn.execute(text("SELECT COUNT(*) FROM dividends"))).scalar()
    assert rows == 0

    result = await FullMarketSync().run_maintenance_cycle(
        "dividend_empty_fixture", ["VNM"],
        [("dividends", lambda symbol, prog: pipeline_module.data_pipeline.sync_dividends(
            symbols=[symbol], progress=prog,
        ))],
        30, 1, allow_empty=True,
    )
    assert result.success and result.complete
    await engine.dispose()


@pytest.mark.asyncio
async def test_unavailable_dividend_source_stays_a_typed_failure(monkeypatch):
    engine = await _dividend_sqlite_writer(monkeypatch)
    monkeypatch.setattr(
        VnstockDividendsFetcher, "fetch",
        AsyncMock(side_effect=ProviderError("Failed to fetch dividends for BGW", provider="vnstock")),
    )
    progress = {}

    count = await pipeline(monkeypatch).sync_dividends(symbols=["BGW"], progress=progress)

    assert count == 0
    assert progress["error_count"] == 1 and progress["empty_count"] == 0
    assert progress["failed_symbols"] == ["BGW"]
    assert progress["errors"][0]["error"].startswith("ProviderError:")
    async with engine.connect() as conn:
        rows = (await conn.execute(text("SELECT COUNT(*) FROM dividends"))).scalar()
    assert rows == 0
    await engine.dispose()


@pytest.mark.asyncio
async def test_dividend_rerun_updates_same_natural_key_without_duplicating(monkeypatch):
    engine = await _dividend_sqlite_writer(monkeypatch)
    monkeypatch.setattr(VnstockDividendsFetcher, "fetch", AsyncMock(side_effect=[
        [_dividend_item("2026-05-12", 2026, 1500.0)],
        [_dividend_item("2026-05-12", 2026, 1500.0)],
    ]))
    progress = {}

    await pipeline(monkeypatch).sync_dividends(symbols=["VNM"], progress=progress)
    await pipeline(monkeypatch).sync_dividends(symbols=["VNM"], progress={})

    async with engine.connect() as conn:
        rows = (await conn.execute(
            text("SELECT id, exercise_date, cash_year, dividend_value FROM dividends")
        )).all()

    assert [(str(row[1])[:10], row[2], row[3]) for row in rows] == [
        ("2026-05-12", 2026, 1500.0),
    ]
    assert progress["succeeded_count"] == 1 and progress["error_count"] == 0
    await engine.dispose()
