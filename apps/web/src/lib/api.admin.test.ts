import type { Session } from '@supabase/supabase-js';
import {
    createDashboard,
    fetchAPI,
    getAdminSession,
    getAdminSystemDashboardTemplateBundle,
    saveAdminAIRuntimeConfig,
} from './api';
import { supabase } from './supabase';

jest.mock('./env', () => ({ env: { apiUrl: 'https://api.example.test' } }));
jest.mock('./supabase', () => ({
    isSupabaseConfigured: true,
    supabase: { auth: { getSession: jest.fn() } },
}));

const originalFetch = globalThis.fetch;
const fetchMock = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>();

beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    globalThis.fetch = fetchMock;
    jest.mocked(supabase!.auth.getSession).mockResolvedValue({ data: { session: null }, error: null });
});

afterEach(() => {
    globalThis.fetch = originalFetch;
    localStorage.clear();
});

test('admin endpoints reject missing Supabase authentication without contacting the API', async () => {
    await expect(getAdminSession()).rejects.toMatchObject({ status: 401 });
    await expect(getAdminSystemDashboardTemplateBundle('default-fundamental')).rejects.toMatchObject({ status: 401 });
    await expect(saveAdminAIRuntimeConfig('test/model')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
});
test('a development identity cannot authorize admin endpoints, even if a Supabase session exists', async () => {
    localStorage.setItem('vnibb_dev_user', JSON.stringify({ id: 'dev-admin', user_metadata: { role: 'admin' } }));
    jest.mocked(supabase!.auth.getSession).mockResolvedValue({
        data: { session: { access_token: 'real-token' } as Session },
        error: null,
    });
    await expect(getAdminSession()).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
});

test('an admin API request sends only the session bearer and exposes a denied response', async () => {
    jest.mocked(supabase!.auth.getSession).mockResolvedValue({
        data: { session: { access_token: 'real-token' } as Session },
        error: null,
    });
    fetchMock.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: async () => ({ detail: 'Not an admin' }),
    } as Response);
    const denied = jest.fn();
    window.addEventListener('vnibb:admin-access-denied', denied);
    try {
        await expect(getAdminSystemDashboardTemplateBundle('default-fundamental')).rejects.toMatchObject({ status: 403 });
        const [url, options] = fetchMock.mock.calls[0];
        expect(url).toBe('https://api.example.test/api/v1/admin/system-layouts/default-fundamental');
        expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer real-token');
        expect(new Headers(options?.headers).has('X-Admin-Key')).toBe(false);
        expect(denied).toHaveBeenCalledTimes(1);
    } finally {
        window.removeEventListener('vnibb:admin-access-denied', denied);
    }
});

test('dashboard JSON posts preserve client headers alongside merged content type and authentication', async () => {
    localStorage.setItem('vnibb_dashboard_client_id', 'owned-browser-client');
    jest.mocked(supabase!.auth.getSession).mockResolvedValue({
        data: { session: { access_token: 'test-session-token' } as Session },
        error: null,
    });
    const payload = { name: 'Pending workspace', description: 'Existing pending creation retry', isDefault: false };
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 42, ...payload }) } as Response);

    await createDashboard(payload);

    const [url, options] = fetchMock.mock.calls[0];
    const headers = new Headers(options?.headers);
    expect(url).toBe('https://api.example.test/api/v1/dashboard/');
    expect(options?.method).toBe('POST');
    expect(JSON.parse(String(options?.body))).toEqual(payload);
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('Authorization')).toBe('Bearer test-session-token');
    expect(headers.get('X-VNIBB-Client-ID')).toBe('owned-browser-client');
});

test('caller headers cannot replace the internal cancellation signal or JSON header merge', async () => {
    const caller = new AbortController();
    const { promise, reject } = Promise.withResolvers<Response>();
    fetchMock.mockImplementationOnce((_url, options) => {
        options?.signal?.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
        return promise;
    });

    const request = fetchAPI('/controlled-request', {
        method: 'POST', body: JSON.stringify({ value: 1 }),
        headers: { 'X-Request-Context': 'preserved' }, signal: caller.signal,
    });
    const options = fetchMock.mock.calls[0][1];
    expect(options?.signal).not.toBe(caller.signal);
    expect(new Headers(options?.headers).get('Content-Type')).toBe('application/json');
    expect(new Headers(options?.headers).get('X-Request-Context')).toBe('preserved');
    const cancelled = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    caller.abort();
    expect(options?.signal?.aborted).toBe(true);
    await cancelled;
});
