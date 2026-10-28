from copy import deepcopy
from datetime import date, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pandas as pd
import pytest
from vnibb.core.config import settings
from vnibb.models.stock import Stock
from vnibb.models.sync_status import SyncStatus
from vnibb.models.trading import ForeignTrading, IntradayTrade, OrderFlowDaily
from vnibb.providers.vnstock import runtime
from vnibb.services import (
    data_pipeline,
    mongo_market_data_service,
    sync_all_data,
    trading_acquisition,
)

REAL_FETCH_PRIMARY_TRADES = trading_acquisition.fetch_primary_trades

TRADE_DATE = date(2026, 10, 13)


class SQLStore:
    def __init__(self):
        self.symbols = []
        self.foreign = []
        self.ticks = []
        self.flows = {}
        self.cycles = {}
        self.fail_ticks = False
        self.tick_attempts = 0
        self.flow_attempts = 0

    def session(self):
        store = self

        class Session:
            def __init__(self):
                self.ticks = []
                self.flows = {}
                self.cycles = {}

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_):
                return False

            async def execute(self, statement, parameters=None):
                if statement.is_select:
                    entity = statement.column_descriptions[0]["entity"]
                    if entity is Stock:
                        return SimpleNamespace(fetchall=lambda: [(symbol,) for symbol in sorted(store.symbols)])
                    if entity is ForeignTrading:
                        rows = store.foreign
                    elif entity is IntradayTrade:
                        values = statement.compile().params
                        rows = [SimpleNamespace(**row) for row in store.ticks
                                if row["symbol"] == values["symbol_1"]
                                and values["trade_time_1"] <= row["trade_time"] < values["trade_time_2"]]
                    else:
                        raise AssertionError(f"Unexpected SQL read: {statement}")
                    return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: rows))
                if statement.table.name == IntradayTrade.__tablename__:
                    store.tick_attempts += 1
                    if store.fail_ticks:
                        raise RuntimeError("SQL ticks unavailable")
                    self.ticks.extend(deepcopy(parameters))
                elif statement.table.name == OrderFlowDaily.__tablename__:
                    store.flow_attempts += 1
                    values = deepcopy(statement.compile().params)
                    self.flows[(values["symbol"], values["trade_date"])] = values
                else:
                    raise AssertionError(f"Unexpected SQL write: {statement}")

            async def scalars(self, statement):
                assert statement.column_descriptions[0]["entity"] is SyncStatus
                sync_type = statement.compile().params["sync_type_1"]
                rows = [row for row in store.cycles.values() if row.sync_type == sync_type]
                latest = deepcopy(max(rows, key=lambda row: row.id)) if rows else None
                return SimpleNamespace(first=lambda: latest)

            def add(self, record):
                assert isinstance(record, SyncStatus)
                record.id = len(store.cycles) + 1
                self.cycles[record.id] = record

            async def get(self, model, record_id):
                assert model is SyncStatus
                record = deepcopy(store.cycles.get(record_id))
                if record is not None:
                    self.cycles[record_id] = record
                return record

            async def refresh(self, _):
                pass

            async def commit(self):
                store.ticks.extend(deepcopy(self.ticks))
                store.flows.update(deepcopy(self.flows))
                store.cycles.update(deepcopy(self.cycles))
                self.ticks.clear()
                self.flows.clear()
                self.cycles.clear()

        return Session()


class MongoStore:
    enabled = True

    def __init__(self):
        self.documents = {}
        self.fail = False
        self.attempts = 0

    def _get_collection(self, name):
        assert name == "market_vnstock_premium_records"
        return self

    def bulk_write(self, operations, *, ordered):
        assert ordered is True
        self.attempts += 1
        if self.fail:
            raise RuntimeError("Mongo ticks unavailable")
        for operation in operations:
            key = next(
                (key for key, document in self.documents.items()
                 if all(document.get(field) == value for field, value in operation._filter.items())),
                len(self.documents),
            )
            self.documents[key] = deepcopy(operation._doc)

    def trades(self, symbol):
        return [document for document in self.documents.values()
                if document["symbol"] == symbol and not document.get("batchReceipt")]


