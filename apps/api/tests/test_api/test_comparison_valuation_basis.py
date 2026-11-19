"""Field lineage follows the winning reported multiple, not the comparison selector."""
from datetime import datetime
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from vnibb.models.trading import FinancialRatio
from vnibb.services import comparison_service as comparison
from vnibb.services.cache_manager import CacheResult


@pytest.mark.asyncio
@pytest.mark.parametrize(("quarter_year", "request_period", "ps_period"), [
    (2025, "FY", "2024"), (2025, "1Y", "Q2-2025"), (2023, "1Y", "2024"),
])
async def test_reported_multiple_keeps_its_winning_row(
    test_db, test_engine, monkeypatch, quarter_year, request_period, ps_period,
):
    different = quarter_year == 2025
    quarter = f"Q2-{quarter_year}"
    test_db.add_all([
        FinancialRatio(id=101, symbol="HPG", period=quarter, fiscal_year=quarter_year,
                       period_type="quarter", fiscal_quarter=2, source="quarter-feed",
                       ev_ebitda=18.76, raw_data={"ps": 3.82, "ps_denominator_basis": "quarter sales",
                                                 "ps_valuation_as_of": "2025-08-30"}),
        FinancialRatio(id=102, symbol="HPG", period="2024", fiscal_year=2024,
                       period_type="year", source="annual-feed", ev_ebitda=14.68,
                       ps_ratio=None if different else 2.45, raw_data={"ps": 1.36}),
    ])
    await test_db.commit()
    screener = {"symbol": "HPG", "market_cap_as_of": "2025-09-01"}

    async def cached(**_kwargs):
        return CacheResult(data=[screener], is_stale=False, cached_at=datetime(2025, 9, 1), hit=True)

    monkeypatch.setattr(comparison.comparison_service.cache_manager, "get_screener_data", cached)
    monkeypatch.setattr(comparison, "_build_comparison_backfill", AsyncMock(return_value={}))
    monkeypatch.setattr(comparison, "async_session_maker", async_sessionmaker(test_engine))
    stock, = await comparison.get_comparison_data(["HPG"], request_period)
    assert stock.metrics["ev_ebitda"] == (18.76 if different else 14.68)
    assert stock.metrics["ps_ratio"] == (2.45 if not different else 1.36 if request_period == "FY" else 3.82)
    basis = stock.model_dump()["valuation_basis"]
    assert basis["ev_ebitda"]["fiscal_period"] == (quarter if different else "2024")
    assert basis["ev_ebitda"]["source"] == ("quarter-feed" if different else "annual-feed")
    assert basis["ps_ratio"]["fiscal_period"] == ps_period
    assert basis["ps_ratio"]["source"] == ("quarter-feed" if ps_period == quarter else "annual-feed")
    assert basis["ev_ebitda"]["valuation_as_of"] is None
    assert basis["ps_ratio"]["denominator_basis"] == ("quarter sales" if ps_period == quarter else None)
    assert basis["ps_ratio"]["valuation_as_of"] == ("2025-08-30" if ps_period == quarter else None)

    # An equal screener value still wins. Neither the losing row's source nor
    # its period belongs to this field; a quote date is not its valuation date.
    screener["ev_ebitda"] = stock.metrics["ev_ebitda"]
    override, = await comparison.get_comparison_data(["HPG"], request_period)
    selected = override.model_dump()["valuation_basis"]
    assert selected["ps_ratio"] == basis["ps_ratio"]
    assert selected["ev_ebitda"] == {
        "origin": "screener", "source": None, "fiscal_period": None,
        "valuation_as_of": None, "denominator_basis": None,
    }


@pytest.mark.asyncio
async def test_provider_values_keep_their_own_model_period(test_engine, monkeypatch):
    from vnibb.providers.vnstock.financial_ratios import FinancialRatioData

    monkeypatch.setattr(comparison.comparison_service.cache_manager, "get_screener_data", AsyncMock(
        return_value=CacheResult(data=None, hit=False, is_stale=False, cached_at=None),
    ))
    monkeypatch.setattr("vnibb.providers.vnstock.equity_screener.VnstockScreenerFetcher.fetch",
                        AsyncMock(return_value=[]))
    monkeypatch.setattr("vnibb.providers.vnstock.financial_ratios.VnstockFinancialRatiosFetcher.fetch",
                        AsyncMock(side_effect=[
                            [FinancialRatioData(symbol="HPG", period="2023", ps=2.45)],
                            [FinancialRatioData(symbol="HPG", period="2025-Q2", ps=2.45, ev_ebitda=14.68)],
                        ]))
    monkeypatch.setattr(comparison, "_build_comparison_backfill", AsyncMock(return_value={}))
    monkeypatch.setattr(comparison, "async_session_maker", async_sessionmaker(test_engine))
    stock, = await comparison.get_comparison_data(["HPG"], "Q2")
    assert stock.metrics["ps_ratio"] == 2.45 and stock.metrics["ev_ebitda"] == 14.68
    assert stock.valuation_basis["ps_ratio"].fiscal_period == "2023"
    assert stock.valuation_basis["ev_ebitda"].fiscal_period == "2025-Q2"
    for field in stock.valuation_basis.values():
        assert field.origin == "provider_ratio"
        assert field.source is None and field.valuation_as_of is None and field.denominator_basis is None
