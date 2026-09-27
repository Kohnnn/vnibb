import json
import time
from copy import deepcopy
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from jose import jwt
from sqlalchemy.ext.asyncio import async_sessionmaker
from vnibb.api.v1 import copilot
from vnibb.core.config import settings
from vnibb.models.app_kv import AppKeyValue
from vnibb.services.llm_service import llm_service
from vnibb.services.matrix_copilot_context import (
    MAX_MATRIX_CONTEXT_BYTES,
    build_matrix_copilot_context,
)
from vnibb.services.matrix_service import resolve_matrix_selection


def frozen_record():
    snapshot_id = str(uuid4())
    entities, cells, evidence = [], [], []
    for index in range(10):
        symbol = f"AAA{index}"
        evidence_id = f"observation-{index}"
        value = None if index == 0 else f"12345678901234567890.{index:04d}"
        entities.append({"entity_id": symbol, "symbol": symbol, "name": symbol, "sector": "Industrial"})
        evidence.append({
            "evidence_id": evidence_id, "entity_id": symbol, "source": "matrix_test",
            "locator": f"financials/{symbol}/2024", "field": "revenue", "value": value,
            "unit": "VND", "period": "2024", "as_of": "2025-03-01",
            "captured_at": "2025-03-02", "provenance": "stored_observation",
            "formula": None, "input_evidence_ids": [], "limitations": ["Retained observation, not issuer filing"],
        })
        cells.append({
            "result_id": str(uuid4()), "entity_id": symbol, "dimension_id": "revenue",
            "result_revision": "frozen-revision", "state": "unavailable" if index == 0 else "supported", "payload": {
                "kind": "number", "metrics": [{
                    "key": "revenue", "label": "Revenue", "value": value, "display": value + " VND" if value else "Unavailable",
                    "unit": "VND", "period": "2024", "as_of": "2025-03-01", "basis": "consolidated",
                    "evidence_ids": [evidence_id],
                }],
            }, "evidence_ids": [evidence_id], "basis": "consolidated",
            "limitations": ["Missing source field" if index == 0 else "Frozen limitation " + "basis " * 250], "review_state": "unreviewed",
        })
    return {
        "owner_id": "matrix-owner",
        "snapshot": {
            "schema_version": "matrix-v1", "matrix_id": str(uuid4()), "snapshot_id": snapshot_id,
            "revision": "frozen-revision", "created_at": "2025-03-02", "synthetic": False,
            "anchor_symbol": "AAA0", "playbook_id": "nonfinancial", "definition_revision": "1",
            "period": "2024", "period_type": "year", "entities": entities, "cells": cells,
            "dimensions": [{"dimension_id": "revenue", "label": "Revenue", "question": "Revenue?",
                            "output_type": "number", "source_scope": "financials", "definition_revision": "1"}],
            "limitations": ["This snapshot is not latest market data"],
        },
        "evidence": evidence,
    }


@pytest.fixture
async def matrix_chat(monkeypatch, test_db, test_engine):
    record = frozen_record()
    snapshot = record["snapshot"]
    test_db.add(AppKeyValue(key=f"matrix:snapshot:{snapshot['snapshot_id']}", value=record))
    await test_db.commit()
    monkeypatch.setattr(copilot, "async_session_maker", async_sessionmaker(test_engine, expire_on_commit=False))
    monkeypatch.setattr(settings, "supabase_jwt_secret", "matrix-copilot-test-secret")
    monkeypatch.setenv("MATRIX_EXPORT_ALLOWED_SOURCES", "matrix_test")
    monkeypatch.setattr(copilot.ai_context_service, "build_runtime_context", AsyncMock(side_effect=AssertionError("latest data forbidden")))
    monkeypatch.setattr(copilot.ai_runtime_config_service, "get_runtime_config", AsyncMock(return_value={"provider": "openrouter", "model": "test-model"}))
    monkeypatch.setattr(llm_service, "resolve_request_config", lambda _: {"provider": "openrouter", "model": "test-model", "mode": "app_default", "api_key": "test-only", "base_url": "http://unused"})
    completion = AsyncMock(return_value=json.dumps({"answer_markdown": "Frozen revenue [MATRIX-10]", "used_source_ids": ["MATRIX-10", "NOT-ALLOWED"]}))
    monkeypatch.setattr(llm_service, "_request_completion_text", completion)
    monkeypatch.setattr(copilot.ai_telemetry_service, "record_response", AsyncMock())
    app = FastAPI()
    app.include_router(copilot.router)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client, record, completion


