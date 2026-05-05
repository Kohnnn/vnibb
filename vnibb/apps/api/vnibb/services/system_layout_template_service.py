"""System dashboard template registry with SQL primary storage and optional Appwrite mirroring."""

from __future__ import annotations

import base64
import json
import logging
import re
import zlib
from datetime import UTC, datetime
from typing import Any, Literal

import httpx
from fastapi import HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.exc import SQLAlchemyError

from vnibb.core.config import settings
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
DOC_ID_RE = re.compile(r"[^a-z0-9_-]+")
SYSTEM_DASHBOARD_KEY_ALIASES = {
    "default-fundamental": "fundamental",
    "default-technical": "technical",
    "default-quant": "quant",
    "default-global-markets": "global-markets",
}
SYSTEM_LAYOUT_STATUS_ALIASES = {
    "draft": "dr",
    "published": "pub",
}
SYSTEM_LAYOUT_TEMPLATE_KEY_PREFIX = "system_layout_template"
COMPRESSED_DASHBOARD_PREFIX = "gz:"


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
    def __init__(self) -> None:
        self._base_url = (settings.appwrite_endpoint or "").rstrip("/")
        self._database_id = settings.appwrite_database_id
        self._collection_id = settings.appwrite_system_templates_collection_id
        self._project_id = settings.resolved_appwrite_project_id
        self._api_key = settings.resolved_appwrite_api_key

    def is_configured(self) -> bool:
        return bool(
            self._base_url
            and self._database_id
            and self._collection_id
            and self._project_id
            and self._api_key
        )

    def _appwrite_writes_enabled(self) -> bool:
        return self.is_configured() and settings.appwrite_writes_active

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

    def _headers(self) -> dict[str, str]:
        if not self.is_configured():
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="System layout templates require Appwrite collection configuration",
            )
        return {
            "X-Appwrite-Project": self._project_id or "",
            "X-Appwrite-Key": self._api_key or "",
            "Content-Type": "application/json",
        }

    def _document_id(self, dashboard_key: str, status_value: str) -> str:
        normalized_dashboard_key = self._normalize_dashboard_key(dashboard_key)
        normalized_status = self._normalize_status(status_value)
        safe_key = SYSTEM_DASHBOARD_KEY_ALIASES.get(
            normalized_dashboard_key,
            DOC_ID_RE.sub("-", normalized_dashboard_key).strip("-")[:20],
        )
        safe_status = SYSTEM_LAYOUT_STATUS_ALIASES[normalized_status]
        return f"slt-{safe_status}-{safe_key}"

    def _kv_key(self, dashboard_key: str, status_value: str) -> str:
        normalized_dashboard_key = self._normalize_dashboard_key(dashboard_key)
        normalized_status = self._normalize_status(status_value)
        return f"{SYSTEM_LAYOUT_TEMPLATE_KEY_PREFIX}:{normalized_dashboard_key}:{normalized_status}"

    def _documents_url(self) -> str:
        if not self.is_configured():
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="System layout templates require Appwrite collection configuration",
            )
        return f"{self._base_url}/databases/{self._database_id}/collections/{self._collection_id}/documents"

    async def _get_document(self, document_id: str) -> dict[str, Any] | None:
        url = f"{self._documents_url()}/{document_id}"
        timeout = httpx.Timeout(20.0, connect=10.0)
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            response = await client.get(url, headers=self._headers())
        if response.status_code == 404:
            return None
        response.raise_for_status()
        return response.json()

    async def _upsert_document(self, document_id: str, data: dict[str, Any]) -> dict[str, Any]:
        create_payload = {"documentId": document_id, "data": self._clean_document_data(data)}
        timeout = httpx.Timeout(20.0, connect=10.0)
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            create_response = await client.post(
                self._documents_url(), headers=self._headers(), json=create_payload
            )
            if create_response.status_code < 300:
                return create_response.json()
            if create_response.status_code != 409:
                self._raise_appwrite_error(create_response)

            update_response = await client.patch(
                f"{self._documents_url()}/{document_id}",
                headers=self._headers(),
                json={"data": self._clean_document_data(data)},
            )
            if update_response.status_code >= 300:
                self._raise_appwrite_error(update_response)
            return update_response.json()

    def _clean_document_data(self, data: dict[str, Any]) -> dict[str, Any]:
        return {key: value for key, value in data.items() if value is not None}

    def _serialize_dashboard_json(self, dashboard: dict[str, Any]) -> str:
        raw_json = json.dumps(dashboard, ensure_ascii=True, separators=(",", ":"))
        compressed_json = COMPRESSED_DASHBOARD_PREFIX + base64.urlsafe_b64encode(
            zlib.compress(raw_json.encode("utf-8"), level=9)
        ).decode("ascii")
        payload = compressed_json if len(compressed_json) < len(raw_json) else raw_json
        if len(payload) > 65535:
            raise HTTPException(
                status_code=400,
                detail=(
                    "system layout payload too large for Appwrite dashboard_json field "
                    f"({len(payload)} chars)"
                ),
            )
        return payload

    def _deserialize_dashboard_json(self, data: str) -> dict[str, Any]:
        payload = data or "{}"
        if payload.startswith(COMPRESSED_DASHBOARD_PREFIX):
            compressed = payload[len(COMPRESSED_DASHBOARD_PREFIX) :]
            try:
                return json.loads(
                    zlib.decompress(base64.urlsafe_b64decode(compressed.encode("ascii"))).decode(
                        "utf-8"
                    )
                )
            except Exception as exc:
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to decode compressed dashboard template: {exc}",
                ) from exc
        return json.loads(payload)

    def _raise_appwrite_error(self, response: httpx.Response) -> None:
        message = response.text[:500] or response.reason_phrase or "Appwrite request failed"
        try:
            payload = response.json()
            message = (
                payload.get("message") or payload.get("detail") or payload.get("error") or message
            )
        except Exception:
            pass
        raise HTTPException(
            status_code=response.status_code, detail=f"Appwrite template save failed: {message}"
        )

    def _parse_appwrite_document(self, payload: dict[str, Any]) -> SystemLayoutTemplateRecord:
        data = payload.get("dashboard_json") or "{}"
        dashboard = self._deserialize_dashboard_json(data)
        return SystemLayoutTemplateRecord(
            dashboard_key=str(payload.get("dashboard_key") or "").strip(),
            status=str(payload.get("status") or "published").strip().lower(),
            version=int(payload.get("version") or 1),
            dashboard=dashboard,
            notes=payload.get("notes"),
            updated_by=payload.get("updated_by"),
            updated_at=str(payload.get("updated_at") or datetime.now(UTC).isoformat()),
            published_at=payload.get("published_at"),
        )

    def _parse_sql_payload(self, payload: dict[str, Any]) -> SystemLayoutTemplateRecord:
        try:
            return SystemLayoutTemplateRecord(**payload)
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Stored system layout payload is invalid: {exc}",
            ) from exc

    def _record_to_appwrite_payload(self, record: SystemLayoutTemplateRecord) -> dict[str, Any]:
        return {
            "dashboard_key": record.dashboard_key,
            "status": record.status,
            "version": record.version,
            "dashboard_json": self._serialize_dashboard_json(record.dashboard),
            "notes": record.notes,
            "updated_by": record.updated_by,
            "updated_at": record.updated_at,
            "published_at": record.published_at,
        }

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

    async def _get_appwrite_record(
        self, dashboard_key: str, status_value: str
    ) -> SystemLayoutTemplateRecord | None:
        if not self.is_configured():
            return None
        try:
            payload = await self._get_document(self._document_id(dashboard_key, status_value))
        except Exception as exc:
            logger.warning(
                "Unable to fetch Appwrite system layout for %s/%s: %s",
                dashboard_key,
                status_value,
                exc,
            )
            return None
        if payload is None:
            return None
        return self._parse_appwrite_document(payload)

    async def _load_record(
        self, dashboard_key: str, status_value: str
    ) -> SystemLayoutTemplateRecord | None:
        record = await self._get_sql_record(dashboard_key, status_value)
        if record is not None:
            return record

        record = await self._get_appwrite_record(dashboard_key, status_value)
        if record is not None:
            await self._save_sql_record(record)
        return record

    async def _mirror_record_to_appwrite(self, record: SystemLayoutTemplateRecord) -> None:
        if not self._appwrite_writes_enabled():
            return
        try:
            await self._upsert_document(
                self._document_id(record.dashboard_key, record.status),
                self._record_to_appwrite_payload(record),
            )
        except Exception as exc:
            logger.warning(
                "Appwrite system layout mirror failed for %s/%s: %s",
                record.dashboard_key,
                record.status,
                exc,
            )

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
        await self._mirror_record_to_appwrite(next_draft)

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
            await self._mirror_record_to_appwrite(next_published)

        return await self.get_template_bundle(normalized_dashboard_key)


system_layout_template_service = SystemLayoutTemplateService()
