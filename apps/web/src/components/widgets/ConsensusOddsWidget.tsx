'use client';

import { useCallback, useEffect, useState } from 'react';
import { Layers } from 'lucide-react';
import { WidgetEmpty, WidgetError, WidgetLoading } from '@/components/ui/widget-states';
import { API_BASE_URL } from '@/lib/api';

/**
 * Consensus Odds widget.
 *
 * Multi-source readout: takes a single question (currently the
 * top-of-feed market) and renders side-by-side comparisons across Polymarket
 * and Kalshi. Used to spot agreement / disagreement between regulated
 * (Kalshi) and offshore (Polymarket) platforms.
 */

type ConsensusRow = {
    readonly question: string;
    readonly source: string;
    readonly yesPrice: number;
    readonly url: string | null;
};

type LoadState =
    | { readonly kind: 'loading' }
    | { readonly kind: 'error'; readonly error: Error }
    | { readonly kind: 'ready'; readonly rows: readonly ConsensusRow[] };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function ConsensusOddsWidget() {
    const [state, setState] = useState<LoadState>({ kind: 'loading' });

    const refresh = useCallback(() => {
        setState({ kind: 'loading' });
        const sources = ['polymarket', 'kalshi'];
        const limit = 30;
        Promise.all(
            sources.map((source) =>
                fetch(
                    `${API_BASE_URL}/prediction-markets?source=${source}&active=true&limit=${limit}`,
                    { cache: 'no-store' },
                ).then(async (response) => {
                    if (!response.ok)
                        throw new Error(`${source} API returned ${response.status}`);
                    if (!response.ok) return [];
                    const body = await response.json();
                    if (!isRecord(body)) return [];
                    const data = Array.isArray(body.data) ? body.data : [];
                    return data.map((row): ConsensusRow | null => {
                        if (!isRecord(row) || typeof row.question !== 'string') return null;
                        const pricesRaw = Array.isArray(row.outcome_prices)
                            ? row.outcome_prices
                            : [];
                        return {
                            question: row.question,
                            source: typeof row.source === 'string' ? row.source : 'unknown',
                            yesPrice:
                                Array.isArray(pricesRaw) && pricesRaw.length > 0 && typeof pricesRaw[0] === 'number'
                                    ? (pricesRaw[0] as number)
                                    : 0,
                            url: typeof row.url === 'string' ? row.url : null,
                        };
                    });
                }),
            ),
        )
            .then((lists) => {
                const dedup = new Map<string, ConsensusRow>();
                for (const list of lists) {
                    for (const row of list) if (row) dedup.set(`${row.source}:${row.question}`, row);
                }
                const rows = Array.from(dedup.values());
                rows.sort((a, b) => a.question.localeCompare(b.question));
                setState({ kind: 'ready', rows });
            })
            .catch((error: unknown) => {
                setState({
                    kind: 'error',
                    error: error instanceof Error ? error : new Error('consensus fetch failed'),
                });
            });
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    if (state.kind === 'loading') {
        return <WidgetLoading message="Building consensus signal..." />;
    }
    if (state.kind === 'error') {
        return <WidgetError title="Consensus unavailable" error={state.error} onRetry={refresh} />;
    }
    if (state.rows.length === 0) {
        return (
            <WidgetEmpty
                message="No consensus data"
                detail="Neither Polymarket nor Kalshi returned any active markets."
                icon={<Layers size={18} />}
            />
        );
    }
    return (
        <div className="flex h-full flex-col gap-2 overflow-auto p-1">
            {state.rows.slice(0, 12).map((row) => (
                <a
                    key={`${row.source}:${row.question}`}
                    href={row.url ?? '#'}
                    target={row.url ? '_blank' : undefined}
                    rel="noreferrer"
                    className="block rounded-lg border border-default bg-[var(--bg-tertiary)] p-3 text-xs transition-colors hover:bg-[var(--bg-hover)]"
                >
                    <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-blue-300">
                        {row.source}
                    </div>
                    <h3 className="text-sm font-semibold leading-snug text-[var(--text-primary)]">
                        {row.question}
                    </h3>
                    <div className="mt-1 text-[var(--text-secondary)]">
                        Yes probability {Math.round(row.yesPrice * 100)}%
                    </div>
                </a>
            ))}
        </div>
    );
}
