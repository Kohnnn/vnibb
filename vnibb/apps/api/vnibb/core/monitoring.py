"""
Production Monitoring & Observability

Integrates Sentry for error tracking and performance monitoring.
Provides middleware for request correlation and performance tracking.

Usage:
    from vnibb.core.monitoring import init_monitoring
    init_monitoring(app)
"""

import logging
import uuid
import time
import functools
import asyncio
from typing import Optional, Callable, Any

from contextlib import contextmanager

from fastapi import FastAPI, Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

from vnibb.core.config import settings

logger = logging.getLogger(__name__)

# Global flag to track if Sentry is initialized
_sentry_initialized = False


def init_monitoring(app: FastAPI) -> None:
    """
    Initialize monitoring and observability for the application.
    
    Sets up:
    - Sentry error tracking and performance monitoring
    - Request correlation IDs
    - Performance transaction tracking
    
    Args:
        app: FastAPI application instance
    """
    global _sentry_initialized
    
    # Initialize Sentry if DSN is configured
    if settings.sentry_dsn and not _sentry_initialized:
        try:
            import sentry_sdk
            from sentry_sdk.integrations.fastapi import FastApiIntegration
            from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
            from sentry_sdk.integrations.redis import RedisIntegration
            from sentry_sdk.integrations.logging import LoggingIntegration
            
            # Configure logging integration
            logging_integration = LoggingIntegration(
                level=logging.INFO,  # Capture info and above as breadcrumbs
                event_level=logging.ERROR  # Send errors as events
            )
            
            sentry_sdk.init(
                dsn=settings.sentry_dsn,
                environment=settings.environment,
                release=f"{settings.app_name}@{settings.app_version}",
                integrations=[
                    FastApiIntegration(
                        transaction_style="endpoint",  # Group by endpoint
                        failed_request_status_codes=[500, 502, 503, 504],
                    ),
                    SqlalchemyIntegration(),
                    RedisIntegration(),
                    logging_integration,
                ],
                # Performance monitoring
                traces_sample_rate=settings.sentry_traces_sample_rate,
                profiles_sample_rate=settings.sentry_profiles_sample_rate,
                # Error sampling
                sample_rate=1.0,  # Capture all errors
                # Data scrubbing
                before_send=filter_sensitive_data,
                before_send_transaction=filter_transaction_data,
                # Additional options
                attach_stacktrace=True,
                send_default_pii=False,  # Don't send PII by default
                max_breadcrumbs=50,
                debug=settings.debug,
            )
            
            _sentry_initialized = True
            logger.info(
                f"Sentry initialized: environment={settings.environment}, "
                f"traces_sample_rate={settings.sentry_traces_sample_rate}"
            )
        except ImportError:
            logger.warning(
                "Sentry SDK not installed. Install with: pip install sentry-sdk[fastapi]"
            )
        except Exception as e:
            logger.error(f"Failed to initialize Sentry: {e}")
    elif not settings.sentry_dsn:
        logger.info("Sentry DSN not configured - monitoring disabled")
    
    # Add correlation ID middleware
    app.add_middleware(CorrelationIDMiddleware)
    
    # Add performance tracking middleware (if Sentry is enabled)
    if _sentry_initialized:
        app.add_middleware(PerformanceMiddleware)


def filter_sensitive_data(event: dict, hint: dict) -> Optional[dict]:
    """
    Filter sensitive data from error events before sending to Sentry.
    
    Removes:
    - Authorization headers
    - API keys
    - Passwords
    - Session tokens
    
    Args:
        event: Sentry event dict
        hint: Additional context
    
    Returns:
        Filtered event or None to drop the event
    """
    # Remove sensitive headers
    if "request" in event:
        if "headers" in event["request"]:
            headers = event["request"]["headers"]
            sensitive_headers = [
                "authorization",
                "cookie",
                "x-api-key",
                "x-auth-token",
            ]
            for header in sensitive_headers:
                headers.pop(header, None)
        
        # Remove sensitive query params
        if "query_string" in event["request"]:
            # Don't send query strings that might contain tokens
            event["request"]["query_string"] = "[FILTERED]"
    
    # Remove sensitive data from extra context
    if "extra" in event:
        sensitive_keys = ["password", "token", "secret", "api_key"]
        for key in list(event["extra"].keys()):
            if any(sensitive in key.lower() for sensitive in sensitive_keys):
                event["extra"][key] = "[FILTERED]"
    
    return event


