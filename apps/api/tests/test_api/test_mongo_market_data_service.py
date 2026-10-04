from datetime import date, datetime
from types import SimpleNamespace

import pytest
from vnibb.providers.vnstock.equity_historical import EquityHistoricalData
from vnibb.services.mongo_market_data_service import MongoMarketDataService


class Cursor:
    def __init__(self, rows):
        self.rows = rows
        self.sort_args = None
        self.limit_value = None
        self.consumed_rows = 0

    def sort(self, *args):
        self.sort_args = args
        return self

    def limit(self, value):
        self.limit_value = value
        return self

    def __iter__(self):
        rows = self.rows if self.limit_value is None else self.rows[: self.limit_value]
        for row in rows:
            self.consumed_rows += 1
            yield row


class Collection:
    def __init__(self, rows=None, error=None):
        self.rows = rows or []
        self.error = error
        self.query = None
        self.projection = None
        self.cursor = None
        self.find_one_query = None
        self.find_one_sort = None
        self.find_one_calls = 0

    def find(self, query, projection):
        if self.error:
            raise self.error
        self.query = query
        self.projection = projection
        self.cursor = Cursor(self.rows)
        return self.cursor

    def find_one(self, query, projection=None, *, sort=None):
        if self.error:
            raise self.error
        self.find_one_calls += 1
        self.find_one_query = query
        self.find_one_sort = sort
        return self.rows[0] if self.rows else None




@pytest.mark.parametrize(
    ("method_name", "kwargs"),
    [
        ("get_eod_prices", {"lookback_days": 30, "limit": 2}),
        (
            "get_eod_prices_between",
            {
                "start_date": date(2026, 6, 10),
                "end_date": date(2026, 6, 12),
                "limit": 2,
            },
        ),
    ],
)
@pytest.mark.asyncio
async def test_eod_reads_limit_logical_days_after_source_deduplication(
    monkeypatch,
    method_name,
    kwargs,
):
    collection = Collection(
        [
            {
                "symbol": "VNM",
                "tradeDate": datetime(2026, 6, 10),
                "close": 25.5,
                "source": "vnstock-data",
            },
            {
                "symbol": "VNM",
                "tradeDate": datetime(2026, 6, 10, 7),
                "close": 25500.0,
                "source": "vietcap",
            },
            {
                "symbol": "VNM",
                "tradeDate": datetime(2026, 6, 11),
                "close": 26.0,
                "source": "vnstock-data",
            },
            {
                "symbol": "VNM",
                "tradeDate": datetime(2026, 6, 11, 7),
                "close": 26000.0,
                "source": "vietcap",
            },
            {
                "symbol": "VNM",
                "tradeDate": datetime(2026, 6, 12, 7),
                "close": 26500.0,
                "source": "vietcap",
            },
            {
                "symbol": "VNM",
                "tradeDate": datetime(2026, 6, 13, 7),
                "close": 27000.0,
                "source": "vietcap",
            },
            {
                "symbol": "VNM",
                "tradeDate": datetime(2026, 6, 14, 7),
                "close": 27500.0,
                "source": "vietcap",
            },
        ]
    )
    service = MongoMarketDataService()
    monkeypatch.setattr(MongoMarketDataService, "_get_collection", lambda *_: collection)

    rows = await getattr(service, method_name)("vnm", **kwargs)

    assert [row["tradeDate"].date() for row in rows] == [date(2026, 6, 10), date(2026, 6, 11)]
    assert [row["close"] for row in rows] == [25500.0, 26000.0]
    assert all("source" not in row for row in rows)
    assert collection.query["symbol"] == "VNM"
    assert collection.cursor.sort_args == ("tradeDate", 1)
    assert collection.cursor.limit_value is None
    assert collection.cursor.consumed_rows == 5


@pytest.mark.asyncio
async def test_get_source_latest_trade_date_returns_none_when_disabled():
    service = MongoMarketDataService()
    assert await service.get_source_latest_trade_date("vietcap") is None


