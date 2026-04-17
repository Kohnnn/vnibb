from __future__ import annotations

import logging
import re
from datetime import UTC, datetime

from sqlalchemy.exc import SQLAlchemyError

from vnibb.core.database import async_session_maker
from vnibb.models.app_kv import AppKeyValue

logger = logging.getLogger(__name__)

UNIT_RUNTIME_CONFIG_KEY = "unit_runtime_config"
DEFAULT_USD_VND_RATE = 25_000.0
YEAR_KEY_RE = re.compile(r"^20\d{2}$")


class UnitRuntimeConfigService:
    def __init__(self) -> None:
        self._memory_override: dict[str, float | str | dict[str, float] | None] | None = None

    def _parse_positive_rate(self, value: float | int | str | None) -> float | None:
        try:
            numeric = float(value)
        except (TypeError, ValueError):
            return None

        if numeric <= 0:
            return None
        return round(numeric, 4)

    def _normalize_default_rate(self, value: float | int | str | None) -> float:
        return self._parse_positive_rate(value) or DEFAULT_USD_VND_RATE

    def _normalize_rates_by_year(self, value: object) -> dict[str, float]:
        if not isinstance(value, dict):
            return {}

        normalized: dict[str, float] = {}
        for raw_year, raw_rate in value.items():
            year = str(raw_year).strip()
            if not YEAR_KEY_RE.fullmatch(year):
                continue
            parsed_rate = self._parse_positive_rate(raw_rate)
            if parsed_rate is None:
                continue
            normalized[year] = parsed_rate
        return normalized

    def _default_config(self) -> dict[str, float | str | dict[str, float] | None]:
        return {
            "usd_vnd_default_rate": DEFAULT_USD_VND_RATE,
            "usd_vnd_rates_by_year": {},
            "updated_at": None,
        }

    async def get_runtime_config(self) -> dict[str, float | str | dict[str, float] | None]:
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
                        "usd_vnd_default_rate": self._normalize_default_rate(
                            record.value.get("usd_vnd_default_rate")
                        ),
                        "usd_vnd_rates_by_year": self._normalize_rates_by_year(
                            record.value.get("usd_vnd_rates_by_year")
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
        self,
        *,
        usd_vnd_default_rate: float,
        usd_vnd_rates_by_year: dict[str, float] | None = None,
    ) -> dict[str, float | str | dict[str, float] | None]:
        normalized_rate = self._normalize_default_rate(usd_vnd_default_rate)
        normalized_rates_by_year = self._normalize_rates_by_year(usd_vnd_rates_by_year or {})
        now = datetime.now(UTC).isoformat()
        payload = {
            "usd_vnd_default_rate": normalized_rate,
            "usd_vnd_rates_by_year": normalized_rates_by_year,
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
