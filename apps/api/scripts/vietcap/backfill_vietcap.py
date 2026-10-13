#!/usr/bin/env python3
"""Backfill canonical n6v MongoDB market data from public Vietcap endpoints.

Vietcap is the PRIMARY source. Dry-run is the default; pass --apply to write.

Targets (database: vnibb-market):
  market_prices_eod              EOD OHLCV for stocks + indices (source="vietcap", raw VND)
  market_prices_cw               EOD OHLCV for covered warrants (separate, noisy/short-lived)
  market_prices_derivatives      EOD OHLCV for futures/derivatives (separate)
  market_prices_bond             EOD OHLCV for bonds/debentures (separate)
  market_vnstock_premium_records financial statements / ratios / shareholders (source="vietcap")
  market_financial_metric_map    original descriptor lists per symbol/section (existing type key)
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
from datetime import UTC, datetime
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

def resolve_universe(client: VietcapClient, raw_symbols: str) -> dict[str, dict[str, Any]]:
    """Return {symbol: {type, board, organName...}} for the requested universe.

    raw_symbols == 'ALL' -> every instrument from getAll.
    raw_symbols == 'STOCK' (or other type) -> filter getAll by type.
    Otherwise treat as comma-separated explicit list (type looked up from getAll).
    """
    universe = client.get_all_symbols()
    by_symbol = {
        str(item.get("symbol") or "").upper(): item
        for item in universe
        if item.get("symbol")
    }
    selector = raw_symbols.strip().upper()
    if selector == "ALL":
        return by_symbol
    known_types = {str(item.get("type") or "").upper() for item in universe}
    if selector in known_types:
        return {sym: meta for sym, meta in by_symbol.items() if str(meta.get("type") or "").upper() == selector}
    requested = [s.strip().upper() for s in raw_symbols.split(",") if s.strip()]
    result: dict[str, dict[str, Any]] = {}
    for sym in requested:
        result[sym] = by_symbol.get(sym, {"symbol": sym})
    return result


def price_collection_for(instrument_type: str | None) -> str:
    return PRICE_COLLECTION_BY_TYPE.get(str(instrument_type or "STOCK").upper(), "market_prices_eod")


def select_symbols_for_fresh_ohlc(
    symbols: list[str], fresh_symbols: set[str], *, ohlc_only: bool
) -> tuple[list[str], int]:
    skipped_fresh = sum(symbol.upper() in fresh_symbols for symbol in symbols)
    if ohlc_only:
        return [symbol for symbol in symbols if symbol.upper() not in fresh_symbols], skipped_fresh
    return symbols, skipped_fresh


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
    parser.add_argument("--symbols", default="VCB,BVH,FPT", help="Comma list, a type (STOCK/CW/FU/BOND/ETF), or ALL")
    parser.add_argument(
        "--datasets",
        default="ohlc,financials,ratios,company,shareholders",
        help="Comma list of: ohlc,financials,ratios,company,shareholders,listing,indices,icb or 'all'",
    )
    parser.add_argument("--count-back", type=int, default=10000)
    parser.add_argument("--apply", action="store_true", help="Write to MongoDB. Default is dry-run.")
    parser.add_argument("--ensure-indexes", action="store_true")
    parser.add_argument("--limit", type=int, default=0, help="Cap symbol count (0 = no cap)")
    parser.add_argument(
        "--skip-fresh-through",
        default="",
        help="YYYY-MM-DD: skip symbols whose vietcap EOD already reaches this date, before any HTTP call (resumable trickle)",
    )
    args = parser.parse_args()

    allowed = {"ohlc", "financials", "ratios", "company", "shareholders", "listing", "indices", "icb"}
    selected = {d.strip().lower() for d in args.datasets.split(",") if d.strip()}
    if not selected or selected - allowed - {"all"}:
        parser.error("--datasets must contain supported dataset names")
    if "all" in selected:
        selected = allowed
    if args.limit < 0 or args.count_back <= 0:
        parser.error("--limit must be nonnegative and --count-back positive")
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
    if args.apply or args.skip_fresh_through:
        mongo_url = os.getenv("MONGODB_URL")
        if not mongo_url:
            raise SystemExit("MONGODB_URL is required when --apply or --skip-fresh-through is used")
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

    if "indices" in selected:
        for group in INDEX_GROUPS:
            try:
                members = [str(r.get("symbol") or "") for r in client.get_symbols_by_group(group)]
                require_data(members, f"index {group}")
                n = w.upsert_index_constituents(db, group, members, dry_run=not args.apply) if (db is not None or not args.apply) else 0
                totals["index_members"] = totals.get("index_members", 0) + n
                print(json.dumps({"step": "indices", "group": group, "members": n}))
            except Exception as exc:  # noqa: BLE001
                record_error(exc)
                print(json.dumps({"step": "indices", "group": group, "error": str(exc)}))

    if "icb" in selected:
        try:
            rows = require_data(client.get_icb_codes(), "icb")
            n = w.upsert_icb_sectors(db, rows, dry_run=not args.apply)
            totals["icb_sectors"] = n
            print(json.dumps({"step": "icb", "sectors": n}))
        except Exception as exc:  # noqa: BLE001
            record_error(exc)
            print(json.dumps({"step": "icb", "error": str(exc)}))

    try:
        universe = require_data(resolve_universe(client, args.symbols), "symbol universe")
    except Exception as exc:
        record_error(exc)
        print(json.dumps({"totals": totals, "errors": failures, "unavailable": unavailable, "error": str(exc)}))
        return 1
    symbols = sorted(universe)

    fresh_symbols: set[str] = set()
    skipped_fresh = 0
    if args.skip_fresh_through:
        cutoff = datetime.strptime(args.skip_fresh_through, "%Y-%m-%d")
        for doc in db["market_prices_eod"].aggregate([
            {"$match": {"source": "vietcap", "tradeDate": {"$gte": cutoff}}},
            {"$group": {"_id": "$symbol"}},
        ]):
            fresh_symbols.add(str(doc["_id"]).upper())
        if selected == {"ohlc"}:
            symbols, skipped_fresh = select_symbols_for_fresh_ohlc(
                symbols, fresh_symbols, ohlc_only=True
            )

    if args.limit and args.limit > 0:
        symbols = symbols[: args.limit]

    if fresh_symbols and selected != {"ohlc"}:
        _, skipped_fresh = select_symbols_for_fresh_ohlc(symbols, fresh_symbols, ohlc_only=False)

    print(json.dumps({
        "mode": "apply" if args.apply else "dry-run",
        "database": os.getenv("MONGODB_DATABASE", "vnibb-market"),
        "datasets": sorted(selected),
        "symbol_count": len(symbols),
        "skipped_fresh": skipped_fresh,
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
            missing = [symbol for symbol in listing_symbols if symbol not in search_index or not universe[symbol].get("type")]
            if missing:
                record_error(ValueError(f"Listing metadata unavailable for {','.join(missing)}"))
                print(json.dumps({"step": "listing", "unavailable_symbols": missing}))
            require_data(search, "IQ listing search metadata")
            totals["listing_rows"] = w.upsert_listing_rows(db, trading, search, dry_run=not args.apply)
            if args.apply:
                from vnibb.services.vietcap_financials import persist_vietcap_listings
                totals["structured_listing_rows"] = runner.run(persist_vietcap_listings(trading, search))
        except Exception as exc:
            listing_summary = {"step": "listing", "error": str(exc)}
            report_persistence_error(exc, listing_summary, "structured_listing_rows")
            print(json.dumps(listing_summary, default=str))

    for idx, symbol in enumerate(symbols, 1):
        meta = universe.get(symbol, {})
        com_type = search_index.get(symbol, {}).get("comTypeCode")
        row_summary: dict[str, Any] = {"symbol": symbol, "i": idx, "type": meta.get("type")}

        if "ohlc" in selected:
            if symbol.upper() in fresh_symbols:
                row_summary["ohlc"] = {"skipped_fresh": True}
            else:
                try:
                    raw = client.get_ohlc(symbol, count_back=args.count_back)
                    rows = ohlc_rows_from_gap_chart(symbol, raw, instrument_type=meta.get("type")) if raw else []
                    require_data(rows, f"OHLC {symbol}")
                    coll_name = price_collection_for(meta.get("type"))
                    n = upsert_eod_rows(db, coll_name, symbol, rows, dry_run=not args.apply)
                    row_summary["ohlc"] = {"collection": coll_name, "rows": n,
                                           "first": rows[0]["tradeDate"].date().isoformat() if rows else None,
                                           "last": rows[-1]["tradeDate"].date().isoformat() if rows else None}
                    _add("ohlc_rows", n)
                    if args.apply and meta.get("type") == "STOCK":
                        from vnibb.services.vietcap_financials import persist_vietcap_prices
                        row_summary["structured_price_rows"] = runner.run(persist_vietcap_prices(symbol, rows))
                        _add("structured_price_rows", row_summary["structured_price_rows"])
                        require_data(row_summary["structured_price_rows"], f"structured prices {symbol}")
                except Exception as exc:  # noqa: BLE001
                    report_persistence_error(exc, row_summary, "structured_price_rows")
                    row_summary["ohlc_error"] = str(exc)

        if "financials" in selected:
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
            except Exception as exc:
                report_persistence_error(exc, row_summary)
                row_summary["structured_financials_error"] = str(exc)

        if "ratios" in selected and "financials" not in selected:
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

        if "company" in selected:
            try:
                details = client.get_company_details(symbol)
                n = w.upsert_company_profile(db, symbol, details, search_index.get(symbol), dry_run=not args.apply)
                require_data(n, f"company {symbol}")
                row_summary["company"] = n
                _add("company_profiles", n)
            except Exception as exc:  # noqa: BLE001
                record_error(exc)
                row_summary["company_error"] = str(exc)

        if "shareholders" in selected:
            try:
                data = client.get_shareholder_structure(symbol)
                n = w.upsert_shareholder_structure(db, symbol, data, dry_run=not args.apply)
                require_data(n, f"shareholders {symbol}")
                row_summary["shareholders"] = n
                _add("shareholder_rows", n)
            except Exception as exc:  # noqa: BLE001
                record_error(exc)
                row_summary["shareholders_error"] = str(exc)

        print(json.dumps(row_summary, default=str))

    print(json.dumps({"totals": totals, "errors": failures, "unavailable": unavailable}, indent=2))
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
    _safe("market_financial_metric_map", [("comTypeCode", 1), ("section", 1), ("source", 1)], unique=True)
    _safe("market_icb_sectors", [("icbCode", 1), ("source", 1)], unique=True)


if __name__ == "__main__":
    raise SystemExit(main())
