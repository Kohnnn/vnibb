from __future__ import annotations

import calendar
import hashlib
import json
import re
from copy import deepcopy
from datetime import UTC, date, datetime
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation, localcontext
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import or_, select

from vnibb.models.financials import BalanceSheet, CashFlow, IncomeStatement
from vnibb.models.stock import Stock, StockPrice
from vnibb.models.trading import FinancialRatio
from vnibb.services.matrix_playbooks import (
    DEFINITION_REVISION,
    PLAYBOOKS,
    classify_sector,
    normalized_classification,
)

MODELS = (IncomeStatement, BalanceSheet, CashFlow, FinancialRatio)
STORED_LIMIT = "Retained serving observation, not original issuer evidence; source publication, audit and restatement authority are not verified."
UNKNOWN_BASIS = "Unknown accounting scope"


def canonical_decimal(value: object) -> str | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    if not number.is_finite():
        return None
    if number == 0:
        return "0"
    return format(number, "f").rstrip("0").rstrip(".") if "." in format(number, "f") else format(number, "f")


def display_decimal(value: str | None, unit: str) -> str:
    if value is None:
        return "Unavailable"
    with localcontext() as context:
        context.prec = max(40, len(value) + 4)
        rounded = Decimal(value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    text = f"{rounded:,.2f}"
    if unit == "%":
        return f"{text}%"
    if unit == "multiple":
        return f"{text}×"
    return f"{text} {unit}"


def _iso(value: datetime | date | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime) and value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.isoformat()


def _identity(value: object) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=True).encode()).hexdigest()


def _source_label(table: type, row: object) -> str:
    source = str(getattr(row, "source", None) or "unknown")
    supplier = source if re.fullmatch(r"[A-Za-z0-9_.-]{1,40}", source) else "unknown"
    return f"stored.sql.{table.__tablename__}:{supplier}"


def parse_period(period: str, period_type: str) -> tuple[int, int | None]:
    pattern = r"(20\d{2})" if period_type == "year" else r"(20\d{2})-Q([1-4])"
    match = re.fullmatch(pattern, period) if period_type in {"year", "quarter"} else None
    if not match:
        raise ValueError("Period must be YYYY for year or YYYY-Q1..Q4 for quarter")
    return int(match[1]), int(match[2]) if period_type == "quarter" else None


def _row_period(row: object) -> str:
    quarter = getattr(row, "fiscal_quarter", None)
    return f"{row.fiscal_year}-Q{quarter}" if row.period_type == "quarter" else str(row.fiscal_year)


def _raw(row: object) -> dict:
    value = getattr(row, "raw_data", None)
    return value if isinstance(value, dict) else {}


def _unit(row: object, field: str, explicit: str | None = None) -> str:
    if explicit:
        return explicit
    raw = _raw(row)
    units = raw.get("units")
    value = units.get(field) if isinstance(units, dict) else None
    known = {"vnd": "VND", "million vnd": "million VND", "billion vnd": "billion VND", "bn vnd": "billion VND", "%": "%", "percent": "%", "multiple": "multiple"}
    if field.endswith("_bn_vnd"):
        return "billion VND" if value is None else known.get(str(value).strip().lower(), "unknown unit")
    ratio_fields = {"roe", "net_interest_margin", "non_performing_loan_ratio", "nonperforming_loan_ratio"}
    if field in ratio_fields:
        value = value or raw.get("unit")
        unit = known.get(str(value).strip().lower(), "unknown unit")
        return unit if unit in {"%", "multiple"} else "unknown unit"
    value = value or raw.get("unit") or raw.get("currency_unit")
    return known.get(str(value).strip().lower(), "unknown unit")


def _basis(row: object) -> str:
    raw = _raw(row)
    value = raw.get("consolidation") or raw.get("accounting_scope")
    normalized = normalized_classification(value) if isinstance(value, str) else ""
    scopes = {"consolidated": "consolidated", "standalone": "standalone", "separate": "standalone"}
    scope = scopes.get(normalized, UNKNOWN_BASIS)
    if scope == UNKNOWN_BASIS or row.period_type != "quarter" or not isinstance(row, (IncomeStatement, CashFlow)):
        return scope
    flow_basis = raw.get("flow_basis")
    if flow_basis not in {"single_quarter", "year_to_date"}:
        return f"{scope}; unknown quarterly flow basis"
    return f"{scope}; {flow_basis}"


