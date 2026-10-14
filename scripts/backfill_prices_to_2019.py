#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import json
import time
from datetime import UTC, date, datetime
from pathlib import Path

from sqlalchemy import select
from vnibb.core.database import async_session_maker
from vnibb.models.sync_status import SyncStatus
from vnibb.services.data_pipeline import data_pipeline
from vnibb.services.mongo_eod_sync import (
    get_mongo_eod_catchup_inventory,
    run_mongo_eod_catchup,
)
from vnibb.services.sync_all_data import FullMarketSync

DATASETS = ("financials", "ratios", "reference", "market", "eod")
REFERENCE = ("profiles", "shareholders", "officers", "subsidiaries", "company_news", "company_events", "dividends", "insider_deals")
MARKET = ("indices", "market_sectors", "sector_performance")
UNIVERSE = "__universe__"
CURSOR = "universe_backfill_cursor"
HISTORY_SUPPORT = {
    "financials": "Closed FY/Q periods since requested start year; independent income/balance/cashflow receipts record unavailable periods and actual provider support. End does not filter financial periods; latest closed period is the pipeline ceiling.",
    "ratios": "FY/Q provider-returned history only; existing ratio API has no start/count control. Successful acquisition does not certify history since 2000.",
    "reference": "Current profiles/ownership/officers/subsidiaries and bounded news/events/insider samples (20/30/20); dividends are provider-returned history. No historical reference completeness claim.",
    "eod": "IQ-primary Trading history with existing free VCI fallback. Durable <=30-day windows certify acquisition, not exchange-session completeness; default end is today minus 7 days, incremental owner covers the recent tail.",
    "market": "Universe-level latest market indices plus market sector taxonomy and sector performance via existing pipeline stages; no historical depth claim.",
}


