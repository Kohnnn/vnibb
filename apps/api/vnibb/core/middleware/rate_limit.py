"""
Enhanced Rate Limiting Middleware with per-endpoint configuration.

Provides:
- Per-IP rate limiting (60 requests/minute default)
- Per-endpoint custom limits
- Redis-backed storage for distributed systems
- Clear error messages with retry-after headers
"""

import logging
import time
from typing import Callable, Optional
from collections import defaultdict
from datetime import datetime, timedelta

from fastapi import Request, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response, JSONResponse

from vnibb.core.cache import redis_client

logger = logging.getLogger(__name__)


class RateLimitConfig:
    """Configuration for rate limiting per endpoint."""
    
    # Default: 60 requests per minute
    DEFAULT_LIMIT = 60
    DEFAULT_WINDOW = 60  # seconds
    
    # Per-endpoint limits (requests per minute)
    ENDPOINT_LIMITS = {
        "/api/v1/screener": 30,  # More expensive endpoint
        "/api/v1/equity": 60,
        "/api/v1/market": 120,  # Cheaper endpoint
        "/api/v1/dashboard": 30,
    }
    
    @classmethod
    def get_limit(cls, path: str) -> tuple[int, int]:
        """
        Get rate limit for a specific endpoint.
        
        Returns:
            tuple: (limit, window_seconds)
        """
        # Check for exact match
        if path in cls.ENDPOINT_LIMITS:
            return cls.ENDPOINT_LIMITS[path], cls.DEFAULT_WINDOW
        
        # Check for prefix match
        for endpoint, limit in cls.ENDPOINT_LIMITS.items():
            if path.startswith(endpoint):
                return limit, cls.DEFAULT_WINDOW
        
        return cls.DEFAULT_LIMIT, cls.DEFAULT_WINDOW


class InMemoryRateLimiter:
    """
    In-memory rate limiter with sliding window.
    
    Fallback when Redis is unavailable. Not suitable for distributed systems.
    """
    
    def __init__(self):
        self.requests = defaultdict(list)
        self.last_cleanup = datetime.utcnow()
    
    def _cleanup(self):
        """Remove old entries to prevent memory leak."""
        now = datetime.utcnow()
        if (now - self.last_cleanup).total_seconds() > 300:  # Every 5 minutes
            cutoff = now - timedelta(seconds=120)  # Keep last 2 minutes
            for key in list(self.requests.keys()):
                self.requests[key] = [
                    ts for ts in self.requests[key] if ts > cutoff
                ]
                if not self.requests[key]:
                    del self.requests[key]
            self.last_cleanup = now
    
    def is_allowed(self, key: str, limit: int, window: int) -> tuple[bool, Optional[int]]:
        """
        Check if request is allowed.
        
        Args:
            key: Unique identifier (e.g., IP address)
            limit: Maximum requests allowed
            window: Time window in seconds
        
        Returns:
            tuple: (is_allowed, retry_after_seconds)
        """
        self._cleanup()
        
        now = datetime.utcnow()
        cutoff = now - timedelta(seconds=window)
        
        # Get recent requests
        recent = [ts for ts in self.requests[key] if ts > cutoff]
        
        if len(recent) >= limit:
            # Calculate retry after
            oldest = min(recent)
            retry_after = int((oldest - cutoff).total_seconds()) + 1
            return False, retry_after
        
        # Add current request
        recent.append(now)
        self.requests[key] = recent
        
        return True, None


