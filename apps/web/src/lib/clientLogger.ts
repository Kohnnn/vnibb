'use client';

export function logClientError(...args: unknown[]) {
    if (process.env.NODE_ENV !== 'production') {
        console.error(...args);
    }
}

export function logClientWarn(...args: unknown[]) {
    if (process.env.NODE_ENV !== 'production') {
        console.warn(...args);
    }
}

export function logClientInfo(...args: unknown[]) {
    if (process.env.NODE_ENV !== 'production') {
        console.log(...args);
    }
}
