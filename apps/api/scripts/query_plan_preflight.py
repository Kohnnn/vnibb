from __future__ import annotations

import argparse
import ast
import json
import logging
import os
import re
import sys
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
VERSIONS_DIR = ROOT / "migrations" / "versions"
DEFAULT_STANDARD_BUDGET_MS = 3000
DEFAULT_ADVANCED_BUDGET_MS = 5000
MONGO_EOD_COLLECTION = "market_prices_eod"
REQUIRED_POSTGRES_INDEXES = {"ix_stocks_symbol": (("symbol",), True)}
REQUIRED_MONGO_EOD_INDEXES = {
    "uniq_symbol_tradeDate_source": ((("symbol", 1), ("tradeDate", 1), ("source", 1)), True),
    "idx_symbol_tradeDate_desc": ((("symbol", 1), ("tradeDate", -1)), False),
    "idx_tradeDate_desc": ((("tradeDate", -1),), False),
}
SENSITIVE_KEY = re.compile(r"(pass(word)?|pwd|secret|token|api[_-]?key|auth|credential)", re.I)
URL_CREDENTIALS = re.compile(r"(://[^:/@\s]+:)([^@\s]+)(@)")
logging.getLogger("dotenv.main").setLevel(logging.ERROR)


def redact_secret(value: object) -> str:
    text = str(value)
    try:
        parsed = urlsplit(text)
        if parsed.scheme and parsed.netloc:
            hostname = parsed.hostname or ""
            netloc = hostname
            if parsed.port:
                netloc = f"{netloc}:{parsed.port}"
            if parsed.username is not None:
                netloc = f"{parsed.username}:***@{netloc}"
            query = urlencode(
                [(key, "***" if SENSITIVE_KEY.search(key) else item) for key, item in parse_qsl(parsed.query)]
            )
            return urlunsplit((parsed.scheme, netloc, parsed.path, query, ""))
    except ValueError:
        pass
    return URL_CREDENTIALS.sub(r"\1***\3", text)


def safe_error(exc: Exception) -> str:
    return redact_secret(f"{type(exc).__name__}: {exc}")


def plan_stages(value: Any) -> list[str]:
    stages: list[str] = []
    if isinstance(value, dict):
        stage = value.get("stage")
        if isinstance(stage, str):
            stages.append(stage.upper())
        for item in value.values():
            stages.extend(plan_stages(item))
    elif isinstance(value, list):
        for item in value:
            stages.extend(plan_stages(item))
    return stages


def has_collscan(plan: Any) -> bool:
    return "COLLSCAN" in plan_stages(plan)


def index_keys(index: dict[str, Any]) -> tuple[tuple[str, int], ...]:
    key = index.get("key", {})
    if not isinstance(key, dict):
        return ()
    return tuple((str(field), int(direction)) for field, direction in key.items())


def validate_required_indexes(
    indexes: list[dict[str, Any]], required: dict[str, tuple[Any, ...]]
) -> list[str]:
    missing: list[str] = []
    for name, contract in required.items():
        expected_keys = tuple(contract[0])
        unique = bool(contract[-1])
        if not any(index_keys(index) == expected_keys and bool(index.get("unique")) == unique for index in indexes):
            missing.append(name)
    return missing


def migration_heads(versions_dir: Path = VERSIONS_DIR) -> list[str]:
    revisions: set[str] = set()
    parents: set[str] = set()
    for path in versions_dir.glob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        values: dict[str, Any] = {}
        for node in tree.body:
            target = None
            value = None
            if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
                target, value = node.targets[0].id, node.value
            if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
                target, value = node.target.id, node.value
            if target in {"revision", "down_revision"} and value is not None:
                try:
                    values[target] = ast.literal_eval(value)
                except ValueError:
                    continue
        revision = values.get("revision")
        if isinstance(revision, str):
            revisions.add(revision)
        parent = values.get("down_revision")
        if isinstance(parent, str):
            parents.add(parent)
        elif isinstance(parent, (tuple, list)):
            parents.update(item for item in parent if isinstance(item, str))
    return sorted(revisions - parents)


