"""
Data Validation Layer for External API Providers.

Provides:
- Schema validation for API responses
- NaN/null/infinity handling
- Data sanitization and normalization
- Warning logging for unexpected data
"""

import logging
import math
from typing import Any, Dict, List, Optional, TypeVar, Union
from datetime import datetime, date

import pandas as pd
from pydantic import BaseModel, field_validator

logger = logging.getLogger(__name__)

T = TypeVar("T")


class ValidationError(Exception):
    """Raised when data validation fails."""
    pass


class DataValidator:
    """
    Validator for external API responses.
    
    Handles common data quality issues:
    - Missing required fields
    - NaN, null, infinity values
    - Invalid date formats
    - Out-of-range numbers
    """
    
    @staticmethod
    def validate_required_fields(
        data: Dict[str, Any],
        required_fields: List[str],
        source: str = "API"
    ) -> None:
        """
        Validate that required fields exist in data.
        
        Args:
            data: Dictionary to validate
            required_fields: List of required field names
            source: Name of data source (for logging)
        
        Raises:
            ValidationError: If any required field is missing
        """
        missing = [field for field in required_fields if field not in data]
        
        if missing:
            error_msg = (
                f"{source} response missing required fields: {', '.join(missing)}"
            )
            logger.error(error_msg)
            raise ValidationError(error_msg)
    
    @staticmethod
    def clean_numeric(value: Any, default: Optional[float] = None) -> Optional[float]:
        """
        Clean numeric value, handling NaN, inf, and invalid values.
        
        Args:
            value: Value to clean
            default: Default value if cleaning fails
        
        Returns:
            Cleaned float value or default
        """
        if value is None:
            return default
        
        try:
            # Handle pandas types
            if pd.isna(value):
                return default
            
            # Convert to float
            num = float(value)
            
            # Check for infinity
            if math.isinf(num):
                logger.warning(f"Infinite value encountered: {value}")
                return default
            
            # Check for NaN
            if math.isnan(num):
                return default
            
            return num
            
        except (ValueError, TypeError) as e:
            logger.warning(f"Failed to convert to numeric: {value} - {e}")
            return default
    
    @staticmethod
    def clean_string(value: Any, default: str = "") -> str:
        """
        Clean string value, handling None and non-string types.
        
        Args:
            value: Value to clean
            default: Default value if cleaning fails
        
        Returns:
            Cleaned string value
        """
        if value is None or pd.isna(value):
            return default
        
        try:
            return str(value).strip()
        except Exception as e:
            logger.warning(f"Failed to convert to string: {value} - {e}")
            return default
    
    @staticmethod
    def clean_date(
        value: Any,
        format: Optional[str] = None,
        default: Optional[date] = None
    ) -> Optional[date]:
        """
        Clean date value, handling various formats.
        
        Args:
            value: Value to clean (string, datetime, date, or None)
            format: Expected date format (e.g., "%Y-%m-%d")
            default: Default value if parsing fails
        
        Returns:
            Cleaned date value or default
        """
        if value is None or pd.isna(value):
            return default
        
        # Already a date
        if isinstance(value, date):
            return value
        
        # Datetime to date
        if isinstance(value, datetime):
            return value.date()
        
        # Parse string
        try:
            if format:
                return datetime.strptime(str(value), format).date()
            else:
                # Try common formats
                formats = [
                    "%Y-%m-%d",
                    "%d/%m/%Y",
                    "%m/%d/%Y",
                    "%Y%m%d",
                ]
                for fmt in formats:
                    try:
                        return datetime.strptime(str(value), fmt).date()
                    except ValueError:
                        continue
                
                logger.warning(f"Failed to parse date: {value}")
                return default
                
        except Exception as e:
            logger.warning(f"Date parsing error: {value} - {e}")
            return default
    
    @staticmethod
    def clean_percentage(value: Any, default: Optional[float] = None) -> Optional[float]:
        """
        Clean percentage value (0-100 range).
        
        Args:
            value: Value to clean
            default: Default value if out of range
        
        Returns:
            Cleaned percentage or default
        """
        num = DataValidator.clean_numeric(value, default)
        
        if num is not None:
            # Check if reasonable percentage (allow negative for growth rates)
            if abs(num) > 1000:
                logger.warning(f"Suspicious percentage value: {num}")
                return default
        
        return num
    
    @staticmethod
    def validate_dataframe(
        df: pd.DataFrame,
        required_columns: List[str],
        source: str = "API"
    ) -> pd.DataFrame:
        """
        Validate and clean a pandas DataFrame.
        
        Args:
            df: DataFrame to validate
            required_columns: List of required column names
            source: Name of data source (for logging)
        
        Returns:
            Cleaned DataFrame
        
        Raises:
            ValidationError: If required columns are missing
        """
        if df is None or df.empty:
            logger.warning(f"{source} returned empty DataFrame")
            return pd.DataFrame()
        
        # Check required columns
        missing = [col for col in required_columns if col not in df.columns]
        if missing:
            error_msg = (
                f"{source} DataFrame missing columns: {', '.join(missing)}"
            )
            logger.error(error_msg)
            raise ValidationError(error_msg)
        
        # Clean DataFrame
        # Replace inf with NaN
        df = df.replace([float('inf'), float('-inf')], pd.NA)
        
        # Log warnings for high NaN count
        for col in required_columns:
            nan_count = df[col].isna().sum()
            if nan_count > 0:
                nan_pct = (nan_count / len(df)) * 100
                if nan_pct > 50:
                    logger.warning(
                        f"{source} column '{col}' has {nan_pct:.1f}% NaN values"
                    )
        
        return df
    
    @staticmethod
    def sanitize_symbol(symbol: str) -> str:
        """
        Sanitize stock symbol.
        
        Args:
            symbol: Stock symbol to sanitize
        
        Returns:
            Sanitized symbol (uppercase, stripped)
        """
        return str(symbol).strip().upper()
    
    @staticmethod
    def validate_symbol(symbol: str, exchange: Optional[str] = None) -> bool:
        """
        Validate stock symbol format.
        
        Args:
            symbol: Stock symbol to validate
            exchange: Exchange (HOSE, HNX, UPCOM) for additional validation
        
        Returns:
            True if valid, False otherwise
        """
        if not symbol:
            return False
        
        symbol = DataValidator.sanitize_symbol(symbol)
        
        # Check length (3-5 characters typical)
        if not (2 <= len(symbol) <= 5):
            logger.warning(f"Unusual symbol length: {symbol}")
            return False
        
        # Check alphanumeric
        if not symbol.isalnum():
            logger.warning(f"Non-alphanumeric symbol: {symbol}")
            return False
        
        return True


