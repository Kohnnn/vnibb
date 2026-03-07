"""Lightweight Appwrite connectivity helpers for runtime checks."""

from __future__ import annotations

from typing import Any, Dict

import httpx

from vnibb.core.config import settings


def _mask(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}...{value[-4:]}"


def appwrite_runtime_summary() -> Dict[str, Any]:
    """Return non-sensitive Appwrite runtime configuration summary."""
    return {
        "configured": settings.is_appwrite_configured,
        "endpoint": settings.appwrite_endpoint,
        "project_id": _mask(settings.resolved_appwrite_project_id),
        "database_id": settings.appwrite_database_id,
    }


async def check_appwrite_connectivity(timeout_seconds: float = 3.0) -> Dict[str, Any]:
    """Validate Appwrite API reachability and database access using configured credentials."""
    summary = appwrite_runtime_summary()

    if not settings.is_appwrite_configured:
        return {
            "status": "not_configured",
            "message": "Appwrite credentials are incomplete",
            **summary,
        }

    endpoint = settings.appwrite_endpoint.rstrip("/")
    project_id = settings.resolved_appwrite_project_id
    api_key = settings.resolved_appwrite_api_key
    database_id = settings.appwrite_database_id

    if not endpoint or not project_id or not api_key or not database_id:
        return {
            "status": "not_configured",
            "message": "Missing Appwrite endpoint/project/api key/database ID",
            **summary,
        }

    url = f"{endpoint}/databases/{database_id}"
    headers = {
        "X-Appwrite-Project": project_id,
        "X-Appwrite-Key": api_key,
    }

    try:
        async with httpx.AsyncClient(timeout=timeout_seconds, follow_redirects=True) as client:
            response = await client.get(url, headers=headers)

        if 200 <= response.status_code < 300:
            return {
                "status": "connected",
                "http_status": response.status_code,
                **summary,
            }

        message = "Appwrite connectivity check failed"
        try:
            body = response.json()
            if isinstance(body, dict) and body.get("message"):
                message = str(body.get("message"))
        except Exception:
            pass

        return {
            "status": "error",
            "http_status": response.status_code,
            "message": message,
            **summary,
        }
    except Exception as exc:
        return {
            "status": "error",
            "message": str(exc),
            **summary,
        }
