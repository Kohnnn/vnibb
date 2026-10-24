#!/usr/bin/env python3
"""Authenticated, GET/MCP-read-only acceptance. No provider calls or fixture writes.

Run with apps/api/.venv/bin/python scripts/oracle/mcp_acceptance.py --help.
Credentials are read only from environment; reports contain complete redacted payloads.
Matrix fixtures must already exist: this runner never creates or revokes them.
"""
from __future__ import annotations

import argparse
import ast
import asyncio
import hashlib
import importlib.util
import json
import logging
import math
import os
import re
import ssl
import sys
import warnings
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
from jsonschema import Draft202012Validator
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

ROOT = Path(__file__).resolve().parents[2] if __file__ != "<stdin>" else Path.cwd()
SOURCE = ROOT / "apps/api/vnibb/mcp/server.py"
if not SOURCE.is_file():
    package = importlib.util.find_spec("vnibb")
    if package and package.submodule_search_locations:
        SOURCE = Path(next(iter(package.submodule_search_locations))) / "mcp/server.py"
SYMBOLS = ("MSR", "VNM", "VCB")
STATEMENTS = {"income_statement": "income_statements", "balance_sheet": "balance_sheets", "cash_flow": "cash_flows"}
MARKET_DATASETS = {"market.pe", "market.pb", "market.evaluation", "analytics.valuation.pe", "analytics.valuation.pb"}
# Decoder coverage codes apply only to named metrics, never arbitrary reason maps.
WITHHOLDING_REASONS = {"value_unavailable", "descriptor_unavailable", "unit_unverified",
                       "ambiguous_descriptor", "quarter_basis_unverified", "incompatible_quarter_basis"}
GATES = {
    "1": "Finite complete OHLC, timestamp/window/order, session freshness, coherent units",
    "2": "Typed financial envelopes, exact statement/period, finite values, source/unit/scale/basis",
    "3": "Mongo connectivity shape and exact dataset/symbol object rows",
    "4": "Bounded complete discovery, exact identifiers/schema/resource/prompt content",
    "5": "Mandatory scope/auth coverage and exact deployment revision",
    "6": "All console/report/exception/endpoint strings redacted",
    "7": "Verified-user Matrix exact selection/evidence and independent denials",
    "8": "More than 20 actual returned rows, complete nested fields and actual arguments",
}


class Failure(ValueError):
    pass


class Partial(Failure):
    pass


def error_details(exc):
    pending, seen, messages = [exc], set(), []
    while pending and len(seen) < 32:
        current = pending.pop()
        if id(current) in seen:
            continue
        seen.add(id(current))
        children = getattr(current, "exceptions", ())
        if children:
            pending.extend(reversed(children))
            continue
        messages.append(redact(f"{type(current).__name__}: {current}"))
        cause = current.__cause__ or current.__context__
        if cause is not None:
            pending.append(cause)
    if pending:
        messages.append("Exception detail traversal capped at 32 nodes")
    return messages


def mandatory_gate(checks, required):
    observed = {check["name"]: check["status"] for check in checks}
    states = {observed[name] for name in required if name in observed}
    for status in ("FAIL", "BLOCKED", "PARTIAL", "UNSUPPORTED"):
        if status in states:
            return status
    return "PASS" if required <= observed.keys() and states == {"PASS"} else "UNTESTED"


def require(condition, message):
    if not condition:
        raise Failure(message)