@pytest.mark.asyncio
async def test_get_source_latest_trade_date_uses_source_descending_query(monkeypatch):
    collection = Collection([{"tradeDate": datetime(2026, 7, 8, 7)}])
    service = MongoMarketDataService()
    monkeypatch.setattr(MongoMarketDataService, "_get_collection", lambda *_: collection)

    assert await service.get_source_latest_trade_date(" vietcap ") == date(2026, 7, 8)
    assert collection.query == {"source": "vietcap"}
    assert collection.projection == {"_id": 0, "tradeDate": 1}
    assert collection.cursor.sort_args == ("tradeDate", -1)
    assert collection.cursor.limit_value == 1


@pytest.mark.asyncio
async def test_get_source_latest_trade_date_returns_none_on_read_error(monkeypatch):
    service = MongoMarketDataService()
    monkeypatch.setattr(
        MongoMarketDataService,
        "_get_collection",
        lambda *_: (_ for _ in ()).throw(RuntimeError("unavailable")),
    )

    assert await service.get_source_latest_trade_date("vietcap") is None


@pytest.mark.asyncio
async def test_get_latest_eod_prices_returns_newest_two_logical_days(monkeypatch):
    collection = Collection(
        [
            {"symbol": "VNM", "tradeDate": datetime(2026, 6, 12, 7), "close": 27000.0, "source": "vietcap", "priceUnit": "VND"},
            {"symbol": "VNM", "tradeDate": datetime(2026, 6, 11), "close": 26.0, "source": "vnstock-data"},
            {"symbol": "VNM", "tradeDate": datetime(2026, 6, 11, 7), "close": 26000.0, "source": "vietcap", "priceUnit": "VND"},
            {"symbol": "VNM", "tradeDate": datetime(2026, 6, 10), "close": 25.0, "source": "vnstock-data"},
            {"symbol": "VNM", "tradeDate": datetime(2026, 6, 9, 7), "close": 24000.0, "source": "vietcap", "priceUnit": "VND"},
        ]
    )
    service = MongoMarketDataService()
    monkeypatch.setattr(MongoMarketDataService, "_get_collection", lambda *_: collection)

    rows = await service.get_latest_eod_prices("vnm", limit=2)

    assert [row["tradeDate"].date() for row in rows] == [date(2026, 6, 11), date(2026, 6, 12)]
    assert [row["close"] for row in rows] == [26000.0, 27000.0]
    assert collection.cursor.sort_args == ("tradeDate", -1)
    assert collection.cursor.consumed_rows == 4


def test_eod_selection_is_deterministic_and_prefers_valid_vnd_vietcap():
    from vnibb.services.mongo_market_data_service import _dedup_eod_rows

    vnd_vietcap = {
        "symbol": "VNM",
        "tradeDate": datetime(2026, 6, 12, 7),
        "open": 27000.0,
        "high": 27500.0,
        "low": 26500.0,
        "close": 27000.0,
        "volume": 100,
        "source": "vietcap",
        "priceUnit": "VND",
        "updatedAt": datetime(2026, 6, 12, 8),
    }
    compact_vietcap = {**vnd_vietcap, "close": 27.0, "priceUnit": "THOUSAND_VND"}
    vnstock = {**vnd_vietcap, "close": 27000.0, "source": "vnstock-data", "priceUnit": "VND"}

    first = _dedup_eod_rows([compact_vietcap, vnstock, vnd_vietcap], preserve_provenance=True)
    second = _dedup_eod_rows([vnstock, vnd_vietcap, compact_vietcap], preserve_provenance=True)

    assert first == second
    assert first[0]["close"] == 27000.0
    assert first[0]["source"] == "vietcap"
    assert first[0]["priceUnit"] == "VND"


def test_eod_selection_rejects_invalid_or_non_vnd_vietcap_before_source_rank():
    from vnibb.services.mongo_market_data_service import _dedup_eod_rows

    fallback = {
        "symbol": "VNM",
        "tradeDate": datetime(2026, 6, 12),
        "open": 27000.0,
        "high": 27500.0,
        "low": 26500.0,
        "close": 27000.0,
        "volume": 100,
        "source": "vnstock-data",
        "priceUnit": "VND",
    }
    invalid_vietcap = {**fallback, "source": "vietcap", "high": float("nan")}
    non_vnd_vietcap = {**fallback, "source": "vietcap", "priceUnit": "THOUSAND_VND"}

    row = _dedup_eod_rows(
        [invalid_vietcap, non_vnd_vietcap, fallback], preserve_provenance=True
    )[0]

    assert row["source"] == "vnstock-data"
    assert row["priceUnit"] == "VND"


