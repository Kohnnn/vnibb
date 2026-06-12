#!/usr/bin/env python3
"""Backfill canonical n6v MongoDB market data from public Vietcap endpoints.

Vietcap is the PRIMARY source. Dry-run is the default; pass --apply to write.

Targets (database: vnibb-market):
  market_prices_eod              EOD OHLCV for stocks + indices (source="vietcap", raw VND)
  market_prices_cw               EOD OHLCV for covered warrants (separate, noisy/short-lived)
  market_prices_derivatives      EOD OHLCV for futures/derivatives (separate)
  market_prices_bond             EOD OHLCV for bonds/debentures (separate)
  market_vnstock_premium_records financial statements / ratios / shareholders (source="vietcap")
  market_financial_metric_map    code->label maps per (comTypeCode, section)
  market_company_profiles        company master + sector + analyst (details + search-bar)
  market_index_constituents      index membership from getByGroup

See vnibb/docs/VIETCAP_DATA_SOURCE.md for the full data contract and provenance rules.

Units: prices stored as RAW VND exactly as Vietcap returns them. The legacy
vnstock-data rows are in thousand-VND; the documented convention is that the
vnstock path multiplies by 1000 when it later needs parity. We do NOT rescale here.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[4]  # .../vnibb
API_ROOT = REPO_ROOT / "apps" / "api"
WORKSPACE_ROOT = REPO_ROOT.parent  # .../VNIBB (holds the canonical .env)

# Local import of the sibling client module.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from vietcap_client import VietcapClient  # noqa: E402

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

FINANCIAL_SECTIONS = ("INCOME_STATEMENT", "BALANCE_SHEET", "CASH_FLOW")
SECTION_DATASET = {
    "INCOME_STATEMENT": "finance.income_statement",
    "BALANCE_SHEET": "finance.balance_sheet",
    "CASH_FLOW": "finance.cash_flow",
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


def _float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _int(value: Any) -> int | None:
    f = _float(value)
    return int(f) if f is not None else None


def _hash(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def _epoch_to_dt(epoch: Any) -> datetime | None:
    try:
        seconds = int(float(epoch))
    except (TypeError, ValueError):
        return None
    # Canonical trade-day key at 07:00:00 (UTC) to match MongoMarketDataService.
    dt = datetime.fromtimestamp(seconds, UTC)
    return datetime(dt.year, dt.month, dt.day, 7, 0, 0)


# ---------------------------------------------------------------------------
# OHLC / price history
# ---------------------------------------------------------------------------

def ohlc_rows_from_gap_chart(symbol: str, raw: dict[str, Any]) -> list[dict[str, Any]]:
    """Expand parallel arrays (o/h/l/c/v/t) into per-day documents."""
    if not raw:
        return []
    opens = raw.get("o") or []
    highs = raw.get("h") or []
    lows = raw.get("l") or []
    closes = raw.get("c") or []
    volumes = raw.get("v") or []
    times = raw.get("t") or []
    acc_vol = raw.get("accumulatedVolume") or []
    acc_val = raw.get("accumulatedValue") or []
    n = min(len(opens), len(highs), len(lows), len(closes), len(volumes), len(times))
    symbol_upper = symbol.upper()
    rows: list[dict[str, Any]] = []
    for i in range(n):
        trade_date = _epoch_to_dt(times[i])
        if trade_date is None:
            continue
        close_val = _float(closes[i])
        # Vietcap gap-chart returns close=0 for some early-listing days (no real
        # match). Such rows are unusable for charts/quant, so skip them.
        if close_val is None or close_val <= 0:
            continue
        rows.append(
            {
                "symbol": symbol_upper,
                "tradeDate": trade_date,
                "open": _float(opens[i]),
                "high": _float(highs[i]),
                "low": _float(lows[i]),
                "close": close_val,
                "volume": _int(volumes[i]),
                "accumulatedVolume": _float(acc_vol[i]) if i < len(acc_vol) else None,
                "accumulatedValue": _float(acc_val[i]) if i < len(acc_val) else None,
            }
        )
    return rows


def upsert_eod_rows(db: Any, collection: str, symbol: str, rows: list[dict[str, Any]], *, dry_run: bool) -> int:
    from pymongo import UpdateOne

    synced_at = _now()
    symbol_upper = symbol.upper()
    ops: list[Any] = []
    count = 0
    for row in rows:
        trade_date = row["tradeDate"]
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
            "priceUnit": "VND",
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
        result[sym] = by_symbol.get(sym, {"symbol": sym, "type": "STOCK"})
    return result


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
    import vietcap_writers as w

    load_env_file(WORKSPACE_ROOT / ".env")
    load_env_file(REPO_ROOT / ".env")
    load_env_file(API_ROOT / ".env")

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--symbols", default="VCB,BVH,FPT", help="Comma list, a type (STOCK/CW/FU/BOND/ETF), or ALL")
    parser.add_argument(
        "--datasets",
        default="ohlc,financials,ratios,company,shareholders",
        help="Comma list of: ohlc,financials,ratios,company,shareholders,indices,icb or 'all'",
    )
    parser.add_argument("--count-back", type=int, default=10000)
    parser.add_argument("--reconcile", action="store_true", help="After OHLC apply, drop overlapping vnstock-data bars (Vietcap wins)")
    parser.add_argument("--apply", action="store_true", help="Write to MongoDB. Default is dry-run.")
    parser.add_argument("--ensure-indexes", action="store_true")
    parser.add_argument("--limit", type=int, default=0, help="Cap symbol count (0 = no cap)")
    args = parser.parse_args()

    selected = {d.strip().lower() for d in args.datasets.split(",") if d.strip()}
    if "all" in selected:
        selected = {"ohlc", "financials", "ratios", "company", "shareholders", "indices", "icb"}

    client = VietcapClient()

    db = None
    if args.apply:
        mongo_url = os.getenv("MONGODB_URL")
        if not mongo_url:
            raise SystemExit("MONGODB_URL is required when --apply is used")
        mongo_db = os.getenv("MONGODB_DATABASE", "vnibb-market")
        from pymongo import MongoClient

        client_db = MongoClient(mongo_url, serverSelectionTimeoutMS=10000)
        db = client_db[mongo_db]
        if args.ensure_indexes:
            _ensure_indexes(db)

    # Indices + ICB are universe-level, run once.
    search_index: dict[str, dict[str, Any]] = {}
    if "company" in selected:
        try:
            for row in client.get_company_search_bar():
                code = str(row.get("code") or "").upper()
                if code:
                    search_index[code] = row
        except Exception as exc:  # noqa: BLE001
            print(json.dumps({"step": "search-bar", "error": str(exc)}))

    if "indices" in selected:
        for group in INDEX_GROUPS:
            try:
                members = [str(r.get("symbol") or "") for r in client.get_symbols_by_group(group)]
                n = w.upsert_index_constituents(db, group, members, dry_run=not args.apply) if (db is not None or not args.apply) else 0
                print(json.dumps({"step": "indices", "group": group, "members": n}))
            except Exception as exc:  # noqa: BLE001
                print(json.dumps({"step": "indices", "group": group, "error": str(exc)}))

    if "icb" in selected:
        try:
            rows = client.get_icb_codes()
            n = w.upsert_icb_sectors(db, rows, dry_run=not args.apply)
            print(json.dumps({"step": "icb", "sectors": n}))
        except Exception as exc:  # noqa: BLE001
            print(json.dumps({"step": "icb", "error": str(exc)}))

    universe = resolve_universe(client, args.symbols)
    symbols = sorted(universe)
    if args.limit and args.limit > 0:
        symbols = symbols[: args.limit]

    print(json.dumps({
        "mode": "apply" if args.apply else "dry-run",
        "database": os.getenv("MONGODB_DATABASE", "vnibb-market"),
        "datasets": sorted(selected),
        "symbol_count": len(symbols),
        "reconcile": args.reconcile,
    }, indent=2))

    metric_map_done: set[str] = set()
    totals: dict[str, int] = {}

    def _add(key: str, value: int) -> None:
        totals[key] = totals.get(key, 0) + int(value or 0)

    for idx, symbol in enumerate(symbols, 1):
        meta = universe.get(symbol, {})
        com_type = str(meta.get("comTypeCode") or meta.get("type") or "STOCK").upper()
        row_summary: dict[str, Any] = {"symbol": symbol, "i": idx, "type": meta.get("type")}

        if "ohlc" in selected:
            try:
                raw = client.get_ohlc(symbol, count_back=args.count_back)
                rows = ohlc_rows_from_gap_chart(symbol, raw) if raw else []
                coll_name = price_collection_for(meta.get("type"))
                n = upsert_eod_rows(db, coll_name, symbol, rows, dry_run=not args.apply) if (args.apply or not args.apply) else 0
                row_summary["ohlc"] = {"collection": coll_name, "rows": n,
                                       "first": rows[0]["tradeDate"].date().isoformat() if rows else None,
                                       "last": rows[-1]["tradeDate"].date().isoformat() if rows else None}
                _add("ohlc_rows", n)
                if args.reconcile and args.apply and coll_name == "market_prices_eod":
                    vdates, removed = w.reconcile_eod_source(db, symbol, dry_run=False)
                    row_summary["reconcile"] = {"vietcapDates": vdates, "removedVnstock": removed}
                    _add("reconciled_removed", removed)
            except Exception as exc:  # noqa: BLE001
                row_summary["ohlc_error"] = str(exc)

        if "financials" in selected:
            try:
                if com_type not in metric_map_done:
                    mm = client.get_financial_metrics_map(symbol)
                    if mm:
                        w.upsert_metric_map(db, com_type, mm, dry_run=not args.apply)
                        metric_map_done.add(com_type)
                fin_total = 0
                for section in FINANCIAL_SECTIONS:
                    stmt = client.get_financial_statement(symbol, section)
                    fin_total += w.upsert_statement_periods(
                        db, symbol, SECTION_DATASET[section], section, stmt, dry_run=not args.apply
                    )
                row_summary["financials"] = fin_total
                _add("financial_periods", fin_total)
            except Exception as exc:  # noqa: BLE001
                row_summary["financials_error"] = str(exc)

        if "ratios" in selected:
            try:
                ratios = client.get_statistics_financial(symbol)
                n = w.upsert_ratio_rows(db, symbol, ratios, dry_run=not args.apply)
                row_summary["ratios"] = n
                _add("ratio_rows", n)
            except Exception as exc:  # noqa: BLE001
                row_summary["ratios_error"] = str(exc)

        if "company" in selected:
            try:
                details = client.get_company_details(symbol)
                n = w.upsert_company_profile(db, symbol, details, search_index.get(symbol), dry_run=not args.apply)
                row_summary["company"] = n
                _add("company_profiles", n)
            except Exception as exc:  # noqa: BLE001
                row_summary["company_error"] = str(exc)

        if "shareholders" in selected:
            try:
                data = client.get_shareholder_structure(symbol)
                n = w.upsert_shareholder_structure(db, symbol, data, dry_run=not args.apply)
                row_summary["shareholders"] = n
                _add("shareholder_rows", n)
            except Exception as exc:  # noqa: BLE001
                row_summary["shareholders_error"] = str(exc)

        print(json.dumps(row_summary, default=str))

    print(json.dumps({"totals": totals}, indent=2))
    return 0


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
    for coll in ("market_prices_cw", "market_prices_derivatives", "market_prices_bond"):
        _safe(coll, [("symbol", 1), ("tradeDate", 1), ("source", 1)], unique=True)
    _safe("market_vnstock_premium_records", [("dataset", 1), ("symbol", 1), ("recordKey", 1)], unique=True)
    _safe("market_company_profiles", [("symbol", 1), ("source", 1)], unique=True)
    _safe("market_index_constituents", [("group", 1), ("source", 1)], unique=True)
    _safe("market_financial_metric_map", [("comTypeCode", 1), ("section", 1), ("source", 1)], unique=True)
    _safe("market_icb_sectors", [("icbCode", 1), ("source", 1)], unique=True)


if __name__ == "__main__":
    raise SystemExit(main())
