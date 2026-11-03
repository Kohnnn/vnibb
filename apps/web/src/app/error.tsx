'use client';

import { useEffect } from 'react';
import { logClientError } from '@/lib/clientLogger';

export default function Error({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        logClientError('Route error boundary:', error);
    }, [error]);

    return (
        <main className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)] px-4 py-8">
            <div className="w-full max-w-md rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-6 text-center sm:p-8">
                <h1 className="text-2xl font-bold text-[var(--text-primary)]">This view could not load</h1>
                <p className="mt-2 text-sm text-[var(--text-secondary)]">
                    The page failed before it finished rendering. Saved workspaces and settings are unaffected.
                </p>
                {error.digest && (
                    <p className="mt-2 font-mono text-xs text-[var(--text-muted)]">Reference: {error.digest}</p>
                )}
                <button
                    type="button"
                    onClick={reset}
                    className="mt-6 inline-flex rounded-md bg-[var(--color-accent-fill)] px-4 py-2 text-sm font-medium text-[var(--color-on-accent)] transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-primary)] focus-visible:ring-offset-2"
                >
                    Try again
                </button>
            </div>
        </main>
    );
}
