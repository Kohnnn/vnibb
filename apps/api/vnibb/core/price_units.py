"""Source-backed equity price units; never infer currency scale from magnitude."""

import re
from collections.abc import Mapping
from typing import Any, Literal

PriceUnit = Literal["VND", "index_points", "unknown"]

_INDEX_SYMBOLS = {
    "VNINDEX", "HNXINDEX", "UPCOMINDEX", "HNX30", "VN30", "VNMID", "VNSML",
    "VN100", "VNALL", "VNSI", "VNIT", "VNIND", "VNCONS", "VNCOND", "VNHEAL",
    "VNENE", "VNUTI", "VNREAL", "VNFIN", "VNMAT", "VNDIAMOND", "VNFINLEAD",
    "VNFINSELECT", "VNX50", "VNXALL", "HNXFIN", "HNXCON", "HNXLCAP", "HNXMAN",
    "HNXMSCAP", "UPCOMLAR", "UPCOMMID", "UPCOMSML", "HNX", "UPCOM",
    "VNMIDCAP", "VNSMALLCAP", "VNALLSHARE",
}
_DERIVATIVE_SYMBOL = re.compile(r"^(?:4[12][A-Z0-9]{2}[0-9A-HJ-NP-TV-W][1-9A-C]\d{3}|VN100F\d{1,2}[MQ]|VN30F(?:\d{1,2}[MQ]|\d{4}))$")
_PRICE_FIELDS = {
    "open", "high", "low", "close", "price", "raw_close", "adjusted_close",
    "adj_close", "adjClose", "prev_close", "prevClose", "change",
}
_THOUSAND_UNITS = {"THOUSAND_VND", "THOUSANDVND", "K_VND", "KVND", "VND_THOUSANDS"}
_HISTORY_SOURCES = {"KBS", "VCI", "TCBS"}


def is_index_symbol(symbol: str) -> bool:
    normalized = str(symbol or "").upper().replace("-", "")
    return normalized in _INDEX_SYMBOLS or bool(_DERIVATIVE_SYMBOL.fullmatch(normalized))


def normalize_price_record(
    record: Mapping[str, Any], *, symbol: str = "", source: str | None = None,
) -> dict[str, Any]:
    normalized = dict(record)
    symbol = symbol or str(record.get("symbol") or "")
    if source:
        normalized["price_source"] = source
    marker = record.get("price_unit") or record.get("priceUnit")
    provenance = str(source or record.get("price_source") or record.get("source") or "")
    unit = str(marker or "").strip().upper()
    if marker is None:
        if provenance.lower() == "vnstock_vnd" or re.fullmatch(r"vnstock_vnd:(?:KBS|VCI|TCBS)", provenance, re.IGNORECASE):
            unit = "VND"
        elif provenance.lower() == "vnstock_points" or re.fullmatch(r"vnstock_points:(?:KBS|VCI|TCBS)", provenance, re.IGNORECASE):
            unit = "INDEX_POINTS"
        elif provenance.startswith("vnstock_history:") and provenance.split(":", 1)[1].upper() in _HISTORY_SOURCES:
            unit = "THOUSAND_VND"
    asset_type = str(record.get("asset_type") or "").lower()
    noncurrency = is_index_symbol(symbol) or asset_type in {"index", "derivative"}
    if unit == "INDEX_POINTS" or (noncurrency and (unit == "VND" or unit in _THOUSAND_UNITS)):
        normalized["price_unit"] = "index_points"
        return normalized
    if unit == "VND":
        normalized["price_unit"] = "VND"
        return normalized
    if unit in _THOUSAND_UNITS:
        for field in _PRICE_FIELDS:
            if normalized.get(field) is not None:
                normalized[field] = float(normalized[field]) * 1000.0
        normalized["price_unit"] = "VND"
        return normalized
    normalized["price_unit"] = "unknown"
    return normalized


