from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_chat_stream_passes_runtime_context_and_request_settings(client, monkeypatch):
    captured: dict[str, object] = {}

    async def fake_build_runtime_context(*, message, history, client_context, prefer_appwrite_data):
        captured["message"] = message
        captured["history"] = history
        captured["client_context"] = client_context
        captured["prefer_appwrite_data"] = prefer_appwrite_data
        return {
            "prefer_appwrite_data": prefer_appwrite_data,
            "market_context": [{"symbol": "VNM", "source": "appwrite"}],
        }

    async def fake_generate_response_stream_events(messages, context, request_settings=None):
        captured["messages"] = messages
        captured["runtime_context"] = context
        captured["request_settings"] = request_settings
        yield {
            "reasoning": {"eventType": "INFO", "message": "Requesting structured model response"}
        }
        yield {"chunk": "Hello"}
        yield {"chunk": " world"}
        yield {
            "done": True,
            "usedSourceIds": ["VNM-PRICES"],
            "sources": [{"id": "VNM-PRICES", "label": "Price history snapshot"}],
            "artifacts": [
                {
                    "id": "comparison_snapshot",
                    "type": "table",
                    "title": "Comparison Snapshot",
                    "columns": [{"key": "symbol", "label": "Symbol", "kind": "text"}],
                    "rows": [{"symbol": "VNM"}],
                    "sourceIds": ["VNM-PRICES"],
                }
            ],
            "actions": [
                {
                    "id": "add_widget_price_chart",
                    "type": "add_widget",
                    "label": "Add Price Chart",
                    "payload": {"widgetType": "price_chart"},
                }
            ],
        }

    monkeypatch.setattr(
        "vnibb.api.v1.copilot.ai_context_service.build_runtime_context",
        fake_build_runtime_context,
    )
    monkeypatch.setattr(
        "vnibb.api.v1.copilot.llm_service.generate_response_stream_events",
        fake_generate_response_stream_events,
    )

    response = await client.post(
        "/api/v1/copilot/chat/stream",
        json={
            "message": "Analyze VNM",
            "context": {
                "widgetType": "Dashboard",
                "symbol": "VNM",
                "activeTab": "fundamentals",
                "dataSnapshot": {"quote": {"price": 72.4}},
                "widgetPayload": {"panel": "overview"},
            },
            "history": [{"role": "assistant", "content": "How can I help?"}],
            "settings": {
                "mode": "browser_key",
                "provider": "openrouter",
                "model": "openai/gpt-4o-mini",
                "apiKey": "sk-or-test",
                "webSearch": False,
                "preferAppwriteData": True,
            },
        },
    )

    assert response.status_code == 200
    assert '"message": "Building Appwrite-first runtime context"' in response.text
    assert '"message": "Runtime context ready"' in response.text
    assert '"message": "Requesting structured model response"' in response.text
    assert '"chunk": "Hello"' in response.text
    assert '"chunk": " world"' in response.text
    assert '"usedSourceIds": ["VNM-PRICES"]' in response.text
    assert '"artifacts": [{"id": "comparison_snapshot"' in response.text
    assert '"actions": [{"id": "add_widget_price_chart"' in response.text
    assert '"done": true' in response.text.lower()
    assert captured["prefer_appwrite_data"] is True
    assert captured["runtime_context"] == {
        "prefer_appwrite_data": True,
        "market_context": [{"symbol": "VNM", "source": "appwrite"}],
    }
    assert captured["request_settings"] == {
        "mode": "browser_key",
        "provider": "openrouter",
        "model": "openai/gpt-4o-mini",
        "apiKey": "sk-or-test",
        "webSearch": False,
        "preferAppwriteData": True,
    }


@pytest.mark.asyncio
async def test_chat_stream_returns_error_event_when_context_build_fails(client, monkeypatch):
    async def fake_build_runtime_context(**_kwargs):
        raise RuntimeError("context failure")

    monkeypatch.setattr(
        "vnibb.api.v1.copilot.ai_context_service.build_runtime_context",
        fake_build_runtime_context,
    )

    response = await client.post(
        "/api/v1/copilot/chat/stream",
        json={
            "message": "Analyze VNM",
            "history": [],
        },
    )

    assert response.status_code == 200
    assert '"error": "context failure"' in response.text


@pytest.mark.asyncio
async def test_submit_feedback_records_telemetry(client, monkeypatch):
    captured: dict[str, object] = {}

    def fake_record_feedback(*, response_id, vote, surface, notes=None):
        captured["response_id"] = response_id
        captured["vote"] = vote
        captured["surface"] = surface
        captured["notes"] = notes
        return {"matched": True}

    monkeypatch.setattr(
        "vnibb.api.v1.copilot.ai_telemetry_service.record_feedback",
        fake_record_feedback,
    )

    response = await client.post(
        "/api/v1/copilot/feedback",
        json={
            "responseId": "resp-123",
            "vote": "up",
            "surface": "sidebar",
            "notes": "Helpful answer",
        },
    )

    assert response.status_code == 200
    assert response.json() == {"accepted": True, "matched": True}
    assert captured == {
        "response_id": "resp-123",
        "vote": "up",
        "surface": "sidebar",
        "notes": "Helpful answer",
    }
