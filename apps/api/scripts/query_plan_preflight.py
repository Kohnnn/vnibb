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


def mongo_preflight(required: bool, symbol: str, max_time_ms: int) -> dict[str, Any]:
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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="VNIBB Wave 7.3 read-only query-plan preflight")
    parser.add_argument("--output-json", type=Path)
    parser.add_argument("--api-base-url", default=os.getenv("VNIBB_PREFLIGHT_API_BASE_URL"))
    parser.add_argument("--symbol", default=os.getenv("VNIBB_PREFLIGHT_SYMBOL", "FPT"))
    parser.add_argument("--mongo-max-time-ms", type=int, default=bounded_int(os.getenv("VNIBB_PREFLIGHT_MONGO_MAX_TIME_MS"), 5000, 1000, 30000))
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
        mongo_preflight(args.require_mongo, symbol, max(1000, min(args.mongo_max_time_ms, 30000))),
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
    print_failures(report)
    return exit_code(report)


if __name__ == "__main__":
    raise SystemExit(main())
