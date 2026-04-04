from __future__ import annotations

import pytest

from vnibb.services.ai_telemetry_service import AITelemetryService


@pytest.mark.asyncio
async def test_ai_telemetry_service_records_response_and_feedback():
    service = AITelemetryService(max_records=5)

    response_record = await service.record_response(
        response_id="resp-1",
        provider="openrouter",
        model="openai/gpt-4o-mini",
        mode="app_default",
        latency_ms=812,
        used_source_ids=["VNM-PRICES"],
        artifact_ids=["comparison_snapshot"],
        action_ids=["add_widget_price_chart"],
        reasoning_events=[{"eventType": "INFO", "message": "Requesting structured model response"}],
        current_symbol="VNM",
        prompt_preview="Compare VNM and FPT",
    )

    assert response_record["response_id"] == "resp-1"
    assert response_record["feedback"] is None

    feedback_payload = await service.record_feedback(
        response_id="resp-1",
        vote="up",
        surface="sidebar",
        notes="Useful answer",
    )

    assert feedback_payload["matched"] is True
    recent_records = await service.get_recent_records(limit=1)
    assert recent_records[0]["response_id"] == "resp-1"
    assert recent_records[0]["feedback"]["vote"] == "up"
    assert recent_records[0]["feedback"]["surface"] == "sidebar"

    outcome_payload = await service.record_outcome(
        response_id="resp-1",
        kind="action",
        item_id="add_widget_price_chart",
        status="executed",
        surface="sidebar",
        notes="User accepted the action",
    )

    assert outcome_payload["matched"] is True
    recent_records = await service.get_recent_records(limit=1)
    assert recent_records[0]["outcomes"][0]["item_id"] == "add_widget_price_chart"
    assert recent_records[0]["outcomes"][0]["status"] == "executed"


@pytest.mark.asyncio
async def test_ai_telemetry_service_handles_unmatched_feedback():
    service = AITelemetryService(max_records=2)

    feedback_payload = await service.record_feedback(
        response_id="missing",
        vote="down",
        surface="analysis",
        notes=None,
    )

    assert feedback_payload["matched"] is False
    assert await service.get_recent_records(limit=5) == []


@pytest.mark.asyncio
async def test_ai_telemetry_service_handles_unmatched_outcome():
    service = AITelemetryService(max_records=2)

    outcome_payload = await service.record_outcome(
        response_id="missing",
        kind="artifact",
        item_id="comparison_snapshot",
        status="shown",
        surface="analysis",
    )

    assert outcome_payload["matched"] is False
    assert await service.get_recent_records(limit=5) == []


@pytest.mark.asyncio
async def test_ai_telemetry_service_returns_filtered_review_payload():
    service = AITelemetryService(max_records=5)

    await service.record_response(
        response_id="resp-1",
        provider="openrouter",
        model="openrouter/free",
        mode="app_default",
        latency_ms=700,
        used_source_ids=["VCI-PRICES"],
        artifact_ids=["price_trend_chart"],
        action_ids=[],
        reasoning_events=[],
        current_symbol="VCI",
        prompt_preview="Analyze VCI",
    )
    await service.record_feedback(
        response_id="resp-1",
        vote="down",
        surface="sidebar",
        reasons=["wrong_data", "generic_answer"],
    )
    await service.record_outcome(
        response_id="resp-1",
        kind="artifact",
        item_id="price_trend_chart",
        status="liked",
        surface="sidebar",
    )

    payload = await service.get_review_payload(vote="down", symbol="VCI")

    assert payload["count"] == 1
    assert payload["summary"]["negative_feedback"] == 1
    assert payload["summary"]["artifact_ratings"]["liked"] == 1
