type APIErrorLike = Error & {
    status?: number;
    statusText?: string;
};

function isAPIError(error: unknown): error is APIErrorLike {
    return error instanceof Error && (error.name === 'APIError' || error.name === 'RateLimitError');
}

export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
    if (failureCount >= 3 || (isAPIError(error) && error.name === 'RateLimitError')) {
        return false;
    }

    if (isAPIError(error)) {
        return error.status === 408 || (error.status ?? -1) >= 500 || (
            error.status === 0 &&
            (error.statusText === 'NetworkError' || error.statusText === 'UnknownError')
        );
    }

    return error instanceof TypeError && /fetch|network|load failed/i.test(error.message);
}

export function queryRetryDelay(attemptIndex: number): number {
    return Math.min(1000 * 2 ** attemptIndex, 30000);
}
