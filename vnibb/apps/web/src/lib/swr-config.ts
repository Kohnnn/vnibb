/**
 * SWR Configuration and Fetcher Utilities.
 *
 * Provides:
 * - Centralized SWR configuration
 * - Custom fetcher with error handling
 * - Revalidation strategies
 * - Request deduplication
 */

import { SWRConfiguration } from 'swr';

/**
 * Custom fetcher with error handling and response validation.
 */
export async function fetcher<T = any>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = new Error('API request failed');

    // Try to parse error response
    try {
      const errorData = await response.json();
      (error as any).info = errorData;
      (error as any).status = response.status;
    } catch {
      // If parsing fails, use status text
      (error as any).info = { message: response.statusText };
      (error as any).status = response.status;
    }

    throw error;
  }

  return response.json();
}

/**
 * Fetcher with retry logic for transient errors.
 */
export async function fetcherWithRetry<T = any>(
  url: string,
  options?: RequestInit,
  retries = 2
): Promise<T> {
  try {
    return await fetcher<T>(url, options);
  } catch (error: any) {
    // Retry on network errors or 5xx errors
    const shouldRetry =
      error.status >= 500 ||
      error.message.includes('fetch') ||
      error.message.includes('network');

    if (retries > 0 && shouldRetry) {
      // Exponential backoff
      await new Promise(resolve =>
        setTimeout(resolve, Math.pow(2, 3 - retries) * 1000)
      );
      return fetcherWithRetry<T>(url, options, retries - 1);
    }

    throw error;
  }
}

/**
 * Default SWR configuration.
 */
export const defaultSWRConfig: SWRConfiguration = {
  fetcher,

  // Revalidation
  revalidateOnFocus: false,
  revalidateOnReconnect: true,
  revalidateIfStale: true,

  // Deduplication
  dedupingInterval: 2000, // 2 seconds

  // Cache
  shouldRetryOnError: false,

  // Error retry
  errorRetryCount: 2,
  errorRetryInterval: 1000,

  // Suspense
  suspense: false,
};

/**
 * SWR configuration for market data (frequent updates).
 */
export const marketDataSWRConfig: SWRConfiguration = {
  ...defaultSWRConfig,

  // Shorter cache time for real-time data
  dedupingInterval: 1000, // 1 second

  // Auto-refresh every 60 seconds
  refreshInterval: 60000,

  // Don't refresh when window is not focused
  refreshWhenHidden: false,
  refreshWhenOffline: false,

  // Revalidate on focus for real-time data
  revalidateOnFocus: true,
};

/**
 * SWR configuration for static/reference data.
 */
export const staticDataSWRConfig: SWRConfiguration = {
  ...defaultSWRConfig,

  // Longer cache time for static data
  dedupingInterval: 5 * 60 * 1000, // 5 minutes

  // Revalidate on mount if data is stale (5 min)
  revalidateIfStale: true,

  // Don't auto-refresh
  refreshInterval: 0,

  // Cache for longer
  focusThrottleInterval: 5 * 60 * 1000, // 5 minutes
};

/**
 * SWR configuration for user-specific data.
 */
export const userDataSWRConfig: SWRConfiguration = {
  ...defaultSWRConfig,

  // Medium cache time
  dedupingInterval: 30 * 1000, // 30 seconds

  // Revalidate on focus for user data
  revalidateOnFocus: true,

  // Auto-refresh every 5 minutes
  refreshInterval: 5 * 60 * 1000,
};

/**
 * Get appropriate SWR config based on data type.
 */
export function getSWRConfig(dataType: 'market' | 'static' | 'user' = 'market'): SWRConfiguration {
  switch (dataType) {
    case 'market':
      return marketDataSWRConfig;
    case 'static':
      return staticDataSWRConfig;
    case 'user':
      return userDataSWRConfig;
    default:
      return defaultSWRConfig;
  }
}

/**
 * Generate SWR key with automatic serialization.
 */
export function swrKey(
  endpoint: string,
  params?: Record<string, any>
): string | [string, Record<string, any>] {
  if (!params || Object.keys(params).length === 0) {
    return endpoint;
  }

  // Remove undefined/null values
  const cleanParams = Object.entries(params).reduce((acc, [key, value]) => {
    if (value !== undefined && value !== null) {
      acc[key] = value;
    }
    return acc;
  }, {} as Record<string, any>);

  return [endpoint, cleanParams];
}

/**
 * Mutate multiple SWR keys with a pattern.
 */
export async function mutatePattern(
  pattern: RegExp | string,
  mutate: (key: string) => Promise<void>
): Promise<void> {
  // Note: This is a placeholder - actual implementation would need
  // access to SWR's cache which is managed by the SWRConfig provider
  console.warn('mutatePattern not fully implemented - needs SWR cache access');
}
