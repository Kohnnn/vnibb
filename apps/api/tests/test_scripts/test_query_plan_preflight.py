import importlib.util
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace

MODULE_PATH = Path(__file__).parents[2] / "scripts" / "query_plan_preflight.py"
SPEC = importlib.util.spec_from_file_location("query_plan_preflight", MODULE_PATH)
query_plan_preflight = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(query_plan_preflight)

CATALOG_MODULE_PATH = Path(__file__).parents[2] / "scripts" / "backfill_mongo_vnstock_full_catalog.py"
CATALOG_SPEC = importlib.util.spec_from_file_location("backfill_mongo_vnstock_full_catalog", CATALOG_MODULE_PATH)
backfill_mongo_vnstock_full_catalog = importlib.util.module_from_spec(CATALOG_SPEC)
assert CATALOG_SPEC.loader is not None
sys.modules[CATALOG_SPEC.name] = backfill_mongo_vnstock_full_catalog
CATALOG_SPEC.loader.exec_module(backfill_mongo_vnstock_full_catalog)


def test_plan_stages_detects_nested_collscan() -> None:
    plan = {"queryPlanner": {"winningPlan": {"stage": "FETCH", "inputStage": {"stage": "COLLSCAN"}}}}

    assert query_plan_preflight.plan_stages(plan) == ["FETCH", "COLLSCAN"]
    assert query_plan_preflight.has_collscan(plan) is True
    assert query_plan_preflight.has_collscan({"stage": "IXSCAN"}) is False


def test_required_mongo_indexes_match_key_order_and_uniqueness() -> None:
    indexes = [
        {"key": {"symbol": 1, "tradeDate": 1, "source": 1}, "unique": True},
        {"key": {"symbol": 1, "tradeDate": -1}},
        {"key": {"tradeDate": -1}},
    ]

    assert query_plan_preflight.validate_required_indexes(
        indexes, query_plan_preflight.REQUIRED_MONGO_EOD_INDEXES
    ) == []
    assert query_plan_preflight.validate_required_indexes(
        indexes[:1], query_plan_preflight.REQUIRED_MONGO_EOD_INDEXES
    ) == ["idx_symbol_tradeDate_desc", "idx_tradeDate_desc"]
    assert query_plan_preflight.validate_required_indexes(
        indexes[:2] + [{"key": {"tradeDate": 1}}],
        query_plan_preflight.REQUIRED_MONGO_EOD_INDEXES,
    ) == ["idx_tradeDate_desc"]


def test_full_catalog_bootstrap_creates_global_latest_date_index_in_key_order() -> None:
    class Collection:
        def __init__(self) -> None:
            self.indexes = []

        def create_index(self, keys, **options) -> None:
            self.indexes.append((keys, options))

    class Database:
        def __getattr__(self, _name):
            return collection

    collection = Collection()
    backfill_mongo_vnstock_full_catalog._ensure_indexes(Database())

    assert ([('tradeDate', -1)], {"name": "idx_tradeDate_desc"}) in collection.indexes


def test_secret_redaction_removes_url_passwords_and_sensitive_query_values() -> None:
    value = "postgresql://user:top-secret@db.example/vnibb?api_key=another-secret&safe=yes"

    redacted = query_plan_preflight.redact_secret(value)

    assert "top-secret" not in redacted
    assert "another-secret" not in redacted
    assert "user:***@db.example" in redacted
    assert "api_key=%2A%2A%2A" in redacted
    assert "safe=yes" in redacted


def test_screener_budget_failure_records_metadata(monkeypatch) -> None:
    class Response:
        status = 200

        def read(self) -> bytes:
            return b'{"data": [{"symbol": "FPT"}]}'

        def __enter__(self):
            return self

        def __exit__(self, *_args) -> None:
            return None

    values = iter((0.0, 0.05))
    monkeypatch.setattr(query_plan_preflight, "urlopen", lambda *_args, **_kwargs: Response())
    monkeypatch.setattr(query_plan_preflight.time, "perf_counter", lambda: next(values))

    result = query_plan_preflight.benchmark_request("http://localhost:8000/api/v1/screener", 10)

    assert result["status"] == "fail"
    assert result["result_count"] == 1
    assert result["budget_ms"] == 10
    assert "exceeded budget" in result["failures"][0]


def test_mongo_preflight_fails_when_global_latest_date_plan_contains_collscan(monkeypatch) -> None:
    class Database:
        def command(self, command, *args, **_kwargs):
            if command == "ping":
                return {}
            if command == "listIndexes":
                return {
                    "cursor": {
                        "firstBatch": [
                            {"key": {"symbol": 1, "tradeDate": 1, "source": 1}, "unique": True},
                            {"key": {"symbol": 1, "tradeDate": -1}},
                            {"key": {"tradeDate": -1}},
                        ]
                    }
                }
            query = args[0]
            stage = "COLLSCAN" if query["filter"] == {} else "IXSCAN"
            return {"queryPlanner": {"winningPlan": {"stage": stage}}}

    class Client:
        def __init__(self, *_args, **_kwargs):
            self.database = Database()

        def __getitem__(self, _name):
            return self.database

        def close(self):
            return None

    pymongo = ModuleType("pymongo")
    pymongo.MongoClient = Client
    read_preferences = ModuleType("pymongo.read_preferences")
    read_preferences.ReadPreference = SimpleNamespace(PRIMARY="primary")
    monkeypatch.setitem(sys.modules, "pymongo", pymongo)
    monkeypatch.setitem(sys.modules, "pymongo.read_preferences", read_preferences)
    monkeypatch.setattr(query_plan_preflight, "configured_mongo_url", lambda: "mongodb://test")

    result = query_plan_preflight.mongo_preflight(required=True, symbol="FPT", max_time_ms=1000)

    assert result["status"] == "fail"
    assert result["latest_eod"]["collscan"] is False
    assert result["global_latest_date"]["collscan"] is True
    assert result["rolling_window"]["collscan"] is False
    assert "global latest-date EOD query plan contains COLLSCAN" in result["failures"]


