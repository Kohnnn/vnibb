"""Descriptor-backed IQ financial decoding and structured storage bridges."""

import math
import re
import unicodedata
from collections import Counter, defaultdict
from collections.abc import Mapping, Sequence
from datetime import date, datetime
from typing import Any

from vnibb.providers.vnstock.balance_sheet import BalanceSheetData
from vnibb.providers.vnstock.cash_flow import CashFlowData
from vnibb.providers.vnstock.financial_ratios import FinancialRatioData
from vnibb.providers.vnstock.income_statement import IncomeStatementData


class StructuredFinancialUnavailable(ValueError):
    def __init__(self, persisted_rows: int, unavailable_groups: Sequence, evidence: Sequence):
        self.persisted_rows = persisted_rows
        self.unavailable_groups = list(unavailable_groups)
        self.evidence = list(evidence)
        super().__init__(f"IQ structured financials unavailable: persisted {persisted_rows} rows; unavailable datasets {self.unavailable_groups}; evidence {self.evidence}")


_MODELS = {"finance.income_statement": IncomeStatementData, "finance.balance_sheet": BalanceSheetData,
           "finance.cash_flow": CashFlowData, "finance.ratio": FinancialRatioData}
_SECTIONS = dict(zip(_MODELS, ("INCOME_STATEMENT", "BALANCE_SHEET", "CASH_FLOW", "RATIO"), strict=True))
# Labels identify meaning; field codes are resolved only from the received descriptor.
_LABELS = {
    "revenue": ("net sales", "net revenue", "doanh thu thuần"),
    "cost_of_revenue": ("cost of sales", "cost of goods sold", "cost of revenue", "giá vốn hàng bán"),
    "gross_profit": ("gross profit", "lợi nhuận gộp"),
    "operating_expense": ("operating expenses", "operating expense"),
    "operating_income": ("operating profit/(loss)", "operating profit", "operating income"),
    "interest_expense": ("interest expenses", "interest expense", "chi phí lãi vay"),
    "profit_before_tax": ("net accounting profit/(loss) before tax", "profit before tax", "lợi nhuận trước thuế"),
    "tax_expense": ("corporate income tax expenses", "income tax expense", "tax expense"),
    "net_income": ("net profit/(loss) after tax", "net income", "profit after tax", "lợi nhuận sau thuế"),
    "total_assets": ("total assets", "tổng tài sản"),
    "current_assets": ("current assets", "tài sản ngắn hạn"),
    "fixed_assets": ("fixed assets", "tài sản cố định"),
    "total_liabilities": ("total liabilities", "liabilities", "nợ phải trả"),
    "current_liabilities": ("current liabilities", "nợ ngắn hạn"),
    "long_term_liabilities": ("non current liabilities", "long term liabilities", "nợ dài hạn"),
    "equity": ("owner's equity", "owners equity", "total equity", "vốn chủ sở hữu"),
    "cash": ("cash and cash equivalents", "tiền và các khoản tương đương tiền"),
    "inventory": ("inventories", "inventory", "hàng tồn kho"),
    "receivables": ("accounts receivable", "trade receivables"),
    "operating_cash_flow": ("net cash inflows/(outflows) from operating activities", "net cash flows from operating activities", "net cash from operating activities", "lưu chuyển tiền thuần từ hoạt động kinh doanh"),
    "investing_cash_flow": ("net cash inflows/(outflows) from investing activities", "net cash flows from investing activities", "net cash from investing activities", "lưu chuyển tiền thuần từ hoạt động đầu tư"),
    "financing_cash_flow": ("net cash inflows/(outflows) from financing activities", "net cash flows from financing activities", "net cash from financing activities", "lưu chuyển tiền thuần từ hoạt động tài chính"),
    "net_cash_flow": ("net increase in cash and cash equivalents", "net change in cash", "net increase decrease in cash and cash equivalents"),
    "free_cash_flow": ("free cash flow",), "capital_expenditure": ("capital expenditure",),
    "dividends_paid": ("dividends paid",),
    "eps": ("eps basic (vnd)", "earnings per share", "basic earnings per share", "eps"),
    "bvps": ("book value per share", "bvps"), "pe": ("p/e", "price to earnings"),
    "pb": ("p/b", "price to book"), "ps": ("p/s", "price to sales"),
    "ev_ebitda": ("ev/ebitda",), "ev_sales": ("ev/sales",),
    "roe": ("return on equity", "roe"), "roa": ("return on assets", "roa"),
    "roic": ("return on invested capital", "roic"),
    "debt_equity": ("debt/equity", "debt to equity"), "debt_assets": ("debt to assets",),
    "current_ratio": ("current ratio",), "quick_ratio": ("quick ratio",), "cash_ratio": ("cash ratio",),
    "gross_margin": ("gross margin",), "net_margin": ("net profit margin", "net margin"),
    "operating_margin": ("operating margin",), "interest_coverage": ("interest coverage",),
    "revenue_growth": ("revenue growth",), "earnings_growth": ("earnings growth",),
    "dps": ("dividend per share",), "dividend_yield": ("dividend yield",),
}
_PERCENT_FIELDS = {"roe", "roa", "roic", "gross_margin", "net_margin", "operating_margin", "revenue_growth", "earnings_growth", "dividend_yield"}
_PER_SHARE_FIELDS = {"eps", "bvps", "dps"}


