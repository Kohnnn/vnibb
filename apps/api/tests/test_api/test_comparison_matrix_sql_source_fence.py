from datetime import date, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from sqlalchemy import MetaData, null
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from vnibb.models.company import Company
from vnibb.models.financials import BalanceSheet, CashFlow, IncomeStatement
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models.stock import Stock, StockPrice
from vnibb.models.trading import FinancialRatio
from vnibb.services import comparison_service, matrix_observations
from vnibb.services.cache_manager import CacheResult


@pytest_asyncio.fixture
async def legacy_db(monkeypatch):
    metadata = MetaData()
    financial_models = (IncomeStatement, BalanceSheet, CashFlow, FinancialRatio)
    for model in (Company, Stock, StockPrice, ScreenerSnapshot, *financial_models):
        table = model.__table__.to_metadata(metadata)
        if model in financial_models:
            table.c.source.nullable = True
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(comparison_service, "async_session_maker", sessions)
    monkeypatch.setattr(matrix_observations, "get_mongo_market_data_service", lambda: SimpleNamespace(enabled=False))
    async with sessions() as session:
        yield session
    await engine.dispose()


def ratio(symbol, year, source, pe):
    return FinancialRatio(
        id=year * 10 + {"FPT": 1, "CMG": 2, "ABC": 3}[symbol],
        symbol=symbol, period=str(year), period_type="year", fiscal_year=year,
        source=null() if source is None else source, pe_ratio=pe, pb_ratio=pe,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("source", ["vietcap", None])
@pytest.mark.parametrize("consumer", ["stock", "peers", "sector"])
async def test_comparison_stock_peer_and_sector_ignore_newer_issuer_ratios(legacy_db, monkeypatch, source, consumer):
    legacy_db.add_all([
        ratio("FPT", 2024, source, 10), ratio("FPT", 2025, "issuer_report", 99),
        ratio("CMG", 2024, source, 20), ratio("CMG", 2025, "issuer_report", 99),
        ratio("ABC", 2025, "issuer_report", 99),
    ])
    await legacy_db.commit()
    service = comparison_service.ComparisonService()
    snapshot = ScreenerSnapshot(symbol="FPT", snapshot_date=date.today())
    monkeypatch.setattr(service.cache_manager, "get_screener_data", AsyncMock(return_value=CacheResult(
        data=[snapshot], is_stale=False, cached_at=datetime.utcnow(), hit=True,
    )))
    monkeypatch.setattr(service, "_get_all_screener_data", AsyncMock(return_value=[
        {"symbol": symbol, "industry": "Software", "sector": "Software", "exchange": "HOSE"}
        for symbol in ("FPT", "CMG", "ABC")
    ]))

    if consumer == "stock":
        metrics = await service.get_stock_metrics("FPT")
        assert metrics.metrics["pe"] == 10
    elif consumer == "peers":
        peers = {peer.symbol: peer for peer in (await service.get_peers("FPT")).peers}
        assert peers["CMG"].pe_ratio == 20
        assert peers["ABC"].pe_ratio is None
    else:
        averages = await service.get_sector_averages("Software")
        assert averages["pe"] == 15


@pytest.mark.asyncio
@pytest.mark.parametrize("source", ["vietcap", None])
async def test_comparison_backfill_excludes_issuer_ratios_and_statement_rows(legacy_db, monkeypatch, source):
    legacy_db.add_all([
        ratio("FPT", 2024, source, 10), ratio("FPT", 2025, "issuer_report", 99),
        IncomeStatement(id=2024, symbol="FPT", period="2024", period_type="year", fiscal_year=2024,
                        source=null() if source is None else source, revenue=100, gross_profit=30),
        IncomeStatement(id=2025, symbol="FPT", period="2025", period_type="year", fiscal_year=2025,
                        source="issuer_report", revenue=100, gross_profit=99),
        BalanceSheet(id=2024, symbol="FPT", period="2024", period_type="year", fiscal_year=2024,
                     source=null() if source is None else source, total_assets=200),
        BalanceSheet(id=2025, symbol="FPT", period="2025", period_type="year", fiscal_year=2025,
                     source="issuer_report", total_assets=1),
        CashFlow(id=2024, symbol="FPT", period="2024", period_type="year", fiscal_year=2024,
                 source=null() if source is None else source, operating_cash_flow=20),
        CashFlow(id=2025, symbol="FPT", period="2025", period_type="year", fiscal_year=2025,
                 source="issuer_report", operating_cash_flow=99),
    ])
    await legacy_db.commit()
    monkeypatch.setattr(comparison_service.comparison_service, "get_stock_metrics", AsyncMock(
        return_value=comparison_service.StockMetrics(symbol="FPT", metrics={}),
    ))
    monkeypatch.setattr("vnibb.providers.vnstock.financial_ratios.VnstockFinancialRatiosFetcher.fetch", AsyncMock(return_value=[]))

    result = (await comparison_service.get_comparison_data(["FPT"]))[0]
    assert result.metrics["pe_ratio"] == 10
    assert result.metrics["gross_margin"] == 30
    assert result.metrics["asset_turnover"] == 0.5
    assert result.metrics["ocf_sales"] == 20


@pytest.mark.asyncio
async def test_issuer_only_ratio_keeps_provider_fallback(legacy_db, monkeypatch):
    legacy_db.add(ratio("FPT", 2025, "issuer_report", 99))
    await legacy_db.commit()
    monkeypatch.setattr(comparison_service.comparison_service, "get_stock_metrics", AsyncMock(
        return_value=comparison_service.StockMetrics(symbol="FPT", metrics={}),
    ))
    fetch = AsyncMock(return_value=[SimpleNamespace(model_dump=lambda: {"pe": 12})])
    monkeypatch.setattr("vnibb.providers.vnstock.financial_ratios.VnstockFinancialRatiosFetcher.fetch", fetch)
    result = (await comparison_service.get_comparison_data(["FPT"]))[0]
    assert result.metrics["pe_ratio"] == 12
    fetch.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize("source", ["vietcap", None])
@pytest.mark.parametrize("consumer", ["periods", "observations"])
async def test_matrix_periods_and_observations_withhold_issuer_rows(legacy_db, source, consumer):
    legacy_db.add_all([
        Stock(id=1, symbol="MXA", industry="Software", is_active=1),
        Stock(id=2, symbol="MXB", industry="Software", is_active=1),
    ])
    for index, symbol in enumerate(("MXA", "MXB"), start=1):
        for year, row_source, revenue in ((2023, source, 100), (2024, "issuer_report", 999)):
            legacy_db.add(IncomeStatement(
                id=year * 10 + index, symbol=symbol, period=str(year), period_type="year", fiscal_year=year,
                source=null() if row_source is None else row_source, revenue=revenue,
                raw_data={"unit": "VND", "consolidation": "consolidated"},
            ))
        legacy_db.add(IncomeStatement(
            id=20300 + index, symbol=symbol, period="2024-Q2", period_type="quarter", fiscal_year=2024,
            fiscal_quarter=2, source="issuer_report", revenue=999,
        ))
        for model, field in ((BalanceSheet, "total_equity"), (CashFlow, "operating_cash_flow"), (FinancialRatio, "pe_ratio")):
            for year, row_source, value in ((2023, source, 10), (2024, "issuer_report", 999)):
                legacy_db.add(model(
                    id=year * 10 + index, symbol=symbol, period=str(year), period_type="year", fiscal_year=year,
                    source=null() if row_source is None else row_source, **{field: value},
                ))
    await legacy_db.flush()
    if consumer == "periods":
        expected = {symbol: {"year": ["2023"], "quarter": []} for symbol in ("MXA", "MXB")}
        selected = await matrix_observations.selected_matrix_periods(legacy_db, "MXA", ["MXA", "MXB"])
        assert selected["periods_by_symbol"] == expected
        prepared = await matrix_observations.prepare_matrix(legacy_db, "MXA")
        assert prepared["periods"] == ["2023"]
    else:
        built = await matrix_observations.build_matrix_observations(legacy_db, ["MXA", "MXB"], "nonfinancial", "2024", "year")
        assert not any(item.get("source", "").endswith(":issuer_report") for item in built["evidence"])
        for dimension, key in (("growth", "revenue"), ("leverage", "total_equity"), ("cash", "operating_cash_flow"), ("valuation", "pe_ratio")):
            cell = next(item for item in built["cells"] if item["entity_id"] == "MXA" and item["dimension_id"] == dimension)
            assert next(item for item in cell["payload"]["metrics"] if item["key"] == key)["value"] is None
        valid = await matrix_observations.build_matrix_observations(legacy_db, ["MXA", "MXB"], "nonfinancial", "2023", "year")
        for dimension, key, expected in (("growth", "revenue", "100"), ("leverage", "total_equity", "10"), ("cash", "operating_cash_flow", "10"), ("valuation", "pe_ratio", "10")):
            cell = next(item for item in valid["cells"] if item["entity_id"] == "MXA" and item["dimension_id"] == dimension)
            assert next(item for item in cell["payload"]["metrics"] if item["key"] == key)["value"] == expected
