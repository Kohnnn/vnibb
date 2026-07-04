'use client';

import { useCallback, useEffect, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { WidgetEmpty, WidgetError, WidgetLoading } from '@/components/ui/widget-states';
import { API_BASE_URL } from '@/lib/api';

/**
 * Probability Movers widget.
 *
 * Hits `/api/v1/prediction-markets/movers?window=24h&limit=12` and renders
 * the rows with their absolute movement coloured up/down. The endpoint
 * requires the nightly snapshot job (added in Phase 7.4); the widget shows
 * a clear empty state when the snapshot table is empty.
 */

type MoverRow = {
    readonly source: string;
    readonly sourceId: string;
    readonly question: string;
    readonly category: string;
    readonly yesPrice: number;
    readonly previousYesPrice: number;
    readonly absoluteMovement: number;
    readonly url: string | null;
};

type LoadState =
    | { readonly kind: 'loading' }
    | { readonly kind: 'error'; readonly error: Error }
    | { readonly kind: 'ready'; readonly movers: readonly MoverRow[]; readonly windowHours: number };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseMovers(value: unknown): { movers: MoverRow[]; windowHours: number } {
    if (!isRecord(value)) throw new Error('Invalid /movers response');
    const list: unknown = Array.isArray(value.movers)
        ? value.movers
        : Array.isArray(value.data)
            ? value.data
            : [];
    const movers: MoverRow[] = [];
    for (const row of list) {
        if (!isRecord(row) || typeof row.question !== 'string') continue;
        movers.push({
            source: typeof row.source === 'string' ? row.source : 'unknown',
            sourceId:
                typeof row.source_id === 'string'
                    ? row.source_id
                    : typeof row.sourceId === 'string'
                        ? row.sourceId
                        : row.question,
            question: row.question,
            category: typeof row.category === 'string' ? row.category : 'general',
            yesPrice: typeof row.yes_price === 'number' ? row.yes_price : (typeof row.yesPrice === 'number' ? row.yesPrice : 0),
            previousYesPrice:
                typeof row.previous_yes_price === 'number'
                    ? row.previous_yes_price
                    : typeof row.previousYesPrice === 'number'
                        ? row.previousYesPrice
                        : 0,
            absoluteMovement:
                typeof row.absolute_movement === 'number'
                    ? row.absolute_movement
                    : typeof row.absoluteMovement === 'number'
                        ? row.absoluteMovement
                        : 0,
            url: typeof row.url === 'string' ? row.url : null,
        });
    }
    return {
        movers,
        windowHours: typeof value.window_hours === 'number' ? value.window_hours : 24,
    };
}

export function PredictionMoversWidget() {
    const [state, setState] = useState<LoadState>({ kind: 'loading' });

    const refresh = useCallback(() => {
        setState({ kind: 'loading' });
        const url = new URL(`${API_BASE_URL}/prediction-markets/movers`);
        url.searchParams.set('window', '24h');
        url.searchParams.set('limit', '12');
        fetch(url.toString(), { cache: 'no-store' })
            .then(async (response) => {
                if (!response.ok) throw new Error(`movers API returned ${response.status}`);
                const body = await response.json();
                const { movers, windowHours } = parseMovers(body);
                setState({ kind: 'ready', movers, windowHours });
            })
            .catch((error: unknown) => {
                setState({
                    kind: 'error',
                    error: error instanceof Error ? error : new Error('movers request failed'),
                });
            });
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    if (state.kind === 'loading') {
        return <WidgetLoading message="Loading probability movers..." />;
    }
    if (state.kind === 'error') {
        return (
            <WidgetError
                title="Probability movers unavailable"
                error={state.error}
                onRetry={refresh}
            />
        );
    }
    if (state.movers.length === 0) {
        return (
            <WidgetEmpty
                message="No probability movers"
                detail={`The snapshot history is empty for the last ${state.windowHours}h. The nightly snapshot job may need to run.`}
                icon={<TrendingUp size={18} />}
            />
        );
    }
    return (
        <div className="flex h-full flex-col gap-3 p-1">
            <div className="flex items-center justify-between border-b border-default px-1 pb-2 text-[11px] text-[var(--text-muted)]">
                <span>Top {state.movers.length} markets by |Δ probability| in last {state.windowHours}h</span>
            </div>
            <div className="flex flex-col gap-2">
                {state.movers.map((row) => (
                    <a
                        key={`${row.source}:${row.sourceId}`}
                        href={row.url ?? '#'}
                        target={row.url ? '_blank' : undefined}
                        rel="noreferrer"
                        className="flex items-center justify-between rounded-lg border border-default bg-[var(--bg-tertiary)] p-3 text-sm transition-colors hover:bg-[var(--bg-hover)]"
                    >
                        <div className="flex flex-col">
                            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-blue-300">
                                {row.source} · {row.category}
                            </div>
                            <span className="text-[var(--text-primary)]">{row.question}</span>
                        </div>
                        <div
                            className={
                                row.absoluteMovement >= 0
                                    ? 'rounded-md px-2 py-1 text-xs text-emerald-400'
                                    : 'rounded-md px-2 py-1 text-xs text-red-400'
                            }
                        >
                            {row.absoluteMovement >= 0 ? '+' : ''}
                            {(row.absoluteMovement * 100).toFixed(1)}pp
                        </div>
                    </a>
                ))}
            </div>
        </div>
    );
}
