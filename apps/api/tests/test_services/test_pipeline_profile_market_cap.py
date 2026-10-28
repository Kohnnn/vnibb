from datetime import datetime, timedelta

import pandas as pd
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from vnibb.models.company import Company
from vnibb.models.screener import ScreenerSnapshot
from vnibb.providers.vnstock import runtime
from vnibb.core.market_cap import resolve_market_cap
from vnibb.services.cache_manager import CacheManager
from vnibb.services import data_pipeline as data_pipeline_module
from vnibb.services.data_pipeline import DataPipeline


@pytest.mark.asyncio
@pytest.mark.parametrize("missing", [None, "shares_unit", "shares_source", "share_basis", "shares_as_of", "date_mismatch", "conflict_only"])
async def test_scheduled_cap_from_camel_case_profile_shares(test_engine, monkeypatch, missing):
    today = datetime.utcnow().date()
    trade_date = today - timedelta(days=1)
    profile = {
        "sharesOutstanding": 100,
        "shares_unit": "shares",
        "shares_source": "issuer:shares",
        "share_basis": "outstanding",
        "shares_as_of": trade_date.isoformat(),
    }
    if missing == "date_mismatch":
        profile["shares_as_of"] = (trade_date - timedelta(days=1)).isoformat()
    elif missing and missing != "conflict_only":
        profile.pop(missing)
    if missing == "conflict_only":
        profile = {"shares_outstanding_provenance": {
            "status": "conflict", "value": None, "observations": [
                {"value": shares, "unit": "shares", "source": "issuer:shares",
                 "share_basis": "outstanding", "as_of": trade_date.isoformat()}
                for shares in (100, 200)
            ],
        }}
    prior_cap = resolve_market_cap({
        "market_cap": 1000, "market_cap_source": "issuer:cap",
        "market_cap_unit": "VND", "market_cap_currency": "VND",
        "market_cap_as_of": trade_date.isoformat(), "outstanding_shares": 100,
        "shares_unit": "shares", "shares_source": "issuer:shares",
        "share_basis": "outstanding", "shares_as_of": trade_date.isoformat(),
    }, source="test")
    cached = []

    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(data_pipeline_module, "async_session_maker", sessions)
    monkeypatch.setattr(data_pipeline_module.settings, "vnstock_source", "VCI")

    class Listing:
        def __init__(self, **kwargs):
            pass

        def all_symbols(self):
            return pd.DataFrame()

        symbols_by_exchange = all_symbols
        symbols_by_industries = all_symbols

    class Finance:
        def __init__(self, **kwargs):
            pass

        def ratio(self, **kwargs):
            return pd.DataFrame([{"item_id": "pe", "2025": 12}])

    class Quote:
        def __init__(self, **kwargs):
            pass

        def history(self, **kwargs):
            return pd.DataFrame()

    async def noop(*args, **kwargs):
        pass

    async def capture_cache(key, value, *args, **kwargs):
        cached.append(value)

    monkeypatch.setattr(runtime, "get_listing_class", lambda: Listing)
    monkeypatch.setattr(runtime, "get_finance_class", lambda: Finance)
    monkeypatch.setattr(runtime, "get_quote_class", lambda: Quote)
    pipeline = DataPipeline()
    monkeypatch.setattr(pipeline, "_wait_for_rate_limit", noop)
    monkeypatch.setattr(pipeline, "_cache_set_json", capture_cache)
    async with sessions.begin() as session:
        session.add(Company(symbol="VNM", raw_data=profile))
        session.add(ScreenerSnapshot(
            symbol="VNM", snapshot_date=trade_date, trade_date=trade_date, price=10, volume=1,
            market_cap=prior_cap["value"] if missing == "conflict_only" else None,
            extended_metrics={"price_unit": "VND", "price_source": "vnstock_history:VCI",
                              **({"market_cap_provenance": prior_cap} if missing == "conflict_only" else {})},
        ))

    assert await pipeline.sync_screener_data(symbols=["VNM"]) == 1
    async with sessions() as session:
        row = (await session.scalars(select(ScreenerSnapshot).where(
            ScreenerSnapshot.symbol == "VNM", ScreenerSnapshot.snapshot_date == today,
        ))).one()
        cap = row.extended_metrics["market_cap_provenance"]
        if missing == "conflict_only":
            assert row.market_cap is None
            assert cap["status"] == "conflict"
            assert any(item.get("value") == 1000 for item in cap["observations"])
            share_evidence = row.extended_metrics["shares_outstanding_provenance"]
            assert share_evidence["status"] == "conflict"
            assert {item["value"] for item in share_evidence["observations"]} == {100, 200}
            cached_row = next(item for item in cached if item.get("market_cap_provenance"))
            assert cached_row["market_cap"] is None
            assert cached_row["market_cap_provenance"]["status"] == "conflict"
            assert any(item.get("value") == 1000 for item in cached_row["market_cap_provenance"]["observations"])
            assert cached_row["shares_outstanding_provenance"] == share_evidence
            return
        assert row.market_cap == (1000 if missing is None else None)
        assert cap["status"] == ("available" if missing is None else "unavailable")
        observation = next(item for item in cap["observations"] if item.get("shares") == 100)
        assert observation["price"] == 10
        assert observation["price_source"] == "vnstock_history:VCI"
        assert observation["price_as_of"] == trade_date.isoformat()
        assert observation["shares_unit"] == profile.get("shares_unit")
        assert observation["shares_source"] == profile.get("shares_source")
        assert observation["share_basis"] == profile.get("share_basis")
        assert observation["shares_as_of"] == profile.get("shares_as_of")