def _bar(day: date, close: float) -> EquityHistoricalData:
    return EquityHistoricalData(
        symbol="VNM",
        time=day,
        open=close,
        high=close,
        low=close,
        close=close,
        volume=100,
    )


def test_historical_merge_is_ascending_unique_and_mongo_preferred():
    from vnibb.api.v1.equity import _merge_historical_rows

    merged, counts = _merge_historical_rows(
        [
            ("provider", [_bar(date(2026, 6, 10), 10.0), _bar(date(2026, 6, 11), 11.0)]),
            ("mongo", [_bar(date(2026, 6, 10), 10000.0)]),
        ]
    )

    assert [row.time for row in merged] == [date(2026, 6, 10), date(2026, 6, 11)]
    assert [row.close for row in merged] == [10000.0, 11.0]
    assert counts == {"mongo": 1, "provider": 1}


def test_historical_metadata_reports_internal_gap_and_unit_status(monkeypatch):
    from vnibb.api.v1 import equity

    monkeypatch.setattr(equity.settings, "market_holiday_dates", [])
    meta = equity._historical_resolution_meta(
        [_bar(date(2026, 6, 8), 10.0), _bar(date(2026, 6, 10), 12.0)],
        "raw",
        start_date=date(2026, 6, 8),
        end_date=date(2026, 6, 10),
        interval="1D",
        source_counts={"mongo": 2},
        mongo_docs=[{"priceUnit": "VND"}],
        warnings=[],
    )

    assert meta.logical_day_count == 2
    assert meta.completeness_status == "partial"
    assert meta.unit_status == "confirmed_vnd"
    assert "internal business-day gaps" in meta.warnings[0]


@pytest.mark.asyncio
async def test_partial_mongo_survives_provider_failure_and_fills_from_db(client, monkeypatch):
    from vnibb.api.v1 import equity

    async def fake_mongo(*args, **kwargs):
        return ([_bar(date(2026, 6, 8), 10.0)], [{"priceUnit": "VND"}])

    async def fake_cache(*args, **kwargs):
        return SimpleNamespace(hit=False, data=None)

    async def fake_recent(*args, **kwargs):
        return []

    async def fake_db(*args, **kwargs):
        return [_bar(date(2026, 6, 9), 11.0), _bar(date(2026, 6, 10), 12.0)]

    async def fail_provider(*args, **kwargs):
        raise RuntimeError("provider down")

    monkeypatch.setattr(equity, "_load_historical_from_mongo", fake_mongo)
    monkeypatch.setattr(equity.CacheManager, "get_historical_prices", fake_cache)
    monkeypatch.setattr(equity, "_load_historical_from_recent_cache", fake_recent)
    monkeypatch.setattr(equity, "_load_historical_from_db", fake_db)
    monkeypatch.setattr(equity.VnstockEquityHistoricalFetcher, "fetch", fail_provider)

    response = await client.get(
        "/api/v1/equity/historical?symbol=VNM&start_date=2026-06-08&end_date=2026-06-10"
    )

    payload = response.json()
    assert response.status_code == 200
    assert [row["time"] for row in payload["data"]] == ["2026-06-08", "2026-06-09", "2026-06-10"]
    assert payload["meta"]["source_counts"] == {"mongo": 1, "db": 2}
    assert payload["meta"]["fallback_used"] is True
    assert "provider resolution failed" in payload["meta"]["warnings"][0]


@pytest.mark.asyncio
async def test_precise_raw_reader_matches_outer_symbol_and_returns_full_envelope(
    monkeypatch,
):
    collection = Collection(
        [
            {
                "dataset": "company.info",
                "symbol": "FPT",
                "scopeKey": "FPT",
                "source": "vnstock-data",
                "providerSource": "vnstock_data",
                "recordKey": "vnstock-data:company.info:FPT:abc123",
                "observedAt": datetime(2026, 9, 30),
                "updatedAt": datetime(2026, 10, 1),
                "raw": {"symbol": "FPT", "name": "FPT Corp"},
            }
        ]
    )
    service = MongoMarketDataService()
    monkeypatch.setattr(MongoMarketDataService, "_get_collection", lambda *_: collection)

    rows = await service.get_raw_dataset_records_precise("fpt", dataset="company.info", limit=5)

    assert collection.query == {"dataset": "company.info", "symbol": "FPT"}
    assert rows[0]["recordKey"] == "vnstock-data:company.info:FPT:abc123"
    assert rows[0]["scopeKey"] == "FPT"
    assert rows[0]["source"] == "vnstock-data"
    assert rows[0]["providerSource"] == "vnstock_data"


