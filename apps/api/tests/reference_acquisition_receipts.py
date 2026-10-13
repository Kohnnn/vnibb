"""Run explicitly: pytest tests/reference_acquisition_receipts.py.

Covers the reference acquisition receipts and the insider identity/unit repair:
native provider admission, durable same-day identity against real SQL, and the
unknown-direction consumer contract.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import vnibb.services.data_pipeline as pipeline_module
from vnibb.core.insider_units import normalize_deal_action
from vnibb.providers.vnstock.insider_deals import VnstockInsiderDealsFetcher
from vnibb.services.ai_context_service import _build_insider_context
from vnibb.services.data_pipeline import DataPipeline


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


# ---------------------------------------------------------------------------
# Receipt honesty (all five reference writers)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
@pytest.mark.parametrize("dataset,fetcher", WRITERS)
async def test_empty_reference_receipt_preserves_records(monkeypatch, dataset, fetcher):
    monkeypatch.setattr(f"vnibb.providers.vnstock.{dataset}.{fetcher}.fetch", AsyncMock(return_value=[]))
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
    monkeypatch.setattr(f"vnibb.providers.vnstock.{dataset}.{fetcher}.fetch", AsyncMock(side_effect=RuntimeError("upstream unavailable")))
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
    monkeypatch.setattr(f"vnibb.providers.vnstock.{dataset}.{fetcher}.fetch", AsyncMock(return_value=[SimpleNamespace(model_dump=lambda: payload)]))
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
    monkeypatch.setattr(f"vnibb.providers.vnstock.{dataset}.{fetcher}.fetch", AsyncMock(return_value=[SimpleNamespace(model_dump=lambda: payload)]))
    monkeypatch.setattr(pipeline_module, "async_session_maker", lambda: Session())
    progress = {}

    assert await getattr(pipeline(monkeypatch), f"sync_{dataset}")(symbols=["VNM"], progress=progress) == 1
    assert progress["attempted_count"] == progress["succeeded_count"] == 1
    assert progress["error_count"] == progress["empty_count"] == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("dataset,fetcher", WRITERS)
async def test_empty_reference_receipt_still_checkpoints(monkeypatch, dataset, fetcher):
    monkeypatch.setattr(f"vnibb.providers.vnstock.{dataset}.{fetcher}.fetch", AsyncMock(return_value=[]))
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
    monkeypatch.setattr("vnibb.providers.vnstock.shareholders.VnstockShareholdersFetcher.fetch", AsyncMock(return_value=[SimpleNamespace(model_dump=lambda: {})]))
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
