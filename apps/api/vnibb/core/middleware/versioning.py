"""
API Versioning Middleware.

Provides:
- X-API-Version header on all responses
- X-Request-ID header for request tracing
- Deprecation warnings for old API versions
"""

import logging
from typing import Callable

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from vnibb.core.config import settings

logger = logging.getLogger(__name__)


class APIVersionMiddleware(BaseHTTPMiddleware):
    """
    Middleware to add versioning headers to all API responses.
    
    Features:
    - X-API-Version header with semantic version
    - X-Request-ID from request state (if available)
    - Deprecation warnings for old endpoints
    """
    
    def __init__(self, app):
        super().__init__(app)
        self.api_version = settings.app_version
    
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        """Process request and add versioning headers."""
        # Process request
        response = await call_next(request)
        
        # Add API version header
        response.headers["X-API-Version"] = self.api_version
        
        # Add request ID if available from request state
        if hasattr(request.state, "request_id"):
            response.headers["X-Request-ID"] = request.state.request_id
        
        # Add deprecation warning for old API versions (if applicable)
        # Example: if path contains /api/v0/, add warning
        if "/api/v0/" in request.url.path:
            response.headers["Deprecation"] = "true"
            response.headers["Sunset"] = "2025-12-31"  # Sunset date
            response.headers["Link"] = '</api/v1/>; rel="alternate"'
        
        return response
