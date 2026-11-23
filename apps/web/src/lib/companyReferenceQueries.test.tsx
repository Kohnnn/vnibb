import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useOfficers, useSubsidiaries } from './queries';
import { useOfficers as useModularOfficers, useSubsidiaries as useModularSubsidiaries } from './queries/equity';
import { createQueryClient } from './QueryProvider';

jest.mock('./env', () => ({ env: { apiUrl: 'https://api.example.test' } }));
jest.mock('./supabase', () => ({ isSupabaseConfigured: false, supabase: null }));

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 300, status, headers: new Headers(), json: async () => body } as Response;
}

const receivedAt = Date.parse('2026-11-23T05:00:00Z');
const failedAt = Date.parse('2026-11-23T05:20:00Z');
const routes = [
  { path: 'officers', row: { symbol: 'HPG', name: 'Fixture officer' }, legacy: useOfficers, modular: useModularOfficers },
  { path: 'subsidiaries', row: { symbol: 'HPG', company_name: 'Fixture company' }, legacy: useSubsidiaries, modular: useModularSubsidiaries },
] as const;
const surfaces = ['legacy', 'modular'] as const;

describe.each(routes)('$path query', ({ path, row, ...hooks }) => {
  test.each(surfaces)('%s export separates a failed envelope from empty success and retains the last successful observation', async surface => {
    const useReferenceQuery = hooks[surface];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const empty = { data: [], meta: { count: 0 }, error: null };
    const observed = { data: [row], meta: { count: 1, last_data_date: '2026-10-30' }, error: null };
    const outcomes = [
      jsonResponse({ ...empty, error: 'Provider unavailable' }),
      jsonResponse(empty),
      jsonResponse(observed),
      jsonResponse({ ...empty, meta: { count: 0, last_data_date: '2026-11-23' }, error: 'Request timed out' }),
      jsonResponse({ detail: 'Service unavailable' }, 503),
      jsonResponse(empty),
    ];
    const originalFetch = globalThis.fetch;
    const fetchMock = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>(async input => {
      expect(new URL(String(input)).pathname).toBe(`/api/v1/equity/HPG/${path}`);
      const response = outcomes.shift();
      if (!response) throw new Error('Unexpected reference request');
      return response;
    });
    globalThis.fetch = fetchMock;
    const clock = jest.spyOn(Date, 'now').mockReturnValue(receivedAt);
    const view = renderHook(() => useReferenceQuery('HPG'), { wrapper });
    const refresh = () => act(async () => { await view.result.current.refetch(); });
    try {
      await waitFor(() => expect(view.result.current.error?.message).toBe('Provider unavailable'));
      expect(view.result.current).toMatchObject({ isError: true, data: undefined, dataUpdatedAt: 0 });

      await refresh();
      await waitFor(() => expect(view.result.current).toMatchObject({ isSuccess: true, data: empty, error: null }));

      await refresh();
      await waitFor(() => expect(view.result.current.data).toEqual(observed));
      expect(view.result.current.dataUpdatedAt).toBe(receivedAt);

      clock.mockReturnValue(failedAt);
      await refresh();
      await waitFor(() => expect(view.result.current).toMatchObject({
        isError: true, error: { message: 'Provider request timed out' },
        data: observed, dataUpdatedAt: receivedAt, errorUpdatedAt: failedAt,
      }));

      await refresh();
      await waitFor(() => expect(view.result.current).toMatchObject({
        isError: true, error: { name: 'APIError', status: 503 }, data: observed, dataUpdatedAt: receivedAt,
      }));

      await refresh();
      await waitFor(() => expect(view.result.current).toMatchObject({ isSuccess: true, data: empty, error: null }));
      expect(outcomes).toHaveLength(0);
      expect(fetchMock.mock.calls.map(([, init]) => init?.cache)).toEqual(Array(6).fill('no-store'));
    } finally {
      view.unmount();
      client.clear();
      globalThis.fetch = originalFetch;
      clock.mockRestore();
    }
  });

  test.each([200, 503])('ends the attempt if the HTTP %d body stalls, without admitting data', async status => {
    jest.useFakeTimers({ now: receivedAt });
    const client = createQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const originalFetch = globalThis.fetch;
    const fetchMock = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => ({
      ...jsonResponse(null, status),
      json: () => {
        const { promise, reject } = Promise.withResolvers<unknown>();
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        return promise;
      },
    }));
    globalThis.fetch = fetchMock;
    const view = renderHook(() => hooks.modular('HPG'), { wrapper });
    try {
      await act(async () => { await jest.advanceTimersByTimeAsync(29_999); });
      expect(view.result.current).toMatchObject({ fetchStatus: 'fetching', data: undefined });

      await act(async () => { await jest.advanceTimersByTimeAsync(2); });
      expect(view.result.current).toMatchObject({
        isError: true, fetchStatus: 'idle', data: undefined, dataUpdatedAt: 0,
        error: { name: 'APIError', status: 408, statusText: 'Timeout' },
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const empty = { data: [], meta: { count: 0 }, error: null };
      fetchMock.mockResolvedValueOnce(jsonResponse(empty));
      await act(async () => { await view.result.current.refetch(); });
      await act(async () => { await jest.advanceTimersByTimeAsync(1); });
      expect(view.result.current).toMatchObject({ isSuccess: true, data: empty, error: null });
    } finally {
      view.unmount();
      client.clear();
      globalThis.fetch = originalFetch;
      jest.useRealTimers();
    }
  });
});
