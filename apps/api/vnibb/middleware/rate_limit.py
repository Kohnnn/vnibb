from fastapi import Request, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from collections import defaultdict
from datetime import datetime, timedelta
import asyncio
import logging

logger = logging.getLogger(__name__)

class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, requests_per_minute: int = 120):
        super().__init__(app)
        self.requests_per_minute = requests_per_minute
        self.clients: dict[str, list[datetime]] = defaultdict(list)

    async def dispatch(self, request: Request, call_next):
        # Skip rate limiting for health checks and static files
        if any(path in request.url.path for path in ["/health", "/docs", "/openapi.json", "/static"]):
            return await call_next(request)
        
        client_ip = request.client.host if request.client else "unknown"
        now = datetime.now()
        
        # Clean old requests (older than 1 minute)
        cutoff = now - timedelta(minutes=1)
        self.clients[client_ip] = [
            t for t in self.clients[client_ip] if t > cutoff
        ]
        
        # Check rate limit
        if len(self.clients[client_ip]) >= self.requests_per_minute:
            logger.warning(f"Rate limit exceeded for IP: {client_ip}")
            raise HTTPException(
                status_code=429,
                detail="Rate limit exceeded. Please slow down.",
                headers={"Retry-After": "60"},
            )
        
        # Record request
        self.clients[client_ip].append(now)
        
        return await call_next(request)
