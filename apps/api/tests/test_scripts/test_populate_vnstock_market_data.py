from __future__ import annotations

import importlib.util
import json
import sys
from datetime import datetime
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import Mock

import pandas as pd
import pytest

SCRIPT_PATH = Path(__file__).resolve().parents[4] / "scripts" / "mongodb" / "populate_vnstock_market_data.py"
SPEC = importlib.util.spec_from_file_location("populate_vnstock_market_data", SCRIPT_PATH)
assert SPEC and SPEC.loader
mongo = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mongo)


def sdk_frame(rows, route, **metadata):
    frame = pd.DataFrame(rows)
    frame.attrs = {
        "source": "vci",
        "route": route,
        "requested_at": "2026-10-30T07:00:00Z",
        "access_domain": ["vietcap.com.vn"],
        **metadata,
    }
    return frame


def fetch(dataset, source="VCI", limit=1000):
    return mongo.fetch_dataset("fpt", dataset, source, limit, "2026-10-01", "2026-10-30", 2500)


@pytest.fixture
def sdk(monkeypatch):
    from vnibb.providers.vnstock import runtime

    module = ModuleType("vnstock")
    module.status = lambda: {"authenticated": False, "tier": "guest"}
    monkeypatch.setitem(sys.modules, "vnstock", module)
    monkeypatch.setattr(runtime, "validate_runtime", lambda: None)
    monkeypatch.setattr(runtime.settings, "vnstock_runtime_tier", "free")
    monkeypatch.setenv("VNSTOCK_SOURCE", "VCI")
    monkeypatch.setenv("VNSTOCK_RUNTIME_TIER", "free")
    return module


def test_history_uses_vci_ohlcv_without_rounding_or_assumed_units(sdk):
    calls = []
    frame = sdk_frame(
        [{"time": "2026-10-29", "close": 101.125}, {"time": "2026-10-30", "close": 102.345}],
        "market.equity.ohlcv",
        tier_cap_rows=2,
    )

    class Market:
        def equity(self, symbol):
            assert symbol == "FPT"
            return self

        def ohlcv(self, *, start, end, interval, source, floating):
            calls.append((start, end, interval, source, floating))
            return frame

    sdk.Market = Market
    result = fetch("quote.history", limit=1)

    assert calls == [("2026-10-01", "2026-10-30", "1D", "VCI", None)]
    assert result.rows == [{"time": "2026-10-30", "close": 102.345}]
    assert result.metadata == frame.attrs
    assert "price_unit" not in result.rows[0]


@pytest.mark.parametrize("dataset,method,route,expected_kwargs", [
    ("quote.intraday", "trades", "market.equity.trades", {"limit": 2500, "source": "VCI"}),
    ("quote.price_depth", "volume_profile", "market.equity.volume_profile", {"source": "VCI"}),
    ("company.trading_stats", "session_stats", "market.equity.session_stats", {"source": "VCI"}),
])
def test_market_routes_preserve_native_rows(sdk, dataset, method, route, expected_kwargs):
    frame = sdk_frame([{"price": 10123.45, "buy_volume": 30, "sell_volume": 20}], route)
    operation = Mock(return_value=frame)
    market = SimpleNamespace(equity=Mock(return_value=SimpleNamespace(**{method: operation})))
    sdk.Market = lambda: market

    result = fetch(dataset)

    market.equity.assert_called_once_with("FPT")
    operation.assert_called_once_with(**expected_kwargs)
    assert result.rows == frame.to_dict("records")
    assert result.metadata == frame.attrs


@pytest.mark.parametrize("dataset,method,route", [
    ("company.profile", "info", "fundamental.company.info"),
    ("company.shareholders", "shareholders", "fundamental.company.shareholders"),
    ("company.officers", "officers", "fundamental.company.officers"),
    ("company.subsidiaries", "subsidiaries", "fundamental.company.subsidiaries"),
    ("company.events", "events", "fundamental.company.events"),
])
def test_company_routes_bind_only_the_requested_method(sdk, dataset, method, route):
    frame = sdk_frame([{"symbol": "FPT", "name": "Native field", "rate": 0.25}], route)
    operation = Mock(return_value=frame)
    reference = SimpleNamespace(company=Mock(return_value=SimpleNamespace(**{method: operation})))
    sdk.Reference = lambda: reference

    result = fetch(dataset)

    reference.company.assert_called_once_with("FPT")
    operation.assert_called_once_with(source="VCI")
    assert result.rows == frame.to_dict("records")
    assert result.metadata == frame.attrs


