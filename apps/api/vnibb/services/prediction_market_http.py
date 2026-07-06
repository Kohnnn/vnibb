"""Resilient async HTTP helpers for prediction-market ingest.

The public Polymarket / Kalshi / PredictIt / Limitless / Manifold APIs
sometimes return non-JSON (rate-limited 4xx, captive-portal redirects,
etc.). Centralising retry + content-type validation here keeps each
ingest service thin and makes failure modes uniform.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Final

import httpx

logger = logging.getLogger(__name__)


PREDICTION_MARKET_RETRY_ATTEMPTS: Final = 3
PREDICTION_MARKET_RETRY_BACKOFF_SECONDS: Final = 2.0


class PredictionMarketFetchError(RuntimeError):
    """Raised when an ingest fetch fails after retries."""

    def __init__(self, source: str, status: int | None, message: str) -> None:
        self.source = source
        self.status = status
        super().__init__(f"{source}: {message} (status={status})")


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
    Raises :class:`PredictionMarketFetchError` after ``attempts`` failures.
    """
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            response = await client.get(url, params=params)
            if response.status_code == 429:
                # Honour Retry-After if the upstream sets one.
                retry_after = float(response.headers.get("Retry-After", backoff * attempt))
                logger.warning(
                    "%s returned 429; sleeping %.1fs before retry %d/%d",
                    source, retry_after, attempt, attempts,
                )
                await asyncio.sleep(retry_after)
                continue
            response.raise_for_status()
            content_type = response.headers.get("content-type", "").lower()
            if "json" not in content_type and "text/plain" not in content_type:
                raise PredictionMarketFetchError(
                    source,
                    response.status_code,
                    f"unexpected content-type={content_type!r}",
                )
            return response.json()
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
        getattr(last_error, "status_code", None) if isinstance(last_error, httpx.HTTPError) else None,
        str(last_error) if last_error else "unknown",
    )