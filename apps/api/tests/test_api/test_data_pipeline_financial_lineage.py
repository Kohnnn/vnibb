from copy import deepcopy

import pytest
import vnibb.services.data_pipeline as pipeline_module
from vnibb.providers.vnstock.financials import (
    FinancialStatementData,
    VnstockFinancialsFetcher,
)
from vnibb.services.data_pipeline import DataPipeline


@pytest.fixture
def financial_sync(monkeypatch):
    persisted = []
    cached = []
    pipeline = DataPipeline()

    class RecordingSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def execute(self, values):
            persisted.append(values)

        async def commit(self):
            pass

    async def wait_for_rate_limit(bucket):
        assert bucket == "financials"

    async def cache_set_json(key, value, ttl):
        cached.extend(value)

    async def extract_data(params):
        return []

    monkeypatch.setattr(pipeline, "_wait_for_rate_limit", wait_for_rate_limit)
    monkeypatch.setattr(pipeline, "_cache_set_json", cache_set_json)
    monkeypatch.setattr(pipeline_module, "async_session_maker", RecordingSession)
    monkeypatch.setattr(pipeline_module, "get_upsert_stmt", lambda model, keys, values: values)
    monkeypatch.setattr(VnstockFinancialsFetcher, "extract_data", extract_data)

    async def sync(entries, period="quarter"):
        monkeypatch.setattr(
            VnstockFinancialsFetcher,
            "transform_data",
            lambda params, rows: [
                entry for entry in entries if entry.statement_type == params.statement_type.value
            ],
        )
        total = await pipeline.sync_financials(
            symbols=["VNM"],
            period=period,
            statement_types=list(dict.fromkeys(entry.statement_type for entry in entries)),
        )
        assert total == 1
        return persisted, cached

    return sync


def statement(statement_type, **overrides):
    return FinancialStatementData(
        **{
            "symbol": "VNM",
            "period": "Q1-2026",
            "statement_type": statement_type,
            "source": "KBS",
            "currency": "VND",
            "value_unit": "VND",
            "consolidation_basis": "consolidated",
            "flow_basis": "single_quarter",
            "aggregation_basis": "reported_quarter",
            "source_periods": ["Q1-2026"],
            **overrides,
        }
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "statement_type, metric",
    [("income", "revenue"), ("balance", "total_assets"), ("cashflow", "operating_cash_flow")],
)
async def test_persistence_keeps_source_rows_and_full_canonical_lineage(
    financial_sync, statement_type, metric
):
    raw = {metric: 12.0, "provider_rows": [{"item": metric, "value": 12.0}]}
    metadata = {metric: {"source_unit": "billion VND", "normalization_multiplier": 1e9}}
    entry = statement(statement_type, raw_data=raw, unit_metadata=metadata, **{metric: 12e9})
    original = deepcopy(entry.model_dump(mode="json"))

    persisted, cached = await financial_sync([entry])
    stored = persisted[0]
    lineage = stored["raw_data"]["_financial_lineage"]

    assert stored[metric] == 12e9
    assert stored["source"] == "KBS"
    assert stored["raw_data"][metric] == 12.0
    assert stored["raw_data"]["provider_rows"] == raw["provider_rows"]
    assert lineage["canonical_data"][metric] == 12e9
    for key in (
        "source", "currency", "value_unit", "unit_metadata", "aggregation_basis",
        "source_periods", "unavailable_reason", "consolidation_basis", "flow_basis",
    ):
        assert lineage[key] == original[key]
    assert cached[0]["raw_data"] == stored["raw_data"]
    assert entry.model_dump(mode="json") == original


@pytest.mark.asyncio
@pytest.mark.parametrize("value_unit, reason", [(None, None), ("VND", "unknown_source_unit")])
@pytest.mark.parametrize(
    "statement_type, metric",
    [("income", "revenue"), ("balance", "total_assets"), ("cashflow", "operating_cash_flow")],
)
async def test_unavailable_statement_never_persists_guessed_numbers(
    financial_sync, value_unit, reason, statement_type, metric
):
    entry = statement(
        statement_type, value_unit=value_unit, unavailable_reason=reason,
        raw_data={metric: 999.0}, **{metric: 999e9},
    )
    persisted, cached = await financial_sync([entry])

    assert persisted[0][metric] is None
    assert cached[0][metric] is None
    assert persisted[0]["raw_data"][metric] == 999.0
    lineage = persisted[0]["raw_data"]["_financial_lineage"]
    assert lineage["unavailable_reason"] == "unknown_source_unit"
    assert lineage["canonical_data"][metric] is None
    assert lineage["derived_data"] == {}


