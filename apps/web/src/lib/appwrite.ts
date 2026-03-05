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
    const response = await fetch(url, {
        ...init,
        credentials: 'include',
        headers: {
            ...buildHeaders(includeJsonHeader),
            ...(init.headers || {}),
        },
    });

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
