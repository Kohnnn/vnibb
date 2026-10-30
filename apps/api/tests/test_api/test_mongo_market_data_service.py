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
    assert all(row["source"] == "vietcap" for row in rows)
    assert collection.query["symbol"] == "VNM"
    assert collection.cursor.sort_args == ("tradeDate", 1)
    assert collection.cursor.limit_value is None
    assert collection.cursor.consumed_rows == 5


@pytest.mark.asyncio
async def test_get_source_latest_trade_date_discloses_disabled(monkeypatch):
    from vnibb.services.mongo_market_data_service import settings
    monkeypatch.setattr(settings, "mongodb_enabled", False)
    service = MongoMarketDataService()
    with pytest.raises(RuntimeError, match="not_configured"):
        await service.get_source_latest_trade_date("vietcap")


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
async def test_get_source_latest_trade_date_discloses_read_error(monkeypatch):
    service = MongoMarketDataService()
    monkeypatch.setattr(
        MongoMarketDataService,
        "_get_collection",
        lambda *_: (_ for _ in ()).throw(RuntimeError("unavailable")),
    )

    with pytest.raises(RuntimeError, match="query_failed"):
        await service.get_source_latest_trade_date("vietcap")


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
        price_unit="VND",
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


@pytest.mark.parametrize("configured,end", [([], date(2026, 4, 28)), (["2026-04-28"], date(2026, 4, 29))])
def test_historical_completeness_excludes_official_and_configured_closures(monkeypatch, configured, end):
    from vnibb.api.v1 import equity

    monkeypatch.setattr(equity.settings, "market_holiday_dates", configured)
    start = date(2026, 4, 24)
    rows = [_bar(start, 10000.0), _bar(end, 12000.0)]

    assert equity._historical_rows_cover_request(rows, start, end, "1D")
    meta = equity._historical_resolution_meta(
        rows, "raw", start_date=start, end_date=end, interval="1D",
        source_counts={"mongo": 2}, mongo_docs=[{"priceUnit": "VND"}], warnings=[],
    )
    assert meta.completeness_status == "complete"
    assert not any("business-day" in warning for warning in meta.warnings)
    assert not equity._historical_rows_cover_request(rows[:1], start, end, "1D")


def test_historical_completeness_discloses_unverified_calendar_year(monkeypatch):
    from vnibb.api.v1 import equity

    monkeypatch.setattr(equity.settings, "market_holiday_dates", [])
    start, end = date(2027, 3, 8), date(2027, 3, 9)
    meta = equity._historical_resolution_meta(
        [_bar(start, 10000.0), _bar(end, 12000.0)], "raw",
        start_date=start, end_date=end, interval="1D",
        source_counts={"mongo": 2}, mongo_docs=[{"priceUnit": "VND"}], warnings=[],
    )

    assert meta.completeness_status == "complete"
    assert any("unconfigured exchange holidays" in warning for warning in meta.warnings)


@pytest.mark.asyncio
async def test_partial_mongo_and_sql_cover_request_without_provider(client, monkeypatch):
    from vnibb.api.v1 import equity

    async def fake_mongo(*args, **kwargs):
        return ([_bar(date(2026, 6, 8), 10.0)], [{"priceUnit": "VND"}])

    async def fake_cache(*args, **kwargs):
        return SimpleNamespace(hit=False, data=None)

    async def fake_recent(*args, **kwargs):
        return []

    async def fake_db(*args, **kwargs):
        return [_bar(date(2026, 6, 9), 11.0), _bar(date(2026, 6, 10), 12.0)]

    from unittest.mock import AsyncMock
    provider = AsyncMock(side_effect=AssertionError("covered history must not request provider"))

    monkeypatch.setattr(equity, "_load_historical_from_mongo", fake_mongo)
    monkeypatch.setattr(equity.CacheManager, "get_historical_prices", fake_cache)
    monkeypatch.setattr(equity, "_load_historical_from_recent_cache", fake_recent)
    monkeypatch.setattr(equity, "_load_historical_from_db", fake_db)
    monkeypatch.setattr(equity.VnstockEquityHistoricalFetcher, "fetch", provider)

    response = await client.get(
        "/api/v1/equity/historical?symbol=VNM&start_date=2026-06-08&end_date=2026-06-10"
    )

    payload = response.json()
    assert response.status_code == 200
    assert [row["time"] for row in payload["data"]] == ["2026-06-08", "2026-06-09", "2026-06-10"]
    assert payload["meta"]["source_counts"] == {"mongo": 1, "db": 2}
    assert payload["meta"]["fallback_used"] is True
    assert all(row["price_unit"] == "VND" for row in payload["data"])
    provider.assert_not_awaited()


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
async def test_precise_iq_reader_filters_source_and_keeps_descriptor_evidence(monkeypatch):
    collection = Collection()
    service = MongoMarketDataService()
    monkeypatch.setattr(MongoMarketDataService, "_get_collection", lambda *_: collection)
    await service.get_raw_dataset_records_precise(
        "vnm", dataset="finance.income_statement", variant="finance.income_statement.year",
        source="vietcap",
    )
    assert collection.query["source"] == "vietcap"
    assert collection.query["datasetVariant"] == "finance.income_statement.year"
    assert collection.projection == {"_id": 0}
    assert collection.cursor.sort_args == (
        [("fiscalYear", -1), ("fiscalQuarter", -1), ("updatedAt", -1), ("recordKey", 1)],
    )