def configured_postgres_url() -> str | None:
    try:
        from vnibb.core.config import settings

        return settings.sync_database_url
    except Exception:
        return os.getenv("DATABASE_URL_SYNC") or os.getenv("DATABASE_URL")


def configured_mongo_url() -> str | None:
    try:
        from vnibb.core.config import settings

        return settings.mongodb_url if settings.mongodb_enabled else None
    except Exception:
        if os.getenv("MONGODB_ENABLED", "true").lower() in {"0", "false", "no"}:
            return None
        return os.getenv("MONGODB_URL")


def bounded_int(value: str | None, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value) if value is not None else default
    except ValueError:
        parsed = default
    return max(minimum, min(parsed, maximum))


def unavailable(name: str, required: bool, reason: str) -> dict[str, Any]:
    return {"name": name, "status": "unavailable", "required": required, "reason": reason}


def skipped(name: str, required: bool, reason: str) -> dict[str, Any]:
    return {"name": name, "status": "skipped", "required": required, "reason": reason}


def _mongo_aggregate(
    database: Any,
    pipeline: list[dict[str, Any]],
    max_time_ms: int,
) -> list[dict[str, Any]]:
    reply = database.command(
        {
            "aggregate": MONGO_EOD_COLLECTION,
            "pipeline": pipeline,
            "cursor": {"batchSize": 1000},
            "maxTimeMS": max_time_ms,
        }
    )
    return list(reply.get("cursor", {}).get("firstBatch", []))


def _facet_result(rows: list[dict[str, Any]]) -> dict[str, Any]:
    if not rows:
        return {"summary": {}, "samples": []}
    row = rows[0]
    summary_rows = row.get("summary", [])
    return {
        "summary": summary_rows[0] if summary_rows else {},
        "samples": row.get("samples", []),
    }


def _missing_value(field: str) -> dict[str, Any]:
    value = f"${field}"
    return {
        "$or": [
            {"$eq": [{"$type": value}, "missing"]},
            {"$eq": [value, None]},
            {"$eq": [value, ""]},
        ]
    }


def _finite_number(field: str, converted_field: str) -> dict[str, Any]:
    original = f"${field}"
    converted = f"${converted_field}"
    return {
        "$and": [
            {"$isNumber": original},
            {"$ne": [converted, None]},
            {"$eq": [converted, converted]},
            {"$lt": [{"$abs": converted}, 1e100]},
        ]
    }


def _duplicate_pipeline(
    group_id: dict[str, Any],
    sample_limit: int,
    *,
    match: dict[str, Any] | None = None,
    include_sources: bool = False,
) -> list[dict[str, Any]]:
    pipeline: list[dict[str, Any]] = []
    if match:
        pipeline.append({"$match": match})
    group: dict[str, Any] = {
        "_id": group_id,
        "documents": {"$sum": 1},
        "timestamps": {"$addToSet": "$tradeDate"},
    }
    if include_sources:
        group["sources"] = {"$addToSet": "$source"}
    pipeline.append({"$group": group})
    if include_sources:
        pipeline.append({"$match": {"$expr": {"$gt": [{"$size": "$sources"}, 1]}}})
    else:
        pipeline.append({"$match": {"documents": {"$gt": 1}}})
    pipeline.append(
        {
            "$set": {
                "extraDocuments": {"$subtract": ["$documents", 1]},
                "timestampVariant": {"$gt": [{"$size": "$timestamps"}, 1]},
            }
        }
    )
    pipeline.append(
        {
            "$facet": {
                "summary": [
                    {
                        "$group": {
                            "_id": None,
                            "keys": {"$sum": 1},
                            "documents": {"$sum": "$documents"},
                            "extraDocuments": {"$sum": "$extraDocuments"},
                            "timestampVariantKeys": {
                                "$sum": {"$cond": ["$timestampVariant", 1, 0]}
                            },
                        }
                    },
                    {"$project": {"_id": 0}},
                ],
                "samples": [
                    {"$sort": {"documents": -1, "_id.symbol": 1}},
                    {"$limit": sample_limit},
                    {"$project": {"_id": 1, "documents": 1, "timestamps": 1, "sources": 1}},
                ],
            }
        }
    )
    return pipeline