def auth_header(user="matrix-owner"):
    token = jwt.encode({"sub": user, "email": "test@example.invalid", "exp": int(time.time()) + 300}, settings.supabase_jwt_secret, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


def request_body(record):
    return {
        "message": "Compare these frozen values, not latest VNM",
        "matrix_selection": {"snapshot_id": record["snapshot"]["snapshot_id"], "result_ids": [cell["result_id"] for cell in record["snapshot"]["cells"]]},
        "context": {"symbol": "VNM", "dataSnapshot": {"revenue": "WRONG-LATEST"}},
        "settings": {"webSearch": True, "enableWorkflowOutputs": True},
    }


@pytest.mark.asyncio
async def test_matrix_send_reaches_actual_provider_payload_without_truncation(matrix_chat, test_db):
    client, record, completion = matrix_chat
    body = request_body(record)
    expected = await resolve_matrix_selection(test_db, "matrix-owner", body["matrix_selection"])
    response = await client.post("/chat/stream", json=body, headers=auth_header())
    assert response.status_code == 200
    completion.assert_awaited_once()
    payload = completion.call_args.args[1]
    serialized = payload["messages"][2]["content"].split("```json\n", 1)[1].rsplit("\n```", 1)[0]
    context = json.loads(serialized)
    assert len(serialized) > 16000
    assert context["matrix_selection"] == expected
    assert len(context["matrix_selection"]["snapshot"]["entities"]) == 10
    missing = context["matrix_selection"]["snapshot"]["cells"][0]
    assert missing["state"] == "unavailable"
    assert missing["payload"]["metrics"][0]["value"] is None
    assert missing["limitations"] == ["Missing source field"]
    assert "WRONG-LATEST" not in serialized
    assert "plugins" not in payload
    assert {item["evidence_id"] for item in context["source_catalog"]} == {item["evidence_id"] for item in expected["evidence"]}
    done = next(json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ") and json.loads(line[6:]).get("done"))
    assert done["usedSourceIds"] == ["MATRIX-10"]
    assert done["actions"] == []
    assert done["artifacts"] == []


@pytest.mark.asyncio
@pytest.mark.parametrize("user,status", [(None, 401), ("other-owner", 404)])
async def test_matrix_send_rejects_unbound_or_wrong_owner(matrix_chat, user, status):
    client, record, completion = matrix_chat
    response = await client.post("/chat/stream", json=request_body(record), headers=auth_header(user) if user else {})
    assert response.status_code == status
    completion.assert_not_awaited()


@pytest.mark.asyncio
async def test_matrix_send_reauthorizes_revoked_selection(matrix_chat, test_db):
    client, record, completion = matrix_chat
    body = request_body(record)
    await resolve_matrix_selection(test_db, "matrix-owner", body["matrix_selection"])
    test_db.add(AppKeyValue(key=f"matrix:revoked:{record['snapshot']['snapshot_id']}", value={"revoked": True}))
    await test_db.commit()
    response = await client.post("/chat/stream", json=body, headers=auth_header())
    assert response.status_code == 404
    completion.assert_not_awaited()


@pytest.mark.asyncio
async def test_matrix_send_requires_explicit_export_rights(matrix_chat, monkeypatch):
    client, record, completion = matrix_chat
    monkeypatch.delenv("MATRIX_EXPORT_ALLOWED_SOURCES", raising=False)
    response = await client.post("/chat/stream", json=request_body(record), headers=auth_header())
    assert response.status_code == 403
    completion.assert_not_awaited()


@pytest.mark.asyncio
async def test_matrix_selection_bounds_reject_not_truncate(matrix_chat):
    client, record, completion = matrix_chat
    body = request_body(record)
    body["matrix_selection"]["result_ids"] = [str(uuid4()) for _ in range(121)]
    response = await client.post("/chat/stream", json=body, headers=auth_header())
    assert response.status_code == 422
    completion.assert_not_awaited()


@pytest.mark.asyncio
async def test_matrix_context_rejects_oversize_instead_of_silent_truncation(matrix_chat, test_db):
    _, record, _ = matrix_chat
    packet = await resolve_matrix_selection(test_db, "matrix-owner", request_body(record)["matrix_selection"])
    oversized = deepcopy(packet)
    oversized["snapshot"]["limitations"] = ["x" * MAX_MATRIX_CONTEXT_BYTES]
    with pytest.raises(HTTPException) as error:
        build_matrix_copilot_context(oversized)
    assert error.value.status_code == 413


@pytest.mark.asyncio
async def test_normal_chat_does_not_require_matrix_auth(matrix_chat, monkeypatch):
    client, _, completion = matrix_chat
    monkeypatch.setattr(copilot, "get_current_user", AsyncMock(side_effect=AssertionError("normal auth changed")))
    normal_context = AsyncMock(return_value={"source_catalog": [], "market_context": []})
    monkeypatch.setattr(copilot.ai_context_service, "build_runtime_context", normal_context)
    response = await client.post("/chat/stream", json={"message": "Analyze VNM"})
    assert response.status_code == 200
    normal_context.assert_awaited_once()
    completion.assert_awaited_once()


@pytest.mark.asyncio
async def test_matrix_provider_errors_do_not_echo_credentials(matrix_chat, caplog):
    client, record, completion = matrix_chat
    completion.side_effect = RuntimeError("provider echoed Authorization: secret-test-token")
    response = await client.post("/chat/stream", json=request_body(record), headers=auth_header())
    assert "secret-test-token" not in response.text
    assert "secret-test-token" not in caplog.text
    assert "Matrix provider request failed" in response.text
