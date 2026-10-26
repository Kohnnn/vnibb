"""Read-only HTTP client for Vietcap public endpoints.

Implements the safe-usage guidance from the endpoint evaluation report:
- browser-like headers (UA + referer + origin)
- global ~1 request/second rate limit
- exponential backoff on 403 / 429 / 5xx
- simple circuit breaker after repeated consecutive failures

No authentication is used or required for the market/fundamental endpoints
covered here.
"""

from __future__ import annotations

import threading
import time
from datetime import UTC, datetime
from typing import Any

import requests

TRADING_BASE = "https://trading.vietcap.com.vn"
IQ_BASE = "https://iq.vietcap.com.vn/api/iq-insight-service"

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0 Safari/537.36"
)


class CircuitOpenError(RuntimeError):
    """Raised when too many consecutive failures trip the breaker."""


class VietcapClient:
    """Thin, polite HTTP client for Vietcap public APIs."""

    def __init__(
        self,
        *,
        min_interval_seconds: float = 1.0,
        max_retries: int = 4,
        backoff_base_seconds: float = 1.5,
        timeout_seconds: float = 30.0,
        circuit_breaker_threshold: int = 8,
    ) -> None:
        self._min_interval = max(0.0, min_interval_seconds)
        self._max_retries = max(0, max_retries)
        self._backoff_base = max(1.0, backoff_base_seconds)
        self._timeout = timeout_seconds
        self._cb_threshold = max(1, circuit_breaker_threshold)
        self._consecutive_failures = 0
        self._last_request_at = 0.0
        self._lock = threading.Lock()
        self._session = requests.Session()
        self.response_metadata: dict[str, dict[str, Any]] = {}

    # -- internal helpers --------------------------------------------------

    def _throttle(self) -> None:
        with self._lock:
            now = time.monotonic()
            wait = self._min_interval - (now - self._last_request_at)
            if wait > 0:
                time.sleep(wait)
            self._last_request_at = time.monotonic()

    def _headers(self, base: str) -> dict[str, str]:
        headers = {
            "user-agent": _UA,
            "accept": "application/json, text/plain, */*",
            "referer": "https://trading.vietcap.com.vn/",
            "origin": "https://trading.vietcap.com.vn",
        }
        return headers

    def _request(self, method: str, url: str, base: str, *, json_body: Any | None = None) -> Any:
        if self._consecutive_failures >= self._cb_threshold:
            raise CircuitOpenError(
                f"Circuit open after {self._consecutive_failures} consecutive failures"
            )

        last_exc: Exception | None = None
        for attempt in range(self._max_retries + 1):
            self._throttle()
            try:
                resp = self._session.request(
                    method,
                    url,
                    headers=self._headers(base),
                    json=json_body,
                    timeout=self._timeout,
                )
                if resp.status_code in (403, 429) or resp.status_code >= 500:
                    raise requests.HTTPError(f"HTTP {resp.status_code}", response=resp)
                resp.raise_for_status()
                self._consecutive_failures = 0
                if not resp.content:
                    return None
                payload = resp.json()
                if isinstance(payload, dict):
                    self.response_metadata[url] = {key: value for key, value in payload.items() if key != "data"}
                    self.response_metadata[url]["receivedAt"] = datetime.now(UTC).replace(tzinfo=None)
                return payload
            except Exception as exc:  # noqa: BLE001 - retried below
                last_exc = exc
                if attempt < self._max_retries:
                    time.sleep(self._backoff_base ** (attempt + 1))
                else:
                    self._consecutive_failures += 1
        raise RuntimeError(f"Request failed after retries: {method} {url}: {last_exc}")

    @staticmethod
    def _unwrap(payload: Any) -> Any:
        """Reject IQ application failures even when HTTP returned 200."""
        if not isinstance(payload, dict):
            return payload
        failed = payload.get("successful") is False or payload.get("success") is False
        status = str(payload.get("status") or "").upper()
        code = payload.get("code")
        failed = failed or status in {"ERROR", "FAILED", "FAILURE"}
        failed = failed or (status.isdigit() and int(status) >= 400) or payload.get("exception") is not None
        if code is not None and str(code) not in {"0", "200"}:
            failed = True
        if failed:
            raise RuntimeError(f"Vietcap API failure: {payload.get('message') or payload.get('msg') or payload.get('error') or payload}")
        if "data" in payload and any(key in payload for key in ("successful", "success", "status", "code")):
            return payload["data"]
        return payload

    # -- trading.vietcap.com.vn (market data) ------------------------------

    def get_all_symbols(self) -> list[dict[str, Any]]:
        url = f"{TRADING_BASE}/api/price/symbols/getAll"
        data = self._request("GET", url, TRADING_BASE)
        return data if isinstance(data, list) else []

    def get_symbols_by_group(self, group: str) -> list[dict[str, Any]]:
        url = f"{TRADING_BASE}/api/price/symbols/getByGroup?group={group}"
        data = self._request("GET", url, TRADING_BASE)
        return data if isinstance(data, list) else []

    def get_price_board(self, symbols: list[str]) -> list[dict]:
        if not isinstance(symbols, list) or any(not isinstance(symbol, str) or not symbol.strip() for symbol in symbols):
            raise ValueError("Price board symbols must be nonempty strings")
        requested = list(dict.fromkeys(symbol.strip().upper() for symbol in symbols))
        if not requested:
            return []
        url = f"{TRADING_BASE}/api/price/symbols/getList"
        rows = self._request("POST", url, TRADING_BASE, json_body={"symbols": requested})
        if not isinstance(rows, list):
            raise ValueError("Invalid price board response")
        returned = []
        for row in rows:
            listing = row.get("listingInfo") if isinstance(row, dict) else None
            symbol = listing.get("symbol") if isinstance(listing, dict) else None
            if not isinstance(symbol, str) or symbol not in requested:
                raise ValueError("Price board source symbol missing or unexpected")
            returned.append(symbol)
        if len(returned) != len(set(returned)) or set(returned) != set(requested):
            raise ValueError("Price board source membership is duplicate or incomplete")
        return rows

    def get_ohlc(self, symbol: str, *, count_back: int = 10000, to_epoch: int | None = None) -> dict[str, Any] | None:
        """Return the raw gap-chart row for one symbol (parallel o/h/l/c/v/t arrays)."""
        url = f"{TRADING_BASE}/api/chart/OHLCChart/gap-chart"
        body = {
            "timeFrame": "ONE_DAY",
            "symbols": [symbol.upper()],
            "to": to_epoch if to_epoch is not None else int(time.time()),
            "countBack": count_back,
        }
        data = self._request("POST", url, TRADING_BASE, json_body=body)
        if isinstance(data, list) and data:
            row = data[0]
            if not isinstance(row, dict) or not isinstance(row.get("symbol"), str) or row["symbol"].upper() != symbol.upper():
                raise ValueError("OHLC source symbol missing or mismatched")
            return row
        return None

    # -- iq.vietcap.com.vn (company / fundamentals) ------------------------

    def get_company_search_bar(self, *, language: int = 1) -> list[dict[str, Any]]:
        url = f"{IQ_BASE}/v2/company/search-bar?language={language}"
        data = self._unwrap(self._request("GET", url, IQ_BASE))
        return data if isinstance(data, list) else []

    def get_icb_codes(self) -> list[dict[str, Any]]:
        url = f"{IQ_BASE}/v1/sectors/icb-codes"
        data = self._unwrap(self._request("GET", url, IQ_BASE))
        return data if isinstance(data, list) else []

    def get_market_indices(self) -> list[dict[str, Any]]:
        url = f"{IQ_BASE}/v1/market-indices"
        data = self._unwrap(self._request("GET", url, IQ_BASE))
        return data if isinstance(data, list) else []

    def get_company_details(self, symbol: str) -> dict[str, Any] | None:
        url = f"{IQ_BASE}/v1/company/details?ticker={symbol.upper()}"
        payload = self._request("GET", url, IQ_BASE)
        data = self._unwrap(payload)
        envelope = isinstance(payload, dict) and any(key in payload for key in ("data", "successful", "success", "status", "code"))
        if (envelope and ("data" not in payload or data is payload)) or (data is not None and not isinstance(data, dict)):
            raise ValueError(f"Invalid company details response for {symbol}")
        return data

    def get_shareholder_structure(self, symbol: str) -> dict[str, Any] | None:
        url = f"{IQ_BASE}/v1/company/{symbol.upper()}/shareholder-structure"
        payload = self._request("GET", url, IQ_BASE)
        data = self._unwrap(payload)
        envelope = isinstance(payload, dict) and any(key in payload for key in ("data", "successful", "success", "status", "code"))
        if (envelope and ("data" not in payload or data is payload)) or (data is not None and not isinstance(data, dict)):
            raise ValueError(f"Invalid shareholder structure response for {symbol}")
        return data

    def get_financial_metrics_map(self, symbol: str) -> dict[str, list[dict[str, Any]]]:
        """Return code->label maps keyed by section (INCOME_STATEMENT/BALANCE_SHEET/CASH_FLOW/NOTE)."""
        url = f"{IQ_BASE}/v1/company/{symbol.upper()}/financial-statement/metrics"
        data = self._unwrap(self._request("GET", url, IQ_BASE))
        return data if isinstance(data, dict) else {}

    def get_financial_statement(self, symbol: str, section: str) -> dict[str, Any] | None:
        """section in {INCOME_STATEMENT, BALANCE_SHEET, CASH_FLOW}. Returns {years:[], quarters:[]}."""
        url = f"{IQ_BASE}/v1/company/{symbol.upper()}/financial-statement?section={section}"
        data = self._unwrap(self._request("GET", url, IQ_BASE))
        return data if isinstance(data, dict) else None

    def get_statistics_financial(self, symbol: str) -> list[dict[str, Any]]:
        """Return per-period ratio rows (pe/pb/roe/roa/margins/EV-EBITDA...)."""
        url = f"{IQ_BASE}/v1/company/{symbol.upper()}/statistics-financial"
        data = self._unwrap(self._request("GET", url, IQ_BASE))
        return data if isinstance(data, list) else []
