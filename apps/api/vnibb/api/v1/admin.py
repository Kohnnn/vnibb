"""Admin API endpoints for database inspection and management."""

import re
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query, HTTPException, BackgroundTasks, Body
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.core.database import get_db, engine
from vnibb.core.cache import redis_client
from vnibb.core.config import settings

router = APIRouter(tags=["Admin"])

TABLE_NAME_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
TIMESTAMP_CANDIDATES = [
    "updated_at",
    "created_at",
    "fetched_at",
    "published_date",
    "event_date",
    "date",
    "time",
]


def _quote_identifier(table_name: str) -> str:
    if not TABLE_NAME_PATTERN.fullmatch(table_name):
        raise HTTPException(status_code=400, detail="Invalid table name")
    return f'"{table_name}"'


async def _discover_tables(db: AsyncSession) -> list[str]:
    if engine.dialect.name == "postgresql":
        result = await db.execute(
            text(
                """
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = 'public'
                  AND table_type = 'BASE TABLE'
                ORDER BY table_name
                """
            )
        )
        return [row[0] for row in result.fetchall() if row[0]]

    result = await db.execute(
        text(
            """
            SELECT name
            FROM sqlite_master
            WHERE type='table'
              AND name NOT LIKE 'sqlite_%'
            ORDER BY name
            """
        )
    )
    return [row[0] for row in result.fetchall() if row[0]]


async def _table_exists(db: AsyncSession, table_name: str) -> bool:
    if engine.dialect.name == "postgresql":
        result = await db.execute(
            text(
                """
                SELECT 1
                FROM information_schema.tables
                WHERE table_schema = 'public'
                  AND table_name = :table_name
                LIMIT 1
                """
            ),
            {"table_name": table_name},
        )
        return result.first() is not None

    result = await db.execute(
        text(
            """
            SELECT 1
            FROM sqlite_master
            WHERE type='table'
              AND name = :table_name
            LIMIT 1
            """
        ),
        {"table_name": table_name},
    )
    return result.first() is not None


async def _discover_timestamp_column(db: AsyncSession, table_name: str) -> Optional[str]:
    if engine.dialect.name == "postgresql":
        result = await db.execute(
            text(
                """
                SELECT column_name
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = :table_name
                """
            ),
            {"table_name": table_name},
        )
        columns = {row[0] for row in result.fetchall()}
    else:
        result = await db.execute(text(f"PRAGMA table_info({_quote_identifier(table_name)})"))
        columns = {row[1] for row in result.fetchall()}

    for candidate in TIMESTAMP_CANDIDATES:
        if candidate in columns:
            return candidate

    return None


@router.get("/database/tables")
async def list_all_tables(db: AsyncSession = Depends(get_db)):
    """List all database tables with row counts and freshness metadata."""
    tables_info = []
    table_names = await _discover_tables(db)

    for table_name in table_names:
        try:
            quoted_table = _quote_identifier(table_name)
            count_result = await db.execute(text(f"SELECT COUNT(*) FROM {quoted_table}"))
            count = count_result.scalar() or 0
            latest = None
            updated_at_column = await _discover_timestamp_column(db, table_name)
            if updated_at_column:
                ts_result = await db.execute(
                    text(f'SELECT MAX("{updated_at_column}") FROM {quoted_table}')
                )
                latest = ts_result.scalar()

            freshness = "stale"
            if latest:
                if isinstance(latest, str):
                    try:
                        latest = datetime.fromisoformat(latest.replace("Z", "+00:00"))
                    except:
                        pass
                if isinstance(latest, datetime):
                    age = datetime.utcnow() - latest.replace(tzinfo=None)
                    if age.total_seconds() < 3600:
                        freshness = "fresh"
                    elif age.total_seconds() < 86400:
                        freshness = "recent"

            tables_info.append(
                {
                    "name": table_name,
                    "count": count,
                    "updated_at_column": updated_at_column,
                    "last_updated": latest.isoformat()
                    if hasattr(latest, "isoformat")
                    else str(latest)
                    if latest
                    else None,
                    "freshness": freshness,
                }
            )
        except Exception as e:
            await db.rollback()
            tables_info.append(
                {"name": table_name, "count": 0, "freshness": "unknown", "error": str(e)}
            )

    tables_info.sort(key=lambda x: x["count"], reverse=True)
    return {
        "tables": tables_info,
        "total_tables": len(tables_info),
        "timestamp": datetime.utcnow().isoformat(),
        "last_checked": datetime.utcnow().isoformat(),
    }


