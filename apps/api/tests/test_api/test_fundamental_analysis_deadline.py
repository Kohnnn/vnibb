"""Consumer-visible aggregation deadlines without provider or database access."""

import asyncio
from functools import wraps
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI
from vnibb.api.v1 import equity
from vnibb.api.v1.schemas import StandardResponse
from vnibb.core.database import get_db


@pytest.fixture
def fundamental_app(monkeypatch):
    app = FastAPI()
    app.include_router(equity.router, prefix="/equity")
    app.dependency_overrides[get_db] = lambda: None
    for name in (
        "get_profile", "get_financial_ratios", "get_financials", "get_shareholders",
        "get_officers", "get_subsidiaries", "get_company_news", "get_company_events",
    ):
        monkeypatch.setattr(equity, name, AsyncMock(return_value=StandardResponse(data=[])))
    monkeypatch.setattr(
        equity, "get_profile",
        AsyncMock(return_value=StandardResponse(data={"company_name": "FPT Corp"})),
    )
    monkeypatch.setattr(
        equity, "_load_latest_fundamental_snapshot",
        AsyncMock(return_value={
            "snapshotDate": "2024-12-31", "intrinsicValue": None,
            "inputs": {"unitQuality": "verified", "unitLineage": {"price": {"unit": "VND"}}},
        }),
    )
    return app


@pytest.mark.asyncio
@pytest.mark.parametrize("slow_sections", ["balance", "all"])
async def test_fundamental_analysis_bounds_slow_sections_and_keeps_independent_data(
    monkeypatch, fundamental_app, slow_sections,
):
    monkeypatch.setattr(equity, "FUNDAMENTAL_SECTION_TIMEOUT_SECONDS", 0.02, raising=False)
    cancelled = []

    async def slow_section(name):
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.append(name)

    async def financials(**kwargs):
        statement_type = kwargs["statement_type"]
        if statement_type == "balance" or slow_sections == "all":
            return await slow_section(f"financials.{statement_type}")
        return StandardResponse(data=[{"period": "2024", "statement_type": statement_type}])

    @wraps(financials)
    async def cached_financials(**kwargs):
        return await asyncio.shield(financials(**kwargs))

    monkeypatch.setattr(equity, "get_financials", cached_financials)
    if slow_sections == "all":
        for name in (
            "get_profile", "get_financial_ratios", "get_shareholders", "get_officers",
            "get_subsidiaries", "get_company_news", "get_company_events",
            "_load_latest_fundamental_snapshot",
        ):
            async def loader(*args, _name=name, **kwargs):
                return await slow_section(_name)
            monkeypatch.setattr(equity, name, loader)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=fundamental_app), base_url="http://test",
    ) as client:
        async with asyncio.timeout(0.75):
            response = await client.get("/equity/FPT/fundamental-analysis")

    assert response.status_code == 200
    body = response.json()
    data = body["data"]
    assert body["error"] == "Partial data unavailable"
    assert data["financials"]["balance"] == []
    assert data["latest_fundamental_snapshot"]["financials"]["balance"] is None
    assert data["section_errors"]["financials.balance"] == "Section deadline exceeded"
    assert len(cancelled) == (11 if slow_sections == "all" else 1)
    if slow_sections == "all":
        assert len(data["section_errors"]) == 11
        assert data["valuation"] is None
    else:
        assert data["profile"]["company_name"] == "FPT Corp"
        assert data["financials"]["income"][0]["period"] == "2024"
        assert data["financials"]["cashflow"][0]["period"] == "2024"
        assert data["valuation"]["as_of"] == "2024-12-31"
        assert data["valuation"]["intrinsic_value"] is None
        assert equity.get_company_events.await_count == 1


@pytest.mark.asyncio
async def test_fundamental_analysis_propagates_request_cancellation(monkeypatch, fundamental_app):
    started = asyncio.Event()
    stopped = asyncio.Event()

    async def profile(**kwargs):
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            stopped.set()

    monkeypatch.setattr(equity, "get_profile", profile)
    request = asyncio.create_task(equity.get_fundamental_analysis("FPT", db=None))
    await started.wait()
    request.cancel()
    with pytest.raises(asyncio.CancelledError):
        await request
    assert stopped.is_set()
    equity.get_financial_ratios.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("rollback_fails", [False, True])
