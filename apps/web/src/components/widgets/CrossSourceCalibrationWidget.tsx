'use client';

import { useCallback, useEffect, useState } from 'react';
import { Layers } from 'lucide-react';
import { WidgetEmpty, WidgetError, WidgetLoading } from '@/components/ui/widget-states';
import { API_BASE_URL } from '@/lib/api';
import { ProbabilityBar, colorblindClass } from './prediction-market-ui';
import { formatProb } from './PredictionMarketSource';


type Topic = 'cpi' | 'fed' | 'recession';

type CrossSource = {
    readonly source: string;
    readonly consensus_yes_price: number | null;
    readonly n_markets: number;
};

type CrossTopic = {
    readonly topic: Topic;
    readonly sources_agree: boolean;
    readonly sources: readonly CrossSource[];
};

type LoadState =
    | { readonly kind: 'loading' }
    | { readonly kind: 'error'; readonly error: Error }
    | { readonly kind: 'ready'; readonly topics: readonly CrossTopic[]; readonly lastUpdated: string | null };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseTopics(value: unknown): { topics: CrossTopic[]; lastUpdated: string | null } {
    if (!isRecord(value)) return { topics: [], lastUpdated: null };
    const list: unknown[] = Array.isArray(value.topics) ? value.topics : [];
    const topics: CrossTopic[] = [];
    for (const row of list) {
        if (!isRecord(row) || typeof row.topic !== 'string') continue;
        if (row.topic !== 'cpi' && row.topic !== 'fed' && row.topic !== 'recession') continue;
        const sourcesList: unknown[] = Array.isArray(row.sources) ? row.sources : [];
        const sources: CrossSource[] = [];
        for (const sourceRow of sourcesList) {
            if (!isRecord(sourceRow) || typeof sourceRow.source !== 'string') continue;
            sources.push({
                source: sourceRow.source,
                consensus_yes_price:
                    typeof sourceRow.consensus_yes_price === 'number' && Number.isFinite(sourceRow.consensus_yes_price)
                        && sourceRow.consensus_yes_price >= 0 && sourceRow.consensus_yes_price <= 1
                        && typeof sourceRow.n_markets === 'number' && sourceRow.n_markets > 0
                        ? sourceRow.consensus_yes_price
                        : null,
                n_markets: typeof sourceRow.n_markets === 'number' ? sourceRow.n_markets : 0,
            });
        }
        topics.push({
            topic: row.topic,
            sources_agree: row.sources_agree === true,
            sources,
        });
    }
    return {
        topics,
        lastUpdated: typeof value.last_updated === 'string' ? value.last_updated : null,
    };
}

function topicLabel(topic: Topic): string {
    return topic === 'cpi' ? 'CPI' : topic === 'fed' ? 'Fed' : 'Recession';
}

export function CrossSourceCalibrationWidget() {
    const [state, setState] = useState<LoadState>({ kind: 'loading' });

    const refresh = useCallback(() => {
        setState({ kind: 'loading' });
        fetch(`${API_BASE_URL}/prediction-markets/cross-calibration`, { cache: 'no-store' })
            .then(async (response) => {
                if (!response.ok) throw new Error(`cross-calibration API returned ${response.status}`);
                const body = await response.json();
                const parsed = parseTopics(body);
                setState({ kind: 'ready', topics: parsed.topics, lastUpdated: parsed.lastUpdated });
            })
            .catch((error: unknown) => {
                setState({
                    kind: 'error',
                    error: error instanceof Error ? error : new Error('cross-calibration failed'),
                });
            });
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    if (state.kind === 'loading') {
        return <WidgetLoading message="Computing cross-source calibration..." />;
    }
    if (state.kind === 'error') {
        return (
            <WidgetError
                title="Cross-source calibration unavailable"
                error={state.error}
                onRetry={refresh}
            />
        );
    }
    if (state.topics.length === 0) {
        return (
            <WidgetEmpty
                message="No cross-source data yet"
                detail="Each source needs to publish at least one tagged market."
                icon={<Layers size={18} />}
            />
        );
    }
    return (
        <div className="flex h-full flex-col gap-3 p-1">
            <p className="text-[11px] text-[var(--text-muted)]">Topic averages from a bounded catalogue; matching topics do not establish equivalent contracts.</p>
            {state.topics.map((topic) => {
                const pricedSources = topic.sources.filter((row) => row.consensus_yes_price !== null);
                const comparable = pricedSources.length >= 2;
                return (
                <div
                    key={topic.topic}
                    className="flex flex-col gap-2 rounded-lg border border-default bg-[var(--bg-tertiary)] p-3"
                >
                    <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.16em]">
                        <span className="text-blue-300">{topicLabel(topic.topic)}</span>
                        <span
                            className={`rounded-full border px-2 py-0.5 ${
                                !comparable ? 'border-default text-[var(--text-muted)]' : topic.sources_agree
                                    ? `border-emerald-500/40 ${colorblindClass('positive')}`
                                    : `border-amber-500/40 ${colorblindClass('warning')}`
                            }`}
                        >
                            {!comparable ? (pricedSources.length === 0 ? 'No data' : 'Insufficient sources') : topic.sources_agree ? 'Source averages align' : 'Source averages differ'}
                        </span>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        {topic.sources.map((row) => (
                            <div
                                key={row.source}
                                className="flex flex-col gap-1 rounded-md border border-default bg-[var(--bg-secondary)] p-2"
                            >
                                <div className="flex items-center justify-between text-[10px] uppercase text-[var(--text-muted)]">
                                    <span>{row.source}</span>
                                    <span>{row.n_markets} mkts</span>
                                </div>
                                {row.consensus_yes_price === null ? <span className="text-xs text-[var(--text-muted)]">No data</span> : <>
                                    <ProbabilityBar value={row.consensus_yes_price} height={6} />
                                    <span className="text-xs">Reported average {formatProb(row.consensus_yes_price)}</span>
                                </>}
                            </div>
                        ))}
                        {!comparable && (
                            <div className="col-span-full text-[10px] text-[var(--text-muted)]">
                                At least two sources with priced markets are needed for comparison.
                            </div>
                        )}
                    </div>
                </div>
                );
            })}
        </div>
    );
}