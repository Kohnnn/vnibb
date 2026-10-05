from __future__ import annotations

from datetime import date, datetime

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from vnibb.models.financials import BalanceSheet, CashFlow, IncomeStatement
from vnibb.models.company import Company
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models.stock import Stock, StockPrice
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
async def test_get_peers_treats_zero_pe_as_missing_and_backfills_snapshot(
    test_engine, test_db, monkeypatch
):
    service = ComparisonService()
    latest_snapshot_date = date(2026, 5, 18)
    test_db.add(
        ScreenerSnapshot(
            symbol="SSI",
            snapshot_date=latest_snapshot_date,
            company_name="SSI Securities",
            exchange="HOSE",
            industry="Financial Services",
            market_cap=900.0,
            pe=12.3,
            roe=14.0,
            price=28.0,
            extended_metrics={"price_unit": "THOUSAND_VND"},
            source="KBS",
            created_at=datetime.utcnow(),
        )
    )
    await test_db.commit()

    async def fake_get_all_screener_data(*_args, **_kwargs):
        return [
            {
                "symbol": "VCI",
                "company_name": "Vietcap Securities",
                "industry": "Financial Services",
                "sector": "Financials",
                "exchange": "HOSE",
                "market_cap": 1_000.0,
                "pe": 10.0,
            },
            {
                "symbol": "SSI",
                "company_name": "SSI Securities",
                "industry": "Financial Services",
                "sector": "Financials",
                "exchange": "HOSE",
                "market_cap": 900.0,
                "pe": 0,
            },
        ]

    monkeypatch.setattr(service, "_get_all_screener_data", fake_get_all_screener_data)
    monkeypatch.setattr(
        "vnibb.services.comparison_service.async_session_maker",
        async_sessionmaker(test_engine, expire_on_commit=False),
    )

    result = await service.get_peers("VCI", limit=1)

    assert result.count == 1
    assert result.peers[0].symbol == "SSI"
    assert result.peers[0].pe_ratio == pytest.approx(12.3)
    assert result.peers[0].price == 28_000.0


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


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("source", "close", "expected_cap"),
    [
        ("vnstock_vnd:KBS", 32_000.0, 3_200_000_000_000.0),
        ("KBS", 32.0, 3_200_000_000_000.0),
        ("vnstock", 32.0, 3_000_000_000_000.0),
        ("ohlcv_backfill_full", 32_000.0, 3_000_000_000_000.0),
    ],
)
async def test_market_cap_recompute_requires_known_vnd_price(
    test_engine, test_db, monkeypatch, source, close, expected_cap
):
    test_db.add(Stock(id=1, symbol="VCI", exchange="HOSE"))
    test_db.add(Company(symbol="VCI", outstanding_shares=100_000_000))
    test_db.add(StockPrice(
        id=1, symbol="VCI", stock_id=1, time=date.today(), interval="1D", source=source,
        open=close, high=close, low=close, close=close, volume=100,
    ))
    await test_db.commit()
    service = ComparisonService()

    async def fake_get_screener_data(*_args, **_kwargs):
        return CacheResult(
            data=[ScreenerSnapshot(symbol="VCI", snapshot_date=date.today(), market_cap=3_000_000_000_000)],
            is_stale=False, cached_at=datetime.utcnow(), hit=True,
        )

    monkeypatch.setattr(service.cache_manager, "get_screener_data", fake_get_screener_data)
    monkeypatch.setattr(
        "vnibb.services.comparison_service.async_session_maker",
        async_sessionmaker(test_engine, expire_on_commit=False),
    )
    result = await service.get_stock_metrics("VCI")
    assert result.metrics["market_cap"] == pytest.approx(expected_cap)


@pytest.mark.asyncio
async def test_price_performance_excludes_unknown_units_and_preserves_points(monkeypatch):
    from vnibb.providers.vnstock.equity_historical import EquityHistoricalData

    async def fake_fetch(params):
        unit = "index_points" if params.symbol == "VNINDEX" else "VND" if params.symbol == "VCI" else "unknown"
        return [
            EquityHistoricalData(symbol=params.symbol, time=day, price_unit=unit,
                                 open=close, high=close, low=close, close=close, volume=100)
            for day, close in [(date(2026, 9, 1), 100.0), (date(2026, 9, 2), 110.0)]
        ]

    monkeypatch.setattr("vnibb.providers.vnstock.equity_historical.VnstockEquityHistoricalFetcher.fetch", fake_fetch)
    result = await ComparisonService().compare_price_performance(["VCI", "VNINDEX", "UNKNOWN"])
    assert result[-1].values == {"VCI": pytest.approx(110.0), "VNINDEX": pytest.approx(110.0)}
