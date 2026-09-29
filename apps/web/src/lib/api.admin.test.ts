import type { Session } from '@supabase/supabase-js';
import {
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
