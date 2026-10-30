from __future__ import annotations

from types import SimpleNamespace

import pandas as pd
import pytest

from vnibb.providers.vnstock.financials import (
    FinancialsQueryParams,
    StatementType,
    VnstockFinancialsFetcher,
)

STATEMENTS = {
    "income": ("income_statement", "income_statement", "IS_NET_REVENUE", "revenue"),
    "balance": ("balance_sheet", "balance_sheet", "BS_TOTAL_ASSETS", "total_assets"),
    "cashflow": ("cash_flow", "cash_flow", "CF_NET_CASH_FLOWS_FROM_OPERATING_ACTIVITIES", "operating_cash_flow"),
}


def sdk_frame(report: str, statement: str, period: str, *, basis: bool = False) -> pd.DataFrame:
    item = STATEMENTS[statement][2]
    rows = [
        {"period": period, "id": item, "name": item, "unit": "VNĐ", "value": 100, "symbol": "HPG", "report": report},
        {"period": period, "id": item, "name": item, "unit": "VNĐ", "value": 100, "symbol": "HPG", "report": report},
        {"period": "2024-Q4" if "Q" in period else "2024", "id": item, "name": item,
         "unit": "VNĐ", "value": 80, "symbol": "HPG", "report": report},
    ]
    if statement == "balance":
        for row in rows:
            row["off_balance"] = False
    frame = pd.DataFrame(rows)
    frame.attrs.update(
        source="vci", symbol="HPG", report=report, format="long",
        taxonomy_version="synthetic-vas", provider_cap="one_period",
    )
    if basis:
        frame.attrs.update(consolidation_basis="consolidated", flow_basis="single_quarter" if "Q" in period else "annual")
    return frame


@pytest.fixture
def sdk(monkeypatch):
    import sys
    from types import ModuleType

    vnstock = ModuleType("vnstock")
    vnstock.__version__ = "5.2.1"
    monkeypatch.setitem(sys.modules, "vnstock", vnstock)
    from vnibb.providers.vnstock import runtime

    calls = []
    active = {"source": "kbs"}
    frames = {}

    class Fundamental:
        def equity(self, symbol):
            active["symbol"] = symbol
            return SimpleNamespace(**{
                method_name: self._method(method_name)
                for method_name, _, _, _ in STATEMENTS.values()
            })

        def _method(self, method_name):
            def statement(*, period, lang, drop_empty, format, source):
                calls.append((active["symbol"], method_name, period, lang, drop_empty, format, source, active["source"]))
                statement_key = next(key for key, value in STATEMENTS.items() if value[0] == method_name)
                report = STATEMENTS[statement_key][1]
                return frames[(statement_key, period, report)]
            return statement

    async def run(operation, timeout, **kwargs):
        return operation()

    monkeypatch.setattr(runtime, "import_vnstock_symbol", lambda name: (Fundamental if name == "Fundamental" else type("Finance", (), {}), "vnstock"))
    monkeypatch.setattr(runtime, "run_financial_provider", run)
    return calls, frames, active


@pytest.mark.parametrize("statement", STATEMENTS)
@pytest.mark.parametrize("period,expected_period", [("year", "2025"), ("quarter", "Q1-2025")])
async def test_generation_five_long_statements_route_vci_preserve_source_attrs_and_group_limit(sdk, statement, period, expected_period):
    calls, frames, active = sdk
    report = STATEMENTS[statement][1]
    frames[(statement, "year", report)] = sdk_frame(report, statement, "2025")
    frames[(statement, "quarter", report)] = sdk_frame(report, statement, "2025-Q1")
    active["source"] = "kbs"  # SDK default differs; the request must explicitly select VCI.

    result = await VnstockFinancialsFetcher.fetch(
        FinancialsQueryParams(symbol="HPG", statement_type=StatementType(statement), period=period, limit=1)
    )

    assert calls == [("HPG", STATEMENTS[statement][0], period, "en", False, "long", "vci", "kbs")]
    assert len(result) == 1
    assert result[0].period == expected_period
    assert len(result[0].raw_data["provider_rows"]) == 2
    assert result[0].raw_data["provider_attrs"]["provider_cap"] == "one_period"
    assert getattr(result[0], STATEMENTS[statement][3]) is None


