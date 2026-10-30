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


@pytest.mark.parametrize("statement", STATEMENTS)
@pytest.mark.parametrize("scenario", ["basisless", "verified", "rejected_metric", "no_metric"])
async def test_sync_preserves_existing_statement_and_receipts(sdk, statement, scenario, monkeypatch, test_engine):
    from datetime import datetime
    from unittest.mock import AsyncMock

    from sqlalchemy import BigInteger, Integer, select
    from sqlalchemy.ext.asyncio import async_sessionmaker
    from vnibb.models.financials import BalanceSheet, CashFlow, IncomeStatement
    from vnibb.models.sync_status import SyncStatus
    import vnibb.services.data_pipeline as pipeline_module
    from vnibb.services.data_pipeline import DataPipeline

    models = {"income": IncomeStatement, "balance": BalanceSheet, "cashflow": CashFlow}
    model = models[statement]
    metric = STATEMENTS[statement][3]
    second_metric = {"income": "gross_profit", "balance": "inventory",
                     "cashflow": "investing_cash_flow"}[statement]
    year = datetime.utcnow().year - 1
    period = str(year)
    original_time = datetime(2020, 1, 2)
    original_raw = {"_financial_lineage": {"source": "VCI", "evidence": "retained"}}

    if test_engine.dialect.name == "sqlite":
        def recreate(connection):
            table = model.__table__
            table.drop(connection)
            original = table.c.id.type
            table.c.id.type = BigInteger().with_variant(Integer, "sqlite")
            try:
                table.create(connection)
            finally:
                table.c.id.type = original
        async with test_engine.begin() as connection:
            await connection.run_sync(recreate)

    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    async with sessions() as session:
        session.add(model(id=1, symbol="HPG", period=period, period_type="year", fiscal_year=year,
                          source="VCI", raw_data=original_raw, created_at=original_time,
                          updated_at=original_time, **{metric: 777, second_metric: 444}))
        await session.commit()

    _, frames, _ = sdk
    report = STATEMENTS[statement][1]
    frame = sdk_frame(report, statement, period, basis=scenario != "basisless")
    if scenario == "no_metric":
        frame["id"] = "UNKNOWN_METRIC"
        frame["name"] = "UNKNOWN_METRIC"
        frame.attrs.pop("consolidation_basis", None)
        frame.attrs.pop("flow_basis", None)
    if scenario == "rejected_metric":
        rejected_ids = {"income": "IS_GROSS_PROFIT", "balance": "BS_INVENTORIES",
                        "cashflow": STATEMENTS[statement][2]}
        row = frame.iloc[0].to_dict()
        row.update(id=rejected_ids[statement], name=rejected_ids[statement], unit="unknown", value=123)
        frame = pd.concat([frame, pd.DataFrame([row])], ignore_index=True)
        frame.attrs.update(source="vci", symbol="HPG", report=report, format="long",
                           consolidation_basis="consolidated", flow_basis="annual")
    frames[(statement, "year", report)] = frame
    monkeypatch.setattr(pipeline_module, "async_session_maker", sessions)
    monkeypatch.setattr(pipeline_module, "engine", test_engine)
    pipeline = DataPipeline()
    monkeypatch.setattr(pipeline, "_wait_for_rate_limit", AsyncMock())
    cache = AsyncMock()
    monkeypatch.setattr(pipeline, "_cache_set_json", cache)
    progress = {}

    result = await pipeline.sync_financials(symbols=["HPG"], period="year", count=1,
                                            statement_types=[statement], progress=progress)
    outcome = progress["financial_acquisition"]["outcomes"]["HPG"][statement]
    async with sessions() as session:
        stored = (await session.scalars(select(model).where(model.symbol == "HPG"))).one()
        receipts = (await session.scalars(select(SyncStatus).where(
            SyncStatus.sync_type == "financial_acquisition", SyncStatus.status != "running"
        ))).all()
        assert receipts[-1].additional_data == outcome
        if scenario == "verified":
            assert result == 1 and outcome["complete"] is True
            assert outcome["period_outcomes"][period]["status"] == "stored"
            assert getattr(stored, metric) == 100
            cache.assert_awaited_once()
        else:
            assert result == 0 and outcome["complete"] is False
            assert outcome["persisted_rows"] == 0
            assert outcome["period_outcomes"][period]["status"] == "withheld"
            assert outcome["period_outcomes"][period]["unavailable_reason"]
            if scenario == "no_metric":
                assert outcome["period_outcomes"][period]["unavailable_reason"] == "no_admitted_metrics"
            assert outcome["source_returned_periods"] == [period]
            assert outcome["source_shortfall"] is False
            assert getattr(stored, metric) == 777
            assert getattr(stored, second_metric) == 444
            assert stored.raw_data == original_raw and stored.source == "VCI"
            assert stored.updated_at == original_time and stored.created_at == original_time
            cache.assert_not_awaited()


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


