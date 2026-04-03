from __future__ import annotations

import pytest

from vnibb.services.ai_model_catalog_service import AIModelCatalogService


@pytest.mark.asyncio
async def test_model_catalog_service_returns_fetched_models_and_caches(monkeypatch):
    service = AIModelCatalogService()
    call_count = {"value": 0}

    async def fake_fetch():
        call_count["value"] += 1
        return [
            {
                "id": "openai/gpt-4o-mini",
                "name": "GPT-4o Mini",
                "provider": "openrouter",
                "recommended": True,
                "tier": "balanced",
            }
        ]

    monkeypatch.setattr(service, "_fetch_openrouter_models", fake_fetch)

    first = await service.get_openrouter_models()
    second = await service.get_openrouter_models()

    assert first == second
    assert call_count["value"] == 1
