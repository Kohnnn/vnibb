"""Fundamental + company + index writers for the Vietcap backfill.

Kept separate from backfill_vietcap.py to keep each module small and testable.
All writers target MongoDB ``vnibb-market`` and tag rows with source="vietcap".
"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from typing import Any


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _hash(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def _year_observed_at(year: Any) -> datetime:
    try:
        return datetime(int(year), 1, 1)
    except (TypeError, ValueError):
        return datetime(datetime.now(UTC).year, 1, 1)


def _period_label(year: Any, length_report: Any) -> tuple[str, str, int | None, int | None]:
    """Return (period, period_type, fiscal_year, fiscal_quarter).

    Vietcap encodes annual rows with lengthReport == 5; quarters use 1..4.
    """
    try:
        fiscal_year = int(year)
    except (TypeError, ValueError):
        fiscal_year = None
    quarter = None
    try:
        lr = int(length_report)
        if 1 <= lr <= 4:
            quarter = lr
    except (TypeError, ValueError):
        lr = None
    if quarter:
        return f"{fiscal_year}-Q{quarter}", "QUARTER", fiscal_year, quarter
    return f"FY{fiscal_year}", "YEAR", fiscal_year, None


# ---------------------------------------------------------------------------
# Financial statements (income / balance / cash flow) + metric map
# ---------------------------------------------------------------------------

def upsert_metric_map(db: Any, com_type: str, metric_map: dict[str, list[dict[str, Any]]], *, dry_run: bool) -> int:
    """Store code->label maps once per (comTypeCode, section)."""
    from pymongo import UpdateOne

    synced_at = _now()
    com_type = (com_type or "UNKNOWN").upper()
    ops: list[Any] = []
    count = 0
    for section, fields in (metric_map or {}).items():
        if not isinstance(fields, list):
            continue
        labels = {
            str(item.get("field")): {
                "field": item.get("field"),
                "name": item.get("name"),
                "level": item.get("level"),
                "parent": item.get("parent"),
                "titleEn": item.get("titleEn"),
                "titleVi": item.get("titleVi"),
                "fullTitleEn": item.get("fullTitleEn"),
                "fullTitleVi": item.get("fullTitleVi"),
            }
            for item in fields
            if item.get("field")
        }
        doc = {
            "comTypeCode": com_type,
            "section": section,
            "source": "vietcap",
            "fieldCount": len(labels),
            "labels": labels,
            "updatedAt": synced_at,
            "schemaVersion": 1,
        }
        count += 1
        if dry_run:
            continue
        ops.append(
            UpdateOne(
                {"comTypeCode": com_type, "section": section, "source": "vietcap"},
                {"$set": doc, "$setOnInsert": {"createdAt": synced_at}},
                upsert=True,
            )
        )
    if ops:
        db["market_financial_metric_map"].bulk_write(ops, ordered=False)
    return count


def upsert_statement_periods(
    db: Any,
    symbol: str,
    dataset: str,
    section: str,
    statement: dict[str, Any] | None,
    *,
    dry_run: bool,
) -> int:
    """Write each year/quarter period row into market_vnstock_premium_records."""
    from pymongo import UpdateOne

    if not statement:
        return 0
    synced_at = _now()
    symbol_upper = symbol.upper()
    ops: list[Any] = []
    count = 0
    for bucket in ("years", "quarters"):
        for raw in statement.get(bucket, []) or []:
            period, period_type, fiscal_year, fiscal_quarter = _period_label(
                raw.get("yearReport"), raw.get("lengthReport")
            )
            record_key = f"vietcap:{dataset}:{symbol_upper}:{period}"
            doc = {
                "dataset": dataset,
                "datasetGroup": "finance",
                "section": section,
                "symbol": symbol_upper,
                "scopeKey": symbol_upper,
                "scopeType": "symbol",
                "source": "vietcap",
                "providerSource": "vietcap",
                "recordKey": record_key,
                "period": period,
                "periodType": period_type,
                "fiscalYear": fiscal_year,
                "fiscalQuarter": fiscal_quarter,
                "observedAt": _year_observed_at(raw.get("yearReport")),
                "raw": raw,
                "updatedAt": synced_at,
                "syncedAt": synced_at,
                "schemaVersion": 1,
            }
            count += 1
            if dry_run:
                continue
            ops.append(
                UpdateOne(
                    {"dataset": dataset, "symbol": symbol_upper, "recordKey": record_key},
                    {"$set": doc, "$setOnInsert": {"createdAt": synced_at}},
                    upsert=True,
                )
            )
    if ops:
        db["market_vnstock_premium_records"].bulk_write(ops, ordered=False)
    return count


# ---------------------------------------------------------------------------
# Financial ratios (statistics-financial)
# ---------------------------------------------------------------------------

def upsert_ratio_rows(db: Any, symbol: str, rows: list[dict[str, Any]], *, dry_run: bool) -> int:
    from pymongo import UpdateOne

    synced_at = _now()
    symbol_upper = symbol.upper()
    ops: list[Any] = []
    count = 0
    for raw in rows or []:
        year = raw.get("yearReport") or raw.get("year")
        quarter = raw.get("quarter")
        if quarter in (None, "", 0):
            period = f"FY{year}"
        else:
            period = f"{year}-Q{quarter}"
        record_key = f"vietcap:finance.ratio:{symbol_upper}:{period}:{raw.get('ratioType') or 'RATIO'}"
        doc = {
            "dataset": "finance.ratio",
            "datasetGroup": "finance",
            "symbol": symbol_upper,
            "scopeKey": symbol_upper,
            "scopeType": "symbol",
            "source": "vietcap",
            "providerSource": "vietcap",
            "recordKey": record_key,
            "period": period,
            "observedAt": _year_observed_at(year),
            "raw": raw,
            "updatedAt": synced_at,
            "syncedAt": synced_at,
            "schemaVersion": 1,
        }
        count += 1
        if dry_run:
            continue
        ops.append(
            UpdateOne(
                {"dataset": "finance.ratio", "symbol": symbol_upper, "recordKey": record_key},
                {"$set": doc, "$setOnInsert": {"createdAt": synced_at}},
                upsert=True,
            )
        )
    if ops:
        db["market_vnstock_premium_records"].bulk_write(ops, ordered=False)
    return count


# ---------------------------------------------------------------------------
# Company profile (details + search-bar) and shareholder structure
# ---------------------------------------------------------------------------

def upsert_company_profile(
    db: Any,
    symbol: str,
    details: dict[str, Any] | None,
    search_row: dict[str, Any] | None,
    *,
    dry_run: bool,
) -> int:

    if not details and not search_row:
        return 0
    synced_at = _now()
    symbol_upper = symbol.upper()
    doc = {
        "symbol": symbol_upper,
        "source": "vietcap",
        "details": details or {},
        "searchBar": search_row or {},
        "updatedAt": synced_at,
        "syncedAt": synced_at,
        "schemaVersion": 1,
    }
    if dry_run:
        return 1
    db["market_company_profiles"].update_one(
        {"symbol": symbol_upper, "source": "vietcap"},
        {"$set": doc, "$setOnInsert": {"createdAt": synced_at}},
        upsert=True,
    )
    return 1


def upsert_shareholder_structure(db: Any, symbol: str, data: dict[str, Any] | None, *, dry_run: bool) -> int:

    if not data:
        return 0
    synced_at = _now()
    symbol_upper = symbol.upper()
    record_key = f"vietcap:company.shareholder_structure:{symbol_upper}:{_hash(json.dumps(data, sort_keys=True, default=str))[:12]}"
    doc = {
        "dataset": "company.shareholder_structure",
        "datasetGroup": "company",
        "symbol": symbol_upper,
        "scopeKey": symbol_upper,
        "scopeType": "symbol",
        "source": "vietcap",
        "providerSource": "vietcap",
        "recordKey": record_key,
        "observedAt": synced_at,
        "raw": data,
        "updatedAt": synced_at,
        "syncedAt": synced_at,
        "schemaVersion": 1,
    }
    if dry_run:
        return 1
    db["market_vnstock_premium_records"].update_one(
        {"dataset": "company.shareholder_structure", "symbol": symbol_upper, "recordKey": record_key},
        {"$set": doc, "$setOnInsert": {"createdAt": synced_at}},
        upsert=True,
    )
    return 1


# ---------------------------------------------------------------------------
# Index constituents (getByGroup)
# ---------------------------------------------------------------------------

def upsert_index_constituents(db: Any, group: str, symbols: list[str], *, dry_run: bool) -> int:

    synced_at = _now()
    group_upper = group.upper()
    members = sorted({s.upper() for s in symbols if s})
    doc = {
        "group": group_upper,
        "source": "vietcap",
        "memberCount": len(members),
        "members": members,
        "updatedAt": synced_at,
        "syncedAt": synced_at,
        "schemaVersion": 1,
    }
    if dry_run:
        return len(members)
    db["market_index_constituents"].update_one(
        {"group": group_upper, "source": "vietcap"},
        {"$set": doc, "$setOnInsert": {"createdAt": synced_at}},
        upsert=True,
    )
    return len(members)


# ---------------------------------------------------------------------------
# ICB sector dictionary
# ---------------------------------------------------------------------------

def upsert_icb_sectors(db: Any, rows: list[dict[str, Any]], *, dry_run: bool) -> int:
    from pymongo import UpdateOne

    synced_at = _now()
    ops: list[Any] = []
    count = 0
    for raw in rows or []:
        code = str(raw.get("name") or "").strip()
        if not code:
            continue
        doc = {
            "icbCode": code,
            "source": "vietcap",
            "enSector": raw.get("enSector"),
            "viSector": raw.get("viSector"),
            "icbLevel": raw.get("icbLevel"),
            "marketCap": raw.get("marketCap"),
            "raw": raw,
            "updatedAt": synced_at,
            "schemaVersion": 1,
        }
        count += 1
        if dry_run:
            continue
        ops.append(
            UpdateOne(
                {"icbCode": code, "source": "vietcap"},
                {"$set": doc, "$setOnInsert": {"createdAt": synced_at}},
                upsert=True,
            )
        )
    if ops:
        db["market_icb_sectors"].bulk_write(ops, ordered=False)
    return count


# ---------------------------------------------------------------------------
# Source reconciliation: Vietcap wins over vnstock-data on overlapping bars
# ---------------------------------------------------------------------------

def reconcile_eod_source(db: Any, symbol: str, *, dry_run: bool) -> tuple[int, int]:
    """Drop vnstock-data bars where a vietcap bar exists for the same (symbol, tradeDate).

    Reads ignore ``source``; keeping both would double-count days. Vietcap is
    primary, so overlapping vnstock-data rows are removed. Returns
    (vietcap_dates, removed_vnstock_rows).
    """
    coll = db["market_prices_eod"]
    symbol_upper = symbol.upper()
    vietcap_dates = {
        doc["tradeDate"]
        for doc in coll.find(
            {"symbol": symbol_upper, "source": "vietcap"}, {"_id": 0, "tradeDate": 1}
        )
        if doc.get("tradeDate") is not None
    }
    if not vietcap_dates:
        return 0, 0
    if dry_run:
        overlap = coll.count_documents(
            {
                "symbol": symbol_upper,
                "source": {"$ne": "vietcap"},
                "tradeDate": {"$in": list(vietcap_dates)},
            }
        )
        return len(vietcap_dates), overlap
    removed = 0
    date_list = list(vietcap_dates)
    archive = db["market_prices_eod_reconcile_archive"]
    for i in range(0, len(date_list), 500):
        batch = date_list[i : i + 500]
        query = {
            "symbol": symbol_upper,
            "source": {"$ne": "vietcap"},
            "tradeDate": {"$in": batch},
        }
        # Archive the exact docs about to be deleted so reconcile is reversible.
        doomed = list(coll.find(query))
        if doomed:
            stamp = _now()
            for d in doomed:
                d["archivedAt"] = stamp
                d["archivedReason"] = "vietcap_reconcile_override"
            try:
                archive.insert_many(doomed, ordered=False)
            except Exception:  # noqa: BLE001 - archive is best-effort, never block reconcile
                pass
        result = coll.delete_many(query)
        removed += result.deleted_count
    return len(vietcap_dates), removed
