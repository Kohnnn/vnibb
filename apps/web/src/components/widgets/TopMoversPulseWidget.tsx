'use client';

import { useCallback, useEffect, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { WidgetEmpty, WidgetError, WidgetLoading } from '@/components/ui/widget-states';
import { API_BASE_URL } from '@/lib/api';
import { Sparkline, usePersistedWidgetConfig } from './prediction-market-ui';
import { PredictionMarketContextMenu } from './PredictionMarketContextMenu';
import { PredictionMarketDrawer } from './PredictionMarketDrawer';

type WindowKey = '1h' | '24h' | '7d';

const WINDOW_HOURS: Record<WindowKey, number> = {
    '1h': 1,
    '24h': 24,
    '7d': 168,
};

type PulseRow = {
    readonly source: string;
    readonly sourceId: string;
    readonly question: string;
    readonly category: string | null;
    readonly yesPrice: number;
    readonly previousYesPrice: number;
    readonly absoluteMovement: number;
    readonly url: string | null;
    readonly sparkline: readonly number[];
};

type LoadState =
    | { readonly kind: 'loading' }
    | { readonly kind: 'error'; readonly error: Error }
    | { readonly kind: 'ready'; readonly rows: readonly PulseRow[] };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseRows(value: unknown): PulseRow[] {
    if (!isRecord(value)) return [];
    const list: unknown[] = Array.isArray(value.movers)
        ? value.movers
        : Array.isArray(value.data)
            ? value.data
            : [];
    const out: PulseRow[] = [];
    for (const row of list) {
        if (!isRecord(row) || typeof row.question !== 'string') continue;
        const yesPrice =
            typeof row.yes_price === 'number'
                ? row.yes_price
                : typeof row.yesPrice === 'number'
                    ? row.yesPrice
                    : 0;
        const previousYesPrice =
            typeof row.previous_yes_price === 'number'
                ? row.previous_yes_price
                : typeof row.previousYesPrice === 'number'
                    ? row.previousYesPrice
                    : 0;
        const absoluteMovement =
            typeof row.movement === 'number'
                ? row.movement
                : typeof row.absolute_movement === 'number'
                    ? row.absolute_movement
                    : typeof row.absoluteMovement === 'number'
                        ? row.absoluteMovement
                        : 0;
        const sparklineRaw = Array.isArray(row.sparkline) ? row.sparkline : [];
        const sparkline = sparklineRaw
            .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
            .slice(-12);
        out.push({
            source: typeof row.source === 'string' ? row.source : 'unknown',
            sourceId:
                typeof row.source_id === 'string'
                    ? row.source_id
                    : typeof row.sourceId === 'string'
                        ? row.sourceId
                        : row.question,
            question: row.question,
            category: typeof row.category === 'string' ? row.category : null,
            yesPrice,
            previousYesPrice,
            absoluteMovement,
            url: typeof row.url === 'string' ? row.url : null,
            sparkline,
        });
    }
    return out;
}

export function TopMoversPulseWidget() {
    const [state, setState] = useState<LoadState>({ kind: 'loading' });
    const [config, setConfig] = usePersistedWidgetConfig<{ window: WindowKey; limit: number }>(
        'vnibb.top-movers-pulse.config',
        { window: '24h', limit: 3 },
    );
    const [selection, setSelection] = useState<{ source: string; sourceId: string; question: string } | null>(
        null,
    );

    const refresh = useCallback(() => {
        setState({ kind: 'loading' });
        const url = new URL(`${API_BASE_URL}/prediction-markets/movers`);
        url.searchParams.set('limit', String(config.limit));
        url.searchParams.set('window_hours', String(WINDOW_HOURS[config.window]));
        fetch(url.toString(), { cache: 'no-store' })
            .then(async (response) => {
                if (!response.ok) throw new Error(`movers API returned ${response.status}`);
                const body = await response.json();
                setState({ kind: 'ready', rows: parseRows(body) });
            })
            .catch((error: unknown) => {
                setState({
                    kind: 'error',
                    error: error instanceof Error ? error : new Error('movers request failed'),
                });
            });
    }, [config.limit, config.window]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    if (state.kind === 'loading') {
        return <WidgetLoading message="Loading top movers..." />;
    }
    if (state.kind === 'error') {
        return (
            <WidgetError title="Top movers unavailable" error={state.error} onRetry={refresh} />
        );
    }

    return (
        <div className="flex h-full flex-col gap-2">
            <header className="flex items-center justify-between text-[11px] text-[var(--text-muted)]">
                <div role="group" aria-label="Top movers window" className="flex items-center gap-2">
                    {(Object.entries(WINDOW_HOURS) as [WindowKey, number][]).map(
                        ([key, _value]) => (
                            <button
                                key={key}
                                type="button"
                                onClick={() => setConfig({ window: key })}
                                aria-pressed={config.window === key}
                                className={`rounded-full border px-2 py-0.5 text-[10px] ${
                                    config.window === key
                                        ? 'border-blue-500/60 bg-blue-500/10 text-blue-400'
                                        : 'border-default bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                                }`}
                            >
                                {key}
                            </button>
                        ),
                    )}
                </div>
                {state.rows.length === 0 && (
                    <span>No movers in window</span>
                )}
            </header>
            {state.rows.length === 0 ? (
                <WidgetEmpty
                    message="No probability movers in this window"
                    detail="The intraday snapshot job hasn't accumulated enough rows yet."
                    icon={<TrendingUp size={18} />}
                />
            ) : (
                <div className="flex flex-1 items-stretch gap-2 overflow-x-auto">
                    {state.rows.map((row) => {
                        const direction: 'up' | 'down' = row.absoluteMovement >= 0 ? 'up' : 'down';
                        return (
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
                                    className="flex min-w-[220px] flex-1 flex-col justify-between rounded-lg border border-default bg-[var(--bg-tertiary)] p-2 text-left text-xs transition-colors hover:bg-[var(--bg-hover)]"
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <span className="line-clamp-2 text-[11px] font-semibold text-[var(--text-primary)]">
                                            {row.question}
                                        </span>
                                        <span
                                            className={
                                                direction === 'up'
                                                    ? 'rounded-md px-1.5 py-0.5 text-[10px] text-emerald-400'
                                                    : 'rounded-md px-1.5 py-0.5 text-[10px] text-red-400'
                                            }
                                        >
                                            {direction === 'up' ? '+' : ''}
                                            {(row.absoluteMovement * 100).toFixed(1)}pp
                                        </span>
                                    </div>
                                    <div className="mt-1 flex items-center justify-between">
                                        <span className="text-[10px] text-[var(--text-muted)]">
                                            {row.source} · {row.category ?? 'general'}
                                        </span>
                                        {row.sparkline.length >= 2 && (
                                            <Sparkline
                                                values={row.sparkline}
                                                width={60}
                                                height={20}
                                                ariaLabel={`${row.source} sparkline`}
                                            />
                                        )}
                                    </div>
                                </button>
                            </PredictionMarketContextMenu>
                        );
                    })}
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