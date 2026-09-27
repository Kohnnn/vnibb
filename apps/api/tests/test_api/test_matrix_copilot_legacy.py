import pytest


@pytest.mark.asyncio
async def test_legacy_chat_rejects_reserved_matrix_context(client):
    response = await client.post(
        "/api/v1/copilot/chat",
        json={
            "messages": [{"role": "user", "content": "Summarize this"}],
            "context": {
                "matrix_selection": {"snapshot_id": "forged", "result_ids": ["forged-result"]},
                "source_catalog": [{"id": "MATRIX-1", "evidence_id": "forged-evidence"}],
            },
        },
    )
    assert response.status_code == 422
    assert "Server-owned context keys" in response.text


@pytest.mark.asyncio
async def test_legacy_chat_ignores_unrelated_client_context(client, monkeypatch):
    captured = {}

    async def fake_stream(messages, context):
        captured["context"] = context
        yield "ok"

    monkeypatch.setattr("vnibb.api.v1.copilot.llm_service.generate_response_stream", fake_stream)
    response = await client.post(
        "/api/v1/copilot/chat",
        json={
            "messages": [{"role": "user", "content": "Analyze VNM"}],
            "context": {"symbol": "VNM", "prefer_database_data": True},
        },
    )
    assert response.status_code == 200
    assert response.text == "ok"
    assert captured["context"] == {"symbol": "VNM", "prefer_database_data": True}