def _unknown_basis(basis: str) -> bool:
    return basis == UNKNOWN_BASIS or "unknown quarterly flow basis" in basis


def _metric(key: str, label: str, period: str, reason: str) -> dict:
    return {"key": key, "label": label, "value": None, "display": "Unavailable", "unit": "unknown unit", "period": period, "as_of": None, "basis": reason, "evidence_ids": []}


class ObservationBuilder:
    def __init__(self, symbol: str, period: str, rows: dict, captured_at: str):
        self.symbol = symbol
        self.period = period
        self.rows = rows
        self.captured_at = captured_at
        self.evidence: dict[str, dict] = {}

    def observe(self, table: type, field: str, label: str, *, key: str | None = None, previous: bool = False, raw_keys: tuple[str, ...] = (), unit: str | None = None) -> dict:
        metric_key = key or field
        row = self.rows.get((table, previous))
        if row is None:
            return _metric(metric_key, label, self.period, "No retained row for the requested fiscal period")
        source_field = field
        value = getattr(row, field, None) if not raw_keys else None
        if raw_keys:
            for raw_key in raw_keys:
                if canonical_decimal(_raw(row).get(raw_key)) is not None:
                    source_field = f"raw_data.{raw_key}"
                    value = _raw(row)[raw_key]
                    break
        canonical = canonical_decimal(value)
        if canonical is None:
            return _metric(metric_key, label, _row_period(row), f"No explicit retained {label.lower()} field; no proxy substituted")
        metric_unit = _unit(row, source_field.removeprefix("raw_data."), unit)
        basis = _basis(row)
        limits = [STORED_LIMIT]
        if metric_unit == "unknown unit":
            limits.append("Unit/scale is not retained; value must not be compared or used in a derived ratio.")
        if _unknown_basis(basis):
            limits.append("Accounting scope or single-quarter versus year-to-date basis is not retained.")
        evidence = {"entity_id": self.symbol, "source": _source_label(table, row), "locator": f"{table.__tablename__}/row/{row.id}/period/{row.period_type}/{row.period}", "field": source_field, "value": canonical, "unit": metric_unit, "period": _row_period(row), "as_of": None, "captured_at": self.captured_at, "provenance": "stored_observation", "formula": None, "input_evidence_ids": [], "limitations": limits + [f"Row updated: {_iso(row.updated_at) or 'unknown'} (not publication date)."]}
        evidence_id = f"e-{_identity(evidence)}"
        evidence["evidence_id"] = evidence_id
        self.evidence[evidence_id] = evidence
        return {"key": metric_key, "label": label, "value": canonical, "display": display_decimal(canonical, metric_unit), "unit": metric_unit, "period": _row_period(row), "as_of": None, "basis": basis, "evidence_ids": [evidence_id]}

    def derive(self, key: str, label: str, inputs: list[dict], operation: str, unit: str) -> dict:
        absent = _metric(key, label, self.period, "Required input unavailable")
        if any(item["value"] is None for item in inputs):
            return absent
        if any(item["unit"] == "unknown unit" or _unknown_basis(item["basis"]) for item in inputs):
            return {**absent, "basis": "Derivation withheld: input unit or accounting scope is unknown"}
        if len({item["unit"] for item in inputs}) != 1 or len({item["basis"] for item in inputs}) != 1:
            return {**absent, "basis": "Derivation withheld: input units or accounting scopes differ"}
        values = [Decimal(item["value"]) for item in inputs]
        if operation != "sum" and values[-1] <= 0:
            return {**absent, "basis": "Derivation withheld: denominator must be positive"}
        with localcontext() as context:
            context.prec = 28
            if operation == "sum":
                value = sum(values, Decimal(0))
                formula = " + ".join(item["key"] for item in inputs)
            elif operation == "growth":
                value = (values[0] / values[1] - 1) * 100
                formula = f"({inputs[0]['key']} / prior_year_same_period_{inputs[1]['key']} - 1) * 100"
            else:
                value = values[0] / values[1] * (100 if unit == "%" else 1)
                formula = f"{inputs[0]['key']} / {inputs[1]['key']}" + (" * 100" if unit == "%" else "")
        canonical = canonical_decimal(value)
        input_ids = list(dict.fromkeys(eid for item in inputs for eid in item["evidence_ids"]))
        evidence = {"entity_id": self.symbol, "source": "derived.matrix", "locator": f"matrix/{DEFINITION_REVISION}/{self.symbol}/{self.period}/{key}", "field": key, "value": canonical, "unit": unit, "period": self.period, "as_of": None, "captured_at": self.captured_at, "provenance": "derived", "formula": formula, "input_evidence_ids": input_ids, "limitations": ["Calculated from frozen serving inputs; not an issuer-reported or regulatory measure."]}
        evidence_id = f"e-{_identity(evidence)}"
        evidence["evidence_id"] = evidence_id
        self.evidence[evidence_id] = evidence
        return {"key": key, "label": label, "value": canonical, "display": display_decimal(canonical, unit), "unit": unit, "period": self.period, "as_of": None, "basis": inputs[0]["basis"], "evidence_ids": [evidence_id, *input_ids]}