@pytest.mark.parametrize("dataset,symbol", [
    ("equity.price_depth", "FPT"), ("equity.intraday", "VCB"),
    ("equity.price_depth", "VCB"),
])
@pytest.mark.parametrize("suffix", ["2026-10-13:id:42", "latest-batch"])
def test_trade_upsert_preserves_colliding_observation(monkeypatch, dataset, symbol, suffix):
    mongo = MongoStore()
    original = {"dataset": dataset, "symbol": symbol, "recordKey": f"matched-trade:FPT:{suffix}",
                "raw": {"id": 99, "price": 50000}, "source": "retained-provider"}
    mongo.documents[0] = deepcopy(original)
    monkeypatch.setattr(mongo_market_data_service, "get_mongo_market_data_service", lambda: mongo)
    rows = [{"trade_time": datetime(2026, 10, 13, 9), "price": 12500, "volume": 12,
             "match_type": "BU", "transaction_id": 42}]
    original_rows = deepcopy(rows)
    coverage = {"provider": "vietcap:Trading", "session_date": "2026-10-13",
                "requested_session_date": "2026-10-13", "status": "sampled"}
    original_coverage = deepcopy(coverage)

    for _ in range(2):
        assert trading_acquisition.persist_mongo_trades("FPT", rows, coverage) == 1
        assert mongo.documents[0] == original
        assert len(mongo.documents) == 3

    trade = mongo.trades("FPT")[-1]
    assert trade["dataset"] == "equity.intraday"
    assert trade["recordKey"] == "matched-trade:FPT:2026-10-13:id:42"
    assert trade["raw"] == {"time": datetime(2026, 10, 13, 9), "price": 12500,
                            "volume": 12, "match_type": "BU", "id": 42}
    assert trade["source"] == "vietcap"
    assert trade["providerSource"] == "vietcap:Trading"
    receipt = next(doc for doc in mongo.documents.values() if doc.get("batchReceipt"))
    assert (receipt["dataset"], receipt["symbol"], receipt["recordKey"]) == (
        "equity.intraday", "FPT", "matched-trade:FPT:latest-batch")
    assert receipt["raw"] == {}
    assert receipt["rowCount"] == 1
    assert rows == original_rows
    assert coverage == original_coverage


@pytest.fixture
def consumer(monkeypatch):
    sql = SQLStore()
    mongo = MongoStore()
    state = SimpleNamespace(sql=sql, mongo=mongo, frames={}, failed_symbols=set(), calls=[])

    class Vnstock:
        def stock(self, *, symbol, source):
            assert source == "VCI"

            def intraday(page_size=100, last_time=None):
                state.calls.append((symbol, page_size, last_time))
                if symbol in state.failed_symbols:
                    raise RuntimeError("Provider unavailable")
                frame = state.frames[symbol].iloc[-page_size:].copy()
                frame.attrs = dict(state.frames[symbol].attrs)
                return frame

            return SimpleNamespace(quote=SimpleNamespace(intraday=intraday))

    monkeypatch.setattr(data_pipeline, "async_session_maker", sql.session)
    monkeypatch.setattr(sync_all_data, "async_session_maker", sql.session)
    monkeypatch.setattr(runtime, "get_vnstock_class", lambda: Vnstock)
    monkeypatch.setattr(runtime, "financial_provider_busy", lambda: False)
    monkeypatch.setattr(trading_acquisition, "fetch_primary_trades", Mock(side_effect=RuntimeError("Primary unavailable")))
    monkeypatch.setattr(mongo_market_data_service, "get_mongo_market_data_service", lambda: mongo)
    monkeypatch.setattr(data_pipeline.RateLimiter, "wait", AsyncMock())
    monkeypatch.setattr(data_pipeline.DataPipeline, "_is_after_market_close", lambda self: True)
    for name, value in {
        "environment": "development",
        "vnstock_source": "VCI",
        "intraday_require_market_hours": False,
        "orderflow_at_close_only": False,
        "store_intraday_trades": True,
        "cache_order_flow_per_symbol": False,
        "cache_order_flow_chunked": False,
        "big_order_threshold_vnd": 1_000_000_000,
    }.items():
        monkeypatch.setattr(settings, name, value)
    return state


