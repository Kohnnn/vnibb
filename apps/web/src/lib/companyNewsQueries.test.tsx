import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useCompanyNews as useLegacyCompanyNews } from './queries';
import { useCompanyNews as useModularCompanyNews } from './queries/equity';

jest.mock('./env', () => ({ env: { apiUrl: 'https://api.example.test' } }));
jest.mock('./supabase', () => ({ isSupabaseConfigured: false, supabase: null }));

const hooks = [useLegacyCompanyNews, useModularCompanyNews] as const;

test.each(hooks)('company news query distinguishes failure from empty and retains last good data', async useCompanyNews => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const empty = { data: [], meta: { count: 0 }, error: null };
  const observed = { data: [{ title: 'HPG issuer update' }], meta: { count: 1 }, error: null };
  const outcomes = [{ ...empty, error: 'private upstream details' }, empty, observed, { ...empty, error: 'private upstream details' }];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = jest.fn(async (input: RequestInfo | URL) => {
    expect(new URL(String(input)).pathname).toBe('/api/v1/equity/HPG/news');
    const body = outcomes.shift();
    if (!body) throw new Error('Unexpected news request');
    return { ok: true, status: 200, headers: new Headers(), json: async () => body } as Response;
  });
  const view = renderHook(() => useCompanyNews('HPG'), { wrapper });
  const refresh = () => act(async () => { await view.result.current.refetch(); });
  try {
    await waitFor(() => expect(view.result.current).toMatchObject({ isError: true, data: undefined, error: { message: 'Company news unavailable' } }));
    await refresh();
    await waitFor(() => expect(view.result.current).toMatchObject({ isSuccess: true, data: empty, error: null }));
    await refresh();
    await waitFor(() => expect(view.result.current.data).toEqual(observed));
    await refresh();
    await waitFor(() => expect(view.result.current).toMatchObject({ isError: true, data: observed, error: { message: 'Company news unavailable' } }));
    expect(outcomes).toHaveLength(0);
  } finally {
    view.unmount();
    client.clear();
    globalThis.fetch = originalFetch;
  }
});
