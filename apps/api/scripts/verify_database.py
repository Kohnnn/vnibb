"""Legacy database check and opt-in, provider-free physical coverage inventory."""
import argparse
import ast
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sqlite3
from collections import Counter
from datetime import date, datetime

def check_database():
    """Check database structure and content."""
    print("="*60)
    print("PHASE 31: DATABASE VERIFICATION")
    print("="*60)
    
    # 1. Check file exists
    db_path = "test.db"
    if not os.path.exists(db_path):
        print("❌ Database file not found!")
        return False
    
    file_size = os.path.getsize(db_path)
    print(f"✅ Database file exists: {file_size:,} bytes")
    
    # 2. Connect and check tables
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = [t[0] for t in cursor.fetchall()]
    
    print(f"\n📊 Found {len(tables)} tables:")
    
    # Get row counts
    table_info = []
    for table in sorted(tables):
        try:
            cursor.execute(f"SELECT COUNT(*) FROM {table}")
            count = cursor.fetchone()[0]
            table_info.append((table, count))
            status = "✅" if count > 0 else "⚠️ "
            print(f"  {status} {table}: {count:,} rows")
        except Exception as e:
            print(f"  ❌ {table}: Error - {e}")
    
    # 3. Summary
    total_rows = sum(count for _, count in table_info)
    empty_tables = sum(1 for _, count in table_info if count == 0)
    
    print("\n" + "="*60)
    print(f"📈 SUMMARY:")
    print(f"  Total tables: {len(tables)}")
    print(f"  Total rows: {total_rows:,}")
    print(f"  Empty tables: {empty_tables}")
    print("="*60)
    
    conn.close()
    return True


def check_vnstock():
    """Check VNStock connection."""
    print("\n🔄 Testing VNStock connection...")
    try:
        from vnstock import Listing
        listing = Listing(source="VCI")
        df = listing.all_symbols()
        print(f"✅ VNStock connected: {len(df):,} symbols available")
        return True
    except Exception as e:
        print(f"❌ VNStock error: {e}")
        return False


FINANCIAL_DATASETS = {
    "income_statements": "finance.income_statement",
    "balance_sheets": "finance.balance_sheet",
    "cash_flows": "finance.cash_flow",
    "financial_ratios": "finance.ratio",
}
FIELD_ALIASES = {
    "operating_expense": "operating_expenses", "profit_before_tax": "income_before_tax",
    "tax_expense": "income_tax", "equity": "total_equity", "cash": "cash_and_equivalents",
    "receivables": "accounts_receivable", "long_term_liabilities": "non_current_liabilities",
    "net_cash_flow": "net_change_in_cash", "pe": "pe_ratio", "pb": "pb_ratio", "ps": "ps_ratio",
    "debt_equity": "debt_to_equity", "debt_assets": "debt_to_assets",
}
SQL_DATASETS = {
    "stocks": None, "companies": "listing_date", "stock_prices": "time",
    "stock_indices": "time", **dict.fromkeys(FINANCIAL_DATASETS),
    "company_news": "published_date", "company_events": "event_date", "dividends": "exercise_date",
    "insider_deals": "announce_date", "foreign_trading": "trade_date", "order_flow_daily": "trade_date",
    "intraday_trades": "trade_time", "orderbook_snapshots": "snapshot_time",
    "shareholders": "as_of_date", "officers": "appointment_date", "subsidiaries": None,
    "market_sectors": None, "sector_performance": "trade_date", "screener_snapshots": "snapshot_date",
}
UNAVAILABLE_REASONS = {
    "unit_unverified", "descriptor_unavailable", "descriptor_scope_unverified", "ambiguous_descriptor",
    "invalid_raw_row", "unsupported_dataset", "quarter_basis_unverified", "incompatible_quarter_basis",
    "fiscal_basis_unverified", "invalid_value", "missing_value", "value_unavailable",
}


