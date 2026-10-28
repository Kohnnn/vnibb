"""Bounded, provider-free SQL inventory for the MCP generic collection reader."""
import argparse
import json
import os
import re
import sqlite3
from collections import defaultdict
from pathlib import Path

from sqlalchemy import create_engine, select, text
from sqlalchemy.engine import make_url

from scripts.verify_database import FINANCIAL_DATASETS
from vnibb.core.financial_sources import ADMITTED_FINANCIAL_SOURCES
from vnibb.mcp.server import _serialize_row, serialize_data_value
from vnibb.models.financials import BalanceSheet, CashFlow, IncomeStatement

MODELS = {"income_statements": IncomeStatement, "balance_sheets": BalanceSheet, "cash_flows": CashFlow}
MAX_SYMBOLS = 50
MAX_PERIODS = 40
MAX_ROWS = 10000


def parse_scope(symbols, periods):
    symbols = [item.strip().upper() for item in symbols.split(",")]
    periods = [item.strip().upper() for item in periods.split(",")]
    if not symbols or len(symbols) > MAX_SYMBOLS or len(set(symbols)) != len(symbols) or any(
        not re.fullmatch(r"[A-Z0-9_.-]{1,10}", symbol) for symbol in symbols
    ):
        raise ValueError("Provide 1-50 unique, valid comma-separated symbols")
    if not periods or len(periods) > MAX_PERIODS or len(set(periods)) != len(periods) or any(
        not re.fullmatch(r"20\d{2}|Q[1-4]-20\d{2}", period) for period in periods
    ):
        raise ValueError("Provide 1-40 unique periods as YYYY or Qn-YYYY")
    return sorted(symbols), sorted(periods)


def period_key(row):
    year, quarter, kind = row["fiscal_year"], row["fiscal_quarter"], row["period_type"]
    if kind == "year" and quarter is None:
        return str(year)
    if kind == "quarter" and quarter in (1, 2, 3, 4):
        return f"Q{quarter}-{year}"
    return None


def summarize_row(row, model):
    fields = [c.name for c in model.__table__.columns if c.type.python_type is float]
    stored = {field: row[field] is not None for field in fields}
    raw = row.get("raw_data")
    lineage = raw.get("_financial_lineage") if isinstance(raw, dict) else None
    result = {"source": row.get("source"), "period": row.get("period"),
              "period_type": row.get("period_type"), "fiscal_year": row.get("fiscal_year"),
              "fiscal_quarter": row.get("fiscal_quarter"), "lineage_retained": isinstance(lineage, dict),
              "fields": {}}
    if row.get("source") not in ADMITTED_FINANCIAL_SOURCES:
        result["status"] = "unsupported_source"
        result["fields"] = {field: {"stored": present, "admitted": False,
                                    "reason": "unsupported_source" if present else "missing_value"}
                            for field, present in stored.items()}
        return result
    try:
        if not row.get("period"):
            raise ValueError("Missing period bypasses MCP admission")
        served = serialize_data_value(_serialize_row(row, model=model))
        unavailable = served.get("unavailable_metrics", {})
        result["status"] = "evaluated"
        result["row_reason"] = served.get("unavailable_reason")
        for field, present in stored.items():
            admitted = present and served.get(field) is not None
            result["fields"][field] = {"stored": present, "admitted": admitted,
                                       "reason": None if admitted else (unavailable.get(field, "consumer_value_unavailable") if present else "missing_value")}
    except Exception as exc:
        result["status"] = "consumer_fault"
        result["error_type"] = type(exc).__name__
        result["fields"] = {field: {"stored": present, "admitted": None, "reason": "consumer_fault"}
                            for field, present in stored.items()}
    return result