def test_company_overview_preserves_the_native_overview_dataset(sdk):
    frame = sdk_frame([{"symbol": "FPT", "current_price": 102.345}], "fundamental.company.overview")

    class Company:
        def __init__(self, *, symbol, source):
            assert (symbol, source) == ("FPT", "VCI")

        def overview(self):
            return frame

    sdk.Company = Company
    result = fetch("company.overview")
    assert result.rows == frame.to_dict("records")
    assert result.metadata == frame.attrs


def test_board_uses_flat_unified_quotes_and_limits_each_symbol(sdk):
    frame = sdk_frame([
        {"symbol": "FPT", "last_price": 101.5},
        {"symbol": "VCB", "last_price": 88.5},
    ], "market.equity.quote")

    class Market:
        def equity(self, symbols):
            assert symbols in (["FPT", "VCB"], ["FPT"])
            self.symbols = symbols
            return self

        def quote(self, *, source):
            assert source == "VCI"
            return frame[frame["symbol"].isin(self.symbols)].copy()

    sdk.Market = Market
    grouped = mongo.fetch_price_board_batch(["fpt", "vcb"], "VCI", 1)

    assert grouped["FPT"].rows == [{"symbol": "FPT", "last_price": 101.5}]
    assert grouped["VCB"].rows == [{"symbol": "VCB", "last_price": 88.5}]
    assert grouped["FPT"].metadata == frame.attrs
    assert fetch("trading.price_board").rows == [{"symbol": "FPT", "last_price": 101.5}]


@pytest.mark.parametrize("row", [{"last_price": 100.0}, {"symbol": "VIC", "last_price": 100.0}])
def test_board_refuses_unscoped_rows(sdk, row):
    frame = sdk_frame([row], "market.equity.quote")
    sdk.Market = lambda: SimpleNamespace(equity=lambda symbols: SimpleNamespace(quote=lambda **kwargs: frame))

    with pytest.raises(ValueError, match="symbol identity"):
        mongo.fetch_price_board_batch(["FPT"], "VCI", 1)


def test_all_symbols_preserves_the_source_aware_all_symbols_route(sdk):
    frame = sdk_frame([
        {"symbol": "VCB", "organ_name": "VCB"},
        {"symbol": "FPT", "organ_name": "FPT"},
        {"symbol": "FPT", "organ_name": "FPT"},
    ], "reference.equity.list")

    class Listing:
        def __init__(self, *, source):
            assert source == "VCI"

        def all_symbols(self):
            return frame

    sdk.Listing = Listing
    assert mongo.resolve_symbols("ALL", "VCI") == ["FPT", "VCB"]


@pytest.mark.parametrize("dataset", [
    "finance.income_statement", "finance.balance_sheet", "finance.cash_flow", "finance.ratio",
])
def test_financial_acquisition_and_envelopes_require_admission_before_sdk_access(sdk, dataset):
    with pytest.raises(ValueError, match="financial admission pipeline"):
        fetch(dataset)
    with pytest.raises(ValueError, match="financial admission pipeline"):
        mongo.make_raw_record(dataset=dataset, symbol="FPT", raw={"revenue": 100}, source="VCI",
                              sync_run_id="test", metadata={})
    with pytest.raises(ValueError, match="financial admission pipeline"):
        mongo.upsert_records(object(), [{"dataset": dataset}])


@pytest.mark.parametrize("dataset,reason", [
    ("company.dividends", "no company.dividends route"),
    ("company.news", "VNSTOCK_FEATURE_REMOVED"),
    ("company.insider_deals", "schema and units are not certified"),
])
def test_uncertified_routes_fail_before_sdk_access(sdk, dataset, reason):
    with pytest.raises(ValueError, match=reason):
        fetch(dataset)


