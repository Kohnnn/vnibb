"""
Logging configuration for VNIBB.

Supports two modes:
- text: Human-readable format for development
- json: Structured JSON format for production (log aggregation)

Usage:
    from vnibb.core.logging_config import setup_logging
    setup_logging()
"""

import json
import logging
import sys
from datetime import datetime, timezone
from typing import Any, Optional

from vnibb.core.config import settings


class JSONFormatter(logging.Formatter):
    """
    JSON log formatter for structured logging.
    
    Outputs logs in JSON format suitable for log aggregation systems
    like ELK, CloudWatch, or Datadog.
    """
    
    def format(self, record: logging.LogRecord) -> str:
        """Format log record as JSON."""
        log_data: dict[str, Any] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        
        # Add location info
        if record.pathname:
            log_data["location"] = {
                "file": record.pathname,
                "line": record.lineno,
                "function": record.funcName,
            }
        
        # Add exception info if present
        if record.exc_info:
            log_data["exception"] = self.formatException(record.exc_info)
        
        # Add extra fields
        extra_fields = {
            k: v for k, v in record.__dict__.items()
            if k not in {
                "name", "msg", "args", "created", "filename", "funcName",
                "levelname", "levelno", "lineno", "module", "msecs",
                "pathname", "process", "processName", "relativeCreated",
                "stack_info", "exc_info", "exc_text", "thread", "threadName",
                "message", "taskName",
            }
        }
        if extra_fields:
            log_data["extra"] = extra_fields
        
        return json.dumps(log_data, default=str)


class TextFormatter(logging.Formatter):
    """
    Human-readable text formatter for development.
    
    Includes colors for terminal output when available.
    """
    
    COLORS = {
        "DEBUG": "\033[36m",     # Cyan
        "INFO": "\033[32m",      # Green
        "WARNING": "\033[33m",   # Yellow
        "ERROR": "\033[31m",     # Red
        "CRITICAL": "\033[35m",  # Magenta
    }
    RESET = "\033[0m"
    
    def __init__(self, use_colors: bool = True):
        super().__init__()
        self.use_colors = use_colors and sys.stdout.isatty()
    
    def format(self, record: logging.LogRecord) -> str:
        """Format log record as colored text."""
        # Build timestamp
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        # Build level with optional color
        level = record.levelname
        if self.use_colors:
            color = self.COLORS.get(level, "")
            level = f"{color}{level:8}{self.RESET}"
        else:
            level = f"{level:8}"
        
        # Build message
        message = record.getMessage()
        
        # Format: timestamp - level - logger - message
        formatted = f"{timestamp} - {level} - {record.name} - {message}"
        
        # Add exception if present
        if record.exc_info:
            formatted += f"\n{self.formatException(record.exc_info)}"
        
        return formatted


class RequestContextFilter(logging.Filter):
    """
    Logging filter that adds request context to log records.
    
    Adds request_id, user_id, and other context when available.
    """
    
    def filter(self, record: logging.LogRecord) -> bool:
        """Add context to log record."""
        # These would be set by middleware
        if not hasattr(record, "request_id"):
            record.request_id = None
        if not hasattr(record, "user_id"):
            record.user_id = None
        return True


def setup_logging(
    level: Optional[str] = None,
    format_type: Optional[str] = None,
) -> None:
    """
    Configure application logging.
    
    Args:
        level: Log level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        format_type: Format type ("text" or "json")
    """
    # Ensure stdout/stderr use UTF-8 encoding to handle emojis/Vietnamese characters
    # This is especially important on Windows.
    try:
        if sys.stdout.encoding.lower() != 'utf-8':
            sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        if sys.stderr.encoding.lower() != 'utf-8':
            sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except (AttributeError, Exception):
        # Fallback for environments where reconfigure is not supported or fails
        pass

    level = level or settings.log_level

    format_type = format_type or settings.log_format
    
    # Get root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(getattr(logging, level.upper()))
    
    # Remove existing handlers
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)
    
    # Create console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(getattr(logging, level.upper()))
    
    # Set formatter based on format type
    if format_type == "json":
        formatter = JSONFormatter()
    else:
        formatter = TextFormatter(use_colors=not settings.is_production)
    
    console_handler.setFormatter(formatter)
    
    # Add context filter
    console_handler.addFilter(RequestContextFilter())
    
    # Add handler to root logger
    root_logger.addHandler(console_handler)
    
    # Reduce noise from third-party libraries
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.engine").setLevel(
        logging.INFO if settings.should_echo_sql else logging.WARNING
    )
    
    # Log startup message
    logger = logging.getLogger(__name__)
    logger.info(
        f"Logging configured: level={level}, format={format_type}, "
        f"environment={settings.environment}"
    )


def get_logger(name: str) -> logging.Logger:
    """
    Get a logger with the given name.
    
    Convenience function that ensures logging is configured.
    
    Args:
        name: Logger name (typically __name__)
    
    Returns:
        Configured logger instance
    """
    return logging.getLogger(name)
