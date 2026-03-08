"""Appwrite population helpers for Appwrite-first sync flows."""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
from collections.abc import Sequence
from pathlib import Path

from vnibb.core.config import settings

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

    node_bin = shutil.which("node")
    if not node_bin:
        raise RuntimeError("Node.js is required to populate Appwrite")

    repo_root = _repo_root()
    script_path = repo_root / "scripts" / "appwrite" / "migrate_supabase_to_appwrite.mjs"
    env_file = repo_root / "apps" / "api" / ".env"

    env = os.environ.copy()
    env.setdefault("APPWRITE_ENV_FILE", str(env_file))
    env["MIGRATION_TABLES"] = ",".join(normalized_tables)
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
    logger.info(
        "Populating Appwrite tables=%s mode=%s",
        ",".join(normalized_tables),
        mode,
    )

    process = await asyncio.create_subprocess_exec(
        node_bin,
        str(script_path),
        cwd=str(repo_root),
        env=env,
    )
    return_code = await process.wait()
    if return_code != 0:
        raise RuntimeError(
            f"Appwrite population failed for tables={','.join(normalized_tables)} mode={mode} exit={return_code}"
        )

    logger.info(
        "Appwrite population completed for tables=%s mode=%s",
        ",".join(normalized_tables),
        mode,
    )


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
