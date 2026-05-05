"""
Custom exceptions for VNIBB application.

Provides a hierarchy of exceptions for error handling across
providers, API endpoints, and services.
"""

from typing import Any, Optional


class VniBBException(Exception):
    """Base exception for all VNIBB errors."""
    
    def __init__(
        self,
        message: str,
        code: str = "VNIBB_ERROR",
        details: Optional[dict[str, Any]] = None,
    ):
        self.message = message
        self.code = code
        self.details = details or {}
        super().__init__(self.message)
    
    def to_dict(self) -> dict[str, Any]:
        """Convert exception to dictionary for API response."""
        return {
            "error": True,
            "code": self.code,
            "message": self.message,
            "details": self.details,
        }


# Provider Errors
class ProviderError(VniBBException):
    """Base exception for data provider failures."""
    
    def __init__(
        self,
        message: str,
        provider: str,
        details: Optional[dict[str, Any]] = None,
    ):
        super().__init__(
            message=message,
            code="PROVIDER_ERROR",
            details={"provider": provider, **(details or {})},
        )
        self.provider = provider


class ProviderTimeoutError(ProviderError):
    """Provider request timed out."""
    
    def __init__(self, provider: str, timeout: int):
        super().__init__(
            message=f"Provider {provider} timed out after {timeout}s",
            provider=provider,
            details={"timeout": timeout},
        )
        self.code = "PROVIDER_TIMEOUT"


class ProviderRateLimitError(ProviderError):
    """Provider rate limit exceeded."""
    
    def __init__(self, provider: str, retry_after: Optional[int] = 60):
        super().__init__(
            message=f"Rate limit exceeded for provider {provider}",
            provider=provider,
            details={"retry_after": retry_after},
        )
        self.code = "PROVIDER_RATE_LIMIT"
        self.retry_after = retry_after



class ProviderAuthError(ProviderError):
    """Provider authentication failed."""
    
    def __init__(self, provider: str):
        super().__init__(
            message=f"Authentication failed for provider {provider}",
            provider=provider,
        )
        self.code = "PROVIDER_AUTH_ERROR"


# Data Errors
class DataNotFoundError(VniBBException):
    """Requested data not found from any source."""
    
    def __init__(
        self,
        resource_type: str,
        identifier: str,
        details: Optional[dict[str, Any]] = None,
    ):
        super().__init__(
            message=f"{resource_type} not found: {identifier}",
            code="DATA_NOT_FOUND",
            details={"resource_type": resource_type, "identifier": identifier, **(details or {})},
        )


class DataValidationError(VniBBException):
    """Data failed validation checks."""
    
    def __init__(self, message: str, field: Optional[str] = None):
        super().__init__(
            message=message,
            code="DATA_VALIDATION_ERROR",
            details={"field": field} if field else {},
        )


class StaleDataError(VniBBException):
    """Only stale/cached data available."""
    
    def __init__(self, resource: str, age_seconds: int):
        super().__init__(
            message=f"Only stale data available for {resource}, age: {age_seconds}s",
            code="STALE_DATA",
            details={"resource": resource, "age_seconds": age_seconds},
        )


# Database Errors
class DatabaseError(VniBBException):
    """Database operation failed."""
    
    def __init__(self, message: str, operation: Optional[str] = None):
        super().__init__(
            message=message,
            code="DATABASE_ERROR",
            details={"operation": operation} if operation else {},
        )


class CacheError(VniBBException):
    """Cache operation failed."""
    
    def __init__(self, message: str, key: Optional[str] = None):
        super().__init__(
            message=message,
            code="CACHE_ERROR",
            details={"key": key} if key else {},
        )


# API Errors
class InvalidParameterError(VniBBException):
    """Invalid API parameter provided."""
    
    def __init__(self, parameter: str, reason: str):
        super().__init__(
            message=f"Invalid parameter '{parameter}': {reason}",
            code="INVALID_PARAMETER",
            details={"parameter": parameter, "reason": reason},
        )


class ResourceNotFoundError(VniBBException):
    """API resource not found."""
    
    def __init__(self, resource: str, identifier: str):
        super().__init__(
            message=f"Resource not found: {resource}/{identifier}",
            code="RESOURCE_NOT_FOUND",
            details={"resource": resource, "identifier": identifier},
        )