def mongo_eod_corpus_audit(
    database: Any,
    max_time_ms: int,
    sample_limit: int,
) -> dict[str, Any]:
    sample_limit = max(1, min(sample_limit, 100))
    valid_identity = {
        "symbol": {"$type": "string"},
        "source": {"$type": "string"},
        "tradeDate": {"$type": "date"},
    }
    trade_day = {"$dateToString": {"format": "%Y-%m-%d", "date": "$tradeDate"}}
    source_rows = _mongo_aggregate(
        database,
        [
            {
                "$group": {
                    "_id": {"source": {"$ifNull": ["$source", "unknown"]}, "symbol": "$symbol"},
                    "documents": {"$sum": 1},
                    "firstTradeDate": {"$min": "$tradeDate"},
                    "lastTradeDate": {"$max": "$tradeDate"},
                }
            },
            {
                "$group": {
                    "_id": "$_id.source",
                    "documents": {"$sum": "$documents"},
                    "symbols": {"$sum": 1},
                    "firstTradeDate": {"$min": "$firstTradeDate"},
                    "lastTradeDate": {"$max": "$lastTradeDate"},
                }
            },
            {"$sort": {"documents": -1, "_id": 1}},
            {
                "$facet": {
                    "summary": [{"$count": "sourceCount"}],
                    "samples": [{"$limit": 100}],
                }
            },
        ],
        max_time_ms,
    )
    source_result = _facet_result(source_rows)
    unit_rows = _mongo_aggregate(
        database,
        [
            {
                "$group": {
                    "_id": {
                        "source": {"$ifNull": ["$source", "unknown"]},
                        "priceUnit": {"$ifNull": ["$priceUnit", "unknown"]},
                    },
                    "documents": {"$sum": 1},
                }
            },
            {"$sort": {"documents": -1, "_id.source": 1, "_id.priceUnit": 1}},
            {
                "$facet": {
                    "summary": [{"$count": "sourceUnitPairs"}],
                    "samples": [{"$limit": 200}],
                }
            },
        ],
        max_time_ms,
    )
    unit_result = _facet_result(unit_rows)

    converted_fields = {
        f"_{field}": {
            "$convert": {"input": f"${field}", "to": "double", "onError": None, "onNull": None}
        }
        for field in ("open", "high", "low", "close", "volume")
    }
    finite_prices = [_finite_number(field, f"_{field}") for field in ("open", "high", "low", "close")]
    valid_volume = {
        "$and": [
            _finite_number("volume", "_volume"),
            {"$gte": ["$_volume", 0]},
            {"$eq": ["$_volume", {"$trunc": "$_volume"}]},
        ]
    }
    valid_ohlc = {
        "$and": [
            *finite_prices,
            {"$gt": ["$_open", 0]},
            {"$gt": ["$_high", 0]},
            {"$gt": ["$_low", 0]},
            {"$gt": ["$_close", 0]},
            {"$gte": ["$_high", "$_open"]},
            {"$gte": ["$_high", "$_low"]},
            {"$gte": ["$_high", "$_close"]},
            {"$lte": ["$_low", "$_open"]},
            {"$lte": ["$_low", "$_high"]},
            {"$lte": ["$_low", "$_close"]},
        ]
    }
    missing_identity = {
        "$or": [
            _missing_value("symbol"),
            {"$ne": [{"$type": "$tradeDate"}, "date"]},
            _missing_value("source"),
        ]
    }
    missing_provenance = {
        "$or": [
            _missing_value("sourceKey"),
            _missing_value("updatedAt"),
            _missing_value("schemaVersion"),
        ]
    }
    quality_rows = _mongo_aggregate(
        database,
        [
            {
                "$project": {
                    "symbol": 1,
                    "tradeDate": 1,
                    "source": 1,
                    "priceUnit": 1,
                    "sourceKey": 1,
                    "updatedAt": 1,
                    "schemaVersion": 1,
                    "open": 1,
                    "high": 1,
                    "low": 1,
                    "close": 1,
                    "volume": 1,
                    **converted_fields,
                    "missingIdentity": missing_identity,
                    "missingProvenance": missing_provenance,
                    "invalidUnit": {"$ne": ["$priceUnit", "VND"]},
                }
            },
            {
                "$set": {
                    "invalidOhlc": {"$not": [valid_ohlc]},
                    "invalidVolume": {"$not": [valid_volume]},
                }
            },
            {
                "$set": {
                    "offending": {
                        "$or": [
                            "$missingIdentity",
                            "$missingProvenance",
                            "$invalidUnit",
                            "$invalidOhlc",
                            "$invalidVolume",
                        ]
                    }
                }
            },
            {
                "$facet": {
                    "summary": [
                        {
                            "$group": {
                                "_id": None,
                                "documents": {"$sum": 1},
                                "missingIdentity": {"$sum": {"$cond": ["$missingIdentity", 1, 0]}},
                                "missingProvenance": {
                                    "$sum": {"$cond": ["$missingProvenance", 1, 0]}
                                },
                                "invalidUnit": {"$sum": {"$cond": ["$invalidUnit", 1, 0]}},
                                "invalidOhlc": {"$sum": {"$cond": ["$invalidOhlc", 1, 0]}},
                                "invalidVolume": {"$sum": {"$cond": ["$invalidVolume", 1, 0]}},
                            }
                        },
                        {"$project": {"_id": 0}},
                    ],
                    "samples": [
                        {"$match": {"offending": True}},
                        {"$sort": {"tradeDate": -1, "symbol": 1}},
                        {"$limit": sample_limit},
                        {
                            "$project": {
                                "_id": 0,
                                "symbol": 1,
                                "tradeDate": 1,
                                "source": 1,
                                "missingIdentity": 1,
                                "missingProvenance": 1,
                                "invalidUnit": 1,
                                "invalidOhlc": 1,
                                "invalidVolume": 1,
                            }
                        },
                    ],
                }
            },
        ],
        max_time_ms,
    )
    quality = _facet_result(quality_rows)

    exact_duplicates = _facet_result(
        _mongo_aggregate(
            database,
            _duplicate_pipeline(
                {"symbol": "$symbol", "tradeDate": "$tradeDate", "source": "$source"},
                sample_limit,
            ),
            max_time_ms,
        )
    )
    logical_duplicates = _facet_result(
        _mongo_aggregate(
            database,
            _duplicate_pipeline(
                {"symbol": "$symbol", "tradeDay": trade_day, "source": "$source"},
                sample_limit,
                match=valid_identity,
            ),
            max_time_ms,
        )
    )
    cross_source_overlaps = _facet_result(
        _mongo_aggregate(
            database,
            _duplicate_pipeline(
                {"symbol": "$symbol", "tradeDay": trade_day},
                sample_limit,
                match=valid_identity,
                include_sources=True,
            ),
            max_time_ms,
        )
    )

    failures: list[str] = []
    quality_summary = quality["summary"]
    exact_summary = exact_duplicates["summary"]
    logical_summary = logical_duplicates["summary"]
    document_count = int(quality_summary.get("documents", 0))
    if document_count == 0:
        failures.append("EOD corpus is empty or unreadable")
    for field, label in (
        ("missingIdentity", "documents missing symbol, date, or source"),
        ("missingProvenance", "documents missing sourceKey, updatedAt, or schemaVersion"),
        ("invalidUnit", "documents without priceUnit=VND"),
        ("invalidOhlc", "documents with invalid OHLC"),
        ("invalidVolume", "documents with invalid volume"),
    ):
        count = int(quality_summary.get(field, 0))
        if count:
            failures.append(f"{count} {label}")
    exact_keys = int(exact_summary.get("keys", 0))
    if exact_keys:
        failures.append(f"{exact_keys} duplicate exact symbol/tradeDate/source keys")
    logical_keys = int(logical_summary.get("keys", 0))
    if logical_keys:
        failures.append(f"{logical_keys} duplicate same-source logical trading-day keys")

    overlap_summary = cross_source_overlaps["summary"]
    warnings: list[str] = []
    overlap_keys = int(overlap_summary.get("keys", 0))
    if overlap_keys:
        warnings.append(f"{overlap_keys} logical trading-day keys overlap across sources")
    timestamp_variants = int(overlap_summary.get("timestampVariantKeys", 0))
    if timestamp_variants:
        warnings.append(f"{timestamp_variants} cross-source overlaps use different timestamps")

    return {
        "status": "fail" if failures else "pass",
        "collection": MONGO_EOD_COLLECTION,
        "read_only": True,
        "max_time_ms_per_command": max_time_ms,
        "sample_limit": sample_limit,
        "source_result_limit": 100,
        "unit_result_limit": 200,
        "sources": source_result,
        "units": unit_result,
        "quality": quality,
        "exact_duplicates": exact_duplicates,
        "same_source_logical_day_duplicates": logical_duplicates,
        "cross_source_logical_day_overlaps": cross_source_overlaps,
        "failures": failures,
        "warnings": warnings,
    }


