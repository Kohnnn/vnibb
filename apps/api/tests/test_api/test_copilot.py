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


@pytest.mark.asyncio
async def test_chat_stream_uses_admin_runtime_model_for_app_default_mode(client, monkeypatch):
    captured: dict[str, object] = {}

    async def fake_build_runtime_context(*, message, history, client_context, prefer_appwrite_data):
        return {
            "market_context": [],
            "source_catalog": [],
            "prefer_appwrite_data": prefer_appwrite_data,
        }

    async def fake_get_runtime_config():
        return {"provider": "openrouter", "model": "anthropic/claude-3.5-haiku"}

    async def fake_generate_response_stream_events(messages, context, request_settings=None):
        captured["request_settings"] = request_settings
        yield {"chunk": "Hello"}
        yield {"done": True, "usedSourceIds": [], "sources": [], "artifacts": [], "actions": []}

    monkeypatch.setattr(
        "vnibb.api.v1.copilot.ai_context_service.build_runtime_context",
        fake_build_runtime_context,
    )
    monkeypatch.setattr(
        "vnibb.api.v1.copilot.ai_runtime_config_service.get_runtime_config",
        fake_get_runtime_config,
    )
    monkeypatch.setattr(
        "vnibb.api.v1.copilot.llm_service.generate_response_stream_events",
        fake_generate_response_stream_events,
    )

    response = await client.post(
        "/api/v1/copilot/chat/stream",
        json={
            "message": "Analyze VNM",
            "history": [],
            "settings": {
                "mode": "app_default",
                "provider": "openrouter",
                "model": "",
                "webSearch": False,
                "preferAppwriteData": True,
            },
        },
    )

    assert response.status_code == 200
    assert captured["request_settings"] == {
        "mode": "app_default",
        "provider": "openrouter",
        "model": "anthropic/claude-3.5-haiku",
        "webSearch": False,
        "preferAppwriteData": True,
    }


@pytest.mark.asyncio
async def test_submit_outcome_records_telemetry(client, monkeypatch):
    captured: dict[str, object] = {}

    def fake_record_outcome(*, response_id, kind, item_id, status, surface, notes=None):
        captured["response_id"] = response_id
        captured["kind"] = kind
        captured["item_id"] = item_id
        captured["status"] = status
        captured["surface"] = surface
        captured["notes"] = notes
        return {"matched": True}

    monkeypatch.setattr(
        "vnibb.api.v1.copilot.ai_telemetry_service.record_outcome",
        fake_record_outcome,
    )

    response = await client.post(
        "/api/v1/copilot/outcome",
        json={
            "responseId": "resp-123",
            "kind": "action",
            "itemId": "add_widget_price_chart",
            "status": "executed",
            "surface": "widget",
            "notes": "Action applied",
        },
    )

    assert response.status_code == 200
    assert response.json() == {"accepted": True, "matched": True}
    assert captured == {
        "response_id": "resp-123",
        "kind": "action",
        "item_id": "add_widget_price_chart",
        "status": "executed",
        "surface": "widget",
        "notes": "Action applied",
    }


@pytest.mark.asyncio
async def test_admin_ai_runtime_endpoints_round_trip(client, monkeypatch):
    async def fake_get_runtime_config():
        return {"provider": "openrouter", "model": "openai/gpt-4o-mini", "updated_at": None}

    async def fake_save_runtime_config(*, model: str):
        return {
            "provider": "openrouter",
            "model": model,
            "updated_at": "2026-04-03T12:00:00+00:00",
        }

    monkeypatch.setattr(
        "vnibb.api.v1.admin.ai_runtime_config_service.get_runtime_config",
        fake_get_runtime_config,
    )
    monkeypatch.setattr(
        "vnibb.api.v1.admin.ai_runtime_config_service.save_runtime_config",
        fake_save_runtime_config,
    )

    get_response = await client.get("/api/v1/admin/ai-runtime")
    put_response = await client.put(
        "/api/v1/admin/ai-runtime", json={"model": "google/gemini-2.5-flash"}
    )

    assert get_response.status_code == 200
    assert get_response.json()["model"] == "openai/gpt-4o-mini"
    assert put_response.status_code == 200
    assert put_response.json()["model"] == "google/gemini-2.5-flash"


@pytest.mark.asyncio
async def test_admin_ai_telemetry_returns_recent_records(client, monkeypatch):
    monkeypatch.setattr(
        "vnibb.api.v1.admin.ai_telemetry_service.get_recent_records",
        lambda limit=25: [
            {
                "response_id": "resp-1",
                "provider": "openrouter",
                "model": "openai/gpt-4o-mini",
                "mode": "app_default",
                "latency_ms": 512,
                "used_source_ids": ["VNM-PRICES"],
                "artifact_ids": ["comparison_snapshot"],
                "action_ids": ["add_widget_price_chart"],
                "reasoning_events": [],
                "current_symbol": "VNM",
                "prompt_preview": "Compare VNM and FPT",
                "created_at": "2026-04-03T12:00:00+00:00",
                "feedback": None,
                "outcomes": [],
            }
        ],
    )

    response = await client.get("/api/v1/admin/ai-telemetry?limit=10")

    assert response.status_code == 200
    assert response.json()["count"] == 1
    assert response.json()["data"][0]["response_id"] == "resp-1"