@pytest.mark.parametrize("statement", STATEMENTS)
@pytest.mark.parametrize("basis", [False, True])
async def test_dedicated_fetchers_use_vci_and_shared_admission(sdk, statement, basis):
    from vnibb.providers.vnstock.balance_sheet import BalanceSheetQueryParams, VnstockBalanceSheetFetcher
    from vnibb.providers.vnstock.cash_flow import CashFlowQueryParams, VnstockCashFlowFetcher
    from vnibb.providers.vnstock.income_statement import IncomeStatementQueryParams, VnstockIncomeStatementFetcher

    fetchers = {
        "income": (VnstockIncomeStatementFetcher, IncomeStatementQueryParams),
        "balance": (VnstockBalanceSheetFetcher, BalanceSheetQueryParams),
        "cashflow": (VnstockCashFlowFetcher, CashFlowQueryParams),
    }
    calls, frames, _ = sdk
    report = STATEMENTS[statement][1]
    frames[(statement, "year", report)] = sdk_frame(report, statement, "2025", basis=basis)
    fetcher, params = fetchers[statement]

    result = await fetcher.fetch(params(symbol="HPG", period="year"))

    assert len(result) == 2
    assert calls[0][1:7] == (STATEMENTS[statement][0], "year", "en", False, "long", "vci")
    assert getattr(result[0], STATEMENTS[statement][3]) == (100 if basis else None)
    assert result[0].raw_data["provider_attrs"]["source"] == "vci"
    assert result[0].consolidation_basis == ("consolidated" if basis else None)


@pytest.mark.parametrize("statement", STATEMENTS)
async def test_dedicated_fetchers_do_not_truncate_available_periods(sdk, statement):
    from vnibb.providers.vnstock.balance_sheet import BalanceSheetQueryParams, VnstockBalanceSheetFetcher
    from vnibb.providers.vnstock.cash_flow import CashFlowQueryParams, VnstockCashFlowFetcher
    from vnibb.providers.vnstock.income_statement import IncomeStatementQueryParams, VnstockIncomeStatementFetcher

    fetchers = {
        "income": (VnstockIncomeStatementFetcher, IncomeStatementQueryParams),
        "balance": (VnstockBalanceSheetFetcher, BalanceSheetQueryParams),
        "cashflow": (VnstockCashFlowFetcher, CashFlowQueryParams),
    }
    _, frames, _ = sdk
    report = STATEMENTS[statement][1]
    frame = sdk_frame(report, statement, "2025", basis=True)
    frames[(statement, "year", report)] = pd.concat([
        frame.iloc[:1].assign(period=str(year)) for year in range(2019, 2026)
    ], ignore_index=True)
    frames[(statement, "year", report)].attrs.update(frame.attrs)
    fetcher, params = fetchers[statement]

    result = await fetcher.fetch(params(symbol="HPG"))

    assert [row.period for row in result] == [str(year) for year in range(2025, 2018, -1)]