def test_mongo_eod_corpus_audit_is_bounded_read_only_and_classifies_findings() -> None:
    replies = iter(
        [
            {
                "summary": [{"sourceCount": 2}],
                "samples": [
                    {
                        "_id": "vietcap",
                        "documents": 100,
                        "symbols": 2,
                        "firstTradeDate": "2026-01-01",
                        "lastTradeDate": "2026-07-28",
                    }
                ],
            },
            {
                "summary": [{"sourceUnitPairs": 2}],
                "samples": [
                    {
                        "_id": {"source": "vietcap", "priceUnit": "VND"},
                        "documents": 100,
                    }
                ],
            },
            {
                "summary": [
                    {
                        "documents": 120,
                        "missingIdentity": 1,
                        "missingProvenance": 2,
                        "invalidUnit": 3,
                        "invalidOhlc": 4,
                        "invalidVolume": 5,
                    }
                ],
                "samples": [{"symbol": "FPT", "invalidUnit": True}],
            },
            {
                "summary": [
                    {
                        "keys": 1,
                        "documents": 2,
                        "extraDocuments": 1,
                        "timestampVariantKeys": 0,
                    }
                ],
                "samples": [],
            },
            {
                "summary": [
                    {
                        "keys": 2,
                        "documents": 4,
                        "extraDocuments": 2,
                        "timestampVariantKeys": 2,
                    }
                ],
                "samples": [],
            },
            {
                "summary": [
                    {
                        "keys": 3,
                        "documents": 6,
                        "extraDocuments": 3,
                        "timestampVariantKeys": 2,
                    }
                ],
                "samples": [],
            },
        ]
    )

    class Database:
        def __init__(self) -> None:
            self.commands = []

        def command(self, command):
            self.commands.append(command)
            return {"cursor": {"firstBatch": [next(replies)]}}

    database = Database()
    result = query_plan_preflight.mongo_eod_corpus_audit(database, 2500, 7)

    assert result["status"] == "fail"
    assert result["read_only"] is True
    assert result["sample_limit"] == 7
    assert "1 documents missing symbol, date, or source" in result["failures"]
    assert "2 duplicate same-source logical trading-day keys" in result["failures"]
    assert "3 logical trading-day keys overlap across sources" in result["warnings"]
    assert "2 cross-source overlaps use different timestamps" in result["warnings"]
    assert result["units"]["samples"][0]["_id"]["priceUnit"] == "VND"
    assert len(database.commands) == 6
    for command in database.commands:
        assert command["aggregate"] == "market_prices_eod"
        assert command["maxTimeMS"] == 2500
        assert command["cursor"] == {"batchSize": 1000}
        assert all("$out" not in stage and "$merge" not in stage for stage in command["pipeline"])


def test_mongo_eod_audit_markdown_renders_inventory_and_findings() -> None:
    report = {
        "checks": [
            {
                "name": "mongo",
                "corpus_audit": {
                    "status": "fail",
                    "collection": "market_prices_eod",
                    "read_only": True,
                    "max_time_ms_per_command": 2500,
                    "sources": {
                        "samples": [
                            {
                                "_id": "vietcap",
                                "documents": 100,
                                "symbols": 2,
                                "firstTradeDate": "2026-01-01",
                                "lastTradeDate": "2026-07-28",
                            }
                        ]
                    },
                    "units": {
                        "samples": [
                            {
                                "_id": {"source": "vietcap", "priceUnit": "VND"},
                                "documents": 99,
                            }
                        ]
                    },
                    "quality": {"summary": {"documents": 100, "invalidUnit": 1}},
                    "exact_duplicates": {"summary": {"keys": 0}},
                    "same_source_logical_day_duplicates": {"summary": {"keys": 0}},
                    "cross_source_logical_day_overlaps": {
                        "summary": {"keys": 2, "timestampVariantKeys": 1}
                    },
                    "failures": ["1 documents without priceUnit=VND"],
                    "warnings": ["2 logical trading-day keys overlap across sources"],
                },
            }
        ]
    }

    output = query_plan_preflight.render_mongo_eod_audit_markdown(report)

    assert "# Mongo EOD Corpus Audit" in output
    assert "| `vietcap` | 100 | 2 | 2026-01-01 | 2026-07-28 |" in output
    assert "| `vietcap` | `VND` | 99 |" in output
    assert "Invalid units: `1`" in output
    assert "1 documents without priceUnit=VND" in output


def test_exit_code_distinguishes_optional_skip_from_required_unavailable() -> None:
    optional_skip = {"checks": [query_plan_preflight.skipped("mongo", False, "not configured")]}
    required_unavailable = {
        "checks": [query_plan_preflight.unavailable("mongo", True, "connection refused")]
    }
    failure = {"checks": [{"name": "mongo", "required": False, "status": "fail"}]}

    assert query_plan_preflight.exit_code(optional_skip) == 0
    assert query_plan_preflight.exit_code(required_unavailable) == 1
    assert query_plan_preflight.exit_code(failure) == 0