def load_universe(path):
    content = Path(path).read_bytes()
    payload = json.loads(content)
    rows = payload if isinstance(payload, list) else payload.get("instruments", payload.get("data")) if isinstance(payload, dict) else None
    if not isinstance(rows, list) or not rows:
        raise ValueError("Universe must contain a nonempty getAll list or instruments/data list")
    universe = {}
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("Invalid universe row")
        symbol = str(row.get("symbol") or "").strip().upper()
        kind = str(row.get("type") or "").strip().upper()
        board = str(row.get("board") or "").strip().upper()
        if not re.fullmatch(r"[A-Z0-9_.-]{1,40}", symbol) or not re.fullmatch(r"[A-Z_]{1,30}", kind):
            raise ValueError("Universe symbol/type unavailable or invalid")
        identity = (kind, board)
        if symbol in universe and universe[symbol] != identity:
            raise ValueError("Conflicting universe identity")
        universe[symbol] = identity
    return universe, hashlib.sha256(content).hexdigest()


def coverage(expected, present):
    present = {str(value).strip().upper() for value in present if value
               and re.fullmatch(r"[A-Za-z0-9_.-]{1,40}", str(value).strip())}
    if expected is None:
        return {"expected_count": None, "present_count": len(present), "present": sorted(present),
                "missing_count": None, "missing": None, "reason": "supported_scope_unavailable"}
    expected = set(expected)
    return {"expected_count": len(expected), "present_count": len(present & expected),
            "present": sorted(present & expected), "missing_count": len(expected - present),
            "missing": sorted(expected - present), "outside_expected": sorted(present - expected)}


def premium_catalog():
    source = Path(__file__).resolve().parents[1] / "vnibb/mcp/server.py"
    catalog = {}
    for node in ast.walk(ast.parse(source.read_text())):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "PremiumDatasetSpec":
            name = ast.literal_eval(node.args[0])
            scope = next((ast.literal_eval(item.value) for item in node.keywords if item.arg == "scope_type"), "symbol")
            catalog[name] = scope
    return catalog


def safe_scopes(rows):
    return [{"scope_type": identity if re.fullmatch(r"[a-z_]{1,30}", str(identity or "")) else None,
             "scope_key": key if re.fullmatch(r"[A-Za-z0-9_.-]{1,40}", str(key or "")) else None,
             "rows": row["rows"]}
            for row in rows for identity, key in [(row["_id"].get("type"), row["_id"].get("key"))]]

def safe_bound(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).isoformat()
        except ValueError:
            return None
    return None


def safe_periods(rows, mongo=False):
    result = []
    for row in rows:
        identity = row["_id"] if mongo else row
        year = identity.get("year" if mongo else "fiscal_year")
        quarter = identity.get("quarter" if mongo else "fiscal_quarter")
        variant = identity.get("variant" if mongo else "period_type")
        variants = {"year", "quarter"} | {f"{name}.{period}" for name in FINANCIAL_DATASETS.values() for period in ("year", "quarter")}
        result.append({"year": year if isinstance(year, int) and 1900 <= year <= 9999 else None,
                       "quarter": quarter if isinstance(quarter, int) and quarter in (1, 2, 3, 4) else None,
                       "variant": variant if variant in variants else None, "rows": row["rows"]})
    return result



