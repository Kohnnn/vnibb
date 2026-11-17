"""Pure transforms and request construction for supplied DNSE market data.

This module never acquires data or credentials. Documented numeric units,
adjustment basis and session finality remain unverified.
"""

from __future__ import annotations

import math
import re
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta, timezone
from typing import Literal

from vnibb.providers.dnse_request import dnse_request as dnse_request
from vnibb.providers.dnse_types import (
    HistoryObservation, ListingAssembly, ListingObservation, PriceObservation, ProviderError,
    QuoteObservation, UnavailableCapability,
)
from vnibb.providers.dnse_validation import integer as _integer
from vnibb.providers.dnse_validation import symbol as _symbol

_HISTORY_COLUMNS = ("t", "o", "h", "l", "c", "v")
_TRADE_NUMBERS = ("matchPrice", "avgPrice", "grossTradeAmount", "highestPrice", "lowestPrice", "openPrice")
_TRADE_INTEGERS = ("matchQtty", "totalVolumeTraded")
_TRADE_TEXT = ("marketId", "boardId", "isin", "symbol", "side")
_INSTRUMENT_TEXT = ("symbol", "marketId", "securityGroupId", "symbolType", "listedDate", "shortName", "name")


def _number(value, field):
    try:
        valid = not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)
    except OverflowError:
        valid = False
    if not valid:
        raise ValueError(f"Malformed DNSE {field}")


def _object(value, field):
    if not isinstance(value, dict):
        raise ValueError(f"Malformed DNSE {field}")
    return value


def _observation(symbol: str, raw: Mapping[object, object]) -> PriceObservation:
    return {
        "symbol": symbol,
        "source": "DNSE",
        "price_source": "dnse_unknown",
        "price_unit": "unknown",
        "unavailable_reason": "unverified_price_volume_value_units",
        "raw_data": dict(raw),
        "open": None, "high": None, "low": None, "close": None,
        "price": None, "volume": None, "value": None,
    }


def dnse_history(symbol: str, payload: object) -> list[HistoryObservation]:
    """Return supplied bars in order; no canonical value is asserted."""
    symbol = _symbol(symbol)
    envelope = _object(payload, "history")
    if "symbol" in envelope and _symbol(envelope["symbol"]) != symbol:
        raise ValueError("DNSE symbol mismatch")
    columns = [envelope.get(field) for field in _HISTORY_COLUMNS]
    if any(not isinstance(column, list) for column in columns) or len({len(column) for column in columns}) != 1:
        raise ValueError("Malformed DNSE history arrays")
    next_time = _integer(envelope.get("nextTime"), "nextTime")
    if not columns[0] and next_time != 0:
        raise ValueError("DNSE history unavailable: empty nonterminal page")
    rows = []
    for values in zip(*columns, strict=True):
        raw: dict[object, object] = dict(zip(_HISTORY_COLUMNS, values, strict=True))
        timestamp = _integer(raw["t"], "timestamp")
        _integer(raw["v"], "volume")
        for field in ("o", "h", "l", "c"):
            _number(raw[field], field)
        try:
            observed = datetime.fromtimestamp(timestamp, UTC)
        except (ValueError, OverflowError, OSError):
            raise ValueError("Malformed DNSE timestamp") from None
        row: HistoryObservation = {
            **_observation(symbol, raw), "t": timestamp, "time": observed, "nextTime": next_time,
        }
        rows.append(row)
    return rows


def dnse_quote(symbol: str, payload: object) -> QuoteObservation:
    """Return one unambiguous latest executed trade, not a bid/ask quote."""
    symbol = _symbol(symbol)
    envelope = _object(payload, "trades")
    trades = envelope.get("trades")
    if not isinstance(trades, list):
        raise ValueError("Malformed DNSE trades")
    if len(trades) != 1:
        raise ValueError("DNSE quote unavailable: empty or ambiguous trades")
    trade = _object(trades[0], "trade")
    if _symbol(trade.get("symbol")) != symbol:
        raise ValueError("DNSE symbol mismatch")
    if not isinstance(trade.get("boardId"), str) or not trade["boardId"].strip():
        raise ValueError("DNSE quote unavailable: missing board")
    for field in _TRADE_TEXT:
        if field in trade and not isinstance(trade[field], str):
            raise ValueError(f"Malformed DNSE {field}")
    if "side" in trade and trade["side"] not in {"BUY", "SELL", "UNSPECIFIED"}:
        raise ValueError("Malformed DNSE side")
    for field in _TRADE_NUMBERS:
        if field in trade or field == "matchPrice":
            _number(trade.get(field), field)
    for field in _TRADE_INTEGERS:
        if field in trade:
            _integer(trade[field], field, bits=32)
    timestamp = trade.get("time")
    if not isinstance(timestamp, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}(?: \(GMT\+7\))?", timestamp):
        raise ValueError("Malformed DNSE trade time")
    try:
        observed = datetime.strptime(timestamp.removesuffix(" (GMT+7)"), "%Y-%m-%d %H:%M:%S.%f").replace(tzinfo=timezone(timedelta(hours=7)))
    except ValueError:
        raise ValueError("Malformed DNSE trade time") from None
    return {**_observation(symbol, trade), "boardId": trade["boardId"], "time": observed}