@pytest.mark.asyncio
async def test_precise_iq_reader_does_not_hide_database_failure(monkeypatch):
    service = MongoMarketDataService()
    collection = Collection(error=RuntimeError("Mongo unavailable"))
    monkeypatch.setattr(MongoMarketDataService, "_get_collection", lambda *_: collection)
    with pytest.raises(RuntimeError, match="query_failed"):
        await service.get_raw_dataset_records_precise(
            "vnm", dataset="finance.ratio", source="vietcap",
        )
    with pytest.raises(RuntimeError, match="query_failed"):
        await service.get_raw_dataset_records_precise("vnm", dataset="finance.ratio")



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


@pytest.mark.parametrize("writer", ["statement", "ratio"])
def test_vietcap_raw_upserts_preserve_periods_and_refresh_without_duplicates(writer):
    from vnibb.services.vietcap_financials import financial_fiscal_basis
    from vnibb.services.vietcap_ingestion import upsert_ratio_rows, upsert_statement_periods

    class UpsertCollection(Collection):
        def bulk_write(self, operations, *, ordered):
            assert ordered is False
            for operation in operations:
                assert set(operation._filter) == {"dataset", "symbol", "recordKey"}
                match = next(
                    (row for row in self.rows if all(row.get(key) == value for key, value in operation._filter.items())),
                    None,
                )
                if match is None:
                    match = {**operation._filter, **operation._doc.get("$setOnInsert", {})}
                    self.rows.append(match)
                match.update(operation._doc["$set"])

    collection = UpsertCollection()
    db = {"market_vnstock_premium_records": collection}
    first_batch = datetime(2026, 10, 1, 15)
    second_batch = datetime(2026, 10, 1, 16)
    rows = [
        {"yearReport": 2025, "lengthReport": 5, "value": 100},
        {"yearReport": 2024, "lengthReport": 5, "value": 50},
    ]

    def write(raw_rows, received_at, *, dry_run=False):
        if writer == "ratio":
            return upsert_ratio_rows(db, "vnm", raw_rows, received_at=received_at, dry_run=dry_run)
        return upsert_statement_periods(
            db, "vnm", "finance.income_statement", "INCOME_STATEMENT", {"years": raw_rows},
            received_at=received_at, dry_run=dry_run,
        )

    assert write(rows, first_batch, dry_run=True) == 2
    assert collection.rows == []
    assert write(rows, first_batch) == 2
    assert len(collection.rows) == 2
    assert len({row["recordKey"] for row in collection.rows}) == 2
    original_keys = {row["raw"]["yearReport"]: row["recordKey"] for row in collection.rows}
    assert all(row["symbol"] == "VNM" and row["source"] == "vietcap" for row in collection.rows)

    refreshed = [{**rows[0], "value": 120}]
    assert write(refreshed, second_batch) == 1
    assert write(refreshed, second_batch) == 1
    assert len(collection.rows) == 2
    latest = next(row for row in collection.rows if row["raw"]["yearReport"] == 2025)
    assert latest["raw"]["lengthReport"] == 5
    assert financial_fiscal_basis(latest)["periodType"] == "year"
    assert financial_fiscal_basis(latest)["year"] == 2025
    assert latest["recordKey"] == original_keys[2025]
    assert latest["raw"]["value"] == 120
    assert latest["updatedAt"] == second_batch
    assert all(row["createdAt"] == first_batch for row in collection.rows)
    previous = next(row for row in collection.rows if row["raw"]["yearReport"] == 2024)
    assert financial_fiscal_basis(previous)["periodType"] == "year"
    assert financial_fiscal_basis(previous)["year"] == 2024
    assert previous["updatedAt"] == first_batch