def redact(value):
    if isinstance(value, dict):
        return {str(redact(k)): "<REDACTED>" if re.search(r"(?i)(?:token|secret|password|api[_-]?key|authorization|jwt|bearer)", str(k)) else redact(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [redact(v) for v in value]
    if not isinstance(value, str):
        return value if not isinstance(value, float) or math.isfinite(value) else str(value)
    for key, secret in os.environ.items():
        if secret and any(part in key.upper() for part in ("TOKEN", "SECRET", "PASSWORD", "API_KEY", "BEARER", "JWT")):
            value = value.replace(secret, "<REDACTED>")
    value = re.sub(r"\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+", "<REDACTED_AUTH>", value, flags=re.IGNORECASE)
    value = re.sub(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", "<REDACTED_JWT>", value)
    # Remove complete endpoints, including scheme-less userinfo, query and fragment secrets.
    value = re.sub(r"\b(?:https?|wss?|mongodb(?:\+srv)?|postgres(?:ql)?|redis|ftp)://[^\s'\"<>]+", "<REDACTED_URL>", value, flags=re.IGNORECASE)
    value = re.sub(r"[^\s/:@]+:[^\s/@]+@[^\s'\"<>]+", "<REDACTED_ENDPOINT>", value)
    value = re.sub(r"(?i)([?&#](?:token|key|api_key|password|secret|authorization|access_token)=)[^\s&#]+", r"\1<REDACTED>", value)
    value = re.sub(r"(?i)((?:token|secret|password|api[_-]?key|authorization)\s*[:=]\s*)[^\s,;]+", r"\1<REDACTED>", value)
    return value


def strict_json(value):
    json.dumps(value, allow_nan=False)
    reject_truncation(value)


def reject_truncation(value):
    if isinstance(value, dict):
        for child in value.values():
            reject_truncation(child)
    elif isinstance(value, list):
        for child in value:
            reject_truncation(child)
    elif isinstance(value, str):
        require(value not in {"[truncated]", "[TRUNCATED]", "<truncated>"}, "explicit full-data truncation marker")


class RedactingArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        self.print_usage(sys.stderr)
        self.exit(2, f"{self.prog}: error: {redact(message)}\n")


def finite_tree(value):
    if isinstance(value, dict):
        for child in value.values():
            finite_tree(child)
    elif isinstance(value, list):
        for child in value:
            finite_tree(child)
    elif isinstance(value, float):
        require(math.isfinite(value), "nonfinite nested number")


def finite_metric(value):
    if type(value) in (int, float):
        return math.isfinite(value)
    if isinstance(value, str) and re.fullmatch(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?", value):
        try:
            return Decimal(value).is_finite()
        except InvalidOperation:
            return False
    return False


def trading_receipts(rows, session):
    receipts = [row.get("coverage") for row in rows if isinstance(row.get("coverage"), dict)]
    if not receipts:
        raise Partial("completed-session acquisition receipt unavailable; data rows alone are not coverage")
    for receipt in receipts:
        if receipt.get("session_date") != session.isoformat() or receipt.get("scope") != "full_session" or receipt.get("completed_session") is not True:
            raise Partial("sampled/stale trading receipt is not completed-session coverage")
        require(type(receipt.get("observed_trade_count")) is int and receipt["observed_trade_count"] > 0, "missing observed trade count")
        require(receipt.get("denominator_trade_count") == receipt["observed_trade_count"] and receipt.get("session_fraction") == 1.0, "wrong completed-session denominator")
        require(receipt.get("provider_exhausted") is True, "provider tail cannot prove complete-session coverage")
        timestamp(receipt.get("observed_window_start"))
        timestamp(receipt.get("observed_window_end"))


def objects(payload, *, symbol=None, dataset=None):
    require(isinstance(payload, dict), "missing object envelope")
    strict_json(payload)
    rows = payload.get("items")
    require(isinstance(rows, list), "items must be an array")
    require(type(payload.get("row_count")) is int and payload["row_count"] == len(rows), "declared/actual row count differs")
    require(all(isinstance(row, dict) for row in rows), "rows must be objects")
    if symbol is not None:
        require(payload.get("symbol") == symbol, "wrong envelope symbol")
        require(all(row.get("symbol") == symbol for row in rows), "wrong row symbol")
    if dataset is not None:
        require(payload.get("dataset") == dataset, "wrong envelope dataset")
        require(all(row.get("dataset") == dataset for row in rows), "wrong row dataset")
    if not rows:
        raise Partial("EMPTY: backend read succeeded but no content evidence")
    return rows


def require_content(container, key, label, kind):
    """A typed, non-empty container; a successful read with no rows is withheld
    coverage, matching `objects`' EMPTY contract, not a failure."""
    require(isinstance(container.get(key), kind), f"{label} is not typed")
    if not container[key]:
        raise Partial(f"EMPTY: backend read succeeded but no {label} evidence")
    return container[key]


def timestamp(value):
    require(isinstance(value, str) and bool(value.strip()), "missing timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise Failure("invalid ISO timestamp") from None
    # Dates are an explicit EOD session identity; time-bearing records require a zone.
    require(len(value) == 10 or parsed.tzinfo is not None, "timestamp lacks timezone")
    return parsed


def completed_session(now, holidays):
    local = now.astimezone(ZoneInfo("Asia/Ho_Chi_Minh"))
    session = local.date()
    if local.hour < 16:
        session -= timedelta(days=1)
    while session.weekday() > 4 or session.isoformat() in holidays:
        session -= timedelta(days=1)
    return session


def prices(payload, args, *, session=None):
    rows = objects(payload, symbol=args["symbol"])
    require(payload.get("price_unit") == "VND" and payload.get("unknown_price_unit_count") == 0, "unknown/contradictory aggregate price units")
    require(payload.get("prices_comparable") is True and payload.get("price_units") == ["VND"], "price series is not certified comparable")
    dates = []
    for row in rows:
        finite_tree(row)
        require(row.get("price_unit") == "VND" and row.get("unit_status") not in ("unknown", "unverified", "mixed"), "unknown/contradictory row price units")
        require(row.get("source"), "missing price provider evidence")
        values = [row.get(key) for key in ("open", "high", "low", "close")]
        require(all(type(v) in (int, float) and math.isfinite(v) and v > 0 for v in values), "missing/nonfinite/nonpositive OHLC")
        opening, high, low, closing = values
        require(low <= min(opening, closing) <= max(opening, closing) <= high, "inconsistent OHLC range")
        observed = timestamp(row.get("time") or row.get("date") or row.get("timestamp"))
        day = observed.date()
        require(args["start_date"] <= day.isoformat() <= args["end_date"], "price timestamp outside requested window")
        dates.append(observed.isoformat())
    expected = sorted(dates, reverse=args.get("descending", False))
    require(dates == expected and len(set(dates)) == len(dates), "unordered/duplicate price timestamps")
    if session is not None:
        require(max(value[:10] for value in dates) == session.isoformat(), "not fresh for explicit completed Vietnam session")
    return rows


def financial_metrics(dataset):
    models = {"finance.income_statement": "IncomeStatementData", "finance.balance_sheet": "BalanceSheetData", "finance.cash_flow": "CashFlowData", "finance.ratio": "FinancialRatioData"}
    require(dataset in models, "unsupported financial metric schema")
    filename = "financial_ratios" if dataset == "finance.ratio" else dataset.split(".")[1]
    path = SOURCE.parents[1] / "providers/vnstock" / f"{filename}.py"
    tree = ast.parse(path.read_text())
    model = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == models[dataset])
    return {node.target.id for node in model.body if isinstance(node, ast.AnnAssign) and any(isinstance(child, ast.Name) and child.id == "float" for child in ast.walk(node.annotation))}


def unit_basis(item, period):
    evidence = item.get("raw_data") or item
    require(isinstance(evidence, dict), "invalid source evidence")
    require(evidence.get("raw") and (evidence.get("descriptors") or evidence.get("descriptorEvidence")), "missing lossless financial source/descriptor evidence")
    require(evidence.get("comTypeCode"), "missing financial company evidence")
    structured = evidence.get("structured") or {}
    basis = evidence.get("fiscalBasis") or structured.get("fiscalBasis")
    # Hard fiscal-shape checks run before any coverage partial: a basis that is
    # absent, mistyped or off-period is lost data whether or not the row also
    # lacks the source date, so it must not read as withholding.
    require(isinstance(basis, dict) and type(basis.get("year")) is int and basis.get("periodType") == period, "missing/exact fiscal basis")
    if period == "quarter":
        require(basis.get("quarter") in (1, 2, 3, 4), "missing fiscal quarter")
    if not evidence.get("sourceDate"):
        raise Partial("IQ publication/source date unknown; receipt time is not source age")
    if period == "quarter" and basis.get("quarterBasis") in (None, "", "unknown"):
        raise Partial("IQ quarterly standalone/cumulative basis unknown")
    if basis.get("consolidation") in (None, "", "unknown"):
        raise Partial("IQ consolidated/separate basis unknown")
    fields = structured.get("fieldEvidence")
    if isinstance(fields, dict) and fields:
        for field, record in fields.items():
            require(isinstance(record, dict), "invalid metric evidence")
            units = record.get("unitEvidence") or {}
            if record.get("unit") in (None, "", "unknown") or not units.get("units") or not units.get("scales"):
                raise Partial(f"IQ financial unit/scale unknown for {field}; no magnitude inference")
        return
    units = evidence.get("units") or {"value": evidence.get("unit")}
    if not isinstance(units, dict) or not units or any(v in (None, "", "unknown") for v in units.values()):
        raise Partial("IQ financial units unknown; no magnitude inference")
    require(all(isinstance(value, (str, int, float)) and not isinstance(value, bool) for value in units.values()), "financial unit metadata must be scalar")
    scale = evidence.get("scale") or evidence.get("unitScale") or structured.get("scale")
    if type(scale) not in (int, float) or not math.isfinite(scale) or scale <= 0:
        raise Partial("IQ financial source scale unknown")


def explicit_financial_withholding(item, fields, dataset):
    evidence = item["raw_data"]
    structured = evidence["structured"]
    observation = item.get("raw_observation")
    lineage = evidence.get("_financial_lineage")
    canonical = lineage.get("canonical_data") if isinstance(lineage, dict) else None
    require(isinstance(observation, dict) and isinstance(canonical, dict), "missing retained withholding evidence")
    for key in ("id", "symbol", "source", "period", "period_type", "fiscal_year", "fiscal_quarter"):
        require(key in observation and observation[key] == item.get(key), "withholding observation identity conflict")
    for key in ("symbol", "source", "period", "fiscal_year", "fiscal_quarter"):
        require(key in canonical and canonical[key] == item.get(key), "withholding canonical identity conflict")
    statement = {"finance.income_statement": "income", "finance.balance_sheet": "balance", "finance.cash_flow": "cashflow"}
    require(dataset in statement and canonical.get("statement_type") == statement[dataset], "withholding statement identity conflict")
    require(evidence.get("symbol") == item["symbol"] and evidence.get("source") == item["source"]
            and evidence.get("dataset") == dataset and evidence.get("datasetVariant") == f"{dataset}.{item['period_type']}"
            and structured.get("source") == item["source"], "withholding source identity conflict")
    require(item.get("data_status") == "partial_unavailable", "missing explicit financial withholding status")
    reasons, metadata = item.get("unavailable_metrics"), item.get("unit_metadata")
    require(isinstance(reasons, dict) and isinstance(metadata, dict), "missing per-field withholding evidence")
    for key in ("currency", "value_unit"):
        require(key in canonical and key in item and canonical[key] == item[key], "withholding statement unit conflict")
    require(item["currency"] != "VND" or item["value_unit"] != "VND", "withholding reason contradicts statement units")
    for field in fields:
        record = metadata.get(field)
        require(field in item and item[field] is None
                and reasons.get(field) == "unverified_statement_currency_or_unit"
                and isinstance(record, dict) and record.get("unavailable_reason") == reasons[field], "unexplained financial metric omission")
        source_values = structured.get("values")
        require(isinstance(source_values, dict) and finite_metric(source_values.get(field)), "missing retained structured metric")
        require(finite_metric(observation.get(field)) and finite_metric(canonical.get(field))
                and Decimal(str(observation[field])) == Decimal(str(canonical[field])) == Decimal(str(source_values[field])), "withholding retained metric conflict")


def financial(payload, args, *, raw=False):
    require(isinstance(payload, dict), "financial envelope missing")
    strict_json(payload)
    period = args["period_type"]
    require(payload.get("period_type") == period, "wrong financial period envelope")
    if raw:
        rows = objects(payload, symbol=args["symbol"], dataset=args["dataset"])
        for item in rows:
            require(item.get("datasetVariant") == f"{args['dataset']}.{period}", "wrong raw fiscal variant")
    else:
        require(type(payload.get("found")) is bool and isinstance(payload.get("item"), dict), "found/item must be typed")
        require(payload.get("symbol") == args["symbol"], "wrong financial envelope symbol")
        if "statement" in args:
            require(payload.get("statement") == args["statement"] and payload.get("collection") == STATEMENTS[args["statement"]], "wrong statement identity")
        else:
            require(payload.get("collection") == "financial_ratios", "missing ratio envelope")
        if not payload["found"]:
            require(not payload["item"], "found false with populated item")
            raise Partial("EMPTY: no admitted SQL financial row")
        rows = [payload["item"]]
    deferred: list[str] = []
    admitted_rows: list[dict] = []
    for item in rows:
        finite_tree(item)
        require(item.get("symbol") == args["symbol"] and item.get("source") == "vietcap", "wrong financial symbol/IQ provider")
        if not raw:
            require(item.get("period_type") == period and type(item.get("fiscal_year")) is int, "wrong SQL fiscal identity")
            if period == "quarter":
                require(item.get("fiscal_quarter") in (1, 2, 3, 4), "missing SQL fiscal quarter")
        dataset = args["dataset"] if raw else f"finance.{args.get('statement', 'ratio')}"
        evidence = item.get("raw_data") or item
        require(isinstance(evidence, dict), "invalid financial source evidence")
        structured = evidence.get("structured") or {}
        require(isinstance(structured, dict), "invalid structured financial evidence")
        basis = structured.get("fiscalBasis") or evidence.get("fiscalBasis")
        require(isinstance(basis, dict) and type(basis.get("year")) is int
                and basis.get("periodType") == period and basis.get("reason") in (None, ""), "wrong financial source fiscal identity")
        if period == "quarter":
            require(basis.get("quarter") in (1, 2, 3, 4), "missing source fiscal quarter")
        if not raw:
            require(basis.get("year") == item["fiscal_year"], "SQL/source fiscal year conflict")
            if period == "quarter":
                require(basis.get("quarter") == item["fiscal_quarter"], "SQL/source fiscal quarter conflict")
        values = structured.get("values") if raw else item
        require(isinstance(values, dict), "missing financial metric values")
        fields = financial_metrics(dataset)
        if not raw:
            source_values = structured.get("values", {})
            require(isinstance(source_values, dict), "invalid retained financial metric values")
            observation = item.get("raw_observation") or {}
            lineage = evidence.get("_financial_lineage") or {}
            require(isinstance(observation, dict) and isinstance(lineage, dict), "invalid retained financial evidence")
            canonical = lineage.get("canonical_data") or {}
            require(isinstance(canonical, dict), "invalid canonical financial evidence")
            missing = {field for field in fields if not finite_metric(values.get(field))
                       and any(finite_metric(record.get(field)) for record in (source_values, observation, canonical))}
            if missing:
                explicit_financial_withholding(item, missing, dataset)
                deferred.append("explicit financial read withholding; retained metrics have unverified statement currency/unit")
                if not any(finite_metric(values.get(field)) for field in fields):
                    admitted_rows.append(item)
                    continue
        if any(finite_metric(values.get(field)) for field in fields):
            admitted_rows.append(item)
            continue
        require(raw, "no finite SQL financial metrics or proven read withholding")
        reasons = structured.get("unavailable") or {}
        require(isinstance(reasons, dict), "invalid financial withholding reasons")
        if reasons and all(field in fields and reason in WITHHOLDING_REASONS for field, reason in reasons.items()):
            # Record the verdict but keep looping: a hard violation in any later row
            # must still fail the check rather than hide behind this withholding.
            deferred.append("no admitted finite financial metrics; source units/basis unverified")
            continue
        raise Failure("no finite financial metrics")
    for item in admitted_rows:
        try:
            unit_basis(item, period)
        except Partial as exc:
            deferred.append(str(exc))
    if deferred:
        raise Partial("; ".join(dict.fromkeys(deferred))[:400])
    return rows


def mongo_status(payload):
    require(isinstance(payload, dict), "Mongo status must be object")
    require(type(payload.get("enabled")) is bool and payload.get("read_only") is True, "invalid Mongo enabled/read_only shape")
    connection = payload.get("connectivity")
    require(isinstance(connection, dict) and connection.get("status") in {"connected", "error", "not_configured"}, "invalid Mongo connectivity shape")
    if not payload["enabled"] or connection["status"] != "connected":
        raise Partial("BLOCKED: Mongo database unavailable, not corpus absence")
    require(isinstance(payload.get("collections"), list) and all(isinstance(v, dict) and v.get("name") for v in payload["collections"]), "invalid Mongo collection inspection")


def source_catalog():
    """Read source declarations without importing server/database application state."""
    tree = ast.parse(SOURCE.read_text())
    tools, resources, templates, prompts = {}, set(), set(), {}
    collections, datasets = {}, {}
    collection_fields = next([statement.target.id for statement in node.body if isinstance(statement, ast.AnnAssign)] for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "CollectionSpec")
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for decorator in node.decorator_list:
                if not isinstance(decorator, ast.Call) or not isinstance(decorator.func, ast.Attribute):
                    continue
                kind = decorator.func.attr
                params = [a.arg for a in node.args.args if a.arg != "ctx"]
                defaults = len(node.args.defaults)
                required = [a.arg for a in node.args.args[:len(node.args.args) - defaults] if a.arg != "ctx"]
                if kind == "tool":
                    bounds = {}
                    for argument in node.args.args:
                        annotation = argument.annotation
                        if not isinstance(annotation, ast.Subscript) or not isinstance(annotation.slice, ast.Tuple):
                            continue
                        for metadata in annotation.slice.elts[1:]:
                            if isinstance(metadata, ast.Call):
                                values = {}
                                for keyword in metadata.keywords:
                                    if keyword.arg in {"ge", "le", "min_length", "max_length"}:
                                        values[{"ge": "minimum", "le": "maximum", "min_length": "minItems", "max_length": "maxItems"}[keyword.arg]] = ast.literal_eval(keyword.value)
                                    elif keyword.arg == "json_schema_extra":
                                        values.update(ast.literal_eval(keyword.value))
                                bounds[argument.arg] = values
                    tools[node.name] = {"parameters": params, "required": required, "bounds": bounds}
                elif kind == "prompt":
                    prompts[node.name] = {"parameters": params, "required": required}
                elif kind == "resource":
                    uri = ast.literal_eval(decorator.args[0])
                    (templates if "{" in uri else resources).add(uri)
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            if node.target.id == "COLLECTION_SPECS":
                for key, call in zip(node.value.keys, node.value.values):
                    values = dict(zip(collection_fields, (ast.literal_eval(value) for value in call.args)))
                    values.update({kw.arg: ast.literal_eval(kw.value) for kw in call.keywords})
                    require(set(values) == set(collection_fields), "incomplete source collection declaration")
                    collections[ast.literal_eval(key)] = values
            if node.target.id == "PREMIUM_DATASET_SPECS":
                for call in node.value.generators[0].iter.elts:
                    name, description, maximum = [ast.literal_eval(v) for v in call.args]
                    scope = "market" if name in MARKET_DATASETS else "symbol"
                    scope = next((ast.literal_eval(kw.value) for kw in call.keywords if kw.arg == "scope_type"), scope)
                    datasets[name] = {"dataset": name, "description": description, "max_limit": maximum, "scope_type": scope}
    require(tools and collections and datasets, "source catalog unavailable")
    require(all(spec["scope_type"] == ("market" if name.startswith("macro.") or name in MARKET_DATASETS else "symbol") for name, spec in datasets.items()), "source dataset scope contract inconsistent")
    imports = {alias.asname or alias.name: node.module for node in tree.body if isinstance(node, ast.ImportFrom) and node.module and node.module.startswith("vnibb.models.") for alias in node.names}
    mapping = next(node.value for node in tree.body if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) and node.target.id == "COLLECTION_MODELS")
    for key, value in zip(mapping.keys, mapping.values):
        name = ast.literal_eval(key)
        model_path = SOURCE.parents[2] / (imports[value.id].replace(".", "/") + ".py")
        model_tree = ast.parse(model_path.read_text())
        model = next(node for node in model_tree.body if isinstance(node, ast.ClassDef) and node.name == value.id)
        fields = []
        for node in model.body:
            expression = node.value if isinstance(node, (ast.AnnAssign, ast.Assign)) else None
            if isinstance(expression, ast.Call) and isinstance(expression.func, ast.Name) and expression.func.id in {"mapped_column", "Column"}:
                target = node.target if isinstance(node, ast.AnnAssign) else node.targets[0]
                require(isinstance(target, ast.Name), "unsupported model column declaration")
                fields.append(target.id)
        require(fields, "independent model column inventory unavailable")
        collections[name]["fields"] = fields
    return {"tools": tools, "resources": resources, "templates": templates, "prompts": prompts, "collections": collections, "datasets": datasets}


async def discover(method, attribute, *, budget=32):
    items, seen = [], set()
    cursor = None
    for _ in range(budget):
        page = await method(cursor=cursor)
        items.extend(getattr(page, attribute))
        cursor = page.nextCursor
        if cursor is None:
            return items
        require(cursor not in seen, "discovery pagination cursor cycle")
        seen.add(cursor)
    raise Failure("discovery pagination budget exhausted")


def exact_catalog(items, expected, key):
    ids = [str(getattr(item, key)) for item in items]
    require(len(ids) == len(set(ids)), "duplicate discovery identifiers")
    require(set(ids) == set(expected), "exact discovery identifier mismatch")


def tool_schema(tool, contract):
    schema = tool.inputSchema
    Draft202012Validator.check_schema(schema)
    require(schema.get("type") == "object", "tool input schema must be object")
    properties = schema.get("properties")
    require(isinstance(properties, dict) and set(properties) == set(contract["parameters"]), "tool schema properties mismatch")
    require(set(schema.get("required", [])) == set(contract["required"]), "tool schema required mismatch")
    for name, prop in properties.items():
        alternatives = prop.get("anyOf", [prop])
        actual_types = {v.get("type") for v in alternatives}
        expected = "array" if name == "result_ids" else "boolean" if name == "descending" else "integer" if name in {"limit", "lookback_days"} else "string"
        require(expected in actual_types, f"wrong schema type for {name}")
        for key, value in contract.get("bounds", {}).get(name, {}).items():
            target = next((v for v in alternatives if v.get("type") == expected), prop)
            require(target.get(key, prop.get(key)) == value, f"schema bound differs from source for {name}/{key}")
        if expected == "integer":
            numeric = next(v for v in alternatives if v.get("type") == "integer")
            require(type(numeric.get("minimum")) in (int, float) and numeric["minimum"] >= (0 if name == "limit" else 1), f"missing nonnegative/positive minimum for {name}")
            if name == "limit":
                require(type(numeric.get("maximum")) in (int, float), f"missing bounded maximum for {name}")
        if expected == "array":
            require(prop.get("items", {}).get("type") == "string" and prop.get("minItems", 0) >= 1 and prop.get("maxItems", 0) > 0, "Matrix result IDs missing bounds/type")


def meaningful(text, label):
    require(isinstance(text, str) and len(text.strip()) >= 15 and len(set(text.split())) >= 3, f"empty/meaningless {label}")


def matrix_selection(payload, args):
    require(isinstance(payload, dict), "Matrix payload missing")
    snapshot, evidence = payload.get("snapshot"), payload.get("evidence")
    require(isinstance(snapshot, dict) and snapshot.get("snapshot_id") == args["snapshot_id"], "wrong Matrix snapshot")
    require(snapshot.get("revision") not in (None, ""), "Matrix snapshot revision missing")
    cells = snapshot.get("cells")
    require(isinstance(cells, list) and all(isinstance(v, dict) for v in cells), "invalid Matrix cells")
    require(len(cells) == len(args["result_ids"]) and {v.get("result_id") for v in cells} == set(args["result_ids"]), "wrong Matrix result IDs")
    require(isinstance(evidence, list) and evidence and all(isinstance(v, dict) and v.get("evidence_id") and v.get("source") and v.get("unit") and "value" in v for v in evidence), "Matrix evidence missing")
    ids = {v["evidence_id"] for v in evidence}
    require(len(ids) == len(evidence), "duplicate Matrix evidence")
    for cell in cells:
        require(cell.get("result_revision") not in (None, "") and isinstance(cell.get("payload"), dict) and cell["payload"], "Matrix result revision/payload missing")
        require(isinstance(cell.get("evidence_ids"), list) and cell["evidence_ids"] and set(cell["evidence_ids"]) <= ids, "unresolved Matrix evidence references")
    require(ids == {identifier for cell in cells for identifier in cell["evidence_ids"]}, "Matrix returned unrelated evidence")
    finite_tree(payload)


def expected_denial(result, expected):
    require(result.isError is True and result.structuredContent is None, "denial returned data or succeeded")
    text = " ".join(item.text for item in result.content if getattr(item, "type", None) == "text")
    require(expected in text, "unrelated backend error is not expected authorization denial")


def snapshot_content(payload, symbol):
    require(type(payload.get("found")) is bool and payload.get("symbol") == symbol and isinstance(payload.get("snapshot"), dict), "invalid snapshot envelope")
    if payload["found"] is False or not payload["snapshot"]:
        raise Partial("EMPTY: snapshot content unavailable")
    finite_tree(payload)
    price = payload["snapshot"].get("price_context") or {}
    windows = price.get("return_windows") or payload["snapshot"].get("return_windows") or {}
    if any(isinstance(value, dict) and value.get("status") not in ("available", "complete") for value in windows.values()):
        raise Partial("partial snapshot price horizon; unavailable summaries are not passing content")


class Runner:
    def __init__(self, options):
        self.options = options
        self.catalog = source_catalog()
        self.schemas = {}
        self.report = {"status": "BLOCKED", "gates": GATES, "expected_revision": options.expected_revision, "session_policy": {"timezone": "Asia/Ho_Chi_Minh", "close_cutoff": "16:00", "holidays": sorted(options.holiday)}, "inventory": {k: sorted(v) for k, v in self.catalog.items()}, "checks": [], "calls": []}
        self.report["catalog_source_sha256"] = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
        self.report["declared_call_plan"] = "derived from current source identifiers and bounded MSR/VNM/VCB windows; calls[] is actual execution ledger, not external236 manifest"
        if not options.matrix_fixtures or not os.environ.get("VNIBB_MATRIX_OWNER_JWT") or not os.environ.get("VNIBB_MATRIX_OTHER_JWT"):
            self.record("matrix_mandatory", "BLOCKED", "verified owner/other JWTs and existing exact fixtures unavailable")

    def record(self, name, status, detail):
        self.report["checks"].append({"name": name, "status": status, "detail": redact(detail)})

    async def checked(self, name, operation, validator=None):
        try:
            payload = await operation()
            if validator:
                validator(payload)
            self.record(name, "PASS", "executed and validated")
            return payload
        except Partial as exc:
            self.record(name, "PARTIAL", str(exc))
        except Exception as exc:  # noqa: BLE001 - SDK/transport trust boundary; record every redacted failure and continue independent reads.
            self.record(name, "FAIL", error_details(exc))
        return None

    async def call(self, session, name, args=None):
        args = args or {}
        entry = {"method": "tools/call", "name": name, "arguments": redact(args), "executed": False}
        self.report["calls"].append(entry)
        if name in self.schemas:
            Draft202012Validator(self.schemas[name]).validate(args)
        entry["transport_attempted"] = True
        async def isolated():
            async with self.connection(os.environ["VNIBB_MCP_SHARED_BEARER_TOKEN"]) as (reader, _):
                entry["executed"] = True
                return await reader.call_tool(name, arguments=args)
        try:
            result = await asyncio.wait_for(asyncio.create_task(isolated()), timeout=self.options.timeout)
        except Exception as exc:
            entry["errors"] = error_details(exc)
            raise
        entry["response"] = redact(result.model_dump(mode="json"))
        require(not result.isError, f"{name}: {result.content}")
        payload = result.structuredContent
        if payload is None:
            texts = [item.text for item in result.content if getattr(item, "type", None) == "text"]
            payload = json.loads("\n".join(texts), parse_constant=lambda value: (_ for _ in ()).throw(Failure(f"nonfinite JSON {value}")))
        require(isinstance(payload, dict), "tool response must be object")
        strict_json(payload)
        entry["payload"] = redact(payload)
        return payload
    async def pages(self, method, attribute):
        async def recorded(cursor=None):
            entry = {"method": method.__name__, "arguments": {"cursor": cursor}, "executed": True}
            self.report["calls"].append(entry)
            result = await method(cursor=cursor)
            entry["response"] = redact(result.model_dump(mode="json"))
            return result
        return await discover(recorded, attribute)

    async def discovery(self, session):
        tools = await self.pages(session.list_tools, "tools")
        exact_catalog(tools, self.catalog["tools"], "name")
        self.report["discovered_tools"] = redact([tool.model_dump(mode="json") for tool in tools])
        for tool in tools:
            tool_schema(tool, self.catalog["tools"][tool.name])
            meaningful(tool.description, "tool description")
            self.schemas[tool.name] = tool.inputSchema
        for method, attribute, expected, key in (
            (session.list_resources, "resources", self.catalog["resources"], "uri"),
            (session.list_resource_templates, "resourceTemplates", self.catalog["templates"], "uriTemplate"),
            (session.list_prompts, "prompts", self.catalog["prompts"], "name"),
        ):
            items = await self.pages(method, attribute)
            exact_catalog(items, expected, key)
            for item in items:
                meaningful(item.description, attribute + " description")
                if attribute == "prompts":
                    contract = self.catalog["prompts"][item.name]
                    arguments = item.arguments or []
                    require({v.name for v in arguments} == set(contract["parameters"]) and {v.name for v in arguments if v.required} == set(contract["required"]), "prompt arguments mismatch")
        for uri in sorted(self.catalog["resources"]):
            result = await session.read_resource(uri)
            self.report["calls"].append({"method": "resources/read", "arguments": {"uri": uri}, "executed": True, "response": redact(result.model_dump(mode="json"))})
            text = "\n".join(getattr(v, "text", "") for v in result.contents)
            meaningful(text, uri)
            if uri == "vnibb://database/collections":
                metadata = json.loads(text)
                require(isinstance(metadata, dict) and set(metadata) == set(self.catalog["collections"]), "collection resource metadata mismatch")
                for name, spec in self.catalog["collections"].items():
                    require(all(metadata[name].get(k) == json.loads(json.dumps(v)) for k, v in spec.items()) and metadata[name].get("guardrails", {}).get("read_only") is True, "collection resource fields mismatch")
            if uri == "vnibb://mongo/datasets":
                records = json.loads(text)
                require(isinstance(records, list) and len(records) == len(self.catalog["datasets"]) and {v.get("dataset") for v in records} == set(self.catalog["datasets"]), "dataset resource catalog mismatch")
        for collection in self.catalog["collections"]:
            uri = f"vnibb://database/schema/{collection}"
            result = await session.read_resource(uri)
            self.report["calls"].append({"method": "resources/read", "arguments": {"uri": uri}, "executed": True, "response": redact(result.model_dump(mode="json"))})
            payload = json.loads("\n".join(getattr(v, "text", "") for v in result.contents))
            require(payload.get(collection, {}).get("read_only") is True, "schema resource missing read-only metadata")
            for key, value in self.catalog["collections"][collection].items():
                require(payload[collection].get(key) == json.loads(json.dumps(value)), "schema resource differs from source contract")
            fields = payload[collection].get("fields")
            require(isinstance(fields, list) and fields and all(isinstance(v, str) for v in fields) and len(set(fields)) == len(fields), "schema resource missing complete SQL fields")
            require(fields == self.catalog["collections"][collection]["fields"], "remote field inventory differs from independent model source")
        values = {"symbol": "MSR", "collection": "stock_prices", "dataset": "company.info", "limit": "100", "lookback_days": "365"}
        for name, contract in self.catalog["prompts"].items():
            arguments = {key: values[key] for key in contract["required"]}
            result = await session.get_prompt(name, arguments)
            self.report["calls"].append({"method": "prompts/get", "name": name, "arguments": arguments, "executed": True, "response": redact(result.model_dump(mode="json"))})
            meaningful("\n".join(getattr(v.content, "text", "") for v in result.messages), name)

    async def business(self, session):
        await self.checked("postgres_status", lambda: self.call(session, "get_database_status"), lambda p: require(p.get("read_only") is True and isinstance(p.get("connectivity"), dict) and p["connectivity"].get("status") == "connected", "PostgreSQL unavailable"))
        await self.checked("mongo_status", lambda: self.call(session, "get_mongo_status"), mongo_status)
        await self.checked("connection_guide", lambda: self.call(session, "get_agent_connection_guide"), lambda p: meaningful(p.get("guide"), "connection guide"))
        await self.checked("collection_catalog", lambda: self.call(session, "list_supported_collections"), lambda p: require(set(p.get("collections", {})) == set(self.catalog["collections"]), "SQL catalog mismatch"))
        await self.checked("dataset_catalog", lambda: self.call(session, "list_premium_datasets"), lambda p: require({v.get("dataset") for v in p.get("datasets", [])} == set(self.catalog["datasets"]), "premium catalog mismatch"))
        session_day = completed_session(datetime.now().astimezone(), self.options.holiday)
        windows = (("recent", session_day - timedelta(days=90), session_day), ("older", date.fromisoformat(self.options.older_start), date.fromisoformat(self.options.older_end)))
        symbols = [self.options.symbol] if self.options.smoke else SYMBOLS
        for symbol in symbols:
            for label, start, end in windows:
                for tool in ("get_symbol_prices", "get_eod_price_history"):
                    args = {"symbol": symbol, "start_date": start.isoformat(), "end_date": end.isoformat(), "limit": 100}
                    if tool == "get_symbol_prices":
                        args.update(interval="1D", descending=False)
                    await self.checked(f"{symbol}/{label}/{tool}", lambda t=tool, a=args: self.call(session, t, a), lambda p, a=args, fresh=session_day if label == "recent" else None: prices(p, a, session=fresh))
            for period in ("year", "quarter"):
                for statement in (*STATEMENTS, "ratio"):
                    tool = "get_latest_financial_ratios" if statement == "ratio" else "get_latest_financial_statement"
                    args = {"symbol": symbol, "period_type": period}
                    if statement != "ratio":
                        args["statement"] = statement
                    await self.checked(f"{symbol}/SQL/{period}/{statement}", lambda t=tool, a=args: self.call(session, t, a), lambda p, a=args: financial(p, a))
                    raw_args = {"symbol": symbol, "dataset": f"finance.{statement}", "period_type": period, "limit": 100}
                    await self.checked(f"{symbol}/raw/{period}/{statement}", lambda a=raw_args: self.call(session, "get_premium_dataset", a), lambda p, a=raw_args: financial(p, a, raw=True))
            for collection, spec in self.catalog["collections"].items():
                periods = ("year", "quarter") if collection in {*STATEMENTS.values(), "financial_ratios"} else (None,)
                for period in periods:
                    args = {"collection": collection, "limit": min(100, spec["max_limit"])}
                    if "symbol" in spec["allowed_filters"]:
                        args["symbol"] = symbol
                    if period:
                        args["period_type"] = period
                    await self.checked(f"{symbol}/SQL/{collection}/{period or 'all'}", lambda a=args: self.call(session, "query_database_collection", a), lambda p, a=args: self.sql_rows(p, a))
                    if collection in {"order_flow_daily", "foreign_trading"}:
                        await self.checked(f"{symbol}/SQL/{collection}/session_receipt", lambda a=args: self.call(session, "query_database_collection", a), lambda p: trading_receipts(objects(p), session_day))
            if "get_reference_dataset" in self.catalog["tools"]:
                for store in ("market_company_profiles", "market_financial_metric_map"):
                    args = {"symbol": symbol, "store": store, "limit": 100}
                    await self.checked(f"{symbol}/reference/{store}", lambda a=args: self.call(session, "get_reference_dataset", a), lambda p: objects(p))
            if "get_ingestion_receipts" in self.catalog["tools"]:
                for dataset in ("shareholders", "officers", "subsidiaries", "company_news", "insider_deals", "financials_year", "financials_quarter", "ratios_year", "ratios_quarter", "profiles", "foreign_trading", "intraday_trades", "eod_catchup", "iq_company_profile", "iq_shareholder_structure"):
                    args = {"symbol": symbol, "dataset": dataset, "limit": 20}
                    await self.checked(f"{symbol}/acquisition/{dataset}", lambda a=args: self.call(session, "get_ingestion_receipts", a), lambda p: objects(p))
            for dataset, spec in self.catalog["datasets"].items():
                if dataset.startswith("finance."):
                    continue
                scope = spec["scope_type"]
                args = {"dataset": dataset, "limit": min(100, spec["max_limit"])}
                if scope == "symbol":
                    args["symbol"] = symbol
                if dataset.startswith("analytics.valuation."):
                    args["index_code"] = "VNINDEX"
                if scope == "market" and symbol != symbols[0]:
                    continue
                await self.checked(f"{scope}/{symbol if scope == 'symbol' else 'market'}/{dataset}", lambda a=args: self.call(session, "get_premium_dataset", a), lambda p, a=args, s=scope: self.premium(p, a, s))
                if dataset in {"equity.intraday", "equity.trades", "equity.foreign_flow", "equity.session_stats"}:
                    await self.checked(f"{symbol}/Mongo/{dataset}/session_receipt", lambda a=args: self.call(session, "get_premium_dataset", a), lambda p: trading_receipts(objects(p), session_day))
            for tool in ("get_company_news", "get_intraday_trades", "get_price_depth"):
                args = {"symbol": symbol, "limit": 25 if tool == "get_company_news" else 1000}
                await self.checked(f"{symbol}/{tool}", lambda t=tool, a=args: self.call(session, t, a), lambda p, a=args: objects(p, symbol=a["symbol"]))
                if tool == "get_intraday_trades":
                    await self.checked(f"{symbol}/Mongo/ticks/session_receipt", lambda a=args: self.call(session, "get_intraday_trades", a), lambda p: trading_receipts(objects(p), session_day))
            await self.checked(f"{symbol}/timeline", lambda s=symbol: self.call(session, "get_corporate_timeline", {"symbol": s, "limit": 25}), lambda p: require_content(p, "items", "timeline", list))
            await self.checked(f"{symbol}/snapshot", lambda s=symbol: self.call(session, "get_symbol_snapshot", {"symbol": s}), lambda p, s=symbol: snapshot_content(p, s))
        await self.checked("market_snapshot", lambda: self.call(session, "get_market_snapshot"), lambda p: require_content(p, "snapshot", "market snapshot", dict))
        for label in ("TTM statements/ratios/raw variants", "provider historical repair beyond retained windows"):
            self.record(label, "UNSUPPORTED", "deliberately outside retained read-only protocol; no unexecuted check passed")
        large = [c for c in self.report["calls"] if c.get("executed") and isinstance(c.get("payload", {}).get("items"), list) and len(c["payload"]["items"]) > 20]
        self.record("full_payload_over_20_rows", "PASS" if large else "PARTIAL", {"actual_large_responses": len(large), "payloads": "saved complete; no row/depth truncation"})
        valid_large = [call for call in large if self.has_deep_payload(call["payload"]["items"])]
        self.record("full_nested_large_payload", "PASS" if valid_large else "PARTIAL", {"responses_over20_with_nested_content": len(valid_large), "complete_payloads_preserved": True})

    @staticmethod
    def has_deep_payload(rows):
        def nested(value):
            return isinstance(value, (dict, list)) and any(isinstance(child, (dict, list)) and child for child in (value.values() if isinstance(value, dict) else value))
        return any(nested(row.get("raw_data")) or nested(row.get("raw")) or nested(row.get("lineage")) for row in rows)

    def sql_rows(self, payload, args):
        require(payload.get("collection") == args["collection"], "wrong SQL collection")
        rows = objects(payload)
        if "symbol" in args:
            require(all(row.get("symbol") == args["symbol"] for row in rows), "wrong SQL row symbol")
        deferred = []
        for row in rows:
            finite_tree(row)
            fields = self.catalog["collections"][args["collection"]].get("fields")
            require(fields and set(fields) <= set(row), "SQL row omits schema-advertised fields")
            if args.get("period_type"):
                statement = next((name for name, collection in STATEMENTS.items() if collection == args["collection"]), None)
                request = {"symbol": args["symbol"], "period_type": args["period_type"]}
                if statement:
                    request["statement"] = statement
                envelope = {"symbol": args["symbol"], "period_type": args["period_type"], "collection": args["collection"], "found": True, "item": row}
                if statement:
                    envelope["statement"] = statement
                try:
                    financial(envelope, request)
                except Partial as exc:
                    deferred.append(str(exc))
        if deferred:
            raise Partial("; ".join(dict.fromkeys(deferred))[:400])

    def premium(self, payload, args, scope):
        require(payload.get("scope_type") == scope and payload.get("provider_execution") is False, "wrong scope/provider execution metadata")
        rows = objects(payload, symbol=args["symbol"] if scope == "symbol" else None, dataset=args["dataset"])
        if scope == "market":
            require(payload.get("scope_key") == "market" and all(row.get("scopeKey", row.get("scope_key")) == "market" and row.get("scopeType", row.get("scope_type")) == "market" for row in rows), "market corpus scope inconclusive")
        for row in rows:
            finite_tree(row)
            require(row.get("recordKey") and isinstance(row.get("raw"), (dict, list)) and row["raw"], "missing nested premium source evidence")

    async def matrix(self):
        fixture_path = self.options.matrix_fixtures
        if not fixture_path:
            self.record("matrix_mandatory", "BLOCKED", "verified owner/other user JWTs and existing positive/revoked/export-denied fixtures required")
            return
        fixtures = json.loads(Path(fixture_path).read_text())
        owner = os.environ.get("VNIBB_MATRIX_OWNER_JWT")
        other = os.environ.get("VNIBB_MATRIX_OTHER_JWT")
        if not owner or not other or owner == other or owner == os.environ.get("VNIBB_MCP_SHARED_BEARER_TOKEN"):
            self.record("matrix_mandatory", "BLOCKED", "distinct verified user JWT sessions required; shared bearer is not identity")
            return
        if not self.options.identity_url:
            self.record("matrix_mandatory", "BLOCKED", "issuing Auth online active-session identity endpoint required")
            return
        for token, role in ((owner, "owner"), (other, "other")):
            async with self.connection(token) as (session, client):
                auth_headers = {}
                if auth_key := os.environ.get("VNIBB_MATRIX_AUTH_API_KEY"):
                    auth_headers["apikey"] = auth_key
                identity = await client.get(self.options.identity_url, headers=auth_headers)
                self.report["calls"].append({"method": "GET issuing Auth user", "arguments": {"endpoint": redact(self.options.identity_url), "session_role": role}, "executed": True, "status_code": identity.status_code, "response": redact(identity.text)})
                if identity.status_code in (401, 403):
                    self.record(f"matrix/{role}/verified_identity", "BLOCKED", "valid server-verified active user JWT required")
                    continue
                identity.raise_for_status()
                user = identity.json()
                require(isinstance(user, dict) and user.get("id"), "server-verified user identity required")
                self.record(f"matrix/{role}/verified_identity", "PASS", {"id": user["id"]})
                expected_user = fixtures.get(f"{role}_id")
                require(expected_user == user["id"], "verified JWT user differs from fixture owner/other identity")
                for kind, expected in (("positive", None), ("revoked", "Matrix selection not found"), ("invalid", "Invalid Matrix selection"), ("export_denied", "Matrix source export is not permitted")):
                    args = fixtures.get(kind)
                    if not isinstance(args, dict):
                        self.record(f"matrix/{role}/{kind}", "BLOCKED", "existing exact fixture arguments unavailable")
                        continue
                    denied = "Matrix selection not found" if role == "other" and kind != "invalid" else expected
                    async def operation(a=args, expected=denied, role=role):
                        result = await session.call_tool("get_matrix_selection", a)
                        self.report["calls"].append({"method": "tools/call", "name": "get_matrix_selection", "arguments": redact(a), "session_role": role, "executed": True, "response": redact(result.model_dump(mode="json"))})
                        if expected:
                            expected_denial(result, expected)
                        else:
                            require(not result.isError, "owner selection failed")
                            matrix_selection(result.structuredContent, a)
                            require(isinstance(fixtures.get("expected_positive"), dict), "exact positive packet fixture missing")
                            require(result.structuredContent == fixtures["expected_positive"], "Matrix packet differs from pinned exact evidence/revisions/metrics")
                        return {}
                    # Positive fixture may pin exact revisions/metrics/evidence, not merely nonempty data.
                    if kind == "positive" and role == "owner" and not isinstance(fixtures.get("expected_positive"), dict):
                        self.record("matrix/owner/exact_fixture_evidence", "BLOCKED", "expected_positive packet required for revision/metrics/evidence comparison")
                        continue
                    await self.checked(f"matrix/{role}/{kind}", operation)

    @asynccontextmanager
    async def connection(self, token):
        async with (
            httpx.AsyncClient(headers={"Authorization": f"Bearer {token}"}, timeout=self.options.timeout, verify=ssl.create_default_context()) as client,
            streamable_http_client(self.options.mcp_url, http_client=client) as (read, write, _),
            ClientSession(read, write) as session,
        ):
            await session.initialize()
            yield session, client

    async def run(self):
        token = os.environ.get("VNIBB_MCP_SHARED_BEARER_TOKEN")
        if not token:
            self.record("authenticated_transport", "BLOCKED", "VNIBB_MCP_SHARED_BEARER_TOKEN private environment required")
            return
        async with httpx.AsyncClient(timeout=self.options.timeout, verify=ssl.create_default_context()) as client:
            health = await client.get(self.options.health_url)
            health.raise_for_status()
            body = health.json()
            self.report["health"] = redact(body)
            require(body.get("read_only") is True, "health does not declare read-only MCP")
            self.record("runtime_revision", "PASS" if body.get("revision") == self.options.expected_revision else "FAIL", {"actual": body.get("revision"), "expected": self.options.expected_revision})
            unauthorized = await client.post(self.options.mcp_url, json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "vnibb-acceptance", "version": "1"}}})
            require(unauthorized.status_code == 401, "unauthenticated MCP must return HTTP401")
            self.record("unauthenticated_denial", "PASS", "HTTP401; not proof of user-session revocation")
        async with self.connection(token) as (session, _):
            self.record("authenticated_transport", "PASS", "official SDK initialized with authenticated transport")
            await self.checked("complete_discovery", lambda: self.discovery(session))
            await self.business(session)
            async def shared_denial():
                args = {"snapshot_id": "00000000-0000-0000-0000-000000000099", "result_ids": ["unowned-result"]}
                result = await session.call_tool("get_matrix_selection", args)
                self.report["calls"].append({"method": "tools/call", "name": "get_matrix_selection", "arguments": args, "session_role": "shared_bearer", "executed": True, "response": redact(result.model_dump(mode="json"))})
                expected_denial(result, "Matrix requires a verified user JWT")
            await self.checked("shared_bearer_not_matrix_identity", shared_denial)
        try:
            await self.matrix()
        except Exception as exc:  # noqa: BLE001 - External issuing-Auth/SDK failures retain explicit Matrix prerequisite status.
            self.record("matrix_mandatory", "BLOCKED", error_details(exc))


