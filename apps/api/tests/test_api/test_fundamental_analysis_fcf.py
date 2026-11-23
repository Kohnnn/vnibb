"""Exercise retained-snapshot FCF through the actual analysis HTTP response."""

import asyncio
import json
from datetime import date
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI
from vnibb.api.v1 import copilot, equity
from vnibb.api.v1.schemas import StandardResponse
from vnibb.core.config import settings
from vnibb.core.database import get_db
from vnibb.services.fundamental_valuation import (
    DATASET_CASH_FLOW,
    FundamentalInputs,
    compute_fundamental_snapshot,
    to_document,
)
from vnibb.services.llm_service import MAX_CONTEXT_CHARS
from vnibb.services.mongo_market_data_service import MongoMarketDataService

SNAPSHOT_DATE = date(2026, 6, 15)
LATEST_YEAR = 2024


def _cash_row(year, capex):
    return {"yearReport": year, "operating_cash_flow": 100, "capex": capex}


def _retained_document(capex, *, reject_capex=False):
    latest = _cash_row(LATEST_YEAR, capex)
    if reject_capex:
        latest["unit_metadata"] = {"capex": {"unavailable_reason": "legacy_unit_basis_unconfirmed"}}
    periods = range(2019, 2025)
    snapshot = compute_fundamental_snapshot(FundamentalInputs(
        symbol="FPT",
        statement_unit="VND",
        income_statements=[
            {"yearReport": year, "net_profit_after_tax": 20, "revenue": 200, "gross_profit": 60}
            for year in periods
        ],
        balance_sheets=[
            {"yearReport": year, "owners_equity": 100, "total_assets": 200}
            for year in periods
        ],
        cash_flows=[_cash_row(2022, 10), _cash_row(2023, 20), latest],
        unit_lineage={"statements": [{
            "period": LATEST_YEAR,
            "source": {
                "dataset": DATASET_CASH_FLOW,
                "variant": f"{DATASET_CASH_FLOW}.year",
                "source": "fixture-financial-statements",
                "observedAt": "2026-05-20T08:00:00Z",
            },
        }]},
    ))
    return to_document(snapshot, SNAPSHOT_DATE)


@pytest.fixture
def analysis_route(monkeypatch):
    documents = []

    class RetainedCollection:
        def aggregate(self, pipeline):
            assert pipeline[0] == {"$match": {"symbol": {"$in": ["FPT"]}}}
            return [{"doc": doc} for doc in documents]

    def collection(name):
        assert name == "market_fundamental_screener"
        return RetainedCollection()

    service = MongoMarketDataService()
    monkeypatch.setattr(service, "_get_collection", collection)
    monkeypatch.setattr(settings, "mongodb_enabled", True)
    monkeypatch.setattr(settings, "mongodb_url", "mongodb://127.0.0.1:1/vnibb-market")
    monkeypatch.setattr(equity, "get_mongo_market_data_service", lambda: service)
    monkeypatch.setattr(equity, "FUNDAMENTAL_SECTION_TIMEOUT_SECONDS", 0.10)
    for section in (
        "get_profile", "get_financial_ratios", "get_shareholders", "get_officers",
        "get_subsidiaries", "get_company_news", "get_company_events",
    ):
        monkeypatch.setattr(equity, section, AsyncMock(return_value=StandardResponse(data=[])))

    async def financials(**kwargs):
        if kwargs["statement_type"] == "cashflow":
            await asyncio.Event().wait()
        return StandardResponse(data=[{"period": "2025", "source": "request-2025-fixture"}])

    monkeypatch.setattr(equity, "get_financials", financials)
    app = FastAPI()
    app.include_router(equity.router, prefix="/api/v1/equity")
    app.dependency_overrides[get_db] = lambda: None
    return app, documents


async def _get_analysis(analysis_route, doc):
    app, documents = analysis_route
    if doc is not None:
        documents.append(doc)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test",
    ) as client:
        response = await client.get("/api/v1/equity/fpt/fundamental-analysis")
    assert response.status_code == 200
    body = response.json()
    assert body["error"] == "Partial data unavailable"
    data = body["data"]
    assert data["section_errors"]["financials.cashflow"] == "Section deadline exceeded"
    assert data["financials"]["cashflow"] == []
    assert data["latest_fundamental_snapshot"]["financials"]["cashflow"] is None
    return data


