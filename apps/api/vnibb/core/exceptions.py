"""
Exception System - Consolidated error handling for VNIBB

This module provides a unified exception hierarchy for the application.
"""

from typing import Optional, Any


class VniBBException(Exception):
    """Base exception for all VNIBB errors."""
    
    def __init__(
        self,
        message: str,
        code: Optional[str] = None,
        details: Optional[dict[str, Any]] = None,
    ):
        super().__init__(message)
        self.message = message
        self.code = code or "VNIBB_ERROR"
        self.details = details or {}
    
    def to_dict(self) -> dict[str, Any]:
        return {
            "message": self.message,
            "code": self.code,
            "details": self.details,
        }


# ============================================================================
# Provider Errors
# ============================================================================

class ProviderError(VniBBException):
    """Base exception for data provider errors."""
    
    def __init__(
        self,
        message: str,
        provider: str,
        cause: Optional[Exception] = None,
        **kwargs,
    ):
        super().__init__(message, code=f"PROVIDER_{provider.upper()}_ERROR", **kwargs)
        self.provider = provider
        self.cause = cause


class ProviderTimeoutError(ProviderError):
    """Provider request timed out."""
    
    def __init__(self, provider: str, timeout_seconds: int, **kwargs):
        super().__init__(
            message=f"Provider {provider} request timed out after {timeout_seconds}s",
            provider=provider,
            **kwargs,
        )
        self.timeout_seconds = timeout_seconds
        self.code = f"PROVIDER_{provider.upper()}_TIMEOUT"


class ProviderRateLimitError(ProviderError):
    """Provider rate limit exceeded."""
    
    def __init__(
        self,
        provider: str,
        retry_after_seconds: Optional[int] = None,
        **kwargs,
    ):
        super().__init__(
            message=f"Provider {provider} rate limit exceeded",
            provider=provider,
            **kwargs,
        )
        self.retry_after_seconds = retry_after_seconds
        self.code = f"PROVIDER_{provider.upper()}_RATE_LIMIT"


class ProviderAuthError(ProviderError):
    """Provider authentication failed."""
    
    def __init__(self, provider: str, reason: str, **kwargs):
        super().__init__(
            message=f"Provider {provider} authentication failed: {reason}",
            provider=provider,
            **kwargs,
        )
        self.reason = reason
        self.code = f"PROVIDER_{provider.upper()}_AUTH_ERROR"


class ProviderNotFoundError(ProviderError):
    """Provider returned 404."""
    
    def __init__(self, provider: str, resource: str, **kwargs):
        super().__init__(
            message=f"Provider {provider} resource not found: {resource}",
            provider=provider,
            **kwargs,
        )
        self.resource = resource
        self.code = f"PROVIDER_{provider.upper()}_NOT_FOUND"


# ============================================================================
# Data Errors
# ============================================================================

class DataError(VniBBException):
    """Base exception for data-related errors."""
    
    def __init__(self, message: str, symbol: Optional[str] = None, **kwargs):
        super().__init__(message, code="DATA_ERROR", **kwargs)
        self.symbol = symbol


class DataNotFoundError(DataError):
    """Requested data was not found."""
    
    def __init__(self, resource: str, identifier: str, symbol: Optional[str] = None, **kwargs):
        super().__init__(
            message=f"{resource} not found: {identifier}",
            symbol=symbol,
            **kwargs,
        )
        self.resource = resource
        self.identifier = identifier
        self.code = "DATA_NOT_FOUND"


class DataValidationError(DataError):
    """Data validation failed."""
    
    def __init__(self, message: str, field: Optional[str] = None, symbol: Optional[str] = None, **kwargs):
        super().__init__(message, symbol=symbol, **kwargs)
        self.field = field
        self.code = "DATA_VALIDATION_ERROR"


class DataStaleError(DataError):
    """Data is stale or outdated."""
    
    def __init__(
        self,
        symbol: str,
        age_hours: float,
        threshold_hours: int,
        **kwargs,
    ):
        super().__init__(
            message=f"Data for {symbol} is stale (age: {age_hours:.1f}h, threshold: {threshold_hours}h)",
            symbol=symbol,
            **kwargs,
        )
        self.age_hours = age_hours
        self.threshold_hours = threshold_hours
        self.code = "DATA_STALE"


