from __future__ import annotations

import logging
import time
from typing import Any

import httpx

from vnibb.core.config import settings

logger = logging.getLogger(__name__)

OPENROUTER_MODEL_FALLBACKS: list[dict[str, Any]] = [
    {
        "id": "openai/gpt-4o-mini",
        "name": "GPT-4o Mini",
        "provider": "openrouter",
        "description": "Fast balanced general model for most VniAgent tasks.",
        "recommended": True,
        "tier": "balanced",
    },
    {
        "id": "openai/gpt-4.1-mini",
        "name": "GPT-4.1 Mini",
        "provider": "openrouter",
        "description": "Fast reasoning model with strong tool and instruction following.",
        "recommended": True,
        "tier": "fast",
    },
    {
        "id": "anthropic/claude-3.5-haiku",
        "name": "Claude 3.5 Haiku",
        "provider": "openrouter",
        "description": "Low-latency option for quick workspace assistance.",
        "recommended": True,
        "tier": "fast",
    },
    {
        "id": "anthropic/claude-3.7-sonnet",
        "name": "Claude 3.7 Sonnet",
        "provider": "openrouter",
        "description": "Deeper reasoning model for richer analysis.",
        "recommended": True,
        "tier": "deep",
    },
    {
        "id": "google/gemini-2.5-flash",
        "name": "Gemini 2.5 Flash",
        "provider": "openrouter",
        "description": "Fast multimodal model available through OpenRouter.",
        "recommended": False,
        "tier": "fast",
    },
]


class AIModelCatalogService:
    def __init__(self) -> None:
        self._openrouter_cache: dict[str, Any] | None = None

    async def get_openrouter_models(self) -> list[dict[str, Any]]:
        now = time.time()
        if self._openrouter_cache and now - self._openrouter_cache["timestamp"] < 1800:
            return self._openrouter_cache["models"]

        models = await self._fetch_openrouter_models()
        self._openrouter_cache = {
            "timestamp": now,
            "models": models,
        }
        return models

    async def _fetch_openrouter_models(self) -> list[dict[str, Any]]:
        timeout = httpx.Timeout(10.0, connect=5.0)
        headers = {"Content-Type": "application/json"}
        if settings.openrouter_api_key:
            headers["Authorization"] = f"Bearer {settings.openrouter_api_key}"

        try:
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
                response = await client.get(
                    f"{settings.openrouter_base_url.rstrip('/')}/models", headers=headers
                )
            if response.status_code >= 400:
                raise RuntimeError(response.text[:300] or response.reason_phrase)
            payload = response.json()
            data = payload.get("data") if isinstance(payload, dict) else []
            if not isinstance(data, list):
                raise RuntimeError("Unexpected OpenRouter model response")

            recommended_map = {item["id"]: item for item in OPENROUTER_MODEL_FALLBACKS}
            models: list[dict[str, Any]] = []
            for item in data:
                if not isinstance(item, dict):
                    continue
                model_id = str(item.get("id") or "").strip()
                if not model_id:
                    continue
                preset = recommended_map.get(model_id, {})
                models.append(
                    {
                        "id": model_id,
                        "name": str(item.get("name") or preset.get("name") or model_id),
                        "provider": "openrouter",
                        "description": str(
                            item.get("description") or preset.get("description") or ""
                        ).strip()
                        or None,
                        "recommended": bool(preset.get("recommended", False)),
                        "tier": preset.get("tier") or "other",
                        "context_length": item.get("context_length"),
                    }
                )

            fallback_ids = {item["id"] for item in models}
            for fallback in OPENROUTER_MODEL_FALLBACKS:
                if fallback["id"] not in fallback_ids:
                    models.append(dict(fallback))

            return sorted(
                models,
                key=lambda item: (
                    not bool(item.get("recommended")),
                    str(item.get("name") or item["id"]),
                ),
            )
        except Exception as exc:
            logger.warning("OpenRouter model catalog fetch failed: %s", exc)
            return [dict(item) for item in OPENROUTER_MODEL_FALLBACKS]


ai_model_catalog_service = AIModelCatalogService()