def postgres_preflight(required: bool, symbol: str) -> dict[str, Any]:
    database_url = configured_postgres_url()
    if not database_url:
        return skipped("postgres", required, "DATABASE_URL_SYNC or DATABASE_URL is not configured")
    if not database_url.startswith(("postgres://", "postgresql://", "postgresql+psycopg2://")):
        return skipped("postgres", required, "configured database is not PostgreSQL")
    try:
        import psycopg2
    except ImportError as exc:
        return unavailable("postgres", required, safe_error(exc))
    timeout_ms = bounded_int(os.getenv("DB_STATEMENT_TIMEOUT_MS"), 30000, 1000, 30000)
    lock_timeout_ms = bounded_int(os.getenv("DB_LOCK_TIMEOUT_MS"), 5000, 1000, 30000)
    try:
        connection = psycopg2.connect(database_url, connect_timeout=min(timeout_ms // 1000, 30))
        try:
            with connection.cursor() as cursor:
                cursor.execute("BEGIN READ ONLY")
                cursor.execute(f"SET LOCAL statement_timeout = {timeout_ms}")
                cursor.execute(f"SET LOCAL lock_timeout = {lock_timeout_ms}")
                cursor.execute("SELECT 1")
                cursor.execute(
                    "SELECT to_regclass('public.stocks'), to_regclass('public.alembic_version')"
                )
                stocks_table, version_table = cursor.fetchone()
                if not stocks_table or not version_table:
                    return {
                        "name": "postgres",
                        "status": "fail",
                        "required": required,
                        "failures": ["missing required schema tables: stocks and alembic_version"],
                    }
                cursor.execute("SELECT version_num FROM alembic_version ORDER BY version_num")
                database_heads = sorted(row[0] for row in cursor.fetchall())
                repository_heads = migration_heads()
                cursor.execute(
                    "SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'stocks'"
                )
                index_names = {row[0] for row in cursor.fetchall()}
                missing_indexes = [
                    name for name in REQUIRED_POSTGRES_INDEXES if name not in index_names
                ]
                cursor.execute(
                    "EXPLAIN (FORMAT JSON, ANALYZE false) "
                    "SELECT symbol, company_name, short_name, exchange FROM stocks "
                    "WHERE is_active = 1 AND (symbol ILIKE %s OR company_name ILIKE %s "
                    "OR short_name ILIKE %s OR industry ILIKE %s) LIMIT 36",
                    tuple(f"%{symbol.lower()}%" for _ in range(4)),
                )
                plan = cursor.fetchone()[0]
                failures: list[str] = []
                if database_heads != repository_heads:
                    failures.append(
                        f"migration head mismatch: database={database_heads}, repository={repository_heads}"
                    )
                if missing_indexes:
                    failures.append(f"missing required PostgreSQL indexes: {', '.join(missing_indexes)}")
                return {
                    "name": "postgres",
                    "status": "fail" if failures else "pass",
                    "required": required,
                    "timeouts_ms": {"statement": timeout_ms, "lock": lock_timeout_ms},
                    "schema": {"stocks": str(stocks_table), "alembic_version": str(version_table)},
                    "migration_heads": {"database": database_heads, "repository": repository_heads},
                    "indexes": {"missing": missing_indexes},
                    "ticker_company_search_plan": plan,
                    "failures": failures,
                }
        finally:
            connection.rollback()
            connection.close()
    except Exception as exc:
        return unavailable("postgres", required, safe_error(exc))


def mongo_preflight(
    required: bool,
    symbol: str,
    max_time_ms: int,
    *,
    audit_corpus: bool = False,
    audit_sample_limit: int = 20,
) -> dict[str, Any]:
    mongo_url = configured_mongo_url()
    if not mongo_url:
        return skipped("mongo", required, "MONGODB_URL is not configured or MongoDB is disabled")
    try:
        from pymongo import MongoClient
        from pymongo.read_preferences import ReadPreference
    except ImportError as exc:
        return unavailable("mongo", required, safe_error(exc))
    database_name = os.getenv("MONGODB_DATABASE", "vnibb-market")
    try:
        client = MongoClient(
            mongo_url,
            serverSelectionTimeoutMS=max_time_ms,
            connectTimeoutMS=max_time_ms,
            socketTimeoutMS=max_time_ms,
            read_preference=ReadPreference.PRIMARY,
        )
        try:
            database = client[database_name]
            database.command("ping", maxTimeMS=max_time_ms)
            index_reply = database.command(
                "listIndexes", "market_prices_eod", maxTimeMS=max_time_ms
            )
            indexes = list(index_reply["cursor"]["firstBatch"])
            missing_indexes = validate_required_indexes(indexes, REQUIRED_MONGO_EOD_INDEXES)
            latest_command = {
                "find": "market_prices_eod",
                "filter": {"symbol": symbol.upper()},
                "sort": {"tradeDate": -1},
                "limit": 1,
                "maxTimeMS": max_time_ms,
            }
            global_latest_date_command = {
                "find": "market_prices_eod",
                "filter": {},
                "sort": {"tradeDate": -1},
                "limit": 1,
                "maxTimeMS": max_time_ms,
            }
            window_start = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=30)
            rolling_command = {
                "find": "market_prices_eod",
                "filter": {"symbol": symbol.upper(), "tradeDate": {"$gte": window_start}},
                "sort": {"tradeDate": 1},
                "limit": 60,
                "maxTimeMS": max_time_ms,
            }
            latest_plan = database.command("explain", latest_command, verbosity="queryPlanner")
            global_latest_date_plan = database.command(
                "explain", global_latest_date_command, verbosity="queryPlanner"
            )
            rolling_plan = database.command("explain", rolling_command, verbosity="queryPlanner")
            latest_collscan = has_collscan(latest_plan)
            global_latest_date_collscan = has_collscan(global_latest_date_plan)
            rolling_collscan = has_collscan(rolling_plan)
            failures: list[str] = []
            if missing_indexes:
                failures.append(f"missing required Mongo EOD indexes: {', '.join(missing_indexes)}")
            if latest_collscan:
                failures.append("latest EOD query plan contains COLLSCAN")
            if global_latest_date_collscan:
                failures.append("global latest-date EOD query plan contains COLLSCAN")
            if rolling_collscan:
                failures.append("rolling window EOD query plan contains COLLSCAN")
            corpus_audit = (
                mongo_eod_corpus_audit(database, max_time_ms, audit_sample_limit)
                if audit_corpus
                else None
            )
            if corpus_audit:
                failures.extend(
                    f"corpus: {failure}" for failure in corpus_audit.get("failures", [])
                )
            return {
                "name": "mongo",
                "status": "fail" if failures else "pass",
                "required": required,
                "database": database_name,
                "read_preference": "primary",
                "max_time_ms": max_time_ms,
                "indexes": {"missing": missing_indexes},
                "latest_eod": {"plan": latest_plan, "collscan": latest_collscan},
                "global_latest_date": {
                    "plan": global_latest_date_plan,
                    "collscan": global_latest_date_collscan,
                },
                "rolling_window": {"plan": rolling_plan, "collscan": rolling_collscan},
                "corpus_audit": corpus_audit,
                "failures": failures,
            }
        finally:
            client.close()
    except Exception as exc:
        return unavailable("mongo", required, safe_error(exc))


def benchmark_request(url: str, budget_ms: int) -> dict[str, Any]:
    started = time.perf_counter()
    try:
        with urlopen(url, timeout=max(1, budget_ms / 1000 + 2)) as response:
            payload = json.loads(response.read().decode("utf-8"))
            status_code = response.status
    except HTTPError as exc:
        elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
        return {"status": "fail", "url": redact_secret(url), "duration_ms": elapsed_ms, "error": safe_error(exc)}
    except (URLError, TimeoutError, ValueError) as exc:
        elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
        return {"status": "unavailable", "url": redact_secret(url), "duration_ms": elapsed_ms, "error": safe_error(exc)}
    elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
    rows = payload.get("data") if isinstance(payload, dict) else None
    result_count = len(rows) if isinstance(rows, list) else None
    failures: list[str] = []
    if status_code != 200:
        failures.append(f"HTTP {status_code}")
    if elapsed_ms > budget_ms:
        failures.append(f"duration {elapsed_ms}ms exceeded budget {budget_ms}ms")
    return {
        "status": "fail" if failures else "pass",
        "url": redact_secret(url),
        "duration_ms": elapsed_ms,
        "budget_ms": budget_ms,
        "status_code": status_code,
        "result_count": result_count,
        "failures": failures,
    }


def screener_benchmark(required: bool, base_url: str | None, standard_budget_ms: int, advanced_budget_ms: int) -> dict[str, Any]:
    if not base_url:
        return skipped("screener", required, "VNIBB_PREFLIGHT_API_BASE_URL is not configured")
    base = base_url.rstrip("/")
    paths = {
        "standard": (f"{base}/api/v1/screener/?limit=100", standard_budget_ms),
        "advanced": (f"{base}/api/v1/screener/?limit=100&pe_min=0&sort=market_cap:desc", advanced_budget_ms),
    }
    results = {name: benchmark_request(url, budget) for name, (url, budget) in paths.items()}
    unavailable_result = any(result["status"] == "unavailable" for result in results.values())
    failures = [
        f"{name}: {failure}"
        for name, result in results.items()
        for failure in result.get("failures", [])
    ]
    return {
        "name": "screener",
        "status": "unavailable" if unavailable_result else "fail" if failures else "pass",
        "required": required,
        "results": results,
        "failures": failures,
    }


def exit_code(report: dict[str, Any]) -> int:
    for check in report["checks"]:
        if check["required"] and check["status"] in {"fail", "skipped", "unavailable"}:
            return 1
    return 0


def print_failures(report: dict[str, Any]) -> None:
    for check in report["checks"]:
        if check["status"] == "fail":
            level = "FAIL" if check["required"] else "WARN"
            for failure in check.get("failures", []):
                print(f"{level} {check['name']}: {failure}", file=sys.stderr)
        elif check["required"] and check["status"] in {"skipped", "unavailable"}:
            print(f"FAIL {check['name']}: {check.get('reason', check.get('error', 'unavailable'))}", file=sys.stderr)


def render_mongo_eod_audit_markdown(report: dict[str, Any]) -> str:
    mongo = next((check for check in report["checks"] if check["name"] == "mongo"), None)
    audit = mongo.get("corpus_audit") if mongo else None
    lines = ["# Mongo EOD Corpus Audit", ""]
    if not audit:
        lines.extend(["Status: not run", ""])
        return "\n".join(lines)
    quality = audit.get("quality", {}).get("summary", {})
    lines.extend(
        [
            f"Status: {audit['status']}",
            f"Collection: `{audit['collection']}`",
            f"Read-only: `{audit['read_only']}`",
            f"Max time per command: `{audit['max_time_ms_per_command']} ms`",
            "",
            "## Inventory By Source",
            "",
            "| Source | Documents | Symbols | First Date | Last Date |",
            "|---|---:|---:|---|---|",
        ]
    )
    for source in audit.get("sources", {}).get("samples", []):
        lines.append(
            f"| `{source.get('_id', 'unknown')}` | {source.get('documents', 0)} | "
            f"{source.get('symbols', 0)} | {source.get('firstTradeDate', '')} | "
            f"{source.get('lastTradeDate', '')} |"
        )
    lines.extend(
        [
            "",
            "## Units By Source",
            "",
            "| Source | Price Unit | Documents |",
            "|---|---|---:|",
        ]
    )
    for unit in audit.get("units", {}).get("samples", []):
        key = unit.get("_id", {})
        lines.append(
            f"| `{key.get('source', 'unknown')}` | `{key.get('priceUnit', 'unknown')}` | "
            f"{unit.get('documents', 0)} |"
        )
    lines.extend(
        [
            "",
            "## Quality Counts",
            "",
            f"- Documents: `{quality.get('documents', 0)}`",
            f"- Missing identity: `{quality.get('missingIdentity', 0)}`",
            f"- Missing provenance: `{quality.get('missingProvenance', 0)}`",
            f"- Invalid units: `{quality.get('invalidUnit', 0)}`",
            f"- Invalid OHLC: `{quality.get('invalidOhlc', 0)}`",
            f"- Invalid volume: `{quality.get('invalidVolume', 0)}`",
            "",
            "## Duplicate And Overlap Counts",
            "",
            f"- Exact duplicate keys: `{audit.get('exact_duplicates', {}).get('summary', {}).get('keys', 0)}`",
            f"- Same-source logical-day duplicate keys: `{audit.get('same_source_logical_day_duplicates', {}).get('summary', {}).get('keys', 0)}`",
            f"- Cross-source logical-day overlap keys: `{audit.get('cross_source_logical_day_overlaps', {}).get('summary', {}).get('keys', 0)}`",
            f"- Cross-source timestamp-variant keys: `{audit.get('cross_source_logical_day_overlaps', {}).get('summary', {}).get('timestampVariantKeys', 0)}`",
            "",
            "## Findings",
            "",
        ]
    )
    findings = [*(audit.get("failures") or []), *(audit.get("warnings") or [])]
    lines.extend(f"- {finding}" for finding in findings)
    if not findings:
        lines.append("- None")
    lines.append("")
    return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="VNIBB Wave 7.3 read-only query-plan preflight")
    parser.add_argument("--output-json", type=Path)
    parser.add_argument("--output-markdown", type=Path)
    parser.add_argument("--api-base-url", default=os.getenv("VNIBB_PREFLIGHT_API_BASE_URL"))
    parser.add_argument("--symbol", default=os.getenv("VNIBB_PREFLIGHT_SYMBOL", "FPT"))
    parser.add_argument("--mongo-max-time-ms", type=int, default=bounded_int(os.getenv("VNIBB_PREFLIGHT_MONGO_MAX_TIME_MS"), 5000, 1000, 30000))
    parser.add_argument("--mongo-audit-sample-limit", type=int, default=20)
    parser.add_argument("--audit-mongo-eod", action="store_true")
    parser.add_argument("--standard-budget-ms", type=int, default=bounded_int(os.getenv("VNIBB_SCREENER_STANDARD_BUDGET_MS"), DEFAULT_STANDARD_BUDGET_MS, 1, 60000))
    parser.add_argument("--advanced-budget-ms", type=int, default=bounded_int(os.getenv("VNIBB_SCREENER_ADVANCED_BUDGET_MS"), DEFAULT_ADVANCED_BUDGET_MS, 1, 60000))
    parser.add_argument("--require-postgres", action="store_true")
    parser.add_argument("--require-mongo", action="store_true")
    parser.add_argument("--require-screener", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    symbol = re.sub(r"[^A-Za-z0-9]", "", args.symbol).upper()[:10] or "FPT"
    checks = [
        postgres_preflight(args.require_postgres, symbol),
        mongo_preflight(
            args.require_mongo,
            symbol,
            max(1000, min(args.mongo_max_time_ms, 30000)),
            audit_corpus=args.audit_mongo_eod,
            audit_sample_limit=max(1, min(args.mongo_audit_sample_limit, 100)),
        ),
        screener_benchmark(
            args.require_screener,
            args.api_base_url,
            max(1, min(args.standard_budget_ms, 60000)),
            max(1, min(args.advanced_budget_ms, 60000)),
        ),
    ]
    report = {"contract": "wave-7.3-query-plan-index", "checks": checks}
    output = json.dumps(report, default=str, sort_keys=True)
    print(output)
    if args.output_json:
        args.output_json.write_text(f"{output}\n", encoding="utf-8")
    if args.output_markdown:
        args.output_markdown.write_text(
            render_mongo_eod_audit_markdown(report),
            encoding="utf-8",
        )
    print_failures(report)
    return exit_code(report)


if __name__ == "__main__":
    raise SystemExit(main())