def trade_frame(count=601, *, action=None, verified=True):
    frame = pd.DataFrame([
        {"time": datetime(2026, 10, 13, 9) + timedelta(seconds=index),
         "price": 12.5, "volume": index + 1,
         "match_type": action if action is not None else "BU" if index % 2 == 0 else "SD"}
        for index in range(count)
    ])
    if verified:
        frame.attrs["complete_session"] = True
    return frame


@pytest.mark.asyncio
@pytest.mark.parametrize("verified", [True, False])
async def test_consumer_persists_all_601_trades_and_only_certifies_verified_session(consumer, verified):
    consumer.frames["FPT"] = trade_frame(verified=verified)
    progress = {}

    count = await data_pipeline.DataPipeline().sync_intraday_trades(
        trade_date=TRADE_DATE, symbols=["FPT"], progress=progress, limit=500,
    )

    assert count == 601
    assert consumer.calls == [("FPT", 500, None), ("FPT", 1000, None)]
    assert len(consumer.sql.ticks) == len(consumer.mongo.trades("FPT")) == 601
    assert consumer.sql.ticks[0]["trade_time"] == datetime(2026, 10, 13, 9)
    assert consumer.sql.ticks[-1]["trade_time"] == datetime(2026, 10, 13, 9, 10)
    assert {row["price"] for row in consumer.sql.ticks} == {12_500}
    assert sum(document["raw"]["volume"] for document in consumer.mongo.trades("FPT")) == 180_901
    flow = consumer.sql.flows[("FPT", TRADE_DATE)]
    assert (flow["buy_volume"], flow["sell_volume"], flow["net_volume"]) == (90_601, 90_300, 301)
    assert (flow["buy_value"], flow["sell_value"], flow["net_value"]) == (1_132_512_500, 1_128_750_000, 3_762_500)
    assert flow["coverage"] == progress["acquisition_outcomes"]["FPT"]
    coverage = flow["coverage"]
    assert coverage["observed_trade_count"] == 601
    assert coverage["scope"] == ("full_session" if verified else "sampled")
    assert coverage["completed_session"] is verified
    assert coverage["denominator_trade_count"] == (601 if verified else None)
    assert coverage["session_fraction"] == (1.0 if verified else None)
    assert coverage["sql_ticks"] == {"status": "persisted", "rows": 601}
    assert coverage["mongo_ticks"] == {"status": "persisted", "rows": 601}
    assert coverage["sql_flows"] == {"status": "persisted", "rows": 1}
    batch = next(document for document in consumer.mongo.documents.values() if document["dataset"] == "equity.intraday" and document["symbol"] == "FPT" and document.get("batchReceipt"))
    assert batch["batchReceipt"] is True
    assert batch["rowCount"] == 601
    assert batch["coverage"]["denominator_trade_count"] == (601 if verified else None)
    assert progress.get("error_count", 0) == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("fail_sql,fail_mongo", [(True, False), (False, True), (True, True)])
async def test_consumer_store_failures_are_independent_and_flow_still_records_601_totals(consumer, fail_sql, fail_mongo):
    consumer.frames["FPT"] = trade_frame()
    consumer.sql.fail_ticks = fail_sql
    consumer.mongo.fail = fail_mongo
    progress = {}

    count = await data_pipeline.DataPipeline().sync_intraday_trades(
        trade_date=TRADE_DATE, symbols=["FPT"], progress=progress, limit=500,
    )

    assert consumer.sql.tick_attempts == consumer.mongo.attempts == consumer.sql.flow_attempts == 1
    assert count == (0 if fail_sql else 601)
    assert len(consumer.sql.ticks) == (0 if fail_sql else 601)
    assert len(consumer.mongo.trades("FPT")) == (0 if fail_mongo else 601)
    flow = consumer.sql.flows[("FPT", TRADE_DATE)]
    assert (flow["buy_volume"], flow["sell_volume"]) == (90_601, 90_300)
    coverage = progress["acquisition_outcomes"]["FPT"]
    assert coverage["sql_ticks"]["status"] == ("failed" if fail_sql else "persisted")
    assert coverage["mongo_ticks"]["status"] == ("failed" if fail_mongo else "persisted")
    assert coverage["sql_flows"] == {"status": "persisted", "rows": 1}
    assert flow["coverage"] == coverage
    assert progress["error_count"] == 1
    assert progress["stage_stats"]["intraday_trades"]["errors"] == 1
    assert progress["stage_stats"]["intraday_trades"]["success"] == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("action,count", [("BU", 601), ("ATC", 601), ("BU", 0)])
