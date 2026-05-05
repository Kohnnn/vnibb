"""
Provider Error Catalog.

Centralized error definitions with:
- Error codes
- User-friendly messages
- Suggested actions
- Context information
"""

from typing import Optional, Dict, Any
from enum import Enum


class ProviderErrorCode(str, Enum):
    """Standard error codes for all providers."""
    
    # Connection Errors
    CONNECTION_ERROR = "CONNECTION_ERROR"
    TIMEOUT_ERROR = "TIMEOUT_ERROR"
    DNS_ERROR = "DNS_ERROR"
    SSL_ERROR = "SSL_ERROR"
    
    # API Errors
    API_UNAVAILABLE = "API_UNAVAILABLE"
    API_RATE_LIMITED = "API_RATE_LIMITED"
    API_AUTH_FAILED = "API_AUTH_FAILED"
    API_FORBIDDEN = "API_FORBIDDEN"
    
    # Data Errors
    DATA_NOT_FOUND = "DATA_NOT_FOUND"
    DATA_VALIDATION_FAILED = "DATA_VALIDATION_FAILED"
    DATA_PARSING_ERROR = "DATA_PARSING_ERROR"
    EMPTY_RESPONSE = "EMPTY_RESPONSE"
    
    # Input Errors
    INVALID_SYMBOL = "INVALID_SYMBOL"
    INVALID_DATE_RANGE = "INVALID_DATE_RANGE"
    INVALID_PARAMETERS = "INVALID_PARAMETERS"
    
    # Internal Errors
    INTERNAL_ERROR = "INTERNAL_ERROR"
    CONFIGURATION_ERROR = "CONFIGURATION_ERROR"


class ProviderErrorMessage:
    """User-friendly error messages and suggested actions."""
    
    MESSAGES = {
        # Connection Errors
        ProviderErrorCode.CONNECTION_ERROR: {
            "message": "Failed to connect to data provider",
            "action": "Check your network connection and try again",
            "technical": "Network connection failed or provider is unreachable",
        },
        ProviderErrorCode.TIMEOUT_ERROR: {
            "message": "Request timed out",
            "action": "The provider is taking too long to respond. Try again later",
            "technical": "Request exceeded maximum timeout threshold",
        },
        ProviderErrorCode.DNS_ERROR: {
            "message": "Failed to resolve provider hostname",
            "action": "Check your DNS settings or network configuration",
            "technical": "DNS resolution failed for provider endpoint",
        },
        ProviderErrorCode.SSL_ERROR: {
            "message": "SSL/TLS connection failed",
            "action": "Check SSL certificate configuration or system time",
            "technical": "SSL certificate validation or handshake failed",
        },
        
        # API Errors
        ProviderErrorCode.API_UNAVAILABLE: {
            "message": "Data provider is temporarily unavailable",
            "action": "Wait a few minutes and try again",
            "technical": "API returned 500/502/503/504 error",
        },
        ProviderErrorCode.API_RATE_LIMITED: {
            "message": "Rate limit exceeded",
            "action": "Wait 60 seconds before making more requests",
            "technical": "API returned 429 Too Many Requests",
        },
        ProviderErrorCode.API_AUTH_FAILED: {
            "message": "Authentication failed",
            "action": "Check your API key configuration",
            "technical": "API returned 401 Unauthorized",
        },
        ProviderErrorCode.API_FORBIDDEN: {
            "message": "Access forbidden",
            "action": "Upgrade your subscription or check API permissions",
            "technical": "API returned 403 Forbidden",
        },
        
        # Data Errors
        ProviderErrorCode.DATA_NOT_FOUND: {
            "message": "No data found",
            "action": "Check if the stock symbol is correct and try a different date range",
            "technical": "API returned empty result or 404 Not Found",
        },
        ProviderErrorCode.DATA_VALIDATION_FAILED: {
            "message": "Data validation failed",
            "action": "The provider data is invalid or corrupted. Try again later",
            "technical": "Response data failed validation checks",
        },
        ProviderErrorCode.DATA_PARSING_ERROR: {
            "message": "Failed to parse provider response",
            "action": "The data format may have changed. Contact support if this persists",
            "technical": "JSON/CSV parsing failed or unexpected data structure",
        },
        ProviderErrorCode.EMPTY_RESPONSE: {
            "message": "Provider returned empty response",
            "action": "Try a different date range or check back later",
            "technical": "API returned 200 OK but empty body",
        },
        
        # Input Errors
        ProviderErrorCode.INVALID_SYMBOL: {
            "message": "Invalid stock symbol",
            "action": "Enter a valid Vietnamese stock symbol (e.g., VNM, FPT, HPG)",
            "technical": "Symbol validation failed",
        },
        ProviderErrorCode.INVALID_DATE_RANGE: {
            "message": "Invalid date range",
            "action": "Check that start date is before end date and within valid range",
            "technical": "Date range validation failed",
        },
        ProviderErrorCode.INVALID_PARAMETERS: {
            "message": "Invalid request parameters",
            "action": "Check API documentation for correct parameter format",
            "technical": "Query parameter validation failed",
        },
        
        # Internal Errors
        ProviderErrorCode.INTERNAL_ERROR: {
            "message": "An unexpected error occurred",
            "action": "Try again later or contact support if this persists",
            "technical": "Unhandled exception in provider logic",
        },
        ProviderErrorCode.CONFIGURATION_ERROR: {
            "message": "Provider configuration error",
            "action": "Contact system administrator",
            "technical": "Missing or invalid provider configuration",
        },
    }
    
    @classmethod
    def get(
        cls,
        code: ProviderErrorCode,
        include_action: bool = True,
        include_technical: bool = False
    ) -> str:
        """
        Get error message for a code.
        
        Args:
            code: Error code
            include_action: Include suggested action
            include_technical: Include technical details
        
        Returns:
            Formatted error message
        """
        if code not in cls.MESSAGES:
            return f"Unknown error: {code}"
        
        info = cls.MESSAGES[code]
        parts = [info["message"]]
        
        if include_action:
            parts.append(f"Action: {info['action']}")
        
        if include_technical:
            parts.append(f"Technical: {info['technical']}")
        
        return ". ".join(parts)


