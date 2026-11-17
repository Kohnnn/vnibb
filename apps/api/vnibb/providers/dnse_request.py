import base64
import hashlib
import hmac
import re
from datetime import datetime
from urllib.parse import quote, urlencode

from vnibb.providers.dnse_types import SignedRequest
from vnibb.providers.dnse_validation import integer as _integer
from vnibb.providers.dnse_validation import symbol as _symbol


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


def dnse_request(
    operation: str, *, api_key: str, api_secret: str, date: str, nonce: str | None = None,
    symbol: str | None = None, params: object = None, method: str = "GET",
) -> SignedRequest:
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