class DataIncompleteError(DataError):
    """Data is incomplete or missing fields."""
    
    def __init__(self, symbol: str, missing_fields: list[str], **kwargs):
        super().__init__(
            message=f"Data for {symbol} is incomplete. Missing: {', '.join(missing_fields)}",
            symbol=symbol,
            **kwargs,
        )
        self.missing_fields = missing_fields
        self.code = "DATA_INCOMPLETE"


# ============================================================================
# System Errors
# ============================================================================

class SystemError(VniBBException):
    """Base exception for system-level errors."""
    
    def __init__(self, message: str, **kwargs):
        super().__init__(message, code="SYSTEM_ERROR", **kwargs)


class DatabaseError(SystemError):
    """Database operation failed."""
    
    def __init__(
        self,
        message: str,
        operation: str,
        original_error: Optional[Exception] = None,
        **kwargs,
    ):
        super().__init__(message, **kwargs)
        self.operation = operation
        self.original_error = original_error
        self.code = "DATABASE_ERROR"


class CacheError(SystemError):
    """Cache operation failed."""
    
    def __init__(self, message: str, key: Optional[str] = None, **kwargs):
        super().__init__(message, **kwargs)
        self.key = key
        self.code = "CACHE_ERROR"


class ConfigurationError(SystemError):
    """Configuration is invalid or missing."""
    
    def __init__(self, message: str, setting: Optional[str] = None, **kwargs):
        super().__init__(message, **kwargs)
        self.setting = setting
        self.code = "CONFIGURATION_ERROR"


# ============================================================================
# API Errors
# ============================================================================

class APIError(VniBBException):
    """API request error."""
    
    def __init__(
        self,
        message: str,
        status_code: int,
        endpoint: Optional[str] = None,
        **kwargs,
    ):
        super().__init__(message, code=f"API_ERROR_{status_code}", **kwargs)
        self.status_code = status_code
        self.endpoint = endpoint


class AuthenticationError(APIError):
    """Authentication required or failed."""
    
    def __init__(self, message: str = "Authentication required", **kwargs):
        super().__init__(message, status_code=401, **kwargs)
        self.code = "AUTH_ERROR"


class AuthorizationError(APIError):
    """Authorization failed."""
    
    def __init__(self, message: str = "Permission denied", **kwargs):
        super().__init__(message, status_code=403, **kwargs)
        self.code = "AUTHORIZATION_ERROR"


class ValidationError(APIError):
    """Request validation failed."""
    
    def __init__(self, message: str, field_errors: Optional[dict[str, str]] = None, **kwargs):
        super().__init__(message, status_code=422, **kwargs)
        self.field_errors = field_errors or {}
        self.code = "VALIDATION_ERROR"


class RateLimitExceededError(APIError):
    """Rate limit exceeded."""
    
    def __init__(
        self,
        message: str = "Rate limit exceeded",
        retry_after: Optional[int] = None,
        **kwargs,
    ):
        super().__init__(message, status_code=429, **kwargs)
        self.retry_after = retry_after
        self.code = "RATE_LIMIT_EXCEEDED"


# ============================================================================
# Exception Utilities
# ============================================================================

def is_retryable(error: Exception) -> bool:
    """Determine if an error is retryable."""
    if isinstance(error, (ProviderTimeoutError, ProviderRateLimitError)):
        return True
    if isinstance(error, DatabaseError):
        return True
    if isinstance(error, CacheError):
        return True
    if isinstance(error, APIError) and error.status_code >= 500:
        return True
    return False


def get_retry_delay(error: Exception, base_delay: float = 1.0) -> float:
    """Calculate retry delay based on error type."""
    if isinstance(error, ProviderRateLimitError) and error.retry_after_seconds:
        return float(error.retry_after_seconds)
    if isinstance(error, RateLimitExceededError) and error.retry_after:
        return float(error.retry_after)
    return base_delay
