'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';

/**
 * PredictionMarketWatchlist — small client-side favorite store.
 *
 * Lives in localStorage under a single key. Used by the
 * PredictionMarketContextMenu and the (future) TopMoversPulseWidget
 * favorites strip.
 */

const STORAGE_KEY = 'vnibb.prediction-market.watchlist';

export interface WatchlistContextValue {
    readonly watchlist: ReadonlySet<string>;
    readonly isWatching: (marketKey: string) => boolean;
    readonly toggle: (marketKey: string) => void;
}

const PredictionMarketWatchlistContext = createContext<WatchlistContextValue | null>(null);

function marketKey(market: { source: string; sourceId: string }): string {
    return `${market.source}:${market.sourceId}`;
}

export function PredictionMarketWatchlistProvider({ children }: { readonly children: React.ReactNode }) {
    const [watchlist, setWatchlist] = useState<Set<string>>(new Set());

    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            const raw = window.localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw) as string[];
            if (Array.isArray(parsed)) {
                setWatchlist(new Set(parsed));
            }
        } catch {
            // ignore corrupted storage
        }
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...watchlist]));
        } catch {
            // ignore storage failures
        }
    }, [watchlist]);

    const value = useMemo<WatchlistContextValue>(
        () => ({
            watchlist,
            isWatching: (key: string) => watchlist.has(key),
            toggle: (key: string) =>
                setWatchlist((prev) => {
                    const next = new Set(prev);
                    if (next.has(key)) {
                        next.delete(key);
                    } else {
                        next.add(key);
                    }
                    return next;
                }),
        }),
        [watchlist],
    );

    return (
        <PredictionMarketWatchlistContext.Provider value={value}>
            {children}
        </PredictionMarketWatchlistContext.Provider>
    );
}

export function usePredictionMarketWatchlist(): WatchlistContextValue {
    const ctx = useContext(PredictionMarketWatchlistContext);
    if (!ctx) {
        // Outside a provider: degrade to an in-memory watchlist that does
        // not persist. Useful in isolated widget tests.
        return {
            watchlist: new Set<string>(),
            isWatching: () => false,
            toggle: () => undefined,
        };
    }
    return ctx;
}

export function watchlistKey(market: { source: string; sourceId: string }): string {
    return marketKey(market);
}