def _financial_metrics(builder: ObservationBuilder, playbook: str) -> dict[str, list[dict]]:
    observe, derive = builder.observe, builder.derive
    profit = observe(IncomeStatement, "net_income", "Net profit")
    equity = observe(BalanceSheet, "total_equity", "Book equity")
    pb = observe(FinancialRatio, "pb_ratio", "Price/book", unit="multiple")
    metrics = {"profitability": [profit, equity], "valuation": [pb]}
    if playbook == "nonfinancial":
        revenue = observe(IncomeStatement, "revenue", "Revenue")
        previous = observe(IncomeStatement, "revenue", "Prior-year same-period revenue", key="prior_year_revenue", previous=True)
        cash = observe(CashFlow, "operating_cash_flow", "Operating cash flow")
        short_debt = observe(BalanceSheet, "short_term_debt", "Short-term debt")
        long_debt = observe(BalanceSheet, "long_term_debt", "Long-term debt")
        debt = derive("total_debt", "Interest-bearing debt", [short_debt, long_debt], "sum", short_debt["unit"])
        metrics.update({
            "growth": [revenue, previous, derive("revenue_yoy", "Revenue YoY", [revenue, previous], "growth", "%")],
            "profitability": [profit, derive("net_margin", "Net margin", [profit, revenue], "ratio", "%")],
            "cash": [cash, derive("cash_conversion", "OCF/net profit", [cash, profit], "ratio", "multiple")],
            "leverage": [short_debt, long_debt, debt, equity, derive("debt_equity", "Debt/equity", [debt, equity], "ratio", "multiple")],
            "valuation": [observe(FinancialRatio, "pe_ratio", "Price/earnings", unit="multiple"), pb],
        })
    elif playbook == "bank":
        loans = observe(BalanceSheet, "customer_loans", "Customer loans", raw_keys=("customer_loans", "loans_to_customers", "loans_to_customers_bn_vnd"))
        deposits = observe(BalanceSheet, "customer_deposits", "Customer deposits", raw_keys=("customer_deposits", "deposits_from_customers"))
        assets = observe(BalanceSheet, "total_assets", "Total assets")
        metrics.update({
            "profitability": [profit, observe(FinancialRatio, "roe", "Stored ROE")],
            "funding": [loans, deposits, derive("accounting_loan_deposit", "Accounting loans/deposits (not regulatory LDR)", [loans, deposits], "ratio", "multiple")],
            "capital": [equity, assets, derive("equity_assets", "Equity/assets (not CAR)", [equity, assets], "ratio", "%")],
            "credit": [observe(FinancialRatio, "nim", "Explicit net interest margin", raw_keys=("net_interest_margin",)), observe(FinancialRatio, "npl", "Explicit nonperforming-loan ratio", raw_keys=("non_performing_loan_ratio", "nonperforming_loan_ratio"))],
        })
    elif playbook == "insurer":
        metrics["insurance"] = [observe(IncomeStatement, key, label, raw_keys=(key,)) for key, label in (("insurance_premiums", "Explicit insurance premiums"), ("insurance_claims", "Explicit insurance claims"), ("investment_income", "Explicit investment income"))]
        metrics["underwriting"] = [_metric(key, label, builder.period, "Dedicated definition, legal-entity scope and regulatory basis are not retained") for key, label in (("underwriting_ratio", "Underwriting ratio"), ("solvency_ratio", "Regulatory solvency"))]
    else:
        metrics["securities"] = [observe(table, key, label, raw_keys=(key,)) for table, key, label in ((IncomeStatement, "brokerage_revenue", "Explicit brokerage revenue"), (BalanceSheet, "margin_loans", "Explicit margin loans"), (IncomeStatement, "investment_income", "Explicit investment income"))]
        metrics["capital"] = [_metric("regulatory_capital", "Regulatory capital", builder.period, "No dedicated securities capital-safety definition and retained source observation")]
    return metrics


