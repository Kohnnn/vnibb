/**
 * API Cache Utility
 * 
 * Provides a simple in-memory cache for API responses to improve perceived performance
 * and reduce duplicate network requests.
 * 
 * NOTE: This complements TanStack Query by providing a way to share data
 * across disparate parts of the application or for data that doesn't 
 * fit strictly into the Query lifecycle.
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

class ApiCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  
  /**
   * Get data from cache
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    // Check if expired
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.data as T;
  }
  
  /**
   * Set data in cache
   */
  set<T>(key: string, data: T, ttlMs: number = 60000): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: ttlMs,
    });
  }
  
  /**
   * Invalidate cache entries by prefix
   */
  invalidate(keyPrefix: string): void {
    for (const key of Array.from(this.cache.keys())) {
      if (key.startsWith(keyPrefix)) {
        this.cache.delete(key);
      }
    }
  }
  
  /**
   * Clear all cache
   */
  clear(): void {
    this.cache.clear();
  }
}

export const apiCache = new ApiCache();

// TTL constants (in milliseconds)
export const CACHE_TTL = {
  QUOTE: 30 * 1000,           // 30 seconds
  INTRADAY: 60 * 1000,        // 1 minute
  PROFILE: 10 * 60 * 1000,    // 10 minutes
  FINANCIALS: 60 * 60 * 1000, // 1 hour
  SCREENER: 5 * 60 * 1000,    // 5 minutes
  TECHNICAL: 5 * 60 * 1000,   // 5 minutes
} as const;
