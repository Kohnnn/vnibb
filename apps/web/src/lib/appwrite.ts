/**
 * Appwrite client helpers (REST-based).
 *
 * Keeps migration lightweight without adding a hard SDK dependency.
 */

export interface AppwriteAuthError extends Error {
    code?: number;
    type?: string;
}

interface AppwriteErrorBody {
    message?: string;
    type?: string;
    code?: number;
}

export interface AppwriteAccount {
    $id: string;
    email?: string;
    name?: string;
    prefs?: Record<string, unknown>;
}

interface AppwriteJwtResponse {
    jwt?: string;
}

const APPWRITE_SESSION_HINT_KEY = 'vnibb_appwrite_session_hint';
const APPWRITE_JWT_DURATION_SECONDS = 900;

let cachedJwt: { token: string; expiresAt: number } | null = null;

const APPWRITE_ENDPOINT = (
    process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1'
).replace(/\/$/, '');

const APPWRITE_PROJECT_ID = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID || '';

const AUTH_PROVIDER_RAW = (process.env.NEXT_PUBLIC_AUTH_PROVIDER || '').toLowerCase();

export const authProvider: 'supabase' | 'appwrite' =
    AUTH_PROVIDER_RAW === 'appwrite' ? 'appwrite' : 'supabase';

export const isAppwriteConfigured = Boolean(APPWRITE_ENDPOINT && APPWRITE_PROJECT_ID);

function createAuthError(message: string, code?: number, type?: string): AppwriteAuthError {
    const err = new Error(message) as AppwriteAuthError;
    err.code = code;
    err.type = type;
    return err;
}

function ensureConfigured(): void {
    if (!isAppwriteConfigured) {
        throw createAuthError('Appwrite is not configured');
    }
}

function canUseBrowserStorage(): boolean {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function buildHeaders(includeJson: boolean): HeadersInit {
    const headers: Record<string, string> = {
        'X-Appwrite-Project': APPWRITE_PROJECT_ID,
    };

    if (includeJson) {
        headers['Content-Type'] = 'application/json';
    }

    return headers;
}

async function parseErrorBody(response: Response): Promise<AppwriteErrorBody | null> {
    try {
        return await response.json() as AppwriteErrorBody;
    } catch {
        return null;
    }
}

async function appwriteRequest<T>(
    path: string,
    init: RequestInit = {},
    includeJsonHeader = true,
): Promise<T> {
    ensureConfigured();

    const url = `${APPWRITE_ENDPOINT}${path}`;
    let response: Response;

    try {
        response = await fetch(url, {
            ...init,
            credentials: 'include',
            headers: {
                ...buildHeaders(includeJsonHeader),
                ...(init.headers || {}),
            },
        });
    } catch (error) {
        throw createAuthError(
            error instanceof Error
                ? error.message
                : 'Unable to reach Appwrite. Check CORS/session configuration.',
            0,
            'network_error',
        );
    }

    if (!response.ok) {
        const errorBody = await parseErrorBody(response);
        throw createAuthError(
            errorBody?.message || `Appwrite request failed (${response.status})`,
            errorBody?.code || response.status,
            errorBody?.type,
        );
    }

    if (response.status === 204) {
        return undefined as T;
    }

    return await response.json() as T;
}

export async function appwriteGetAccount(): Promise<AppwriteAccount> {
    return appwriteRequest<AppwriteAccount>('/account', { method: 'GET' }, false);
}

export function appwriteRememberSessionHint(): void {
    if (!canUseBrowserStorage()) {
        return;
    }

    window.localStorage.setItem(APPWRITE_SESSION_HINT_KEY, '1');
}

export function appwriteClearSessionHint(): void {
    cachedJwt = null;

    if (!canUseBrowserStorage()) {
        return;
    }

    window.localStorage.removeItem(APPWRITE_SESSION_HINT_KEY);
}

export function appwriteHasSessionHint(): boolean {
    if (!canUseBrowserStorage()) {
        return false;
    }

    return window.localStorage.getItem(APPWRITE_SESSION_HINT_KEY) === '1';
}

export async function appwriteCreateJWT(forceRefresh = false): Promise<string> {
    ensureConfigured();

    const now = Date.now();
    if (!forceRefresh && cachedJwt && cachedJwt.expiresAt > now + 30_000) {
        return cachedJwt.token;
    }

    const response = await appwriteRequest<AppwriteJwtResponse>('/account/jwts', {
        method: 'POST',
        body: JSON.stringify({ duration: APPWRITE_JWT_DURATION_SECONDS }),
    });
    const token = response?.jwt?.trim();

    if (!token) {
        throw createAuthError('Appwrite JWT response was empty');
    }

    cachedJwt = {
        token,
        expiresAt: now + APPWRITE_JWT_DURATION_SECONDS * 1000,
    };

    return token;
}

export function appwriteShouldBootstrapSession(): boolean {
    if (typeof window === 'undefined') {
        return false;
    }

    const pathname = window.location.pathname;
    return pathname.startsWith('/auth/callback') || appwriteHasSessionHint();
}

export function isAppwriteUnauthorizedError(error: unknown): boolean {
    return Boolean(
        error &&
        typeof error === 'object' &&
        'code' in error &&
        typeof (error as AppwriteAuthError).code === 'number' &&
        (error as AppwriteAuthError).code === 401,
    );
}

export async function appwriteSignInWithEmail(email: string, password: string): Promise<void> {
    await appwriteRequest('/account/sessions/email', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
    });
}

export async function appwriteSignUp(email: string, password: string): Promise<void> {
    await appwriteRequest('/account', {
        method: 'POST',
        body: JSON.stringify({
            userId: 'unique()',
            email,
            password,
        }),
    });
}

export async function appwriteSendMagicLink(email: string, callbackUrl: string): Promise<void> {
    await appwriteRequest('/account/tokens/magic-url', {
        method: 'POST',
        body: JSON.stringify({
            userId: 'unique()',
            email,
            url: callbackUrl,
        }),
    });
}

export async function appwriteCreateSessionFromToken(
    userId: string,
    secret: string,
): Promise<void> {
    await appwriteRequest('/account/sessions/token', {
        method: 'POST',
        body: JSON.stringify({ userId, secret }),
    });
}

export async function appwriteSignOutCurrentSession(): Promise<void> {
    await appwriteRequest('/account/sessions/current', { method: 'DELETE' }, false);
}

export function appwriteCreateOAuth2Url(provider: string, successUrl: string, failureUrl: string): string {
    ensureConfigured();

    const params = new URLSearchParams({
        project: APPWRITE_PROJECT_ID,
        success: successUrl,
        failure: failureUrl,
    });

    return `${APPWRITE_ENDPOINT}/account/sessions/oauth2/${provider}?${params.toString()}`;
}
