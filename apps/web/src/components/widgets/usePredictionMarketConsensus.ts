'use client';

import { useCallback, useEffect, useState } from 'react';
import { API_BASE_URL } from '@/lib/api';

/**
 * Multi-source prediction-market consensus hook.
 *
 * Phase 8: shared by ``ConsensusOddsWidget`` and the ``PredictionMarketDrawer``
 * so both call sites can dedupe over Polymarket + Kalshi without re-fetching.
 *
 * Returns the merged list of unique markets across all configured sources,
 * each annotated with its source and YES price. Volume-weighted consensus is
 * computed on the consumer side.
 */

export type ConsensusSource = 'polymarket' | 'kalshi';

export interface ConsensusMarket {
    readonly source: ConsensusSource;
    readonly sourceId: string;
    readonly question: string;
    readonly yesPrice: number;
    readonly volume: number | null;
    readonly url: string | null;
}

type LoadState =
    | { readonly kind: 'loading' }
    | { readonly kind: 'error'; readonly error: Error }
    | { readonly kind: 'ready'; readonly rows: readonly ConsensusMarket[] };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseMarkets(source: ConsensusSource, value: unknown): ConsensusMarket[] {
    if (!isRecord(value)) return [];
    const data = Array.isArray(value.data)
        ? value.data
        : Array.isArray(value.markets)
            ? value.markets
            : [];
    const out: ConsensusMarket[] = [];
    for (const row of data) {
        if (!isRecord(row) || typeof row.question !== 'string') continue;
        const pricesRaw = Array.isArray(row.outcome_prices)
            ? row.outcome_prices
            : Array.isArray((row as Record<string, unknown>).outcomePrices)
                ? ((row as Record<string, unknown>).outcomePrices as unknown[])
                : [];
        const yesPrice =
            Array.isArray(pricesRaw) && pricesRaw.length > 0 && typeof pricesRaw[0] === 'number'
                ? (pricesRaw[0] as number)
                : 0;
        out.push({
            source,
            sourceId:
                typeof row.source_id === 'string'
                    ? row.source_id
                    : typeof (row as Record<string, unknown>).sourceId === 'string'
                        ? String((row as Record<string, unknown>).sourceId)
                        : row.question,
            question: row.question,
            yesPrice,
            volume: typeof row.volume === 'number' ? row.volume : null,
            url: typeof row.url === 'string' ? row.url : null,
        });
    }
    return out;
}

export interface UsePredictionMarketConsensusArgs {
    readonly sources?: readonly ConsensusSource[];
    readonly limit?: number;
    readonly category?: string;
}

const DEFAULT_SOURCES: readonly ConsensusSource[] = ['polymarket', 'kalshi'];

export function usePredictionMarketConsensus(
    args: UsePredictionMarketConsensusArgs = {},
): LoadState & { readonly refresh: () => void } {
    const sources = args.sources ?? DEFAULT_SOURCES;
    const limit = args.limit ?? 30;
    const category = args.category;
    const [state, setState] = useState<LoadState>({ kind: 'loading' });

    const refresh = useCallback(() => {
        setState({ kind: 'loading' });
        Promise.all(
            sources.map((source) => {
                const url = new URL(`${API_BASE_URL}/prediction-markets`);
                url.searchParams.set('source', source);
                url.searchParams.set('active', 'true');
                url.searchParams.set('limit', String(limit));
                if (category) url.searchParams.set('category', category);
                return fetch(url.toString(), { cache: 'no-store' }).then(async (response) => {
                    if (!response.ok) throw new Error(`${source} API returned ${response.status}`);
                    return parseMarkets(source, await response.json());
                });
            }),
        )
            .then((lists) => {
                const dedup = new Map<string, ConsensusMarket>();
                for (const list of lists) {
                    for (const row of list) dedup.set(`${row.source}:${row.sourceId}`, row);
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
    }, [sources, limit, category]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    return Object.assign({}, state, { refresh });
}