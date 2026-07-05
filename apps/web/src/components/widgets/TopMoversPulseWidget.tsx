'use client';

import { useCallback, useEffect, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { WidgetEmpty, WidgetError, WidgetLoading } from '@/components/ui/widget-states';
import { API_BASE_URL } from '@/lib/api';

/**
 * Top Movers Pulse.
 *
 * Compact 3-row strip for the top-of-dashboard. Pulls `/movers?limit=3`
 * and renders inline SVG sparklines based on the latest 6 intraday
 * snapshot rows. Designed to live above the Macro Calibration tile.
 */

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
            typeof row.absolute_movement === 'number'
                ? row.absolute_movement
                : typeof row.absoluteMovement === 'number'
                    ? row.absoluteMovement
                    : 0;
        const sparklineRaw = Array.isArray(row.sparkline)
            ? row.sparkline
            : [];
        const sparkline = sparklineRaw
            .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
            .slice(-6);
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
            sparkline: sparkline.length > 0 ? sparkline : [previousYesPrice, yesPrice],
        });
    }
    return out;
}

function Sparkline({ values, direction }: { readonly values: readonly number[]; readonly direction: 'up' | 'down' }) {
    if (values.length < 2) {
        return <svg width={60} height={20} aria-hidden />;
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 0.01;
    const width = 60;
    const height = 20;
    const points = values
        .map((value, index) => {
            const x = (index / (values.length - 1)) * width;
            const y = height - ((value - min) / span) * height;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ');
    const stroke = direction === 'up' ? '#34d399' : '#f87171';
    return (
        <svg width={width} height={height} aria-hidden>
            <polyline points={points} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

export function TopMoversPulseWidget() {
    const [state, setState] = useState<LoadState>({ kind: 'loading' });

    const refresh = useCallback(() => {
        setState({ kind: 'loading' });
        const url = new URL(`${API_BASE_URL}/prediction-markets/movers`);
        url.searchParams.set('limit', '3');
        url.searchParams.set('window', '1');
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
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    if (state.kind === 'loading') {
        return <WidgetLoading message="Loading top movers..." />;
    }
    if (state.kind === 'error') {
        return <WidgetError title="Top movers unavailable" error={state.error} onRetry={refresh} />;
    }
    if (state.rows.length === 0) {
        return (
            <WidgetEmpty
                message="No probability movers in the last hour"
                detail="The intraday snapshot job hasn't accumulated enough rows yet."
                icon={<TrendingUp size={18} />}
            />
        );
    }

    return (
        <div className="flex h-full items-stretch gap-2 overflow-x-auto p-1">
            {state.rows.map((row) => {
                const direction: 'up' | 'down' = row.absoluteMovement >= 0 ? 'up' : 'down';
                return (
                    <a
                        key={`${row.source}:${row.sourceId}`}
                        href={row.url ?? '#'}
                        target={row.url ? '_blank' : undefined}
                        rel="noreferrer"
                        className="flex min-w-[220px] flex-1 flex-col justify-between rounded-lg border border-default bg-[var(--bg-tertiary)] p-2 text-xs transition-colors hover:bg-[var(--bg-hover)]"
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
                            <Sparkline values={row.sparkline} direction={direction} />
                        </div>
                    </a>
                );
            })}
        </div>
    );
}