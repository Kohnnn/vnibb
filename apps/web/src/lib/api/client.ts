// Core Fetch Client

import {
    appwriteClearSessionHint,
    appwriteCreateJWT,
    authProvider,
    isAppwriteConfigured,
    isAppwriteUnauthorizedError,
} from '@/lib/appwrite';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { APIError, RateLimitError } from './errors';
import { API_BASE_URL, getDashboardClientId } from './config';

export interface FetchOptions extends RequestInit {
    params?: Record<string, string | number | boolean | undefined>;
    timeout?: number; // Custom timeout in milliseconds
    auth?: 'required' | 'optional' | 'none';
}

async function getAuthorizationToken(): Promise<string | null> {
    if (typeof window === 'undefined') {
        return null;
    }

    if (window.localStorage.getItem('vnibb_dev_user')) {
        return null;
    }

    if (supabase && isSupabaseConfigured) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
            return session.access_token;
        }
    }

    if (authProvider === 'appwrite') {
        if (!isAppwriteConfigured) {
            return null;
        }

        try {
            return await appwriteCreateJWT();
        } catch (error) {
            if (isAppwriteUnauthorizedError(error)) {
                appwriteClearSessionHint();
                return null;
            }
            throw error;
        }
    }

    return null;
}

/**
 * Wrapper for fetch with error handling and query params
 * - Adds configurable timeout (default 30s, can be overridden)
 * - Detects network errors
 * - Provides structured error responses
 * - Supports abort signals from calling code
 */
export async function fetchAPI<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
    const { params, timeout = 30000, signal, auth = 'none', ...fetchOptions } = options;

    let url = `${API_BASE_URL}${endpoint}`;

    if (params) {
        const searchParams = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined) {
                searchParams.append(key, String(value));
            }
        });
        const queryString = searchParams.toString();
        if (queryString) {
            url += `?${queryString}`;
        }
    }

    const isBrowser = typeof window !== 'undefined';

    if (isBrowser && window.location.protocol === 'https:' && API_BASE_URL.startsWith('http://')) {
        throw new APIError(
            'Mixed content blocked. API URL must use HTTPS for secure pages.',
            0,
            'MixedContent'
        );
    }

    if (isBrowser && !navigator.onLine) {
        throw new APIError('You are offline. Please check your internet connection.', 0, 'Offline');
    }

    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort();
    if (signal) {
        if (signal.aborted) {
            controller.abort();
        } else {
            signal.addEventListener('abort', abortFromCaller, { once: true });
        }
    }
    const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeout);
    const requestSignal = controller.signal;
    const method = String(fetchOptions.method || 'GET').toUpperCase();
    const headers = new Headers(fetchOptions.headers || {});
    const rawBody = fetchOptions.body;
    const shouldJsonEncodeBody =
        rawBody !== undefined &&
        rawBody !== null &&
        typeof rawBody === 'object' &&
        !(rawBody instanceof FormData) &&
        !(rawBody instanceof URLSearchParams) &&
        !(rawBody instanceof Blob) &&
        !(rawBody instanceof ArrayBuffer);
    const requestBody = shouldJsonEncodeBody ? JSON.stringify(rawBody) : rawBody;
    const hasBody = requestBody !== undefined && requestBody !== null;

    if (auth !== 'none' && !headers.has('Authorization')) {
        try {
            const token = await getAuthorizationToken();
            if (!token && auth === 'required') {
                throw new APIError('Authentication required. Please log in.', 401, 'Unauthorized');
            }
            if (token) {
                headers.set('Authorization', `Bearer ${token}`);
            }
        } catch (error) {
            if (auth === 'required') {
                throw error;
            }
        }
    }

    // Add client ID header
    const clientId = getDashboardClientId();
    if (clientId && !headers.has('X-VNIBB-Client-ID')) {
        headers.set('X-VNIBB-Client-ID', clientId);
    }

    if (hasBody && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }

    if (!hasBody && (method === 'GET' || method === 'HEAD') && headers.get('Content-Type') === 'application/json') {
        headers.delete('Content-Type');
    }

    try {
        const response = await fetch(url, {
            headers,
            signal: requestSignal,
            ...fetchOptions,
            body: requestBody,
        });

        clearTimeout(timeoutId);
        if (signal) signal.removeEventListener('abort', abortFromCaller);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({
                detail: response.statusText || 'Unknown error'
            }));

            const detailSource = errorData.detail ?? errorData.message ?? errorData.details ?? null;
            const normalizedDetail = Array.isArray(detailSource)
                ? detailSource
                    .map((item: unknown) => {
                        const loc = (item as Record<string, unknown>)?.loc;
                        const location = Array.isArray(loc) ? loc.join('.') : null;
                        const msg = (item as Record<string, unknown>)?.msg;
                        return location ? `${location}: ${msg || 'invalid'}` : String(msg || 'invalid');
                    })
                    .join('; ')
                : typeof detailSource === 'string'
                    ? detailSource
                    : detailSource
                        ? JSON.stringify(detailSource)
                        : null;

            let errorMessage = normalizedDetail || `API Error: ${response.status}`;

            if (response.status === 429) {
                const retryAfterHeader = response.headers.get('Retry-After');
                const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 60;
                errorMessage = `Too many requests. Please try again in ${retryAfter} seconds.`;
                throw new RateLimitError(errorMessage, retryAfter);
            } else if (response.status >= 500) {
                errorMessage = `Server error (${response.status}). ${errorData.detail || 'Please try again later.'}`;
            } else if (response.status === 404) {
                errorMessage = 'The requested data could not be found.';
            } else if (response.status === 401) {
                errorMessage = 'Authentication required. Please log in.';
            } else if (response.status === 403) {
                errorMessage = "You don't have permission to access this data.";
            }

            throw new APIError(errorMessage, response.status, response.statusText);
        }

        return response.json();
    } catch (error: unknown) {
        clearTimeout(timeoutId);
        if (signal) signal.removeEventListener('abort', abortFromCaller);

        if (error instanceof Error && error.name === 'AbortError') {
            if (!timedOut) {
                throw error;
            }
            const timeoutSec = Math.round(timeout / 1000);
            throw new APIError(
                `Request timed out after ${timeoutSec} seconds. The server is slow or unavailable.`,
                408,
                'Timeout'
            );
        }

        if (error instanceof TypeError && error.message.includes('fetch')) {
            throw new APIError('Network error. Unable to connect to the server.', 0, 'NetworkError');
        }

        if (error instanceof APIError) {
            throw error;
        }

        throw new APIError((error as Error).message || 'An unexpected error occurred', 0, 'UnknownError');
    }
}
