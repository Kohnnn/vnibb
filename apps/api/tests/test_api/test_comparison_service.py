from __future__ import annotations

from datetime import date, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from vnibb.core.market_cap import resolve_market_cap
from vnibb.models.company import Company
from vnibb.models.financials import BalanceSheet, CashFlow, IncomeStatement
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
            interest_coverage=8.0,
            raw_data={"ratio_units": {"roic": "percent"}},
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
    assert result.metrics.get("interest_coverage") is None


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
            extended_metrics={"price_unit": "THOUSAND_VND", "ratio_units": {"roe": "percent"}},
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
    assert result.peers[0].market_cap is None


@pytest.mark.asyncio
async def test_get_peers_withholds_older_cached_cap_when_latest_snapshot_conflicts(
    test_engine, test_db, monkeypatch
):
    service = ComparisonService()
    as_of = date.today().isoformat()

    def certified(value):
        return resolve_market_cap({
            "market_cap": value, "market_cap_source": "issuer:cap",
            "market_cap_unit": "VND", "market_cap_currency": "VND",
            "market_cap_as_of": as_of, "outstanding_shares": 100,
            "shares_unit": "shares", "shares_source": "issuer:shares",
            "shares_as_of": as_of, "share_basis": "outstanding",
        }, source="test")

    old_cap = certified(1000)
    conflicting_cap = {**old_cap, "status": "conflict", "value": None}
    test_db.add(ScreenerSnapshot(
        symbol="SSI", snapshot_date=date.today(), market_cap=None,
        extended_metrics={"market_cap_provenance": conflicting_cap},
    ))
    await test_db.commit()

    async def universe(*_args, **_kwargs):
        return [
            {"symbol": "VCI", "industry": "Financial Services", "sector": "Financials", "exchange": "HOSE"},
            {"symbol": "SSI", "industry": "Financial Services", "sector": "Financials", "exchange": "HOSE",
             "market_cap": 1000, "market_cap_provenance": old_cap},
        ]

    monkeypatch.setattr(service, "_get_all_screener_data", universe)
    monkeypatch.setattr(
        "vnibb.services.comparison_service.async_session_maker",
        async_sessionmaker(test_engine, expire_on_commit=False),
    )
    result = await service.get_peers("VCI", limit=1)
    assert result.count == 1
    assert result.peers[0].symbol == "SSI"
    assert result.peers[0].market_cap is None


@pytest.mark.asyncio
@pytest.mark.parametrize("snapshot_is_newer", [True, False])
async def test_get_peers_uses_newer_certified_cap_without_conflicting_historical_dates(
    test_engine, test_db, monkeypatch, snapshot_is_newer
):
    service = ComparisonService()
    today = date.today()
    yesterday = today - timedelta(days=1)

    def certified(value, day):
        return resolve_market_cap({
            "market_cap": value, "market_cap_source": "issuer:cap",
            "market_cap_unit": "VND", "market_cap_currency": "VND",
            "market_cap_as_of": day.isoformat(), "outstanding_shares": 100,
            "shares_unit": "shares", "shares_source": "issuer:shares",
            "shares_as_of": day.isoformat(), "share_basis": "outstanding",
        }, source="test")

    cached = certified(1000, yesterday if snapshot_is_newer else today)
    snapshot = certified(1200, today if snapshot_is_newer else yesterday)
    test_db.add(ScreenerSnapshot(
        symbol="SSI", snapshot_date=today, market_cap=1200,
        extended_metrics={"market_cap_provenance": snapshot},
    ))
    await test_db.commit()

    async def universe(*_args, **_kwargs):
        return [
            {"symbol": "VCI", "industry": "Financial Services", "sector": "Financials", "exchange": "HOSE"},
            {"symbol": "SSI", "industry": "Financial Services", "sector": "Financials", "exchange": "HOSE",
             "market_cap": 1000, "market_cap_provenance": cached},
        ]

    monkeypatch.setattr(service, "_get_all_screener_data", universe)
    monkeypatch.setattr(
        "vnibb.services.comparison_service.async_session_maker",
        async_sessionmaker(test_engine, expire_on_commit=False),
    )
    result = await service.get_peers("VCI", limit=1)
    assert result.count == 1
    assert result.peers[0].symbol == "SSI"
    assert result.peers[0].market_cap == (1200 if snapshot_is_newer else 1000)