def arguments():
    parser = RedactingArgumentParser(description=__doc__)
    parser.add_argument("--mcp-url", default=os.environ.get("MCP_URL", "http://127.0.0.1:8001/mcp"))
    parser.add_argument("--health-url", default=os.environ.get("HEALTH_URL", "http://127.0.0.1:8001/health"))
    parser.add_argument("--expected-revision", default=os.environ.get("EXPECTED_REVISION"), required=not bool(os.environ.get("EXPECTED_REVISION")))
    parser.add_argument("--timeout", type=float, default=30)
    parser.add_argument("--report", help="JSON path; console and file both contain only redacted values")
    parser.add_argument("--deadline", type=float, default=1800, help="Finite whole-run seconds, in addition to per-request timeout")
    parser.add_argument("--older-start", default="2020-01-01")
    parser.add_argument("--older-end", default="2020-12-31")
    parser.add_argument("--holiday", action="append", default=[], help="Vietnam exchange closure YYYY-MM-DD; repeat as needed")
    parser.add_argument("--matrix-fixtures", help="Existing read-only fixture JSON: owner_id,other_id,positive,expected_positive,revoked,invalid,export_denied; selections snapshot_id/result_ids; expected_positive exact packet")
    parser.add_argument("--identity-url", default=os.environ.get("VNIBB_IDENTITY_URL"), help="Issuing Auth /auth/v1/user online active-session endpoint, not application /user/me")
    parser.add_argument("--smoke", action="store_true", help="Legacy smoke wrapper: narrow symbol, still truthful mandatory gates")
    parser.add_argument("--symbol", default="FPT")
    parser.add_argument("--period-type", choices=("year", "quarter"), default="year", help="Legacy wrapper compatibility; full acceptance always exercises both")
    options = parser.parse_args()
    require(math.isfinite(options.timeout) and options.timeout > 0 and math.isfinite(options.deadline) and options.deadline > 0, "timeouts must be finite positive seconds")
    return options


