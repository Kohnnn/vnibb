// API Error Classes

/**
 * Custom API Error class with additional details
 */
export class APIError extends Error {
    status?: number;
    statusText?: string;

    constructor(message: string, status?: number, statusText?: string) {
        super(message);
        this.name = 'APIError';
        this.status = status;
        this.statusText = statusText;
    }
}

/**
 * Specialized error for 429 Rate Limit responses
 */
export class RateLimitError extends APIError {
    retryAfter: number; // in seconds

    constructor(message: string, retryAfter: number = 60) {
        super(message, 429, 'Too Many Requests');
        this.name = 'RateLimitError';
        this.retryAfter = retryAfter;
    }
}
