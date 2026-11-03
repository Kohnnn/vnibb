'use client';

import { useEffect, useState } from 'react';

/**
 * Offline presentation for the dashboard. Shows only when the browser reports
 * no network; saved workspaces and cached snapshots stay readable, nothing is
 * refetched and no data is presented as fresh.
 */
export function OfflineBanner() {
    const [offline, setOffline] = useState(false);

    useEffect(() => {
        const update = () => setOffline(!navigator.onLine);
        update();
        window.addEventListener('online', update);
        window.addEventListener('offline', update);
        return () => {
            window.removeEventListener('online', update);
            window.removeEventListener('offline', update);
        };
    }, []);

    if (!offline) return null;

    return (
        <div
            role="status"
            aria-live="polite"
            className="flex flex-wrap items-center gap-2 border-b border-[var(--color-state-border)] bg-[var(--color-state-bg)] px-4 py-2 text-xs text-[var(--text-secondary)]"
        >
            <span className="font-semibold text-[var(--text-primary)]">You are offline.</span>
            <span>Saved workspaces stay readable. Quotes, statements and agent answers will not update until the connection returns.</span>
        </div>
    );
}
