import sys
from types import ModuleType
from unittest.mock import ANY

import pytest

from scripts.vietcap import backfill_vietcap


def test_select_symbols_for_fresh_ohlc_filters_before_limit_for_ohlc_only():
    symbols, skipped_fresh = backfill_vietcap.select_symbols_for_fresh_ohlc(
        ["AAA", "BBB", "CCC"], {"AAA", "CCC"}, ohlc_only=True
    )

    assert symbols[:1] == ["BBB"]
    assert skipped_fresh == 2


def test_select_symbols_for_fresh_ohlc_keeps_mixed_datasets_symbols():
    symbols, skipped_fresh = backfill_vietcap.select_symbols_for_fresh_ohlc(
        ["AAA", "BBB"], {"AAA"}, ohlc_only=False
    )

    assert symbols == ["AAA", "BBB"]
    assert skipped_fresh == 1


class FakeDatabase:
    def __init__(self):
        self.pipeline = None

    def __getitem__(self, name):
        assert name == "market_prices_eod"
        return self

    def aggregate(self, pipeline):
        self.pipeline = pipeline
        return [{"_id": "AAA"}]


class FakeMongoClient:
    database = FakeDatabase()

    def __init__(self, url, **kwargs):
        self.url = url

    def __getitem__(self, name):
        assert name == "vnibb-market"
        return self.database


class FakeVietcapClient:
    def get_all_symbols(self):
        return [
            {"symbol": "AAA", "type": "STOCK"},
            {"symbol": "BBB", "type": "STOCK"},
        ]

    def get_ohlc(self, symbol, *, count_back):
        raise AssertionError(f"fresh OHLC should not be fetched: {symbol}")

    def get_statistics_financial(self, symbol):
        return [{"symbol": symbol}]


@pytest.fixture
def fake_mongo(monkeypatch):
    module = ModuleType("pymongo")
    module.MongoClient = FakeMongoClient
    monkeypatch.setitem(sys.modules, "pymongo", module)


def test_ensure_indexes_creates_global_latest_date_index_in_key_order() -> None:
    class Collection:
        def __init__(self) -> None:
            self.indexes = []

        def create_index(self, keys, **options) -> None:
            self.indexes.append((keys, options))

    class Database:
        def __init__(self) -> None:
            self.collections = {}

        def __getitem__(self, name):
            return self.collections.setdefault(name, Collection())

    database = Database()
    backfill_vietcap._ensure_indexes(database)

    assert ([('tradeDate', -1)], {"name": "idx_tradeDate_desc"}) in database[
        "market_prices_eod"
    ].indexes


def test_skip_fresh_through_dry_run_requires_mongodb_url(monkeypatch):
    monkeypatch.delenv("MONGODB_URL", raising=False)
    monkeypatch.setattr(backfill_vietcap, "load_env_file", lambda _: None)
    monkeypatch.setattr(backfill_vietcap, "VietcapClient", FakeVietcapClient)
    monkeypatch.setattr(sys, "argv", ["backfill_vietcap.py", "--skip-fresh-through", "2026-07-08"])

    with pytest.raises(SystemExit, match="MONGODB_URL is required"):
        backfill_vietcap.main()


def test_skip_fresh_through_dry_run_skips_only_ohlc_for_mixed_datasets(
    monkeypatch, capsys, fake_mongo
):
    monkeypatch.setenv("MONGODB_URL", "mongodb://readonly")
    monkeypatch.setattr(backfill_vietcap, "VietcapClient", FakeVietcapClient)
    monkeypatch.setattr(backfill_vietcap, "ohlc_rows_from_gap_chart", lambda *_: [])
    monkeypatch.setattr(
        "scripts.vietcap.vietcap_writers.upsert_ratio_rows",
        lambda db, symbol, rows, *, dry_run: 1,
    )
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "backfill_vietcap.py",
            "--symbols",
            "AAA,BBB",
            "--datasets",
            "ohlc,ratios",
            "--skip-fresh-through",
            "2026-07-08",
            "--limit",
            "1",
        ],
    )

    assert backfill_vietcap.main() == 0

    output = capsys.readouterr().out
    assert '"symbol_count": 1' in output
    assert '"skipped_fresh": 1' in output
    assert '"symbol": "AAA"' in output
    assert '"ohlc": {"skipped_fresh": true}' in output
    assert '"ratios": 1' in output
    assert FakeMongoClient.database.pipeline == [
        {"$match": {"source": "vietcap", "tradeDate": {"$gte": ANY}}},
        {"$group": {"_id": "$symbol"}},
    ]
