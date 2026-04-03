from __future__ import annotations

import json

import pytest

from vnibb.core.config import settings
from vnibb.services.llm_service import LlmService, _render_validated_markdown


def test_resolve_request_config_uses_app_openrouter_defaults(monkeypatch):
    monkeypatch.setattr(settings, "openrouter_api_key", "app-openrouter-key")
    monkeypatch.setattr(settings, "openrouter_base_url", "https://openrouter.ai/api/v1")

    service = LlmService()
    config = service.resolve_request_config(
        {
            "provider": "openrouter",
            "mode": "app_default",
            "model": "openai/gpt-4o-mini",
        }
    )

    assert config == {
        "provider": "openrouter",
        "model": "openai/gpt-4o-mini",
        "api_key": "app-openrouter-key",
        "base_url": "https://openrouter.ai/api/v1",
        "mode": "app_default",
    }


def test_resolve_request_config_accepts_openai_compatible_browser_settings():
    service = LlmService()
    config = service.resolve_request_config(
        {
            "provider": "openai_compatible",
            "mode": "browser_key",
            "model": "gpt-4.1-mini",
            "apiKey": "browser-provider-key",
            "baseUrl": "https://api.openai.com/v1/",
        }
    )

    assert config == {
        "provider": "openai_compatible",
        "model": "gpt-4.1-mini",
        "api_key": "browser-provider-key",
        "base_url": "https://api.openai.com/v1",
        "mode": "browser_key",
    }


def test_resolve_request_config_rejects_openai_compatible_without_base_url():
    service = LlmService()

    with pytest.raises(RuntimeError, match="Add a base URL"):
        service.resolve_request_config(
            {
                "provider": "openai_compatible",
                "mode": "browser_key",
                "model": "gpt-4.1-mini",
                "apiKey": "browser-provider-key",
            }
        )


def test_resolve_request_config_rejects_openai_compatible_app_default_mode():
    service = LlmService()

    with pytest.raises(RuntimeError, match="browser-local API key"):
        service.resolve_request_config(
            {
                "provider": "openai_compatible",
                "mode": "app_default",
                "model": "gpt-4.1-mini",
                "apiKey": "browser-provider-key",
                "baseUrl": "https://api.openai.com/v1",
            }
        )


def test_build_messages_includes_citation_rules_and_source_catalog():
    service = LlmService()

    messages = service._build_messages(
        [{"role": "user", "content": "Analyze VNM"}],
        {
            "prefer_appwrite_data": True,
            "source_catalog": [
                {
                    "id": "VNM-PRICES",
                    "label": "Price history snapshot",
                    "source": "appwrite",
                },
                {
                    "id": "MKT-INDICES",
                    "label": "Market index snapshot",
                    "source": "appwrite",
                },
            ],
        },
        {"provider": "openrouter", "webSearch": False},
    )

    assert len(messages) >= 4
    assert "Return only valid JSON" in messages[1]["content"]
    assert "used_source_ids" in messages[1]["content"]
    assert "server will append a normalized Sources section" in messages[1]["content"]
    assert '"id": "VNM-PRICES"' in messages[2]["content"]
    assert messages[-1] == {"role": "user", "content": "Analyze VNM"}


def test_render_validated_markdown_filters_unknown_sources_and_appends_normalized_block():
    rendered = _render_validated_markdown(
        json.dumps(
            {
                "answer_markdown": "VNM remains above its recent base [VNM-PRICES].",
                "used_source_ids": ["VNM-PRICES", "UNKNOWN-SOURCE"],
            }
        ),
        {
            "source_catalog": [
                {
                    "id": "VNM-PRICES",
                    "label": "Price history snapshot",
                    "source": "appwrite",
                    "as_of": "2026-04-03",
                }
            ]
        },
    )

    assert rendered["used_source_ids"] == ["VNM-PRICES"]
    assert "## Sources" in rendered["final_markdown"]
    assert (
        "`[VNM-PRICES]` Price history snapshot (appwrite, as of 2026-04-03)"
        in rendered["final_markdown"]
    )


def test_render_validated_markdown_strips_model_sources_heading_and_uses_fallback_message():
    rendered = _render_validated_markdown(
        json.dumps(
            {
                "answer_markdown": "Summary body.\n\n## Sources\n- model supplied text",
                "used_source_ids": [],
            }
        ),
        {"source_catalog": []},
    )

    assert rendered["answer_markdown"] == "Summary body."
    assert rendered["used_source_ids"] == []
    assert rendered["final_markdown"].endswith("## Sources\n- No validated sources cited.")