@pytest.mark.parametrize("statement", STATEMENTS)
async def test_dedicated_extractors_preserve_provider_errors(monkeypatch, statement):
    from vnibb.core.exceptions import ProviderError, ProviderTimeoutError
    from vnibb.providers.vnstock.balance_sheet import VnstockBalanceSheetFetcher
    from vnibb.providers.vnstock.cash_flow import VnstockCashFlowFetcher
    from vnibb.providers.vnstock.income_statement import VnstockIncomeStatementFetcher

    fetcher = {"income": VnstockIncomeStatementFetcher, "balance": VnstockBalanceSheetFetcher,
               "cashflow": VnstockCashFlowFetcher}[statement]

    async def fail(query, credentials):
        raise ProviderError(message="synthetic failure", provider="vnstock", details={"symbol": query["symbol"]})

    monkeypatch.setattr(VnstockFinancialsFetcher, "extract_data", fail)
    with pytest.raises(ProviderError, match="synthetic failure"):
        await fetcher.extract_data({"symbol": "HPG", "period": "year"})

    async def timeout(query, credentials):
        raise ProviderTimeoutError(provider="vnstock", timeout_seconds=1)

    monkeypatch.setattr(VnstockFinancialsFetcher, "extract_data", timeout)
    with pytest.raises(ProviderTimeoutError):
        await fetcher.extract_data({"symbol": "HPG", "period": "year"})


@pytest.mark.parametrize("statement", STATEMENTS)
@pytest.mark.parametrize("invalid", ["source", "unit", "basis"])
async def test_dedicated_fetchers_withhold_unverified_zero(sdk, statement, invalid):
    from vnibb.providers.vnstock.balance_sheet import BalanceSheetQueryParams, VnstockBalanceSheetFetcher
    from vnibb.providers.vnstock.cash_flow import CashFlowQueryParams, VnstockCashFlowFetcher
    from vnibb.providers.vnstock.income_statement import IncomeStatementQueryParams, VnstockIncomeStatementFetcher

    fetcher, params = {
        "income": (VnstockIncomeStatementFetcher, IncomeStatementQueryParams),
        "balance": (VnstockBalanceSheetFetcher, BalanceSheetQueryParams),
        "cashflow": (VnstockCashFlowFetcher, CashFlowQueryParams),
    }[statement]
    _, frames, _ = sdk
    report = STATEMENTS[statement][1]
    frame = sdk_frame(report, statement, "2025", basis=True)
    frame.loc[:, "value"] = 0
    if invalid == "source":
        frame.attrs["source"] = "kbs"
    elif invalid == "unit":
        frame.loc[:, "unit"] = "unknown"
    else:
        frame.attrs.pop("consolidation_basis")
    frames[(statement, "year", report)] = frame

    result = await fetcher.fetch(params(symbol="HPG"))

    assert result
    assert getattr(result[0], STATEMENTS[statement][3]) is None


@pytest.mark.parametrize("statement", STATEMENTS)
async def test_dedicated_fetchers_admit_evidenced_zero(sdk, statement):
    from vnibb.providers.vnstock.balance_sheet import BalanceSheetQueryParams, VnstockBalanceSheetFetcher
    from vnibb.providers.vnstock.cash_flow import CashFlowQueryParams, VnstockCashFlowFetcher
    from vnibb.providers.vnstock.income_statement import IncomeStatementQueryParams, VnstockIncomeStatementFetcher

    fetcher, params = {
        "income": (VnstockIncomeStatementFetcher, IncomeStatementQueryParams),
        "balance": (VnstockBalanceSheetFetcher, BalanceSheetQueryParams),
        "cashflow": (VnstockCashFlowFetcher, CashFlowQueryParams),
    }[statement]
    _, frames, _ = sdk
    report = STATEMENTS[statement][1]
    frame = sdk_frame(report, statement, "2025", basis=True)
    frame.loc[:, "value"] = 0
    frames[(statement, "year", report)] = frame

    result = await fetcher.fetch(params(symbol="HPG"))

    assert getattr(result[0], STATEMENTS[statement][3]) == 0
