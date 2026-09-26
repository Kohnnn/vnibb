import { openCopilotChatStream, type CopilotStreamRequest } from './api';
import { DEFAULT_AI_SETTINGS } from './aiSettings';
import { supabase } from './supabase';

jest.mock('./env', () => ({ env: { apiUrl: 'https://api.example.test' } }));
jest.mock('./supabase', () => ({
    isSupabaseConfigured: true,
    supabase: { auth: { getSession: jest.fn() } },
}));

const selection = {
    snapshot_id: 'owned-snapshot',
    result_ids: Array.from({ length: 10 }, (_, index) => `company-${index + 1}-result`),
};
const request: CopilotStreamRequest = {
    message: 'Compare the selected frozen results',
    matrix_selection: selection,
    history: [],
    settings: DEFAULT_AI_SETTINGS,
};
const originalFetch = globalThis.fetch;
const fetchMock = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>();

beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    globalThis.fetch = fetchMock;
    fetchMock.mockResolvedValue({ ok: true, status: 200 } as Response);
    jest.mocked(supabase!.auth.getSession).mockResolvedValue({ data: { session: null }, error: null });
});

afterEach(() => {
    globalThis.fetch = originalFetch;
    localStorage.clear();
});

test('rejects a Matrix send without an authenticated session before any network request', async () => {
    await expect(openCopilotChatStream(request)).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
});

test('sends every selected reference unchanged with the session token exclusively in Authorization', async () => {
    const token = 'test-session-access-token';
    jest.mocked(supabase!.auth.getSession).mockResolvedValue({
        data: {
            session: {
                access_token: token,
                refresh_token: 'test-refresh-token',
                token_type: 'bearer',
                expires_in: 3600,
                user: { id: 'owner', app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-01-01T00:00:00Z' },
            },
        },
        error: null,
    });

    await openCopilotChatStream(request);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.test/api/v1/copilot/chat/stream');
    expect(options?.method).toBe('POST');
    expect(new Headers(options?.headers).get('Authorization')).toBe(`Bearer ${token}`);
    const body = String(options?.body);
    expect(JSON.parse(body).matrix_selection).toEqual(selection);
    expect(JSON.parse(body).message).toBe(request.message);
    expect(body).not.toContain(token);
    expect(body).not.toContain('test-refresh-token');
    expect(JSON.parse(body).context).toBeUndefined();
});

test('does not accept a local development identity as Matrix authorization', async () => {
    localStorage.setItem('vnibb_dev_user', JSON.stringify({ id: 'local-admin' }));
    await expect(openCopilotChatStream(request)).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
});