def parse_args(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Read-only full-universe ingestion inventory; --apply enables bounded durable backfill/resume.")
    parser.add_argument("command", nargs="?", choices=("inventory", "backfill", "resume"), default="inventory")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--start", "--start-date", type=date.fromisoformat, default=date(2000, 1, 1))
    parser.add_argument("--end", "--end-date", type=date.fromisoformat)
    parser.add_argument("--symbols", default="", help="Confirmed active SQL symbols; omitted selects the entire active universe.")
    parser.add_argument("--datasets", default=",".join(DATASETS))
    parser.add_argument("--max-pairs", type=int, default=50)
    parser.add_argument("--budget-seconds", type=float, default=300)
    parser.add_argument("--first-pass-only", action="store_true", help="Skip every terminal receipt, including failed; resume pending/deferred only.")
    parser.add_argument("--revalidate-empty-file", help="Exact symbol/stage pairs with expected receipt timestamps; only matching legacy empty outcomes are reacquired.")
    parser.add_argument("--window-days", type=int, default=30)
    parser.add_argument("--bootstrap-listing", action="store_true", help="With --apply, confirm fresh Trading STOCK listing and persist SQL before selection.")
    parser.add_argument("--universe-file", help="Explicit cached Trading getAll envelope for opt-in listing bootstrap; provenance is printed.")
    args = parser.parse_args(argv)
    args.datasets = list(dict.fromkeys(part.strip() for part in args.datasets.split(",") if part.strip()))
    if not args.datasets or set(args.datasets) - set(DATASETS):
        parser.error("--datasets must contain financials,ratios,reference,market,eod")
    if args.max_pairs <= 0 or args.budget_seconds <= 0 or not 1 <= args.window_days <= 30:
        parser.error("--max-pairs/--budget-seconds must be positive; --window-days must be 1..30")
    if args.end and args.start > args.end:
        parser.error("--start must not exceed --end")
    if args.command == "inventory" and args.apply:
        parser.error("inventory is read-only; use backfill/resume --apply")
    if args.universe_file and not args.bootstrap_listing:
        parser.error("--universe-file requires --bootstrap-listing")
    if args.first_pass_only and args.revalidate_empty_file:
        parser.error("--first-pass-only cannot be combined with --revalidate-empty-file")
    if args.revalidate_empty_file and (not args.apply or args.datasets != ["reference"] or args.bootstrap_listing):
        parser.error("--revalidate-empty-file requires reference-only --apply without listing bootstrap")
    args.revalidate_empty_receipts = None
    if args.revalidate_empty_file:
        try:
            targets = json.loads(Path(args.revalidate_empty_file).read_text())
            if not isinstance(targets, list) or not targets:
                raise ValueError("target list must not be empty")
            pairs = set()
            for target in targets:
                if not isinstance(target, dict) or not isinstance(target.get("symbol"), str) or not target["symbol"]:
                    raise ValueError("each target requires a symbol")
                if target.get("stage") not in REFERENCE:
                    raise ValueError("unknown reference stage")
                for field in ("expected_last_attempted_at", "expected_last_succeeded_at"):
                    datetime.fromisoformat(target[field])
                pair = (target["symbol"], target["stage"])
                if pair in pairs:
                    raise ValueError("duplicate target pair")
                pairs.add(pair)
            args.revalidate_empty_receipts = targets
        except (OSError, ValueError, KeyError, TypeError) as exc:
            parser.error(f"invalid revalidation file: {exc}")
    return args


async def resolve_symbols(symbol_arg: str) -> list[str]:
    universe = await FullMarketSync()._get_seeded_symbols()
    requested = {item.strip().upper() for item in symbol_arg.split(",") if item.strip()}
    unknown = requested - set(universe)
    if unknown:
        raise ValueError(f"Symbols not confirmed active: {','.join(sorted(unknown))}")
    return [symbol for symbol in universe if not requested or symbol in requested]


def cycle_name(args, dataset):
    suffix = str(args.start.year) if dataset == "financials" else "current"
    return f"universe_backfill_{dataset}_{suffix}"


def stages_for(args, dataset):
    if dataset == "financials":
        return [(f"financials_{period}", lambda symbol, progress, period=period: data_pipeline.sync_financials(symbols=[symbol], period=period, start_year=args.start.year, progress=progress)) for period in ("year", "quarter")]
    if dataset == "ratios":
        return [(f"ratios_{period}", lambda symbol, progress, period=period: data_pipeline.sync_financial_ratios(symbols=[symbol], period=period, progress=progress)) for period in ("year", "quarter")]
    if dataset == "market":
        return [(name, lambda symbol, progress, name=name: data_pipeline.sync_market_indices(progress=progress) if name == "indices" else getattr(data_pipeline, f"sync_{name}")()) for name in MARKET]
    methods = {name: getattr(data_pipeline, "sync_company_profiles" if name == "profiles" else f"sync_{name}") for name in REFERENCE}
    return [(name, lambda symbol, progress, name=name: methods[name](symbols=[symbol], progress=progress)) for name in REFERENCE]


def dataset_scope(dataset, symbols):
    return [UNIVERSE] if dataset == "market" else symbols


def summarize_receipts(metadata, symbols, stage_names):
    report = {"pending_count": 0, "failed_count": 0, "empty_count": 0, "unattempted_count": 0, "deferred_count": 0, "incomplete_attempt_count": 0, "attempted_terminal_count": 0, "stages": {}, "history_complete": None}
    for name in stage_names:
        state = metadata.get("stages", {}).get(name, {})
        receipts = {symbol: state.get("receipts", {}).get(symbol, {"outcome": "pending"}) for symbol in symbols}
        acquired = set(state.get("acquired_symbols", []))
        outcomes = [receipt.get("outcome") for receipt in receipts.values()]
        stage = {"pending_count": sum(symbol not in acquired for symbol in symbols),
                 "unattempted_count": outcomes.count("pending"),
                 "deferred_count": outcomes.count("deferred"),
                 "incomplete_attempt_count": outcomes.count("attempted"),
                 "attempted_terminal_count": sum(outcome in {"succeeded", "failed", "empty"} for outcome in outcomes),
                 "failed_count": outcomes.count("failed"),
                 "empty_count": outcomes.count("empty"), "receipts": receipts}
        for key in ("pending_count", "failed_count", "empty_count", "unattempted_count", "deferred_count", "incomplete_attempt_count", "attempted_terminal_count"):
            report[key] += stage[key]
        report["stages"][name] = stage
    report["acquisition_complete"] = report["pending_count"] == 0 and bool(symbols)
    report["first_pass_complete"] = bool(symbols) and not any(report[key] for key in ("unattempted_count", "deferred_count", "incomplete_attempt_count"))
    report["attempted_this_run"] = metadata.get("attempted_this_run", 0)
    return report


async def sql_inventory(args, dataset, symbols):
    async with async_session_maker() as session:
        row = (await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == cycle_name(args, dataset)).order_by(SyncStatus.id.desc()).limit(1))).first()
    report = summarize_receipts(dict(row.additional_data or {}) if row else {}, symbols, [name for name, _ in stages_for(args, dataset)])
    report.update(cycle=cycle_name(args, dataset), sync_id=row.id if row else None, status=row.status if row else "not_started")
    return report


async def collect_inventory(args, symbols):
    report = {}
    for dataset in args.datasets:
        if dataset == "eod":
            report[dataset] = await get_mongo_eod_catchup_inventory(symbols=symbols, start=args.start, end=args.end, window_days=args.window_days)
        else:
            report[dataset] = await sql_inventory(args, dataset, dataset_scope(dataset, symbols))
    return report


