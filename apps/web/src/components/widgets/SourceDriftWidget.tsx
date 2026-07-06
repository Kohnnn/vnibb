'use client';

import { useCallback, useEffect, useState } from 'react';
import { GitCompare } from 'lucide-react';
import { WidgetEmpty, WidgetError, WidgetLoading } from '@/components/ui/widget-states';
import { API_BASE_URL } from '@/lib/api';
import { ConsensusStrip } from './prediction-market-ui';

/**
 * Source Drift.
 *
 * Three tiles (CPI, Fed, Recession) showing Polymarket vs Kalshi consensus
 * and the gap. Pulls `/prediction-markets/spread?window=24h`. Empty state
 * when one source missing that topic.
 */

type Topic = 'cpi' | 'fed' | 'recession';

type SpreadRow = {
    readonly topic: Topic;
    readonly polymarket_consensus: number | null;
    readonly kalshi_consensus: number | null;
    readonly gap: number | null;
    readonly n_polymarket: number;
    readonly n_kalshi: number;
};

type LoadState =
    | { readonly kind: 'loading' }
    | { readonly kind: 'error'; readonly error: Error }
    | { readonly kind: 'ready'; readonly topics: readonly SpreadRow[] };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSpread(value: unknown): SpreadRow[] {
    if (!isRecord(value)) return [];
    const list: unknown[] = Array.isArray(value.topics)
        ? value.topics
        : Array.isArray(value.data)
            ? value.data
            : [];
    const out: SpreadRow[] = [];
    for (const row of list) {
        if (!isRecord(row) || typeof row.topic !== 'string') continue;
        if (row.topic !== 'cpi' && row.topic !== 'fed' && row.topic !== 'recession') continue;
        out.push({
            topic: row.topic,
            polymarket_consensus:
                typeof row.polymarket_consensus === 'number' ? row.polymarket_consensus : null,
            kalshi_consensus:
                typeof row.kalshi_consensus === 'number' ? row.kalshi_consensus : null,
            gap: typeof row.gap === 'number' ? row.gap : null,
            n_polymarket: typeof row.n_polymarket === 'number' ? row.n_polymarket : 0,
            n_kalshi: typeof row.n_kalshi === 'number' ? row.n_kalshi : 0,
        });
    }
    return out;
}

function topicLabel(topic: Topic): string {
    return topic === 'cpi' ? 'CPI' : topic === 'fed' ? 'Fed' : 'Recession';
}

function pct(value: number | null): string {
    return value === null ? '—' : `${Math.round(value * 100)}%`;
}

function gapText(gap: number | null): string {
    if (gap === null) return 'Gap —';
    const pp = Math.abs(gap * 100);
    const direction = gap > 0 ? 'Poly higher' : gap < 0 ? 'Kalshi higher' : 'Aligned';
    return `Gap ${pp.toFixed(1)}pp · ${direction}`;
}

export function SourceDriftWidget() {
    const [state, setState] = useState<LoadState>({ kind: 'loading' });

    const refresh = useCallback(() => {
        setState({ kind: 'loading' });
        const url = new URL(`${API_BASE_URL}/prediction-markets/spread`);
        url.searchParams.set('window', '24');
        fetch(url.toString(), { cache: 'no-store' })
            .then(async (response) => {
                if (!response.ok) throw new Error(`spread API returned ${response.status}`);
                const body = await response.json();
                setState({ kind: 'ready', topics: parseSpread(body) });
            })
            .catch((error: unknown) => {
                setState({
                    kind: 'error',
                    error: error instanceof Error ? error : new Error('spread request failed'),
                });
            });
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    if (state.kind === 'loading') {
        return <WidgetLoading message="Computing source drift..." />;
    }
    if (state.kind === 'error') {
        return <WidgetError title="Source drift unavailable" error={state.error} onRetry={refresh} />;
    }
    if (state.topics.length === 0) {
        return (
            <WidgetEmpty
                message="No drift signal yet"
                detail="Neither Polymarket nor Kalshi has a tagged macro topic."
                icon={<GitCompare size={18} />}
            />
        );
    }

    return (
        <div className="flex h-full flex-col gap-2 overflow-auto p-1">
            {state.topics.map((row) => {
                const missing = row.polymarket_consensus === null || row.kalshi_consensus === null;
                const rows = [
                    {
                        source: 'Polymarket',
                        yesPrice: row.polymarket_consensus,
                        url: null,
                    },
                    {
                        source: 'Kalshi',
                        yesPrice: row.kalshi_consensus,
                        url: null,
                    },
                ];
                return (
                    <div
                        key={row.topic}
                        className="flex flex-col gap-2 rounded-lg border border-default bg-[var(--bg-tertiary)] p-3"
                    >
                        <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.16em]">
                            <span className="text-blue-300">{topicLabel(row.topic)}</span>
                            <span className="text-[var(--text-muted)]">{gapText(row.gap)}</span>
                        </div>
                        <ConsensusStrip rows={rows} />
                        {missing && (
                            <div className="mt-1 text-[10px] text-amber-300">
                                Missing source data
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}