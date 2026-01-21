import time
import logging
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger(__name__)

class MetricsMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        start_time = time.time()
        
        response = await call_next(request)
        
        duration_ms = (time.time() - start_time) * 1000
        
        # Log slow requests (> 1.5 seconds)
        if duration_ms > 1500:
            logger.warning(
                f"🐢 SLOW REQUEST: {request.method} {request.url.path} "
                f"took {duration_ms:.2f}ms"
            )
        else:
            logger.debug(
                f"⚡ {request.method} {request.url.path} "
                f"took {duration_ms:.2f}ms"
            )
        
        # Add timing header to response
        response.headers["X-Response-Time"] = f"{duration_ms:.2f}ms"
        
        return response