@router.get("/database/table/{table_name}/schema")
async def get_table_schema(table_name: str, db: AsyncSession = Depends(get_db)):
    """Get column metadata for a table."""
    _quote_identifier(table_name)
    if not await _table_exists(db, table_name):
        raise HTTPException(status_code=404, detail="Table not found")
    try:
        if engine.dialect.name == "postgresql":
            columns_result = await db.execute(
                text(
                    """
                    SELECT
                        column_name,
                        data_type,
                        is_nullable,
                        column_default
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = :table_name
                    ORDER BY ordinal_position
                    """
                ),
                {"table_name": table_name},
            )
            columns = columns_result.mappings().all()

            pk_result = await db.execute(
                text(
                    """
                    SELECT kcu.column_name
                    FROM information_schema.table_constraints tc
                    JOIN information_schema.key_column_usage kcu
                      ON tc.constraint_name = kcu.constraint_name
                     AND tc.table_schema = kcu.table_schema
                    WHERE tc.constraint_type = 'PRIMARY KEY'
                      AND tc.table_schema = 'public'
                      AND tc.table_name = :table_name
                    """
                ),
                {"table_name": table_name},
            )
            pk_columns = {row["column_name"] for row in pk_result.mappings().all()}

            return {
                "table": table_name,
                "columns": [
                    {
                        "name": col["column_name"],
                        "type": col["data_type"],
                        "nullable": col["is_nullable"] == "YES",
                        "default": col["column_default"],
                        "primary_key": col["column_name"] in pk_columns,
                    }
                    for col in columns
                ],
            }

        result = await db.execute(text(f"PRAGMA table_info({_quote_identifier(table_name)})"))
        columns = result.fetchall()
        return {
            "table": table_name,
            "columns": [
                {
                    "name": col[1],
                    "type": col[2],
                    "nullable": not col[3],
                    "default": col[4],
                    "primary_key": bool(col[5]),
                }
                for col in columns
            ],
        }
    except Exception as e:
        return {"error": str(e)}


