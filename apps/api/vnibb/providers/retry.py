"""
Retry Logic Utilities for External API Providers.

Provides:
- Tenacity-based retry decorators
- Exponential backoff configuration
- Provider-specific retry policies
- Clear error handling
"""

import logging
from functools import wraps
from typing import Callable, Optional, TypeVar, Any

from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
    retry_if_exception,
    before_sleep_log,
    after_log,
)

from vnibb.core.exceptions import (
    ProviderError,
    ProviderTimeoutError,
    ProviderRateLimitError,
)

logger = logging.getLogger(__name__)

T = TypeVar("T")


def is_retryable_error(exception: Exception) -> bool:
    """
    Determine if an exception should trigger a retry.
    
    Retryable errors:
    - Connection errors
    - Timeout errors
    - Temporary server errors (500, 502, 503, 504)
    
    Non-retryable errors:
    - Rate limiting (needs backoff, not retry)
    - Authentication errors (401, 403)
    - Not found errors (404)
    - Validation errors (400, 422)
    """
    import httpx
    import requests
    
    # Check HTTP client exceptions
    if isinstance(exception, (httpx.ConnectError, httpx.TimeoutException)):
        return True
    
    if isinstance(exception, (requests.ConnectionError, requests.Timeout)):
        return True
    
    # Check provider exceptions
    if isinstance(exception, ProviderTimeoutError):
        return True
    
    if isinstance(exception, ProviderRateLimitError):
        # Rate limit errors should not be retried with standard backoff
        return False
    
    # Check HTTP status codes
    if isinstance(exception, httpx.HTTPStatusError):
        status = exception.response.status_code
        # Retry on temporary server errors
        return status in (500, 502, 503, 504)
    
    if isinstance(exception, requests.HTTPError):
        if hasattr(exception, "response") and exception.response:
            status = exception.response.status_code
            return status in (500, 502, 503, 504)
    
    # Check error messages for common transient errors
    error_msg = str(exception).lower()
    transient_keywords = [
        "connection",
        "timeout",
        "temporary",
        "unavailable",
        "network",
    ]
    return any(keyword in error_msg for keyword in transient_keywords)


def vnstock_retry(
    max_attempts: int = 3,
    min_wait: float = 1.0,
    max_wait: float = 10.0,
    multiplier: float = 2.0,
):
    """
    Retry decorator for VnStock API calls.
    
    Configuration:
    - 3 retries with exponential backoff (1s, 2s, 4s)
    - Retries on connection errors and timeouts
    - Does not retry on rate limiting or client errors
    
    Args:
        max_attempts: Maximum number of retry attempts
        min_wait: Minimum wait time between retries (seconds)
        max_wait: Maximum wait time between retries (seconds)
        multiplier: Exponential backoff multiplier
    
    Usage:
        @vnstock_retry()
        async def fetch_data():
            # API call that may fail
            pass
    """
    return retry(
        retry=retry_if_exception(is_retryable_error),
        stop=stop_after_attempt(max_attempts),
        wait=wait_exponential(
            multiplier=multiplier,
            min=min_wait,
            max=max_wait,
        ),
        before_sleep=before_sleep_log(logger, logging.WARNING),
        after=after_log(logger, logging.INFO),
        reraise=True,
    )


def provider_retry(
    provider_name: str,
    max_attempts: int = 3,
    min_wait: float = 1.0,
    max_wait: float = 10.0,
):
    """
    Generic retry decorator for any provider.
    
    Args:
        provider_name: Name of the provider (for logging)
        max_attempts: Maximum number of retry attempts
        min_wait: Minimum wait time between retries (seconds)
        max_wait: Maximum wait time between retries (seconds)
    
    Usage:
        @provider_retry("CafeF")
        async def fetch_news():
            # API call
            pass
    """
    return retry(
        retry=retry_if_exception(is_retryable_error),
        stop=stop_after_attempt(max_attempts),
        wait=wait_exponential(
            multiplier=2.0,
            min=min_wait,
            max=max_wait,
        ),
        before_sleep=before_sleep_log(
            logger,
            logging.WARNING,
            exc_info=False,
        ),
        reraise=True,
    )


class RetryConfig:
    """Configuration for provider retry policies."""
    
    # Default retry configuration
    DEFAULT_MAX_ATTEMPTS = 3
    DEFAULT_MIN_WAIT = 1.0  # seconds
    DEFAULT_MAX_WAIT = 10.0  # seconds
    
    # Per-provider configurations
    PROVIDER_CONFIGS = {
        "vnstock": {
            "max_attempts": 3,
            "min_wait": 1.0,
            "max_wait": 8.0,
        },
        "cafef": {
            "max_attempts": 2,
            "min_wait": 0.5,
            "max_wait": 4.0,
        },
        "vietstock": {
            "max_attempts": 2,
            "min_wait": 1.0,
            "max_wait": 5.0,
        },
    }
    
    @classmethod
    def get_config(cls, provider: str) -> dict:
        """Get retry configuration for a specific provider."""
        return cls.PROVIDER_CONFIGS.get(
            provider.lower(),
            {
                "max_attempts": cls.DEFAULT_MAX_ATTEMPTS,
                "min_wait": cls.DEFAULT_MIN_WAIT,
                "max_wait": cls.DEFAULT_MAX_WAIT,
            }
        )


def with_retry(provider: str = "default"):
    """
    Decorator factory for adding retry logic to async functions.
    
    Args:
        provider: Provider name for loading specific retry configuration
    
    Example:
        @with_retry("vnstock")
        async def fetch_equity_data(symbol: str):
            # API call that may fail
            return data
    """
    config = RetryConfig.get_config(provider)
    
    return retry(
        retry=retry_if_exception(is_retryable_error),
        stop=stop_after_attempt(config["max_attempts"]),
        wait=wait_exponential(
            multiplier=2.0,
            min=config["min_wait"],
            max=config["max_wait"],
        ),
        before_sleep=before_sleep_log(logger, logging.WARNING),
        reraise=True,
    )
