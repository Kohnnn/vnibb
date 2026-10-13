from datetime import date, datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker
from vnibb.api.v1 import equity, market, sectors
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models.stock import Stock
from vnibb.models.trading import FinancialRatio
from vnibb.providers.vnstock.financial_ratios import FinancialRatioData
from vnibb.services import ai_context_service, comparison_service
from vnibb.services.cache_manager import CacheResult

CASES = [
    ({"roe": "percent", "revenue_growth": "percent", "debt_assets": "percent"}, 0.0, 0.0),
    ({"roe": "percent", "revenue_growth": "percent", "debt_assets": "percent"}, -5.0, -5.0),
    ({"roe": "unknown", "revenue_growth": "unknown", "debt_assets": "unknown"}, 0.25, None),
    ({}, 0.25, None),
]


def ratio_row(symbol, units, value, *, row_id=1):
    return FinancialRatio(
        id=row_id, symbol=symbol, period="2024", period_type="year", fiscal_year=2024,
        source="vnstock", roe=value, revenue_growth=value, debt_to_assets=value,
        pe_ratio=10.0, raw_data={"ratio_units": units} if units else {},
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("units,value,expected", CASES)
@pytest.mark.parametrize("nested_snapshot", [True, False])
async def test_comparison_debt_assets_requires_its_own_evidence(
    test_engine, test_db, monkeypatch, units, value, expected, nested_snapshot,
):
    ratio = ratio_row("VCI", units, value)
    if nested_snapshot:
        ratio.debt_to_assets = None
    test_db.add(ratio)
    await test_db.commit()
    snapshot = ScreenerSnapshot(
        symbol="VCI", snapshot_date=date.today(),
        extended_metrics={"ratio_units": units, "debt_to_asset": value} if nested_snapshot else {},
    )
    service = comparison_service.ComparisonService()

    async def cached_snapshot(*args, **kwargs):
        return CacheResult(data=[snapshot], is_stale=False, cached_at=datetime.utcnow(), hit=True)

    monkeypatch.setattr(service.cache_manager, "get_screener_data", cached_snapshot)
    monkeypatch.setattr(comparison_service, "async_session_maker", async_sessionmaker(test_engine, expire_on_commit=False))
    response = await service.get_stock_metrics("VCI")
    assert response.metrics.get("debt_assets") == expected
    assert response.metrics.get("roe") == expected
    assert response.metrics["pe"] == 10.0


@pytest.mark.asyncio
@pytest.mark.parametrize("units,value,expected", CASES)
@pytest.mark.parametrize("roe_source", ["snapshot", "ratio", "cache"])
async def test_comparison_peer_roe_admits_snapshot_and_ratio_evidence(
    test_engine, test_db, monkeypatch, units, value, expected, roe_source,
):
    snapshot = ScreenerSnapshot(
        symbol="SSI", snapshot_date=date.today(), industry="Chung khoan", exchange="HOSE",
        roe=value if roe_source == "snapshot" else None,
        extended_metrics={"ratio_units": units} if roe_source == "snapshot" else {},
    )
    test_db.add(snapshot)
    if roe_source == "ratio":
        test_db.add(ratio_row("SSI", units, value))
    await test_db.commit()
    service = comparison_service.ComparisonService()

    async def universe(*args, **kwargs):
        return [
            {"symbol": "VCI", "industry": "Chung khoan", "exchange": "HOSE", "market_cap": 100.0},
            {"symbol": "SSI", "industry": "Chung khoan", "exchange": "HOSE", "market_cap": 90.0,
             **({"roe": value, "ratio_units": units} if roe_source == "cache" else {})},
        ]

    monkeypatch.setattr(service, "_get_all_screener_data", universe)
    monkeypatch.setattr(comparison_service, "async_session_maker", async_sessionmaker(test_engine, expire_on_commit=False))
    response = await service.get_peers("VCI")
    assert [peer.symbol for peer in response.peers] == ["SSI"]
    assert response.peers[0].roe == expected


@pytest.mark.asyncio
@pytest.mark.parametrize("age", [0, 60])
async def test_metrics_history_admits_current_and_older_snapshot_percentages(test_db, age):
    for index, (units, value, _expected) in enumerate(CASES):
        test_db.add(ScreenerSnapshot(
            symbol="VNM", snapshot_date=date.today() - timedelta(days=age + 3 - index),
            roe=value, roa=value, pe=10.0,
            extended_metrics={"ratio_units": {**units, "roa": units.get("roe", "unknown")}},
        ))
    await test_db.commit()
    response = await equity.get_metrics_history.__wrapped__(
        symbol="VNM", days=30, metrics="roe,roa,pe_ratio", period="year", db=test_db,
    )
    assert response.roe == [0.0, -5.0, None, None]
    assert response.roa == [0.0, -5.0, None, None]
    assert response.pe_ratio == [10.0] * 4
    assert len(response.periods) == 4


@pytest.mark.asyncio
async def test_provider_history_admits_each_percent_cell(test_db, monkeypatch):
    rows = [
        FinancialRatioData(symbol="VNM", period=str(2020 + index), roe=value, pe=10.0, ratio_units=units)
        for index, (units, value, _expected) in enumerate(CASES)
    ]

    async def provider_rows(*args, **kwargs):
        return list(reversed(rows))

    monkeypatch.setattr(equity.VnstockFinancialRatiosFetcher, "fetch", provider_rows)
    ratios = await equity.get_ratio_history.__wrapped__(symbol="VNM", ratios="roe,pe", period="year", limit=20)
    metrics = await equity.get_metrics_history.__wrapped__(
        symbol="VNM", days=30, metrics="roe,pe_ratio", period="year", db=test_db,
    )
    assert [row["roe"] for row in ratios.data] == [0.0, -5.0, None, None]
    assert [row["pe"] for row in ratios.data] == [10.0] * 4
    assert metrics.roe == [0.0, -5.0, None, None]
    assert metrics.pe_ratio == [10.0] * 4


@pytest.mark.asyncio
async def test_sector_stocks_withholds_unknown_cells_without_dropping_rows(test_db):
    for index, (symbol, (units, value, _expected)) in enumerate(zip(["VCI", "SSI", "HCM", "FTS"], CASES, strict=True)):
        test_db.add(Stock(id=index + 1, symbol=symbol, exchange="HOSE", industry="Chung khoan", sector="securities"))
        test_db.add(ScreenerSnapshot(
            symbol=symbol, snapshot_date=date.today(), roe=value, revenue_growth=value,
            market_cap=100.0 - index, pe=10.0, extended_metrics={"ratio_units": units},
        ))
    await test_db.commit()
    response = await sectors.get_sector_stocks.__wrapped__(sector="securities", limit=50, db=test_db)
    assert [row["roe"] for row in response["data"]] == [0.0, -5.0, None, None]
    assert [row["revenue_growth"] for row in response["data"]] == [0.0, -5.0, None, None]
    assert response["count"] == 4


@pytest.mark.asyncio
async def test_industry_bubble_uses_real_ratio_sql_evidence(test_engine, test_db, monkeypatch):
    symbols = ["VCI", "SSI", "HCM", "FTS"]
    for index, (symbol, (units, value, _expected)) in enumerate(zip(symbols, CASES, strict=True)):
        test_db.add(ratio_row(symbol, units, value, row_id=index + 1))
    await test_db.commit()

    async def cached_rows(*args, **kwargs):
        return SimpleNamespace(data=[
            {"symbol": symbol, "industry": "Chung khoan", "sector": "securities", "market_cap": 100.0 - index}
            for index, symbol in enumerate(symbols)
        ])

    async def empty_map(*args, **kwargs):
        return {}

    async def empty_rows(*args, **kwargs):
        return []

    monkeypatch.setattr(market.CacheManager, "get_screener_data", cached_rows)
    monkeypatch.setattr(market, "async_session_maker", async_sessionmaker(test_engine, expire_on_commit=False))
    monkeypatch.setattr(market, "_load_stock_metadata", empty_map)
    monkeypatch.setattr(market, "_load_change_pct_map", empty_map)
    monkeypatch.setattr(market, "_load_latest_income_revenue", empty_map)
    monkeypatch.setattr(market, "_load_latest_screener_rows_from_db", empty_rows)
    response = await market.get_industry_bubble.__wrapped__(
        symbol="VCI", x_metric="roe", y_metric="revenue_growth", size_metric="market_cap", top_n=5,
    )
    assert [(point.symbol, point.x, point.y) for point in response.data] == [("VCI", 0.0, 0.0), ("SSI", -5.0, -5.0)]
    assert response.sector_average.x == -2.5
    assert response.sector_average.y == -2.5
    assert response.sector_point_count == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("units,value,expected", CASES)
async def test_ai_postgres_context_withholds_uncertified_ratio_cells(test_engine, test_db, monkeypatch, units, value, expected):
    row = ratio_row("VNM", units, value)
    metrics = ("roe", "roa", "gross_margin", "operating_margin", "net_margin", "revenue_growth", "earnings_growth")
    for metric in metrics:
        setattr(row, metric, value)
    row.raw_data = {"ratio_units": dict.fromkeys(metrics, units["roe"])} if units else {}
    test_db.add(row)
    await test_db.commit()
    monkeypatch.setattr(ai_context_service, "async_session_maker", async_sessionmaker(test_engine, expire_on_commit=False))
    response = await ai_context_service.AIContextService()._build_postgres_snapshot("VNM")
    assert {metric: response["ratios"][metric] for metric in metrics} == dict.fromkeys(metrics, expected)
    assert response["ratios"]["pe"] == response["ratios"]["pe_ratio"] == 10.0
