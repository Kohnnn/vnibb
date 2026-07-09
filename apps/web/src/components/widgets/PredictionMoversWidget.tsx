'use client';

import { useCallback, useEffect, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { WidgetEmpty, WidgetError, WidgetLoading } from '@/components/ui/widget-states';
import { API_BASE_URL } from '@/lib/api';
import { ProbabilityBar } from './prediction-market-ui';
import { PredictionMarketContextMenu } from './PredictionMarketContextMenu';
import { PredictionMarketDrawer } from './PredictionMarketDrawer';

type WindowKey = '1h' | '6h' | '24h' | '7d';

const WINDOW_HOURS: Record<WindowKey, number> = {
    '1h': 1,
    '6h': 6,
    '24h': 24,
    '7d': 168,
};

const ALL_DIRECTIONS: ReadonlyArray<'up' | 'down' | 'both'> = ['up', 'down', 'both'];

type MoverRow = {
    readonly source: string;
    readonly sourceId: string;
    readonly question: string;
    readonly category: string;
    readonly yesPrice: number;
    readonly previousYesPrice: number | null;
    readonly absoluteMovement: number;
    readonly url: string | null;
};

type LoadState =
    | { readonly kind: 'loading' }
    | { readonly kind: 'error'; readonly error: Error }
    | { readonly kind: 'ready'; readonly movers: readonly MoverRow[]; readonly windowHours: number };

export interface PredictionMoversWidgetProps {
    readonly windowHours?: number;
    readonly limit?: number;
    readonly direction?: 'up' | 'down' | 'both';
    readonly excludeCategories?: string;
    readonly showFilters?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseMovers(value: unknown): { movers: MoverRow[]; windowHours: number } {
    if (!isRecord(value)) throw new Error('Invalid /movers response');
    const list: unknown[] = Array.isArray(value.movers)
        ? value.movers
        : Array.isArray(value.data)
            ? value.data
            : [];
    const movers: MoverRow[] = [];
    for (const row of list) {
        if (!isRecord(row) || typeof row.question !== 'string') continue;
        const yesPrice = parseNumber(row.yes_price) ?? parseNumber(row.yesPrice) ?? 0;
        const previousYesPrice = parseNumber(row.previous_yes_price) ?? parseNumber(row.previousYesPrice);
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
            yesPrice,
            previousYesPrice,
            absoluteMovement:
                parseNumber(row.absolute_movement) ??
                parseNumber(row.absoluteMovement) ??
                (previousYesPrice === null ? 0 : yesPrice - previousYesPrice),
            url: typeof row.url === 'string' ? row.url : null,
        });
    }
    return {
        movers,
        windowHours: parseNumber(value.window_hours) ?? parseNumber(value.windowHours) ?? 24,
    };
}

