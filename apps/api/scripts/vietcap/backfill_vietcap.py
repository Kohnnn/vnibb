#!/usr/bin/env python3
"""Backfill canonical n6v MongoDB market data from public Vietcap endpoints.

Vietcap is the PRIMARY source. Dry-run is the default; pass --apply to write.

Targets (database: vnibb-market):
  market_prices_eod              EOD OHLCV for stocks + indices (source="vietcap", raw VND)
  market_prices_cw               EOD OHLCV for covered warrants (separate, noisy/short-lived)
  market_prices_derivatives      EOD OHLCV for futures/derivatives (separate)
  market_prices_bond             EOD OHLCV for bonds/debentures (separate)
  market_vnstock_premium_records financial statements / ratios / shareholders (source="vietcap")
  market_financial_metric_map    bounded descriptor document per symbol/type/section/source
  market_company_profiles        company master + sector + analyst (details + search-bar)
  market_index_constituents      index membership from getByGroup

See vnibb/docs/VIETCAP_DATA_SOURCE.md for the full data contract and provenance rules.

Units: prices stored as RAW VND exactly as Vietcap returns them. The legacy
vnstock-data rows are in thousand-VND; the documented convention is that the
vnstock path multiplies by 1000 when it later needs parity. We do NOT rescale here.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from copy import deepcopy
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

_SELF = Path(__file__).resolve()
# In-repo this file is .../vnibb/apps/api/scripts/vietcap/backfill_vietcap.py
# (parents[4] == vnibb); in the container image it lives at /app/scripts/vietcap/
# with no such depth, so guard the index to avoid IndexError at import time.
REPO_ROOT = _SELF.parents[4] if len(_SELF.parents) > 4 else _SELF.parent
API_ROOT = REPO_ROOT / "apps" / "api"
WORKSPACE_ROOT = REPO_ROOT.parent  # .../VNIBB (holds the canonical .env)

sys.path.insert(0, str(_SELF.parents[2]))
from vnibb.services import vietcap_ingestion as w  # noqa: E402
from vnibb.services.vietcap_client import VietcapClient  # noqa: E402
from vnibb.services.vietcap_ingestion import ohlc_rows_from_gap_chart  # noqa: E402

# Instrument type -> EOD collection. STOCK and indices share the canonical corpus.
PRICE_COLLECTION_BY_TYPE: dict[str, str] = {
    "STOCK": "market_prices_eod",
    "ETF": "market_prices_eod",
    "FUND": "market_prices_eod",
    "UNIT_TRUST": "market_prices_eod",
    "CW": "market_prices_cw",
    "FU": "market_prices_derivatives",
    "BOND": "market_prices_bond",
    "DEBENTURE": "market_prices_bond",
}

# Acquisition order for per-symbol pairs; the durable cursor is a true (symbol, dataset) pair.
PAIR_ORDER = ("ohlc", "financials", "ratios", "company", "shareholders")



def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)








# ---------------------------------------------------------------------------
# OHLC / price history
# ---------------------------------------------------------------------------



def upsert_eod_rows(db: Any, collection: str, symbol: str, rows: list[dict[str, Any]], *, dry_run: bool) -> int:
    from pymongo import UpdateOne

    synced_at = _now()
    symbol_upper = symbol.upper()
    ops: list[Any] = []
    count = 0
    for row in rows:
        trade_date = row["tradeDate"]
        if row.get("priceUnit") not in {"VND", "index_points"}:
            raise ValueError(f"Source price unit unavailable for {symbol}")
        doc = {
            "symbol": symbol_upper,
            "tradeDate": trade_date,
            "interval": "1D",
            "source": "vietcap",
            "sourceKey": f"vietcap:{symbol_upper}:eod:{trade_date.date().isoformat()}",
            "open": row.get("open"),
            "high": row.get("high"),
            "low": row.get("low"),
            "close": row.get("close"),
            "volume": row.get("volume"),
            "accumulatedVolume": row.get("accumulatedVolume"),
            "accumulatedValue": row.get("accumulatedValue"),
            "priceUnit": row["priceUnit"],
            "raw": row.get("raw"),
            "sourceUnitEvidence": row.get("sourceUnitEvidence"),
            "providerSource": "vietcap",
            "receivedAt": synced_at,
            "updatedAt": synced_at,
            "syncedAt": synced_at,
            "schemaVersion": 1,
        }
        count += 1
        if dry_run:
            continue
        ops.append(
            UpdateOne(
                {"symbol": symbol_upper, "tradeDate": trade_date, "source": "vietcap"},
                {"$set": doc, "$setOnInsert": {"createdAt": synced_at}},
                upsert=True,
            )
        )
    if ops:
        db[collection].bulk_write(ops, ordered=False)
    return count


# ---------------------------------------------------------------------------
# Universe resolution
# ---------------------------------------------------------------------------

def select_universe(rows: list[dict[str, Any]], selector: str) -> dict[str, dict[str, Any]]:
    by_symbol = {str(row["symbol"]).upper(): row for row in rows if row.get("symbol")}
    selector = selector.strip().upper()
    if selector == "ALL":
        return by_symbol
    if selector in {"STOCK", "ETF", "FUND", "UNIT_TRUST", "CW", "FU", "BOND", "DEBENTURE"}:
        return {symbol: row for symbol, row in by_symbol.items() if row.get("type") == selector}
    requested = {symbol.strip().upper() for symbol in selector.split(",") if symbol.strip()}
    if requested - set(by_symbol):
        raise ValueError(f"unconfirmed symbols: {','.join(sorted(requested - set(by_symbol)))}")
    return {symbol: by_symbol[symbol] for symbol in sorted(requested)}


def load_checkpoint(path: Path, contract: dict[str, Any]) -> dict[str, Any]:
    state = json.loads(path.read_text()) if path.exists() else {}
    if state.get("contract") != contract:
        return {"contract": contract, "receipts": {}, "previous_contract": state.get("contract")}
    return state


def completed_pair(state: dict[str, Any], symbol: str, dataset: str) -> bool:
    return state.get("receipts", {}).get(symbol, {}).get(dataset, {}).get("outcome") == "succeeded"


def save_receipt(path: Path, state: dict[str, Any], symbol: str, dataset: str, outcome: str, details: dict[str, Any]) -> None:
    snapshot = deepcopy(details)
    state.setdefault("receipts", {}).setdefault(symbol, {})[dataset] = {"outcome": outcome, "recorded_at": _now().isoformat(), "details": snapshot}
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(state, indent=2, default=str))
    temporary.replace(path)


def checkpoint_inventory(state: dict[str, Any], symbols: list[str], datasets: set[str]) -> dict[str, Any]:
    report = {}
    for dataset in sorted(datasets):
        targets = ["__universe__"] if dataset in {"listing", "icb"} else INDEX_GROUPS if dataset == "indices" else symbols
        receipts = {symbol: state.get("receipts", {}).get(symbol, {}).get(dataset, {"outcome": "pending"}) for symbol in targets}
        outcomes = [row.get("outcome") for row in receipts.values()]
        report[dataset] = {"expected": len(targets), "pending": sum(outcome != "succeeded" for outcome in outcomes),
                           "unattempted": outcomes.count("pending") + outcomes.count("attempted"),
                           "attempted_terminal": sum(outcome in {"succeeded", "failed", "empty"} for outcome in outcomes),
                           "failed": outcomes.count("failed"), "empty": outcomes.count("empty"),
                           "receipts": receipts, "history_complete": None}
    return report


def resolve_universe(client: VietcapClient, raw_symbols: str) -> dict[str, dict[str, Any]]:
    """Return {symbol: {type, board, organName...}} for the requested universe.

    raw_symbols == 'ALL' -> every instrument from getAll.
    raw_symbols == 'STOCK' (or other type) -> filter getAll by type.
    Otherwise treat as comma-separated explicit list (type looked up from getAll).
    """
    return select_universe(client.get_all_symbols(), raw_symbols)


def price_collection_for(instrument_type: str | None) -> str:
    return PRICE_COLLECTION_BY_TYPE.get(str(instrument_type or "STOCK").upper(), "market_prices_eod")




# ---------------------------------------------------------------------------
# Index groups worth materializing
# ---------------------------------------------------------------------------

INDEX_GROUPS = [
    "VN30", "VN100", "HNX30", "HOSE", "HNX", "UPCOM",
    "ETF", "CW", "BOND", "FU_INDEX", "FU_BOND",
]


def main() -> int:
    import asyncio

    with asyncio.Runner() as runner:
        try:
            return _main(runner)
        finally:
            database = sys.modules.get("vnibb.core.database")
            engine = getattr(database, "engine", None)
            if engine is not None:
                runner.run(engine.dispose())


def _main(runner: Any) -> int:
    load_env_file(WORKSPACE_ROOT / ".env")
    load_env_file(REPO_ROOT / ".env")
    load_env_file(API_ROOT / ".env")

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", nargs="?", choices=("inventory", "backfill", "resume", "migrate-metric-maps"), default="backfill")
    parser.add_argument("--symbols", default="STOCK", help="Confirmed Trading symbols, instrument type, or ALL; default entire STOCK universe")
    parser.add_argument(
        "--datasets",
        default="ohlc,financials,ratios,company,shareholders",
        help="Comma list of: ohlc,financials,ratios,company,shareholders,listing,indices,icb or 'all'",
    )
    parser.add_argument("--count-back", type=int, default=10000)
    parser.add_argument("--apply", action="store_true", help="Opt in to writes (migration is provider-free; backfill/resume acquire providers).")
    parser.add_argument("--ensure-indexes", action="store_true")
    parser.add_argument("--max-pairs", type=int, default=50, help="Maximum symbol/dataset attempts; never truncates universe")
    parser.add_argument("--budget-seconds", type=float, default=300)
    parser.add_argument("--start", type=date.fromisoformat, default=date(2000, 1, 1))
    parser.add_argument("--cutoff", type=date.fromisoformat, default=datetime.now(UTC).date())
    parser.add_argument("--checkpoint-file", type=Path, default=Path(os.getenv("VNIBB_BACKFILL_CHECKPOINT", "/var/lib/vnibb/vietcap_backfill.json")))
    parser.add_argument("--universe-file", type=Path, help="Explicit cached Trading getAll envelope; source/freshness are printed")
    args = parser.parse_args()

    if args.command == "migrate-metric-maps":
        mongo_url = os.getenv("MONGODB_URL")
        if not mongo_url:
            raise SystemExit("MONGODB_URL is required for metric-map inventory/migration")
        from pymongo import MongoClient
        with MongoClient(mongo_url, serverSelectionTimeoutMS=10000) as mongo:
            report = w.migrate_metric_maps(mongo[os.getenv("MONGODB_DATABASE", "vnibb-market")], apply=args.apply)
        print(json.dumps({"mode": "apply" if args.apply else "read_only", **report}, default=str))
        return 0

    allowed = {"ohlc", "financials", "ratios", "company", "shareholders", "listing", "indices", "icb"}
    selected = {d.strip().lower() for d in args.datasets.split(",") if d.strip()}
    if not selected or selected - allowed - {"all"}:
        parser.error("--datasets must contain supported dataset names")
    if "all" in selected:
        selected = allowed
    if args.max_pairs <= 0 or args.count_back <= 0 or args.budget_seconds <= 0 or args.start > args.cutoff:
        parser.error("positive count/pair/time bounds and --start <= --cutoff are required")
    if args.command == "inventory" and args.apply:
        parser.error("inventory is read-only; use backfill/resume --apply")
    contract = {"source": "vietcap", "count_back": args.count_back, "cutoff": args.cutoff.isoformat(), "start": args.start.isoformat()}
    state = load_checkpoint(args.checkpoint_file, contract)
    cached = json.loads(args.universe_file.read_text()) if args.universe_file else None
    universe = select_universe(cached["instruments"], args.symbols) if cached else {}
    if not args.apply:
        symbols = sorted(universe) if cached else sorted(state.get("universe", {}))
        print(json.dumps({"mode": "read_only", "contract": contract, "universe_count": len(symbols), "universe_source": cached.get("source") if cached else state.get("universe_source"), "datasets": checkpoint_inventory(state, symbols, selected), "support": "Provider-free receipt inventory; no listing discovery without --apply or explicit --universe-file. Successful countBack acquisition is not exchange-session or since-2000 completeness."}, indent=2, default=str))
        return 0
    deadline = time.monotonic() + args.budget_seconds
    attempted = 0
    client = VietcapClient()
    failures = 0
    unavailable = 0
    totals: dict[str, int] = {}

    def require_data(value: Any, label: str) -> Any:
        if not value:
            raise ValueError(f"Requested data unavailable: {label}")
        return value

    def record_error(exc: Exception) -> None:
        nonlocal failures, unavailable
        failures += 1
        unavailable += int(isinstance(exc, ValueError))

    db = None
    if args.apply:
        mongo_url = os.getenv("MONGODB_URL")
        if not mongo_url:
            raise SystemExit("MONGODB_URL is required with --apply")
        mongo_db = os.getenv("MONGODB_DATABASE", "vnibb-market")
        from pymongo import MongoClient

        client_db = MongoClient(mongo_url, serverSelectionTimeoutMS=10000)
        db = client_db[mongo_db]
        if args.apply and args.ensure_indexes:
            _ensure_indexes(db)

    # Indices + ICB are universe-level, run once.
    search_index: dict[str, dict[str, Any]] = {}
    if selected & {"company", "financials", "ratios", "listing"} or (args.apply and "ohlc" in selected):
        try:
            for row in require_data(client.get_company_search_bar(), "search-bar"):
                code = str(row.get("code") or "").upper()
                if code:
                    search_index[code] = row
        except Exception as exc:  # noqa: BLE001
            record_error(exc)
            print(json.dumps({"step": "search-bar", "error": str(exc)}))

    def claim_pair(symbol: str, dataset: str) -> bool:
        nonlocal attempted
        if completed_pair(state, symbol, dataset) or attempted >= args.max_pairs or time.monotonic() >= deadline:
            return False
        if resume_pair >= 0 and symbol == symbols[0] and PAIR_ORDER.index(dataset) <= resume_pair:
            return False
        attempted += 1
        state["last_symbol"] = symbol
        state["last_dataset"] = dataset
        save_receipt(args.checkpoint_file, state, symbol, dataset, "attempted", {"history_complete": None})
        return True
    if "indices" in selected:
        for group in INDEX_GROUPS:
            if not claim_pair(group, "indices"):
                continue
            try:
                members = [str(r.get("symbol") or "") for r in client.get_symbols_by_group(group)]
                require_data(members, f"index {group}")
                n = w.upsert_index_constituents(db, group, members, dry_run=not args.apply) if (db is not None or not args.apply) else 0
                totals["index_members"] = totals.get("index_members", 0) + n
                print(json.dumps({"step": "indices", "group": group, "members": n}))
                save_receipt(args.checkpoint_file, state, group, "indices", "succeeded", {"members": n, "history_complete": None})
            except Exception as exc:  # noqa: BLE001
                record_error(exc)
                print(json.dumps({"step": "indices", "group": group, "error": str(exc)}))
                save_receipt(args.checkpoint_file, state, group, "indices", "failed", {"error": str(exc)})

    if "icb" in selected and claim_pair("__universe__", "icb"):
        try:
            rows = require_data(client.get_icb_codes(), "icb")
            n = w.upsert_icb_sectors(db, rows, dry_run=not args.apply)
            totals["icb_sectors"] = n
            print(json.dumps({"step": "icb", "sectors": n}))
            save_receipt(args.checkpoint_file, state, "__universe__", "icb", "succeeded", {"sectors": n, "history_complete": None})
        except Exception as exc:  # noqa: BLE001
            record_error(exc)
            print(json.dumps({"step": "icb", "error": str(exc)}))
            save_receipt(args.checkpoint_file, state, "__universe__", "icb", "failed", {"error": str(exc)})

    try:
        universe = require_data(universe or resolve_universe(client, args.symbols), "symbol universe")
    except Exception as exc:
        record_error(exc)
        print(json.dumps({"totals": totals, "errors": failures, "unavailable": unavailable, "error": str(exc)}))
        return 1
    symbols = sorted(universe)
    last_symbol, last_dataset = state.get("last_symbol"), state.get("last_dataset")
    resume_pair = PAIR_ORDER.index(last_dataset) if last_dataset in PAIR_ORDER and last_symbol in symbols else -1
    if resume_pair >= 0:
        symbols = symbols[symbols.index(last_symbol):] + symbols[:symbols.index(last_symbol)]

    state["universe"] = universe
    state["universe_source"] = {"mode": "cached" if cached else "fresh", "source": cached.get("source") if cached else "https://trading.vietcap.com.vn/api/price/symbols/getAll", "observed_at": cached.get("observed_at") if cached else _now().isoformat()}
    save_receipt(args.checkpoint_file, state, "__universe__", "listing_discovery", "succeeded", state["universe_source"])


    print(json.dumps({
        "mode": "apply",
        "database": os.getenv("MONGODB_DATABASE", "vnibb-market"),
        "datasets": sorted(selected),
        "symbol_count": len(symbols),
        "universe_source": state["universe_source"],
    }, indent=2))


    def _add(key: str, value: int) -> None:
        totals[key] = totals.get(key, 0) + int(value or 0)

    def report_structured(records: list[dict[str, Any]], summary: dict[str, Any]) -> None:
        summary["structured_fields"] = sum(len(row.get("structured", {}).get("values", {})) for row in records)
        summary["unavailable_fields"] = sum(len(row.get("structured", {}).get("unavailable", {})) for row in records)
        datasets = {row["dataset"] for row in records}
        admitted = {row["dataset"] for row in records if row.get("structured", {}).get("values")}
        summary["unavailable_structured_datasets"] = sorted(datasets - admitted)

    def report_persistence_error(exc: Exception, summary: dict[str, Any], count_key: str = "structured_rows") -> None:
        from vnibb.services.cache_manager import StructuredPersistenceConflict
        from vnibb.services.vietcap_financials import StructuredFinancialUnavailable

        if isinstance(exc, (StructuredFinancialUnavailable, StructuredPersistenceConflict)):
            summary[count_key] = exc.persisted_rows
            _add(count_key, exc.persisted_rows)
            if isinstance(exc, StructuredFinancialUnavailable):
                summary["unavailable_structured_groups"] = exc.unavailable_groups
            else:
                summary["structured_conflicting_keys"] = exc.conflicting_keys
        record_error(exc)


    listing_symbols = symbols if "listing" in selected else [
        symbol for symbol in symbols
        if args.apply and "ohlc" in selected and universe[symbol].get("type") == "STOCK"
    ]
    if listing_symbols:
        try:
            trading = [universe[symbol] for symbol in listing_symbols]
            search = [search_index[symbol] for symbol in listing_symbols if symbol in search_index]
            missing = [symbol for symbol in listing_symbols if not universe[symbol].get("type")]
            if missing:
                raise ValueError(f"Listing type unavailable for {','.join(missing)}")
            totals["listing_rows"] = w.upsert_listing_rows(db, trading, search, dry_run=not args.apply)
            if args.apply:
                from vnibb.services.vietcap_financials import persist_vietcap_listings
                stock_trading = [row for row in trading if row.get("type") == "STOCK"]
                totals["structured_listing_rows"] = runner.run(persist_vietcap_listings(stock_trading, search)) if stock_trading else 0
                save_receipt(args.checkpoint_file, state, "__universe__", "listing", "succeeded", {"mongo_rows": totals["listing_rows"], "sql_rows": totals["structured_listing_rows"], "confirmed_count": len(trading), "confirmed_stock_count": len(stock_trading), "missing_supplementary_search": [row["symbol"] for row in trading if row["symbol"] not in search_index], "history_complete": None})
        except Exception as exc:
            listing_summary = {"step": "listing", "error": str(exc)}
            report_persistence_error(exc, listing_summary, "structured_listing_rows")
            print(json.dumps(listing_summary, default=str))
            save_receipt(args.checkpoint_file, state, "__universe__", "listing", "failed", listing_summary)
            return 1

    for idx, symbol in enumerate(symbols, 1):
        if attempted >= args.max_pairs or time.monotonic() >= deadline:
            break
        meta = universe.get(symbol, {})
        com_type = search_index.get(symbol, {}).get("comTypeCode")
        row_summary: dict[str, Any] = {"symbol": symbol, "i": idx, "type": meta.get("type")}

        if "ohlc" in selected and claim_pair(symbol, "ohlc"):
            try:
                raw = None
                cutoff_epoch = int(datetime.combine(args.cutoff + timedelta(days=1), datetime.min.time(), tzinfo=UTC).timestamp()) - 1
                raw = client.get_ohlc(symbol, count_back=args.count_back, to_epoch=cutoff_epoch)
                rows = ohlc_rows_from_gap_chart(symbol, raw, instrument_type=meta.get("type")) if raw else []
                rows = [row for row in rows if args.start <= row["tradeDate"].date() <= args.cutoff]
                require_data(rows, f"OHLC {symbol}")
                coll_name = price_collection_for(meta.get("type"))
                n = upsert_eod_rows(db, coll_name, symbol, rows, dry_run=False)
                row_summary["ohlc"] = {"collection": coll_name, "rows": n, "first": min(row["tradeDate"] for row in rows).date().isoformat(), "last": max(row["tradeDate"] for row in rows).date().isoformat(), "history_complete": None, "requested_count_back": args.count_back, "requested_start": args.start.isoformat()}
                _add("ohlc_rows", n)
                if meta.get("type") == "STOCK":
                    from vnibb.services.vietcap_financials import persist_vietcap_prices
                    admission_details: dict[str, Any] = {}
                    row_summary["price_admission"] = admission_details
                    row_summary["structured_price_rows"] = runner.run(persist_vietcap_prices(symbol, rows, admission_details=admission_details))
                    _add("structured_price_rows", row_summary["structured_price_rows"])
                    if row_summary["structured_price_rows"] != len(rows):
                        raise RuntimeError(f"Returned OHLC window incomplete: {admission_details.get('rejected_rows', 0)} source rows unadmitted; {row_summary['structured_price_rows']}/{len(rows)} SQL rows persisted")
                save_receipt(args.checkpoint_file, state, symbol, "ohlc", "succeeded", row_summary)
            except Exception as exc:
                report_persistence_error(exc, row_summary, "structured_price_rows")
                row_summary["ohlc_error"] = str(exc)
                save_receipt(args.checkpoint_file, state, symbol, "ohlc", "empty" if isinstance(exc, ValueError) and str(exc).startswith("Requested data unavailable: OHLC") else "failed", row_summary)

        if "financials" in selected and claim_pair(symbol, "financials"):
            try:
                try:
                    records = w.sync_symbol_financials(db, client, symbol, com_type=com_type, dry_run=not args.apply)
                    financial_count = len(records)
                except w.FinancialAcquisitionPartial as exc:
                    records = exc.records
                    financial_count = exc.mongo_rows
                    record_error(exc)
                    row_summary["financials_error"] = str(exc)
                    row_summary["financial_acquisition_errors"] = exc.errors
                report_structured(records, row_summary)
                row_summary["financials"] = financial_count
                row_summary["financial_envelopes"] = len(records)
                _add("financial_periods", financial_count)
                if args.apply and records:
                    from vnibb.services.vietcap_financials import persist_vietcap_financials
                    row_summary["structured_rows"] = runner.run(persist_vietcap_financials(records))
                    _add("structured_rows", row_summary["structured_rows"])
                require_data(records, f"financial envelopes {symbol}")
            except Exception as exc:
                report_persistence_error(exc, row_summary)
                row_summary["structured_financials_error"] = str(exc)
            save_receipt(args.checkpoint_file, state, symbol, "financials", "failed" if any(key in row_summary for key in ("financials_error", "structured_financials_error")) else "succeeded", row_summary)
            if "ratios" in selected:
                save_receipt(args.checkpoint_file, state, symbol, "ratios", "failed" if any(key in row_summary for key in ("financials_error", "structured_financials_error")) else "succeeded", row_summary)

        if "ratios" in selected and "financials" not in selected and claim_pair(symbol, "ratios"):
            try:
                ratios = require_data(client.get_statistics_financial(symbol), f"ratios {symbol}")
                records = []
                from vnibb.services.vietcap_client import IQ_BASE
                response_metadata = getattr(client, "response_metadata", {})
                n = w.upsert_ratio_rows(db, symbol, ratios, com_type=com_type, records=records, dry_run=not args.apply,
                    source_response=response_metadata.get(f"{IQ_BASE}/v1/company/{symbol.upper()}/statistics-financial"))
                report_structured(records, row_summary)
                row_summary["ratios"] = n
                _add("ratio_rows", n)
                if args.apply:
                    from vnibb.services.vietcap_financials import persist_vietcap_financials
                    row_summary["structured_rows"] = runner.run(persist_vietcap_financials(records))
                    _add("structured_rows", row_summary["structured_rows"])
            except Exception as exc:
                report_persistence_error(exc, row_summary)
                row_summary["ratios_error"] = str(exc)
            save_receipt(args.checkpoint_file, state, symbol, "ratios", "failed" if "ratios_error" in row_summary else "succeeded", row_summary)

        if "company" in selected and claim_pair(symbol, "company"):
            try:
                details = client.get_company_details(symbol)
                n = w.upsert_company_profile(db, symbol, details, search_index.get(symbol), dry_run=not args.apply)
                require_data(n, f"company {symbol}")
                row_summary["company"] = n
                _add("company_profiles", n)
            except Exception as exc:  # noqa: BLE001
                record_error(exc)
                row_summary["company_error"] = str(exc)
            save_receipt(args.checkpoint_file, state, symbol, "company", "failed" if "company_error" in row_summary else "succeeded", row_summary)

        if "shareholders" in selected and claim_pair(symbol, "shareholders"):
            try:
                data = client.get_shareholder_structure(symbol)
                n = w.upsert_shareholder_structure(db, symbol, data, dry_run=not args.apply)
                require_data(n, f"shareholders {symbol}")
                row_summary["shareholders"] = n
                _add("shareholder_rows", n)
            except Exception as exc:  # noqa: BLE001
                record_error(exc)
                row_summary["shareholders_error"] = str(exc)
            save_receipt(args.checkpoint_file, state, symbol, "shareholders", "failed" if "shareholders_error" in row_summary else "succeeded", row_summary)

        print(json.dumps(row_summary, default=str))

    print(json.dumps({"totals": totals, "errors": failures, "unavailable": unavailable, "attempted": attempted, "contract": contract, "datasets": checkpoint_inventory(state, symbols, selected), "support": "countBack is a provider limit, not a completeness guarantee; SQL and Mongo persistence both required for STOCK OHLC receipts."}, indent=2, default=str))
    return int(failures > 0)


def _ensure_indexes(db: Any) -> None:
    """Create supporting indexes, tolerating pre-existing ones on shared collections."""
    from pymongo.errors import OperationFailure

    def _safe(coll_name: str, keys: list[tuple[str, int]], **opts: Any) -> None:
        try:
            db[coll_name].create_index(keys, **opts)
        except OperationFailure as exc:
            # Existing equivalent index under another name, or conflicting options.
            print(json.dumps({"step": "ensure-indexes", "collection": coll_name, "skip": str(exc)[:120]}))

    # Shared corpus already has idx_symbol_tradeDate_desc; do not force a new unique index here.
    _safe("market_prices_eod", [("symbol", 1), ("tradeDate", 1), ("source", 1)])
    _safe("market_prices_eod", [("source", 1), ("tradeDate", -1)])
    _safe("market_prices_eod", [("tradeDate", -1)], name="idx_tradeDate_desc")
    for coll in ("market_prices_cw", "market_prices_derivatives", "market_prices_bond"):
        _safe(coll, [("symbol", 1), ("tradeDate", 1), ("source", 1)], unique=True)
    _safe("market_vnstock_premium_records", [("dataset", 1), ("symbol", 1), ("recordKey", 1)], unique=True)
    _safe("market_company_profiles", [("symbol", 1), ("source", 1)], unique=True)
    _safe("market_index_constituents", [("group", 1), ("source", 1)], unique=True)
    w.ensure_metric_map_indexes(db)
    _safe("market_icb_sectors", [("icbCode", 1), ("source", 1)], unique=True)


if __name__ == "__main__":
    raise SystemExit(main())
