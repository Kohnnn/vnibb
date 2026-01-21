import asyncio
import logging
from functools import wraps
from typing import TypeVar, Callable, Any, Optional
import time

logger = logging.getLogger(__name__)

T = TypeVar('T')

def with_retry(
    max_retries: int = 3,
    base_delay: float = 1.0,
    max_delay: float = 30.0,
    exponential: bool = True,
    exceptions: tuple = (Exception,)
):
    """
    Decorator for retrying async functions with exponential backoff.
    """
    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        @wraps(func)
        async def wrapper(*args, **kwargs):
            delay = base_delay
            last_exception = None
            
            for attempt in range(max_retries + 1):
                try:
                    return await func(*args, **kwargs)
                except exceptions as e:
                    last_exception = e
                    if attempt < max_retries:
                        logger.warning(
                            f"Attempt {attempt + 1} failed for {func.__name__}: {str(e)}. "
                            f"Retrying in {delay:.2f}s..."
                        )
                        await asyncio.sleep(delay)
                        if exponential:
                            delay = min(delay * 2, max_delay)
                    else:
                        logger.error(
                            f"All {max_retries + 1} attempts failed for {func.__name__}."
                        )
            
            if last_exception:
                raise last_exception
        return wrapper
    return decorator

class CircuitBreaker:
    """
    Simple Circuit Breaker pattern implementation.
    """
    def __init__(self, failure_threshold: int = 5, reset_timeout: int = 60):
        self.failure_threshold = failure_threshold
        self.reset_timeout = reset_timeout
        self.failures = 0
        self.last_failure_time: Optional[float] = None
        self.state = "CLOSED" # CLOSED, OPEN, HALF_OPEN
        
    def is_available(self) -> bool:
        if self.state == "OPEN":
            if time.time() - self.last_failure_time > self.reset_timeout:
                self.state = "HALF_OPEN"
                return True
            return False
        return True
        
    def record_failure(self):
        self.failures += 1
        self.last_failure_time = time.time()
        if self.failures >= self.failure_threshold:
            self.state = "OPEN"
            logger.error(f"Circuit breaker opened due to {self.failures} failures")
            
    def record_success(self):
        self.failures = 0
        self.state = "CLOSED"
        self.last_failure_time = None

def circuit_breaker(cb: CircuitBreaker):
    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        @wraps(func)
        async def wrapper(*args, **kwargs):
            if not cb.is_available():
                logger.warning(f"Circuit breaker is OPEN for {func.__name__}. Skipping.")
                raise RuntimeError(f"Circuit breaker is OPEN for {cb.reset_timeout}s")
            try:
                result = await func(*args, **kwargs)
                cb.record_success()
                return result
            except Exception as e:
                cb.record_failure()
                raise e
        return wrapper
    return decorator

# Shared instances for providers
vnstock_cb = CircuitBreaker(failure_threshold=10, reset_timeout=300)
