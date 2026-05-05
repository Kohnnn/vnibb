"""
Input Validation Utilities

Provides reusable validators for common API parameters like
stock symbols, dates, and numeric ranges.
"""

import re
from datetime import date, datetime
from typing import Optional

from fastapi import HTTPException


def validate_symbol(symbol: str, allow_lowercase: bool = True) -> str:
    """
    Validate Vietnamese stock symbol format.
    
    Args:
        symbol: Stock symbol to validate
        allow_lowercase: If True, automatically convert to uppercase
        
    Returns:
        Validated and normalized symbol (uppercase)
        
    Raises:
        HTTPException: 422 if symbol format is invalid
    """
    if not symbol:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "validation_error",
                "message": "Symbol cannot be empty",
                "details": {
                    "field": "symbol",
                    "value": symbol,
                    "expected_format": "3-6 uppercase alphanumeric characters"
                },
                "timestamp": datetime.utcnow().isoformat()
            }
        )
    
    # Normalize to uppercase
    normalized = symbol.upper() if allow_lowercase else symbol
    
    # Vietnamese stock symbols: 3-6 characters, letters and numbers only
    # Examples: VNM, FPT, VNINDEX, VN30
    pattern = r"^[A-Z0-9]{3,6}$"
    
    if not re.match(pattern, normalized):
        raise HTTPException(
            status_code=422,
            detail={
                "error": "validation_error",
                "message": f"Invalid symbol format: {symbol}",
                "details": {
                    "field": "symbol",
                    "value": symbol,
                    "expected_format": pattern,
                    "examples": ["VNM", "FPT", "ACB", "VN30"]
                },
                "timestamp": datetime.utcnow().isoformat()
            }
        )
    
    return normalized


def validate_date_range(
    start_date: Optional[date],
    end_date: Optional[date],
    max_days: Optional[int] = None
) -> tuple[Optional[date], Optional[date]]:
    """
    Validate date range for historical data queries.
    
    Args:
        start_date: Start date (optional)
        end_date: End date (optional)
        max_days: Maximum allowed range in days (optional)
        
    Returns:
        Tuple of (start_date, end_date)
        
    Raises:
        HTTPException: 422 if date range is invalid
    """
    if start_date and end_date:
        if start_date > end_date:
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "validation_error",
                    "message": "start_date cannot be after end_date",
                    "details": {
                        "start_date": start_date.isoformat(),
                        "end_date": end_date.isoformat()
                    },
                    "timestamp": datetime.utcnow().isoformat()
                }
            )
        
        if max_days:
            delta = (end_date - start_date).days
            if delta > max_days:
                raise HTTPException(
                    status_code=422,
                    detail={
                        "error": "validation_error",
                        "message": f"Date range cannot exceed {max_days} days",
                        "details": {
                            "start_date": start_date.isoformat(),
                            "end_date": end_date.isoformat(),
                            "range_days": delta,
                            "max_days": max_days
                        },
                        "timestamp": datetime.utcnow().isoformat()
                    }
                )
    
    return start_date, end_date


def validate_limit(
    limit: int,
    min_limit: int = 1,
    max_limit: int = 1000,
    default: int = 100
) -> int:
    """
    Validate pagination limit parameter.
    
    Args:
        limit: Requested limit
        min_limit: Minimum allowed limit
        max_limit: Maximum allowed limit
        default: Default value if limit is None
        
    Returns:
        Validated limit value
        
    Raises:
        HTTPException: 422 if limit is out of range
    """
    if limit is None:
        return default
    
    if limit < min_limit or limit > max_limit:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "validation_error",
                "message": f"Limit must be between {min_limit} and {max_limit}",
                "details": {
                    "field": "limit",
                    "value": limit,
                    "min": min_limit,
                    "max": max_limit
                },
                "timestamp": datetime.utcnow().isoformat()
            }
        )
    
    return limit


def validate_exchange(exchange: Optional[str]) -> Optional[str]:
    """
    Validate stock exchange parameter.
    
    Args:
        exchange: Exchange code (HOSE, HNX, UPCOM, or None for all)
        
    Returns:
        Validated exchange code (uppercase)
        
    Raises:
        HTTPException: 422 if exchange is invalid
    """
    if exchange is None:
        return None
    
    valid_exchanges = {"HOSE", "HNX", "UPCOM"}
    normalized = exchange.upper()
    
    if normalized not in valid_exchanges:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "validation_error",
                "message": f"Invalid exchange: {exchange}",
                "details": {
                    "field": "exchange",
                    "value": exchange,
                    "allowed_values": list(valid_exchanges)
                },
                "timestamp": datetime.utcnow().isoformat()
            }
        )
    
    return normalized


def validate_interval(interval: str) -> str:
    """
    Validate time interval for historical data.
    
    Args:
        interval: Time interval (1m, 5m, 15m, 30m, 1H, 1D, 1W, 1M)
        
    Returns:
        Validated interval string
        
    Raises:
        HTTPException: 422 if interval is invalid
    """
    valid_intervals = {"1m", "5m", "15m", "30m", "1H", "1D", "1W", "1M"}
    
    if interval not in valid_intervals:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "validation_error",
                "message": f"Invalid interval: {interval}",
                "details": {
                    "field": "interval",
                    "value": interval,
                    "allowed_values": list(valid_intervals)
                },
                "timestamp": datetime.utcnow().isoformat()
            }
        )
    
    return interval
