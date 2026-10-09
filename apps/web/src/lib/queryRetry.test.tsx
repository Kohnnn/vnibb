import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { APIError, RateLimitError } from './api';
import { createQueryClient } from './QueryProvider';
import { queryRetryDelay, shouldRetryQuery } from './queryRetry';
import { queryKeys, useHistoricalPrices } from './queries';
import { useHistoricalPrices as useModularHistoricalPrices } from './queries/equity';
import type { EquityHistoricalResponse } from '@/types/equity';

jest.mock('./env', () => ({ env: { apiUrl: 'https://api.example.test' } }));
jest.mock('./supabase', () => ({ isSupabaseConfigured: false, supabase: null }));

describe('shouldRetryQuery', () => {
    it.each([
        [new APIError('timeout', 408, 'Timeout')],
        [new APIError('server error', 500, 'Internal Server Error')],
        [new APIError('gateway error', 503, 'Service Unavailable')],
        [new APIError('network error', 0, 'NetworkError')],
        [new APIError('unknown network error', 0, 'UnknownError')],
        [new TypeError('Failed to fetch')],
        [new TypeError('Network request failed')],
    ])('retries transient errors', (error) => {
        expect(shouldRetryQuery(0, error)).toBe(true);
    });

    it.each([
        [new RateLimitError('rate limited')],
        [new APIError('unauthorized', 401, 'Unauthorized')],
        [new APIError('forbidden', 403, 'Forbidden')],
        [new APIError('not found', 404, 'Not Found')],
        [new APIError('bad request', 400, 'Bad Request')],
        [new APIError('rate limited', 429, 'Too Many Requests')],
        [new APIError('offline', 0, 'Offline')],
        [new APIError('mixed content', 0, 'MixedContent')],
        [new DOMException('aborted', 'AbortError')],
        [new TypeError('invalid value')],
        [new Error('deterministic failure')],
    ])('does not retry deterministic errors', (error) => {
        expect(shouldRetryQuery(0, error)).toBe(false);
    });

    it('allows three retries and then stops', () => {
        const error = new APIError('server error', 500, 'Internal Server Error');

        expect(shouldRetryQuery(2, error)).toBe(true);
        expect(shouldRetryQuery(3, error)).toBe(false);
    });
});

describe('queryRetryDelay', () => {
    it('uses capped exponential backoff', () => {
        expect(queryRetryDelay(0)).toBe(1000);
        expect(queryRetryDelay(1)).toBe(2000);
        expect(queryRetryDelay(5)).toBe(30000);
    });
});

describe('createQueryClient', () => {
    it('does not retry failed default mutations', async () => {
        const mutationFn = jest.fn().mockRejectedValue(new Error('failed'));
        const client = createQueryClient();
        const mutation = client.getMutationCache().build(client, { mutationFn });

        await expect(mutation.execute(undefined)).rejects.toThrow('failed');

        expect(mutationFn).toHaveBeenCalledTimes(1);
    });
});

describe.each([
    ['public', useHistoricalPrices],
    ['modular', useModularHistoricalPrices],
] as const)('%s historical query cancellation', (_name, useHistory) => {
    it('aborts the obsolete symbol fetch and delivers the new symbol history', async () => {
        const client = createQueryClient();
        const originalFetch = globalThis.fetch;
        const onObsoleteAbort = jest.fn();
        let obsoleteSignal: AbortSignal | undefined;
        let currentSignal: AbortSignal | undefined;
        let finishObsolete: ((response: Response) => void) | undefined;
        const history: EquityHistoricalResponse = {
            data: [{ symbol: 'VNM', time: '2026-10-02', open: 63000, high: 65000, low: 62000, close: 64000, volume: 100000 }],
            meta: { count: 1 },
        };
        const response = { ok: true, json: async () => history } as Response;
        const fetchMock = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>((input, init) => {
            const url = new URL(String(input));
            expect(url.pathname).toBe('/api/v1/equity/historical');
            const symbol = url.searchParams.get('symbol');
            if (symbol === 'FPT') {
                const requestSignal = init?.signal as AbortSignal;
                obsoleteSignal = requestSignal;
                return new Promise<Response>((resolve, reject) => {
                    finishObsolete = resolve;
                    requestSignal.addEventListener('abort', () => {
                        onObsoleteAbort();
                        reject(new DOMException('Request aborted', 'AbortError'));
                    }, { once: true });
                });
            }
            expect(symbol).toBe('VNM');
            currentSignal = init?.signal as AbortSignal;
            return Promise.resolve(response);
        });
        globalThis.fetch = fetchMock;
        const wrapper = ({ children }: { children: ReactNode }) =>
            <QueryClientProvider client={client}>{children}</QueryClientProvider>;
        const view = renderHook(({ symbol }) => useHistory(symbol, { interval: '1D', source: 'KBS' }), {
            initialProps: { symbol: 'FPT' },
            wrapper,
        });

        try {
            await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
            expect(obsoleteSignal?.aborted).toBe(false);
            expect(view.result.current.isFetching).toBe(true);

            view.rerender({ symbol: 'VNM' });

            await waitFor(() => expect(onObsoleteAbort).toHaveBeenCalledTimes(1));
            expect(obsoleteSignal?.aborted).toBe(true);
            await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
            expect(view.result.current.data).toEqual(history);
            expect(currentSignal?.aborted).toBe(false);
            expect(fetchMock).toHaveBeenCalledTimes(2);
            const obsoleteKey = queryKeys.historical('FPT', { interval: '1D', source: 'KBS' });
            expect(client.getQueryData(obsoleteKey)).toBeUndefined();
            expect(client.getQueryState(obsoleteKey)?.fetchStatus).toBe('idle');
        } finally {
            view.unmount();
            finishObsolete?.(response);
            client.clear();
            globalThis.fetch = originalFetch;
        }
    });
});