def _label(value: Any) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).casefold().replace("-", " ").split()) if isinstance(value, str) else ""


_LABEL_FIELDS = {_label(label): field for field, labels in _LABELS.items() for label in labels}


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        return float(value) if math.isfinite(value) else None
    except (OverflowError, ValueError):
        return None


def _integer(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        return None
    text = str(value)
    return int(text) if text.isascii() and text.isdigit() and len(text) <= 4 else None


def _publication_date(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).isoformat()
    except ValueError:
        return None


def _explicit_basis(raw: Mapping[str, Any], keys: tuple[str, ...], allowed: set[str]) -> str:
    values = [raw[key] for key in keys if raw.get(key) is not None]
    normalized = {_label(value).replace(" ", "_") for value in values}
    return next(iter(normalized)) if len(normalized) == 1 and normalized <= allowed else "unknown"


def financial_fiscal_basis(record: Mapping[str, Any]) -> dict[str, Any]:
    raw = record.get("raw") if isinstance(record.get("raw"), Mapping) else {}
    variant = str(record.get("datasetVariant", "")).rsplit(".", 1)[-1]
    years = {_integer(raw[key]) for key in ("yearReport", "year", "fiscalYear") if raw.get(key) is not None}
    year = next(iter(years)) if len(years) == 1 else None
    contradictory = len(years - {None}) > 1
    quarter = None
    if variant in {"quarter", "ttm"}:
        quarters = {_integer(raw[key]) for key in ("lengthReport", "quarter", "fiscalQuarter") if raw.get(key) is not None}
        quarter = next(iter(quarters)) if len(quarters) == 1 else None
        contradictory = contradictory or len(quarters - {None}) > 1
    valid = year is not None and 1900 <= year <= 9999 and variant in {"year", "quarter"}
    valid = valid and record.get("dataset") in _MODELS and record.get("datasetVariant") == f"{record.get('dataset')}.{variant}"
    valid = valid and (variant == "year" or quarter in {1, 2, 3, 4})
    ratio_type = raw.get("ratioType") if record.get("dataset") == "finance.ratio" else None
    ttm = record.get("dataset") == "finance.ratio" and (
        ratio_type == "RATIO_TTM" or (ratio_type in (None, "") and raw.get("ratioTTMId") is not None)
    )
    if record.get("dataset") == "finance.ratio" and ratio_type not in (None, "", "RATIO_YEAR", "RATIO_TTM"):
        valid = False
    if ratio_type == "RATIO_YEAR" and variant == "quarter":
        valid = False
        contradictory = True
    annual_quarters = (None, 0, "0", 5, "5") if record.get("dataset") == "finance.ratio" and raw.get("ratioType") == "RATIO_YEAR" else (None, 0, "0")
    if variant == "year" and (raw.get("quarter") not in annual_quarters or raw.get("lengthReport") not in (None, 5, "5")):
        valid = False
        contradictory = contradictory or not ttm
    for supplied in (record, raw):
        if supplied.get("periodType") is not None and _label(supplied["periodType"]) != variant:
            valid = False
            contradictory = contradictory or variant in {"year", "quarter", "ttm"}
        if supplied.get("fiscalYear") is not None and _integer(supplied["fiscalYear"]) != year:
            valid = False
            contradictory = contradictory or year is not None
        if variant in {"quarter", "ttm"} and supplied.get("fiscalQuarter") is not None and _integer(supplied["fiscalQuarter"]) != quarter:
            valid = False
            contradictory = contradictory or quarter is not None
        if variant == "year" and supplied.get("fiscalQuarter") is not None and supplied["fiscalQuarter"] not in annual_quarters:
            valid = False
            contradictory = True
        if supplied.get("period") is None:
            continue
        text = str(supplied["period"]).upper()
        annual = re.fullmatch(r"(?:FY)?(\d{4})", text)
        quarterly = re.fullmatch(r"Q([1-4])-(\d{4})|(\d{4})-Q([1-4])", text)
        if variant == "year":
            matches = annual is not None and int(annual[1]) == year
            valid = valid and matches
            contradictory = contradictory or (year is not None and not matches)
        else:
            period_year = int(quarterly[2] or quarterly[3]) if quarterly else None
            period_quarter = int(quarterly[1] or quarterly[4]) if quarterly else None
            matches = quarterly is not None and (period_year, period_quarter) == (year, quarter)
            valid = valid and matches
            contradictory = contradictory or (year is not None and quarter is not None and not matches)
    reason = "contradictory" if contradictory else "ratio_ttm" if ttm else None if valid else "unavailable"
    valid = valid and not ttm and not contradictory
    quarter_basis = _explicit_basis(raw, ("quarterBasis", "flowBasis", "flow_basis"), {"single_quarter", "cumulative_ytd"})
    scopes = [raw[key] for key in ("consolidationBasis", "consolidation_basis") if raw.get(key) is not None]
    scopes.extend("consolidated" if raw[key] else "separate" for key in ("consolidated", "isConsolidated") if isinstance(raw.get(key), bool))
    normalized_scopes = {_label(value).replace(" ", "_") for value in scopes}
    consolidation = next(iter(normalized_scopes)) if len(normalized_scopes) == 1 and normalized_scopes <= {"consolidated", "separate"} else "unknown"
    return {"raw": record.get("rawFiscalBasis", {key: raw[key] for key in ("yearReport", "year", "lengthReport", "quarter", "period") if key in raw}),
            "year": year if valid else None, "quarter": quarter if valid else None,
            "periodType": variant if valid else None,
            "period": (str(year) if variant == "year" else f"Q{quarter}-{year}") if valid else None,
            "reason": reason,
            "quarterBasis": quarter_basis, "consolidation": consolidation, "publicationDate": _publication_date(raw.get("publicDate"))}


def _unit(record: Mapping[str, Any], descriptor: Mapping[str, Any], field: str) -> tuple[float | None, str | None, dict[str, Any]]:
    raw = record.get("raw") or {}
    unit_evidence = record.get("unitEvidence") or {}
    if not isinstance(unit_evidence, Mapping):
        return None, None, {"invalidUnitEvidence": unit_evidence}
    sources = (descriptor, raw, unit_evidence)
    units = [source[key] for source in sources for key in ("unit", "unitCode") if source.get(key) is not None]
    currency = [source[key] for source in sources for key in ("currency", "currencyCode") if source.get(key) is not None]
    scales = [source["scale"] for source in sources if source.get("scale") is not None]
    evidence = {"units": units, "currencies": currency, "scales": scales}
    if field == "eps" and any(_label(descriptor.get(key)) == "eps basic (vnd)" for key in ("fullTitleEn", "titleEn")):
        evidence["unitTitle"] = "EPS basic (VND)"
        if not units and not currency and not scales:
            return 1.0, "VND/share", evidence
    normalized = {_label(value) for value in units}
    if len(normalized) != 1 or len({_label(value) for value in currency}) > 1 or len({str(value) for value in scales}) > 1:
        return None, None, evidence
    unit = next(iter(normalized))
    if currency and {_label(value) for value in currency} != {"vnd"}:
        return None, None, evidence
    if field in _PERCENT_FIELDS:
        return (1.0, "percent", evidence) if unit in {"percent", "%"} and not scales else (None, None, evidence)
    if record.get("dataset") == "finance.ratio" and field not in _PER_SHARE_FIELDS:
        return (1.0, "ratio", evidence) if unit in {"ratio", "times", "index"} and not scales else (None, None, evidence)
    factors = {"vnd": 1.0, "million vnd": 1_000_000.0, "billion vnd": 1_000_000_000.0}
    if field in _PER_SHARE_FIELDS:
        return (1.0, "VND/share", evidence) if unit in {"vnd/share", "vnd per share"} and not scales else (None, None, evidence)
    factor = factors.get(unit)
    if factor is None and unit in {"million", "billion"} and {_label(value) for value in currency} == {"vnd"}:
        factor = 1_000_000.0 if unit == "million" else 1_000_000_000.0
    if scales:
        explicit_scale = _number(scales[0])
        if unit != "vnd" or explicit_scale is None or explicit_scale <= 0:
            return None, None, evidence
        factor = explicit_scale
    return factor, ("VND/share" if field in _PER_SHARE_FIELDS else "VND") if factor is not None else None, evidence


def decode_vietcap_financial_record(record: Mapping[str, Any]) -> dict[str, Any]:
    dataset = record.get("dataset")
    model = _MODELS.get(dataset)
    if not isinstance(record.get("raw"), Mapping):
        return {"values": {}, "fieldEvidence": {}, "unavailable": {"record": "invalid_raw_row"}, "fiscalBasis": {"period": None}, "source": record.get("source")}
    result = {"values": {}, "fieldEvidence": {}, "unavailable": {}, "fiscalBasis": financial_fiscal_basis(record), "source": record.get("source")}
    if model is None:
        result["unavailable"]["record"] = "unsupported_dataset"
        return result
    fields = set(model.model_fields) - {"symbol", "period", "source", "raw_data", "fiscal_year", "fiscal_quarter", "unit_metadata", "value_unit", "flow_basis", "consolidation_basis", "ratio_units", "provider_evidence"}
    result["unavailable"] = dict.fromkeys(sorted(fields), "descriptor_unavailable")
    descriptors, evidence = record.get("descriptors"), record.get("descriptorEvidence") or {}
    if not isinstance(evidence, Mapping):
        result["unavailable"] = dict.fromkeys(sorted(fields), "descriptor_scope_unverified")
        return result
    if not isinstance(descriptors, list) or record.get("source") != "vietcap":
        return result
    if not record.get("comTypeCode") or any(evidence.get(key) != expected for key, expected in (
        ("symbol", record.get("symbol")), ("comTypeCode", record.get("comTypeCode")),
        ("section", _SECTIONS[dataset]), ("source", "vietcap"),
    )) or evidence.get("endpoint") != f"/v1/company/{record.get('symbol')}/financial-statement/metrics" or not evidence.get("receivedAt"):
        result["unavailable"] = dict.fromkeys(sorted(fields), "descriptor_scope_unverified")
        return result
    items = [item for item in descriptors if isinstance(item, Mapping)]
    counts = Counter(item.get("field") for item in items if isinstance(item.get("field"), str))
    identities = defaultdict(list)
    for item in items:
        for identity in (item.get("name"), item.get("field")):
            if isinstance(identity, str) and item not in identities[identity]:
                identities[identity].append(item)
    by_code = {identity: matches[0] for identity, matches in identities.items() if len(matches) == 1 and counts.get(matches[0].get("field")) == 1}
    candidates = defaultdict(list)
    for descriptor in items:
        code = descriptor.get("field")
        if not isinstance(code, str):
            continue
        full = [descriptor.get(key) for key in ("fullTitleEn", "fullTitleVi") if descriptor.get(key)]
        titles = full or [descriptor.get(key) for key in ("titleEn", "titleVi")]
        matches = {_LABEL_FIELDS[_label(title)] for title in titles if _label(title) in _LABEL_FIELDS} & fields
        parent, seen, hierarchy_valid = descriptor.get("parent"), {code}, True
        if isinstance(descriptor.get("name"), str):
            seen.add(descriptor["name"])
        while parent not in (None, "", 0, "0"):
            if not isinstance(parent, str) or parent in seen or parent not in by_code:
                hierarchy_valid = False
                break
            seen.add(parent)
            parent_descriptor = by_code[parent]
            seen.add(parent_descriptor["field"])
            if isinstance(parent_descriptor.get("name"), str):
                seen.add(parent_descriptor["name"])
            parent = parent_descriptor.get("parent")
        for field in matches:
            candidates[field].append((descriptor, hierarchy_valid and len(matches) == 1 and counts[code] == 1))
    raw = record.get("raw") or {}
    for field, matches in candidates.items():
        result["fieldEvidence"][field] = {"descriptors": [item[0] for item in matches], "descriptorEvidence": evidence}
        if len(matches) != 1 or not matches[0][1]:
            result["unavailable"][field] = "ambiguous_descriptor"
            continue
        descriptor = matches[0][0]
        value = _number(raw.get(descriptor["field"]))
        if value is None:
            result["unavailable"][field] = "value_unavailable"
            continue
        factor, unit, units = _unit(record, descriptor, field)
        result["fieldEvidence"][field].update({"rawValue": value, "unitEvidence": units, "unit": unit})
        if factor is None or not math.isfinite(value * factor):
            result["unavailable"][field] = "unit_unverified"
            continue
        basis = result["fiscalBasis"]
        result["fieldEvidence"][field]["fiscalBasis"] = basis
        if basis["periodType"] == "quarter" and dataset in {"finance.income_statement", "finance.cash_flow"} and field not in _PER_SHARE_FIELDS and basis["quarterBasis"] != "single_quarter":
            result["unavailable"][field] = "quarter_basis_unverified" if basis["quarterBasis"] == "unknown" else "incompatible_quarter_basis"
            continue
        result["values"][field] = value * factor
        del result["unavailable"][field]
    return result


async def persist_vietcap_financials(records: Sequence[Mapping[str, Any]], *, cache_manager=None) -> int:
    from vnibb.providers.vnstock.financials import FinancialStatementData
    from vnibb.services.cache_manager import CacheManager, StructuredPersistenceConflict

    cache, groups, unavailable = cache_manager or CacheManager(), defaultdict(list), []
    statement_types = {"finance.income_statement": "income", "finance.balance_sheet": "balance", "finance.cash_flow": "cashflow"}
    requested = {(record.get("symbol"), record.get("dataset"), str(record.get("datasetVariant", "")).rsplit(".", 1)[-1]) for record in records if record.get("dataset") in _MODELS}
    for record in records:
        if record.get("dataset") not in _MODELS:
            continue
        decoded = decode_vietcap_financial_record(record)
        basis = decoded["fiscalBasis"]
        if basis["period"] is None or record.get("source") != "vietcap" or not decoded["values"]:
            unavailable.append({"symbol": record.get("symbol"), "dataset": record.get("dataset"), "unavailable": decoded["unavailable"], "fiscalBasis": basis})
            continue
        row = {**decoded["values"], "period": basis["period"], "fiscal_year": basis["year"], "fiscal_quarter": basis["quarter"], "raw_data": {**record, "structured": decoded}}
        if record["dataset"] == "finance.ratio":
            row["raw_data"]["ratio_units"] = {
                field: decoded["fieldEvidence"][field]["unit"]
                for field in decoded["values"]
            }
        if record["dataset"] in statement_types:
            value_unit = "VND" if any(decoded["fieldEvidence"][field].get("unit") == "VND" for field in decoded["values"]) else None
            canonical_values = dict(decoded["values"])
            canonical_values.update({
                alias: canonical_values[field]
                for alias, field in {
                    "total_equity": "equity", "cash_and_equivalents": "cash",
                    "capex": "capital_expenditure", "pre_tax_profit": "profit_before_tax",
                    "net_change_in_cash": "net_cash_flow", "accounts_receivable": "receivables",
                }.items() if field in canonical_values
            })
            canonical = FinancialStatementData(
                symbol=record["symbol"], period=basis["period"], statement_type=statement_types[record["dataset"]],
                fiscal_year=basis["year"], fiscal_quarter=basis["quarter"], source="vietcap", currency="VND",
                value_unit=value_unit, unit_metadata=decoded["fieldEvidence"],
                flow_basis=basis["quarterBasis"] if basis["quarterBasis"] != "unknown" else None,
                consolidation_basis=basis["consolidation"] if basis["consolidation"] != "unknown" else None,
                aggregation_basis="reported_quarter" if basis["periodType"] == "quarter" else "reported_annual",
                source_periods=[basis["period"]],
                **canonical_values,
            ).model_dump(mode="json", exclude={"raw_data"})
            lineage = {key: canonical[key] for key in ("source", "currency", "value_unit", "unit_metadata", "aggregation_basis", "source_periods", "unavailable_reason", "consolidation_basis", "flow_basis")}
            lineage["canonical_data"] = canonical
            row["raw_data"]["_financial_lineage"] = lineage
        groups[(record["symbol"], record["dataset"], basis["periodType"])].append(row)
    if records and not groups:
        raise StructuredFinancialUnavailable(0, sorted(requested), unavailable)
    total = 0
    conflicts = []
    for (symbol, dataset, period), rows in groups.items():
        try:
            if dataset == "finance.ratio":
                total += await cache.store_financial_ratios(symbol, period, rows, source="vietcap")
            else:
                total += await cache.store_financial_data(symbol, statement_types[dataset], period, rows, source="vietcap")
        except StructuredPersistenceConflict as exc:
            total += exc.persisted_rows
            conflicts.extend(exc.conflicting_keys)
    if conflicts:
        raise StructuredPersistenceConflict(total, conflicts)
    if groups and total == 0:
        raise RuntimeError("IQ structured financial persistence affected no PostgreSQL rows")
    missing = requested - set(groups)
    if missing:
        raise StructuredFinancialUnavailable(total, sorted(missing), unavailable)
    return total


async def load_vietcap_financial_rows(symbol: str, dataset: str, period: str = "year", *, limit: int = 100, records: Sequence[Mapping[str, Any]] | None = None) -> list[IncomeStatementData | BalanceSheetData | CashFlowData | FinancialRatioData]:
    from vnibb.services.mongo_market_data_service import get_mongo_market_data_service

    if dataset not in _MODELS or period not in {"year", "quarter"} or not 1 <= limit <= 5000:
        raise ValueError("Unsupported financial dataset, period, or limit")
    if records is None:
        records = await get_mongo_market_data_service().get_raw_dataset_records_precise(symbol, dataset=dataset, variant=f"{dataset}.{period}", source="vietcap", limit=limit)
    rows, seen = [], set()
    for record in records:
        if record.get("dataset") != dataset or record.get("datasetVariant") != f"{dataset}.{period}":
            continue
        decoded = decode_vietcap_financial_record(record)
        basis = decoded["fiscalBasis"]
        if record.get("symbol") != symbol.upper() or not basis["period"] or not decoded["values"] or basis["period"] in seen:
            continue
        values = {"symbol": symbol.upper(), "period": basis["period"], **decoded["values"]}
        if dataset == "finance.ratio":
            values["ratio_units"] = {field: evidence["unit"] for field, evidence in decoded["fieldEvidence"].items() if field in decoded["values"]}
            values["provider_evidence"] = [{"source": "vietcap", "receivedAt": record.get("receivedAt"), "fiscalBasis": basis, "fields": decoded["fieldEvidence"]}]
        else:
            values.update(source="vietcap", raw_data={**record, "structured": decoded}, fiscal_year=basis["year"], fiscal_quarter=basis["quarter"], unit_metadata=decoded["fieldEvidence"],
                          value_unit="VND" if any(item.get("unit") == "VND" for field, item in decoded["fieldEvidence"].items() if field in decoded["values"]) else None,
                          flow_basis=basis["quarterBasis"] if basis["quarterBasis"] != "unknown" else None,
                          consolidation_basis=basis["consolidation"] if basis["consolidation"] != "unknown" else None)
        rows.append(_MODELS[dataset](**values))
        seen.add(basis["period"])
        if len(rows) == limit:
            break
    return rows


async def persist_vietcap_prices(symbol: str, rows: Sequence[Mapping[str, Any]], *, cache_manager=None, admission_details: dict[str, Any] | None = None) -> int:
    from vnibb.services.cache_manager import CacheManager, StructuredPersistenceConflict

    prepared = []
    rejected = Counter()
    for row in rows:
        if row.get("source") != "vietcap" or row.get("priceUnit", row.get("price_unit")) != "VND":
            rejected["source_or_vnd_unit_unavailable"] += 1
            continue
        if row.get("symbol", symbol) != symbol.upper():
            rejected["symbol_mismatch"] += 1
            continue
        timestamp = row.get("tradeDate", row.get("time"))
        if isinstance(timestamp, datetime):
            timestamp = timestamp.date()
        elif isinstance(timestamp, str):
            try:
                timestamp = date.fromisoformat(timestamp[:10])
            except ValueError:
                rejected["invalid_date"] += 1
                continue
        if not isinstance(timestamp, date):
            rejected["invalid_date"] += 1
            continue
        values = {field: _number(row.get(field)) for field in ("open", "high", "low", "close", "volume")}
        if any(value is None or value < 0 for value in values.values()):
            rejected["missing_negative_or_nonfinite_ohlcv"] += 1
            continue
        if not values["volume"].is_integer():
            rejected["noninteger_volume"] += 1
            continue
        if not values["low"] <= min(values["open"], values["close"]) <= max(values["open"], values["close"]) <= values["high"]:
            rejected["invalid_ohlc_bounds"] += 1
            continue
        prepared.append({**values, "time": timestamp, "volume": int(values["volume"]), "interval": "1D", "value": _number(row.get("value")), "adj_close": _number(row.get("adj_close", row.get("adjClose")))})
    if admission_details is not None:
        admission_details.update(source_rows=len(rows), admitted_rows=len(prepared), rejected_rows=sum(rejected.values()), rejected_reasons=dict(rejected),
                                 admitted_first=min(row["time"] for row in prepared).isoformat() if prepared else None,
                                 admitted_last=max(row["time"] for row in prepared).isoformat() if prepared else None,
                                 classification="partial_source_invalid" if rejected and prepared else "source_invalid" if rejected else "admitted_pending_persistence")
    if rows and not prepared:
        if admission_details is not None:
            admission_details.update(persisted_rows=0, persisted_first=None, persisted_last=None)
        raise ValueError("IQ prices unavailable: explicit VND source and valid OHLCV dates required")
    try:
        count = await (cache_manager or CacheManager()).store_historical_prices(symbol, prepared, source="vietcap_vnd") if prepared else 0
    except StructuredPersistenceConflict as exc:
        if admission_details is not None:
            admission_details.update(persisted_rows=exc.persisted_rows, classification="sql_source_conflict", conflicting_keys=exc.conflicting_keys)
        raise
    if admission_details is not None:
        admission_details.update(persisted_rows=count,
                                 persisted_first=admission_details["admitted_first"] if count == len(prepared) else None,
                                 persisted_last=admission_details["admitted_last"] if count == len(prepared) else None,
                                 classification="partial_sql_persistence" if count != len(prepared) else "partial_source_invalid" if rejected else "persisted_returned_window")
    if prepared and count == 0:
        raise RuntimeError("IQ price persistence affected no PostgreSQL rows")
    return count


def listing_projection(row: Mapping[str, Any], company: Mapping[str, Any]) -> dict[str, Any] | None:
    symbol, board = row.get("symbol"), row.get("board")
    board = "HOSE" if board == "HSX" else board
    if row.get("type") != "STOCK" or not isinstance(symbol, str) or not 1 <= len(symbol) <= 10 or board not in {"HOSE", "HNX", "UPCOM", "DELISTED"}:
        return None
    industry, sector = company.get("icbLv4"), company.get("icbLv1")
    return {"symbol": symbol.upper(), "company_name": company.get("name") or row.get("organName"),
            "short_name": row.get("organShortName"), "exchange": board, "is_active": int(board != "DELISTED"),
            "industry": industry.get("name") if isinstance(industry, Mapping) else None,
            "sector": sector.get("name") if isinstance(sector, Mapping) else None}


async def persist_vietcap_listings(trading_rows: Sequence[Mapping[str, Any]], search_rows: Sequence[Mapping[str, Any]], *, cache_manager=None) -> int:
    from vnibb.services.cache_manager import CacheManager

    search = defaultdict(list)
    for row in search_rows:
        symbol = row.get("code") or row.get("ticker")
        if isinstance(symbol, str):
            search[symbol.upper()].append(row)
    rows = []
    for row in trading_rows:
        matches = search.get(str(row.get("symbol") or "").upper(), [])
        projected = listing_projection(row, matches[0] if len(matches) == 1 else {})
        if projected is not None:
            rows.append(projected)
    if (trading_rows or search_rows) and not rows:
        raise ValueError("IQ listings unavailable: explicit symbol and exchange board required")
    count = await (cache_manager or CacheManager()).store_listing_data(rows, source="vietcap") if rows else 0
    if rows and count == 0:
        raise RuntimeError("IQ listing persistence affected no PostgreSQL rows")
    return count
