from unittest.mock import AsyncMock

import pytest
from sqlalchemy import MetaData, null
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from vnibb.api.main import app
from vnibb.api.v1 import screener
from vnibb.core.database import get_db
from vnibb.models.financials import BalanceSheet, CashFlow, IncomeStatement
from vnibb.models.stock import Stock, StockPrice
from vnibb.models.trading import FinancialRatio
from vnibb.providers.vnstock.equity_screener import ScreenerData


@pytest.mark.asyncio
@pytest.mark.parametrize("source", ["vietcap", None, "issuer_only"])
async def test_screener_ignores_newer_issuer_financials(client, monkeypatch, source):
    # Legacy deployments can contain NULL sources despite the current ORM constraint.
    metadata = MetaData()
    models = (IncomeStatement, BalanceSheet, CashFlow, FinancialRatio)
    for model in (Stock, StockPrice, *models):
        table = model.__table__.to_metadata(metadata)
        if model in models:
            table.c.source.nullable = True
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    try:
        async with engine.begin() as connection:
            await connection.run_sync(metadata.create_all)
        async with async_sessionmaker(engine, expire_on_commit=False)() as session:
            def add_financials(year, row_source, revenue, income, assets, liabilities, equity, ev):
                common = {
                    "id": year,
                    "symbol": "FPT",
                    "period": str(year),
                    "period_type": "year",
                    "fiscal_year": year,
                    "source": row_source if row_source is not None else null(),
                }
                session.add_all(
                    [
                        IncomeStatement(
                            **common, revenue=revenue, operating_income=income, net_income=income
                        ),
                        BalanceSheet(
                            **common, total_assets=assets, total_liabilities=liabilities,
                            total_equity=equity,
                        ),
                        CashFlow(**common, dividends_paid=income),
                        FinancialRatio(**common, ev_ebitda=ev),
                    ]
                )

            if source != "issuer_only":
                add_financials(2024, source, 100, 10, 100, 40, 60, 8)
                add_financials(2025, source, 150, 30, 200, 50, 150, 9)
            add_financials(2026, "issuer_report", 999, 900, 100, 90, 10, 99)
            await session.commit()

            async def override_get_db():
                yield session

            async def unchanged(rows, *args, **kwargs):
                return rows

            monkeypatch.setitem(app.dependency_overrides, get_db, override_get_db)
            monkeypatch.setattr(
                screener.VnstockScreenerFetcher,
                "fetch",
                AsyncMock(return_value=[ScreenerData(symbol="FPT")]),
            )
            monkeypatch.setattr(screener, "_hydrate_screener_rows", unchanged)
            monkeypatch.setattr(screener, "_enrich_discovery_fields", unchanged)

            response = await client.get("/api/v1/screener/?symbol=FPT&use_cache=false")
            assert response.status_code == 200
            row = response.json()["data"][0]
            if source == "issuer_only":
                assert all(
                    row[field] is None
                    for field in (
                        "year", "ev_ebitda", "revenue_growth", "earnings_growth",
                        "operating_margin", "debt_to_asset", "equity_on_total_asset",
                    )
                )
            else:
                assert row["year"] == 2025
                assert row["ev_ebitda"] == 9
                assert row["revenue_growth"] == 50
                assert row["earnings_growth"] == 200
                assert row["operating_margin"] == 20
                assert row["debt_to_asset"] == 25
                assert row["equity_on_total_asset"] == 75
    finally:
        await engine.dispose()
