#!/usr/bin/env python3
# ruff: noqa: E402
"""Backfill/refresh computed fundamental screener snapshots.

For each requested symbol this script loads raw statement data from Mongo
(``market_vnstock_premium_records`` / ``market_prices_eod``) through the
valuation engine in ``vnibb.services.fundamental_valuation``, computes a
:class:`FundamentalSnapshot`, and upserts the rendered document into the
``market_fundamental_screener`` collection keyed by ``{symbol, snapshotDate}``.

Idempotent and resumable: re-running upserts the same documents. Per-symbol
failures are collected, never fatal. See ``docs/FUNDAMENTAL_SCREENER.md``
("Backfill script contract") for the full contract.

Usage (from the vnibb/ repo root):

    python apps/api/scripts/build_fundamental_screener.py --symbols VNM,FPT --dry-run
    python apps/api/scripts/build_fundamental_screener.py --symbols-group VN30
    python apps/api/scripts/build_fundamental_screener.py --symbols-group ALL --limit 100
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def _load_workspace_env() -> None:
    """Load the first .env found walking up from this script (workspace root included).

    Matches sibling-script behavior: environment variables already set win;
    dotenv only fills in the blanks (MONGODB_URL / MONGODB_DATABASE).
    """

    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    for parent in Path(__file__).resolve().parents:
        candidate = parent / ".env"
        if candidate.is_file():
            load_dotenv(candidate, override=False)
            return


_load_workspace_env()

from vnibb.services.fundamental_valuation import (
    compute_fundamental_snapshot,
    load_fundamental_inputs,
    to_document,
)
from vnibb.services.mongo_market_data_service import (
    MongoMarketDataService,
    get_mongo_market_data_service,
)

logging.basicConfig(level=logging.WARNING, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("build_fundamental_screener")

SCREENER_COLLECTION = "market_fundamental_screener"
PREMIUM_RECORDS_COLLECTION = "market_vnstock_premium_records"
GROUP_DATASET = "reference.listings.symbols_by_group"
BULK_BATCH_SIZE = 200
MAX_SUMMARY_ERRORS = 20
CONCURRENCY = 8

# Raw symbols_by_group rows come from vnstock Listing().symbols_by_group() and
# vary by source; match the group label and the symbol through alias lists.
GROUP_FIELD_ALIASES = ("group", "group_code", "group_name", "index_code", "index_name", "board")
SYMBOL_FIELD_ALIASES = ("symbol", "ticker", "organ_code", "stock_code", "code")


def _eprint(message: str) -> None:
    """Progress/diagnostic line on stderr; stdout is reserved for the JSON summary."""

    print(message, file=sys.stderr, flush=True)


# --- symbol resolution -------------------------------------------------------


def _resolve_vn30() -> list[str]:
    """VN30 constituents from the existing in-repo helper (vnibb.core.vn_sectors)."""

    from vnibb.core.vn_sectors import VN_SECTORS

    config = VN_SECTORS.get("vn30")
    symbols = [s.strip().upper() for s in (config.symbols if config else []) if s.strip()]
    return sorted(set(symbols))


def _resolve_group_from_mongo(svc: MongoMarketDataService, group: str) -> list[str]:
    """Resolve an index group (e.g. VN100) from reference.listings.symbols_by_group rows."""

    coll = svc._get_collection(PREMIUM_RECORDS_COLLECTION)
    group_upper = group.upper()
    symbols: set[str] = set()
    cursor = coll.find({"dataset": GROUP_DATASET}, {"_id": 0, "raw": 1})
    for record in cursor:
        raw = record.get("raw")
        if not isinstance(raw, dict):
            continue
        row_group = next(
            (raw[key] for key in GROUP_FIELD_ALIASES if raw.get(key) is not None), None
        )
        if row_group is None or str(row_group).strip().upper() != group_upper:
            continue
        symbol = next(
            (raw[key] for key in SYMBOL_FIELD_ALIASES if raw.get(key) is not None), None
        )
        if symbol is None:
            continue
        text = str(symbol).strip().upper()
        if text and len(text) <= 12:
            symbols.add(text)
    return sorted(symbols)


def _resolve_all_symbols(svc: MongoMarketDataService) -> list[str]:
    """ALL = sorted distinct symbol values in market_vnstock_premium_records."""

    coll = svc._get_collection(PREMIUM_RECORDS_COLLECTION)
    return sorted(
        str(value).strip().upper()
        for value in coll.distinct("symbol")
        if value is not None and str(value).strip()
    )


def _resolve_symbols(args: argparse.Namespace, svc: MongoMarketDataService) -> list[str]:
    if args.symbols:
        symbols = sorted(
            {s.strip().upper() for s in args.symbols.split(",") if s.strip()}
        )
        if not symbols:
            raise SystemExit("--symbols was provided but contained no usable symbols")
        return symbols

    group = (args.symbols_group or "ALL").upper()
    if group == "VN30":
        symbols = _resolve_vn30()
        if symbols:
            return symbols
        raise RuntimeError("VN30 helper (vnibb.core.vn_sectors) returned no symbols")
    if group == "VN100":
        symbols = _resolve_group_from_mongo(svc, "VN100")
        if symbols:
            return symbols
        raise RuntimeError(
            "VN100 could not be resolved from "
            f"{PREMIUM_RECORDS_COLLECTION} dataset={GROUP_DATASET}; "
            "backfill that dataset first or pass --symbols explicitly"
        )
    return _resolve_all_symbols(svc)


# --- per-symbol pipeline -----------------------------------------------------


async def _process_symbol(
    symbol: str,
    svc: MongoMarketDataService,
    snapshot_date: date,
    semaphore: asyncio.Semaphore,
    *,
    verbose: bool,
) -> tuple[str, dict[str, Any] | None, str | None]:
    """Returns (symbol, document | None, error | None). Never raises."""

    async with semaphore:
        try:
            inputs = await load_fundamental_inputs(symbol, svc)
            snapshot = compute_fundamental_snapshot(inputs)
            document = to_document(snapshot, snapshot_date)
            if verbose:
                _eprint(
                    f"  {symbol}: method={snapshot.valuation_method} "
                    f"iv={snapshot.intrinsic_value} mos={snapshot.margin_of_safety} "
                    f"moat={snapshot.moat} sector={snapshot.sector!r}"
                )
            return symbol, document, None
        except Exception as exc:
            logger.warning("symbol %s failed: %s", symbol, exc)
            return symbol, None, f"{type(exc).__name__}: {exc}"


def _ensure_index(svc: MongoMarketDataService) -> None:
    coll = svc._get_collection(SCREENER_COLLECTION)
    coll.create_index([("symbol", 1), ("snapshotDate", -1)], unique=True)


def _bulk_upsert(svc: MongoMarketDataService, documents: list[dict[str, Any]]) -> int:
    from pymongo import ReplaceOne

    coll = svc._get_collection(SCREENER_COLLECTION)
    written = 0
    for start in range(0, len(documents), BULK_BATCH_SIZE):
        batch = documents[start : start + BULK_BATCH_SIZE]
        ops = [
            ReplaceOne(
                {"symbol": doc["symbol"], "snapshotDate": doc["snapshotDate"]},
                doc,
                upsert=True,
            )
            for doc in batch
        ]
        result = coll.bulk_write(ops, ordered=False)
        written += (result.upserted_count or 0) + (result.matched_count or 0)
    return written


# --- main --------------------------------------------------------------------


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    selection = parser.add_mutually_exclusive_group()
    selection.add_argument(
        "--symbols", default=None, help='Comma-separated symbols, e.g. "VNM,FPT"'
    )
    selection.add_argument(
        "--symbols-group",
        default=None,
        choices=["VN30", "VN100", "ALL"],
        help="Symbol universe (default ALL when --symbols is absent)",
    )
    parser.add_argument(
        "--snapshot-date",
        default=None,
        help="YYYY-MM-DD snapshot date (default: today UTC)",
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Compute snapshots but write nothing"
    )
    parser.add_argument(
        "--limit", type=int, default=None, help="Cap symbol count after resolution"
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print per-symbol valuation lines to stderr (implied by --dry-run)",
    )
    return parser.parse_args()


def _coverage(documents: list[dict[str, Any]], field: str) -> float:
    if not documents:
        return 0.0
    populated = sum(1 for doc in documents if doc.get(field) is not None)
    return round(populated / len(documents), 4)


async def _run(args: argparse.Namespace) -> dict[str, Any]:
    if args.snapshot_date:
        snapshot_date = date.fromisoformat(args.snapshot_date)
    else:
        snapshot_date = datetime.now(UTC).date()
    verbose = args.verbose or args.dry_run

    summary: dict[str, Any] = {
        "requested": 0,
        "succeeded": 0,
        "failed": 0,
        "ivCoverage": 0.0,
        "moatCoverage": 0.0,
        "mosCoverage": 0.0,
        "dryRun": bool(args.dry_run),
        "snapshotDate": snapshot_date.isoformat(),
        "errors": [],
    }

    svc = get_mongo_market_data_service()
    if not svc.enabled:
        summary["errors"] = [
            {"symbol": "*", "error": "MongoDB not configured (set MONGODB_URL)"}
        ]
        summary["failed"] = summary["requested"]
        return summary

    try:
        symbols = _resolve_symbols(args, svc)
    except SystemExit:
        raise
    except Exception as exc:
        summary["errors"] = [
            {"symbol": "*", "error": f"symbol resolution failed: {exc}"}
        ]
        return summary

    if args.limit is not None and args.limit >= 0:
        symbols = symbols[: args.limit]
    summary["requested"] = len(symbols)
    _eprint(
        f"Processing {len(symbols)} symbols for snapshotDate={snapshot_date.isoformat()} "
        f"(dry_run={args.dry_run})"
    )

    semaphore = asyncio.Semaphore(CONCURRENCY)
    results = await asyncio.gather(
        *(
            _process_symbol(symbol, svc, snapshot_date, semaphore, verbose=verbose)
            for symbol in symbols
        )
    )

    documents: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    for symbol, document, error in results:
        if document is not None:
            documents.append(document)
        else:
            errors.append({"symbol": symbol, "error": error or "unknown error"})

    if documents and not args.dry_run:
        try:
            _ensure_index(svc)
            written = _bulk_upsert(svc, documents)
            _eprint(f"Upserted {written} documents into {SCREENER_COLLECTION}")
        except Exception as exc:
            logger.warning("bulk upsert failed: %s", exc)
            errors.extend(
                {"symbol": doc["symbol"], "error": f"upsert failed: {exc}"}
                for doc in documents
            )
            documents = []

    summary["succeeded"] = len(documents)
    summary["failed"] = len(errors)
    summary["ivCoverage"] = _coverage(documents, "intrinsicValue")
    summary["moatCoverage"] = _coverage(documents, "moat")
    summary["mosCoverage"] = _coverage(documents, "marginOfSafety")
    summary["errors"] = errors[:MAX_SUMMARY_ERRORS]
    return summary


def main() -> int:
    args = _parse_args()
    summary = asyncio.run(_run(args))
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
