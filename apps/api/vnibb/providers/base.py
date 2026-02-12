"""
Base Fetcher Pattern - Following OpenBB Platform v4+ Architecture.

The Fetcher pattern standardizes data retrieval across providers:
1. transform_query: Convert Pydantic params to provider-specific format
2. extract_data: Fetch raw data from upstream source
3. transform_data: Convert raw response to standardized Pydantic models

This pattern ensures:
- Type safety through generics
- Consistent interface across all data providers
- Easy fallback/retry logic at the fetch level
"""

from abc import ABC, abstractmethod
import logging
import time
from typing import Any, Generic, List, Optional, TypeVar

from pydantic import BaseModel

QueryT = TypeVar("QueryT", bound=BaseModel)
DataT = TypeVar("DataT", bound=BaseModel)

logger = logging.getLogger(__name__)
_LOG_THROTTLE_SECONDS = 60.0
_last_log_times: dict[tuple[str, str], float] = {}


def _log_throttled(level: int, key: tuple[str, str], message: str, *args: Any) -> None:
    now = time.monotonic()
    last = _last_log_times.get(key)
    if last is not None and (now - last) < _LOG_THROTTLE_SECONDS:
        return
    _last_log_times[key] = now
    logger.log(level, message, *args)


class BaseFetcher(ABC, Generic[QueryT, DataT]):
    """
    Abstract base class implementing the OpenBB Fetcher pattern.

    All data providers (vnstock, scrapers) must extend this class
    and implement the three transformation methods.

    Type Parameters:
        QueryT: Pydantic model for query parameters
        DataT: Pydantic model for response data

    Example:
        class VnstockHistoricalFetcher(BaseFetcher[HistoricalQuery, OHLCVData]):
            @staticmethod
            def transform_query(params: HistoricalQuery) -> dict:
                return {"symbol": params.symbol.upper(), ...}

            @staticmethod
            async def extract_data(query: dict, credentials=None) -> List[dict]:
                # Call vnstock API
                return [...raw data...]

            @staticmethod
            def transform_data(params: HistoricalQuery, data: List[dict]) -> List[OHLCVData]:
                return [OHLCVData(**row) for row in data]
    """

    # Provider identifier (e.g., "vnstock", "cophieu68")
    provider_name: str = "base"

    # Whether this provider requires authentication
    requires_credentials: bool = False

    @staticmethod
    @abstractmethod
    def transform_query(params: QueryT) -> dict[str, Any]:
        """
        Transform Pydantic query parameters to provider-specific format.

        This method handles:
        - Field name mapping (e.g., start_date -> start)
        - Value transformations (e.g., date to string)
        - Default value injection

        Args:
            params: Validated Pydantic query parameters

        Returns:
            Dictionary suitable for the upstream API call
        """
        pass

    @staticmethod
    @abstractmethod
    async def extract_data(
        query: dict[str, Any],
        credentials: Optional[dict[str, str]] = None,
    ) -> List[dict[str, Any]]:
        """
        Fetch raw data from the upstream data source.

        This method:
        - Makes the actual API call or scrape
        - Handles pagination if needed
        - Returns raw data without transformation

        Args:
            query: Provider-specific query dictionary (from transform_query)
            credentials: Optional authentication credentials

        Returns:
            List of raw data dictionaries from the provider

        Raises:
            ProviderError: If the data fetch fails
        """
        pass

    @staticmethod
    @abstractmethod
    def transform_data(
        params: QueryT,
        data: List[dict[str, Any]],
    ) -> List[DataT]:
        """
        Transform raw API response to standardized Pydantic models.

        This method:
        - Maps provider field names to standard schema
        - Validates and coerces data types
        - Filters out invalid records

        Args:
            params: Original query parameters (for context)
            data: Raw data from extract_data

        Returns:
            List of validated Pydantic data models
        """
        pass

    @classmethod
    async def fetch(
        cls,
        params: QueryT,
        credentials: Optional[dict[str, str]] = None,
    ) -> List[DataT]:
        """
        Main entry point: orchestrates the full fetch pipeline with error handling.
        """
        try:
            # Step 1: Transform query parameters
            query = cls.transform_query(params)

            # Step 2: Extract raw data from provider
            raw_data = await cls.extract_data(query, credentials)

            if not raw_data:
                return []

            # Step 3: Transform to standardized models
            return cls.transform_data(params, raw_data)
        except SystemExit as e:
            _log_throttled(
                logging.WARNING,
                (cls.__name__, "system_exit"),
                "Graceful degradation: %s aborted: %s",
                cls.__name__,
                e,
            )
            return []
        except RuntimeError as e:
            if "Circuit breaker is OPEN" in str(e):
                _log_throttled(
                    logging.INFO,
                    (cls.__name__, "circuit_open"),
                    "Graceful degradation: %s skipped by circuit breaker",
                    cls.__name__,
                )
            else:
                _log_throttled(
                    logging.WARNING,
                    (cls.__name__, f"runtime:{type(e).__name__}:{str(e)[:80]}"),
                    "Graceful degradation: %s runtime failure: %s",
                    cls.__name__,
                    e,
                )
            return []
        except Exception as e:
            # Phase 50: Graceful degradation - log and return empty instead of 502/500
            _log_throttled(
                logging.WARNING,
                (cls.__name__, f"exception:{type(e).__name__}:{str(e)[:80]}"),
                "Graceful degradation: %s failed: %s",
                cls.__name__,
                e,
            )
            return []

    @classmethod
    def get_provider_info(cls) -> dict[str, Any]:
        """Return metadata about this provider."""
        return {
            "name": cls.provider_name,
            "requires_credentials": cls.requires_credentials,
            "fetcher_class": cls.__name__,
        }
