"""Appwrite population helpers for Appwrite-first sync flows."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import shutil
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import httpx
from sqlalchemy import text

from vnibb.core.config import settings
from vnibb.core.database import async_session_maker

logger = logging.getLogger(__name__)

PRIMARY_APPWRITE_TABLES: tuple[str, ...] = (
    "stocks",
    "stock_prices",
    "income_statements",
    "balance_sheets",
    "cash_flows",
    "financial_ratios",
)
FULL_REFRESH_TABLES = frozenset({"stocks"})


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def _normalize_tables(tables: Sequence[str]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()

    for table in tables:
        value = str(table).strip()
        if not value or value in seen:
            continue
        normalized.append(value)
        seen.add(value)

    return normalized


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default

    try:
        return int(raw)
    except ValueError:
        logger.warning("Invalid %s=%s, using default=%s", name, raw, default)
        return default


def _env_flag(name: str, default: bool = False) -> bool:
    raw = os.getenv(name, "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def _coerce_cursor(value: str | None) -> str | int | None:
    if value is None or value == "":
        return None
    if value.isdigit():
        return int(value)
    return value


def _quote_identifier(name: str) -> str:
    if not name.replace("_", "").isalnum() or not (name[0].isalpha() or name[0] == "_"):
        raise ValueError(f"Unsafe SQL identifier: {name}")
    return f'"{name}"'


def _schema_map_path() -> Path:
    return _repo_root() / "scripts" / "appwrite" / "schema-map.example.json"


def _state_path() -> Path:
    return _repo_root() / "scripts" / "appwrite" / "migration_state.json"


def _load_schema_map() -> dict[str, Any]:
    return json.loads(_schema_map_path().read_text(encoding="utf-8"))


def _load_state() -> dict[str, Any]:
    path = _state_path()
    if not path.exists():
        return {"tables": {}}
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"tables": {}}
    parsed.setdefault("tables", {})
    return parsed


def _save_state(state: dict[str, Any]) -> None:
    path = _state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2), encoding="utf-8")


def _normalize_value(
    value: Any,
    key: str,
    precision_columns: set[str],
    coerce_all_to_string: bool,
) -> Any:
    if value is None:
        return None
    if isinstance(value, (bytes, bytearray)):
        raw = value.hex()
        return raw if coerce_all_to_string else raw
    if hasattr(value, "isoformat") and not isinstance(value, str):
        iso = value.isoformat()
        if len(iso) == 10:
            iso = f"{iso}T00:00:00"
        if not iso.endswith("Z") and "T" in iso:
            iso = f"{iso}Z"
        return iso
    if isinstance(value, bool):
        return str(value).lower() if coerce_all_to_string else value
    if isinstance(value, (int, float)):
        if coerce_all_to_string or key in precision_columns:
            return str(value)
        return value
    if isinstance(value, (list, dict)):
        return json.dumps(value, ensure_ascii=True)
    return str(value) if coerce_all_to_string else value


def _build_document_data(
    row: dict[str, Any],
    precision_columns: set[str],
    coerce_all_to_string: bool,
) -> dict[str, Any]:
    return {
        key: _normalize_value(value, key, precision_columns, coerce_all_to_string)
        for key, value in row.items()
    }


def _deterministic_document_id(
    collection_id: str,
    row: dict[str, Any],
    document_id_columns: list[str],
) -> str:
    keys = document_id_columns or ["id"]
    raw = "|".join(str(row.get(key, "")) for key in keys)
    digest = hashlib.sha1(f"{collection_id}|{raw}".encode()).hexdigest()
    prefix = "".join(ch for ch in collection_id if ch.isalnum() or ch in "_.-")[:10] or "doc"
    return f"{prefix}_{digest[:24]}"


def _build_permissions(collection_config: dict[str, Any], row: dict[str, Any]) -> list[str] | None:
    mode = collection_config.get("permissionsMode") or "collectionDefault"
    if mode == "publicRead":
        return ['read("any")']
    if mode == "ownerReadWrite":
        owner_field = collection_config.get("ownerField") or "user_id"
        owner_id = row.get(owner_field)
        if not owner_id:
            return None
        role = f'user("{owner_id}")'
        return [f"read({role})", f"update({role})", f"delete({role})"]
    return None


def _headers() -> dict[str, str]:
    project_id = settings.resolved_appwrite_project_id
    api_key = settings.resolved_appwrite_api_key
    if not project_id or not api_key:
        raise RuntimeError("Appwrite credentials are incomplete")
    return {
        "X-Appwrite-Project": project_id,
        "X-Appwrite-Key": api_key,
        "Content-Type": "application/json",
    }


async def _upsert_document(
    client: httpx.AsyncClient,
    database_id: str,
    collection_id: str,
    document_id: str,
    document_data: dict[str, Any],
    permissions: list[str] | None,
) -> str:
    base_url = settings.appwrite_endpoint.rstrip("/")
    create_url = f"{base_url}/databases/{database_id}/collections/{collection_id}/documents"
    payload: dict[str, Any] = {"documentId": document_id, "data": document_data}
    if permissions is not None:
        payload["permissions"] = permissions

    response = await client.post(create_url, headers=_headers(), json=payload)
    if response.status_code < 300:
        return "created"
    if response.status_code != 409:
        response.raise_for_status()

    update_url = f"{create_url}/{document_id}"
    update_payload: dict[str, Any] = {"data": document_data}
    if permissions is not None:
        update_payload["permissions"] = permissions
    update_response = await client.patch(update_url, headers=_headers(), json=update_payload)
    update_response.raise_for_status()
    return "updated"


async def _fetch_rows(
    table_name: str,
    cursor_column: str,
    batch_size: int,
    last_cursor: str | None,
    max_rows: int,
) -> list[dict[str, Any]]:
    table_sql = _quote_identifier(table_name)
    cursor_sql = _quote_identifier(cursor_column)
    effective_limit = batch_size if max_rows <= 0 else min(batch_size, max_rows)

    query = f"SELECT * FROM {table_sql}"
    params: dict[str, Any] = {"limit": effective_limit}
    if last_cursor is not None and last_cursor != "":
        query += f" WHERE {cursor_sql} > :last_cursor"
        params["last_cursor"] = _coerce_cursor(last_cursor)
    query += f" ORDER BY {cursor_sql} ASC LIMIT :limit"

    async with async_session_maker() as session:
        result = await session.execute(text(query), params)
        return [dict(row) for row in result.mappings().all()]


async def _populate_via_http(
    tables: list[str],
    *,
    full_refresh: bool,
    max_rows: int | None,
) -> None:
    schema_map = _load_schema_map()
    collection_map = {
        item["table"]: item for item in schema_map.get("collections", []) if item.get("table")
    }
    state = _load_state()
    database_id = settings.appwrite_database_id
    if not database_id:
        raise RuntimeError("Appwrite database ID is not configured")

    concurrency = max(1, _env_int("APPWRITE_POPULATE_CONCURRENCY", 5))
    default_max_rows = 0 if full_refresh else _env_int("APPWRITE_POPULATE_MAX_ROWS", 1000)
    coerce_all_to_string = True

    timeout = httpx.Timeout(60.0, connect=10.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        for table_name in tables:
            collection_config = collection_map.get(table_name)
            if not collection_config:
                logger.warning("Skipping unknown Appwrite table mapping: %s", table_name)
                continue

            collection_id = collection_config["collectionId"]
            cursor_column = collection_config.get("cursorColumn", "id")
            batch_size = int(
                collection_config.get("batchSize") or _env_int("APPWRITE_POPULATE_BATCH_SIZE", 500)
            )
            document_id_columns = list(collection_config.get("documentIdColumns") or ["id"])
            precision_columns = set(collection_config.get("precisionColumns") or [])

            table_state = state.setdefault("tables", {}).setdefault(table_name, {})
            last_cursor = None if full_refresh else table_state.get("lastCursor")
            remaining = default_max_rows if max_rows is None else max_rows

            created = 0
            updated = 0
            failed = 0
            read = 0

            while True:
                window = 0 if remaining is None else remaining
                rows = await _fetch_rows(table_name, cursor_column, batch_size, last_cursor, window)
                if not rows:
                    break

                semaphore = asyncio.Semaphore(concurrency)

                async def worker(
                    row: dict[str, Any],
                    *,
                    semaphore: asyncio.Semaphore = semaphore,
                    collection_id: str = collection_id,
                    document_id_columns: list[str] = document_id_columns,
                    precision_columns: set[str] = precision_columns,
                    collection_config: dict[str, Any] = collection_config,
                ) -> str:
                    async with semaphore:
                        document_id = _deterministic_document_id(
                            collection_id, row, document_id_columns
                        )
                        document_data = _build_document_data(
                            row, precision_columns, coerce_all_to_string
                        )
                        permissions = _build_permissions(collection_config, row)
                        return await _upsert_document(
                            client,
                            database_id,
                            collection_id,
                            document_id,
                            document_data,
                            permissions,
                        )

                results = await asyncio.gather(
                    *(worker(row) for row in rows), return_exceptions=True
                )

                for result in results:
                    if isinstance(result, Exception):
                        failed += 1
                        logger.warning("Appwrite mirror failed for %s: %s", collection_id, result)
                    elif result == "created":
                        created += 1
                    else:
                        updated += 1

                read += len(rows)
                last_cursor = str(rows[-1][cursor_column])
                table_state.update(
                    {
                        "table": table_name,
                        "collectionId": collection_id,
                        "cursorColumn": cursor_column,
                        "paginationMode": "keyset-python",
                        "lastCursor": last_cursor,
                        "finished": False,
                    }
                )
                _save_state(state)

                logger.info(
                    "Appwrite HTTP mirror %s progress read=%s created=%s updated=%s failed=%s lastCursor=%s",
                    collection_id,
                    read,
                    created,
                    updated,
                    failed,
                    last_cursor,
                )

                if remaining and remaining > 0:
                    remaining -= len(rows)
                    if remaining <= 0:
                        break

            table_state["finished"] = True
            _save_state(state)
            logger.info(
                "Appwrite HTTP mirror %s done read=%s created=%s updated=%s failed=%s",
                collection_id,
                read,
                created,
                updated,
                failed,
            )


async def _populate_via_node(
    tables: list[str],
    *,
    full_refresh: bool,
    max_rows: int | None,
) -> None:
    node_bin = shutil.which("node")
    if not node_bin:
        raise RuntimeError("Node.js is required to populate Appwrite")

    repo_root = _repo_root()
    script_path = repo_root / "scripts" / "appwrite" / "migrate_supabase_to_appwrite.mjs"
    env_file = repo_root / "apps" / "api" / ".env"

    env = os.environ.copy()
    env.setdefault("APPWRITE_ENV_FILE", str(env_file))
    env["MIGRATION_TABLES"] = ",".join(tables)
    env["MIGRATION_DRY_RUN"] = "false"
    env["MIGRATION_PAGINATION_MODE"] = env.get("MIGRATION_PAGINATION_MODE", "keyset")
    env["MIGRATION_SNAPSHOT_UPPER_BOUND"] = env.get("MIGRATION_SNAPSHOT_UPPER_BOUND", "true")
    env["MIGRATION_COERCE_ALL_TO_STRING"] = env.get("MIGRATION_COERCE_ALL_TO_STRING", "true")
    env["MIGRATION_BATCH_SIZE"] = env.get(
        "APPWRITE_POPULATE_BATCH_SIZE",
        env.get("MIGRATION_BATCH_SIZE", "500"),
    )
    env["MIGRATION_CONCURRENCY"] = env.get(
        "APPWRITE_POPULATE_CONCURRENCY",
        env.get("MIGRATION_CONCURRENCY", "5"),
    )

    if full_refresh:
        env["MIGRATION_RESUME"] = "false"
        env["MIGRATION_START_CURSOR"] = ""
        env["MIGRATION_MAX_ROWS"] = str(
            max_rows if max_rows is not None else _env_int("APPWRITE_POPULATE_FULL_MAX_ROWS", 0)
        )
    else:
        env["MIGRATION_RESUME"] = env.get("APPWRITE_POPULATE_RESUME", "true")
        env["MIGRATION_MAX_ROWS"] = str(
            max_rows if max_rows is not None else _env_int("APPWRITE_POPULATE_MAX_ROWS", 1000)
        )

    mode = "full_refresh" if full_refresh else "incremental"
    logger.info("Populating Appwrite via Node tables=%s mode=%s", ",".join(tables), mode)

    process = await asyncio.create_subprocess_exec(
        node_bin,
        str(script_path),
        cwd=str(repo_root),
        env=env,
    )
    return_code = await process.wait()
    if return_code != 0:
        raise RuntimeError(
            f"Appwrite population failed for tables={','.join(tables)} mode={mode} exit={return_code}"
        )


async def populate_appwrite_tables(
    tables: Sequence[str],
    *,
    full_refresh: bool = False,
    max_rows: int | None = None,
) -> None:
    normalized_tables = _normalize_tables(tables)
    if not normalized_tables:
        return

    if not settings.is_appwrite_configured:
        logger.info(
            "Skipping Appwrite population for tables=%s because Appwrite is not configured",
            ",".join(normalized_tables),
        )
        return

    if not _env_flag("APPWRITE_POPULATE_FORCE_HTTP") and shutil.which("node"):
        try:
            await _populate_via_node(
                normalized_tables, full_refresh=full_refresh, max_rows=max_rows
            )
            return
        except Exception as exc:
            logger.warning(
                "Node-based Appwrite population failed, falling back to HTTP mirror: %s", exc
            )

    logger.info("Using Python HTTP Appwrite mirror for tables=%s", ",".join(normalized_tables))
    await _populate_via_http(normalized_tables, full_refresh=full_refresh, max_rows=max_rows)


async def populate_primary_appwrite_data() -> None:
    full_refresh_tables = [
        table for table in PRIMARY_APPWRITE_TABLES if table in FULL_REFRESH_TABLES
    ]
    incremental_tables = [
        table for table in PRIMARY_APPWRITE_TABLES if table not in FULL_REFRESH_TABLES
    ]

    if full_refresh_tables:
        await populate_appwrite_tables(full_refresh_tables, full_refresh=True)
    if incremental_tables:
        await populate_appwrite_tables(incremental_tables)
