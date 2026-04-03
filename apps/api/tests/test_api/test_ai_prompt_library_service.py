from __future__ import annotations

import pytest

from vnibb.services.ai_prompt_library_service import DEFAULT_PROMPTS, AIPromptLibraryService


@pytest.mark.asyncio
async def test_prompt_library_service_merges_defaults_and_shared_prompts():
    service = AIPromptLibraryService()

    saved = await service.save_shared_prompts(
        [
            {
                "id": "shared-thesis",
                "label": "Shared Thesis",
                "template": "Build a clear thesis for {symbol}",
                "category": "analysis",
            }
        ]
    )

    public_prompts = await service.get_public_prompts()

    assert saved[0]["id"] == "shared-thesis"
    assert any(prompt["id"] == "shared-thesis" for prompt in public_prompts)
    assert any(prompt["id"] == DEFAULT_PROMPTS[0]["id"] for prompt in public_prompts)


@pytest.mark.asyncio
async def test_prompt_library_service_sanitizes_invalid_prompt_entries():
    service = AIPromptLibraryService()

    saved = await service.save_shared_prompts(
        [
            {"id": "", "label": "Missing id", "template": "bad"},
            {"id": "ok", "label": "OK", "template": "Prompt body", "category": "unknown"},
        ]
    )

    assert saved == [
        {
            "id": "ok",
            "label": "OK",
            "template": "Prompt body",
            "category": "custom",
            "recommendedWidgetKeys": [],
            "isDefault": False,
            "source": "shared",
        }
    ]