async def test_consumer_preserves_real_zero_buckets_but_unavailable_proprietary_and_block_are_null(consumer, action, count):
    consumer.frames["FPT"] = trade_frame(count, action=action)
    progress = {}

    await data_pipeline.DataPipeline().sync_intraday_trades(
        trade_date=TRADE_DATE, symbols=["FPT"], progress=progress, limit=500,
    )

    flow = consumer.sql.flows[("FPT", TRADE_DATE)]
    assert flow["sell_volume"] == (0 if count else None)
    assert flow["sell_value"] == (0.0 if count else None)
    assert flow["big_order_count"] == (0 if count else None)
    assert flow["buy_volume"] == (180_901 if count and action == "BU" else 0 if count else None)
    assert flow["block_trade_count"] is None
    assert flow["proprietary_buy_volume"] is None
    assert flow["proprietary_sell_volume"] is None
    assert flow["proprietary_net_volume"] is None
    assert progress.get("empty_count", 0) == (0 if count else 1)


@pytest.mark.asyncio
async def test_default_selector_resumes_real_durable_cycle_past_200_symbols_and_retries_failure(consumer, monkeypatch):
    symbols = [f"S{index:03d}" for index in range(205)]
    consumer.sql.symbols = list(reversed(symbols))
    consumer.frames = {symbol: trade_frame(1) for symbol in symbols}
    consumer.failed_symbols.add(symbols[0])
    monkeypatch.setattr(settings, "intraday_symbols_per_run", 100)
    first_progress = {}

    first = await data_pipeline.DataPipeline().sync_intraday_trades(
        trade_date=TRADE_DATE, progress=first_progress, limit=500,
    )

    assert first == 99
    assert first_progress["intraday_trades_cycle"] == {"complete": False, "pending_count": 106, "error_count": 1}
    first_record = deepcopy(next(iter(consumer.sql.cycles.values())))
    assert first_record.status == "partial"
    assert first_record.additional_data["last_symbol"] == "S099"
    first_stage = first_record.additional_data["stages"]["intraday_trades"]
    assert first_stage["acquired_symbols"] == symbols[1:100]
    assert first_stage["failed_symbols"] == ["S000"]
    assert first_stage["receipts"]["S000"]["outcome"] == "failed"
    assert not consumer.mongo.trades(symbols[-1])

    second_progress = {}
    second = await data_pipeline.DataPipeline().sync_intraday_trades(
        trade_date=TRADE_DATE, progress=second_progress, limit=500,
    )
    assert second == 100
    assert second_progress["intraday_trades_cycle"] == {"complete": False, "pending_count": 6, "error_count": 0}
    assert [symbol for symbol, _, _ in consumer.calls] == symbols[:200]

    consumer.failed_symbols.clear()
    final_progress = {}
    final = await data_pipeline.DataPipeline().sync_intraday_trades(
        trade_date=TRADE_DATE, progress=final_progress, limit=500,
    )

    assert final == 6
    assert final_progress["intraday_trades_cycle"] == {"complete": True, "pending_count": 0, "error_count": 0}
    assert [symbol for symbol, _, _ in consumer.calls] == symbols + ["S000"]
    assert len(consumer.sql.cycles) == 1
    final_record = next(iter(consumer.sql.cycles.values()))
    assert final_record.id == first_record.id
    assert final_record.status == "completed"
    assert final_record.additional_data["expected_symbols"] == symbols
    final_stage = final_record.additional_data["stages"]["intraday_trades"]
    assert set(final_stage["acquired_symbols"]) == set(symbols)
    assert final_stage["failed_symbols"] == []
    assert final_stage["receipts"][symbols[-1]]["outcome"] == "succeeded"
    assert final_stage["receipts"]["S000"]["outcome"] == "succeeded"
    tail = [row for row in consumer.sql.ticks if row["symbol"] == symbols[-1]]
    assert len(tail) == 1
    assert tail[0]["price"] == 12_500
    assert tail[0]["volume"] == 1
    assert consumer.mongo.trades(symbols[-1])[0]["raw"]["volume"] == 1
    assert consumer.sql.flows[(symbols[-1], TRADE_DATE)]["buy_volume"] == 1
    tail_coverage = final_stage["receipts"][symbols[-1]]["acquisition_outcomes"][symbols[-1]]
    assert tail_coverage["sql_ticks"] == {"status": "persisted", "rows": 1}
    assert tail_coverage["mongo_ticks"] == {"status": "persisted", "rows": 1}