def rotate_datasets(datasets, cursor):
    if cursor not in datasets or datasets.index(cursor) == len(datasets) - 1:
        return list(datasets)
    cut = datasets.index(cursor) + 1
    return list(datasets[cut:]) + list(datasets[:cut])


async def load_dataset_cursor():
    async with async_session_maker() as session:
        row = (await session.scalars(select(SyncStatus).where(SyncStatus.sync_type == CURSOR).order_by(SyncStatus.id.desc()).limit(1))).first()
    return ((row.additional_data or {}).get("dataset_cursor") if row else None), row.id if row else None


async def save_dataset_cursor(sync_id, dataset):
    if sync_id is None:
        sync_id = await data_pipeline._create_sync_record(CURSOR, f"{CURSOR}-{int(time.time())}", 0)
    await data_pipeline._update_sync_record(sync_id, additional_data={"dataset_cursor": dataset})
    return sync_id


async def apply_backfill(args, symbols):
    deadline = time.monotonic() + args.budget_seconds
    remaining_pairs = args.max_pairs
    cursor, cursor_id = await load_dataset_cursor()
    results = {}
    for dataset in rotate_datasets(args.datasets, cursor):
        remaining = deadline - time.monotonic()
        if remaining <= 0 or remaining_pairs <= 0 or not symbols:
            break
        if dataset == "eod":
            try:
                async with asyncio.timeout(remaining):
                    result = await run_mongo_eod_catchup(symbols=symbols, start=args.start, end=args.end, window_days=args.window_days, max_symbols=min(50, remaining_pairs))
            except TimeoutError:
                result = {"outcome": "deferred", "reason": "run_time_budget_exhausted"}
            remaining_pairs -= int(result.get("attempted", min(50, remaining_pairs)))
            results[dataset] = result
        else:
            scope = dataset_scope(dataset, symbols)
            await FullMarketSync().run_maintenance_cycle(cycle_name(args, dataset), scope, stages_for(args, dataset), remaining, 36500, max_attempts=remaining_pairs, allow_empty=dataset in {"reference", "market"}, first_pass_only=args.first_pass_only, revalidate_empty_receipts=args.revalidate_empty_receipts)
            result = await sql_inventory(args, dataset, scope)
            remaining_pairs -= int(result.get("attempted_this_run", 0))
            results[dataset] = result
        cursor_id = await save_dataset_cursor(cursor_id, dataset)
    return results


async def bootstrap_listing(args):
    from pathlib import Path

    from vnibb.services.vietcap_client import VietcapClient
    from vnibb.services.vietcap_financials import persist_vietcap_listings

    client = VietcapClient()
    try:
        if args.universe_file:
            payload = json.loads(Path(args.universe_file).read_text())
            trading = payload["instruments"]
            provenance = {"mode": "cached", "source": payload.get("source"), "observed_at": payload.get("observed_at"), "path": args.universe_file}
        else:
            trading = await asyncio.to_thread(client.get_all_symbols)
            provenance = {"mode": "fresh", "source": "https://trading.vietcap.com.vn/api/price/symbols/getAll", "observed_at": datetime.now(UTC).date().isoformat()}
        stocks = [row for row in trading if row.get("type") == "STOCK"]
        if not stocks:
            raise ValueError("Trading STOCK listing is empty")
        search = await asyncio.to_thread(client.get_company_search_bar)
        count = await persist_vietcap_listings(stocks, search)
        if count != len(stocks):
            raise RuntimeError(f"SQL admitted {count} of {len(stocks)} confirmed STOCK listings; refusing a partial-universe backfill")
        return {**provenance, "confirmed_stock_count": len(stocks), "active_count": sum(row.get("board") != "DELISTED" for row in stocks), "persisted_rows": count}
    finally:
        close = getattr(client, "close", None)
        if close:
            close()


async def main(argv=None):
    args = parse_args(argv)
    bootstrap = None
    if args.apply and args.revalidate_empty_receipts is None and (args.bootstrap_listing or not args.symbols):
        bootstrap = await bootstrap_listing(args)
    symbols = await resolve_symbols(args.symbols)
    mutations = await apply_backfill(args, symbols) if args.apply else None
    report = {"mode": "apply" if args.apply else "read_only", "command": args.command,
              "universe": {"scope": "SQL-confirmed active instruments", "count": len(symbols), "symbols": symbols, "source_listing_bootstrap": bootstrap},
              "start": args.start, "end": args.end, "history_support": {dataset: HISTORY_SUPPORT[dataset] for dataset in args.datasets},
              "datasets": await collect_inventory(args, symbols), "run": mutations}
    print(json.dumps(report, indent=2, default=str))
    return 0 if symbols else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