def contract(dataset):
    if dataset in FINANCIAL_DATASETS or dataset.startswith("finance."):
        return {"refresh_owner": "data_pipeline.sync_financial_data / vietcap.backfill_vietcap",
                "supported_scope": "SQL currently listed STOCK; IQ raw CLI STOCK including delisted; SQL admission requires field evidence",
                "history_bound": "SQL maintenance default 6 FY / 40 Q; IQ retains returned FY/Q, no invented dates",
                "source_anchor": "vnibb/services/vietcap_financials.py; scripts/repair_financial_periods.py"}
    if dataset in {"stock_prices", "market_prices_eod"}:
        return {"refresh_owner": "daily price sync / mongo_eod_sync; historical mongo_eod_catchup",
                "supported_scope": "SQL STOCK; Mongo STOCK/ETF/FUND/UNIT_TRUST",
                "history_bound": "incremental <=30 days; catch-up 50 symbols x 30-day window from 2000-01-01; CLI count-back 10000",
                "source_anchor": "vnibb/services/mongo_eod_sync.py; scripts/vietcap/backfill_vietcap.py"}
    if dataset in {"order_flow_daily", "foreign_trading", "intraday_trades", "orderbook_snapshots",
                   "market_intraday_trades"} or dataset.startswith(("equity.", "quote.")):
        return {"refresh_owner": "data_pipeline trading rotation; typed Mongo derivation is operator-run",
                "supported_scope": "sorted active SQL Stock universe; durable foreign/intraday acquisition rotation max 200 pairs; realtime ticks/depth max 120 pairs",
                "history_bound": "bounded observations; SQL ticks default 7 days, flow/foreign default 3 years; latest depth is not historical replay; session completeness unknown",
                "source_anchor": "vnibb/services/data_pipeline.py; scripts/mongodb/derive_intraday_trades.py"}
    if dataset in {"shareholders", "officers", "subsidiaries", "company_news", "insider_deals"}:
        return {"refresh_owner": "FullMarketSync.run_maintenance_cycle supplemental_vnstock_sync",
                "supported_scope": "active SQL stocks, persistent per-symbol/dataset rotation",
                "history_bound": "bounded provider response; weekday 120 / weekend 300 attempts per stage; not daily universe completion",
                "source_anchor": "vnibb/services/sync_all_data.py; vnibb/core/scheduler.py"}
    if dataset in {"market_sectors", "sector_performance"}:
        return {"refresh_owner": "supplemental_company_sync / sync_market_sectors",
                "supported_scope": "static VN_SECTORS definitions; dated sector aggregates",
                "history_bound": "retained daily aggregates, not issuer history",
                "source_anchor": "vnibb/services/data_pipeline.py; vnibb/services/sync_all_data.py"}
    if dataset in {"market_company_profiles", "market_financial_metric_map", "market_index_constituents", "market_icb_sectors", "reference.listings", "company.shareholder_structure"}:
        return {"refresh_owner": "scripts/vietcap/backfill_vietcap.py (operator-run); recurring SQL writers do not imply Mongo refresh",
                "supported_scope": "IQ selected symbols (including exact symbol/type/section descriptors); index group/ICB scopes are not equity symbol scopes",
                "history_bound": "retained profile/reference snapshot, not historical replay",
                "source_anchor": "vnibb/services/vietcap_ingestion.py; scripts/vietcap/backfill_vietcap.py"}
    return {"refresh_owner": "manual_or_unknown; no recurring coverage claim",
            "supported_scope": "stored scope; expected identities unavailable unless explicitly declared",
            "history_bound": "retained bounds only; no source history completeness claim",
            "source_anchor": "docs/VNIBB_MCP_READONLY.md; scripts/vietcap/backfill_vietcap.py"}


def unavailable_entry(store, dataset, reason):
    return {"store": store, "dataset": dataset, "status": "unavailable", "reason": reason,
            "rows": None, "coverage": None, "contract": contract(dataset)}