@pytest.mark.parametrize("metadata", [
    {},
    {"source": "kbs", "route": "market.equity.ohlcv", "requested_at": "2026-10-30"},
    {"source": "vci", "route": "market.equity.quote", "requested_at": "2026-10-30"},
    {"source": "vci", "route": "market.equity.ohlcv", "requested_at": "not-a-date"},
])
def test_sdk_frames_with_missing_or_conflicting_lineage_fail_closed(sdk, metadata):
    frame = pd.DataFrame([{"time": "2026-10-30", "close": 101.5}])
    frame.attrs = metadata
    sdk.Market = lambda: SimpleNamespace(equity=lambda symbol: SimpleNamespace(ohlcv=lambda **kwargs: frame))

    with pytest.raises(ValueError, match="provenance"):
        fetch("quote.history")


def test_sdk_legacy_multiindex_shape_is_refused(sdk):
    frame = sdk_frame([], "market.equity.quote")
    frame["last_price"] = [100.0]
    frame.columns = pd.MultiIndex.from_tuples([("match", "last_price")])
    sdk.Market = lambda: SimpleNamespace(equity=lambda symbols: SimpleNamespace(quote=lambda **kwargs: frame))

    with pytest.raises(ValueError, match="Unsupported SDK result shape"):
        mongo.fetch_price_board_batch(["FPT"], "VCI", 1)


@pytest.mark.parametrize("columns", [["price", "price"], [("match", "price")], [1]])
def test_ambiguous_sdk_columns_are_refused(columns):
    frame = pd.DataFrame([[100] * len(columns)], columns=columns)
    frame.attrs = sdk_frame([], "market.equity.quote").attrs
    with pytest.raises(ValueError, match="Unsupported SDK result shape"):
        mongo.read_sdk_frame(frame, source="VCI", route="market.equity.quote")


def test_write_boundary_rejects_missing_source_lineage_before_database_access():
    collection = Mock()
    with pytest.raises(ValueError, match="provenance"):
        mongo.upsert_records(collection, [{"dataset": "quote.history", "providerSource": "VCI"}])
    collection.find.assert_not_called()
    collection.bulk_write.assert_not_called()


def test_raw_envelope_retains_attrs_without_certifying_prices():
    frame = sdk_frame([{"symbol": "FPT", "time": "2026-10-30", "close": 102.345}],
                      "market.equity.ohlcv", price_unit="VND", tier_cap_rows=1)
    record = mongo.make_raw_record(dataset="quote.history", symbol="fpt", raw=frame.to_dict("records")[0],
                                   source="VCI", sync_run_id="test", metadata=frame.attrs)

    assert record["raw"]["close"] == 102.345
    assert record["providerMetadata"] == frame.attrs
    assert record["providerSource"] == "VCI"
    assert record["sdkGeneration"] == 5
    assert record["schemaVersion"] == 2
    assert record["observedAt"] == datetime(2026, 10, 30)
    assert record["normalizationStatus"] == "raw_unadmitted"
    assert record["price_unit"] == "unknown"
    assert "UNADMITTED_SDK_VALUES" in record["qualityFlags"]


def test_raw_rows_without_observed_dates_do_not_use_retrieval_time():
    frame = sdk_frame([{"symbol": "FPT", "price": 100, "volume": 30}], "market.equity.volume_profile")
    record = mongo.make_raw_record(dataset="quote.price_depth", symbol="FPT", raw=frame.to_dict("records")[0],
                                   source="VCI", sync_run_id="test", metadata=frame.attrs)
    assert record["observedAt"] is None


def test_symbol_bearing_rows_do_not_overwrite_distinct_price_levels():
    metadata = sdk_frame([], "market.equity.volume_profile").attrs
    records = [mongo.make_raw_record(dataset="quote.price_depth", symbol="FPT", raw={"symbol": "FPT", "price": price},
                                    source="VCI", sync_run_id="test", metadata=metadata) for price in (100, 101)]
    assert records[0]["recordKey"] != records[1]["recordKey"]