@pytest.mark.parametrize("statement", STATEMENTS)
async def test_generation_five_explicit_synthetic_basis_admits_vnd_unscaled(sdk, statement):
    calls, frames, _ = sdk
    report = STATEMENTS[statement][1]
    frames[(statement, "year", report)] = sdk_frame(report, statement, "2025", basis=True)

    result = await VnstockFinancialsFetcher.fetch(
        FinancialsQueryParams(symbol="HPG", statement_type=StatementType(statement), period="year", limit=1)
    )

    assert result[0].value_unit == "VND"
    assert getattr(result[0], STATEMENTS[statement][3]) == 100
    assert result[0].raw_data["provider_attrs"]["consolidation_basis"] == "consolidated"
    assert len(calls) == 1


async def test_generation_five_provider_failure_does_not_fallback_to_another_source(monkeypatch):
    import sys
    from types import ModuleType

    from vnibb.core.exceptions import ProviderError
    from vnibb.providers.vnstock import runtime

    vnstock = ModuleType("vnstock")
    vnstock.__version__ = "5.2.1"
    monkeypatch.setitem(sys.modules, "vnstock", vnstock)
    calls = []

    class Fundamental:
        def equity(self, symbol):
            class Statement:
                def income_statement(self, **kwargs):
                    calls.append(kwargs)
                    raise RuntimeError("synthetic VCI failure")
            return Statement()

    async def run(operation, timeout, **kwargs):
        return operation()

    monkeypatch.setattr(runtime, "import_vnstock_symbol", lambda name: (Fundamental, "vnstock"))
    monkeypatch.setattr(runtime, "run_financial_provider", run)
    with pytest.raises(ProviderError, match="synthetic VCI failure"):
        await VnstockFinancialsFetcher.extract_data(
            {"symbol": "HPG", "statement_type": "income", "period": "year", "limit": 2}
        )
    assert len(calls) == 1
    assert calls[0]["source"] == "vci"

async def test_generation_four_statement_adapter_keeps_period_count_and_vci(monkeypatch):
    import sys
    from types import ModuleType

    from vnibb.providers.vnstock import runtime

    vnstock = ModuleType("vnstock")
    vnstock.__version__ = "4.0.4"
    monkeypatch.setitem(sys.modules, "vnstock", vnstock)

    calls = []

    class Finance:
        def __init__(self, *, symbol, source):
            calls.append(("init", symbol, source))

        def income_statement(self, *, period, count, display_mode, dropna, lang):
            calls.append((period, count, display_mode, dropna, lang))
            return pd.DataFrame([{"period": "2025", "netRevenue": 100}])

    async def run(operation, timeout, **kwargs):
        return operation()

    monkeypatch.setattr(runtime, "import_vnstock_symbol", lambda name: (Finance, "vnstock"))
    monkeypatch.setattr(runtime, "run_financial_provider", run)
    result = await VnstockFinancialsFetcher.fetch(
        FinancialsQueryParams(symbol="HPG", statement_type=StatementType.INCOME, period="year", limit=7)
    )

    assert calls[0] == ("init", "HPG", "VCI")
    assert calls[1] == ("year", 7, "all", False, "en")
    assert result[0].period == "2025"
async def test_generation_four_missing_sdk_version_stays_on_legacy_route(monkeypatch):
    import sys
    from types import ModuleType

    from vnibb.providers.vnstock import runtime

    monkeypatch.setitem(sys.modules, "vnstock", ModuleType("vnstock"))
    calls = []

    class Finance:
        def __init__(self, *, symbol, source):
            calls.append(("init", symbol, source))

        def income_statement(self, *, period, count, display_mode, dropna, lang):
            calls.append((period, count, display_mode, dropna, lang))
            return pd.DataFrame([{"period": "2025", "netRevenue": 100}])

    async def run(operation, timeout, **kwargs):
        return operation()

    monkeypatch.setattr(runtime, "import_vnstock_symbol", lambda name: (Finance, "vnstock"))
    monkeypatch.setattr(runtime, "run_financial_provider", run)
    result = await VnstockFinancialsFetcher.fetch(
        FinancialsQueryParams(symbol="HPG", statement_type=StatementType.INCOME, period="year", limit=2)
    )
    assert calls[0] == ("init", "HPG", "VCI")
    assert result[0].period == "2025"