def financial_field_counts(rows, fields):
    counts = {field: {"nonnull": 0, "null": 0, "admitted": 0, "unverified_nonnull": 0,
                      "unavailable_reasons": {"unit_unverified": 0, "descriptor_unavailable": 0}} for field in fields}
    for row in rows:
        raw = row.get("raw_data") or {}
        if isinstance(raw, str):
            raw = json.loads(raw)
        structured = raw.get("structured", {}) if isinstance(raw, dict) else {}
        if not isinstance(structured, dict):
            structured = {}
        evidence = structured.get("fieldEvidence", {})
        values = structured.get("values", {})
        if not isinstance(evidence, dict) or not isinstance(values, dict):
            evidence, values = {}, {}
        for field in fields:
            value = row.get(field)
            count = counts[field]
            count["null" if value is None else "nonnull"] += 1
            unavailable = structured.get("unavailable", {})
            unavailable = unavailable if isinstance(unavailable, dict) else {}
            reasons = [reason for name, reason in unavailable.items() if FIELD_ALIASES.get(name, name) == field]
            for reason in reasons:
                reason = reason if isinstance(reason, str) and reason in UNAVAILABLE_REASONS else "other_unavailable"
                count["unavailable_reasons"][reason] = count["unavailable_reasons"].get(reason, 0) + 1
            if not reasons and value is None:
                count["unavailable_reasons"]["reason_not_retained"] = count["unavailable_reasons"].get("reason_not_retained", 0) + 1
            if value is None:
                continue
            names = [name for name in values if FIELD_ALIASES.get(name, name) == field]
            proof = evidence.get(names[0], {}) if len(names) == 1 else {}
            proof = proof if isinstance(proof, dict) else {}
            descriptor_scope = proof.get("descriptorEvidence") or {}
            descriptor_scope = descriptor_scope if isinstance(descriptor_scope, dict) else {}
            admitted = (row.get("source") == "vietcap" and isinstance(value, (int, float))
                        and not isinstance(value, bool) and math.isfinite(value) and len(names) == 1
                        and values[names[0]] == value and proof.get("unit") in {"VND", "VND/share", "percent", "ratio", "times", "days", "shares"}
                        and descriptor_scope.get("source") == "vietcap"
                        and descriptor_scope.get("symbol") == row.get("symbol")
                        and descriptor_scope.get("endpoint") == f"/v1/company/{row.get('symbol')}/financial-statement/metrics"
                        and descriptor_scope.get("receivedAt") and proof.get("descriptors"))
            count["admitted" if admitted else "unverified_nonnull"] += 1
    return counts


def sql_inventory(url, universe):
    from sqlalchemy import Float, MetaData, Table, create_engine, func, inspect, select, text
    from sqlalchemy.engine import make_url

    if not url:
        return [unavailable_entry("sql", name, "not_configured") for name in SQL_DATASETS]
    parsed = make_url(url)
    if parsed.get_backend_name() not in {"postgresql", "sqlite"}:
        raise ValueError("Inventory supports PostgreSQL or SQLite only")
    if parsed.get_backend_name() == "postgresql":
        parsed = parsed.set(drivername="postgresql+psycopg2")
        engine = create_engine(parsed, connect_args={"connect_timeout": 10}, hide_parameters=True)
    else:
        if not parsed.database or parsed.database == ":memory:":
            raise ValueError("Inventory requires an existing SQLite file")
        filename = Path(parsed.database).resolve().as_uri() + "?mode=ro"
        engine = create_engine("sqlite://", creator=lambda: sqlite3.connect(filename, uri=True))
    entries = []
    current = {symbol for symbol, (kind, board) in universe.items() if kind == "STOCK" and board != "DELISTED"}
    try:
        with engine.connect() as connection:
            transaction = connection.begin()
            try:
                if parsed.get_backend_name() == "postgresql":
                    connection.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"))
                else:
                    connection.execute(text("PRAGMA query_only=ON"))
                    connection.execute(text("BEGIN"))
                names = set(inspect(connection).get_table_names())
                active = set()
                if "stocks" in names:
                    stocks = Table("stocks", MetaData(), autoload_with=connection)
                    if "is_active" in stocks.c:
                        active = set(connection.scalars(select(stocks.c.symbol).where(stocks.c.is_active == 1)))
                for name, date_field in SQL_DATASETS.items():
                    if name not in names:
                        entries.append(unavailable_entry("sql", name, "table_absent"))
                        continue
                    table = Table(name, MetaData(), autoload_with=connection)
                    key = "symbol" if "symbol" in table.c else "index_code" if "index_code" in table.c else None
                    expected = current if key == "symbol" else None
                    present = connection.scalars(select(table.c[key]).distinct()) if key else []
                    count = connection.scalar(select(func.count()).select_from(table))
                    entry = {"store": "sql", "dataset": name, "status": "available" if count else "empty",
                             "rows": count, "coverage": coverage(expected, present), "contract": contract(name)}
                    if key == "symbol":
                        entry["active_sql_coverage"] = coverage(active, connection.scalars(select(table.c.symbol).distinct()))
                        all_stock = {symbol for symbol, (kind, _) in universe.items() if kind == "STOCK"}
                        entry["all_stock_type_coverage"] = coverage(all_stock, connection.scalars(select(table.c.symbol).distinct()))
                    if date_field and date_field in table.c:
                        low, high = connection.execute(select(func.min(table.c[date_field]), func.max(table.c[date_field]))).one()
                        entry["history_bounds"] = {"field": date_field, "earliest": safe_bound(low),
                                                   "latest": safe_bound(high)}
                    if name in FINANCIAL_DATASETS:
                        fields = [column.name for column in table.c if isinstance(column.type, Float)]
                        entry["periods"] = safe_periods(connection.execute(select(
                            table.c.period_type, table.c.fiscal_year, table.c.fiscal_quarter, func.count().label("rows")
                        ).group_by(table.c.period_type, table.c.fiscal_year, table.c.fiscal_quarter)
                          .order_by(table.c.period_type, table.c.fiscal_year, table.c.fiscal_quarter)).mappings())
                        entry["history_bounds"] = {"field": "fiscal_year", "earliest": connection.scalar(select(func.min(table.c.fiscal_year))),
                                                   "latest": connection.scalar(select(func.max(table.c.fiscal_year))),
                                                   "note": "Grouped periods retain independent FY/Q identities."}
                        columns = [table.c[field] for field in ["symbol", "source", "raw_data", *fields] if field in table.c]
                        entry["fields"] = financial_field_counts(connection.execute(select(*columns)).mappings(), fields)
                        entry["admission_note"] = "Nonnull is not admitted. Counts require retained IQ descriptor/unit evidence; VCI/legacy evidence not certified here."
                    if name == "order_flow_daily" and "coverage" in table.c:
                        sample_states = Counter()
                        for value in connection.scalars(select(table.c.coverage)):
                            if isinstance(value, str):
                                value = json.loads(value)
                            state = "metadata_absent" if not isinstance(value, dict) else "sample_or_unverified"
                            sample_states[state] += 1
                        entry["flow_coverage_metadata_rows"] = dict(sorted(sample_states.items()))
                    entries.append(entry)
            finally:
                transaction.rollback()
    finally:
        engine.dispose()
    return entries