def _cell(entity_id: str, dimension_id: str, payload: dict, *, state: str = "supported", basis: str = "Retained SQL observations", evidence_ids: list[str] | None = None, limitations: list[str] | None = None) -> dict:
    return {"result_id": "", "entity_id": entity_id, "dimension_id": dimension_id, "result_revision": "", "state": state, "payload": payload, "evidence_ids": evidence_ids or [], "basis": basis, "limitations": limitations or [], "review_state": "unreviewed"}


def _metric_cell(symbol: str, dimension: str, metrics: list[dict]) -> dict:
    available = [metric for metric in metrics if metric["value"] is not None]
    limits = [metric["basis"] for metric in metrics if metric["value"] is None]
    unknown = any(metric["unit"] == "unknown unit" or _unknown_basis(metric["basis"]) for metric in available)
    state = "unavailable" if not available else "non_comparable" if unknown else "supported"
    if unknown:
        limits.append("Some retained values have unknown unit or accounting scope; no claim of cross-company comparability.")
    if available and dimension == "valuation":
        state = "non_comparable"
        limits.append("Stored multiple has no verified market price date or earnings/book denominator vintage.")
    if available and dimension in {"credit", "insurance", "securities"}:
        state = "non_comparable"
        limits.append("Explicit source keys are retained, but dedicated metric definitions (gross/net, earned/written, segment or regulatory basis) are not verified.")
    return _cell(symbol, dimension, {"kind": "table", "metrics": metrics}, state=state, evidence_ids=list(dict.fromkeys(eid for metric in metrics for eid in metric["evidence_ids"])), limitations=list(dict.fromkeys(limits)))


def _classification_cell(stock: Stock, captured_at: str) -> tuple[dict, list[dict]]:
    family, subtype = classify_sector(stock.industry, stock.sector)
    evidence = []
    for field in ("industry", "sector"):
        value = getattr(stock, field)
        if value:
            item = {"entity_id": stock.symbol, "source": "stored.sql.stocks:unknown", "locator": f"stocks/row/{stock.id}", "field": field, "value": value, "unit": "classification", "period": "not period-specific", "as_of": None, "captured_at": captured_at, "provenance": "stored_observation", "formula": None, "input_evidence_ids": [], "limitations": ["Descriptive stored classification; not an independently verified regulatory license.", "The stock master does not retain the original supplier identity or publication date."]}
            item["evidence_id"] = f"e-{_identity(item)}"
            evidence.append(item)
    labels = [value for value in (stock.industry, stock.sector, f"Playbook family: {family}", f"Insurer subtype: {subtype}" if subtype else None) if value]
    return _cell(stock.symbol, "classification", {"kind": "classification", "labels": labels}, evidence_ids=[item["evidence_id"] for item in evidence]), evidence