def test_changed_provenance_changes_content_hash():
    metadata = sdk_frame([], "market.equity.ohlcv").attrs
    kwargs = {"dataset": "quote.history", "symbol": "FPT", "raw": {"time": "2026-10-30", "close": 100},
              "source": "VCI", "sync_run_id": "test"}
    first = mongo.make_raw_record(**kwargs, metadata=metadata)
    second = mongo.make_raw_record(**kwargs, metadata={**metadata, "price_unit": "VND"})
    assert first["recordKey"] == second["recordKey"]
    assert first["contentHash"] != second["contentHash"]


def test_retrieval_time_does_not_force_unchanged_raw_content_writes():
    metadata = sdk_frame([], "market.equity.ohlcv").attrs
    kwargs = {"dataset": "quote.history", "symbol": "FPT", "raw": {"time": "2026-10-30", "close": 100},
              "source": "VCI", "sync_run_id": "test"}
    first = mongo.make_raw_record(**kwargs, metadata=metadata)
    second = mongo.make_raw_record(**kwargs, metadata={**metadata, "requested_at": "2026-10-30T08:00:00Z"})
    assert first["recordKey"] == second["recordKey"]
    assert first["contentHash"] == second["contentHash"]


@pytest.mark.parametrize("source", ["KBS", "TCBS", "MAS"])
def test_non_vci_sources_are_refused_for_every_entrypoint(sdk, source):
    with pytest.raises(ValueError, match="only free VCI"):
        fetch("quote.history", source)
    with pytest.raises(ValueError, match="only free VCI"):
        mongo.fetch_price_board_batch(["FPT"], source, 1)
    with pytest.raises(ValueError, match="only free VCI"):
        mongo.resolve_symbols("FPT", source)



def test_missing_module_tolerated_so_free_runtime_still_imports(monkeypatch):
    import builtins

    from vnibb.providers.vnstock import runtime

    monkeypatch.delitem(sys.modules, "vnstock", raising=False)
    original_import = builtins.__import__

    def block_vnstock(name, *args, **kwargs):
        if name == "vnstock":
            raise ImportError(name)
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", block_vnstock)

    # An absent SDK persists nothing; the refusal must not block the free runtime.
    runtime._refuse_persisted_paid_account()


def test_status_call_that_raises_fails_closed(sdk):
    def explode():
        raise ValueError("boom")

    sdk.status = explode
    with pytest.raises(RuntimeError, match="could not read"):
        fetch("quote.history")


@pytest.mark.parametrize("surface", ["missing", "noncallable"])
def test_missing_status_reader_fails_closed(sdk, surface):
    if surface == "missing":
        del sdk.status
    else:
        sdk.status = "not-callable"
    with pytest.raises(RuntimeError, match="cannot verify"):
        fetch("quote.history")


@pytest.mark.parametrize("state", ["authenticated", ["authenticated"]])
def test_malformed_status_fails_closed(sdk, state):
    sdk.status = lambda: state
    with pytest.raises(RuntimeError, match="malformed"):
        fetch("quote.history")


def test_authenticated_empty_tier_fails_closed(sdk):
    sdk.status = lambda: {"authenticated": True, "tier": ""}
    with pytest.raises(RuntimeError, match="no.*verifiable paid tier"):
        fetch("quote.history")


def test_persisted_paid_account_is_refused_before_acquisition(sdk):
    sdk.status = lambda: {"authenticated": True, "tier": "golden"}
    with pytest.raises(RuntimeError, match="free or guest account"):
        fetch("quote.history")


def test_cli_defaults_to_vci_and_remains_dry_run(monkeypatch):
    monkeypatch.delenv("VNSTOCK_SOURCE", raising=False)
    monkeypatch.setattr(sys, "argv", [str(SCRIPT_PATH)])
    args = mongo.parse_args()
    assert args.source == "VCI"
    assert args.apply is False


@pytest.mark.parametrize("dataset", ["finance.ratio", "company.news", "ALL"])
def test_cli_preflight_refuses_unsafe_datasets_before_mongo_or_acquisition(monkeypatch, sdk, dataset):
    monkeypatch.setattr(mongo, "load_env_file", lambda path: None)
    monkeypatch.setattr(sys, "argv", [str(SCRIPT_PATH), "--datasets", dataset, "--apply"])
    acquisition = Mock(side_effect=AssertionError("must not acquire symbols"))
    monkeypatch.setattr(mongo, "resolve_symbols", acquisition)

    with pytest.raises(SystemExit):
        mongo.main()
    acquisition.assert_not_called()


