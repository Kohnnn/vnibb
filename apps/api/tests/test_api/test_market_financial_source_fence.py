from types import SimpleNamespace

import pytest
import pytest_asyncio
from sqlalchemy import MetaData, null
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from vnibb.api.v1 import market
from vnibb.models.financials import IncomeStatement
from vnibb.models.stock import Stock
from vnibb.models.trading import FinancialRatio


@pytest_asyncio.fixture
async def legacy_market_db():
    metadata = MetaData()
    for model in (Stock, IncomeStatement, FinancialRatio):
        table = model.__table__.to_metadata(metadata)
        if model in (IncomeStatement, FinancialRatio):
            table.c.source.nullable = True
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        yield session, factory
    await engine.dispose()


@pytest.mark.asyncio
async def test_industry_bubble_fences_issuer_before_ranking(legacy_market_db, monkeypatch):
    db, factory = legacy_market_db
    for index, (symbol, source, pe, pb, revenue) in enumerate([
        ("FPT", null(), 10, 2, 100),
        ("VNM", "vietcap", 20, 4, 200),
    ]):
        db.add(FinancialRatio(
            id=index * 2 + 1, symbol=symbol, period="2025", period_type="year",
            fiscal_year=2025, source=source, pe_ratio=pe, pb_ratio=pb,
        ))
        db.add(IncomeStatement(
            id=index * 2 + 1, symbol=symbol, period="2025", period_type="year",
            fiscal_year=2025, source=source, revenue=revenue,
        ))
    for index, symbol in enumerate(("FPT", "VNM", "VCI")):
        db.add(FinancialRatio(
            id=10 + index, symbol=symbol, period="2026", period_type="year",
            fiscal_year=2026, source="issuer_report", pe_ratio=99, pb_ratio=99,
        ))
        db.add(IncomeStatement(
            id=10 + index, symbol=symbol, period="2026", period_type="year",
            fiscal_year=2026, source="issuer_report", revenue=999,
        ))
    await db.commit()

    async def cached_rows(*args, **kwargs):
        return SimpleNamespace(data=[
            {"symbol": symbol, "industry": "Technology", "sector": "technology"}
            for symbol in ("FPT", "VNM", "VCI")
        ])

    async def empty_map(*args, **kwargs):
        return {}

    async def empty_rows(*args, **kwargs):
        return []

    monkeypatch.setattr(market.CacheManager, "get_screener_data", cached_rows)
    monkeypatch.setattr(market, "async_session_maker", factory)
    monkeypatch.setattr(market, "_load_stock_metadata", empty_map)
    monkeypatch.setattr(market, "_load_change_pct_map", empty_map)
    monkeypatch.setattr(market, "_load_latest_screener_rows_from_db", empty_rows)
    monkeypatch.setattr(market, "_resolve_sector_name", lambda *args: "Technology")
    response = await market.get_industry_bubble.__wrapped__(
        symbol="FPT", x_metric="pb_ratio", y_metric="pe_ratio", size_metric="revenue", top_n=5,
    )
    assert {point.symbol: (point.x, point.y, point.size) for point in response.data} == {
        "FPT": (2, 10, 100), "VNM": (4, 20, 200),
    }


@pytest.mark.asyncio
@pytest.mark.parametrize("source", [None, "vietcap"])
async def test_earnings_season_fences_current_and_comparison_rows(legacy_market_db, source):
    db, _ = legacy_market_db
    db.add_all([
        Stock(id=1, symbol="FPT", exchange="HOSE", company_name="FPT"),
        Stock(id=2, symbol="VCI", exchange="HOSE", company_name="VCI"),
        Stock(id=3, symbol="VNM", exchange="HOSE", company_name="VNM"),
        IncomeStatement(
            id=1, symbol="FPT", period="2024-Q4", period_type="quarter",
            fiscal_year=2024, fiscal_quarter=4, source=source if source else null(),
            revenue=100, gross_profit=30, net_income=10,
        ),
        IncomeStatement(
            id=2, symbol="FPT", period="Q4-2024", period_type="quarter",
            fiscal_year=2024, fiscal_quarter=4, source="issuer_report",
            revenue=1000, gross_profit=900, net_income=900,
        ),
        IncomeStatement(
            id=3, symbol="FPT", period="2025-Q4", period_type="quarter",
            fiscal_year=2025, fiscal_quarter=4, source=source if source else null(),
            revenue=200, gross_profit=80, net_income=30,
        ),
        IncomeStatement(
            id=4, symbol="FPT", period="2026-Q4", period_type="quarter",
            fiscal_year=2026, fiscal_quarter=4, source="issuer_report",
            revenue=999, gross_profit=999, net_income=999,
        ),
        IncomeStatement(
            id=5, symbol="VCI", period="2026-Q4", period_type="quarter",
            fiscal_year=2026, fiscal_quarter=4, source="issuer_report", revenue=999,
        ),
        IncomeStatement(
            id=6, symbol="VNM", period="2024-Q4", period_type="quarter",
            fiscal_year=2024, fiscal_quarter=4, source="issuer_report",
            revenue=100, gross_profit=30, net_income=10,
        ),
        IncomeStatement(
            id=7, symbol="VNM", period="2025-Q4", period_type="quarter",
            fiscal_year=2025, fiscal_quarter=4, source=source if source else null(),
            revenue=200, gross_profit=80, net_income=30,
        ),
    ])
    await db.commit()
    response = await market.get_earnings_season.__wrapped__(limit=5, exchange="HOSE", db=db)
    assert response.count == 2
    assert response.season == "Q4 2025"
    rows = {item.symbol: item for item in response.data}
    item = rows["FPT"]
    assert (item.symbol, item.revenue, item.revenue_yoy, item.earnings_yoy, item.gross_margin_delta) == (
        "FPT", 200, 100, 200, 10,
    )
    assert rows["VNM"].revenue_yoy is None
    assert rows["VNM"].earnings_yoy is None
    assert rows["VNM"].gross_margin_delta is None