class PriceValidator:
    """Validator specifically for price data."""
    
    @staticmethod
    def validate_ohlcv(data: Dict[str, Any]) -> bool:
        """
        Validate OHLCV (Open, High, Low, Close, Volume) data.
        
        Args:
            data: Dictionary with OHLCV keys
        
        Returns:
            True if valid, False otherwise
        """
        required = ["open", "high", "low", "close", "volume"]
        
        # Check required fields exist
        for field in required:
            if field not in data:
                logger.error(f"Missing OHLCV field: {field}")
                return False
        
        try:
            # Get prices
            open_price = float(data["open"])
            high_price = float(data["high"])
            low_price = float(data["low"])
            close_price = float(data["close"])
            volume = float(data["volume"])
            
            # Validate price relationships
            if high_price < low_price:
                logger.error(
                    f"Invalid OHLCV: high ({high_price}) < low ({low_price})"
                )
                return False
            
            if high_price < max(open_price, close_price):
                logger.error(
                    f"Invalid OHLCV: high ({high_price}) < open/close"
                )
                return False
            
            if low_price > min(open_price, close_price):
                logger.error(
                    f"Invalid OHLCV: low ({low_price}) > open/close"
                )
                return False
            
            # Validate volume is non-negative
            if volume < 0:
                logger.error(f"Invalid volume: {volume}")
                return False
            
            return True
            
        except (ValueError, TypeError) as e:
            logger.error(f"OHLCV validation error: {e}")
            return False


# Convenience functions

def clean_api_response(
    data: Any,
    required_fields: Optional[List[str]] = None,
    source: str = "API"
) -> Any:
    """
    Clean and validate API response data.
    
    Args:
        data: Data to clean (dict, list, or DataFrame)
        required_fields: List of required field names
        source: Name of data source
    
    Returns:
        Cleaned data
    
    Raises:
        ValidationError: If validation fails
    """
    if data is None:
        raise ValidationError(f"{source} returned None")
    
    # Handle DataFrame
    if isinstance(data, pd.DataFrame):
        if required_fields:
            return DataValidator.validate_dataframe(data, required_fields, source)
        return data
    
    # Handle dict
    if isinstance(data, dict):
        if required_fields:
            DataValidator.validate_required_fields(data, required_fields, source)
        return data
    
    # Handle list
    if isinstance(data, list):
        if not data:
            logger.warning(f"{source} returned empty list")
        return data
    
    return data
