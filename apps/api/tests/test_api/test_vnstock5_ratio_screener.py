from datetime import date

import pandas as pd
import pytest

from vnibb.core.config import settings
from vnibb.core.exceptions import ProviderError
from vnibb.providers.vnstock import runtime
from vnibb.providers.vnstock.equity_screener import StockScreenerParams, VnstockScreenerFetcher
from vnibb.providers.vnstock.financial_ratios import (
    FinancialRatiosQueryParams,
    VnstockFinancialRatiosFetcher,
)


class EntitlementError(Exception):
    code = "VNSTOCK_TIER_ROUTE"


def _fundamental(monkeypatch, frame=None, error=None):
    calls = []

    class Fundamental:
        def equity(self, symbol):
            calls.append(("equity", symbol))
            return self

        def ratio(self, *, source, period, lang, format):
            calls.append(("ratio", source, period, lang, format))
            if error:
                raise error
            return frame

    def load(name):
        assert name == "Fundamental"
        return Fundamental, "vnstock"

    monkeypatch.setattr(runtime, "import_vnstock_symbol", load)
    return calls


@pytest.mark.asyncio
async def test_ratio_fetch_uses_vci_long_table_and_preserves_units(monkeypatch):
    frame = pd.DataFrame([
        {"id": "p_e", "period": "2024", "value": 10.0},
        {"id": "p_e", "period": "2025", "value": 12.0},
        {"id": "roe", "period": "2024", "unit": "fraction", "value": 0.1},
        {"id": "roe", "period": "2025", "unit": "fraction", "value": 0.25},
        {"id": "roa", "period": "2024", "value": 0.1},
        {"id": "roa", "period": "2025", "value": 0.2},
    ])
    calls = _fundamental(monkeypatch, frame)
    async def execute(operation, *args, **kwargs):
        return operation()
    monkeypatch.setattr(runtime, "run_financial_provider", execute)
    monkeypatch.setattr(settings, "vnstock_source", "VCI")

    rows = await VnstockFinancialRatiosFetcher.fetch(FinancialRatiosQueryParams(symbol="VNM", period="year"))

    assert calls == [("equity", "VNM"), ("ratio", "VCI", "year", "en", "long")]
    assert [(row.period, row.pe, row.roe, row.roa) for row in rows] == [
        ("2025", 12.0, 25.0, None), ("2024", 10.0, 10.0, None),
    ]
    assert rows[0].ratio_units["roa"] == "unknown"


@pytest.mark.asyncio
async def test_ratio_entitlement_is_not_empty_success(monkeypatch):
    _fundamental(monkeypatch, error=EntitlementError("VNSTOCK_TIER_ROUTE"))
    async def execute(operation, *args, **kwargs):
        return operation()
    monkeypatch.setattr(runtime, "run_financial_provider", execute)
    with pytest.raises(ProviderError, match="VNSTOCK_TIER_ROUTE"):
        await VnstockFinancialRatiosFetcher.fetch(FinancialRatiosQueryParams(symbol="VNM"))


@pytest.mark.asyncio
async def test_screener_vci_listing_long_ratio_and_quote(monkeypatch):
    calls = _fundamental(monkeypatch, pd.DataFrame([
        {"id": "p_e", "period": "2024", "value": 10.0},
        {"id": "p_e", "period": "2025", "value": 12.0},
        {"id": "roe", "period": "2025", "unit": "fraction", "value": 0.25},
    ]))
    class Listing:
        def __init__(self, *, source):
            assert source == "VCI"
        def symbols_by_exchange(self):
            return pd.DataFrame([{"symbol": "VNM", "organ_name": "Vinamilk", "exchange": "HSX", "type": "STOCK"}])
    class Quote:
        def __init__(self, *, symbol, source):
            assert (symbol, source) == ("VNM", "VCI")
        def history(self, *, start, end):
            return pd.DataFrame([{"time": date.today().isoformat(), "close": 100, "volume": 5, "price_unit": "VND"}])
    monkeypatch.setattr(runtime, "get_listing_class", lambda: Listing)
    monkeypatch.setattr(runtime, "get_quote_class", lambda: Quote)

    rows = await VnstockScreenerFetcher.fetch(StockScreenerParams(symbol="VNM"))
    assert calls == [("equity", "VNM"), ("ratio", "VCI", "year", "en", "long")]
    assert len(rows) == 1
    assert (rows[0].exchange, rows[0].pe, rows[0].roe, rows[0].price) == ("HOSE", 12.0, 25.0, 100)
    assert rows[0].ratio_units["roe"] == "percent"