@pytest.mark.asyncio
@pytest.mark.parametrize(("capex", "status", "positive"), [
    (0, "positive", True), (100, "not_positive", False), (150, "not_positive", False),
])
async def test_v4_positivity_test_is_not_a_signed_amount(analysis_route, capex, status, positive):
    # These ordinary writer-produced records have a positive DCF average even
    # when latest-year FCF is zero or negative. The average cannot supply a sign.
    doc = _retained_document(capex)
    assert doc["inputs"]["derivedCoverage"]["fcf"]["baseFcf"] > 0
    data = await _get_analysis(analysis_route, doc)
    quality = data["competitive_advantage"]
    assert data["valuation"] is None  # unverified comparison, not failed FCF admission
    assert quality["quality_metrics"]["roe"] == 20
    assert quality["quality_metrics"]["fcf_positive"] is positive
    assert quality["lineage"]["snapshot_date"] == SNAPSHOT_DATE.isoformat()
    assert quality["lineage"]["snapshot_source"] == "vnibb-fundamental-engine"
    assert quality["lineage"]["schema_version"] == 4
    assert quality["lineage"]["revenue_cagr_window"] == [2019, 2024]
    assert quality["lineage"]["moat_factor_years"] == [2020, 2021, 2022, 2023, 2024]
    assert quality["fcf"] == {
        "status": status,
        "reason": "Positive FCF" if positive else "FCF not positive",
        "unavailable_reason": None,
        "amount": None,
        "unit": None,
        "positive": positive,
        "evidence": "positivity_only",
        "fiscal_year": LATEST_YEAR,
        "source": "fixture-financial-statements",
        "source_financial_date": None,
        "basis": "Annual operating cash flow − |capex|",
        "input_coverage": "complete",
        "dcf_base_admitted_years": [2022, 2023, 2024],
        "dcf_base_required_rows": 3,
    }
    assert quality["fcf"]["reason"] in quality["reasons"]
    assert data["fundamental_snapshot"]["fcfPositive"] is positive
    assert data["fundamental_snapshot"]["inputs"]["derivedCoverage"]["fcf"]["positive"] is positive


@pytest.mark.asyncio
@pytest.mark.parametrize(("capex", "amount", "status", "reason"), [
    (40, 60, "positive", "Positive FCF"),
    (100, 0, "zero", "FCF is zero"),
    (150, -50, "negative", "Negative FCF"),
])
async def test_explicitly_certified_latest_amount_and_source_date(analysis_route, capex, amount, status, reason):
    # Synthetic certification for the known 100 VND OCF and explicit capex.
    # The production v4 writer does not store either of these optional facts.
    doc = _retained_document(capex)
    doc["inputs"]["derivedCoverage"]["fcf"]["latestFcf"] = {
        "status": "admitted", "fiscalYear": LATEST_YEAR, "unit": "VND", "value": amount,
    }
    doc["inputs"]["unitLineage"]["statements"][0]["source"]["sourceDate"] = "2025-03-20"
    quality = (await _get_analysis(analysis_route, doc))["competitive_advantage"]
    assert quality["fcf"]["status"] == status
    assert quality["fcf"]["amount"] == amount
    assert quality["fcf"]["unit"] == "VND"
    assert quality["fcf"]["evidence"] == "signed_amount"
    assert quality["fcf"]["source_financial_date"] == "2025-03-20"
    assert quality["lineage"]["snapshot_date"] == "2026-06-15"
    assert reason == quality["fcf"]["reason"] and reason in quality["reasons"]


@pytest.mark.asyncio
@pytest.mark.parametrize(("field", "component", "signed"), [
    ("capex", "capex", False),
    ("Purchase Of Fixed Assets", "capex", True),
    ("operating_cash_flow", "operating_cash_flow", True),
    ("fromOperating", "operating_cash_flow", False),
])
async def test_conflicting_retained_statement_withholds_either_fcf_sign_path(analysis_route, field, component, signed):
    doc = _retained_document(150)
    # Older v4 snapshots may have a sign claim despite a persisted row conflict.
    doc["inputs"]["unitLineage"]["statements"][0]["conflictingFields"] = [field]
    if signed:
        doc["inputs"]["derivedCoverage"]["fcf"]["latestFcf"] = {
            "status": "admitted", "fiscalYear": LATEST_YEAR, "unit": "VND", "value": -50,
        }

    data = await _get_analysis(analysis_route, doc)
    quality = data["competitive_advantage"]
    fcf = quality["fcf"]
    assert fcf["status"] == "unavailable"
    assert fcf["unavailable_reason"] == f"latest_year_incomplete:{component}=conflicting_observations"
    assert fcf["input_coverage"] == "incomplete"
    assert fcf["dcf_base_admitted_years"] == [2022, 2023]
    assert fcf["amount"] is fcf["positive"] is fcf["evidence"] is None
    assert quality["quality_metrics"]["fcf_positive"] is data["fundamental_snapshot"]["fcfPositive"] is None
    published = data["fundamental_snapshot"]["inputs"]["derivedCoverage"]["fcf"]
    assert published["positive"] is published.get("latestFcf") is published["baseFcf"] is None
    assert published["baseYears"] == [2022, 2023]
    assert published["positiveReason"] == fcf["unavailable_reason"]
    assert quality["quality_metrics"]["roe"] == 20


