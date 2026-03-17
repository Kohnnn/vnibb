"""Lightweight Appwrite connectivity helpers for runtime checks."""

from __future__ import annotations

import json
from datetime import date, datetime
from typing import Any

import httpx

from vnibb.core.config import settings


def _mask(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}...{value[-4:]}"


def appwrite_runtime_summary() -> dict[str, Any]:
    """Return non-sensitive Appwrite runtime configuration summary."""
    return {
        "configured": settings.is_appwrite_configured,
        "endpoint": settings.appwrite_endpoint,
        "project_id": _mask(settings.resolved_appwrite_project_id),
        "database_id": settings.appwrite_database_id,
    }


def _appwrite_endpoint() -> str | None:
    if not settings.appwrite_endpoint:
        return None
    return settings.appwrite_endpoint.rstrip("/")


def _appwrite_headers() -> dict[str, str]:
    project_id = settings.resolved_appwrite_project_id
    api_key = settings.resolved_appwrite_api_key
    if not project_id or not api_key:
        raise RuntimeError("Appwrite credentials are incomplete")

    return {
        "X-Appwrite-Project": project_id,
        "X-Appwrite-Key": api_key,
    }


def _query_equal(attribute: str, values: list[Any]) -> dict[str, Any]:
    return {"method": "equal", "attribute": attribute, "values": values}


def _query_limit(value: int) -> dict[str, Any]:
    return {"method": "limit", "values": [int(value)]}


def _query_offset(value: int) -> dict[str, Any]:
    return {"method": "offset", "values": [int(value)]}


def _query_order(attribute: str, descending: bool = False) -> dict[str, Any]:
    return {"method": "orderDesc" if descending else "orderAsc", "attribute": attribute}


def _query_gte(attribute: str, value: str) -> dict[str, Any]:
    return {"method": "greaterThanEqual", "attribute": attribute, "values": [value]}


def _query_lte(attribute: str, value: str) -> dict[str, Any]:
    return {"method": "lessThanEqual", "attribute": attribute, "values": [value]}


def _date_start_iso(value: date) -> str:
    return datetime.combine(value, datetime.min.time()).isoformat(timespec="milliseconds") + "Z"


def _date_end_iso(value: date) -> str:
    return datetime.combine(value, datetime.max.time()).isoformat(timespec="milliseconds") + "Z"


async def list_appwrite_documents(
    collection_id: str,
    queries: list[dict[str, Any]] | None = None,
    timeout_seconds: float = 8.0,
) -> list[dict[str, Any]]:
    """List documents from an Appwrite collection using raw REST queries."""
    if not settings.is_appwrite_configured:
        return []

    endpoint = _appwrite_endpoint()
    database_id = settings.appwrite_database_id
    if not endpoint or not database_id:
        return []

    url = f"{endpoint}/databases/{database_id}/collections/{collection_id}/documents"
    params = [("queries[]", json.dumps(query)) for query in (queries or [])]

    async with httpx.AsyncClient(timeout=timeout_seconds, follow_redirects=True) as client:
        response = await client.get(url, headers=_appwrite_headers(), params=params)

    response.raise_for_status()
    payload = response.json()
    documents = payload.get("documents")
    if isinstance(documents, list):
        return documents
    return []


