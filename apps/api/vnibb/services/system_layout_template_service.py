"""System dashboard template registry backed by SQL key-value storage."""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.exc import SQLAlchemyError

from vnibb.core.database import async_session_maker
from vnibb.models.app_kv import AppKeyValue

logger = logging.getLogger(__name__)

SYSTEM_DASHBOARD_KEYS = (
    "default-fundamental",
    "default-technical",
    "default-quant",
    "default-global-markets",
)
SYSTEM_LAYOUT_STATUSES = ("draft", "published")
SYSTEM_LAYOUT_TEMPLATE_KEY_PREFIX = "system_layout_template"


class SystemLayoutTemplateRecord(BaseModel):
    dashboard_key: str
    status: Literal["draft", "published"]
    version: int = 1
    dashboard: dict[str, Any]
    notes: str | None = None
    updated_by: str | None = None
    updated_at: str
    published_at: str | None = None


class SystemLayoutTemplateListResponse(BaseModel):
    count: int
    data: list[SystemLayoutTemplateRecord]


class SystemLayoutTemplateUpsertRequest(BaseModel):
    dashboard: dict[str, Any]
    notes: str | None = Field(default=None, max_length=500)
    publish: bool = False


class SystemLayoutTemplateBundleResponse(BaseModel):
    dashboard_key: str
    draft: SystemLayoutTemplateRecord | None = None
    published: SystemLayoutTemplateRecord | None = None


class SystemLayoutTemplateService:

    def _normalize_dashboard_key(self, dashboard_key: str) -> str:
        normalized_dashboard_key = dashboard_key.strip().lower()
        if normalized_dashboard_key not in SYSTEM_DASHBOARD_KEYS:
            raise HTTPException(status_code=400, detail="Unsupported system dashboard key")
        return normalized_dashboard_key

    def _normalize_status(self, status_value: str) -> str:
        normalized_status = status_value.strip().lower()
        if normalized_status not in SYSTEM_LAYOUT_STATUSES:
            raise HTTPException(
                status_code=400, detail="Unsupported system dashboard template status"
            )
        return normalized_status

    def _kv_key(self, dashboard_key: str, status_value: str) -> str:
        normalized_dashboard_key = self._normalize_dashboard_key(dashboard_key)
        normalized_status = self._normalize_status(status_value)
        return f"{SYSTEM_LAYOUT_TEMPLATE_KEY_PREFIX}:{normalized_dashboard_key}:{normalized_status}"

    def _parse_sql_payload(self, payload: dict[str, Any]) -> SystemLayoutTemplateRecord:
        try:
            return SystemLayoutTemplateRecord(**payload)
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Stored system layout payload is invalid: {exc}",
            ) from exc

    async def _get_sql_record(
        self, dashboard_key: str, status_value: str
    ) -> SystemLayoutTemplateRecord | None:
        key = self._kv_key(dashboard_key, status_value)
        try:
            async with async_session_maker() as session:
                record = await session.get(AppKeyValue, key)
                if not record or not isinstance(record.value, dict):
                    return None
                return self._parse_sql_payload(record.value)
        except SQLAlchemyError as exc:
            logger.warning("System layout SQL read failed for %s: %s", key, exc)
            return None

    async def _save_sql_record(self, record: SystemLayoutTemplateRecord) -> None:
        key = self._kv_key(record.dashboard_key, record.status)
        payload = record.model_dump(mode="json")
        try:
            async with async_session_maker() as session:
                existing = await session.get(AppKeyValue, key)
                now = datetime.now(UTC).replace(tzinfo=None)
                if existing:
                    existing.value = payload
                    existing.updated_at = now
                else:
                    session.add(AppKeyValue(key=key, value=payload, updated_at=now))
                await session.commit()
        except SQLAlchemyError as exc:
            logger.warning("System layout SQL write failed for %s: %s", key, exc)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="System layout templates could not be saved to SQL storage",
            ) from exc

    async def _load_record(
        self, dashboard_key: str, status_value: str
    ) -> SystemLayoutTemplateRecord | None:
        return await self._get_sql_record(dashboard_key, status_value)

    async def list_published_templates(self) -> list[SystemLayoutTemplateRecord]:
        records: list[SystemLayoutTemplateRecord] = []
        for dashboard_key in SYSTEM_DASHBOARD_KEYS:
            record = await self._load_record(dashboard_key, "published")
            if record is not None:
                records.append(record)
        return records

    async def get_template_bundle(self, dashboard_key: str) -> SystemLayoutTemplateBundleResponse:
        normalized_dashboard_key = self._normalize_dashboard_key(dashboard_key)
        draft_record = await self._load_record(normalized_dashboard_key, "draft")
        published_record = await self._load_record(normalized_dashboard_key, "published")
        return SystemLayoutTemplateBundleResponse(
            dashboard_key=normalized_dashboard_key,
            draft=draft_record,
            published=published_record,
        )

    async def save_dashboard_template(
        self,
        *,
        dashboard_key: str,
        dashboard: dict[str, Any],
        notes: str | None,
        updated_by: str,
        publish: bool,
    ) -> SystemLayoutTemplateBundleResponse:
        normalized_dashboard_key = self._normalize_dashboard_key(dashboard_key)
        draft_record = await self._load_record(normalized_dashboard_key, "draft")
        published_record = await self._load_record(normalized_dashboard_key, "published")

        current_versions = [
            record.version for record in [draft_record, published_record] if record is not None
        ]
        next_version = (max(current_versions) if current_versions else 0) + 1
        now = datetime.now(UTC).isoformat()
        preserved_published_at = (
            draft_record.published_at if draft_record and draft_record.published_at else None
        ) or (
            published_record.published_at
            if published_record and published_record.published_at
            else None
        )

        next_draft = SystemLayoutTemplateRecord(
            dashboard_key=normalized_dashboard_key,
            status="draft",
            version=next_version,
            dashboard=dashboard,
            notes=notes,
            updated_by=updated_by,
            updated_at=now,
            published_at=preserved_published_at,
        )
        await self._save_sql_record(next_draft)

        if publish:
            next_published = SystemLayoutTemplateRecord(
                dashboard_key=normalized_dashboard_key,
                status="published",
                version=next_version,
                dashboard=dashboard,
                notes=notes,
                updated_by=updated_by,
                updated_at=now,
                published_at=now,
            )
            await self._save_sql_record(next_published)

        return await self.get_template_bundle(normalized_dashboard_key)


system_layout_template_service = SystemLayoutTemplateService()