async def test_fundamental_analysis_recovers_or_withholds_invalid_database_session(
    monkeypatch, fundamental_app, rollback_fails,
):
    monkeypatch.setattr(equity, "FUNDAMENTAL_SECTION_TIMEOUT_SECONDS", 0.02, raising=False)
    db = AsyncMock()
    if rollback_fails:
        db.rollback.side_effect = RuntimeError("connection lost")
    fundamental_app.dependency_overrides[get_db] = lambda: db

    async def profile(**kwargs):
        await asyncio.Event().wait()

    monkeypatch.setattr(equity, "get_profile", profile)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=fundamental_app), base_url="http://test",
    ) as client:
        async with asyncio.timeout(0.75):
            response = await client.get("/equity/FPT/fundamental-analysis")

    data = response.json()["data"]
    db.rollback.assert_awaited_once()
    assert data["section_errors"]["profile"] == "Section deadline exceeded"
    assert equity.get_officers.await_count == 1
    assert data["valuation"]["as_of"] == "2024-12-31"
    if rollback_fails:
        equity.get_financial_ratios.assert_not_awaited()
        equity.get_financials.assert_not_awaited()
        assert data["section_errors"]["ratios"] == "Database session unavailable"
    else:
        equity.get_financial_ratios.assert_awaited_once()
        assert "ratios" not in data["section_errors"]


@pytest.mark.asyncio
async def test_fundamental_analysis_discards_failed_session_before_dependency_commit(
    monkeypatch, fundamental_app,
):
    from sqlalchemy.exc import IntegrityError
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from vnibb.core import database

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    factory = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(equity, "FUNDAMENTAL_SECTION_TIMEOUT_SECONDS", 0.02)
    fundamental_app.dependency_overrides.clear()

    from vnibb.models.stock import Stock
    async with engine.begin() as connection:
        await connection.run_sync(lambda conn: Stock.__table__.create(conn))
    db = factory()
    db.add_all([Stock(id=1, symbol="FPT"), Stock(id=1, symbol="FPT")])
    # Poison the real transaction before starting the timed request, not during
    # its short section deadline; ORM initialization can exceed that budget.
    with pytest.raises(IntegrityError):
        await db.flush()
    db.rollback = AsyncMock(side_effect=RuntimeError("connection lost"))
    monkeypatch.setattr(database, "async_session_factory", lambda: db)

    async def profile(**kwargs):
        await asyncio.Event().wait()
    monkeypatch.setattr(equity, "get_profile", profile)
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=fundamental_app), base_url="http://test",
        ) as client:
            async with asyncio.timeout(0.75):
                response = await client.get("/equity/FPT/fundamental-analysis")
        assert response.status_code == 200
        assert response.json()["error"] == "Partial data unavailable"
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_fundamental_analysis_runs_independent_sections_while_database_is_blocked(
    monkeypatch, fundamental_app,
):
    independent_completed = asyncio.Event()
    profile_active = False
    database_active = False
    independent_saw_profile = []

    async def profile(**kwargs):
        nonlocal profile_active, database_active
        assert not database_active
        database_active = profile_active = True
        try:
            await independent_completed.wait()
            return StandardResponse(data={"company_name": "FPT Corp"})
        finally:
            database_active = profile_active = False

    async def database_section(**kwargs):
        nonlocal database_active
        assert not database_active
        database_active = True
        try:
            await asyncio.sleep(0)
            return StandardResponse(data=[])
        finally:
            database_active = False

    async def officers(**kwargs):
        independent_saw_profile.append(profile_active)
        independent_completed.set()
        return StandardResponse(data=[{"name": "Independent officer"}])

    monkeypatch.setattr(equity, "get_profile", profile)
    monkeypatch.setattr(equity, "get_officers", officers)
    for name in ("get_financial_ratios", "get_financials", "get_shareholders", "get_company_events"):
        monkeypatch.setattr(equity, name, database_section)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=fundamental_app), base_url="http://test",
    ) as client:
        response = await client.get("/equity/FPT/fundamental-analysis")

    assert response.status_code == 200
    data = response.json()["data"]
    assert independent_saw_profile == [True]
    assert data["profile"]["company_name"] == "FPT Corp"
    assert data["officers"] == [{"name": "Independent officer"}]
    assert "profile" not in data["section_errors"]


@pytest.mark.asyncio
async def test_fundamental_analysis_cancels_and_awaits_independent_sections(monkeypatch, fundamental_app):
    started = asyncio.Event()
    stopped = asyncio.Event()

    async def officers(**kwargs):
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            await asyncio.sleep(0)
            stopped.set()

    monkeypatch.setattr(equity, "get_officers", officers)
    request = asyncio.create_task(equity.get_fundamental_analysis("FPT", db=None))
    await started.wait()
    request.cancel()
    with pytest.raises(asyncio.CancelledError):
        await request
    assert stopped.is_set()