class ProviderError(Exception):
    """
    Standard provider error with error code and context.
    
    Usage:
        raise ProviderError(
            code=ProviderErrorCode.API_RATE_LIMITED,
            context={"provider": "vnstock", "symbol": "VNM"}
        )
    """
    
    def __init__(
        self,
        code: ProviderErrorCode,
        message: Optional[str] = None,
        action: Optional[str] = None,
        context: Optional[Dict[str, Any]] = None,
        original_error: Optional[Exception] = None,
    ):
        self.code = code
        self.context = context or {}
        self.original_error = original_error
        
        # Get standard message if not provided
        if not message:
            message = ProviderErrorMessage.MESSAGES[code]["message"]
        
        # Get standard action if not provided
        if not action:
            action = ProviderErrorMessage.MESSAGES[code]["action"]
        
        self.message = message
        self.action = action
        
        # Build full error message
        error_parts = [f"[{code}] {message}"]
        if action:
            error_parts.append(f"Action: {action}")
        if context:
            error_parts.append(f"Context: {context}")
        
        super().__init__(". ".join(error_parts))
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert error to dictionary for API responses."""
        return {
            "error": True,
            "code": self.code,
            "message": self.message,
            "action": self.action,
            "context": self.context,
        }


# Convenience factory functions

def connection_error(provider: str, url: str, original: Optional[Exception] = None) -> ProviderError:
    """Create a connection error."""
    return ProviderError(
        code=ProviderErrorCode.CONNECTION_ERROR,
        context={"provider": provider, "url": url},
        original_error=original,
    )


def timeout_error(provider: str, timeout_seconds: int, original: Optional[Exception] = None) -> ProviderError:
    """Create a timeout error."""
    return ProviderError(
        code=ProviderErrorCode.TIMEOUT_ERROR,
        context={"provider": provider, "timeout": timeout_seconds},
        original_error=original,
    )


def rate_limit_error(provider: str, retry_after: int = 60) -> ProviderError:
    """Create a rate limit error."""
    return ProviderError(
        code=ProviderErrorCode.API_RATE_LIMITED,
        context={"provider": provider, "retry_after": retry_after},
    )


def data_not_found(provider: str, symbol: str, date_range: Optional[str] = None) -> ProviderError:
    """Create a data not found error."""
    context = {"provider": provider, "symbol": symbol}
    if date_range:
        context["date_range"] = date_range
    
    return ProviderError(
        code=ProviderErrorCode.DATA_NOT_FOUND,
        context=context,
    )


def validation_error(provider: str, details: str) -> ProviderError:
    """Create a validation error."""
    return ProviderError(
        code=ProviderErrorCode.DATA_VALIDATION_FAILED,
        context={"provider": provider, "details": details},
    )


def invalid_symbol(symbol: str) -> ProviderError:
    """Create an invalid symbol error."""
    return ProviderError(
        code=ProviderErrorCode.INVALID_SYMBOL,
        context={"symbol": symbol},
    )
