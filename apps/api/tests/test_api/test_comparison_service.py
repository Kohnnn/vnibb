from __future__ import annotations

from datetime import date, datetime

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from vnibb.models.financials import BalanceSheet, CashFlow, IncomeStatement
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models.stock import Stock
from vnibb.models.trading import FinancialRatio
from vnibb.services.cache_manager import CacheResult
from vnibb.services.comparison_service import ComparisonService, StockMetrics, get_comparison_data


@pytest.mark.asyncio
async def test_get_stock_metrics_backfills_bvps_and_roic_from_financial_ratios(
    test_engine,
    test_db,
    monkeypatch,
):
    test_db.add(
        Stock(
            symbol="VCI",
            exchange="HOSE",
            company_name="Vietcap Securities",
            industry="Financial Services",
        )
    )
    test_db.add(
        FinancialRatio(
            id=1,
            symbol="VCI",
            period="2024",
            period_type="year",
            fiscal_year=2024,
            fiscal_quarter=None,
            bvps=25_000.0,
            roic=18.5,
            pb_ratio=1.28,
            updated_at=datetime.utcnow(),
        )
    )
    await test_db.commit()

    service = ComparisonService()
    screener_row = ScreenerSnapshot(
        symbol="VCI",
        snapshot_date=date(2026, 3, 20),
        company_name="Vietcap Securities",
        exchange="HOSE",
        industry="Financial Services",
        price=32_000.0,
        pe=10.5,
        pb=None,
        roic=None,
        bvps=None,
        source="KBS",
        created_at=datetime.utcnow(),
    )

    async def fake_get_screener_data(*_args, **_kwargs):
        return CacheResult(
            data=[screener_row],
            is_stale=False,
            cached_at=datetime.utcnow(),
            hit=True,
        )

    monkeypatch.setattr(service.cache_manager, "get_screener_data", fake_get_screener_data)
    monkeypatch.setattr(
        "vnibb.services.comparison_service.async_session_maker",
        async_sessionmaker(test_engine, expire_on_commit=False),
    )

    result = await service.get_stock_metrics("VCI")

    assert result.industry == "Financial Services"
    assert result.metrics["bvps"] == 25_000.0
    assert result.metrics["roic"] == 18.5
    assert result.metrics["pb"] == 1.28


@pytest.mark.asyncio
async def test_get_sector_averages_falls_back_to_latest_ratio_rows(
    test_engine, test_db, monkeypatch
):
    await test_db.commit()

    service = ComparisonService()
    screener_rows = [
        ScreenerSnapshot(
            symbol="VCI",
            snapshot_date=date(2026, 3, 20),
            company_name="Vietcap Securities",
            exchange="HOSE",
            industry="Financial Services",
            pe=10.0,
            roic=None,
            bvps=None,
            source="KBS",
            created_at=datetime.utcnow(),
        ),
        ScreenerSnapshot(
            symbol="SSI",
            snapshot_date=date(2026, 3, 20),
            company_name="SSI Securities",
            exchange="HOSE",
            industry="Financial Services",
            pe=12.0,
            roic=None,
            bvps=None,
            source="KBS",
            created_at=datetime.utcnow(),
        ),
    ]

    test_db.add_all(
        [
            FinancialRatio(
                id=1,
                symbol="VCI",
                period="2024",
                period_type="year",
                fiscal_year=2024,
                fiscal_quarter=None,
                roic=18.0,
                bvps=22_000.0,
                updated_at=datetime.utcnow(),
            ),
            FinancialRatio(
                id=2,
                symbol="SSI",
                period="2024",
                period_type="year",
                fiscal_year=2024,
                fiscal_quarter=None,
                roic=12.0,
                bvps=18_000.0,
                updated_at=datetime.utcnow(),
            ),
        ]
    )
    await test_db.commit()

    async def fake_get_all_screener_data(*_args, **_kwargs):
        return screener_rows

    monkeypatch.setattr(service, "_get_all_screener_data", fake_get_all_screener_data)
    monkeypatch.setattr(
        "vnibb.services.comparison_service.async_session_maker",
        async_sessionmaker(test_engine, expire_on_commit=False),
    )

    averages = await service.get_sector_averages("Financial Services")

    assert averages["pe"] == pytest.approx(11.0)
    assert averages["roic"] == pytest.approx(15.0)
    assert averages["bvps"] == pytest.approx(20_000.0)


@pytest.mark.asyncio
async def test_get_comparison_data_derives_missing_metrics_and_sanitizes_negative_debt_equity(
    test_engine,
    test_db,
    monkeypatch,
):
    test_db.add(
        Stock(
            symbol="VIC",
            exchange="HOSE",
            company_name="Vingroup",
            industry="Real Estate",
        )
    )
    test_db.add_all(
        [
            IncomeStatement(
                id=100,
                symbol="VIC",
                period="2024",
                period_type="year",
                fiscal_year=2024,
                revenue=1_200.0,
                gross_profit=624.0,
                operating_income=240.0,
                net_income=180.0,
                interest_expense=30.0,
            ),
            IncomeStatement(
                id=101,
                symbol="VIC",
                period="2023",
                period_type="year",
                fiscal_year=2023,
                revenue=1_000.0,
                net_income=150.0,
            ),
            BalanceSheet(
                id=100,
                symbol="VIC",
                period="2024",
                period_type="year",
                fiscal_year=2024,
                total_assets=2_000.0,
                total_liabilities=900.0,
                total_equity=1_100.0,
            ),
            CashFlow(
                id=100,
                symbol="VIC",
                period="2024",
                period_type="year",
                fiscal_year=2024,
                operating_cash_flow=210.0,
                free_cash_flow=130.0,
                debt_repayment=-40.0,
            ),
        ]
    )
    await test_db.commit()

    async def fake_get_stock_metrics(_symbol: str, source: str = "KBS"):
        _ = source
        return StockMetrics(
            symbol="VIC",
            name="Vingroup",
            industry="Real Estate",
            metrics={
                "market_cap": 2_500.0,
                "gross_margin": 51.99,
                "debt_to_equity": -27.1419,
            },
        )

    async def fake_fetch_ratios(*_args, **_kwargs):
        return []

    monkeypatch.setattr(
        "vnibb.services.comparison_service.comparison_service.get_stock_metrics",
        fake_get_stock_metrics,
    )
    monkeypatch.setattr(
        "vnibb.providers.vnstock.financial_ratios.VnstockFinancialRatiosFetcher.fetch",
        fake_fetch_ratios,
    )
    monkeypatch.setattr(
        "vnibb.services.comparison_service.async_session_maker",
        async_sessionmaker(test_engine, expire_on_commit=False),
    )

    results = await get_comparison_data(["VIC"], period="FY")

    metrics = results[0].metrics
    assert metrics["gross_margin"] == pytest.approx(51.99)
    assert metrics["asset_turnover"] == pytest.approx(0.6)
    assert metrics["debt_assets"] == pytest.approx(45.0)
    assert metrics["fcf_yield"] == pytest.approx((130.0 / 2_500.0) * 100)
    assert metrics["ocf_sales"] == pytest.approx((210.0 / 1_200.0) * 100)
    assert metrics["debt_equity"] == pytest.approx(900.0 / 1_100.0)