def build_report(symbols, periods, datasets):
    entries = []
    invalid = []
    unclassified = []
    for name, model in MODELS.items():
        grouped = defaultdict(list)
        for row in datasets[name]:
            if not isinstance(row["fiscal_year"], int) or not 1900 <= row["fiscal_year"] <= 2100:
                invalid.append({"dataset": name, "symbol": row["symbol"], **summarize_row(row, model)})
                continue
            key = period_key(row)
            if row["symbol"] in symbols and key in periods:
                grouped[(row["symbol"], key)].append(summarize_row(row, model))
            elif row["symbol"] in symbols and row["fiscal_year"] in {int(period[-4:]) for period in periods} and key is None:
                unclassified.append({"dataset": name, "symbol": row["symbol"], **summarize_row(row, model)})
        for symbol in symbols:
            for period in periods:
                rows = grouped[(symbol, period)]
                entries.append({"dataset": name, "symbol": symbol, "expected_period": period,
                                "status": "present" if rows else "missing_row", "rows": rows})
    return {"read_only": True, "provider_calls": 0,
            "consumer_path": "MCP query_database_collection_data SQL source filter and _serialize_row; before pagination",
            "scope": {"symbols": symbols, "periods": periods, "datasets": list(MODELS),
                      "expected_symbol_period_dataset_cells": len(symbols) * len(periods) * len(MODELS),
                      "interpretation": "operator-selected cells only; not a market or provider completeness denominator"},
            "limitations": ["Not MCP latest/snapshot, merged HTTP responses, provider availability, source rights, deployment identity, or actual paginated visibility.",
                            "Fiscal-year outliers and unclassified fiscal identities are diagnostics outside the denominator; cells use stored fiscal columns.",
                            "Stored values and raw evidence are not printed. Admission is not a provenance or source-rights certification."],
            "source_allowlist": list(ADMITTED_FINANCIAL_SOURCES), "cells": entries, "invalid_fiscal_year_rows": invalid,
            "unclassified_identity_rows": unclassified}


def inventory(url, symbols, periods):
    if not url:
        raise ValueError("DATABASE_URL_SYNC or DATABASE_URL is required")
    parsed = make_url(url)
    backend = parsed.get_backend_name()
    if backend == "postgresql":
        engine = create_engine(parsed.set(drivername="postgresql+psycopg2"), connect_args={"connect_timeout": 10}, hide_parameters=True)
    elif backend == "sqlite" and parsed.database and parsed.database != ":memory:":
        filename = Path(parsed.database).resolve().as_uri() + "?mode=ro"
        engine = create_engine("sqlite://", creator=lambda: sqlite3.connect(filename, uri=True))
    else:
        raise ValueError("A PostgreSQL URL or existing SQLite file is required")
    years = {int(period[-4:]) for period in periods}
    datasets = {}
    try:
        with engine.connect() as connection:
            transaction = connection.begin()
            try:
                if backend == "postgresql":
                    connection.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"))
                    connection.execute(text("SET LOCAL statement_timeout = '10s'"))
                    connection.execute(text("SET LOCAL lock_timeout = '1s'"))
                    if connection.scalar(text("SHOW transaction_read_only")) != "on":
                        raise RuntimeError("Read-only transaction not enforced")
                else:
                    connection.execute(text("PRAGMA query_only=ON"))
                    connection.execute(text("BEGIN"))
                for name, model in MODELS.items():
                    assert name in FINANCIAL_DATASETS
                    table = model.__table__
                    query = select(*table.c).where(table.c.symbol.in_(symbols),
                        (table.c.fiscal_year.in_(years)) | table.c.fiscal_year.is_(None) |
                        (table.c.fiscal_year < 1900) | (table.c.fiscal_year > 2100))
                    rows = connection.execute(query.limit(MAX_ROWS + 1)).mappings().all()
                    if len(rows) > MAX_ROWS:
                        raise RuntimeError("Row bound exceeded; narrow the symbol/period scope")
                    datasets[name] = [dict(row) for row in rows]
            finally:
                transaction.rollback()
    finally:
        engine.dispose()
    return build_report(symbols, periods, datasets)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--symbols", required=True, help="Explicit comma-separated symbols (maximum 50)")
    parser.add_argument("--periods", required=True, help="Explicit comma-separated YYYY or Qn-YYYY periods (maximum 40)")
    parser.add_argument("--env-file", type=Path, help="Private dotenv file containing a read-only database URL")
    args = parser.parse_args()
    try:
        symbols, periods = parse_scope(args.symbols, args.periods)
        if args.env_file:
            from dotenv import load_dotenv
            if not load_dotenv(args.env_file, override=False):
                raise ValueError("Environment file missing or empty")
        report = inventory(os.getenv("DATABASE_URL_SYNC") or os.getenv("DATABASE_URL"), symbols, periods)
        print(json.dumps(report, indent=2, sort_keys=True, allow_nan=False))
        return int(any(row["status"] == "consumer_fault" for cell in report["cells"] for row in cell["rows"]) or
                   any(row["status"] == "consumer_fault" for key in ("invalid_fiscal_year_rows", "unclassified_identity_rows") for row in report[key]))
    except Exception as exc:
        print(json.dumps({"status": "inventory_failed", "error_type": type(exc).__name__}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