def filter_transaction_data(event: dict, hint: dict) -> Optional[dict]:
    """
    Filter transaction data before sending to Sentry.
    
    Can be used to:
    - Drop low-value transactions
    - Sample high-volume endpoints differently
    - Add custom tags
    
    Args:
        event: Sentry transaction event
        hint: Additional context
    
    Returns:
        Filtered event or None to drop the transaction
    """
    # Drop health check transactions (too noisy)
    if event.get("transaction") in [
        "GET /health",
        "GET /ready",
        "GET /live",
        "GET /metrics",
    ]:
        return None
    
    return event


class CorrelationIDMiddleware(BaseHTTPMiddleware):
    """
    Middleware to add correlation IDs to requests.
    
    Correlation IDs help trace requests across services and logs.
    The ID is:
    - Extracted from X-Correlation-ID header if present
    - Generated as UUID if not present
    - Added to response headers
    - Added to Sentry scope
    - Added to log context
    """
    
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Get or generate correlation ID
        correlation_id = request.headers.get(
            "X-Correlation-ID",
            request.headers.get("X-Request-ID", str(uuid.uuid4()))
        )
        
        # Store in request state
        request.state.correlation_id = correlation_id
        
        # Add to Sentry scope if available
        if _sentry_initialized:
            try:
                import sentry_sdk
                with sentry_sdk.configure_scope() as scope:
                    scope.set_tag("correlation_id", correlation_id)
                    scope.set_context("request", {
                        "method": request.method,
                        "url": str(request.url),
                        "client_ip": request.client.host if request.client else None,
                    })
            except Exception:
                pass  # Don't fail request if Sentry fails
        
        # Process request
        response = await call_next(request)
        
        # Add correlation ID to response headers
        response.headers["X-Correlation-ID"] = correlation_id
        
        return response


class PerformanceMiddleware(BaseHTTPMiddleware):
    """
    Middleware to track request performance with Sentry.
    
    Creates a transaction for each request and tracks:
    - Response time
    - Status code
    - Endpoint
    - User agent
    """
    
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        if not _sentry_initialized:
            return await call_next(request)
        
        try:
            import sentry_sdk
            from sentry_sdk import start_transaction
            
            # Start transaction
            with start_transaction(
                op="http.server",
                name=f"{request.method} {request.url.path}",
                source="route",
            ) as transaction:
                # Add tags
                transaction.set_tag("http.method", request.method)
                transaction.set_tag("http.url", str(request.url.path))
                
                # Add user agent if available
                user_agent = request.headers.get("user-agent")
                if user_agent:
                    transaction.set_tag("user_agent", user_agent[:100])
                
                # Process request
                response = await call_next(request)
                
                # Set transaction status
                transaction.set_http_status(response.status_code)
                transaction.set_tag("http.status_code", response.status_code)
                
                return response
        except Exception as e:
            logger.error(f"Performance tracking error: {e}")
            # Don't fail the request if monitoring fails
            return await call_next(request)


@contextmanager
def track_operation(operation: str, description: Optional[str] = None):
    """
    Context manager to track a specific operation with Sentry.
    
    Usage:
        with track_operation("database.query", "Fetch user data"):
            result = await db.execute(query)
    
    Args:
        operation: Operation type (e.g., "database.query", "cache.get")
        description: Human-readable description
    """
    if not _sentry_initialized:
        yield
        return
    
    try:
        import sentry_sdk
        with sentry_sdk.start_span(op=operation, description=description):
            yield
    except Exception:
        yield  # Don't fail if Sentry fails


