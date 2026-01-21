"""
Standard API Error Response Models

Provides consistent error response format across all endpoints according
to RFC 7807 Problem Details for HTTP APIs.
"""

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


class APIError(BaseModel):
    """
    Standard error response format for all API endpoints.
    
    Attributes:
        error: Error type/code (e.g., "validation_error", "not_found")
        message: Human-readable error message
        details: Additional error context (optional)
        timestamp: ISO 8601 timestamp when error occurred
    """
    error: str = Field(..., description="Error type or code")
    message: str = Field(..., description="Human-readable error message")
    details: Optional[dict[str, Any]] = Field(None, description="Additional error context")
    timestamp: datetime = Field(default_factory=datetime.utcnow, description="Error timestamp")
    
    model_config = {
        "json_schema_extra": {
            "example": {
                "error": "validation_error",
                "message": "Invalid symbol format",
                "details": {
                    "field": "symbol",
                    "value": "invalid123",
                    "expected_format": "^[A-Z0-9]{3,6}$"
                },
                "timestamp": "2024-01-14T12:00:00Z"
            }
        }
    }


class ValidationError(BaseModel):
    """
    Validation error detail for 422 responses.
    
    Compatible with FastAPI's ValidationError format.
    """
    loc: list[str] = Field(..., description="Field location (path in request)")
    msg: str = Field(..., description="Error message")
    type: str = Field(..., description="Error type")
    
    model_config = {
        "json_schema_extra": {
            "example": {
                "loc": ["query", "symbol"],
                "msg": "Symbol must be 3-6 uppercase alphanumeric characters",
                "type": "value_error.symbol"
            }
        }
    }


class ValidationErrorResponse(BaseModel):
    """
    Standard validation error response (422).
    """
    error: str = Field(default="validation_error", description="Error type")
    message: str = Field(..., description="Human-readable error summary")
    details: list[ValidationError] = Field(..., description="List of validation errors")
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    
    model_config = {
        "json_schema_extra": {
            "example": {
                "error": "validation_error",
                "message": "Request validation failed",
                "details": [
                    {
                        "loc": ["query", "symbol"],
                        "msg": "Invalid symbol format",
                        "type": "value_error.symbol"
                    }
                ],
                "timestamp": "2024-01-14T12:00:00Z"
            }
        }
    }


class RateLimitError(BaseModel):
    """
    Rate limit exceeded error (429).
    """
    error: str = Field(default="rate_limit_exceeded", description="Error type")
    message: str = Field(..., description="Rate limit error message")
    retry_after: int = Field(..., description="Seconds to wait before retrying")
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    
    model_config = {
        "json_schema_extra": {
            "example": {
                "error": "rate_limit_exceeded",
                "message": "Too many requests. Please try again later.",
                "retry_after": 60,
                "timestamp": "2024-01-14T12:00:00Z"
            }
        }
    }


class NotFoundError(BaseModel):
    """
    Resource not found error (404).
    """
    error: str = Field(default="not_found", description="Error type")
    message: str = Field(..., description="Not found message")
    resource: str = Field(..., description="Resource type that was not found")
    identifier: Optional[str] = Field(None, description="Resource identifier")
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    
    model_config = {
        "json_schema_extra": {
            "example": {
                "error": "not_found",
                "message": "Stock symbol ACB not found",
                "resource": "stock",
                "identifier": "ACB",
                "timestamp": "2024-01-14T12:00:00Z"
            }
        }
    }