async def prepare_matrix(db, anchor_symbol: str) -> dict:
    anchor_symbol = anchor_symbol.strip().upper()
    stocks = (await db.execute(select(Stock.symbol, Stock.industry, Stock.sector).where(Stock.is_active == 1).order_by(Stock.symbol))).all()
    anchor = next((stock for stock in stocks if stock.symbol == anchor_symbol), None)
    if anchor is None:
        raise ValueError("Anchor has no active stored company record")
    family, subtype = classify_sector(anchor.industry, anchor.sector)
    if family is None:
        raise ValueError("Anchor has no supported stored sector classification")
    peers = [stock for stock in stocks if stock.symbol != anchor_symbol and classify_sector(stock.industry, stock.sector) == (family, subtype)]
    if family == "nonfinancial":
        classification = normalized_classification(anchor.industry or anchor.sector)
        peers = [stock for stock in peers if normalized_classification(stock.industry or stock.sector) == classification]
    symbols = [anchor_symbol, *(stock.symbol for stock in peers[:9])]
    rows = (await db.execute(select(IncomeStatement.symbol, IncomeStatement.fiscal_year).where(IncomeStatement.symbol.in_(symbols), IncomeStatement.period_type == "year", IncomeStatement.fiscal_year.between(2000, datetime.now(UTC).year), or_(IncomeStatement.net_income.is_not(None), IncomeStatement.revenue.is_not(None))).distinct())).all()
    periods_by_symbol = {symbol: set() for symbol in symbols}
    for row in rows:
        periods_by_symbol[row.symbol].add(str(row.fiscal_year))
    periods = sorted(set.intersection(*periods_by_symbol.values()), reverse=True)
    limits = ["Peer proposals use stored classifications, not exchange membership; confirm the shortlist before creating.", "Common periods establish retained income-row overlap, not complete metric or audit comparability."]
    if len(symbols) < 2:
        limits.append("Fewer than two classified companies are stored; snapshot creation requires 2–10 companies.")
    if not periods:
        limits.append("No common annual income period exists across this proposed shortlist; adjust the shortlist or choose an explicit period with unavailable cells.")
    return {"anchor_symbol": anchor_symbol, "playbook_id": family, "symbols": symbols, "peer_basis": "Same stored sector family and insurer subtype; nonfinancial peers also share the stored industry label; alphabetical order, never exchange fallback.", "periods": periods, "period_type": "year", "limitations": limits}


async def _load_rows(db, symbols: list[str], year: int, quarter: int | None, period_type: str) -> dict:
    rows = {symbol: {} for symbol in symbols}
    for table in MODELS:
        query = select(table).where(table.symbol.in_(symbols), table.period_type == period_type, table.fiscal_year.in_([year, year - 1]))
        query = query.where(table.fiscal_quarter == quarter) if quarter else query.where(or_(table.fiscal_quarter.is_(None), table.fiscal_quarter == 0))
        found = (await db.execute(query.order_by(table.updated_at.desc(), table.id.desc()))).scalars().all()
        for row in found:
            key = (table, row.fiscal_year != year)
            rows[row.symbol].setdefault(key, row)
    return rows


async def build_matrix_observations(db, symbols: list[str], playbook_id: str, period: str, period_type: str) -> dict:
    year, quarter = parse_period(period, period_type)
    playbook = next((item for item in PLAYBOOKS if item["playbook_id"] == playbook_id), None)
    if playbook is None:
        raise ValueError("Unknown Matrix playbook")
    stocks = list((await db.execute(select(Stock).where(Stock.symbol.in_(symbols)))).scalars().all())
    by_symbol = {stock.symbol: stock for stock in stocks}
    if set(by_symbol) != set(symbols):
        raise ValueError("Every selected company must have a retained company record")
    if any(classify_sector(stock.industry, stock.sector)[0] != playbook_id for stock in stocks):
        raise ValueError("Selected company classification does not match the playbook")
    subtypes = {classify_sector(stock.industry, stock.sector)[1] for stock in stocks}
    if playbook_id == "insurer" and len(subtypes) > 1:
        raise ValueError("Insurer subtypes cannot be combined in one comparison")
    rows = await _load_rows(db, symbols, year, quarter, period_type)
    captured_at = datetime.now(UTC).isoformat()
    result = {"entities": [], "dimensions": deepcopy(playbook["dimensions"]), "cells": [], "evidence": [], "limitations": [STORED_LIMIT, "Missing inputs remain unavailable; unknown units or accounting scope block derived comparisons.", "Period-specific valuation does not establish a common market observation date."]}
    for symbol in symbols:
        stock = by_symbol[symbol]
        builder = ObservationBuilder(symbol, period, rows[symbol], captured_at)
        result["entities"].append({"entity_id": symbol, "symbol": symbol, "name": stock.company_name or stock.short_name or symbol, "sector": stock.industry or stock.sector})
        result["cells"].extend(_metric_cell(symbol, key, metrics) for key, metrics in _financial_metrics(builder, playbook_id).items())
        classification, evidence = _classification_cell(stock, captured_at)
        result["cells"].append(classification)
        result["evidence"].extend([*builder.evidence.values(), *evidence])
        datasets = sorted({table.__tablename__ for table, previous in rows[symbol] if not previous})
        result["cells"].extend([
            _cell(symbol, "basis", {"kind": "text", "text": f"{period_type.title()} {period}. {playbook['description']} {STORED_LIMIT}"}),
            _cell(symbol, "sources", {"kind": "source_set", "labels": datasets}, limitations=["Dataset inventory only; these labels are not metric evidence or original documents."]),
            _cell(symbol, "artifact", {"kind": "artifact", "artifact_ref": None, "text": "No retained original issuer artifact is linked to these SQL rows."}, state="unavailable", limitations=["Structured observations must not be presented as an original document."]),
        ])
    await _add_stored_closes(db, result, symbols, year, quarter, captured_at)
    _mark_incompatible_comparisons(result["cells"])
    return result