@pytest.mark.asyncio
async def test_screener_entitlement_is_not_empty_success(monkeypatch):
    _fundamental(monkeypatch, error=EntitlementError("VNSTOCK_TIER_ROUTE"))
    class Listing:
        def __init__(self, *, source): pass
        def symbols_by_exchange(self):
            return pd.DataFrame([{"symbol": "VNM", "exchange": "HSX", "type": "STOCK"}])
    monkeypatch.setattr(runtime, "get_listing_class", lambda: Listing)
    monkeypatch.setattr(runtime, "get_quote_class", lambda: object)
    with pytest.raises(ProviderError, match="VNSTOCK_TIER_ROUTE"):
        await VnstockScreenerFetcher.fetch(StockScreenerParams(symbol="VNM"))


@pytest.mark.asyncio
async def test_screener_batch_surfaces_plan_tier_failure(monkeypatch):
    _fundamental(monkeypatch, error=EntitlementError("VNSTOCK_TIER_ROUTE"))
    class Listing:
        def __init__(self, *, source): pass
        def symbols_by_exchange(self):
            return pd.DataFrame([{"symbol": "VNM", "exchange": "HSX", "type": "STOCK"}])
    monkeypatch.setattr(runtime, "get_listing_class", lambda: Listing)
    monkeypatch.setattr(runtime, "get_quote_class", lambda: object)
    with pytest.raises(ProviderError, match="VNSTOCK_TIER_ROUTE"):
        await VnstockScreenerFetcher.fetch(StockScreenerParams(exchange="HOSE", limit=1))


def test_long_ratio_conflicts_and_unknown_units_are_withheld():
    rows = [
        {"id": "pe", "name": "P/E", "period": "2025", "value": 10},
        {"id": "pe", "name": "P/E", "period": "2025", "value": 12},
        {"id": "roe", "name": "ROE", "period": "2025", "value": 0.25},
    ]
    result = VnstockFinancialRatiosFetcher.transform_data(
        FinancialRatiosQueryParams(symbol="VNM"), rows,
    )[0]
    assert result.pe is None
    assert result.roe is None
    assert result.provider_evidence == rows


def test_generation_five_rt_long_ids_map_to_canonical_fields():
    # Real 5.x VCI long ratio shape: one value row per id per fiscal period,
    # RT_* taxonomy ids, explicit unit column, RT_CAT_* category rows present.
    rows = [
        {"period": "2025", "id": "RT_CAT_VALUE", "name": "Valuation", "unit": "", "value": None},
        {"period": "2025", "id": "RT_VALUE_PE", "name": "P/E", "unit": "lần", "value": 12.5},
        {"period": "2025", "id": "RT_VALUE_PB", "name": "P/B", "unit": "lần", "value": 1.8},
        {"period": "2025", "id": "RT_PRT_ROE", "name": "ROE", "unit": "%", "value": 21.0},
        {"period": "2025", "id": "RT_LEV_DE", "name": "D/E", "unit": "lần", "value": 0.7},
        {"period": "2025", "id": "RT_LQD_CR", "name": "Current ratio", "unit": "lần", "value": 2.2},
        {"period": "2024", "id": "RT_VALUE_PE", "name": "P/E", "unit": "lần", "value": 10.0},
        {"period": "2024", "id": "RT_PRT_ROE", "name": "ROE", "unit": "%", "value": 18.0},
    ]
    result = VnstockFinancialRatiosFetcher.transform_data(
        FinancialRatiosQueryParams(symbol="VNM", period="year"), rows,
    )
    assert [(r.period, r.pe, r.pb, r.roe, r.debt_equity, r.current_ratio) for r in result] == [
        ("2025", 12.5, 1.8, 21.0, 0.7, 2.2),
        ("2024", 10.0, None, 18.0, None, None),
    ]


def test_generation_five_rt_frame_without_mapped_ids_yields_empty():
    # Only category rows and unmapped/NaN value rows: no admitted value must
    # surface as success; the period is dropped rather than returned null-laden.
    rows = [
        {"period": "2025", "id": "RT_CAT_VALUE", "name": "Valuation", "unit": "", "value": None},
        {"period": "2025", "id": "RT_VALUE_BETA", "name": "Beta", "unit": "lần", "value": 1.1},
        {"period": "2025", "id": "RT_BANK_CAR", "name": "CAR", "unit": "%", "value": 9.0},
        {"period": "2025", "id": "RT_VALUE_MARKET_CAP", "name": "Market cap", "unit": "tỷ VNĐ", "value": 1234},
    ]
    assert VnstockFinancialRatiosFetcher.transform_data(
        FinancialRatiosQueryParams(symbol="VNM", period="year"), rows,
    ) == []


def test_generation_five_rt_period_nan_values_are_skipped():
    rows = [
        {"period": "2025", "id": "RT_VALUE_PE", "name": "P/E", "unit": "lần", "value": float("nan")},
        {"period": "2025", "id": "RT_PRT_ROA", "name": "ROA", "unit": "%", "value": 5.0},
    ]
    result = VnstockFinancialRatiosFetcher.transform_data(
        FinancialRatiosQueryParams(symbol="VNM", period="year"), rows,
    )
    assert [(r.period, r.pe, r.roa) for r in result] == [("2025", None, 5.0)]
