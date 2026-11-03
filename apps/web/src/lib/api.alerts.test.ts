import { getInsiderAlerts } from './api';

// A malformed body must be an error, not a silent empty feed: the bell panel
// renders "No alert activity" for an empty array, which would be a false claim.

jest.mock('./env', () => ({ env: { apiUrl: 'https://api.example.test' } }));
jest.mock('./supabase', () => ({
  isSupabaseConfigured: false,
  supabase: null,
}));

const originalFetch = globalThis.fetch;
const fetchMock = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>();

const respond = (body: unknown) => {
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response);
};

beforeEach(() => {
  jest.clearAllMocks();
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('getInsiderAlerts payload normalization', () => {
  it('returns the array payload unchanged', async () => {
    const alerts = [{ id: 1, title: 'Insider buy', read: false }];
    respond(alerts);
    await expect(getInsiderAlerts()).resolves.toEqual(alerts);
  });

  it('rejects a payload that is neither an array nor a { data } envelope', async () => {
    respond({ detail: 'unexpected envelope' });
    await expect(getInsiderAlerts()).rejects.toThrow('Unexpected alerts payload');
  });

  it('unwraps a { data } envelope', async () => {
    const alerts = [{ id: 2, title: 'Insider sell', read: false }];
    respond({ data: alerts });
    await expect(getInsiderAlerts()).resolves.toEqual(alerts);
  });

  it('returns a genuinely empty feed as an empty array', async () => {
    // A real empty feed must stay distinguishable from a malformed payload.
    respond([]);
    await expect(getInsiderAlerts()).resolves.toEqual([]);
  });
});