def _mark_incompatible_comparisons(cells: list[dict]) -> None:
    scopes: dict[tuple[str, str, str], set[tuple[str, str]]] = {}
    for cell in cells:
        for metric in cell["payload"].get("metrics", []):
            if metric["value"] is not None:
                key = (cell["dimension_id"], metric["key"], metric["period"])
                scopes.setdefault(key, set()).add((metric["unit"], metric["basis"]))
    incompatible = {key for key, values in scopes.items() if len(values) > 1}
    for cell in cells:
        if any((cell["dimension_id"], metric["key"], metric["period"]) in incompatible for metric in cell["payload"].get("metrics", []) if metric["value"] is not None):
            cell["state"] = "non_comparable"
            cell["limitations"].append("Selected companies have different units or accounting scopes for the same metric; comparison is withheld.")


async def _add_stored_closes(db, result: dict, symbols: list[str], year: int, quarter: int | None, captured_at: str) -> None:
    month = quarter * 3 if quarter else 12
    end = date(year, month, calendar.monthrange(year, month)[1])
    start = date(year, month - 2 if quarter else 1, 1)
    result["dimensions"].append({"dimension_id": "stored_close", "label": "Stored market close", "question": "What final stored daily close exists within the selected fiscal period?", "output_type": "number", "source_scope": "Retained SQL daily prices; unknown price scale is not normalized", "definition_revision": DEFINITION_REVISION})
    for symbol in symbols:
        price = (await db.execute(select(StockPrice).where(StockPrice.symbol == symbol, StockPrice.interval == "1D", StockPrice.time >= start, StockPrice.time <= end).order_by(StockPrice.time.desc(), StockPrice.id.desc()).limit(1))).scalars().first()
        metric = _metric("close", "Stored close", str(year) if not quarter else f"{year}-Q{quarter}", "No retained daily close within the requested fiscal period")
        evidence_ids = []
        if price is not None and canonical_decimal(price.close) is not None:
            value = canonical_decimal(price.close)
            evidence = {"entity_id": symbol, "source": _source_label(StockPrice, price), "locator": f"stock_prices/row/{price.id}/trade-date/{price.time.isoformat()}", "field": "close", "value": value, "unit": "unknown unit", "period": metric["period"], "as_of": price.time.isoformat(), "captured_at": captured_at, "provenance": "stored_observation", "formula": None, "input_evidence_ids": [], "limitations": ["Price scale is not retained; VND versus thousand VND cannot be inferred.", f"Trade date is distinct from write date {_iso(price.created_at)}.", STORED_LIMIT]}
            evidence["evidence_id"] = f"e-{_identity(evidence)}"
            evidence_ids = [evidence["evidence_id"]]
            result["evidence"].append(evidence)
            metric.update(value=value, display=display_decimal(value, "unknown unit"), as_of=price.time.isoformat(), basis="Stored daily close; unit unknown", evidence_ids=evidence_ids)
        result["cells"].append(_cell(symbol, "stored_close", {"kind": "number", "metrics": [metric]}, state="non_comparable" if evidence_ids else "unavailable", evidence_ids=evidence_ids, limitations=[metric["basis"]]))