def mongo_summary(collection, query, key, bound):
    group = {"_id": f"${key}", "rows": {"$sum": 1}}
    if bound:
        group.update(earliest={"$min": f"${bound}"}, latest={"$max": f"${bound}"})
    return list(collection.aggregate([{"$match": query}, {"$group": group}, {"$sort": {"_id": 1}}],
                                     allowDiskUse=False, maxTimeMS=30000))


def mongo_inventory(url, database, universe):
    from pymongo import MongoClient

    price_types = {"market_prices_eod": {"STOCK", "ETF", "FUND", "UNIT_TRUST"},
                   "market_prices_cw": {"CW"}, "market_prices_derivatives": {"FU"},
                   "market_prices_bond": {"BOND", "DEBENTURE"}}
    physical = {**dict.fromkeys(price_types, "tradeDate"), "market_company_profiles": "updatedAt",
                "market_financial_metric_map": "receivedAt", "market_index_constituents": "syncedAt",
                "market_icb_sectors": "updatedAt", "market_intraday_trades": "tradeTime"}
    catalog = premium_catalog()
    required = {"reference.listings", "company.shareholder_structure", *catalog,
                "quote.intraday", *FINANCIAL_DATASETS.values()}
    if not url:
        return [unavailable_entry("mongo", name, "not_configured") for name in sorted({*physical, *required})]
    client = MongoClient(url, serverSelectionTimeoutMS=10000, socketTimeoutMS=30000)
    entries = []
    try:
        db = client[database]
        names = set(db.list_collection_names())
        premium = "market_vnstock_premium_records"
        retained = set(db[premium].distinct("dataset")) if premium in names else set()
        datasets = {name for name in retained if isinstance(name, str) and re.fullmatch(r"[a-z_]+(?:\.[a-z_]+)+", name)} | required
        specs = [(name, name, {"source": "vietcap", "schemaVersion": 3, "symbol": {"$type": "string"}} if name == "market_financial_metric_map" else {}, "symbol", bound) for name, bound in physical.items()]
        for dataset in sorted(datasets):
            # Catalog scopes, not outer equity symbols, define market identity.
            market_scoped = catalog.get(dataset) == "market" or dataset.startswith(("macro.", "market.", "analytics.valuation."))
            specs.append((premium, dataset, {"dataset": dataset, **({"source": "vietcap"} if dataset.startswith("finance.") else {})},
                          "scopeKey" if market_scoped else "symbol", "observedAt" if dataset.startswith(("equity.", "quote.")) else "sourceDate"))
        for collection, dataset, query, key, bound in specs:
            if collection not in names:
                entry = unavailable_entry("mongo", dataset, "collection_absent")
                entry["collection"] = collection
                entries.append(entry)
                continue
            rows = mongo_summary(db[collection], query, key, bound)
            expected = {symbol for symbol, (kind, _) in universe.items() if kind in price_types[dataset]} if dataset in price_types else None
            if dataset.startswith("finance.") or dataset in {"market_company_profiles", "market_financial_metric_map", "reference.listings", "company.shareholder_structure"}:
                expected = {symbol for symbol, (kind, _) in universe.items() if kind == "STOCK"}
            if dataset in {"analytics.valuation.pe", "analytics.valuation.pb"}:
                expected = {"VNINDEX"}
            count = sum(row["rows"] for row in rows)
            entry = {"store": "mongo", "collection": collection, "dataset": dataset,
                     "status": "available" if count else "empty", "rows": count,
                     "coverage": coverage(expected, [row["_id"] for row in rows]), "contract": contract(dataset),
                     "history_bounds": {"field": bound, "earliest": min((safe_bound(row["earliest"]) for row in rows if safe_bound(row.get("earliest")) is not None), default=None),
                                        "latest": max((safe_bound(row["latest"]) for row in rows if safe_bound(row.get("latest")) is not None), default=None)}}
            if expected is not None and dataset not in {"analytics.valuation.pe", "analytics.valuation.pb"}:
                current = {symbol for symbol in expected if universe[symbol][1] != "DELISTED"}
                entry["currently_listed_coverage"] = coverage(current, [row["_id"] for row in rows])
            if collection == "market_financial_metric_map":
                entry["descriptor_symbol_coverage"] = coverage(expected, [row["_id"] for row in rows])
                entry["historical_raw_documents"] = db[collection].count_documents({"symbol": {"$exists": False}})
            if collection == premium:
                entry["scope_counts"] = safe_scopes(db[collection].aggregate([
                    {"$match": query}, {"$group": {"_id": {"type": "$scopeType", "key": "$scopeKey"}, "rows": {"$sum": 1}}},
                    {"$sort": {"_id.type": 1, "_id.key": 1}},
                ], maxTimeMS=30000))
                ingestion = mongo_summary(db[collection], query, "dataset", "updatedAt")
                entry["ingestion_bounds"] = [{"rows": row["rows"], "earliest": safe_bound(row.get("earliest")),
                                              "latest": safe_bound(row.get("latest"))} for row in ingestion]
                if dataset in {"equity.price_depth", "equity.intraday", "quote.intraday"}:
                    entry["latest_write_batches"] = [
                        {"symbol": row["_id"] if re.fullmatch(r"[A-Za-z0-9_.-]{1,40}", str(row["_id"] or "")) else None,
                         "updated_at": safe_bound(row.get("latest")), "retained_rows": row["rows"]}
                        for row in mongo_summary(db[collection], query, "symbol", "updatedAt")
                    ]
                    entry["session_completeness"] = "unknown; newest write is not a full-session receipt"
            if dataset.startswith("finance."):
                entry["periods"] = safe_periods(db[collection].aggregate([
                    {"$match": query}, {"$group": {"_id": {"variant": "$datasetVariant", "year": "$fiscalYear", "quarter": "$fiscalQuarter"}, "rows": {"$sum": 1}}},
                    {"$sort": {"_id.variant": 1, "_id.year": 1, "_id.quarter": 1}},
                ], maxTimeMS=30000), mongo=True)
                years = [row["year"] for row in entry["periods"] if row["year"] is not None]
                entry["fiscal_bounds"] = {"earliest_year": min(years, default=None), "latest_year": max(years, default=None)}
                reasons = db[collection].aggregate([
                    {"$match": query}, {"$project": {"reasons": {"$objectToArray": {"$ifNull": ["$structured.unavailable", {}]}}}},
                    {"$unwind": "$reasons"}, {"$group": {"_id": "$reasons.v", "fields": {"$sum": 1}}},
                ], maxTimeMS=30000)
                safe_reasons = Counter()
                for row in reasons:
                    reason = row["_id"] if isinstance(row["_id"], str) and row["_id"] in UNAVAILABLE_REASONS else "other_unavailable"
                    safe_reasons[reason] += row["fields"]
                entry["unavailable_field_reasons"] = {reason: safe_reasons.get(reason, 0) for reason in sorted(UNAVAILABLE_REASONS | set(safe_reasons))}
                entry["retained_structured_fields"] = sum(row["fields"] for row in db[collection].aggregate([
                    {"$match": query}, {"$project": {"fields": {"$size": {"$objectToArray": {"$ifNull": ["$structured.values", {}]}}}}},
                ], maxTimeMS=30000))
                entry["admission_note"] = "Raw retained envelopes and decoded fields are not proof of SQL persistence. Receipt time is not fiscal publication."
            entries.append(entry)
    finally:
        client.close()
    return entries


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inventory", action="store_true", help="Read-only JSON report; never calls a provider")
    parser.add_argument("--universe-json", type=Path, help="Supplied getAll response list or captured instruments/data artifact")
    parser.add_argument("--env-file", type=Path, help="Private dotenv credentials file; values never printed")
    args = parser.parse_args()
    if not args.inventory:
        check_database()
        check_vnstock()
        return 0
    if not args.universe_json:
        parser.error("--inventory requires --universe-json; no provider discovery fallback")
    if args.env_file:
        from dotenv import load_dotenv
        load_dotenv(args.env_file, override=False)
    try:
        universe, digest = load_universe(args.universe_json)
    except Exception:
        parser.error("Universe file unreadable or invalid; expected getAll instruments with symbol/type")
    stocks = {symbol for symbol, (kind, _) in universe.items() if kind == "STOCK"}
    current = {symbol for symbol in stocks if universe[symbol][1] != "DELISTED"}
    report = {"read_only": True, "provider_calls": 0, "universe_sha256": digest,
              "universe": {"all_instruments": len(universe), "stock_all": len(stocks),
                           "stock_currently_listed": len(current), "stock_delisted": len(stocks - current)},
              "limitations": ["Physical presence is not exchange-session/history completeness or freshness.",
                              "No scaling, provider truth, paid-source rights, or full-session replay is inferred.",
                              "QA ticket outcomes are not certified by inventory; #94 requires separate authenticated acceptance."],
              "datasets": []}
    report["qa_contracts"] = {
        "source": "https://github.com/Kohnnn/vnibb/issues/111#issuecomment-6141309859",
        "inventory_related": [98, 103, 97, 107, 105, 115, 116, 118, 119, 120, 121, 122, 123],
        "not_assessed_by_physical_inventory": [94, 117],
        "status": "not_certified; dataset presence does not satisfy ticket acceptance",
    }
    failed = False
    for store, reader in (("sql", lambda: sql_inventory(os.getenv("DATABASE_URL_SYNC") or os.getenv("DATABASE_URL"), universe)),
                          ("mongo", lambda: mongo_inventory(os.getenv("MONGODB_URL") if os.getenv("MONGODB_ENABLED", "true").lower() not in {"false", "0"} else None,
                                                            os.getenv("MONGODB_DATABASE", "vnibb-market"), universe))):
        try:
            report["datasets"].extend(reader())
        except Exception as exc:
            failed = True
            report[store] = {"status": "query_failed", "reason": type(exc).__name__}
    report["datasets"].sort(key=lambda row: (row["store"], row["dataset"]))
    print(json.dumps(report, sort_keys=True, indent=2, allow_nan=False, default=str))
    return int(failed)


if __name__ == "__main__":
    raise SystemExit(main())