def dnse_listing(payload: object) -> list[ListingObservation]:
    """Return identities from one supplied page, not a complete universe."""
    envelope = _object(payload, "instruments")
    data = envelope.get("data")
    if not isinstance(data, list):
        raise ValueError("Malformed DNSE instruments data")
    total = _integer(envelope.get("total"), "total", bits=32)
    page = _integer(envelope.get("page"), "page", bits=32)
    page_size = _integer(envelope.get("pageSize"), "pageSize", bits=32)
    if total < 0 or page < 1 or page_size < 1:
        raise ValueError("Malformed DNSE page metadata")
    page_count = max(1, (total + page_size - 1) // page_size)
    if page > page_count:
        raise ValueError("Malformed DNSE page metadata")
    expected = min(page_size, max(0, total - (page - 1) * page_size))
    if len(data) != expected:
        raise ValueError("Malformed DNSE page length")
    rows: list[ListingObservation] = []
    identities = set()
    for item in data:
        item = _object(item, "instrument")
        for field in _INSTRUMENT_TEXT:
            if field in item and not isinstance(item[field], str):
                raise ValueError(f"Malformed DNSE {field}")
        if "indexName" in item and (not isinstance(item["indexName"], list) or any(not isinstance(name, str) for name in item["indexName"])):
            raise ValueError("Malformed DNSE indexName")
        symbol = _symbol(item.get("symbol"))
        market = item.get("marketId")
        if not isinstance(market, str) or not market.strip():
            raise ValueError("Malformed DNSE marketId")
        identity = (symbol, market.strip().upper())
        if identity in identities:
            raise ValueError("Duplicate DNSE instrument identity")
        identities.add(identity)
        rows.append({"source": "DNSE", "symbol": symbol, "marketId": market, "raw_data": dict(item), "total": total, "page": page, "pageSize": page_size})
    return rows


def dnse_assemble_pages(pages: object) -> ListingAssembly:
    """Assemble a bounded, complete set of supplied instrument pages only."""
    # ponytail: cap in-memory assembly at 1000 pages; use a streaming contract if needed.
    if not isinstance(pages, list) or not 1 <= len(pages) <= 1000:
        raise ValueError("Malformed DNSE pages")
    by_page, identities = {}, set()
    total = page_size = 0
    for index, payload in enumerate(pages):
        rows = dnse_listing(payload)
        if index == 0:
            total, page_size = payload["total"], payload["pageSize"]
        if payload["total"] != total or payload["pageSize"] != page_size:
            raise ValueError("Conflicting DNSE page metadata")
        page = payload["page"]
        if page in by_page:
            raise ValueError("Duplicate DNSE page")
        for row in rows:
            identity = (row["symbol"], row["marketId"].strip().upper())
            if identity in identities:
                raise ValueError("Duplicate DNSE instrument identity")
            identities.add(identity)
        by_page[page] = rows
    if set(by_page) != set(range(1, len(by_page) + 1)):
        raise ValueError("Missing DNSE instrument pages")
    rows = [row for page in sorted(by_page) for row in by_page[page]]
    if len(rows) != total:
        raise ValueError("Incomplete DNSE instrument pages")
    return {"data": rows, "total": total, "pageSize": page_size, "pages": len(by_page), "pagination_complete": True}


def dnse_error(status: int, error_code: str | None = None) -> ProviderError:
    """Classify an explicitly supplied failure without retaining its body."""
    _integer(status, "status", bits=32)
    if not 400 <= status <= 599 or (error_code is not None and not isinstance(error_code, str)):
        raise ValueError("Malformed DNSE error")
    reason: Literal["rate_limited", "quota_exceeded", "forbidden", "authentication_failed", "provider_error", "request_rejected"] = (
        "rate_limited" if status == 429 else
        "quota_exceeded" if status == 403 and error_code == "OA-401" else
        "forbidden" if status == 403 else
        "authentication_failed" if status == 401 else
        "provider_error" if status >= 500 else "request_rejected"
    )
    return {"source": "DNSE", "status": status, "reason": reason}


def dnse_unavailable(capability: str) -> UnavailableCapability:
    if not isinstance(capability, str) or not capability.strip():
        raise ValueError("Malformed DNSE capability")
    return {"source": "DNSE", "capability": capability, "available": False, "reason": "not_available_from_offline_adapter"}
