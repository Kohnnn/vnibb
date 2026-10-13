"""Fundamental + company + index writers for the Vietcap backfill.

Shared by recurring ingestion and the bounded backfill CLI.
All writers target MongoDB ``vnibb-market`` and tag rows with source="vietcap".
"""

from __future__ import annotations

import asyncio
import hashlib
import json
from datetime import UTC, datetime
from typing import Any


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


def _epoch_to_dt(epoch: Any) -> datetime | None:
    try:
        seconds = int(float(epoch))
    except (TypeError, ValueError):
        return None
    # Canonical trade-day key at 07:00:00 (UTC) to match MongoMarketDataService.
    dt = datetime.fromtimestamp(seconds, UTC)
    return datetime(dt.year, dt.month, dt.day, 7, 0, 0)


def ohlc_rows_from_gap_chart(symbol: str, raw: dict[str, Any], *, instrument_type: str | None = None) -> list[dict[str, Any]]:
    """Expand parallel arrays (o/h/l/c/v/t) into per-day documents."""
    if not raw:
        return []
    from vnibb.core.price_units import is_index_symbol
    kind = str(instrument_type or "").upper()
    price_unit = "index_points" if kind in {"INDEX", "FU"} or is_index_symbol(symbol) else "VND" if kind in {"STOCK", "ETF", "CW"} else "unknown"
    opens = raw.get("o") or []
    highs = raw.get("h") or []
    lows = raw.get("l") or []
    closes = raw.get("c") or []
    volumes = raw.get("v") or []
    times = raw.get("t") or []
    acc_vol = raw.get("accumulatedVolume") or []
    acc_val = raw.get("accumulatedValue") or []
    lengths = {len(values) for values in (opens, highs, lows, closes, volumes, times)}
    if len(lengths) != 1:
        raise ValueError(f"Unequal OHLC arrays for {symbol}")
    n = len(times)
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
                "source": "vietcap",
                "providerSource": "vietcap",
                "high": _float(highs[i]),
                "low": _float(lows[i]),
                "close": close_val,
                "volume": _int(volumes[i]),
                "accumulatedVolume": _float(acc_vol[i]) if i < len(acc_vol) else None,
                "accumulatedValue": _float(acc_val[i]) if i < len(acc_val) else None,
                "raw": {key: raw[key][i] for key in ("o", "h", "l", "c", "v", "t")},
                "priceUnit": price_unit,
                "price_unit": price_unit,
                "sourceUnit": price_unit,
                "sourceUnitEvidence": "https://github.com/thinh-vu/vnstock/blob/v4.0.9/vnstock/core/utils/transform.py#L151-L242" if price_unit != "unknown" else None,
            }
        )
    return rows


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _hash(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()



def _period_label(year: Any, length_report: Any) -> tuple[str, str, int | None, int | None]:
    """Return (period, period_type, fiscal_year, fiscal_quarter).

    Vietcap encodes annual rows with lengthReport == 5; quarters use 1..4.
    """
    try:
        fiscal_year = int(year)
        lr = int(length_report)
    except (TypeError, ValueError) as exc:
        raise ValueError("Financial fiscal identity unavailable") from exc
    if not 1900 <= fiscal_year <= 9999 or lr not in {1, 2, 3, 4, 5}:
        raise ValueError("Invalid financial fiscal identity")
    quarter = lr if lr <= 4 else None
    if quarter:
        return f"{fiscal_year}-Q{quarter}", "QUARTER", fiscal_year, quarter
    return f"FY{fiscal_year}", "YEAR", fiscal_year, None


# ---------------------------------------------------------------------------
# Financial statements (income / balance / cash flow) + metric map
# ---------------------------------------------------------------------------

def upsert_metric_map(
    db: Any, com_type: str | None, metric_map: dict[str, Any], *, symbol: str, dry_run: bool,
    descriptor_response: dict[str, Any] | None = None,
) -> int:
    """Keep the original symbol-specific hierarchy, including null/repeated fields."""
    from pymongo import UpdateOne
    if com_type is None:
        return 0

    received_at = (descriptor_response or {}).get("receivedAt") or _now()
    symbol_upper = str(symbol).strip().upper()
    if not symbol_upper:
        raise ValueError("A stock symbol is required")
    ops = []
    for section, fields in metric_map.items():
        key = {"symbol": symbol_upper, "comTypeCode": com_type, "section": section, "source": "vietcap"}
        doc = {
            **key, "providerSource": "vietcap", "descriptors": fields,
            "descriptorEvidence": {
                **key, "receivedAt": received_at,
                "endpoint": f"/v1/company/{symbol_upper}/financial-statement/metrics",
                "sourceResponse": descriptor_response,
            },
            "receivedAt": received_at, "updatedAt": received_at, "schemaVersion": 3,
        }
        if not dry_run:
            ops.append(UpdateOne(
                key, {"$set": doc, "$setOnInsert": {"createdAt": received_at}}, upsert=True,
            ))
    if ops:
        db["market_financial_metric_map"].bulk_write(ops, ordered=False)
    return len(metric_map)


def ensure_metric_map_indexes(db: Any, *, drop_obsolete: bool = False) -> list[str]:
    """Protect symbol keys before explicitly retiring the type-wide unique index."""
    collection = db["market_financial_metric_map"]
    legacy_keys = [("comTypeCode", 1), ("section", 1), ("source", 1)]
    obsolete = [index["name"] for index in collection.list_indexes()
                if list(index["key"].items()) == legacy_keys and index.get("unique")]
    collection.create_index(
        [("symbol", 1), *legacy_keys], name="uq_metric_map_symbol_type_section_source",
        unique=True, partialFilterExpression={"symbol": {"$type": "string"}},
    )
    if obsolete and not drop_obsolete:
        raise RuntimeError(f"Metric-map cutover required; back up and pause writers, then run backfill_vietcap.py migrate-metric-maps --apply; obsolete indexes: {obsolete}")
    for name in obsolete:
        collection.drop_index(name)
    return obsolete


def migrate_metric_maps(db: Any, *, apply: bool = False) -> dict[str, Any]:
    """Copy only exact retained symbol evidence; never overwrite or delete raw records."""
    collection = db["market_financial_metric_map"]
    seen: set[tuple[str, str, str, str]] = set()
    report: dict[str, Any] = {"eligible": 0, "inserted": 0, "existing": 0, "rejected": 0,
                              "normalizable_ids": 0, "normalized_ids": 0, "dropped_indexes": []}
    if apply:
        report["dropped_indexes"] = ensure_metric_map_indexes(db, drop_obsolete=True)
    for document in collection.find(
        {"schemaVersion": 3, "migrationSource.documentId": {"$type": "objectId"}},
        {"migrationSource.documentId": 1},
    ):
        identifier = document["migrationSource"]["documentId"]
        report["normalizable_ids"] += 1
        if apply:
            result = collection.update_one(
                {"_id": document["_id"], "schemaVersion": 3, "migrationSource.documentId": identifier},
                {"$set": {"migrationSource.documentId": str(identifier)}},
            )
            report["normalized_ids"] += result.modified_count

    def retain(key: dict[str, Any], descriptors: Any, evidence: Any, origin: dict[str, Any], timestamps: dict[str, Any]) -> None:
        symbol = key.get("symbol")
        if (not isinstance(symbol, str) or not symbol or symbol != symbol.strip().upper()
                or not isinstance(key.get("comTypeCode"), str) or not key["comTypeCode"]
                or not isinstance(key.get("section"), str) or not key["section"] or key.get("source") != "vietcap"
                or not isinstance(descriptors, list) or not isinstance(evidence, dict)
                or any(evidence.get(field) != value for field, value in key.items())
                or not evidence.get("receivedAt")
                or evidence.get("endpoint") != f"/v1/company/{symbol}/financial-statement/metrics"):
            report["rejected"] += 1
            return
        identity = tuple(key[field] for field in ("symbol", "comTypeCode", "section", "source"))
        if identity in seen:
            return
        seen.add(identity)
        report["eligible"] += 1
        if not apply:
            return
        document = {
            **key, "providerSource": "vietcap", "descriptors": descriptors,
            "descriptorEvidence": evidence, "receivedAt": evidence["receivedAt"],
            **timestamps,
            "schemaVersion": 3, "migrationSource": origin,
        }
        result = collection.update_one(key, {"$setOnInsert": document}, upsert=True)
        report["inserted" if result.upserted_id is not None else "existing"] += 1

    for legacy in collection.find({"symbol": {"$exists": False}, "source": "vietcap"}):
        entries = legacy.get("symbolDescriptors")
        if not isinstance(entries, dict):
            report["rejected"] += 1
            continue
        for symbol, entry in entries.items():
            if not isinstance(entry, dict) or entry.get("symbol") != symbol:
                report["rejected"] += 1
                continue
            key = {"symbol": symbol, "comTypeCode": legacy.get("comTypeCode"),
                   "section": legacy.get("section"), "source": legacy.get("source")}
            evidence = {**key, **{field: entry[field] for field in (*key, "receivedAt", "endpoint", "sourceResponse") if field in entry}}
            retain(key, entry.get("descriptors"), evidence,
                   {"collection": "market_financial_metric_map", "documentId": str(legacy["_id"]),
                    "path": f"symbolDescriptors.{symbol}",
                    **{field: legacy[field] for field in ("createdAt", "updatedAt") if field in legacy}},
                   {field: entry[field] for field in ("createdAt", "updatedAt") if field in entry})

    projection = {"symbol": 1, "comTypeCode": 1, "section": 1, "source": 1,
                  "descriptors": 1, "descriptorEvidence": 1, "createdAt": 1, "updatedAt": 1}
    for record in db["market_vnstock_premium_records"].find(
        {"source": "vietcap", "descriptorEvidence": {"$exists": True}}, projection,
    ).sort("receivedAt", -1):
        key = {field: record.get(field) for field in ("symbol", "comTypeCode", "section", "source")}
        retain(key, record.get("descriptors"), record.get("descriptorEvidence"),
               {"collection": "market_vnstock_premium_records", "documentId": str(record["_id"]),
                "path": "descriptorEvidence"},
               {field: record[field] for field in ("createdAt", "updatedAt") if field in record})
    return report


def _financial_provenance(raw: dict[str, Any], received_at: datetime) -> dict[str, Any]:
    unit_evidence = {key: raw[key] for key in ("unit", "unitCode", "currency", "currencyCode", "scale") if raw.get(key) is not None}
    provenance = {
        "observedAt": received_at, "receivedAt": received_at,
        "rawFiscalBasis": {key: raw[key] for key in (
            "yearReport", "lengthReport", "year", "quarter", "period", "ratioType", "ratioYearId", "ratioTTMId",
            "reportType", "consolidated", "isConsolidated", "fiscalYear", "fiscalQuarter",
            "quarterBasis", "flowBasis", "flow_basis", "consolidationBasis", "consolidation_basis",
        ) if key in raw},
        "units": unit_evidence or "unknown", "unitEvidence": unit_evidence,
    }
    public_date = raw.get("publicDate")
    if isinstance(public_date, str):
        try:
            provenance["sourceDate"] = datetime.fromisoformat(public_date.replace("Z", "+00:00"))
        except ValueError:
            pass
    return provenance


def upsert_statement_periods(
    db: Any, symbol: str, dataset: str, section: str, statement: dict[str, Any] | None,
    *, com_type: str | None = None, descriptors: Any = None,
    source_response: dict[str, Any] | None = None, descriptor_response: dict[str, Any] | None = None,
    received_at: datetime | None = None, records: list[dict[str, Any]] | None = None, dry_run: bool,
) -> int:
    """Store fiscal rows without manufacturing publication dates or units."""
    from pymongo import UpdateOne

    if not statement:
        return 0
    synced_at = received_at or (source_response or {}).get("receivedAt") or _now()
    symbol_upper = symbol.upper()
    ops = []
    count = 0
    for bucket, variant in (("years", "year"), ("quarters", "quarter")):
        for raw in statement.get(bucket, []) or []:
            period, period_type, fiscal_year, fiscal_quarter = _period_label(raw.get("yearReport"), raw.get("lengthReport"))
            record_key = f"vietcap:{dataset}:{symbol_upper}:{period}"
            doc = {
                "dataset": dataset, "datasetVariant": f"{dataset}.{variant}", "datasetGroup": "finance",
                "section": section, "symbol": symbol_upper, "scopeKey": symbol_upper, "scopeType": "symbol",
                "source": "vietcap", "providerSource": "vietcap", "comTypeCode": com_type,
                "recordKey": record_key, "period": period, "periodType": period_type,
                "fiscalYear": fiscal_year, "fiscalQuarter": fiscal_quarter,
                **_financial_provenance(raw, synced_at), "raw": raw,
                "descriptors": descriptors,
                "sourceResponse": source_response,
                "descriptorEvidence": {
                    "symbol": symbol_upper, "section": section, "comTypeCode": com_type,
                    "source": "vietcap", "receivedAt": (descriptor_response or {}).get("receivedAt") or synced_at,
                    "endpoint": f"/v1/company/{symbol_upper}/financial-statement/metrics",
                    "sourceResponse": descriptor_response,
                },
                "updatedAt": synced_at, "syncedAt": synced_at, "schemaVersion": 2,
            }
            from vnibb.services.vietcap_financials import decode_vietcap_financial_record
            doc["structured"] = decode_vietcap_financial_record(doc)
            if records is not None:
                records.append(doc)
            count += 1
            if not dry_run:
                ops.append(UpdateOne(
                    {"dataset": dataset, "symbol": symbol_upper, "recordKey": record_key},
                    {"$set": doc, "$setOnInsert": {"createdAt": synced_at}}, upsert=True,
                ))
    if ops:
        db["market_vnstock_premium_records"].bulk_write(ops, ordered=False)
    return count


# ---------------------------------------------------------------------------
# Financial ratios (statistics-financial)
# ---------------------------------------------------------------------------

def upsert_ratio_rows(
    db: Any, symbol: str, rows: list[dict[str, Any]], *, com_type: str | None = None,
    source_response: dict[str, Any] | None = None,
    received_at: datetime | None = None, records: list[dict[str, Any]] | None = None, dry_run: bool,
) -> int:
    from pymongo import UpdateOne

    synced_at = received_at or (source_response or {}).get("receivedAt") or _now()
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
        ratio_type = raw.get("ratioType")
        annual = ratio_type == "RATIO_YEAR" or quarter in (None, "", 0)
        # Rolling-twelve-month rows carry no canonical year/quarter identity; keep the raw
        # ratioType/ratioTTMId and recordKey, but never label them annual or quarterly.
        # Mirrors financial_fiscal_basis: an explicit type governs an opaque ratioTTMId.
        ttm = ratio_type == "RATIO_TTM" or (ratio_type in (None, "") and raw.get("ratioTTMId") is not None)
        variant = "ttm" if ttm else "year" if annual else "quarter"
        doc = {
            "dataset": "finance.ratio",
            "datasetVariant": f"finance.ratio.{variant}",
            "comTypeCode": com_type,
            "fiscalYear": year,
            "fiscalQuarter": None if ttm or annual else quarter,
            "periodType": None if ttm else "YEAR" if annual else "QUARTER",
            "datasetGroup": "finance",
            "symbol": symbol_upper,
            "scopeKey": symbol_upper,
            "scopeType": "symbol",
            "source": "vietcap",
            "providerSource": "vietcap",
            "recordKey": record_key,
            "period": str(year) if annual else period,
            **_financial_provenance(raw, synced_at),
            "raw": raw,
            "sourceResponse": source_response,
            "updatedAt": synced_at,
            "syncedAt": synced_at,
            "schemaVersion": 1,
        }
        from vnibb.services.vietcap_financials import decode_vietcap_financial_record
        doc["structured"] = decode_vietcap_financial_record(doc)
        if records is not None:
            records.append(doc)
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


def upsert_listing_rows(db: Any, trading_rows: list[dict[str, Any]], search_rows: list[dict[str, Any]], *, dry_run: bool) -> int:
    from pymongo import UpdateOne

    trading = {str(row["symbol"]).upper(): row for row in trading_rows if row.get("symbol")}
    search = {str(row.get("code") or row.get("ticker")).upper(): row for row in search_rows if row.get("code") or row.get("ticker")}
    received_at = _now()
    ops = []
    for symbol in sorted(trading.keys() | search.keys()):
        meta, company = trading.get(symbol, {}), search.get(symbol, {})
        record_key = f"vietcap:reference.listings:market:{symbol}"
        raw = {**meta, **company, "symbol": symbol, "ticker": symbol,
               "trading": meta, "searchBar": company}
        doc = {
            "dataset": "reference.listings", "datasetVariant": "reference.listings", "datasetGroup": "reference",
            "symbol": symbol, "scopeKey": "market", "scopeType": "market",
            "source": "vietcap", "providerSource": "vietcap", "recordKey": record_key,
            "raw": raw, "observedAt": received_at, "receivedAt": received_at,
            "updatedAt": received_at, "syncedAt": received_at, "schemaVersion": 2,
        }
        if not dry_run:
            ops.append(UpdateOne(
                {"dataset": "reference.listings", "symbol": symbol, "recordKey": record_key},
                {"$set": doc, "$setOnInsert": {"createdAt": received_at}}, upsert=True,
            ))
    if ops:
        db["market_vnstock_premium_records"].bulk_write(ops, ordered=False)
    return len(trading.keys() | search.keys())


class FinancialAcquisitionPartial(ValueError):
    def __init__(self, records: list[dict[str, Any]], errors: dict[str, str], mongo_rows: int):
        self.records = records
        self.errors = errors
        self.mongo_rows = mongo_rows
        super().__init__(f"IQ financial acquisition incomplete: Mongo rows {mongo_rows}; acquired envelopes {len(records)}; errors {errors}")


def sync_symbol_financials(db: Any, client: Any, symbol: str, *, com_type: str | None = None, dry_run: bool = False) -> list[dict[str, Any]]:
    if com_type is None:
        search_rows = client.get_company_search_bar()
        search = next((row for row in search_rows if str(row.get("code") or "").upper() == symbol.upper()), {})
        com_type = search.get("comTypeCode")
        if com_type is None:
            details = client.get_company_details(symbol) or {}
            com_type = details.get("comTypeCode")
    metric_map = client.get_financial_metrics_map(symbol)
    from vnibb.services.vietcap_client import IQ_BASE
    response_metadata = getattr(client, "response_metadata", {})
    descriptor_response = response_metadata.get(f"{IQ_BASE}/v1/company/{symbol.upper()}/financial-statement/metrics")
    if not metric_map:
        raise ValueError(f"Financial descriptors unavailable for {symbol}")
    upsert_metric_map(db, com_type, metric_map, symbol=symbol, dry_run=dry_run, descriptor_response=descriptor_response)
    records: list[dict[str, Any]] = []
    sections = {"INCOME_STATEMENT": "finance.income_statement", "BALANCE_SHEET": "finance.balance_sheet", "CASH_FLOW": "finance.cash_flow"}
    errors: dict[str, str] = {}
    mongo_rows = 0
    for section, dataset in sections.items():
        try:
            if not isinstance(metric_map.get(section), list) or not metric_map[section]:
                raise ValueError(f"Financial descriptors unavailable for {symbol}/{section}")
            statement = client.get_financial_statement(symbol, section)
            count = upsert_statement_periods(db, symbol, dataset, section, statement,
                com_type=com_type, descriptors=metric_map[section], records=records, dry_run=dry_run,
                source_response=response_metadata.get(f"{IQ_BASE}/v1/company/{symbol.upper()}/financial-statement?section={section}"),
                descriptor_response=descriptor_response)
            mongo_rows += count
            if not count:
                raise ValueError(f"Financial statement unavailable for {symbol}/{section}")
        except Exception as exc:
            errors[dataset] = str(exc)
    try:
        ratios = client.get_statistics_financial(symbol)
        if not ratios:
            raise ValueError(f"Financial ratios unavailable for {symbol}")
        mongo_rows += upsert_ratio_rows(db, symbol, ratios, com_type=com_type, records=records, dry_run=dry_run,
            source_response=response_metadata.get(f"{IQ_BASE}/v1/company/{symbol.upper()}/statistics-financial"))
    except Exception as exc:
        errors["finance.ratio"] = str(exc)
    if errors:
        raise FinancialAcquisitionPartial(records, errors, mongo_rows)
    return records


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
    source_response: dict[str, Any] | None = None,
) -> int:

    if not details and not search_row:
        return 0
    synced_at = _now()
    symbol_upper = symbol.upper()
    doc = {
        "symbol": symbol_upper,
        "source": "vietcap",
        "providerSource": "vietcap",
        "details": details or {},
        "updatedAt": synced_at,
        "syncedAt": synced_at,
        "schemaVersion": 1,
    }
    if search_row is not None:
        doc["searchBar"] = search_row
    if source_response is not None:
        doc["sourceResponse"] = source_response
    if dry_run:
        return 1
    db["market_company_profiles"].update_one(
        {"symbol": symbol_upper, "source": "vietcap"},
        {"$set": doc, "$setOnInsert": {"createdAt": synced_at}},
        upsert=True,
    )
    return 1


