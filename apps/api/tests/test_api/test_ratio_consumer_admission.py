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
@pytest.mark.parametrize("units,expected", [({}, None), ({"roe": "percent", "debt_assets": "percent"}, 0.25)])
async def test_comparison_never_uses_source_name_as_percentage_unit_evidence(
    test_engine, test_db, monkeypatch, units, expected,
):
    ratio = ratio_row("FPT", units, 0.25)
    ratio.source = "vietcap"
    test_db.add(ratio)
    await test_db.commit()
    service = comparison_service.ComparisonService()

    async def cached_snapshot(*args, **kwargs):
        return CacheResult(data=[ScreenerSnapshot(symbol="FPT", snapshot_date=date.today())],
                           is_stale=False, cached_at=datetime.utcnow(), hit=True)

    monkeypatch.setattr(service.cache_manager, "get_screener_data", cached_snapshot)
    monkeypatch.setattr(comparison_service, "async_session_maker", async_sessionmaker(test_engine, expire_on_commit=False))
    response = await service.get_stock_metrics("FPT")

    assert response.metrics.get("roe") == expected
    assert response.metrics.get("debt_assets") == expected
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
    ratios = await equity.get_ratio_history.__wrapped__(symbol="VNM", ratios="roe,pe", period="year", limit=20, db=test_db)
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
    rows = {row["symbol"]: row for row in response["data"]}
    for symbol, expected in zip(["VCI", "SSI", "HCM", "FTS"], [0.0, -5.0, None, None], strict=True):
        assert rows[symbol]["roe"] == expected
        assert rows[symbol]["revenue_growth"] == expected
    assert response["count"] == 4


@pytest.mark.asyncio
async def test_industry_bubble_uses_real_ratio_sql_evidence(test_engine, test_db, monkeypatch):
    symbols = ["VCI", "SSI", "HCM", "FTS"]
    for index, (symbol, (units, value, _expected)) in enumerate(zip(symbols, CASES, strict=True)):
        test_db.add(ratio_row(symbol, units, value, row_id=index + 1))
    await test_db.commit()

    async def cached_rows(*args, **kwargs):
        return SimpleNamespace(data=[
            {"symbol": symbol, "industry": "Chung khoan", "sector": "securities", "market_cap": 100.0 - index,
             "market_cap_source": "issuer:cap", "market_cap_unit": "VND", "market_cap_currency": "VND",
             "market_cap_as_of": "2026-10-23", "outstanding_shares": 100, "shares_unit": "shares",
             "shares_as_of": "2026-10-23", "shares_source": "issuer:shares", "share_basis": "outstanding"}
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


@pytest.mark.asyncio
@pytest.mark.parametrize("unit,expected", [("percent", 0.25), ("unknown", None)])
async def test_cached_screener_yield_keeps_canonical_percent_without_rescaling(test_db, unit, expected):
    from vnibb.api.v1.screener import _enrich_screener_metrics, _to_screener_data_row

    row = _to_screener_data_row(ScreenerSnapshot(
        symbol="FPT", snapshot_date=date.today(), dividend_yield=0.25,
        extended_metrics={"ratio_units": {"dividend_yield": unit}},
    ))
    enriched = await _enrich_screener_metrics([row], test_db)

    assert enriched[0].dividend_yield == expected


@pytest.mark.asyncio
async def test_ratio_enrichment_does_not_restore_unproven_interest_coverage(test_db, monkeypatch):
    from vnibb.providers.vnstock.financials import FinancialStatementData

    income = FinancialStatementData(symbol="FPT", period="2025", statement_type="income",
        revenue=1000, operating_income=240, interest_expense=900, value_unit="VND",
        unit_metadata={"interest_expense": {"label": "financial_expenses", "source_unit": "VND", "value_unit": "VND"}})
    cash = FinancialStatementData(symbol="FPT", period="2025", statement_type="cashflow", debt_repayment=40)
    ratio = FinancialRatioData(symbol="FPT", period="2025", pe=10, interest_coverage=8, debt_service_coverage=6)
    rows = await equity._enrich_missing_ratio_metrics(
        symbol="FPT", period="year", rows=[ratio], db=test_db,
        income_support_rows=[income], balance_support_rows=[], cashflow_support_rows=[cash])
    assert rows[0].interest_coverage is None
    assert rows[0].debt_service_coverage is None
    assert rows[0].pe == 10


@pytest.mark.asyncio
@pytest.mark.parametrize("source", ["mongo", "provider", "sql"])
@pytest.mark.parametrize("unit,value,expected", [(None, 6.3257, None), ("unknown", 0.0287, None), ("percent", 0.0, 0.0), ("percent", 9.951, 9.951)])
async def test_payout_endpoint_admits_canonical_percent_on_every_source(test_db, monkeypatch, source, unit, value, expected):
    from unittest.mock import AsyncMock

    units = {"payout_ratio": unit} if unit else {}
    row = FinancialRatioData(symbol="FPT", period="2025", pe=10, payout_ratio=value,
        ratio_units=units, provider_evidence=[{"source": "vietcap"}] if source == "mongo" else [])
    if source == "sql":
        test_db.add(FinancialRatio(id=8700, symbol="FPT", period="2025", period_type="year", fiscal_year=2025,
            pe_ratio=10, raw_data={"payout_ratio": value, "ratio_units": units}))
        await test_db.flush()
    monkeypatch.setattr(equity, "_load_mongo_financial_ratio_rows", AsyncMock(return_value=[row] if source == "mongo" else []))
    monkeypatch.setattr(equity.VnstockFinancialRatiosFetcher, "fetch", AsyncMock(return_value=[row] if source == "provider" else []))
    monkeypatch.setattr(equity, "_get_latest_statement_period_key", AsyncMock(return_value=0))
    async def unchanged(**kwargs):
        return kwargs["rows"]
    monkeypatch.setattr(equity, "_enrich_missing_ratio_metrics", unchanged)
    response = await equity.get_financial_ratios.__wrapped__("FPT", "year", db=test_db)
    assert response.data[0].payout_ratio == expected


@pytest.mark.asyncio
@pytest.mark.parametrize("cash_period,cash_scope,expected", [("2025", "consolidated", 25.0), ("2024", "consolidated", None), ("2025", "separate", None)])
async def test_derived_payout_requires_compatible_admitted_statements(test_db, monkeypatch, cash_period, cash_scope, expected):
    from unittest.mock import AsyncMock

    from vnibb.providers.vnstock.financials import FinancialStatementData

    def statement(kind, period, scope, metric, amount):
        return FinancialStatementData(symbol="FPT", period=period, statement_type=kind,
            source="VCI", currency="VND", value_unit="VND", consolidation_basis=scope, flow_basis="annual",
            **{metric: amount}, unit_metadata={metric: {"source_unit": "VND", "value_unit": "VND"}})
    income = statement("income", "2025", "consolidated", "net_income", 100)
    cash = statement("cashflow", cash_period, cash_scope, "dividends_paid", -25)
    monkeypatch.setattr(equity, "_load_financial_statement_fallback", AsyncMock(return_value=[]))
    monkeypatch.setattr(equity, "_is_bank_like_symbol", AsyncMock(return_value=False))
    rows = await equity._enrich_missing_ratio_metrics("FPT", "year", [FinancialRatioData(symbol="FPT", period="2025", pe=10)], test_db,
        income_support_rows=[income], balance_support_rows=[], cashflow_support_rows=[cash])
    result = next(row for row in rows if row.period == "2025")
    assert result.payout_ratio == expected
    assert (result.ratio_units.get("payout_ratio") == "percent") == (expected is not None)