def _strip_pagination_queries(queries: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    if not queries:
        return []
    return [
        query
        for query in queries
        if (query.get("method") or "") not in {"limit", "offset", "cursorAfter"}
    ]


async def list_appwrite_documents_paginated(
    collection_id: str,
    queries: list[dict[str, Any]] | None = None,
    *,
    page_size: int = 250,
    max_documents: int | None = None,
    timeout_seconds: float = 8.0,
) -> list[dict[str, Any]]:
    collected: list[dict[str, Any]] = []
    offset = 0
    normalized_page_size = max(1, page_size)
    base_queries = _strip_pagination_queries(queries)

    while True:
        remaining = None if max_documents is None else max_documents - len(collected)
        if remaining is not None and remaining <= 0:
            break

        window = normalized_page_size if remaining is None else min(normalized_page_size, remaining)
        page = await list_appwrite_documents(
            collection_id,
            queries=base_queries + [_query_limit(window), _query_offset(offset)],
            timeout_seconds=timeout_seconds,
        )
        if not page:
            break

        collected.extend(page)
        offset += len(page)

        if len(page) < window:
            break

    return collected


async def get_appwrite_stock(symbol: str) -> dict[str, Any] | None:
    """Fetch a single stock master document by symbol."""
    docs = await list_appwrite_documents(
        "stocks",
        queries=[
            _query_equal("symbol", [symbol.upper()]),
            _query_limit(1),
        ],
    )
    return docs[0] if docs else None


async def list_appwrite_stock_documents(
    *,
    active_only: bool = True,
    limit: int | None = None,
) -> list[dict[str, Any]]:
    docs = await list_appwrite_documents_paginated(
        "stocks",
        queries=[_query_order("symbol")],
        page_size=250,
        max_documents=limit,
    )
    if not active_only:
        return docs

    filtered: list[dict[str, Any]] = []
    for doc in docs:
        raw_value = doc.get("is_active")
        normalized = str(raw_value).strip().lower()
        if normalized in {"0", "false", "none", "null", ""}:
            continue
        filtered.append(doc)
    return filtered


async def list_appwrite_stock_symbols(
    *,
    active_only: bool = True,
    limit: int | None = None,
) -> list[str]:
    docs = await list_appwrite_stock_documents(active_only=active_only, limit=limit)
    symbols = [str(doc.get("symbol") or "").strip().upper() for doc in docs]
    return [symbol for symbol in symbols if symbol]


def _dedupe_appwrite_stock_price_documents(
    docs: list[dict[str, Any]],
    *,
    descending: bool,
    limit: int | None,
) -> list[dict[str, Any]]:
    deduped: dict[tuple[str, str, str], dict[str, Any]] = {}

    for doc in docs:
        key = (
            str(doc.get("symbol") or "").strip().upper(),
            str(doc.get("time") or "").strip(),
            str(doc.get("interval") or "1D").strip().upper(),
        )
        existing = deduped.get(key)
        if existing is None:
            deduped[key] = doc
            continue

        existing_sequence = int(existing.get("$sequence") or 0)
        current_sequence = int(doc.get("$sequence") or 0)
        existing_updated = str(existing.get("$updatedAt") or "")
        current_updated = str(doc.get("$updatedAt") or "")

        if (current_updated, current_sequence) >= (existing_updated, existing_sequence):
            deduped[key] = doc

    rows = list(deduped.values())
    rows.sort(key=lambda item: str(item.get("time") or ""), reverse=descending)
    if limit is not None:
        return rows[:limit]
    return rows


async def get_appwrite_stock_prices(
    symbol: str,
    *,
    interval: str = "1D",
    start_date: date | None = None,
    end_date: date | None = None,
    limit: int = 250,
    descending: bool = False,
) -> list[dict[str, Any]]:
    """Fetch stock price documents for a symbol/date window."""
    queries: list[dict[str, Any]] = [
        _query_equal("symbol", [symbol.upper()]),
        _query_equal("interval", [interval]),
        _query_order("time", descending=descending),
    ]

    if start_date is not None:
        queries.append(_query_gte("time", _date_start_iso(start_date)))
    if end_date is not None:
        queries.append(_query_lte("time", _date_end_iso(end_date)))

    raw_limit = max(limit * 3, limit + 20) if limit is not None else None
    docs = await list_appwrite_documents_paginated(
        "stock_prices",
        queries=queries,
        page_size=min(max(limit, 1), 250),
        max_documents=raw_limit,
    )
    return _dedupe_appwrite_stock_price_documents(docs, descending=descending, limit=limit)


async def get_appwrite_stock_price_coverage(
    symbol: str,
    *,
    interval: str = "1D",
) -> tuple[str | None, str | None]:
    base_queries = [
        _query_equal("symbol", [symbol.upper()]),
        _query_equal("interval", [interval]),
    ]
    earliest_docs = await list_appwrite_documents(
        "stock_prices",
        queries=base_queries + [_query_order("time"), _query_limit(1)],
    )
    latest_docs = await list_appwrite_documents(
        "stock_prices",
        queries=base_queries + [_query_order("time", descending=True), _query_limit(1)],
    )
    earliest = earliest_docs[0].get("time") if earliest_docs else None
    latest = latest_docs[0].get("time") if latest_docs else None
    return earliest, latest


async def check_appwrite_connectivity(timeout_seconds: float = 3.0) -> dict[str, Any]:
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