export function PredictionMoversWidget(props: PredictionMoversWidgetProps = {}) {
    const { limit = 12, excludeCategories, showFilters = true } = props;
    const [windowKey, setWindowKey] = useState<WindowKey>(
        props.windowHours === 168 ? '7d' : props.windowHours === 6 ? '6h' : props.windowHours === 1 ? '1h' : '24h',
    );
    const [direction, setDirection] = useState<'up' | 'down' | 'both'>(props.direction ?? 'both');
    const [state, setState] = useState<LoadState>({ kind: 'loading' });
    const [selection, setSelection] = useState<{ source: string; sourceId: string; question: string } | null>(null);
    const [excludes, setExcludes] = useState<Set<string>>(
        new Set((excludeCategories ?? '').split(',').filter(Boolean)),
    );

    const refresh = useCallback(() => {
        setState({ kind: 'loading' });
        const windowHours = WINDOW_HOURS[windowKey];
        const url = new URL(`${API_BASE_URL}/prediction-markets/movers`);
        url.searchParams.set('window', String(windowHours));
        url.searchParams.set('limit', String(limit));
        url.searchParams.set('direction', direction);
        if (excludes.size > 0) {
            url.searchParams.set('exclude_categories', Array.from(excludes).join(','));
        }
        fetch(url.toString(), { cache: 'no-store' })
            .then(async (response) => {
                if (!response.ok) throw new Error(`movers API returned ${response.status}`);
                const body = await response.json();
                const { movers, windowHours: hours } = parseMovers(body);
                setState({ kind: 'ready', movers, windowHours: hours });
            })
            .catch((error: unknown) => {
                setState({
                    kind: 'error',
                    error: error instanceof Error ? error : new Error('movers request failed'),
                });
            });
    }, [windowKey, limit, direction, excludes]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    const allCategories: ReadonlyArray<string> = ['general', 'politics', 'sports', 'crypto', 'economic'];

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
    return (
        <div className="flex h-full flex-col gap-3 p-1">
            {showFilters && (
                <header className="flex flex-wrap items-center justify-between gap-2 border-b border-default pb-2 text-[11px] text-[var(--text-muted)]">
                    <div className="flex items-center gap-1">
                        {(Object.entries(WINDOW_HOURS) as [WindowKey, number][]).map(([key, _hours]) => (
                            <button
                                key={key}
                                type="button"
                                onClick={() => setWindowKey(key)}
                                className={`rounded-full border px-2 py-0.5 text-[10px] ${
                                    windowKey === key
                                        ? 'border-blue-500/60 bg-blue-500/10 text-blue-400'
                                        : 'border-default bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                                }`}
                            >
                                {key}
                            </button>
                        ))}
                    </div>
                    <div className="flex items-center gap-1">
                        {ALL_DIRECTIONS.map((value) => (
                            <button
                                key={value}
                                type="button"
                                onClick={() => setDirection(value)}
                                className={`rounded-full border px-2 py-0.5 text-[10px] ${
                                    direction === value
                                        ? 'border-blue-500/60 bg-blue-500/10 text-blue-400'
                                        : 'border-default bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                                }`}
                            >
                                {value}
                            </button>
                        ))}
                    </div>
                    <div className="flex items-center gap-1">
                        {allCategories.map((category) => {
                            const on = excludes.has(category);
                            return (
                                <button
                                    key={category}
                                    type="button"
                                    onClick={() => {
                                        setExcludes((prev) => {
                                            const next = new Set(prev);
                                            if (next.has(category)) {
                                                next.delete(category);
                                            } else {
                                                next.add(category);
                                            }
                                            return next;
                                        });
                                    }}
                                    className={`rounded-full border px-2 py-0.5 text-[10px] ${
                                        on
                                            ? 'border-red-500/60 bg-red-500/10 text-red-400'
                                            : 'border-default bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                                    }`}
                                >
                                    hide {category}
                                </button>
                            );
                        })}
                    </div>
                </header>
            )}
            {state.movers.length === 0 ? (
                <WidgetEmpty
                    message="No probability moves in selected window"
                    detail={`No YES probability moved during the last ${state.windowHours}h.`}
                    icon={<TrendingUp size={18} />}
                />
            ) : (
                <div className="flex flex-col gap-2 overflow-auto">
                    {state.movers.map((row) => (
                        <PredictionMarketContextMenu
                            key={`${row.source}:${row.sourceId}`}
                            market={{
                                source: row.source,
                                sourceId: row.sourceId,
                                question: row.question,
                                url: row.url,
                            }}
                            onOpenDrawer={() =>
                                setSelection({
                                    source: row.source,
                                    sourceId: row.sourceId,
                                    question: row.question,
                                })
                            }
                        >
                            <button
                                type="button"
                                onClick={() =>
                                    setSelection({
                                        source: row.source,
                                        sourceId: row.sourceId,
                                        question: row.question,
                                    })
                                }
                                className="flex w-full flex-col gap-2 rounded-lg border border-default bg-[var(--bg-tertiary)] p-3 text-left text-sm transition-colors hover:bg-[var(--bg-hover)]"
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex flex-col">
                                        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-blue-300">
                                            {row.source} · {row.category}
                                        </div>
                                        <span className="text-[var(--text-primary)]">
                                            {row.question}
                                        </span>
                                    </div>
                                    <div className="flex flex-col items-end gap-0.5">
                                        <div
                                            className={
                                                row.absoluteMovement >= 0
                                                    ? 'rounded-md px-2 py-1 text-xs text-emerald-400'
                                                    : 'rounded-md px-2 py-1 text-xs text-red-400'
                                            }
                                        >
                                            {formatMovement(row.absoluteMovement)}
                                        </div>
                                        <div className="text-[10px] text-[var(--text-muted)]">
                                            YES {formatProbability(row.yesPrice)}
                                        </div>
                                        {row.previousYesPrice !== null && (
                                            <div className="text-[10px] text-[var(--text-muted)]">
                                                Prev {formatProbability(row.previousYesPrice)}
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <ProbabilityBar
                                    value={row.yesPrice}
                                    delta={row.absoluteMovement}
                                    showLabels
                                    height={6}
                                />
                            </button>
                        </PredictionMarketContextMenu>
                    ))}
                </div>
            )}
            <PredictionMarketDrawer
                source={selection?.source ?? null}
                sourceId={selection?.sourceId ?? null}
                question={selection?.question ?? null}
                open={selection !== null}
                onClose={() => setSelection(null)}
            />
        </div>
    );
}

function formatProbability(value: number): string {
    return `${Math.round(value * 100)}%`;
}

function formatMovement(value: number): string {
    return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}pp`;
}