def persisted_price_source(record: Mapping[str, Any]) -> str:
    unit = record.get("price_unit")
    prefix = "vnstock_vnd" if unit == "VND" else "vnstock_points" if unit == "index_points" else "vnstock_unknown"
    source = str(record.get("price_source") or "")
    provider = source.rsplit(":", 1)[-1].upper()
    return f"{prefix}:{provider}" if provider in _HISTORY_SOURCES and unit != "unknown" else prefix


def persisted_price_record(row: Any) -> dict[str, Any]:
    if isinstance(row, Mapping):
        payload = dict(row)
    else:
        fields = ("symbol", "time", "open", "high", "low", "close", "volume", "value", "adj_close", "source")
        payload = {field: getattr(row, field, None) for field in fields}
    if str(payload.get("source") or "").upper() in _HISTORY_SOURCES and not payload.get("price_source"):
        payload["price_source"] = f"vnstock_history:{str(payload['source']).upper()}"
    raw_data = getattr(row, "raw_data", None)
    if isinstance(raw_data, dict):
        payload.update({key: raw_data[key] for key in ("price_unit", "priceUnit", "price_source") if key in raw_data})
    return normalize_price_record(payload)


def screener_price_record(row: Any) -> dict[str, Any]:
    if isinstance(row, Mapping):
        metrics = row.get("extended_metrics")
        payload = dict(metrics) if isinstance(metrics, dict) else {}
        payload.update({key: row[key] for key in ("symbol", "price", "price_unit", "priceUnit", "price_source") if key in row})
    else:
        metrics = getattr(row, "extended_metrics", None)
        payload = dict(metrics) if isinstance(metrics, dict) else {}
        payload.update(symbol=getattr(row, "symbol", ""), price=getattr(row, "price", None))
    return normalize_price_record(payload)


def normalize_screener_record(record: Mapping[str, Any]) -> dict[str, Any]:
    normalized = dict(record)
    price = screener_price_record(record)
    normalized["price"] = price.get("price")
    normalized["extended_metrics"] = {
        **(record.get("extended_metrics") or {}),
        "price_unit": price["price_unit"],
        "price_source": price.get("price_source"),
    }
    for key in ("price_unit", "priceUnit", "price_source"):
        normalized.pop(key, None)
    return normalized


def history_price_records(
    frame: Any, *, symbol: str, source: str, provider: Any = None,
    asset_type: str | None = None,
) -> list[dict[str, Any]]:
    attrs = getattr(frame, "attrs", {})
    attrs = attrs if isinstance(attrs, dict) else {}
    frame_fields = getattr(frame, "__dict__", {})
    actual_source = frame_fields.get("source") or attrs.get("source")
    if not isinstance(actual_source, str) and provider is not None and not isinstance(provider, str):
        actual_source = getattr(provider, "source", None)
    actual_source = actual_source.upper() if isinstance(actual_source, str) else source.upper()
    if isinstance(provider, str):
        module = provider
    elif provider is not None:
        module = getattr(provider, "__module__", None) or type(provider).__module__
    else:
        module = str(attrs.get("provider_module") or "")
    sponsor = module.startswith(("vnstock_data", "vnstock_ta"))
    provenance = f"{'vnstock_data_history' if sponsor else 'vnstock_history'}:{actual_source}"
    category = frame_fields.get("category") or attrs.get("asset_type") or attrs.get("category") or asset_type
    if category is None and provider is not None and not isinstance(provider, str):
        category = getattr(provider, "asset_type", None)
    marker = attrs.get("price_unit") or attrs.get("priceUnit")
    records = []
    for record in frame.to_dict("records"):
        if isinstance(category, str):
            record.setdefault("asset_type", category)
        if marker is not None and not (record.get("price_unit") or record.get("priceUnit")):
            record["price_unit"] = marker
        record["provider_module"] = module
        records.append(normalize_price_record(record, symbol=symbol, source=provenance))
    return records
