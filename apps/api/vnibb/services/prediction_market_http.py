"""Resilient async HTTP helpers for prediction-market ingest.

The public Polymarket / Kalshi / PredictIt / Limitless / Manifold APIs
sometimes return non-JSON (rate-limited 4xx, captive-portal redirects,
etc.). Centralising retry + content-type validation here keeps each
ingest service thin and makes failure modes uniform.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from typing import Any, Final

import httpx

from vnibb.services.prediction_market_policy import MAX_MARKET_PAYLOAD_BYTES

logger = logging.getLogger(__name__)


PREDICTION_MARKET_RETRY_ATTEMPTS: Final = 3
PREDICTION_MARKET_RETRY_BACKOFF_SECONDS: Final = 2.0
#: A provider telling us to wait hours (Cloudflare sends 86400) must never
#: stall an ingest cycle, so Retry-After is clamped to this bound.
PREDICTION_MARKET_MAX_RETRY_AFTER_SECONDS: Final = 60.0


class PredictionMarketFetchError(RuntimeError):
    """Raised when an ingest fetch fails after retries."""

    def __init__(self, source: str, status: int | None, message: str) -> None:
        self.source = source
        self.status = status
        super().__init__(f"{source}: {message} (status={status})")


def _response_status(exc: BaseException | None) -> int | None:
    """Extract the provider's HTTP status from whichever error we captured."""
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code
    if isinstance(exc, PredictionMarketFetchError):
        return exc.status
    status = getattr(exc, "status_code", None)
    return status if isinstance(status, int) else None


def _retry_after_seconds(response: httpx.Response, fallback: float) -> float:
    """Parse ``Retry-After`` as delta-seconds or an HTTP date, else fall back."""
    raw = (response.headers.get("Retry-After") or "").strip()
    parsed: float | None = None
    if raw:
        try:
            parsed = max(0.0, float(raw))
        except ValueError:
            try:
                retry_at = parsedate_to_datetime(raw)
            except (TypeError, ValueError):
                retry_at = None
            if retry_at is not None:
                if retry_at.tzinfo is None:
                    retry_at = retry_at.replace(tzinfo=UTC)
                parsed = max(0.0, (retry_at - datetime.now(UTC)).total_seconds())
    if parsed is None:
        return fallback
    return min(parsed, PREDICTION_MARKET_MAX_RETRY_AFTER_SECONDS)


async def fetch_json_with_retry(
    client: httpx.AsyncClient,
    source: str,
    url: str,
    *,
    params: dict[str, Any] | None = None,
    attempts: int = PREDICTION_MARKET_RETRY_ATTEMPTS,
    backoff: float = PREDICTION_MARKET_RETRY_BACKOFF_SECONDS,
) -> list[Any] | dict[str, Any]:
    """GET a JSON payload with retries + content-type validation.

    Returns the parsed JSON. The caller decides whether it's a list or dict.
    Raises :class:`PredictionMarketFetchError` after ``attempts`` failures,
    preserving the provider's real HTTP status so a genuine 403/404 is never
    reported as a generic transport error.
    """
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            response = await client.get(url, params=params)
            if response.status_code == 429:
                # Honour Retry-After (seconds or HTTP date) when the upstream sets one.
                retry_after = _retry_after_seconds(response, backoff * attempt)
                last_error = PredictionMarketFetchError(
                    source, response.status_code, f"rate limited for {retry_after:.0f}s"
                )
                logger.warning(
                    "%s returned 429; sleeping %.1fs before retry %d/%d",
                    source, retry_after, attempt, attempts,
                )
                if attempt < attempts:
                    await asyncio.sleep(retry_after)
                continue
            response.raise_for_status()
            if len(response.content) > MAX_MARKET_PAYLOAD_BYTES:
                raise PredictionMarketFetchError(
                    source, response.status_code, "response exceeds ingest byte limit"
                )
            content_type = response.headers.get("content-type", "").lower()
            if "json" not in content_type and "text/plain" not in content_type:
                raise PredictionMarketFetchError(
                    source,
                    response.status_code,
                    f"unexpected content-type={content_type!r}",
                )
            try:
                return response.json()
            except ValueError as exc:
                raise PredictionMarketFetchError(
                    source, response.status_code, f"response body is not JSON: {exc}"
                ) from exc
        except (httpx.HTTPError, PredictionMarketFetchError) as exc:
            last_error = exc
            logger.warning(
                "%s attempt %d/%d failed: %s",
                source, attempt, attempts, exc,
            )
            if attempt < attempts:
                await asyncio.sleep(backoff * attempt)
                continue
            break
    raise PredictionMarketFetchError(
        source,
        _response_status(last_error),
        str(last_error) if last_error else "unknown",
    )