@pytest.mark.asyncio
@pytest.mark.parametrize("conflict_date", ["older", "same", "unknown"])
async def test_get_peers_scopes_cached_conflict_by_observation_date(
    test_engine, test_db, monkeypatch, conflict_date
):
    service = ComparisonService()
    today = date.today()
    conflict_day = today - timedelta(days=1) if conflict_date == "older" else today

    def certified(value, day):
        return resolve_market_cap({
            "market_cap": value, "market_cap_source": "issuer:cap",
            "market_cap_unit": "VND", "market_cap_currency": "VND",
            "market_cap_as_of": day.isoformat(), "outstanding_shares": 100,
            "shares_unit": "shares", "shares_source": "issuer:shares",
            "shares_as_of": day.isoformat(), "share_basis": "outstanding",
        }, source="test")

    first = certified(1000, conflict_day)
    second = certified(1100, conflict_day)
    observations = first["observations"] + second["observations"]
    if conflict_date == "unknown":
        observations[1] = {**observations[1], "as_of": None}
    conflict = {**first, "status": "conflict", "value": None, "observations": observations}
    latest = certified(1200, today)
    test_db.add(ScreenerSnapshot(
        symbol="SSI", snapshot_date=today, market_cap=1200,
        extended_metrics={"market_cap_provenance": latest},
    ))
    await test_db.commit()

    async def universe(*_args, **_kwargs):
        return [
            {"symbol": "VCI", "industry": "Financial Services", "sector": "Financials", "exchange": "HOSE"},
            {"symbol": "SSI", "industry": "Financial Services", "sector": "Financials", "exchange": "HOSE",
             "market_cap": None, "market_cap_provenance": conflict},
        ]

    monkeypatch.setattr(service, "_get_all_screener_data", universe)
    monkeypatch.setattr(
        "vnibb.services.comparison_service.async_session_maker",
        async_sessionmaker(test_engine, expire_on_commit=False),
    )
    result = await service.get_peers("VCI", limit=1)
    assert result.count == 1
    assert result.peers[0].symbol == "SSI"
    assert result.peers[0].market_cap == (1200 if conflict_date == "older" else None)


@pytest.mark.asyncio
@pytest.mark.parametrize("share_conflict", [False, True])
async def test_get_peers_ignores_valueless_historical_derivation_but_not_share_conflict(
    test_engine, test_db, monkeypatch, share_conflict
):
    service = ComparisonService()
    old_day = date.today() - timedelta(days=2)
    new_day = date.today() - timedelta(days=1)

    def record(value, day):
        return {
            "market_cap": value, "market_cap_source": "issuer:cap",
            "market_cap_unit": "VND", "market_cap_currency": "VND",
            "market_cap_as_of": day.isoformat(), "outstanding_shares": 100,
            "shares_unit": "shares", "shares_source": "issuer:shares",
            "shares_as_of": day.isoformat(), "share_basis": "outstanding",
        }

    old = resolve_market_cap(
        record(1000, old_day), source="issuer",
        price_record={"price": 12, "price_unit": "VND", "price_source": "exchange",
                      "trade_date": new_day.isoformat()},
    )
    assert old["status"] == "available"
    assert any(item.get("value") is None and item.get("as_of") == new_day.isoformat()
               for item in old["observations"])
    if share_conflict:
        old["status"] = "conflict"
        old["value"] = None
        old["observations"][-1]["shares_conflict"] = True
    latest = resolve_market_cap(record(1200, new_day), source="issuer")
    test_db.add(ScreenerSnapshot(
        symbol="SSI", snapshot_date=date.today(), market_cap=1200,
        extended_metrics={"market_cap_provenance": latest},
    ))
    await test_db.commit()

    async def universe(*_args, **_kwargs):
        return [
            {"symbol": "VCI", "industry": "Financial Services", "sector": "Financials", "exchange": "HOSE"},
            {"symbol": "SSI", "industry": "Financial Services", "sector": "Financials", "exchange": "HOSE",
             "market_cap": old["value"], "market_cap_provenance": old},
        ]

    monkeypatch.setattr(service, "_get_all_screener_data", universe)
    monkeypatch.setattr(
        "vnibb.services.comparison_service.async_session_maker",
        async_sessionmaker(test_engine, expire_on_commit=False),
    )
    result = await service.get_peers("VCI", limit=1)
    assert result.count == 1
    assert result.peers[0].symbol == "SSI"
    assert result.peers[0].market_cap == (None if share_conflict else 1200)


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
            market_cap_provenance=resolve_market_cap({
                "market_cap": 2_500.0, "market_cap_source": "certified",
                "market_cap_unit": "VND", "market_cap_currency": "VND",
                "market_cap_as_of": "2024-12-31", "outstanding_shares": 100,
                "shares_unit": "shares", "shares_as_of": "2024-12-31",
                "shares_source": "issuer", "share_basis": "outstanding",
            }, source="test"),
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
    assert results[0].market_cap_provenance["status"] == "available"
    assert metrics["market_cap"] == results[0].market_cap_provenance["value"]