@pytest.mark.parametrize("failed_section", [None, "BALANCE_SHEET", "RATIO"])
def test_vietcap_financial_sync_propagates_provider_failure(failed_section):
    from vnibb.services.vietcap_ingestion import FinancialAcquisitionPartial, sync_symbol_financials

    sections = ("INCOME_STATEMENT", "BALANCE_SHEET", "CASH_FLOW")

    class Client:
        def get_financial_metrics_map(self, symbol):
            return {section: [{"field": "opaque", "titleEn": "Unknown"}] for section in sections}

        def get_financial_statement(self, symbol, section):
            if section == failed_section:
                raise RuntimeError("provider unavailable")
            return {"years": [{"yearReport": 2025, "lengthReport": 5}]}

        def get_statistics_financial(self, symbol):
            if failed_section == "RATIO":
                raise RuntimeError("provider unavailable")
            return [{"yearReport": 2025, "ratioType": "ROE", "value": 15}]

    if failed_section:
        with pytest.raises(FinancialAcquisitionPartial, match="provider unavailable") as raised:
            sync_symbol_financials({}, Client(), "VNM", com_type="CT", dry_run=True)
        partial = raised.value
        missing = "finance.ratio" if failed_section == "RATIO" else "finance.balance_sheet"
        assert partial.errors == {missing: "provider unavailable"}
        assert partial.mongo_rows == 3
        assert len(partial.records) == 3
        assert "finance.income_statement" in {record["dataset"] for record in partial.records}
        assert missing not in {record["dataset"] for record in partial.records}
        assert all("raw" in record and "structured" in record for record in partial.records)
        return

    records = sync_symbol_financials({}, Client(), "VNM", com_type="CT", dry_run=True)
    assert {record["dataset"] for record in records} == {
        "finance.income_statement", "finance.balance_sheet", "finance.cash_flow", "finance.ratio",
    }
    assert all(record["symbol"] == "VNM" and record["providerSource"] == "vietcap" for record in records)


@pytest.mark.asyncio
async def test_fundamental_reader_withholds_legacy_interest_score_preserving_independent_facts(monkeypatch):
    documents = [
        {"symbol": symbol, "schemaVersion": version, "moatScore": 95.0,
         "moatFactors": {"interest_coverage": 8.0, "gross_margin_avg": 42.0},
         "roe": 18.0, "netMargin": 15.0, "moat": "wide"}
        for symbol, version in (("OLD", 2), ("NEW", 3))
    ]

    class FundamentalCollection:
        def aggregate(self, _pipeline):
            return [{"doc": dict(document)} for document in documents]

    service = MongoMarketDataService()
    monkeypatch.setattr(service, "_get_collection", lambda _: FundamentalCollection())

    snapshots = await service.get_latest_fundamental_snapshots(["OLD", "NEW"])

    assert snapshots["OLD"].get("moatScore") is None
    assert "interest_coverage" not in snapshots["OLD"]["moatFactors"]
    assert snapshots["OLD"]["moatFactors"]["gross_margin_avg"] == 42.0
    assert snapshots["OLD"]["roe"] == 18.0
    assert snapshots["OLD"]["netMargin"] == 15.0
    assert snapshots["OLD"]["moat"] is None
    assert snapshots["NEW"]["moatScore"] == 95.0
    assert snapshots["NEW"]["moatFactors"]["interest_coverage"] == 8.0
    assert snapshots["NEW"]["moat"] == "wide"
    assert documents[0]["moatFactors"]["interest_coverage"] == 8.0
    assert documents[0]["moatScore"] == 95.0
    assert documents[0]["moat"] == "wide"