@pytest.mark.asyncio
@pytest.mark.parametrize("prior_case", ["older", "same", "undated", "share_conflict"])
async def test_carried_snapshot_cap_refresh_respects_evidence_dates(test_engine, monkeypatch, prior_case):
    today = datetime.utcnow().date()
    yesterday = today - timedelta(days=1)
    previous_day = today if prior_case == "same" else yesterday
    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(data_pipeline_module, "async_session_maker", sessions)
    monkeypatch.setattr(data_pipeline_module.settings, "vnstock_source", "VCI")

    def cap(value, day):
        return resolve_market_cap({
            "market_cap": value, "market_cap_source": "issuer:cap",
            "market_cap_unit": "VND", "market_cap_currency": "VND",
            "market_cap_as_of": day.isoformat(), "outstanding_shares": 100,
            "shares_unit": "shares", "shares_source": "issuer:shares",
            "shares_as_of": day.isoformat(), "share_basis": "outstanding",
        }, source="issuer")

    old = cap(1000, previous_day)
    if prior_case == "undated":
        old["observations"].append({"value": 900, "as_of": None, "source": "unknown"})
        old.update(status="unavailable", value=None)
    if prior_case == "share_conflict":
        old["observations"].append({"value": None, "shares_conflict": True})
        old.update(status="conflict", value=None)

    class Listing:
        def __init__(self, **kwargs): pass
        def all_symbols(self): return pd.DataFrame()
        symbols_by_exchange = all_symbols
        symbols_by_industries = all_symbols

    class Finance:
        def __init__(self, **kwargs): pass
        def ratio(self, **kwargs): return pd.DataFrame([{"item_id": "pe", "2025": 12}])

    class Quote:
        def __init__(self, **kwargs): pass
        def history(self, **kwargs): return pd.DataFrame()

    async def noop(*args, **kwargs): pass

    monkeypatch.setattr(runtime, "get_listing_class", lambda: Listing)
    monkeypatch.setattr(runtime, "get_finance_class", lambda: Finance)
    monkeypatch.setattr(runtime, "get_quote_class", lambda: Quote)
    pipeline = DataPipeline()
    monkeypatch.setattr(pipeline, "_wait_for_rate_limit", noop)
    monkeypatch.setattr(pipeline, "_cache_set_json", noop)
    async with sessions.begin() as session:
        session.add(Company(symbol="VNM", raw_data={}))
        session.add(ScreenerSnapshot(
            symbol="VNM", snapshot_date=yesterday, trade_date=yesterday, price=10, volume=1,
            market_cap=old["value"], extended_metrics={"price_unit": "VND", "price_source": "quote",
                                                           "market_cap_provenance": old},
        ))
    assert await pipeline.sync_screener_data(symbols=["VNM"]) == 1
    async with sessions() as session:
        carried = (await session.scalars(select(ScreenerSnapshot).where(
            ScreenerSnapshot.symbol == "VNM", ScreenerSnapshot.snapshot_date == today,
        ))).one()
        assert carried.extended_metrics["market_cap_provenance"]["carried_forward"] is True

    async with sessions() as session:
        manager = CacheManager(session)
        latest = cap(1200, today)
        assert await manager.store_screener_data([{
            "symbol": "VNM", "market_cap": latest["value"], "market_cap_provenance": latest,
        }]) == 1
        session.expire_all()
        row = (await session.scalars(select(ScreenerSnapshot).where(
            ScreenerSnapshot.symbol == "VNM", ScreenerSnapshot.snapshot_date == today,
        ))).one()
        evidence = row.extended_metrics["market_cap_provenance"]
        assert row.market_cap == (1200 if prior_case == "older" else None)
        assert evidence["status"] == ("available" if prior_case == "older" else "conflict")
        if prior_case == "undated":
            assert any(item.get("value") == 900 and item.get("as_of") is None
                       for item in evidence["observations"])
