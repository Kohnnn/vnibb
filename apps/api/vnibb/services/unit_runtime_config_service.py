from __future__ import annotations

import logging
from datetime import UTC, datetime

from sqlalchemy.exc import SQLAlchemyError

from vnibb.core.database import async_session_maker
from vnibb.models.app_kv import AppKeyValue

logger = logging.getLogger(__name__)

UNIT_RUNTIME_CONFIG_KEY = "unit_runtime_config"
DEFAULT_USD_VND_RATE = 25_000.0


class UnitRuntimeConfigService:
    def __init__(self) -> None:
        self._memory_override: dict[str, float | str | None] | None = None

    def _normalize_rate(self, value: float | int | str | None) -> float:
        try:
            numeric = float(value)
        except (TypeError, ValueError):
            return DEFAULT_USD_VND_RATE

        if numeric <= 0:
            return DEFAULT_USD_VND_RATE
        return round(numeric, 4)

    def _default_config(self) -> dict[str, float | str | None]:
        return {
            "usd_vnd_default_rate": DEFAULT_USD_VND_RATE,
            "updated_at": None,
        }

    async def get_runtime_config(self) -> dict[str, float | str | None]:
        if self._memory_override is not None:
            return {
                **self._default_config(),
                **self._memory_override,
            }

        try:
            async with async_session_maker() as session:
                record = await session.get(AppKeyValue, UNIT_RUNTIME_CONFIG_KEY)
                if record and isinstance(record.value, dict):
                    self._memory_override = {
                        "usd_vnd_default_rate": self._normalize_rate(
                            record.value.get("usd_vnd_default_rate")
                        ),
                        "updated_at": str(record.value.get("updated_at") or "") or None,
                    }
        except SQLAlchemyError as exc:
            logger.warning("Unit runtime config read failed: %s", exc)

        return {
            **self._default_config(),
            **(self._memory_override or {}),
        }

    async def save_runtime_config(
        self, *, usd_vnd_default_rate: float
    ) -> dict[str, float | str | None]:
        normalized_rate = self._normalize_rate(usd_vnd_default_rate)
        now = datetime.now(UTC).isoformat()
        payload = {
            "usd_vnd_default_rate": normalized_rate,
            "updated_at": now,
        }
        self._memory_override = payload

        try:
            async with async_session_maker() as session:
                record = await session.get(AppKeyValue, UNIT_RUNTIME_CONFIG_KEY)
                if record:
                    record.value = payload
                    record.updated_at = datetime.now(UTC).replace(tzinfo=None)
                else:
                    session.add(
                        AppKeyValue(
                            key=UNIT_RUNTIME_CONFIG_KEY,
                            value=payload,
                            updated_at=datetime.now(UTC).replace(tzinfo=None),
                        )
                    )
                await session.commit()
        except SQLAlchemyError as exc:
            logger.warning("Unit runtime config write failed: %s", exc)

        return await self.get_runtime_config()


unit_runtime_config_service = UnitRuntimeConfigService()