def test_cli_passes_frame_provenance_to_mongo_envelopes(monkeypatch, sdk, capsys):
    monkeypatch.setattr(mongo, "load_env_file", lambda path: None)
    monkeypatch.setattr(sys, "argv", [str(SCRIPT_PATH), "--symbols", "FPT", "--datasets", "quote.history", "--database", "frb", "--apply"])
    monkeypatch.setenv("MONGODB_URL", "mongodb://not-contacted")
    monkeypatch.setattr(mongo.time, "sleep", lambda duration: None)
    frame = sdk_frame([{"time": "2026-10-30", "close": 102.345}, {"time": "2026-10-29", "close": 101.125}],
                      "market.equity.ohlcv")
    sdk.Market = lambda: SimpleNamespace(equity=lambda symbol: SimpleNamespace(ohlcv=lambda **kwargs: frame))
    collection = object()
    pymongo = ModuleType("pymongo")
    pymongo.MongoClient = lambda *args, **kwargs: {"frb": {"market_vnstock_premium_records": collection}}
    monkeypatch.setitem(sys.modules, "pymongo", pymongo)
    writes = []

    def upsert(coll, records, *, skip_unchanged):
        assert coll is collection
        assert skip_unchanged is True
        writes.extend(records)
        return len(records), 0, 0

    monkeypatch.setattr(mongo, "upsert_records", upsert)
    assert mongo.main() == 0
    assert len(writes) == 2
    assert writes[0]["updatedAt"] == writes[1]["updatedAt"]
    assert writes[0]["providerMetadata"] == frame.attrs
    assert writes[0]["raw"]["close"] == 102.345
    assert writes[0]["price_unit"] == "unknown"
    assert '"total_errors": 0' in capsys.readouterr().out


def test_cli_reports_provenance_failure_with_nonzero_status(monkeypatch, sdk, capsys):
    monkeypatch.setattr(mongo, "load_env_file", lambda path: None)
    monkeypatch.setattr(sys, "argv", [str(SCRIPT_PATH), "--datasets", "quote.history"])
    sdk.Market = lambda: SimpleNamespace(equity=lambda symbol: SimpleNamespace(
        ohlcv=lambda **kwargs: pd.DataFrame([{"time": "2026-10-30", "close": 102.345}]),
    ))

    assert mongo.main() == 1
    output = capsys.readouterr().out
    assert '"total_fetched": 0' in output
    assert '"total_errors": 1' in output
    error = next(json.loads(line) for line in output.splitlines() if '"error"' in line)
    assert "provenance" in error["error"]


def test_cli_board_path_preserves_provenance_for_each_symbol(monkeypatch, sdk, capsys):
    monkeypatch.setattr(mongo, "load_env_file", lambda path: None)
    monkeypatch.setattr(sys, "argv", [str(SCRIPT_PATH), "--symbols", "FPT,VCB", "--datasets", "trading.price_board"])
    monkeypatch.setattr(mongo.time, "sleep", lambda duration: None)
    frame = sdk_frame([{"symbol": "FPT", "last_price": 100}, {"symbol": "VCB", "last_price": 90}],
                      "market.equity.quote")
    sdk.Market = lambda: SimpleNamespace(equity=lambda symbols: SimpleNamespace(quote=lambda **kwargs: frame))
    original = mongo.make_raw_record
    records = []

    def capture(**kwargs):
        record = original(**kwargs)
        records.append(record)
        return record

    monkeypatch.setattr(mongo, "make_raw_record", capture)
    assert mongo.main() == 0
    assert [row["symbol"] for row in records] == ["FPT", "VCB"]
    assert all(row["providerMetadata"] == frame.attrs for row in records)
    assert records[0]["updatedAt"] == records[1]["updatedAt"]
    assert '"total_fetched": 2' in capsys.readouterr().out
