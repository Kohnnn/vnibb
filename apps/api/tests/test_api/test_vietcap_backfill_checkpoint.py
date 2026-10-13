import importlib.util
from pathlib import Path

import pytest


@pytest.fixture
def cli():
    path = Path(__file__).resolve().parents[2] / "scripts/vietcap/backfill_vietcap.py"
    spec = importlib.util.spec_from_file_location("native_backfill_checkpoint", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_default_native_inventory_is_provider_free(cli, monkeypatch, capsys, tmp_path):
    monkeypatch.setattr("sys.argv", ["backfill_vietcap.py", "--checkpoint-file", str(tmp_path / "receipt.json")])
    monkeypatch.setattr(cli.VietcapClient, "get_all_symbols", lambda *a: (_ for _ in ()).throw(AssertionError("inventory called provider")))
    assert cli._main(None) == 0
    assert '"mode": "read_only"' in capsys.readouterr().out


def test_native_checkpoint_only_skips_exact_successful_contract(cli, tmp_path):
    path = tmp_path / "checkpoint.json"
    contract = {"source": "vietcap", "count_back": 10000, "cutoff": "2026-10-13", "start": "2000-01-01"}
    state = cli.load_checkpoint(path, contract)
    cli.save_receipt(path, state, "ACB", "ohlc", "succeeded", {"rows": 1, "structured_price_rows": 1, "history_complete": None})
    cli.save_receipt(path, state, "FPT", "ohlc", "failed", {"error": "SQL failure"})
    resumed = cli.load_checkpoint(path, contract)
    assert cli.completed_pair(resumed, "ACB", "ohlc")
    assert not cli.completed_pair(resumed, "FPT", "ohlc")
    changed = cli.load_checkpoint(path, {**contract, "count_back": 1000})
    assert not cli.completed_pair(changed, "ACB", "ohlc")
    assert resumed["receipts"]["ACB"]["ohlc"]["details"]["history_complete"] is None


def test_native_cached_universe_rejects_unconfirmed_symbols(cli):
    rows = [{"symbol": "ACB", "type": "STOCK", "board": "HSX"}, {"symbol": "ABC", "type": "CW", "board": "HSX"}]
    assert list(cli.select_universe(rows, "STOCK")) == ["ACB"]
    with pytest.raises(ValueError, match="unconfirmed"):
        cli.select_universe(rows, "MISSING")


def test_listing_activates_only_confirmed_stocks_and_deactivates_delisted():
    # SQL projection is exercised by the dedicated listing writer regression.
    from vnibb.services.vietcap_financials import listing_projection
    assert listing_projection({"symbol": "ACB", "type": "STOCK", "board": "HSX"}, {})["is_active"] == 1
    assert listing_projection({"symbol": "OLD", "type": "STOCK", "board": "DELISTED"}, {})["is_active"] == 0
    assert listing_projection({"symbol": "CW", "type": "CW", "board": "HSX"}, {}) is None
