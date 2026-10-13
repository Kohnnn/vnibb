import importlib.util
from datetime import datetime
from pathlib import Path


MODULE_PATH = Path(__file__).parents[4] / "scripts" / "mongodb" / "derive_intraday_trades.py"
SPEC = importlib.util.spec_from_file_location("derive_intraday_trades", MODULE_PATH)
derivation = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(derivation)


def record(dataset="equity.intraday", **overrides):
    return {
        "dataset": dataset,
        "datasetVariant": dataset,
        "symbol": "AAA",
        "recordKey": f"{dataset}:AAA:tick-0",
        "source": "vnstock-data",
        "providerSource": "vnstock_data",
        "observedAt": datetime(2026, 10, 12, 14, 25),
        "updatedAt": datetime(2026, 10, 13, 9),
        "syncedAt": datetime(2026, 10, 13, 9),
        "raw": {"id": 0, "time": "2026-10-12T14:25:00", "price": 12.5, "volume": 200, "match_type": "BU"},
        **overrides,
    }


def test_current_flat_envelope_preserves_source_session_and_store_identity():
    raw = record(sessionDate="2026-10-12", priceUnit="thousand_vnd", unit="shares")
    trade = derivation.build_trade_doc(raw)

    assert trade["tradeId"] == "0"
    assert trade["sourceDataset"] == "equity.intraday"
    assert trade["sourceRecordKey"] == raw["recordKey"]
    assert trade["observedAt"] == raw["observedAt"]
    assert trade["sourceUpdatedAt"] == raw["updatedAt"]
    assert trade["sourceSyncedAt"] == raw["syncedAt"]
    assert trade["sessionDate"] == "2026-10-12"
    assert trade["source"] == "vnstock-data"
    assert trade["providerSource"] == "vnstock_data"
    assert trade["priceUnit"] == "thousand_vnd"
    assert trade["unit"] == "shares"
    assert trade["matchType"] == "buy"
    assert trade["storedAt"] == trade["updatedAt"]
    assert trade["latestSessionStatus"] == "unknown"


def test_legacy_ticks_remain_usable_without_inventing_provider_units():
    legacy = record("quote.intraday")
    legacy.pop("source")
    legacy.pop("providerSource")

    trade = derivation.build_trade_doc(legacy)

    assert trade["sourceDataset"] == "quote.intraday"
    assert trade["sessionDate"] == "2026-10-12"
    assert "priceUnit" not in trade
    assert "unit" not in trade
    assert "source" not in trade
    assert "providerSource" not in trade


def test_free_vci_envelope_keeps_normalized_units_and_original_coverage():
    raw = record(source="vnstock", providerSource="VCI", priceUnit="VND", volumeUnit="shares", timestampMeaning="source_trade_time", sourceDate="2026-10-12", coverage={"status": "sampled"}, latestSessionStatus="sampled")
    raw["raw"]["price"] = 12500
    doc = derivation.build_trade_doc(raw)
    assert doc["source"] == "vnstock"
    assert doc["providerSource"] == "VCI"
    assert doc["price"] == 12500
    assert doc["priceUnit"] == "VND"
    assert doc["sourceCoverage"] == raw["coverage"]
    assert doc["coverage"] == "historical_retained_window"
    assert doc["volumeUnit"] == "shares"
    assert doc["timestampMeaning"] == "source_trade_time"
    assert doc["latestSessionStatus"] == "sampled"


def test_nonempty_batch_receipt_is_not_a_trade():
    tick = record(latestSessionStatus="sampled")
    receipt = record(batchReceipt=True, recordKey="latest-batch", rowCount=1, observedAt=None, raw={}, latestSessionStatus="sampled")
    docs, report = derivation.derive_symbol_records([tick, receipt])
    assert len(docs) == 1
    assert report["latest_batch_valid_rows"] == 1
    assert report["latest_batch_status"] == "available"
    assert report["latest_session_status"] == "sampled"
    assert derivation.build_trade_doc(record(batchReceipt=True)) is None


