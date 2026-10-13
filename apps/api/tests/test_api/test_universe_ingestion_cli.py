"""Offline contract for the opt-in, durable full-universe ingestion CLI."""
import importlib.util
import json
from datetime import date
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker


@pytest.fixture
def cli():
    path = Path(__file__).resolve().parents[4] / "scripts" / "backfill_prices_to_2019.py"
    spec = importlib.util.spec_from_file_location("universe_ingestion_cli", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
async def cli_db(cli, test_db, test_engine, monkeypatch):
    from vnibb.services import data_pipeline as data_pipeline_module

    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(cli, "async_session_maker", sessions)
    monkeypatch.setattr(data_pipeline_module, "async_session_maker", sessions)
    return cli


def test_default_is_read_only_since_2000(cli):
    args = cli.parse_args([])
    assert args.command == "inventory"
    assert not args.apply
    assert args.start == date(2000, 1, 1)
    assert args.datasets == ["financials", "ratios", "reference", "market", "eod"]


@pytest.mark.parametrize("argv", [["--max-pairs", "0"], ["--budget-seconds", "0"], ["--window-days", "0"], ["--start", "2026-02-01", "--end", "2026-01-01"], ["inventory", "--apply"]])
def test_invalid_controls_are_rejected(cli, argv):
    with pytest.raises(SystemExit):
        cli.parse_args(argv)


@pytest.mark.asyncio
async def test_full_confirmed_universe_is_not_a_run_limit(cli, monkeypatch):
    universe = [f"S{index:04d}" for index in range(1200)]

    async def seeded(self):
        return universe

    monkeypatch.setattr(cli.FullMarketSync, "_get_seeded_symbols", seeded)
    assert await cli.resolve_symbols("") == universe
    with pytest.raises(ValueError, match="not confirmed active"):
        await cli.resolve_symbols("UNKNOWN")


@pytest.mark.asyncio
@pytest.mark.parametrize("command", ["inventory", "backfill", "resume"])
async def test_no_apply_never_calls_provider_or_mutates(cli, monkeypatch, capsys, command):
    async def symbols(_):
        return ["ACB", "VNM"]

    async def inventory(args, selected):
        return {"financials": {"pending_count": 4, "failed_count": 0, "empty_count": 0}}

    async def forbidden(*args, **kwargs):
        raise AssertionError("read-only command attempted acquisition")

    monkeypatch.setattr(cli, "resolve_symbols", symbols)
    monkeypatch.setattr(cli, "collect_inventory", inventory)
    monkeypatch.setattr(cli, "apply_backfill", forbidden)
    await cli.main([command, "--datasets", "financials"])
    report = json.loads(capsys.readouterr().out)
    assert report["mode"] == "read_only"
    assert report["datasets"]["financials"]["pending_count"] == 4
    assert "history_support" in report


def test_receipt_inventory_does_not_infer_history_from_rows(cli):
    metadata = {"stages": {"financials_year": {
        "acquired_symbols": ["ACB", "VNM"], "failed_symbols": ["FPT"],
        "receipts": {
            "ACB": {"outcome": "succeeded", "rows": 1, "financial_acquisition": {"support_limited": True}},
            "VNM": {"outcome": "empty", "rows": 0},
            "FPT": {"outcome": "failed", "error": "provider unavailable"},
        },
    }}}
    report = cli.summarize_receipts(metadata, ["ACB", "VNM", "FPT", "SSI"], ["financials_year", "financials_quarter"])
    assert report["pending_count"] == 6
    assert report["failed_count"] == 1
    assert report["empty_count"] == 1
    # financials_quarter has no receipts at all: every unit is unattempted, not failed.
    assert report["unattempted_count"] == 5
    assert report["attempted_terminal_count"] == 3
    assert report["acquisition_complete"] is False
    assert report["history_complete"] is None
    assert report["stages"]["financials_year"]["receipts"]["ACB"]["financial_acquisition"]["support_limited"]


@pytest.mark.asyncio
async def test_apply_routes_real_pipeline_periods_with_pair_and_time_bounds(cli_db, monkeypatch):
    cli = cli_db
    calls = []

    async def financials(**kwargs):
        calls.append(("financials", kwargs))
        return 1

    async def ratios(**kwargs):
        calls.append(("ratios", kwargs))
        return 1

    async def cycle(self, name, symbols, stages, budget_seconds, refresh_days, **kwargs):
        calls.append(("cycle", name, symbols, budget_seconds, kwargs))
        await stages[0][1](symbols[0], {})
        await stages[1][1](symbols[0], {})
        return SimpleNamespace(success=True, complete=False, pending_count=2398)

    async def inventory(args, dataset, symbols):
        return {"attempted_this_run": 2, "pending_count": 2398}

    monkeypatch.setattr(cli.data_pipeline, "sync_financials", financials)
    monkeypatch.setattr(cli.data_pipeline, "sync_financial_ratios", ratios)
    monkeypatch.setattr(cli.FullMarketSync, "run_maintenance_cycle", cycle)
    monkeypatch.setattr(cli, "sql_inventory", inventory)
    args = cli.parse_args(["resume", "--apply", "--datasets", "financials,ratios", "--max-pairs", "2", "--budget-seconds", "5"])
    universe = [f"S{index:04d}" for index in range(1200)]
    await cli.apply_backfill(args, universe)
    cycle_call = calls[0]
    assert cycle_call[2] == universe
    assert 0 < cycle_call[3] <= 5
    assert cycle_call[4]["max_attempts"] == 2
    assert [call[1]["period"] for call in calls if call[0] == "financials"] == ["year", "quarter"]
    assert all(call[1]["start_year"] == 2000 for call in calls if call[0] == "financials")
    assert not any(name == "ratios" for name, *_ in calls)


@pytest.mark.asyncio
async def test_eod_apply_uses_historical_owner_with_bounded_windows(cli_db, monkeypatch):
    cli = cli_db
    calls = []

    async def eod(**kwargs):
        calls.append(kwargs)
        return {"pending_count": 1}

    monkeypatch.setattr(cli, "run_mongo_eod_catchup", eod)
    args = cli.parse_args(["backfill", "--apply", "--datasets", "eod", "--max-pairs", "7", "--window-days", "14"])
    await cli.apply_backfill(args, ["ACB", "FPT", "VNM"])
    assert calls[0]["symbols"] == ["ACB", "FPT", "VNM"]
    assert calls[0]["start"] == date(2000, 1, 1)
    assert calls[0]["window_days"] == 14
    assert calls[0]["max_symbols"] == 7


@pytest.mark.asyncio
async def test_market_dataset_runs_once_for_universe_scope(cli_db, monkeypatch):
    cli = cli_db
    calls = []

    async def indices(*, progress=None):
        calls.append("indices")
        return 1

    async def sectors():
        calls.append("market_sectors")
        return 1

    async def cycle(self, name, symbols, stages, budget_seconds, refresh_days, **kwargs):
        calls.append((name, symbols, [stage for stage, _ in stages], kwargs))
        return SimpleNamespace(success=True, complete=True, pending_count=0)

    async def inventory(args, dataset, symbols):
        return {"attempted_this_run": 1}

    monkeypatch.setattr(cli.data_pipeline, "sync_market_indices", indices)
    monkeypatch.setattr(cli.data_pipeline, "sync_market_sectors", sectors)
    monkeypatch.setattr(cli.FullMarketSync, "run_maintenance_cycle", cycle)
    monkeypatch.setattr(cli, "sql_inventory", inventory)
    args = cli.parse_args(["resume", "--apply", "--datasets", "market", "--max-pairs", "3"])
    await cli.apply_backfill(args, ["ACB", "FPT"])
    name, symbols, stages, kwargs = calls[0]
    assert (name, symbols) == ("universe_backfill_market_current", [cli.UNIVERSE])
    assert stages == ["indices", "market_sectors", "sector_performance"]
    assert kwargs["allow_empty"] is True


@pytest.mark.asyncio
async def test_completed_market_receipt_is_not_pending_against_equity_symbols(cli_db):
    cli = cli_db
    args = cli.parse_args(["inventory", "--datasets", "market"])
    stages = {name: {"acquired_symbols": [cli.UNIVERSE], "failed_symbols": [],
                     "receipts": {cli.UNIVERSE: {"outcome": "succeeded"}}}
              for name in cli.MARKET}
    async with cli.async_session_maker() as session:
        session.add(cli.SyncStatus(sync_type=cli.cycle_name(args, "market"), status="completed",
                                   additional_data={"stages": stages}))
        await session.commit()
    report = await cli.sql_inventory(args, "market", cli.dataset_scope("market", ["ACB", "FPT"]))
    assert report["unattempted_count"] == 0
    assert report["pending_count"] == 0
    assert report["acquisition_complete"] is True


@pytest.mark.asyncio
async def test_dataset_cursor_rotates_after_each_attempt_and_persists(cli_db, monkeypatch):
    cli = cli_db

    async def cycle(self, name, symbols, stages, budget_seconds, refresh_days, **kwargs):
        return SimpleNamespace(success=True, complete=False, pending_count=0)

    async def inventory(args, dataset, symbols):
        return {"attempted_this_run": 0}

    async def eod(**kwargs):
        return {"attempted": 0}

    monkeypatch.setattr(cli.FullMarketSync, "run_maintenance_cycle", cycle)
    monkeypatch.setattr(cli, "sql_inventory", inventory)
    monkeypatch.setattr(cli, "run_mongo_eod_catchup", eod)
    args = cli.parse_args(["resume", "--apply", "--datasets", "financials,ratios,market,eod", "--max-pairs", "5"])
    await cli.apply_backfill(args, ["ACB"])
    assert (await cli.load_dataset_cursor())[0] == "eod"
    assert cli.rotate_datasets(args.datasets, "market") == ["eod", "financials", "ratios", "market"]
    assert cli.rotate_datasets(args.datasets, None) == args.datasets
    assert cli.rotate_datasets(args.datasets, "eod") == args.datasets