class RedisRateLimiter:
    """
    Redis-backed rate limiter with sliding window.
    
    Suitable for distributed systems with multiple API instances.
    """
    
    def __init__(self, redis_client):
        self.redis = redis_client
    
    async def is_allowed(self, key: str, limit: int, window: int) -> tuple[bool, Optional[int]]:
        """
        Check if request is allowed using Redis.
        
        Args:
            key: Unique identifier (e.g., IP address)
            limit: Maximum requests allowed
            window: Time window in seconds
        
        Returns:
            tuple: (is_allowed, retry_after_seconds)
        """
        try:
            now = int(time.time())
            window_start = now - window
            
            # Redis key for this limiter
            redis_key = f"rate_limit:{key}"
            
            # Remove old entries
            await self.redis.zremrangebyscore(redis_key, 0, window_start)
            
            # Count recent requests
            count = await self.redis.zcard(redis_key)
            
            if count >= limit:
                # Get oldest request in window
                oldest = await self.redis.zrange(redis_key, 0, 0, withscores=True)
                if oldest:
                    oldest_timestamp = oldest[0][1]
                    retry_after = int(oldest_timestamp - window_start) + 1
                    return False, retry_after
                return False, window
            
            # Add current request
            await self.redis.zadd(redis_key, {str(now): now})
            
            # Set expiration
            await self.redis.expire(redis_key, window * 2)
            
            return True, None
            
        except Exception as e:
            logger.warning(f"Redis rate limiter error: {e}")
            # Fail open - allow request if Redis fails
            return True, None


class RateLimitMiddleware(BaseHTTPMiddleware):
    """
    Rate limiting middleware with per-endpoint configuration.
    
    Features:
    - Per-IP rate limiting
    - Per-endpoint custom limits
    - Redis or in-memory storage
    - Clear error responses with Retry-After header
    """
    
    def __init__(self, app, redis_client=None):
        super().__init__(app)
        self.redis_limiter = RedisRateLimiter(redis_client) if redis_client else None
        self.memory_limiter = InMemoryRateLimiter()
    
    def _get_client_ip(self, request: Request) -> str:
        """Extract client IP from request headers."""
        # Check X-Forwarded-For header (proxy)
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()
        
        # Check X-Real-IP header (nginx)
        real_ip = request.headers.get("X-Real-IP")
        if real_ip:
            return real_ip.strip()
        
        # Fall back to direct connection
        if request.client:
            return request.client.host
        
        return "unknown"
    
    def _should_skip_rate_limit(self, path: str) -> bool:
        """Check if path should skip rate limiting."""
        skip_paths = [
            "/health",
            "/live",
            "/ready",
            "/docs",
            "/redoc",
            "/openapi.json",
        ]
        return any(path.startswith(skip_path) for skip_path in skip_paths)
    
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        """Process request with rate limiting."""
        path = request.url.path
        
        # Skip rate limiting for health checks and docs
        if self._should_skip_rate_limit(path):
            return await call_next(request)
        
        # Get client IP
        client_ip = self._get_client_ip(request)
        
        # Get rate limit for this endpoint
        limit, window = RateLimitConfig.get_limit(path)
        
        # Create rate limit key
        rate_key = f"{client_ip}:{path}"
        
        # Check rate limit (prefer Redis, fallback to memory)
        if self.redis_limiter:
            allowed, retry_after = await self.redis_limiter.is_allowed(rate_key, limit, window)
        else:
            allowed, retry_after = self.memory_limiter.is_allowed(rate_key, limit, window)
        
        if not allowed:
            logger.warning(
                f"Rate limit exceeded: ip={client_ip} path={path} "
                f"limit={limit}/{window}s retry_after={retry_after}s"
            )
            return JSONResponse(
                status_code=429,
                content={
                    "error": True,
                    "code": "RATE_LIMIT_EXCEEDED",
                    "message": f"Rate limit exceeded. Maximum {limit} requests per {window} seconds.",
                    "retry_after": retry_after,
                },
                headers={
                    "Retry-After": str(retry_after),
                    "X-RateLimit-Limit": str(limit),
                    "X-RateLimit-Window": str(window),
                }
            )
        
        # Process request
        response = await call_next(request)
        
        # Add rate limit headers
        response.headers["X-RateLimit-Limit"] = str(limit)
        response.headers["X-RateLimit-Window"] = f"{window}s"
        
        return response
