"""Appwrite-backed system dashboard template registry."""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, Literal

import httpx
from fastapi import HTTPException, status
from pydantic import BaseModel, Field

from vnibb.core.config import settings

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

    def _assert_configured(self) -> None:
        if self.is_configured():
            return
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="System layout templates require Appwrite collection configuration",
        )

    def _headers(self) -> dict[str, str]:
        self._assert_configured()
        return {
            "X-Appwrite-Project": self._project_id or "",
            "X-Appwrite-Key": self._api_key or "",
            "Content-Type": "application/json",
        }

    def _document_id(self, dashboard_key: str, status_value: str) -> str:
        normalized_dashboard_key = dashboard_key.strip().lower()
        if normalized_dashboard_key not in SYSTEM_DASHBOARD_KEYS:
            raise HTTPException(status_code=400, detail="Unsupported system dashboard key")
        normalized_status = status_value.strip().lower()
        if normalized_status not in SYSTEM_LAYOUT_STATUSES:
            raise HTTPException(status_code=400, detail="Unsupported system dashboard template status")
        safe_key = SYSTEM_DASHBOARD_KEY_ALIASES.get(
            normalized_dashboard_key,
            DOC_ID_RE.sub("-", normalized_dashboard_key).strip("-")[:20],
        )
        safe_status = SYSTEM_LAYOUT_STATUS_ALIASES[normalized_status]
        return f"slt-{safe_status}-{safe_key}"

    def _documents_url(self) -> str:
        self._assert_configured()
        return f"{self._base_url}/databases/{self._database_id}/collections/{self._collection_id}/documents"

    async def _get_document(self, document_id: str) -> dict[str, Any] | None:
        self._assert_configured()
        url = f"{self._documents_url()}/{document_id}"
        timeout = httpx.Timeout(20.0, connect=10.0)
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            response = await client.get(url, headers=self._headers())
        if response.status_code == 404:
            return None
        response.raise_for_status()
        return response.json()

    async def _upsert_document(self, document_id: str, data: dict[str, Any]) -> dict[str, Any]:
        self._assert_configured()
        create_payload = {"documentId": document_id, "data": data}
        timeout = httpx.Timeout(20.0, connect=10.0)
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            create_response = await client.post(self._documents_url(), headers=self._headers(), json=create_payload)
            if create_response.status_code < 300:
                return create_response.json()
            if create_response.status_code != 409:
                create_response.raise_for_status()

            update_response = await client.patch(
                f"{self._documents_url()}/{document_id}",
                headers=self._headers(),
                json={"data": data},
            )
            update_response.raise_for_status()
            return update_response.json()

    def _parse_document(self, payload: dict[str, Any]) -> SystemLayoutTemplateRecord:
        data = payload.get("dashboard_json") or "{}"
        dashboard = json.loads(data)
        return SystemLayoutTemplateRecord(
            dashboard_key=str(payload.get("dashboard_key") or "").strip(),
            status=str(payload.get("status") or "published").strip().lower(),
            version=int(payload.get("version") or 1),
            dashboard=dashboard,
            notes=payload.get("notes"),
            updated_by=payload.get("updated_by"),
            updated_at=str(payload.get("updated_at") or datetime.now(timezone.utc).isoformat()),
            published_at=payload.get("published_at"),
        )

    async def list_published_templates(self) -> list[SystemLayoutTemplateRecord]:
        if not self.is_configured():
            return []

        records: list[SystemLayoutTemplateRecord] = []
        for dashboard_key in SYSTEM_DASHBOARD_KEYS:
            try:
                payload = await self._get_document(self._document_id(dashboard_key, "published"))
            except Exception as exc:
                logger.warning("Unable to fetch published system layout for %s: %s", dashboard_key, exc)
                continue
            if payload is None:
                continue
            records.append(self._parse_document(payload))
        return records

    async def get_template_bundle(self, dashboard_key: str) -> SystemLayoutTemplateBundleResponse:
        self._assert_configured()
        draft_payload = await self._get_document(self._document_id(dashboard_key, "draft"))
        published_payload = await self._get_document(self._document_id(dashboard_key, "published"))
        return SystemLayoutTemplateBundleResponse(
            dashboard_key=dashboard_key,
            draft=self._parse_document(draft_payload) if draft_payload else None,
            published=self._parse_document(published_payload) if published_payload else None,
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
        self._assert_configured()
        draft_payload = await self._get_document(self._document_id(dashboard_key, "draft"))
        published_payload = await self._get_document(self._document_id(dashboard_key, "published"))

        current_versions = [
            int(payload.get("version") or 0)
            for payload in [draft_payload, published_payload]
            if payload is not None
        ]
        next_version = (max(current_versions) if current_versions else 0) + 1
        now = datetime.now(timezone.utc).isoformat()
        dashboard_json = json.dumps(dashboard, ensure_ascii=True)

        draft_data = {
            "dashboard_key": dashboard_key,
            "status": "draft",
            "version": next_version,
            "dashboard_json": dashboard_json,
            "notes": notes,
            "updated_by": updated_by,
            "updated_at": now,
            "published_at": draft_payload.get("published_at") if draft_payload else None,
        }
        await self._upsert_document(self._document_id(dashboard_key, "draft"), draft_data)

        if publish:
            published_data = {
                "dashboard_key": dashboard_key,
                "status": "published",
                "version": next_version,
                "dashboard_json": dashboard_json,
                "notes": notes,
                "updated_by": updated_by,
                "updated_at": now,
                "published_at": now,
            }
            await self._upsert_document(self._document_id(dashboard_key, "published"), published_data)

        return await self.get_template_bundle(dashboard_key)


system_layout_template_service = SystemLayoutTemplateService()
