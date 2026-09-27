'use client';

import { useCallback, useEffect, useState } from 'react';
import { API_BASE_URL } from '@/lib/api';
import { parsePredictionMarketPayload } from './PredictionMarketSource';


export type ConsensusSource = 'polymarket' | 'kalshi';

export interface ConsensusMarket {
    readonly source: ConsensusSource;
    readonly sourceId: string;
    readonly question: string;
    readonly yesPrice: number | null;
    readonly outcomeLabel: string;
    readonly volume: number | null;
    readonly url: string | null;
}

type LoadState =
    | { readonly kind: 'loading' }
    | { readonly kind: 'error'; readonly error: Error }
    | { readonly kind: 'ready'; readonly rows: readonly ConsensusMarket[] };


function parseMarkets(source: ConsensusSource, value: unknown): ConsensusMarket[] {
    return parsePredictionMarketPayload(value).markets.map((market) => ({
        source,
        sourceId: market.sourceId,
        question: market.question,
        yesPrice: market.prices[0] ?? null,
        outcomeLabel: market.outcomes[0] ?? 'First outcome',
        volume: market.volume,
        url: market.url,
    }));
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