@router.get("/database/table/{table_name}/sample")
@router.get("/database/sample/{table_name}")
async def get_table_sample(
    table_name: str,
    limit: int = Query(default=10, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    search: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Get sample rows from a table with pagination and optional search."""
    _quote_identifier(table_name)
    if not await _table_exists(db, table_name):
        raise HTTPException(status_code=404, detail="Table not found")
    try:
        quoted_table = _quote_identifier(table_name)
        where_clause = ""
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if search:
            schema = await get_table_schema(table_name, db)
            text_cols = [
                c["name"]
                for c in schema.get("columns", [])
                if "TEXT" in str(c["type"]).upper() or "CHAR" in str(c["type"]).upper()
            ]
            if text_cols:
                where_clause = " WHERE " + " OR ".join(
                    [f'LOWER(CAST("{col}" AS TEXT)) LIKE :s' for col in text_cols]
                )
                params["s"] = f"%{search.lower()}%"

        query = f"SELECT * FROM {quoted_table}{where_clause} LIMIT :limit OFFSET :offset"
        result = await db.execute(text(query), params)
        rows = result.mappings().all()

        count_params = {"s": params["s"]} if "s" in params else {}
        count_res = await db.execute(text(f"SELECT COUNT(*) FROM {quoted_table}{where_clause}"), count_params)
        total = count_res.scalar()

        data = []
        for row in rows:
            rd = dict(row)
            for k, v in rd.items():
                if hasattr(v, "isoformat"):
                    rd[k] = v.isoformat()
                elif isinstance(v, bytes):
                    rd[k] = v.hex()
            data.append(rd)

        return {
            "table": table_name,
            "rows": data,
            "total": total,
            "count": len(data),
            "has_more": offset + len(data) < total,
        }
    except Exception as e:
        return {"error": str(e)}


@router.post("/database/query")
async def execute_query(query: str = Body(..., embed=True), db: AsyncSession = Depends(get_db)):
    """Execute read-only SQL query (SELECT only)."""
    if not query.strip().upper().startswith("SELECT"):
        raise HTTPException(status_code=400, detail="Only SELECT allowed")
    try:
        result = await db.execute(text(query))
        rows = result.mappings().all()
        data = []
        for row in rows:
            rd = dict(row)
            for k, v in rd.items():
                if hasattr(v, "isoformat"):
                    rd[k] = v.isoformat()
            data.append(rd)
        return {"query": query, "count": len(data), "rows": data}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/database/sync-status")
@router.get("/sync/status")
async def get_sync_status(db: AsyncSession = Depends(get_db)):
    """Get sync status for all tables."""
    status_data = {
        "timestamp": datetime.utcnow().isoformat(),
        "sync_jobs": [],
        "data_freshness": {},
    }

    # 1. Get recent sync jobs
    try:
        result = await db.execute(
            text("SELECT * FROM sync_status ORDER BY completed_at DESC LIMIT 50")
        )
        rows = result.mappings().all()
        jobs = []
        for row in rows:
            rd = dict(row)
            for k, v in rd.items():
                if hasattr(v, "isoformat"):
                    rd[k] = v.isoformat()
            jobs.append(rd)
        status_data["sync_jobs"] = jobs
        status_data["sync_status"] = jobs  # Alias
        status_data["count"] = len(jobs)
    except Exception:
        pass

    # 2. Calculate data freshness (matching old test expectation)
    tables_to_check = [
        ("stocks", "updated_at"),
        ("stock_prices", "time"),
        ("screener_snapshots", "fetched_at"),
    ]
    for table, date_col in tables_to_check:
        try:
            res = await db.execute(
                text(f"SELECT MAX({date_col}) as last_update, COUNT(*) as count FROM {table}")
            )
            row = res.mappings().first()
            last_update = row["last_update"] if row else None
            status_data["data_freshness"][table] = {
                "last_update": last_update.isoformat()
                if hasattr(last_update, "isoformat")
                else str(last_update)
                if last_update
                else None,
                "count": row["count"] if row else 0,
                "freshness": "fresh" if last_update else "stale",
            }
        except:
            pass

    return status_data


@router.get("/database/stats")
async def get_db_stats(db: AsyncSession = Depends(get_db)):
    return await list_all_tables(db)


@router.get("/cache/stats")
async def get_cache_stats():
    if not settings.redis_url:
        return {
            "enabled": False,
            "message": "Redis not configured",
        }

    try:
        await redis_client.connect()
        info = await redis_client.client.info()
        keys = await redis_client.client.dbsize()
        hits = int(info.get("keyspace_hits", 0) or 0)
        misses = int(info.get("keyspace_misses", 0) or 0)
        total = hits + misses
        hit_rate = round((hits / total) * 100, 2) if total else None
        return {
            "enabled": True,
            "used_memory": info.get("used_memory_human"),
            "keys": keys,
            "hits": hits,
            "misses": misses,
            "hit_rate": hit_rate,
        }
    except Exception as e:
        return {
            "enabled": True,
            "error": str(e),
        }


@router.post("/database/seed/{seed_type}")
async def trigger_seed(seed_type: str, background_tasks: BackgroundTasks):
    from vnibb.services.data_pipeline import data_pipeline

    if seed_type == "full":
        background_tasks.add_task(data_pipeline.run_full_seeding)
    elif seed_type == "stocks":
        background_tasks.add_task(data_pipeline.sync_stock_list)
    elif seed_type == "screener":
        background_tasks.add_task(data_pipeline.sync_screener_data)
    else:
        raise HTTPException(status_code=400, detail="Invalid seed type")

    return {
        "status": "started",
        "seed_type": seed_type,
        "message": "Seeding task started in background",
    }