@pytest.mark.asyncio
async def test_comparison_does_not_restore_unverified_market_cap(test_engine, test_db, monkeypatch):
    await test_db.commit()
    provenance = resolve_market_cap({"market_cap": 22_410_910_941.25}, source="VCI")

    async def fake_get_stock_metrics(*_args, **_kwargs):
        return StockMetrics(symbol="VCI", metrics={"market_cap": 22_410_910_941.25, "pe": 10},
                            market_cap_provenance=provenance)

    async def fake_fetch_ratios(*_args, **_kwargs):
        return []

    async def load_rows(_symbol, model, *_args, **_kwargs):
        if model is IncomeStatement:
            return [IncomeStatement(
                symbol="VCI", period="2025", period_type="year", fiscal_year=2025,
                revenue=1_000,
            )]
        if model is CashFlow:
            return [CashFlow(
                symbol="VCI", period="2025", period_type="year", fiscal_year=2025,
                free_cash_flow=200, operating_cash_flow=250,
            )]
        return []

    monkeypatch.setattr("vnibb.services.comparison_service._load_statement_rows", load_rows)

    monkeypatch.setattr("vnibb.services.comparison_service.comparison_service.get_stock_metrics",
                        fake_get_stock_metrics)
    monkeypatch.setattr("vnibb.providers.vnstock.financial_ratios.VnstockFinancialRatiosFetcher.fetch",
                        fake_fetch_ratios)
    monkeypatch.setattr("vnibb.services.comparison_service.async_session_maker",
                        async_sessionmaker(test_engine, expire_on_commit=False))
    result = (await get_comparison_data(["VCI"]))[0]
    assert "market_cap" not in result.metrics
    assert result.market_cap_provenance["status"] == "unavailable"
    assert result.market_cap_provenance["observations"] == provenance["observations"]
    assert result.metrics["pe_ratio"] == 10
    assert result.metrics["fcf_yield"] is None
    assert result.metrics["ocf_sales"] == pytest.approx(25)


@pytest.mark.asyncio
async def test_sector_average_excludes_unqualified_market_caps(test_engine, test_db, monkeypatch):
    await test_db.commit()
    service = ComparisonService()

    async def fake_get_all_screener_data(*_args, **_kwargs):
        return [{"symbol": "VCI", "industry": "Financial Services", "market_cap": 22_410_910_941.25,
                 "pe": 10}]

    monkeypatch.setattr(service, "_get_all_screener_data", fake_get_all_screener_data)
    monkeypatch.setattr("vnibb.services.comparison_service.async_session_maker",
                        async_sessionmaker(test_engine, expire_on_commit=False))
    averages = await service.get_sector_averages("Financial Services")
    assert "market_cap" not in averages
    assert averages["pe"] == 10


