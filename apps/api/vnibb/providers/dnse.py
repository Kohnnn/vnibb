"""Pure transforms and request construction for supplied DNSE market data.

This module never acquires data or credentials. Documented numeric units,
adjustment basis and session finality remain unverified.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import math
import re
from datetime import UTC, datetime, timedelta, timezone
from urllib.parse import quote, urlencode

_UNAVAILABLE = "unverified_price_volume_value_units"
_PRICE_FIELDS = ("open", "high", "low", "close", "price", "volume", "value")
_HISTORY_COLUMNS = ("t", "o", "h", "l", "c", "v")
_TRADE_NUMBERS = ("matchPrice", "avgPrice", "grossTradeAmount", "highestPrice", "lowestPrice", "openPrice")
_TRADE_INTEGERS = ("matchQtty", "totalVolumeTraded")
_TRADE_TEXT = ("marketId", "boardId", "isin", "symbol", "side")
_INSTRUMENT_TEXT = ("symbol", "marketId", "securityGroupId", "symbolType", "listedDate", "shortName", "name")


def _integer(value, field, bits=64):
    if isinstance(value, bool) or not isinstance(value, int) or not -(2 ** (bits - 1)) <= value < 2 ** (bits - 1):
        raise ValueError(f"Malformed DNSE {field}")
    return value


def _number(value, field):
    try:
        valid = not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)
    except OverflowError:
        valid = False
    if not valid:
        raise ValueError(f"Malformed DNSE {field}")


def _symbol(value):
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Malformed DNSE symbol")
    return value.strip().upper()


def _object(value, field):
    if not isinstance(value, dict):
        raise ValueError(f"Malformed DNSE {field}")
    return value


def _observation(symbol, raw):
    return {
        "symbol": symbol,
        "source": "DNSE",
        "price_source": "dnse_unknown",
        "price_unit": "unknown",
        "unavailable_reason": _UNAVAILABLE,
        "raw_data": dict(raw),
        **dict.fromkeys(_PRICE_FIELDS),
    }


def dnse_history(symbol, payload):
    """Return supplied bars in order; no canonical value is asserted."""
    symbol = _symbol(symbol)
    payload = _object(payload, "history")
    if "symbol" in payload and _symbol(payload["symbol"]) != symbol:
        raise ValueError("DNSE symbol mismatch")
    columns = [payload.get(field) for field in _HISTORY_COLUMNS]
    if any(not isinstance(column, list) for column in columns) or len({len(column) for column in columns}) != 1:
        raise ValueError("Malformed DNSE history arrays")
    next_time = _integer(payload.get("nextTime"), "nextTime")
    if not columns[0] and next_time != 0:
        raise ValueError("DNSE history unavailable: empty nonterminal page")
    rows = []
    for values in zip(*columns, strict=True):
        raw = dict(zip(_HISTORY_COLUMNS, values, strict=True))
        timestamp = _integer(raw["t"], "timestamp")
        _integer(raw["v"], "volume")
        for field in ("o", "h", "l", "c"):
            _number(raw[field], field)
        try:
            observed = datetime.fromtimestamp(timestamp, UTC)
        except (ValueError, OverflowError, OSError):
            raise ValueError("Malformed DNSE timestamp") from None
        row = _observation(symbol, raw)
        row.update(t=timestamp, time=observed, nextTime=next_time)
        rows.append(row)
    return rows


def dnse_quote(symbol, payload):
    """Return one unambiguous latest executed trade, not a bid/ask quote."""
    symbol = _symbol(symbol)
    payload = _object(payload, "trades")
    trades = payload.get("trades")
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
    result = _observation(symbol, trade)
    result.update(boardId=trade["boardId"], time=observed)
    return result


def dnse_listing(payload):
    """Return identities from one supplied page, not a complete universe."""
    payload = _object(payload, "instruments")
    data = payload.get("data")
    if not isinstance(data, list):
        raise ValueError("Malformed DNSE instruments data")
    total = _integer(payload.get("total"), "total", bits=32)
    page = _integer(payload.get("page"), "page", bits=32)
    page_size = _integer(payload.get("pageSize"), "pageSize", bits=32)
    if total < 0 or page < 1 or page_size < 1:
        raise ValueError("Malformed DNSE page metadata")
    page_count = max(1, (total + page_size - 1) // page_size)
    if page > page_count:
        raise ValueError("Malformed DNSE page metadata")
    expected = min(page_size, max(0, total - (page - 1) * page_size))
    if len(data) != expected:
        raise ValueError("Malformed DNSE page length")
    rows, identities = [], set()
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


def dnse_assemble_pages(pages):
    """Assemble a bounded, complete set of supplied instrument pages only."""
    # ponytail: cap in-memory assembly at 1000 pages; use a streaming contract if needed.
    if not isinstance(pages, list) or not 1 <= len(pages) <= 1000:
        raise ValueError("Malformed DNSE pages")
    by_page, identities = {}, set()
    total = page_size = None
    for payload in pages:
        rows = dnse_listing(payload)
        if total is None:
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


def _request_symbol(value):
    value = _symbol(value)
    if not re.fullmatch(r"[A-Z0-9][A-Z0-9._-]*", value):
        raise ValueError("Malformed DNSE request symbol")
    return value


def _header_value(value, field, *, quoted=False):
    if not isinstance(value, str) or not value or any(ord(char) < 32 or ord(char) > 126 for char in value):
        raise ValueError(f"Malformed DNSE {field}")
    if quoted and ('"' in value or "\\" in value):
        raise ValueError(f"Malformed DNSE {field}")
    return value


def dnse_request(operation, *, api_key, api_secret, date, nonce=None, symbol=None, params=None, method="GET"):
    """Build a signed SDK-style request using explicit values; never send it.

    The returned headers are sensitive. The pinned SDK uses Date, while the
    rendered endpoint schemas require X-Aux-Date; compatibility is unverified.
    """
    if method != "GET" or operation not in ("history", "quote", "listing"):
        raise ValueError("Unsupported DNSE request")
    api_key = _header_value(api_key, "API key", quoted=True)
    if not isinstance(api_secret, str) or not api_secret:
        raise ValueError("Malformed DNSE secret")
    date = _header_value(date, "date")
    try:
        datetime.strptime(date, "%a, %d %b %Y %H:%M:%S %z")
    except ValueError:
        raise ValueError("Malformed DNSE date") from None
    if nonce is not None:
        nonce = _header_value(nonce, "nonce", quoted=True)
    if params is None:
        params = {}
    if not isinstance(params, dict):
        raise ValueError("Malformed DNSE parameters")
    allowed = {
        "history": {"resolution", "from", "to", "type"},
        "quote": {"boardId"},
        "listing": {"symbol", "marketId", "securityGroupId", "indexName", "limit", "page"},
    }
    if any(not isinstance(key, str) or key not in allowed[operation] for key in params):
        raise ValueError("Unsupported DNSE parameter")
    if operation == "history":
        path = "/price/ohlc"
        query = {"symbol": _request_symbol(symbol), **params}
        if not isinstance(params.get("resolution"), str) or params["resolution"] not in {"1", "3", "5", "15", "30", "1H", "1D", "1W"}:
            raise ValueError("Malformed DNSE resolution")
        for field in ("from", "to"):
            _integer(params.get(field), field)
        if params["from"] > params["to"]:
            raise ValueError("Malformed DNSE time range")
        if "type" in params and (not isinstance(params["type"], str) or params["type"] not in {"STOCK", "DERIVATIVE", "INDEX"}):
            raise ValueError("Malformed DNSE type")
    elif operation == "quote":
        path = f"/price/{_request_symbol(symbol)}/trades/latest"
        query = dict(params)
        if "boardId" in params and (not isinstance(params["boardId"], str) or params["boardId"] not in {"G1", "G4", "T1", "T3", "T4", "T6"}):
            raise ValueError("Malformed DNSE boardId")
    else:
        if symbol is not None:
            raise ValueError("Unsupported DNSE request symbol")
        path, query = "/market/instruments", dict(params)
        for field, choices in (("marketId", {"STO", "STX", "UPX", "DVX", "HCX"}), ("securityGroupId", {"ST", "EF", "EW", "FU", "BS"})):
            if field in params and (not isinstance(params[field], str) or params[field] not in choices):
                raise ValueError(f"Malformed DNSE {field}")
        if "symbol" in params:
            if not isinstance(params["symbol"], str):
                raise ValueError("Malformed DNSE request symbol")
            query["symbol"] = ",".join(_request_symbol(value) for value in params["symbol"].split(","))
        if "indexName" in params:
            _header_value(params["indexName"], "indexName")
        for field in ("limit", "page"):
            if field in params and _integer(params[field], field, bits=32) < 1:
                raise ValueError(f"Malformed DNSE {field}")
    signing_text = f"(request-target): get {path}\ndate: {date}"
    if nonce is not None:
        signing_text += f"\nnonce: {nonce}"
    try:
        secret = api_secret.encode("utf-8")
    except UnicodeEncodeError:
        raise ValueError("Malformed DNSE secret") from None
    digest = hmac.new(secret, signing_text.encode("utf-8"), hashlib.sha256).digest()
    signature = quote(base64.b64encode(digest).decode("ascii"), safe="")
    authorization = f'Signature keyId="{api_key}",algorithm="hmac-sha256",headers="(request-target) date",signature="{signature}"'
    if nonce is not None:
        authorization += f',nonce="{nonce}"'
    return {"method": "GET", "path": path, "query": urlencode(query), "headers": {"Date": date, "X-Signature": authorization, "x-api-key": api_key, "version": "2026-07-23"}}


def dnse_error(status, error_code=None):
    """Classify an explicitly supplied failure without retaining its body."""
    _integer(status, "status", bits=32)
    if not 400 <= status <= 599 or (error_code is not None and not isinstance(error_code, str)):
        raise ValueError("Malformed DNSE error")
    reason = (
        "rate_limited" if status == 429 else
        "quota_exceeded" if status == 403 and error_code == "OA-401" else
        "forbidden" if status == 403 else
        "authentication_failed" if status == 401 else
        "provider_error" if status >= 500 else "request_rejected"
    )
    return {"source": "DNSE", "status": status, "reason": reason}


def dnse_unavailable(capability):
    if not isinstance(capability, str) or not capability.strip():
        raise ValueError("Malformed DNSE capability")
    return {"source": "DNSE", "capability": capability, "available": False, "reason": "not_available_from_offline_adapter"}