def upsert_shareholder_structure(db: Any, symbol: str, data: dict[str, Any] | None, *, dry_run: bool, source_response: dict[str, Any] | None = None) -> int:

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
    if source_response is not None:
        doc["sourceResponse"] = source_response
    if dry_run:
        return 1
    db["market_vnstock_premium_records"].update_one(
        {"dataset": "company.shareholder_structure", "symbol": symbol_upper, "recordKey": record_key},
        {"$set": doc, "$setOnInsert": {"createdAt": synced_at}},
        upsert=True,
    )
    return 1


async def sync_vietcap_reference(symbol: str, dataset: str, progress: dict[str, Any]) -> int:
    from vnibb.services.mongo_market_data_service import get_mongo_market_data_service
    from vnibb.services.vietcap_client import IQ_BASE, VietcapClient

    if dataset not in {"iq_company_profile", "iq_shareholder_structure"}:
        raise ValueError(f"Unsupported IQ reference dataset: {dataset}")
    symbol = symbol.strip().upper()
    if not symbol or not symbol.isascii() or not symbol.isalnum():
        raise ValueError("Invalid IQ reference symbol")
    client = VietcapClient()
    profile = dataset == "iq_company_profile"
    endpoint = f"{IQ_BASE}/v1/company/details?ticker={symbol}" if profile else f"{IQ_BASE}/v1/company/{symbol}/shareholder-structure"
    acquisition = {"source": "vietcap", "symbol": symbol, "dataset": dataset, "endpoint": endpoint, "outcome": "attempted"}
    progress["acquisition"] = acquisition
    try:
        fetch = client.get_company_details if profile else client.get_shareholder_structure
        data = await asyncio.to_thread(fetch, symbol)
        metadata = client.response_metadata.get(endpoint, {})
        acquisition["source_response"] = metadata
        if not data:
            confirmed = metadata.get("successful") is True or metadata.get("success") is True or str(metadata.get("status")) in {"0", "200"} or str(metadata.get("code")) in {"0", "200"}
            if not confirmed:
                raise RuntimeError(f"Unconfirmed empty IQ reference response for {symbol}/{dataset}")
            progress["empty_count"] = progress.get("empty_count", 0) + 1
            acquisition.update(outcome="confirmed_empty", rows=0)
            return 0

        def persist() -> int:
            database = get_mongo_market_data_service()._get_database()
            if profile:
                return upsert_company_profile(database, symbol, data, None, dry_run=False, source_response=metadata)
            return upsert_shareholder_structure(database, symbol, data, dry_run=False, source_response=metadata)
        count = await asyncio.to_thread(persist)
        progress["success_count"] = progress.get("success_count", 0) + count
        acquisition.update(outcome="succeeded", rows=count)
        return count
    except Exception as exc:
        acquisition.update(outcome="failed", error=f"{type(exc).__name__}: {exc}", source_response=client.response_metadata.get(endpoint, {}))
        progress["error_count"] = progress.get("error_count", 0) + 1
        raise


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