@pytest.mark.asyncio
async def test_legacy_dcf_window_cannot_certify_coverage(analysis_route):
    doc = _retained_document(100)
    coverage = doc["inputs"]["derivedCoverage"]["fcf"]
    # Some v4 documents chose the newest complete rows, skipping incomplete ones.
    del coverage["incompleteWindowYears"]
    coverage.update(baseYears=[2021, 2022, 2024], excluded=[{
        "year": 2023, "incomplete": [{"component": "capex", "reason": "missing"}],
    }])

    data = await _get_analysis(analysis_route, doc)
    fcf = data["competitive_advantage"]["fcf"]
    assert fcf["status"] == "not_positive"
    assert fcf["input_coverage"] == "complete"  # FY2024 is still admitted.
    assert fcf["dcf_base_admitted_years"] is None
    published = data["fundamental_snapshot"]["inputs"]["derivedCoverage"]["fcf"]
    assert published["baseYears"] is published["baseFcf"] is published["status"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize(("start", "window", "expected"), [
    (2012, {"windowStartYear": 2019, "windowEndYear": 2024}, [2019, 2024]),
    (2019, {}, [2019, 2024]),
    (2012, {}, None),
    (2019, {"windowStartYear": 2019}, None),
])
async def test_cagr_lineage_uses_the_published_five_year_interval(analysis_route, start, window, expected):
    doc = _retained_document(100)
    cagr = doc["inputs"]["derivedCoverage"]["cagr"]["revenue"]
    del cagr["windowStartYear"], cagr["windowEndYear"]
    cagr.update(startYear=start, endYear=2024, **window)

    quality = (await _get_analysis(analysis_route, doc))["competitive_advantage"]
    assert quality["lineage"]["revenue_cagr_window"] == expected


@pytest.mark.asyncio
async def test_unverified_amount_and_nonmatching_statement_do_not_supply_lineage(analysis_route):
    doc = _retained_document(150)
    doc["inputs"]["derivedCoverage"]["fcf"]["latestFcf"] = {
        "status": "unverified", "fiscalYear": LATEST_YEAR, "unit": "VND", "value": -50,
    }
    doc["inputs"]["unitLineage"]["statements"][0]["source"].update(
        variant=f"{DATASET_CASH_FLOW}.quarter", sourceDate="2025-03-20",
    )
    fcf = (await _get_analysis(analysis_route, doc))["competitive_advantage"]["fcf"]
    assert fcf["status"] == "not_positive"
    assert fcf["amount"] is fcf["source"] is fcf["source_financial_date"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize(("case", "reason"), [
    ("missing_snapshot", "No retained fundamental snapshot"),
    ("schema_3", "Retained FCF schema 3 is unsupported"),
    ("bad_date", "snapshot date was not recorded or is invalid"),
    ("no_coverage", "lacks admitted FCF coverage"),
    ("no_test", "No admitted FCF amount or positivity test was recorded"),
    ("missing_capex", "latest_year_incomplete:capex=missing"),
    ("rejected_capex", "latest_year_incomplete:capex=rejected:legacy_unit_basis_unconfirmed"),
])
async def test_failed_cashflow_does_not_admit_missing_or_invalid_retained_evidence(analysis_route, case, reason):
    capex = None if case == "missing_capex" else 150
    doc = _retained_document(capex, reject_capex=case == "rejected_capex")
    if case == "schema_3":
        doc["schemaVersion"] = 3
    elif case == "bad_date":
        doc["snapshotDate"] = "2026-02-30"
    elif case == "no_coverage":
        del doc["inputs"]["derivedCoverage"]["fcf"]
    elif case == "no_test":
        doc["inputs"]["derivedCoverage"]["fcf"]["positive"] = None
        doc["fcfPositive"] = None
    elif case == "rejected_capex":
        # A stale compatibility flag cannot override the retained rejection.
        doc["fcfPositive"] = False
    elif case == "missing_snapshot":
        doc = None

    data = await _get_analysis(analysis_route, doc)
    quality = data["competitive_advantage"]
    fcf = quality["fcf"]
    assert fcf["status"] == "unavailable"
    assert fcf["amount"] is fcf["positive"] is fcf["evidence"] is None
    assert reason in fcf["unavailable_reason"]
    assert quality["quality_metrics"]["fcf_positive"] is None
    assert not any("FCF" in claim for claim in quality.get("reasons", []))
    if doc is None:
        assert quality["lineage"] is None
        assert "roe" not in quality["quality_metrics"]
    else:
        assert quality["quality_metrics"]["roe"] == 20
        assert quality["lineage"]["snapshot_source"] == "vnibb-fundamental-engine"
        assert quality["lineage"]["snapshot_date"] == (None if case == "bad_date" else "2026-06-15")
        assert data["fundamental_snapshot"]["fcfPositive"] is None
    if case in {"missing_capex", "rejected_capex"}:
        assert fcf["fiscal_year"] == LATEST_YEAR
        assert fcf["input_coverage"] == "incomplete"
        assert fcf["dcf_base_admitted_years"] == [2022, 2023]


@pytest.mark.asyncio
@pytest.mark.parametrize("evidence", ["zero", "not_positive", "unavailable"])
async def test_agent_prompt_keeps_retained_evidence_under_context_limit(analysis_route, monkeypatch, evidence):
    doc = _retained_document(100, reject_capex=evidence == "unavailable")
    if evidence == "zero":
        doc["inputs"]["derivedCoverage"]["fcf"]["latestFcf"] = {
            "status": "admitted", "fiscalYear": LATEST_YEAR, "unit": "VND", "value": 0,
        }
        doc["inputs"]["unitLineage"]["statements"][0]["source"]["sourceDate"] = "2025-03-20"
    quality = (await _get_analysis(analysis_route, doc))["competitive_advantage"]
    fcf = quality["fcf"]
    assert fcf["status"] == evidence
    assert fcf["amount"] == (0 if evidence == "zero" else None)
    assert bool(fcf["unavailable_reason"]) == (evidence == "unavailable")

    # Mirror the bounded widget attachment: the wrapper test exercises the
    # browser producer, and this test crosses the actual SSE and model seams.
    sample = {
        "symbol": "FPT",
        "fcf": {**fcf, "dcf_base_admitted_years": ", ".join(f"FY{year}" for year in fcf["dcf_base_admitted_years"])},
        "retained_quality_snapshot": {
            **quality["lineage"],
            "moat_factor_years": "FY2020, FY2021, FY2022, FY2023, FY2024",
            "revenue_cagr_window": "FY2019–FY2024", "profit_cagr_window": "FY2019–FY2024",
        },
        "cashflow_section_error": "Section deadline exceeded",
    }
    rich_browser_snapshot = {
        section: {f"field_{i}": "x" * 500 for i in range(20)} for section in ("profile", "ratios")
    }
    monkeypatch.setattr(copilot.ai_context_service, "_build_market_snapshot", AsyncMock(return_value=None))
    monkeypatch.setattr(copilot.ai_context_service, "_build_symbol_snapshot", AsyncMock(return_value=None))
    monkeypatch.setattr(copilot.llm_service, "_record_response_telemetry", AsyncMock(return_value={}))
    complete = AsyncMock(return_value="Fixture response.")
    monkeypatch.setattr(copilot.llm_service, "_request_completion_text", complete)
    app, _ = analysis_route
    app.include_router(copilot.router, prefix="/api/v1/copilot")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/v1/copilot/chat/stream", json={
            "message": "Explain the retained FCF observation",
            "context": {
                "widgetType": "Fundamental Analysis", "widgetTypeKey": "fundamental_analysis", "symbol": "FPT",
                "dataSnapshot": rich_browser_snapshot,
                "widgetPayload": {
                    "symbol": "FPT", "dataSample": sample,
                    "dataProvenance": {"updatedAt": None, "fetchedAt": "2026-06-16T08:00:00.000Z"},
                    "apiKey": "not-for-prompt",
                },
            },
            "settings": {"mode": "browser_key", "apiKey": "fixture-key", "enableWorkflowOutputs": False},
        })

    assert response.status_code == 200
    assert '"done": true' in response.text
    complete.assert_awaited_once()
    messages = complete.await_args.args[1]["messages"]
    instructions = messages[1]["content"]
    assert "not positive, not necessarily negative" in instructions
    assert "Unavailable or null is not zero" in instructions
    context_blob = messages[2]["content"].split("```json\n", 1)[1].removesuffix("\n```")
    assert len(context_blob) == MAX_CONTEXT_CHARS + 3 and context_blob.endswith("...")
    assert json.dumps(sample, ensure_ascii=True) in context_blob
    assert '"updatedAt": null' in context_blob
    assert "not-for-prompt" not in context_blob
