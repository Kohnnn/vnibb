'use client';

import { useCallback, useEffect, useState } from 'react';
import { Layers } from 'lucide-react';
import { WidgetEmpty, WidgetError, WidgetLoading } from '@/components/ui/widget-states';
import { API_BASE_URL } from '@/lib/api';
import { ProbabilityBar, colorblindClass } from './prediction-market-ui';

/**
 * Cross-Source Calibration.
 *
 * Phase 10 (rebuilt): one row per topic with three source columns. Each
 * source column has a probability bar and a label; above the row a
 * colourblind-safe pill renders "Sources agree" or "Sources diverge".
 */

type Topic = 'cpi' | 'fed' | 'recession';

type CrossSource = {
    readonly source: string;
    readonly consensus_yes_price: number | null;
    readonly n_markets: number;
};

type CrossTopic = {
    readonly topic: Topic;
    readonly n_sources: number;
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
                    typeof sourceRow.consensus_yes_price === 'number'
                        ? sourceRow.consensus_yes_price
                        : null,
                n_markets: typeof sourceRow.n_markets === 'number' ? sourceRow.n_markets : 0,
            });
        }
        topics.push({
            topic: row.topic,
            n_sources: typeof row.n_sources === 'number' ? row.n_sources : 0,
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
            {state.topics.map((topic) => (
                <div
                    key={topic.topic}
                    className="flex flex-col gap-2 rounded-lg border border-default bg-[var(--bg-tertiary)] p-3"
                >
                    <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.16em]">
                        <span className="text-blue-300">{topicLabel(topic.topic)}</span>
                        <span
                            className={`rounded-full border px-2 py-0.5 ${
                                topic.sources_agree
                                    ? `border-emerald-500/40 ${colorblindClass('positive')}`
                                    : `border-amber-500/40 ${colorblindClass('warning')}`
                            }`}
                        >
                            {topic.sources_agree ? 'Sources agree' : 'Sources diverge'}
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
                                <ProbabilityBar
                                    value={row.consensus_yes_price ?? 0}
                                    showLabels
                                    height={6}
                                />
                            </div>
                        ))}
                        {topic.n_sources < 2 && (
                            <div className="col-span-full text-[10px] text-[var(--text-muted)]">
                                Only {topic.n_sources} source tagged this topic.
                            </div>
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
}