@pytest.mark.asyncio
@pytest.mark.parametrize("source,close", [
    ("vnstock_vnd:KBS", 32_000.0), ("KBS", 32.0),
    ("vnstock", 32.0), ("ohlcv_backfill_full", 32_000.0),
])
async def test_market_cap_recompute_requires_dated_share_lineage(
    test_engine, test_db, monkeypatch, source, close
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
    assert "market_cap" not in result.metrics
    assert result.market_cap_provenance["status"] == "unavailable"
    assert any(item["value"] == 3_000_000_000_000 for item in result.market_cap_provenance["observations"])


@pytest.mark.asyncio
async def test_compare_preserves_market_cap_provenance(monkeypatch):
    service = ComparisonService()
    provenance = resolve_market_cap({"market_cap": 22_410_910_941.25}, source="VCI")

    async def fake_metrics(symbol, **_kwargs):
        return StockMetrics(symbol=symbol, metrics={"pe": 10}, market_cap_provenance=provenance)

    async def fake_history(*_args, **_kwargs):
        return []

    monkeypatch.setattr(service, "get_stock_metrics", fake_metrics)
    monkeypatch.setattr(service, "compare_price_performance", fake_history)
    response = await service.compare(["VCI"])
    stock = response.model_dump()["data"]["VCI"]
    assert stock["market_cap_provenance"] == provenance
    assert "market_cap" not in stock["metrics"]


@pytest.mark.asyncio
async def test_vci_captured_market_cap_preserves_unverified_evidence(test_engine, test_db, monkeypatch):
    day = date(2026, 10, 27)
    test_db.add(Stock(id=1, symbol="VCI", exchange="HOSE"))
    test_db.add(Company(symbol="VCI", outstanding_shares=1_152_231_925))
    test_db.add(StockPrice(
        id=1, symbol="VCI", stock_id=1, time=day, interval="1D", source="vnstock_vnd:VCI",
        open=19_150, high=19_150, low=19_150, close=19_150, volume=100,
    ))
    await test_db.commit()
    service = ComparisonService()

    async def fake_get_screener_data(*_args, **_kwargs):
        return CacheResult(
            data=[ScreenerSnapshot(symbol="VCI", snapshot_date=day, market_cap=22_410_910_941.25)],
            is_stale=False, cached_at=datetime.utcnow(), hit=True,
        )

    monkeypatch.setattr(service.cache_manager, "get_screener_data", fake_get_screener_data)
    monkeypatch.setattr(
        "vnibb.services.comparison_service.async_session_maker",
        async_sessionmaker(test_engine, expire_on_commit=False),
    )
    result = await service.get_stock_metrics("VCI")
    assert "market_cap" not in result.metrics
    provenance = result.market_cap_provenance
    assert provenance["status"] == "unavailable" and provenance["reason"]
    assert any(item["value"] == 22_410_910_941.25 for item in provenance["observations"])
    assert any(item["price"] == 19_150 and item["shares"] == 1_152_231_925
               for item in provenance["observations"])


@pytest.mark.asyncio
@pytest.mark.parametrize("reported,status,expected", [
    (None, "available", 3_200_000),
    (3_200_000, "available", 3_200_000),
    (4_000_000, "conflict", None),
])
async def test_market_cap_certified_lineage_and_conflicts(
    test_engine, test_db, monkeypatch, reported, status, expected
):
    day = date(2026, 10, 27)
    shares = {"shares_unit": "shares", "shares_as_of": day.isoformat(),
              "shares_source": "issuer", "share_basis": "outstanding"}
    test_db.add(Stock(id=1, symbol="VCI", exchange="HOSE"))
    test_db.add(Company(symbol="VCI", outstanding_shares=100_000_000, listed_shares=100_000_000,
                        raw_data={**shares, "shares_outstanding": 100}))
    test_db.add(StockPrice(
        id=1, symbol="VCI", stock_id=1, time=day, interval="1D", source="vnstock_vnd:VCI",
        open=32_000, high=32_000, low=32_000, close=32_000, volume=100,
    ))
    await test_db.commit()
    service = ComparisonService()

    async def fake_get_screener_data(*_args, **_kwargs):
        return CacheResult(
            data=[ScreenerSnapshot(symbol="VCI", snapshot_date=day, market_cap=reported,
                extended_metrics={**shares, "outstanding_shares": 100,
                    "market_cap_source": "issuer", "market_cap_unit": "VND",
                    "market_cap_currency": "VND", "market_cap_as_of": day.isoformat()})],
            is_stale=False, cached_at=datetime.utcnow(), hit=True,
        )

    monkeypatch.setattr(service.cache_manager, "get_screener_data", fake_get_screener_data)
    monkeypatch.setattr(
        "vnibb.services.comparison_service.async_session_maker",
        async_sessionmaker(test_engine, expire_on_commit=False),
    )
    result = await service.get_stock_metrics("VCI")
    assert result.market_cap_provenance["status"] == status
    assert result.metrics.get("market_cap") == expected
    assert result.market_cap_provenance["value"] == expected


@pytest.mark.asyncio
async def test_market_cap_never_uses_listed_shares(test_engine, test_db, monkeypatch):
    day = date(2026, 10, 27)
    test_db.add(Stock(id=1, symbol="VCI", exchange="HOSE"))
    test_db.add(Company(symbol="VCI", listed_shares=100, raw_data={
        "shares_unit": "shares", "shares_as_of": day.isoformat(),
        "shares_source": "issuer", "share_basis": "outstanding",
    }))
    test_db.add(StockPrice(
        id=1, symbol="VCI", stock_id=1, time=day, interval="1D", source="vnstock_vnd:VCI",
        open=32_000, high=32_000, low=32_000, close=32_000, volume=100,
    ))
    await test_db.commit()
    service = ComparisonService()

    async def fake_get_screener_data(*_args, **_kwargs):
        return CacheResult(data=[ScreenerSnapshot(symbol="VCI", snapshot_date=day)],
                           is_stale=False, cached_at=datetime.utcnow(), hit=True)

    monkeypatch.setattr(service.cache_manager, "get_screener_data", fake_get_screener_data)
    monkeypatch.setattr("vnibb.services.comparison_service.async_session_maker",
                        async_sessionmaker(test_engine, expire_on_commit=False))
    result = await service.get_stock_metrics("VCI")
    assert result.market_cap_provenance["status"] == "unavailable"
    assert "market_cap" not in result.metrics


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


def test_normalize_comparison_metric_never_infers_a_magnitude():
    """#106: stored comparison percents are canonical; no magnitude heuristics.

    The canonical percent values are already scaled (the derived backfill
    multiplies by 100). A stored fraction must not be silently promoted, and an
    out-of-bound value is unknown rather than divided down to fit.
    """
    from vnibb.services.comparison_service import _normalize_comparison_metric

    # Whole-unit percent stays exactly as stored (fixture unit is whole).
    assert _normalize_comparison_metric("ocf_sales", 1) == 1
    assert _normalize_comparison_metric("ocf_sales", 21.5) == 21.5
    # A fraction is no longer promoted to 100x.
    assert _normalize_comparison_metric("roe", 0.25) == 0.25
    # A value above the plausible percent bound is unknown, not rescaled.
    assert _normalize_comparison_metric("roe", 25_000.0) is None
    # Non-numeric and missing stay missing.
    assert _normalize_comparison_metric("roe", None) is None
    assert _normalize_comparison_metric("roe", "") is None


def test_ratio_json_percent_keys_follow_the_writer_unit_declaration():
    """#106: `ocf_sales`/`fcf_yield` convert only when the writer declared a unit.

    `_enrich_ratio_rows` writes `operating_cash_flow / revenue` and
    `free_cash_flow / market_cap` and records `ratio_units[...] = "fraction"`,
    while the comparison contract declares `format="percent"`. Reading follows
    that declaration: a fraction converts once, a declared percent is already
    canonical, and an undeclared or conflicting unit is withheld rather than
    guessed (#106). No other key and no column is rescaled.
    """
    from types import SimpleNamespace

    from vnibb.services.comparison_service import _metric_from_ratio_row, _ratio_json_metric

    fraction = {
        "ocf_sales": 0.001, "fcf_yield": 0.052, "roe": 0.25,
        "ratio_units": {"ocf_sales": "fraction", "fcf_yield": "fraction"},
    }
    assert _ratio_json_metric("ocf_sales", fraction, "ocfSales") == pytest.approx(0.1)
    assert _ratio_json_metric("fcf_yield", fraction, "fcfYield") == pytest.approx(5.2)
    # An undeclared key is withheld here too; downstream admission already
    # withholds percent fields without a `percent` marker.
    assert _ratio_json_metric("roe", fraction) is None

    percent = {"ocf_sales": 2, "fcf_yield": 2, "ratio_units": {"ocf_sales": "percent", "fcf_yield": "percent"}}
    assert _ratio_json_metric("ocf_sales", percent) == pytest.approx(2)
    assert _ratio_json_metric("fcf_yield", percent) == pytest.approx(2)

    # Undeclared, unknown and conflicting units are withheld, never assumed.
    assert _ratio_json_metric("ocf_sales", {"ocf_sales": 2}) is None
    assert _ratio_json_metric("ocf_sales", {"ocf_sales": 2, "ratio_units": {}}) is None
    assert _ratio_json_metric("ocf_sales", {"ocf_sales": 2, "ratio_units": {"ocf_sales": "unknown"}}) is None
    assert _ratio_json_metric("ocf_sales", {"ocf_sales": 2, "ratio_units": {"ocf_sales": "conflict"}}) is None

    row = SimpleNamespace(pe_ratio=12.0, raw_data=fraction)
    assert _metric_from_ratio_row(row, "ocf_sales") == pytest.approx(0.1)
    # A column value is returned as stored, never rescaled.
    assert _metric_from_ratio_row(row, "pe") == pytest.approx(12.0)


def test_ratio_json_scopes_unit_admission_to_percent_format_metrics():
    """#106: only percent-format metrics need a declared unit.

    `_metric_from_ratio_row` reads every metric missing its column through the
    raw-JSON path. Plain ratios such as `ocf_debt` and `debt_service_coverage`
    carry no unit and must keep the stored value; percent-format metrics without
    a declaration must not.
    """
    from types import SimpleNamespace

    from vnibb.services.comparison_service import _metric_from_ratio_row, _ratio_json_metric

    raw = {"ocf_debt": 0.35, "debt_service_coverage": 6.0, "ocf_sales": 2.0}
    assert _ratio_json_metric("ocf_debt", raw) == pytest.approx(0.35)
    assert _ratio_json_metric("debt_service_coverage", raw) == pytest.approx(6.0)
    # A percent-format metric with no declaration is still withheld.
    assert _ratio_json_metric("ocf_sales", raw) is None

    row = SimpleNamespace(pe_ratio=12.0, raw_data=raw)
    assert _metric_from_ratio_row(row, "ocf_debt") == pytest.approx(0.35)
    assert _metric_from_ratio_row(row, "debt_service_coverage") == pytest.approx(6.0)
    assert _metric_from_ratio_row(row, "ocf_sales") is None


def test_ttm_statement_snapshot_requires_consecutive_certified_single_quarters():
    """#106: a four-row sum is only TTM when the rows are certified consecutive quarters."""
    from types import SimpleNamespace

    from vnibb.services.comparison_service import _build_statement_snapshot

    def quarter(year: int, quarter_number: int, revenue: float, *, flow_basis="single_quarter", unit="VND"):
        return SimpleNamespace(
            fiscal_year=year,
            fiscal_quarter=quarter_number,
            revenue=revenue,
            gross_profit=None,
            operating_income=None,
            net_income=None,
            interest_expense=None,
            operating_cash_flow=None,
            free_cash_flow=None,
            debt_repayment=None,
            raw_data={"_financial_lineage": {"value_unit": unit, "flow_basis": flow_basis}},
        )

    # `_load_statement_rows` orders `desc(fiscal_year), desc(fiscal_quarter)`, so the
    # window arrives newest-first; the TTM guard reads it in that order.
    consecutive = [
        quarter(2024, 4, 40.0),
        quarter(2024, 3, 30.0),
        quarter(2024, 2, 20.0),
        quarter(2024, 1, 10.0),
    ]
    assert _build_statement_snapshot(consecutive, "income", ttm=True)["revenue"] == pytest.approx(100.0)

    # A cumulative YTD series is not a four-quarter flow; summing it double counts.
    # Same window, so only the basis guard can reject it.
    cumulative = [quarter(2024, 4, 400.0, flow_basis="cumulative_ytd"), *consecutive[1:]]
    assert _build_statement_snapshot(cumulative, "income", ttm=True) is None

    # A legacy row with no certified unit lineage is withheld, not summed.
    unknown_unit = [quarter(2024, 4, 40.0, unit="unknown"), *consecutive[1:]]
    assert _build_statement_snapshot(unknown_unit, "income", ttm=True) is None

    # A gap means the window is not four consecutive quarters.
    gapped = [consecutive[0], consecutive[1], quarter(2023, 2, 20.0), quarter(2023, 1, 10.0)]
    assert _build_statement_snapshot(gapped, "income", ttm=True) is None

    # The balance sheet is a latest-quarter snapshot in every mode, never a sum.
    balance = SimpleNamespace(
        fiscal_year=2024,
        fiscal_quarter=4,
        total_assets=1.0,
        total_liabilities=2.0,
        total_equity=3.0,
    )
    assert _build_statement_snapshot([balance], "balance", ttm=True)["total_assets"] == pytest.approx(1.0)


@pytest.mark.asyncio
@pytest.mark.parametrize("interest_metadata", [
    None,
    {"value_unit": "VND"},
    {"value_unit": "VND", "unavailable_reason": "ambiguous_interest_expense_semantics"},
])
async def test_comparison_backfill_withholds_unproven_interest_without_losing_other_facts(
    monkeypatch, interest_metadata
):
    from vnibb.services.comparison_service import _build_comparison_backfill

    canonical = {"interest_expense": 30.0, "value_unit": "VND"}
    if interest_metadata is not None:
        canonical["unit_metadata"] = {"interest_expense": interest_metadata}
    income = IncomeStatement(
        symbol="VNM", period="2024", period_type="year", fiscal_year=2024,
        revenue=1200.0, gross_profit=600.0, operating_income=240.0, net_income=180.0,
        interest_expense=30.0,
        raw_data={} if interest_metadata is None else {"_financial_lineage": {
            "value_unit": "VND", "canonical_data": canonical,
        }},
    )
    balance = BalanceSheet(
        symbol="VNM", period="2024", period_type="year", fiscal_year=2024,
        total_assets=2000.0, total_liabilities=800.0, total_equity=1200.0,
    )
    cash = CashFlow(
        symbol="VNM", period="2024", period_type="year", fiscal_year=2024,
        operating_cash_flow=210.0, free_cash_flow=130.0, debt_repayment=-40.0,
    )

    async def load_rows(_symbol, model, *_args, **_kwargs):
        return {IncomeStatement: [income], BalanceSheet: [balance], CashFlow: [cash]}[model]

    monkeypatch.setattr("vnibb.services.comparison_service._load_statement_rows", load_rows)

    metrics = await _build_comparison_backfill("VNM", "FY", 2500.0)

    assert metrics["interest_coverage"] is None
    assert metrics["debt_service_coverage"] is None
    assert metrics["gross_margin"] == pytest.approx(50.0)
    assert metrics["net_margin"] == pytest.approx(15.0)
    assert metrics["debt_to_equity"] == pytest.approx(800.0 / 1200.0)
    assert metrics["ocf_sales"] == pytest.approx(17.5)
    assert metrics["fcf_yield"] == pytest.approx(5.2)


@pytest.mark.parametrize("rejected_quarter", [None, 2])
def test_ttm_interest_requires_semantic_evidence_in_every_quarter(rejected_quarter):
    from vnibb.services.comparison_service import _build_statement_snapshot

    rows = []
    for quarter in (4, 3, 2, 1):
        metadata = {"label": "interest_expense", "source_unit": "VND", "value_unit": "VND"}
        if quarter == rejected_quarter:
            metadata["unavailable_reason"] = "ambiguous_interest_expense_semantics"
        rows.append(IncomeStatement(
            symbol="VNM", period=f"2024-Q{quarter}", period_type="quarter",
            fiscal_year=2024, fiscal_quarter=quarter, revenue=100.0, interest_expense=10.0,
            raw_data={"_financial_lineage": {
                "value_unit": "VND", "flow_basis": "single_quarter", "canonical_data": {
                    "interest_expense": 10.0, "unit_metadata": {"interest_expense": metadata},
                },
            }},
        ))

    snapshot = _build_statement_snapshot(rows, "income", ttm=True)

    assert snapshot["revenue"] == pytest.approx(400.0)
    if rejected_quarter is None:
        assert snapshot["interest_expense"] == pytest.approx(40.0)
    else:
        assert snapshot["interest_expense"] is None


def test_annual_interest_snapshot_accepts_explicit_true_interest_evidence():
    from vnibb.services.comparison_service import _build_statement_snapshot

    row = IncomeStatement(
        symbol="VNM", period="2024", period_type="year", fiscal_year=2024,
        interest_expense=30.0, raw_data={"_financial_lineage": {"canonical_data": {
            "interest_expense": 30.0, "unit_metadata": {"interest_expense": {
                "label": "interest_expense", "source_unit": "VND", "value_unit": "VND",
            }},
        }}},
    )

    assert _build_statement_snapshot([row], "income", ttm=False)["interest_expense"] == 30.0


@pytest.mark.asyncio
async def test_comparison_does_not_restore_unproven_coverage_from_cached_ratios(
    test_engine, test_db, monkeypatch
):
    test_db.add(Stock(symbol="VNM", exchange="HOSE"))
    test_db.add(FinancialRatio(
        id=900, symbol="VNM", period="2024", period_type="year", fiscal_year=2024,
        pe_ratio=12.0, interest_coverage=8.0, raw_data={"debt_service_coverage": 6.0},
    ))
    await test_db.commit()

    async def get_stock_metrics(*_args, **_kwargs):
        return StockMetrics(symbol="VNM", metrics={
            "interest_coverage": 9.0, "debt_service_coverage": 7.0, "pe": 12.0,
        })

    async def load_rows(_symbol, model, *_args, **_kwargs):
        if model is IncomeStatement:
            return [IncomeStatement(
                symbol="VNM", period="2024", period_type="year", fiscal_year=2024,
                revenue=1200.0, net_income=180.0, operating_income=240.0, interest_expense=30.0,
            )]
        if model is CashFlow:
            return [CashFlow(
                symbol="VNM", period="2024", period_type="year", fiscal_year=2024,
                debt_repayment=-40.0,
            )]
        return []

    monkeypatch.setattr(
        "vnibb.services.comparison_service.comparison_service.get_stock_metrics", get_stock_metrics,
    )
    monkeypatch.setattr("vnibb.services.comparison_service._load_statement_rows", load_rows)
    monkeypatch.setattr(
        "vnibb.services.comparison_service.async_session_maker",
        async_sessionmaker(test_engine, expire_on_commit=False),
    )

    metrics = (await get_comparison_data(["VNM"], period="FY"))[0].metrics

    assert metrics["interest_coverage"] is None
    assert metrics["debt_service_coverage"] is None
    assert metrics["net_margin"] == pytest.approx(15.0)
    assert metrics["pe_ratio"] == pytest.approx(12.0)


@pytest.mark.asyncio
@pytest.mark.parametrize("interest_expense", [0.0, 30.0])
async def test_comparison_debt_service_uses_certified_interest_including_zero(
    monkeypatch, interest_expense
):
    from vnibb.services.comparison_service import _build_comparison_backfill

    income = IncomeStatement(
        symbol="VNM", period="2024", period_type="year", fiscal_year=2024,
        operating_income=240.0, interest_expense=interest_expense,
        raw_data={"_financial_lineage": {"canonical_data": {
            "interest_expense": interest_expense, "unit_metadata": {"interest_expense": {
                "label": "interest_expense", "source_unit": "VND", "value_unit": "VND",
            }},
        }}},
    )
    cash = CashFlow(
        symbol="VNM", period="2024", period_type="year", fiscal_year=2024,
        debt_repayment=-40.0,
    )

    async def load_rows(_symbol, model, *_args, **_kwargs):
        return {IncomeStatement: [income], BalanceSheet: [], CashFlow: [cash]}[model]

    monkeypatch.setattr("vnibb.services.comparison_service._load_statement_rows", load_rows)

    metrics = await _build_comparison_backfill("VNM", "FY", None)

    assert metrics["debt_service_coverage"] == pytest.approx(240.0 / (interest_expense + 40.0))
    if interest_expense == 0:
        assert metrics["interest_coverage"] is None
    else:
        assert metrics["interest_coverage"] == pytest.approx(8.0)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("provider_yield", "provider_sales", "expected_yield", "expected_sales"),
    [
        # Whole percent declared by the provider is already canonical.
        (2.0, 2.0, 2.0, 2.0),
        # No declaration means no unit evidence: both are withheld.
        (None, None, None, None),
    ],
)
async def test_comparison_withholds_provider_fraction_metrics_without_a_unit(
    test_engine, test_db, monkeypatch, provider_yield, provider_sales,
    expected_yield, expected_sales,
):
    """#106: a provider-supplied `fcf_yield`/`ocf_sales` needs a declared unit.

    The provider model carries these values but no unit, so publishing them
    as-is would guess a magnitude at the endpoint. Only a record that declares
    the unit may be published.
    """
    from vnibb.providers.vnstock.financial_ratios import FinancialRatioData

    async def fake_get_stock_metrics(*_args, **_kwargs):
        return StockMetrics(symbol="VCI", metrics={"pe": 10})

    async def fake_fetch_ratios(*_args, **_kwargs):
        payload = {"symbol": "VCI", "period": "2024", "pe_ratio": 10.0}
        if provider_yield is not None:
            payload["fcf_yield"] = provider_yield
            payload["ocf_sales"] = provider_sales
            payload["ratio_units"] = {"fcf_yield": "percent", "ocf_sales": "percent"}
        return [FinancialRatioData(**payload)]

    monkeypatch.setattr(
        "vnibb.services.comparison_service.comparison_service.get_stock_metrics",
        fake_get_stock_metrics,
    )
    monkeypatch.setattr(
        "vnibb.providers.vnstock.financial_ratios.VnstockFinancialRatiosFetcher.fetch",
        fake_fetch_ratios,
    )
    # SQLite's aiosqlite driver cannot serve the concurrent statement loads;
    # this case is about metric admission, not statement reading.
    async def load_rows(*_args, **_kwargs):
        return []

    monkeypatch.setattr("vnibb.services.comparison_service._load_statement_rows", load_rows)
    monkeypatch.setattr(
        "vnibb.services.comparison_service.async_session_maker",
        async_sessionmaker(test_engine, expire_on_commit=False),
    )

    metrics = (await get_comparison_data(["VCI"]))[0].metrics

    assert metrics["fcf_yield"] == expected_yield
    assert metrics["ocf_sales"] == expected_sales