@pytest.mark.asyncio
async def test_precise_raw_reader_applies_variant_filter(monkeypatch):
    collection = Collection()
    service = MongoMarketDataService()
    monkeypatch.setattr(MongoMarketDataService, "_get_collection", lambda *_: collection)

    await service.get_raw_dataset_records_precise(
        "vnm", dataset="finance.ratio", variant="finance.ratio.year", limit=20
    )

    assert collection.query == {
        "dataset": "finance.ratio",
        "symbol": "VNM",
        "datasetVariant": "finance.ratio.year",
    }


@pytest.mark.asyncio
async def test_price_depth_precise_returns_newest_batch_flat_rows_with_provenance(
    monkeypatch,
):
    # Given: two depth write batches; the newer batch spans four price levels.
    collection = Collection(
        [
            {
                "dataset": "equity.price_depth",
                "symbol": "SSI",
                "recordKey": "vnstock-data:equity.price_depth:SSI:level1",
                "observedAt": datetime(2026, 10, 1, 14, 30),
                "updatedAt": datetime(2026, 10, 1, 15),
                "raw": {"symbol": "SSI", "price": 30000, "volume": 100, "buy_volume": 60, "sell_volume": 40},
            },
            {
                "dataset": "equity.price_depth",
                "symbol": "SSI",
                "recordKey": "vnstock-data:equity.price_depth:SSI:level2",
                "observedAt": datetime(2026, 10, 1, 14, 30),
                "updatedAt": datetime(2026, 10, 1, 15),
                "raw": {"symbol": "SSI", "price": 29500, "volume": 50, "undefined_volume": 50},
            },
            {
                "dataset": "equity.price_depth",
                "symbol": "SSI",
                "recordKey": "vnstock-data:equity.price_depth:SSI:level3",
                "observedAt": datetime(2026, 10, 1, 14, 30),
                "updatedAt": datetime(2026, 10, 1, 15),
                "raw": {"symbol": "SSI", "price": 30500, "volume": 0},
            },
            {
                "dataset": "equity.price_depth",
                "symbol": "SSI",
                "recordKey": "vnstock-data:equity.price_depth:SSI:level4",
                "observedAt": datetime(2026, 10, 1, 14, 31),
                "updatedAt": datetime(2026, 10, 1, 15),
                "raw": {"symbol": "SSI", "price": 30550, "volume": 25},
            },
            # Older batch (previous sync) must not leak into the newest batch.
            {
                "dataset": "equity.price_depth",
                "symbol": "SSI",
                "recordKey": "vnstock-data:equity.price_depth:SSI:old1",
                "observedAt": datetime(2026, 10, 1, 13, 30),
                "updatedAt": datetime(2026, 10, 1, 14),
                "raw": {"symbol": "SSI", "price": 29900, "volume": 999},
            },
        ]
    )
    service = MongoMarketDataService()
    monkeypatch.setattr(MongoMarketDataService, "_get_collection", lambda *_: collection)

    rows = await service.get_price_depth_precise(
        "ssi", limit=500, include_provenance=True
    )
    assert {row["price"] for row in rows} == {30000, 29500, 30550}
    assert {row["volume"] for row in rows} == {100, 50, 25}
    assert all(row["updatedAt"] == datetime(2026, 10, 1, 15) for row in rows)
    by_price = {row["price"]: row for row in rows}
    assert by_price[30000]["buy_volume"] == 60
    assert by_price[30000]["sell_volume"] == 40
    assert by_price[29500]["undefined_volume"] == 50


@pytest.mark.asyncio
async def test_price_depth_precise_returns_empty_when_no_records(monkeypatch):
    collection = Collection()
    service = MongoMarketDataService()
    monkeypatch.setattr(MongoMarketDataService, "_get_collection", lambda *_: collection)

    rows = await service.get_price_depth_precise("ssi", limit=500, include_provenance=False)

    assert rows == []


