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
        "is_free": False,
    },
    {
        "id": "openai/gpt-4.1-mini",
        "name": "GPT-4.1 Mini",
        "provider": "openrouter",
        "description": "Fast reasoning model with strong tool and instruction following.",
        "recommended": True,
        "tier": "fast",
        "is_free": False,
    },
    {
        "id": "anthropic/claude-3.5-haiku",
        "name": "Claude 3.5 Haiku",
        "provider": "openrouter",
        "description": "Low-latency option for quick workspace assistance.",
        "recommended": True,
        "tier": "fast",
        "is_free": False,
    },
    {
        "id": "anthropic/claude-3.7-sonnet",
        "name": "Claude 3.7 Sonnet",
        "provider": "openrouter",
        "description": "Deeper reasoning model for richer analysis.",
        "recommended": True,
        "tier": "deep",
        "is_free": False,
    },
    {
        "id": "google/gemini-2.5-flash",
        "name": "Gemini 2.5 Flash",
        "provider": "openrouter",
        "description": "Fast multimodal model available through OpenRouter.",
        "recommended": False,
        "tier": "fast",
        "is_free": False,
    },
]

OPENROUTER_FREE_MODELS_URL = "https://openrouter.ai/collections/free-models"


def _is_free_model(item: dict[str, Any]) -> bool:
    pricing = item.get("pricing")
    if not isinstance(pricing, dict):
        return False
    prompt = str(pricing.get("prompt") or "").strip()
    completion = str(pricing.get("completion") or "").strip()
    return prompt in {"0", "0.0", "0.00"} and completion in {"0", "0.0", "0.00"}


class AIModelCatalogService:
    def __init__(self) -> None:
        self._openrouter_cache: dict[str, Any] | None = None

    async def get_openrouter_models(self) -> list[dict[str, Any]]:
        now = time.time()
        if self._openrouter_cache and now - self._openrouter_cache["timestamp"] < 1800:
            return self._openrouter_cache["models"]

        models = await self._fetch_openrouter_models()
        if not self._openrouter_cache:
            self._openrouter_cache = {
                "timestamp": now,
                "models": models,
                "source": "unknown",
            }
        return self._openrouter_cache["models"]

    async def get_openrouter_status(self) -> dict[str, Any]:
        models = await self.get_openrouter_models()
        cache_source = self._openrouter_cache.get("source") if self._openrouter_cache else "unknown"
        return {
            "configured": bool(settings.openrouter_api_key),
            "reachable": cache_source == "live",
            "catalog_source": cache_source,
            "model_count": len(models),
            "free_model_count": sum(1 for model in models if model.get("is_free")),
            "free_models_url": OPENROUTER_FREE_MODELS_URL,
        }

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
                        "is_free": _is_free_model(item) or bool(preset.get("is_free", False)),
                        "pricing": item.get("pricing")
                        if isinstance(item.get("pricing"), dict)
                        else None,
                    }
                )

            fallback_ids = {item["id"] for item in models}
            for fallback in OPENROUTER_MODEL_FALLBACKS:
                if fallback["id"] not in fallback_ids:
                    models.append(dict(fallback))

            sorted_models = sorted(
                models,
                key=lambda item: (
                    not bool(item.get("is_free")),
                    not bool(item.get("recommended")),
                    str(item.get("name") or item["id"]),
                ),
            )
            self._openrouter_cache = {
                "timestamp": time.time(),
                "models": sorted_models,
                "source": "live",
            }
            return sorted_models
        except Exception as exc:
            logger.warning("OpenRouter model catalog fetch failed: %s", exc)
            fallback_models = [dict(item) for item in OPENROUTER_MODEL_FALLBACKS]
            self._openrouter_cache = {
                "timestamp": time.time(),
                "models": fallback_models,
                "source": "fallback",
            }
            return fallback_models


ai_model_catalog_service = AIModelCatalogService()