def main():
    # Client/transport logs can contain raw response strings; the structured report is the only output channel.
    logging.disable(logging.CRITICAL)
    warnings.showwarning = lambda message, *args, **kwargs: print(redact(str(message)), file=sys.stderr)
    runner = None
    try:
        options = arguments()
        runner = Runner(options)
        async def bounded():
            async with asyncio.timeout(options.deadline):
                await runner.run()
        asyncio.run(bounded())
    except Exception as exc:  # noqa: BLE001 - CLI safety boundary must redact all failures instead of printing a credential-bearing traceback.
        if runner is None:
            print(json.dumps(redact({"status": "FAIL", "errors": error_details(exc)})))
            return 1
        runner.record("run_error", "FAIL", error_details(exc))
        if not any(c["name"] == "authenticated_transport" for c in runner.report["checks"]):
            runner.record("authenticated_transport", "FAIL", error_details(exc))
    statuses = {check["status"] for check in runner.report["checks"]}
    runner.report["status"] = "FAIL" if "FAIL" in statuses else "BLOCKED" if "BLOCKED" in statuses else "PARTIAL" if statuses & {"PARTIAL", "UNSUPPORTED"} else "PASS"
    runner.report["executed_tool_ids"] = sorted({call["name"] for call in runner.report["calls"] if call.get("executed") and call.get("method") == "tools/call"})
    runner.report["unexecuted_tool_ids"] = sorted(set(runner.catalog["tools"]) - set(runner.report["executed_tool_ids"]))
    runner.report["actual_call_count"] = sum(call.get("executed") is True for call in runner.report["calls"])
    def aggregate(predicate):
        states = {c["status"] for c in runner.report["checks"] if predicate(c["name"])}
        return next((status for status in ("FAIL", "BLOCKED", "PARTIAL", "UNSUPPORTED", "PASS") if status in states), "UNTESTED")
    mandatory = {"runtime_revision", "unauthenticated_denial", "shared_bearer_not_matrix_identity", "authenticated_transport", "matrix/owner/positive", "matrix/owner/revoked", "matrix/owner/invalid", "matrix/owner/export_denied", "matrix/other/positive"}
    mandatory.update(f"market/market/{name}" for name, spec in runner.catalog["datasets"].items() if spec["scope_type"] == "market")
    if any(c["name"] == "matrix_mandatory" for c in runner.report["checks"]):
        mandatory.add("matrix_mandatory")
    symbols = [runner.options.symbol] if runner.options.smoke else SYMBOLS
    prices_required = {f"{symbol}/{window}/{tool}" for symbol in symbols for window in ("recent", "older") for tool in ("get_symbol_prices", "get_eod_price_history")}
    finance_required = {f"{symbol}/{store}/{period}/{statement}" for symbol in symbols for store in ("SQL", "raw") for period in ("year", "quarter") for statement in (*STATEMENTS, "ratio")}
    mongo_required = {"mongo_status"}
    mongo_required.update(f"symbol/{symbol}/{name}" for symbol in symbols for name, spec in runner.catalog["datasets"].items() if spec["scope_type"] == "symbol" and not name.startswith("finance."))
    mongo_required.update(f"market/market/{name}" for name, spec in runner.catalog["datasets"].items() if spec["scope_type"] == "market")
    matrix_required = {f"matrix/{role}/{kind}" for role in ("owner", "other") for kind in ("positive", "revoked", "invalid", "export_denied")}
    if any(c["name"] == "matrix_mandatory" for c in runner.report["checks"]):
        matrix_required.add("matrix_mandatory")
    runner.report["gate_status"] = {
        "1": mandatory_gate(runner.report["checks"], prices_required),
        "2": mandatory_gate(runner.report["checks"], finance_required),
        "3": mandatory_gate(runner.report["checks"], mongo_required),
        "4": aggregate(lambda name: name == "complete_discovery"),
        "5": mandatory_gate(runner.report["checks"], mandatory),
        "6": "UNTESTED_OFFLINE_REGRESSIONS; all report paths sanitize output",
        "7": mandatory_gate(runner.report["checks"], matrix_required),
        "8": aggregate(lambda name: name in {"full_payload_over_20_rows", "full_nested_large_payload"}),
    }
    report = json.dumps(redact(runner.report), indent=2, allow_nan=False)
    print(report)
    if options.report:
        try:
            Path(options.report).write_text(report + "\n")
        except OSError as exc:
            print(json.dumps(redact({"status": "FAIL", "error": str(exc)})), file=sys.stderr)
            return 1
    return 0 if runner.report["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
