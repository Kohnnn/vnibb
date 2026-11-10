"""Authenticated DNSE LightSpeed API client (signed REST).

Credentials are read from Settings only; nothing here enables acquisition on its
own. Callers must opt in explicitly (`dnse_enabled=true`), which keeps #168
source-permission gating at the configuration boundary.

Signing contract (developers.dnse.com.vn/docs/guide/intro/authentication):
``HMAC-SHA256(secret, "(request-target): <method> <path>\\ndate: <RFC1123>\\nnonce: <hex>")``
base64-encoded, with ``+``/``/``/``=`` percent-encoded, sent in ``X-Signature``.
The date is signed verbatim, so DNSE rejects clocks skewed beyond ±1 minute.

No credential ever leaves this module (#231): the API key, the secret and the
``X-Signature`` header value are all credential-equivalent, so error messages
carry only the HTTP status and the upstream error *code* (``OA-401``), never a
response body, and this module logs neither.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import re
import urllib.parse
from datetime import UTC, datetime
from email.utils import format_datetime
from math import isfinite
from typing import Any
from uuid import uuid4

import httpx

from vnibb.core.config import settings
from vnibb.core.exceptions import ProviderError

logger = logging.getLogger(__name__)

DNSE_BASE_URL = "https://openapi.dnse.com.vn"
DNSE_TIMEOUT_SECONDS = 20.0
_OHLC_SERIES = ("o", "h", "l", "c", "v")
# DNSE's documented error shape is ``OA-<3 digits>`` (e.g. ``OA-400``, ``OA-401``).
# Anything else is dropped rather than sanitised: this string is persisted into a
# durable receipt, and a permissive class would let a body smuggle a 32-char
# opaque token through. Widen only with evidence of another documented prefix.
_ERROR_CODE = re.compile(r"OA-\d{3}")


class DNSEConfigError(ProviderError):
    """Raised when DNSE is requested but not configured or not enabled.

    ``reason`` is a stable token, not prose: it is what a receipt records, so it
    must not grow detail later (the message is for humans, this is for the DB).
    """

    def __init__(self, message: str, reason: str):
        super().__init__(message, "dnse")
        self.reason = reason


DNSE_DISABLED = "dnse_disabled"
DNSE_CREDENTIALS_MISSING = "dnse_credentials_missing"


def _credentials() -> tuple[str, str]:
    if not settings.dnse_enabled:
        raise DNSEConfigError(
            "DNSE acquisition is disabled; set DNSE_ENABLED=true once source permission is recorded",
            DNSE_DISABLED,
        )
    key = (settings.dnse_api_key or "").strip()
    secret = (settings.dnse_api_secret or "").strip()
    if not key or not secret:
        raise DNSEConfigError(
            "DNSE_API_KEY / DNSE_API_SECRET are not configured", DNSE_CREDENTIALS_MISSING
        )
    return key, secret


def ensure_configured() -> None:
    """Raise ``DNSEConfigError`` unless acquisition is enabled and credentialed.

    Callers use this to refuse a whole run up front, before any per-symbol work.
    """
    _credentials()


def build_signature(
    secret: str, method: str, path: str, date_value: str, nonce: str
) -> tuple[str, str]:
    """Return ``(headers_list, encoded_signature)`` for a signed request."""
    headers_list = "(request-target) date"
    signing_string = (
        f"(request-target): {method.lower()} {path}\ndate: {date_value}\nnonce: {nonce}"
    )
    digest = hmac.new(
        secret.encode("utf-8"), signing_string.encode("utf-8"), hashlib.sha256
    ).digest()
    encoded = base64.b64encode(digest).decode("ascii")
    # Only + / = are percent-encoded; the rest of the base64 stays literal.
    return headers_list, encoded.replace("+", "%2B").replace("/", "%2F").replace("=", "%3D")


def _signed_headers(key: str, secret: str, method: str, path: str) -> dict[str, str]:
    date_value = format_datetime(datetime.now(UTC))
    nonce = uuid4().hex
    headers_list, signature = build_signature(secret, method, path, date_value, nonce)
    return {
        "Date": date_value,
        "X-Signature": (
            f'Signature keyId="{key}",algorithm="hmac-sha256",headers="{headers_list}",'
            f'signature="{signature}",nonce="{nonce}"'
        ),
        "x-api-key": key,
        "version": settings.dnse_api_version,
    }


def _error_code(response: httpx.Response) -> str:
    """Return the upstream error ``code`` only, or ``""`` when it is unusable.

    Whatever this returns is copied into the ``sync_status`` receipt, so nothing
    else from the body survives: no message, no echoed request context.
    """
    try:
        payload = response.json()
    except ValueError:
        return ""
    code = str(payload.get("code") or "") if isinstance(payload, dict) else ""
    return code if _ERROR_CODE.fullmatch(code) else ""


def _status_error(path: str, response: httpx.Response) -> ProviderError:
    code = _error_code(response)
    detail = f" ({code})" if code else ""
    return ProviderError(f"DNSE {path} returned HTTP {response.status_code}{detail}", "dnse")


async def dnse_get(path: str, params: dict[str, Any] | None = None) -> Any:
    """GET a DNSE endpoint and return decoded JSON; raises ``ProviderError`` otherwise."""
    key, secret = _credentials()
    query = {name: value for name, value in (params or {}).items() if value is not None}
    url = f"{DNSE_BASE_URL}{path}" + (f"?{urllib.parse.urlencode(query)}" if query else "")
    try:
        async with httpx.AsyncClient(timeout=DNSE_TIMEOUT_SECONDS) as client:
            response = await client.get(url, headers=_signed_headers(key, secret, "GET", path))
    except httpx.HTTPError as exc:
        # Keep only the exception type: an httpx error renders the full request
        # URL, and `from exc` would keep that reachable through __cause__ in a
        # standard traceback. Same for a JSON decode error, whose message quotes
        # the offending body text verbatim.
        raise ProviderError(
            f"DNSE request failed for {path} ({type(exc).__name__})", "dnse"
        ) from None
    if response.status_code != 200:
        raise _status_error(path, response)
    try:
        return response.json()
    except ValueError:
        raise ProviderError(f"DNSE {path} returned a non-JSON body", "dnse") from None


def parse_ohlc(payload: Any, *, price_unit: str) -> list[dict[str, Any]]:
    """Map a DNSE OHLC columnar payload to row dicts in the given unit.

    DNSE returns parallel arrays keyed t/o/h/l/c/v with ``t`` in epoch seconds
    at 09:00 ICT, i.e. the session date. Nothing is rescaled here beyond the
    caller-declared unit, so a mis-declared unit cannot masquerade as VND.

    Shape is checked before indexing: a short or missing column is a provider
    contract violation and raises ``ProviderError``, never an ``IndexError``.
    """
    if not isinstance(payload, dict):
        raise ProviderError("DNSE OHLC payload is not an object", "dnse")
    times = payload.get("t")
    times = [] if times is None else times
    if not isinstance(times, list):
        raise ProviderError("DNSE OHLC 't' column is not a list", "dnse")
    columns: dict[str, list[Any]] = {}
    for name in _OHLC_SERIES:
        values = payload.get(name)
        values = [] if values is None else values
        if not isinstance(values, list):
            raise ProviderError(f"DNSE OHLC '{name}' column is not a list", "dnse")
        if len(values) != len(times):
            raise ProviderError(
                f"DNSE OHLC columns disagree: 't' has {len(times)} rows, "
                f"'{name}' has {len(values)}",
                "dnse",
            )
        columns[name] = values
    rows: list[dict[str, Any]] = []
    for index, stamp in enumerate(times):
        # Anything wrong with one row is a provider contract violation reported as
        # ProviderError: OverflowError (t = 10**100), OSError (out-of-range epoch),
        # a non-finite price, or a non-numeric cell must not abort the whole run as
        # an uncaught TypeError/IndexError/OverflowError.
        try:
            session = datetime.fromtimestamp(int(stamp), UTC).date()
            open_, high, low, close = (float(columns[name][index]) for name in ("o", "h", "l", "c"))
        except (TypeError, ValueError, OverflowError, OSError):
            raise ProviderError(f"DNSE OHLC row {index} is not numeric", "dnse") from None
        if not all(isfinite(value) for value in (open_, high, low, close)):
            raise ProviderError(f"DNSE OHLC row {index} has a non-finite price", "dnse")
        raw_volume = columns["v"][index]
        # A missing cell is not observed zero volume: reject it, so "OHLCV is
        # never synthesised" stays true for the volume column too.
        if raw_volume is None or raw_volume == "":
            raise ProviderError(f"DNSE OHLC row {index} has no volume", "dnse")
        try:
            volume = int(raw_volume)
        except (TypeError, ValueError, OverflowError):
            raise ProviderError(f"DNSE OHLC row {index} has a non-integer volume", "dnse") from None
        if volume < 0:
            raise ProviderError(f"DNSE OHLC row {index} has a negative volume", "dnse")
        rows.append({
            "time": session,
            "open": open_,
            "high": high,
            "low": low,
            "close": close,
            "volume": volume,
            "price_unit": price_unit,
            "price_source": "dnse",
        })
    return rows


async def fetch_daily_bars(
    symbol: str, start: str, end: str, *, asset_type: str = "stock"
) -> list[dict[str, Any]]:
    """Daily OHLC rows for ``symbol``; prices stay in DNSE's thousand-VND unit."""
    payload = await dnse_get(
        "/price/ohlc",
        {"type": asset_type, "symbol": symbol.upper(), "resolution": "1D", "from": start, "to": end},
    )
    return parse_ohlc(payload, price_unit="THOUSAND_VND")