@pytest.mark.asyncio
async def test_comparison_publishes_db_fraction_metrics_after_unit_admission(
    test_engine, test_db, monkeypatch,
):
    """#106: a stored row's fraction declaration survives to the endpoint.

    `_metric_from_ratio_row` converts a declared fraction once; the endpoint must
    not re-admit those already-canonical values and drop them for lacking units.
    """
    test_db.add(FinancialRatio(
        id=900, symbol="VCI", period="2024", period_type="year", fiscal_year=2024,
        pe_ratio=10.0,
        raw_data={
            "ocf_sales": 0.25, "fcf_yield": 0.052,
            "ratio_units": {"ocf_sales": "fraction", "fcf_yield": "fraction"},
        },
    ))
    await test_db.commit()

    async def fake_get_stock_metrics(*_args, **_kwargs):
        return StockMetrics(symbol="VCI", metrics={})

    async def fake_fetch_ratios(*_args, **_kwargs):
        return []

    async def load_rows(*_args, **_kwargs):
        return []

    monkeypatch.setattr(
        "vnibb.services.comparison_service.comparison_service.get_stock_metrics",
        fake_get_stock_metrics,
    )
    monkeypatch.setattr(
        "vnibb.providers.vnstock.financial_ratios.VnstockFinancialRatiosFetcher.fetch",
        fake_fetch_ratios,
    )
    monkeypatch.setattr("vnibb.services.comparison_service._load_statement_rows", load_rows)
    monkeypatch.setattr(
        "vnibb.services.comparison_service.async_session_maker",
        async_sessionmaker(test_engine, expire_on_commit=False),
    )

    metrics = (await get_comparison_data(["VCI"]))[0].metrics

    assert metrics["ocf_sales"] == pytest.approx(25.0)
    assert metrics["fcf_yield"] == pytest.approx(5.2)
