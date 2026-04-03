from __future__ import annotations

import pytest

from vnibb.core.config import settings
from vnibb.services.llm_service import LlmService


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
