from __future__ import annotations

import logging
from datetime import UTC, datetime

from sqlalchemy.exc import SQLAlchemyError

from vnibb.core.config import settings
from vnibb.core.database import async_session_maker
from vnibb.models.app_kv import AppKeyValue

logger = logging.getLogger(__name__)

AI_RUNTIME_CONFIG_KEY = "ai_runtime_config"


class AIRuntimeConfigService:
    def __init__(self) -> None:
        self._memory_override: dict[str, str] | None = None

    def _default_config(self) -> dict[str, str | None]:
        return {
            "provider": str(settings.llm_provider or "openrouter").strip().lower(),
            "model": str(settings.llm_model or "openai/gpt-4o-mini").strip(),
            "updated_at": None,
        }

    def _normalize_model(self, model: str | None) -> str:
        normalized = str(model or "").strip()
        if not normalized:
            return str(self._default_config()["model"])
        return normalized

    async def get_runtime_config(self) -> dict[str, str | None]:
        if self._memory_override is not None:
            return {
                **self._default_config(),
                **self._memory_override,
            }

        try:
            async with async_session_maker() as session:
                record = await session.get(AppKeyValue, AI_RUNTIME_CONFIG_KEY)
                if record and isinstance(record.value, dict):
                    self._memory_override = {
                        "provider": str(record.value.get("provider") or "openrouter")
                        .strip()
                        .lower(),
                        "model": self._normalize_model(record.value.get("model")),
                        "updated_at": str(record.value.get("updated_at") or "") or None,
                    }
        except SQLAlchemyError as exc:
            logger.warning("AI runtime config read failed: %s", exc)

        return {
            **self._default_config(),
            **(self._memory_override or {}),
        }

    async def save_runtime_config(self, *, model: str) -> dict[str, str | None]:
        normalized_model = self._normalize_model(model)
        now = datetime.now(UTC).isoformat()
        payload = {
            "provider": "openrouter",
            "model": normalized_model,
            "updated_at": now,
        }
        self._memory_override = payload

        try:
            async with async_session_maker() as session:
                record = await session.get(AppKeyValue, AI_RUNTIME_CONFIG_KEY)
                if record:
                    record.value = payload
                    record.updated_at = datetime.now(UTC).replace(tzinfo=None)
                else:
                    session.add(
                        AppKeyValue(
                            key=AI_RUNTIME_CONFIG_KEY,
                            value=payload,
                            updated_at=datetime.now(UTC).replace(tzinfo=None),
                        )
                    )
                await session.commit()
        except SQLAlchemyError as exc:
            logger.warning("AI runtime config write failed: %s", exc)

        return await self.get_runtime_config()


ai_runtime_config_service = AIRuntimeConfigService()