def capture_exception(
    error: Exception,
    context: Optional[dict[str, Any]] = None,
    level: str = "error",
) -> None:
    """
    Manually capture an exception to Sentry.
    
    Usage:
        try:
            risky_operation()
        except Exception as e:
            capture_exception(e, context={"user_id": user.id})
    
    Args:
        error: Exception to capture
        context: Additional context dict
        level: Severity level (debug, info, warning, error, fatal)
    """
    if not _sentry_initialized:
        logger.error(f"Exception (Sentry disabled): {error}", exc_info=error)
        return
    
    try:
        import sentry_sdk
        with sentry_sdk.push_scope() as scope:
            scope.level = level
            if context:
                scope.set_context("custom", context)
            sentry_sdk.capture_exception(error)
    except Exception as e:
        logger.error(f"Failed to capture exception to Sentry: {e}")


def capture_message(
    message: str,
    level: str = "info",
    context: Optional[dict[str, Any]] = None,
) -> None:
    """
    Manually capture a message to Sentry.
    
    Usage:
        capture_message("User completed onboarding", level="info", context={"user_id": 123})
    
    Args:
        message: Message to capture
        level: Severity level (debug, info, warning, error, fatal)
        context: Additional context dict
    """
    if not _sentry_initialized:
        logger.log(
            getattr(logging, level.upper(), logging.INFO),
            f"Message (Sentry disabled): {message}"
        )
        return
    
    try:
        import sentry_sdk
        with sentry_sdk.push_scope() as scope:
            scope.level = level
            if context:
                scope.set_context("custom", context)
            sentry_sdk.capture_message(message, level=level)
    except Exception as e:
        logger.error(f"Failed to capture message to Sentry: {e}")


def set_user_context(user_id: str, email: Optional[str] = None, username: Optional[str] = None) -> None:
    """
    Set user context for Sentry events.
    
    Usage:
        set_user_context(user_id="123", email="user@example.com")
    
    Args:
        user_id: User identifier
        email: User email (optional)
        username: Username (optional)
    """
    if not _sentry_initialized:
        return
    
    try:
        import sentry_sdk
        sentry_sdk.set_user({
            "id": user_id,
            "email": email,
            "username": username,
        })
    except Exception as e:
        logger.error(f"Failed to set user context: {e}")


def add_breadcrumb(
    message: str,
    category: str = "default",
    level: str = "info",
    data: Optional[dict[str, Any]] = None,
) -> None:
    """
    Add a breadcrumb to the current Sentry scope.
    
    Breadcrumbs are a trail of events leading up to an error.
    
    Usage:
        add_breadcrumb("User clicked button", category="ui", data={"button_id": "submit"})
    
    Args:
        message: Breadcrumb message
        category: Category (e.g., "ui", "navigation", "http")
        level: Severity level
        data: Additional data dict
    """
    if not _sentry_initialized:
        return
    
    try:
        import sentry_sdk
        sentry_sdk.add_breadcrumb(
            message=message,
            category=category,
            level=level,
            data=data or {},
        )
    except Exception as e:
                logger.error(f"Failed to add breadcrumb: {e}")


SLOW_OPERATION_THRESHOLD = 2.0  # seconds

def measure_execution_time(func: Callable) -> Callable:
    """Decorator to measure and log execution time of slow operations."""
    @functools.wraps(func)
    async def async_wrapper(*args, **kwargs) -> Any:
        start_time = time.perf_counter()
        try:
            return await func(*args, **kwargs)
        finally:
            end_time = time.perf_counter()
            duration = end_time - start_time
            if duration > SLOW_OPERATION_THRESHOLD:
                logger.warning(f"[Performance] Slow async operation: {func.__name__} took {duration:.2f}s")
            else:
                logger.debug(f"[Performance] {func.__name__} took {duration:.2f}s")

    @functools.wraps(func)
    def sync_wrapper(*args, **kwargs) -> Any:
        start_time = time.perf_counter()
        try:
            return func(*args, **kwargs)
        finally:
            end_time = time.perf_counter()
            duration = end_time - start_time
            if duration > SLOW_OPERATION_THRESHOLD:
                logger.warning(f"[Performance] Slow sync operation: {func.__name__} took {duration:.2f}s")
            else:
                logger.debug(f"[Performance] {func.__name__} took {duration:.2f}s")

    if asyncio.iscoroutinefunction(func):
        return async_wrapper
    return sync_wrapper