@pytest.mark.asyncio
async def test_price_depth_precise_limit_caps_rows_within_newest_batch(monkeypatch):
    # Given: five valid flat levels written in one batch.
    collection = Collection(
        [
            {
                "dataset": "equity.price_depth",
                "symbol": "SSI",
                "recordKey": f"vnstock-data:equity.price_depth:SSI:level{i}",
                "observedAt": datetime(2026, 10, 1, 14, 30),
                "updatedAt": datetime(2026, 10, 1, 15),
                "raw": {"symbol": "SSI", "price": 30000 + i * 100, "volume": 100 + i},
            }
            for i in range(5)
        ]
    )
    service = MongoMarketDataService()
    monkeypatch.setattr(MongoMarketDataService, "_get_collection", lambda *_: collection)

    rows = await service.get_price_depth_precise("ssi", limit=2, include_provenance=False)

    assert [row["price"] for row in rows] == [30000, 30100]


@pytest.mark.asyncio
@pytest.mark.parametrize("dataset", ["equity.price_depth", "futures.price_depth", "crypto.price_depth"])
@pytest.mark.parametrize("identity", [{}, {"symbol": "SSI"}, {"ticker": "SSI"}, {"symbol": "SSI", "time": "2026-10-01T14:30:00"}])
async def test_price_depth_catalog_upserts_preserve_levels_and_refresh_batch(monkeypatch, identity, dataset):
    import pandas as pd

    from scripts import backfill_mongo_vnstock_full_catalog as catalog

    class StoredCursor(Cursor):
        def sort(self, pairs):
            for key, direction in reversed(pairs):
                self.rows.sort(key=lambda row: row[key], reverse=direction == -1)
            return self

    class UpsertCollection(Collection):
        def bulk_write(self, operations, *, ordered):
            for operation in operations:
                match = next(
                    (row for row in self.rows if all(row.get(key) == value for key, value in operation._filter.items())),
                    None,
                )
                if match is None:
                    match = {**operation._filter, **operation._doc.get("$setOnInsert", {})}
                    self.rows.append(match)
                match.update(operation._doc["$set"])

        def find(self, query, projection):
            return StoredCursor([
                row for row in self.rows if all(row.get(key) == value for key, value in query.items())
            ])

    collection = UpsertCollection()
    db = SimpleNamespace(market_vnstock_premium_records=collection)
    spec = catalog.MANIFEST[dataset]
    first_batch = datetime(2026, 10, 1, 15)
    monkeypatch.setattr(catalog, "_now", lambda: first_batch)
    levels = catalog._frame_rows(pd.DataFrame([
        {**identity, "price": 30000, "volume": 100, "buy_volume": 60, "sell_volume": 40},
        {**identity, "price": 29500, "volume": 50, "undefined_volume": 50},
        {**identity, "price": 30500, "volume": 25},
    ]))
    catalog._upsert_raw_rows(db, spec, "SSI", levels, dry_run=False)
    assert {row["raw"]["price"] for row in collection.rows} == {30000, 29500, 30500}
    assert len({row["recordKey"] for row in collection.rows}) == 3
    if dataset != "equity.price_depth":
        return

    service = MongoMarketDataService()
    monkeypatch.setattr(MongoMarketDataService, "_get_collection", lambda *_: collection)
    out = await service.get_price_depth_precise("ssi", include_provenance=True)
    assert {row["price"]: row["volume"] for row in out} == {30000: 100, 29500: 50, 30500: 25}
    assert len({row["recordKey"] for row in out}) == 3
    capped = await service.get_price_depth_precise("ssi", limit=2)
    assert [row["price"] for row in capped] == [row["price"] for row in out[:2]]

    second_batch = datetime(2026, 10, 1, 16)
    monkeypatch.setattr(catalog, "_now", lambda: second_batch)
    refreshed = [{**levels[0], "price": "30000.00", "volume": 120}, levels[1]]
    catalog._upsert_raw_rows(db, spec, "SSI", refreshed, dry_run=False)
    catalog._upsert_raw_rows(db, spec, "SSI", refreshed, dry_run=False)
    out = await service.get_price_depth_precise("ssi", include_provenance=True)
    assert {row["price"]: row["volume"] for row in out} == {30000: 120, 29500: 50}
    assert all(row["updatedAt"] == second_batch for row in out)
    assert all(row["createdAt"] == first_batch for row in collection.rows)
    assert len(collection.rows) == 3
