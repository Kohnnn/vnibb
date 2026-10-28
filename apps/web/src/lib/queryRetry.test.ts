import { APIError, RateLimitError } from './api';
import { createQueryClient } from './QueryProvider';
import { queryRetryDelay, shouldRetryQuery } from './queryRetry';

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