@pytest.mark.asyncio
async def test_derived_fields_do_not_overwrite_provider_originals(financial_sync):
    income = statement(
        "income", operating_income=100e9, depreciation=10e9,
        raw_data={"ebitda": 110.0, "depreciation": 10.0},
    )
    cashflow = statement(
        "cashflow", operating_cash_flow=80e9, investing_cash_flow=-30e9,
        financing_cash_flow=-5e9, capital_expenditure=-20e9,
        raw_data={"free_cash_flow": 60.0, "depreciation": 10.0},
    )
    original = deepcopy(income.model_dump(mode="json"))
    persisted, cached = await financial_sync([income, cashflow])

    assert persisted[0]["ebitda"] == 110e9
    assert persisted[0]["raw_data"]["ebitda"] == 110.0
    assert persisted[1]["free_cash_flow"] == 60e9
    assert persisted[1]["depreciation"] == 10e9
    assert persisted[1]["raw_data"]["free_cash_flow"] == 60.0
    lineage = persisted[1]["raw_data"]["_financial_lineage"]
    assert lineage["derived_data"]["depreciation"]["source_statement"] == "income"
    assert lineage["derived_data"]["free_cash_flow"]["formula"] == "operating_cash_flow + capital_expenditure"
    assert lineage["canonical_data"]["net_change_in_cash"] == 45e9
    assert cached[1]["free_cash_flow"] == 60e9
    assert income.model_dump(mode="json") == original


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "override",
    [
        {"period": "2026", "source_periods": ["2026"]},
        {"source": "VCI"},
        {"currency": "USD"},
        {"consolidation_basis": "separate"},
        {"flow_basis": "cumulative"},
        {"flow_basis": None},
        {"source_periods": ["Q4-2025", "Q1-2026"]},
    ],
)
async def test_depreciation_crossfill_requires_matching_period_and_basis(financial_sync, override):
    income = statement("income", depreciation=10e9, **override)
    cashflow = statement("cashflow", operating_cash_flow=80e9)
    persisted, _ = await financial_sync([income, cashflow])

    assert persisted[1]["depreciation"] is None
    assert "depreciation" not in persisted[1]["raw_data"]["_financial_lineage"]["derived_data"]


@pytest.mark.asyncio
@pytest.mark.parametrize("capex", [None, 20e9])
async def test_investing_flow_and_unsigned_capex_never_create_free_cash_flow(financial_sync, capex):
    entry = statement(
        "cashflow", operating_cash_flow=80e9, investing_cash_flow=-30e9,
        capital_expenditure=capex,
        raw_data={"capital_expenditure": -20.0, "free_cash_flow": 60.0},
    )
    persisted, _ = await financial_sync([entry])

    assert persisted[0]["capital_expenditure"] == capex
    assert persisted[0]["free_cash_flow"] is None
    assert persisted[0]["raw_data"]["capital_expenditure"] == -20.0


@pytest.mark.asyncio
async def test_missing_normalized_operands_never_use_raw_supplements(financial_sync):
    entry = statement(
        "income", source=None, selling_general_admin=10e9,
        raw_data={"operating_expenses": 20.0, "research_development": 10.0,
                  "depreciation": 5.0, "ebitda": 100.0},
    )
    persisted, _ = await financial_sync([entry])

    assert persisted[0]["operating_expenses"] is None
    assert persisted[0]["ebitda"] is None
    assert persisted[0]["source"] == "unknown"
    lineage = persisted[0]["raw_data"]["_financial_lineage"]
    assert lineage["source"] is None
    assert lineage["canonical_data"]["research_development"] is None
    assert lineage["derived_data"] == {}


@pytest.mark.asyncio
async def test_rejected_provider_metrics_are_not_derived_or_crossfilled(financial_sync):
    rejected = {"unavailable_reason": "conflicting_metric_rows"}
    income = statement(
        "income",
        operating_income=100e9,
        depreciation=10e9,
        ebitda=None,
        unit_metadata={"ebitda": dict(rejected)},
    )
    cashflow = statement(
        "cashflow",
        operating_cash_flow=80e9,
        investing_cash_flow=-30e9,
        financing_cash_flow=-5e9,
        depreciation=None,
        unit_metadata={"depreciation": dict(rejected)},
    )

    persisted, cached = await financial_sync([income, cashflow])

    income_lineage = persisted[0]["raw_data"]["_financial_lineage"]
    cashflow_lineage = persisted[1]["raw_data"]["_financial_lineage"]
    assert persisted[0]["ebitda"] is None
    assert "ebitda" not in income_lineage["derived_data"]
    assert persisted[1]["depreciation"] is None
    assert "depreciation" not in cashflow_lineage["derived_data"]
    assert cached[0]["ebitda"] is None
    assert cached[1]["depreciation"] is None
    assert (
        income_lineage["unit_metadata"]["ebitda"]["unavailable_reason"]
        == "conflicting_metric_rows"
    )
    assert (
        cashflow_lineage["unit_metadata"]["depreciation"]["unavailable_reason"]
        == "conflicting_metric_rows"
    )
