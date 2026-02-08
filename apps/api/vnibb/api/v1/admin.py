"""Admin API endpoints for database inspection and management."""

from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, Query, HTTPException, BackgroundTasks, Body
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.core.database import get_db, engine
from vnibb.core.cache import redis_client
from vnibb.core.config import settings

router = APIRouter(tags=["Admin"])

# Expanded allowed tables for full database inspection
ALL_TABLES = [
    "stocks",
    "stock_prices",
    "stock_indices",
    "companies",
    "shareholders",
    "officers",
    "subsidiaries",
    "income_statements",
    "balance_sheets",
    "cash_flows",
    "financial_ratios",
    "company_news",
    "company_events",
    "dividends",
    "insider_deals",
    "market_news",
    "intraday_trades",
    "orderbook_snapshots",
    "foreign_trading",
    "order_flow_daily",
    "derivative_prices",
    "market_sectors",
    "sector_performances",
    "screener_snapshots",
    "technical_indicators",
    "sync_status",
    "user_dashboards",
    "dashboard_widgets",
    "block_trades",
    "insider_alerts",
    "alert_settings",
]


@router.get("/database/tables")
async def list_all_tables(db: AsyncSession = Depends(get_db)):
    """List all database tables with row counts and freshness metadata."""
    tables_info = []
    for table_name in ALL_TABLES:
        try:
            count_result = await db.execute(text(f"SELECT COUNT(*) FROM {table_name}"))
            count = count_result.scalar() or 0
            latest = None
            for col in ["updated_at", "created_at", "fetched_at", "date", "time"]:
                try:
                    ts_result = await db.execute(text(f"SELECT MAX({col}) FROM {table_name}"))
                    latest = ts_result.scalar()
                    if latest:
                        break
                except:
                    continue

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
    if table_name not in ALL_TABLES:
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

        result = await db.execute(text(f"PRAGMA table_info({table_name})"))
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
    if table_name not in ALL_TABLES:
        raise HTTPException(status_code=404, detail="Table not found")
    try:
        where_clause = ""
        params = {}
        if search:
            schema = await get_table_schema(table_name, db)
            text_cols = [
                c["name"]
                for c in schema.get("columns", [])
                if "TEXT" in str(c["type"]).upper() or "CHAR" in str(c["type"]).upper()
            ]
            if text_cols:
                where_clause = " WHERE " + " OR ".join([f"{col} LIKE :s" for col in text_cols])
                params["s"] = f"%{search}%"

        query = f"SELECT * FROM {table_name}{where_clause} LIMIT {limit} OFFSET {offset}"
        result = await db.execute(text(query), params)
        rows = result.mappings().all()

        count_res = await db.execute(
            text(f"SELECT COUNT(*) FROM {table_name}{where_clause}"), params
        )
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