@pytest.mark.asyncio
async def test_repeated_overlapping_sample_preserves_sql_and_mongo_tick_identity(consumer):
    consumer.frames["FPT"] = trade_frame(601, verified=False)
    for _ in range(2):
        await data_pipeline.DataPipeline().sync_intraday_trades(trade_date=TRADE_DATE, symbols=["FPT"], progress={}, limit=500)
    assert len(consumer.sql.ticks) == 601
    assert len(consumer.mongo.trades("FPT")) == 601
    consumer.frames["FPT"] = consumer.frames["FPT"].iloc[-500:].copy()
    await data_pipeline.DataPipeline().sync_intraday_trades(trade_date=TRADE_DATE, symbols=["FPT"], progress={}, limit=500)
    assert len(consumer.sql.ticks) == 601
    assert len(consumer.mongo.trades("FPT")) == 601
    assert consumer.sql.flows[("FPT", TRADE_DATE)]["coverage"]["scope"] == "sampled"


@pytest.mark.asyncio
async def test_wrong_session_request_preserves_retained_flow_and_ticks_with_failed_receipt(consumer):
    consumer.frames["FPT"] = trade_frame(3, verified=False)
    await data_pipeline.DataPipeline().sync_intraday_trades(trade_date=TRADE_DATE, symbols=["FPT"], progress={}, limit=500)
    prior_flow = dict(consumer.sql.flows[("FPT", TRADE_DATE)])
    prior_ticks = len(consumer.sql.ticks)
    consumer.frames["FPT"] = trade_frame(3, verified=False)
    consumer.frames["FPT"]["time"] = [datetime(2026, 10, 12, 9) + timedelta(seconds=index) for index in range(3)]

    progress = {}
    count = await data_pipeline.DataPipeline().sync_intraday_trades(
        trade_date=date(2026, 10, 13), symbols=["FPT"], progress=progress, limit=500,
    )

    coverage = progress["acquisition_outcomes"]["FPT"]
    assert coverage["status"] == "source_session_mismatch"
    assert coverage["session_date"] == "2026-10-12"
    assert {coverage[store]["status"] for store in ("sql_flows", "sql_ticks", "mongo_ticks")} == {"skipped"}
    assert count == 0
    assert progress["error_count"] == 1
    assert consumer.sql.flows[("FPT", TRADE_DATE)] == prior_flow
    assert len(consumer.sql.ticks) == prior_ticks
    assert len(consumer.mongo.trades("FPT")) == prior_ticks


@pytest.mark.asyncio
async def test_malformed_primary_envelope_falls_back_without_publishing_empty_batch(consumer, monkeypatch):
    class MalformedClient:
        def _unwrap(self, payload):
            return payload

        def _request(self, *args, **kwargs):
            return {"status": "failed"}

    with pytest.raises(ValueError):
        REAL_FETCH_PRIMARY_TRADES(MalformedClient(), "FPT", page_size=500)

    def malformed_primary(client, symbol, *, page_size):
        raise ValueError("Unexpected Vietcap Trading matched-trade envelope")

    monkeypatch.setattr(trading_acquisition, "fetch_primary_trades", malformed_primary)
    consumer.frames["FPT"] = trade_frame(4, verified=False)
    progress = {}

    await data_pipeline.DataPipeline().sync_intraday_trades(
        trade_date=TRADE_DATE, symbols=["FPT"], progress=progress, limit=500,
    )

    coverage = progress["acquisition_outcomes"]["FPT"]
    assert coverage["provider"] == "vnstock:VCI"
    assert coverage["mongo_ticks"] == {"status": "persisted", "rows": 4}
    assert len(consumer.mongo.trades("FPT")) == 4
    assert not [doc for doc in consumer.mongo.documents.values()
                if doc.get("batchReceipt") and doc["symbol"] == "FPT" and doc["rowCount"] == 0]