def test_retained_rows_without_write_identity_do_not_claim_latest_batch():
    raw = record(updatedAt=None, syncedAt=None)
    docs, report = derivation.derive_symbol_records([raw])
    assert len(docs) == 1
    assert report["latest_batch_status"] == "unknown"
    assert report["latest_batch_updated_at"] is None


def test_current_records_block_legacy_fallback_and_do_not_relabel_old_tail():
    old = record(updatedAt=datetime(2026, 10, 12, 15), syncedAt=datetime(2026, 10, 12, 15))
    empty_latest = record(recordKey="current-empty", raw={}, observedAt=None)
    legacy = record("quote.intraday")
    docs, report = derivation.derive_symbol_records([legacy, old, empty_latest])

    assert len(docs) == 1
    assert docs[0]["sourceDataset"] == "equity.intraday"
    assert docs[0]["observedAt"] == old["observedAt"]
    assert docs[0]["coverage"] == "historical_retained_window"
    assert docs[0]["latestBatchStatus"] == "no_valid_trades"
    assert docs[0]["latestBatchUpdatedAt"] == empty_latest["updatedAt"]
    assert report["latest_batch_valid_rows"] == 0
    assert report["retained_valid_rows"] == 1
    assert report["latest_session_status"] == "unknown"

def test_explicit_empty_latest_batch_does_not_certify_retained_tail_as_current():
    old = record(updatedAt=datetime(2026, 10, 12, 15))
    empty = record(recordKey="empty", raw={}, rowCount=0, observedAt=None, latestSessionStatus="empty", requestedSessionDate="2026-10-13")
    docs, report = derivation.derive_symbol_records([old, empty])
    assert len(docs) == 1
    assert docs[0]["latestBatchStatus"] == "empty"
    assert docs[0]["latestSessionStatus"] == "empty"
    assert docs[0]["sessionDate"] == "2026-10-12"
    assert report["latest_batch_status"] == "empty"


def test_legacy_selected_only_when_current_dataset_is_absent():
    docs, report = derivation.derive_symbol_records([record("quote.intraday")])
    assert len(docs) == 1
    assert report["source_dataset"] == "quote.intraday"


def test_missing_trade_time_never_uses_write_time_as_market_observation():
    raw = record(raw={"price": 12.5, "volume": 200}, observedAt=None)
    assert derivation.build_trade_doc(raw) is None
    assert derivation.derive_symbol_records([])[1]["latest_batch_status"] == "unknown"


def test_offset_trade_time_keeps_local_session_and_actual_utc_observation():
    raw = record(raw={"time": "2026-10-12T00:25:00+07:00", "price": 12.5, "volume": 200}, observedAt="2026-10-12T00:25:00+07:00")
    trade = derivation.build_trade_doc(raw)
    assert trade["sessionDate"] == "2026-10-12"
    assert trade["tradeTime"] == datetime(2026, 10, 11, 17, 25)
    assert trade["observedAt"] == datetime(2026, 10, 11, 17, 25)


def test_default_database_is_canonical(monkeypatch):
    monkeypatch.delenv("MONGODB_DATABASE", raising=False)
    monkeypatch.setattr("sys.argv", ["derive_intraday_trades.py"])
    assert derivation.parse_args().database == "vnibb-market"


def test_derived_upsert_keeps_input_fixture_and_uses_identity_without_record_key():
    class Collection:
        def bulk_write(self, operations, ordered):
            self.operations = operations
            return type("Result", (), {"upserted_count": 1, "modified_count": 0})()

    raw = record(recordKey=None)
    doc = derivation.build_trade_doc(raw)
    coll = Collection()
    derivation.upsert_batch(coll, [doc])

    assert "createdAt" in doc
    assert "sourceRecordKey" not in doc
    assert coll.operations[0]._filter == {
        "symbol": "AAA", "tradeId": "0", "tradeTime": doc["tradeTime"],
    }
