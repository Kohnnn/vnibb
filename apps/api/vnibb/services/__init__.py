"""
Services module - Business logic and data orchestration.
"""

from vnibb.services.fallback_resolver import FallbackResolver
from vnibb.services.cache_manager import CacheManager, CacheResult

__all__ = ["FallbackResolver", "CacheManager", "CacheResult"]