def build_matrix_fixture() -> dict:
    created_at = "2025-01-15T00:00:00+00:00"
    snapshot_id = str(uuid5(NAMESPACE_URL, "vnibb:matrix:synthetic:fixture:1"))
    entities = [{"entity_id": symbol, "symbol": symbol, "name": f"Synthetic {symbol}", "sector": "Synthetic nonfinancial"} for symbol in ("DEMO_A", "DEMO_B")]
    definitions = [("number", "Signed number"), ("table", "Metrics table"), ("text", "Research note"), ("classification", "Classification"), ("source_set", "Source inventory"), ("artifact", "Issuer artifact"), ("unavailable", "Missing input"), ("non_comparable", "Unknown basis"), ("failed", "Failed calculation"), ("denied", "Denied source")]
    dimensions = [{"dimension_id": key, "label": label, "question": label, "output_type": key if key in {"number", "table", "text", "classification", "source_set", "artifact"} else "number", "source_scope": "Synthetic fixture only", "definition_revision": DEFINITION_REVISION} for key, label in definitions]
    cells, evidence = [], []
    for index, entity in enumerate(entities):
        symbol = entity["symbol"]
        value = "-1234567.895" if index == 0 else "0"
        evidence_id = f"fixture-evidence-{symbol}"
        evidence.append({"evidence_id": evidence_id, "entity_id": symbol, "source": "synthetic.fixture", "locator": f"fixture/1/{symbol}/signed_value", "field": "signed_value", "value": value, "unit": "VND", "period": "2024", "as_of": None, "captured_at": created_at, "provenance": "stored_observation", "formula": None, "input_evidence_ids": [], "limitations": ["Invented demonstration data, never a real issuer observation."]})
        metric = {"key": "signed_value", "label": "Synthetic signed value", "value": value, "display": display_decimal(value, "VND"), "unit": "VND", "period": "2024", "as_of": None, "basis": "Synthetic known basis", "evidence_ids": [evidence_id]}
        for dimension, _ in definitions:
            state, ids, limits = "supported", [], []
            if dimension in {"number", "table"}:
                payload, ids = {"kind": dimension, "metrics": [deepcopy(metric)]}, [evidence_id]
            elif dimension == "text":
                payload = {"kind": "text", "text": "Synthetic research note. This is not investment evidence."}
            elif dimension == "classification":
                payload = {"kind": "classification", "labels": ["Synthetic", "Nonfinancial demonstration"]}
            elif dimension == "source_set":
                payload = {"kind": "source_set", "labels": ["synthetic.fixture"]}
                limits = ["Inventory only; source-set membership is not metric evidence."]
            elif dimension == "artifact":
                state, payload = "unavailable", {"kind": "artifact", "artifact_ref": None, "text": "No original artifact exists for invented data."}
            elif dimension == "non_comparable":
                state = "non_comparable"
                payload = {"kind": "number", "metrics": [{**deepcopy(metric), "basis": "Synthetic accounting scopes intentionally differ"}]}
                ids, limits = [evidence_id], ["Do not compare across incompatible accounting scopes."]
            else:
                state = dimension
                reason = {"unavailable": "Synthetic input was not supplied", "failed": "Synthetic calculation failure demonstration, not an actual provider error", "denied": "Synthetic source-rights denial demonstration"}[dimension]
                payload, limits = {"kind": "unavailable", "text": reason}, [reason]
            cell = _cell(symbol, dimension, payload, state=state, evidence_ids=ids, limitations=limits, basis="Synthetic demonstration only")
            cell["result_id"] = str(uuid5(NAMESPACE_URL, f"{snapshot_id}/{symbol}/{dimension}"))
            cell["result_revision"] = "fixture-1"
            cells.append(cell)
    return {"snapshot": {"schema_version": "matrix-v1", "matrix_id": snapshot_id, "snapshot_id": snapshot_id, "revision": "fixture-1", "created_at": created_at, "synthetic": True, "anchor_symbol": "DEMO_A", "playbook_id": "nonfinancial", "definition_revision": DEFINITION_REVISION, "period": "2024", "period_type": "year", "entities": entities, "dimensions": dimensions, "cells": cells, "limitations": ["All values and companies are synthetic; no fixture fallback is used for real snapshots."]}, "evidence": evidence}
