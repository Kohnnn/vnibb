'use client';

import { useCallback, useEffect, useState } from 'react';
import { BellRing } from 'lucide-react';
import { WidgetEmpty, WidgetError, WidgetLoading } from '@/components/ui/widget-states';
import { API_BASE_URL } from '@/lib/api';
import { Sparkline, usePersistedWidgetConfig } from './prediction-market-ui';
import { PredictionMarketContextMenu } from './PredictionMarketContextMenu';
import { PredictionMarketDrawer } from './PredictionMarketDrawer';

/**
 * Prediction-market Alerts.
 *
 * Phase v2.x: time-bucketed tabs (1h / 4h / 24h) with per-alert sparkline.
 * Empty state is still friendly when the intraday job hasn't accumulated
 * rows.
 */

type AlertRow = {
    readonly source: string;
    readonly sourceId: string;
    readonly question: string;
    readonly category: string | null;
    readonly url: string | null;
    readonly yesPrice: number;
    readonly previousYesPrice: number;
    readonly absoluteMovement: number;
    readonly direction: 'up' | 'down';
    readonly capturedAt: string | null;
};

type LoadState =
    | { readonly kind: 'loading' }
    | { readonly kind: 'error'; readonly error: Error }
    | { readonly kind: 'ready'; readonly alerts: readonly AlertRow[]; readonly windowHours: number };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseAlerts(value: unknown): { alerts: AlertRow[]; windowHours: number } {
    if (!isRecord(value)) return { alerts: [], windowHours: 1 };
    const list: unknown[] = Array.isArray(value.alerts)
        ? value.alerts
        : Array.isArray(value.data)
            ? value.data
            : [];
    const alerts: AlertRow[] = [];
    for (const row of list) {
        if (!isRecord(row) || typeof row.question !== 'string') continue;
        const directionRaw = row.direction;
        const direction: 'up' | 'down' = directionRaw === 'down' ? 'down' : 'up';
        const absoluteMovement =
            typeof row.movement === 'number'
                ? row.movement
                : typeof row.absolute_movement === 'number'
                    ? row.absolute_movement
                    : typeof row.absoluteMovement === 'number'
                        ? row.absoluteMovement
                        : 0;
        alerts.push({
            source: typeof row.source === 'string' ? row.source : 'unknown',
            sourceId:
                typeof row.source_id === 'string'
                    ? row.source_id
                    : typeof row.sourceId === 'string'
                        ? row.sourceId
                        : row.question,
            question: row.question,
            category: typeof row.category === 'string' ? row.category : null,
            url: typeof row.url === 'string' ? row.url : null,
            yesPrice: typeof row.yes_price === 'number' ? row.yes_price : 0,
            previousYesPrice:
                typeof row.previous_yes_price === 'number' ? row.previous_yes_price : 0,
            absoluteMovement,
            direction,
            capturedAt:
                typeof row.captured_at === 'string'
                    ? row.captured_at
                    : typeof row.capturedAt === 'string'
                        ? row.capturedAt
                        : null,
        });
    }
    return {
        alerts,
        windowHours: typeof value.window_hours === 'number' ? value.window_hours : 1,
    };
}

const BUCKETS: ReadonlyArray<{ readonly key: '1h' | '4h' | '24h'; readonly hours: number; readonly label: string }> = [
    { key: '1h', hours: 1, label: 'Last 1h' },
    { key: '4h', hours: 4, label: 'Last 4h' },
    { key: '24h', hours: 24, label: 'Last 24h' },
];

export function PredictionAlertsWidget() {
    const [state, setState] = useState<LoadState>({ kind: 'loading' });
    const [config, setConfig] = usePersistedWidgetConfig<{ bucket: '1h' | '4h' | '24h' }>(
        'vnibb.prediction-alerts.config',
        { bucket: '1h' },
    );
    const [selection, setSelection] = useState<{ source: string; sourceId: string; question: string } | null>(null);
    const [historyMap, setHistoryMap] = useState<Record<string, readonly number[]>>({});

    const refresh = useCallback(() => {
        setState({ kind: 'loading' });
        const url = new URL(`${API_BASE_URL}/prediction-markets/alerts`);
        const hours = BUCKETS.find((bucket) => bucket.key === config.bucket)?.hours ?? 1;
        url.searchParams.set('window_hours', String(hours));
        url.searchParams.set('min_movement_bps', '200');
        url.searchParams.set('limit', '12');
        fetch(url.toString(), { cache: 'no-store' })
            .then(async (response) => {
                if (!response.ok) throw new Error(`alerts API returned ${response.status}`);
                const body = await response.json();
                const { alerts, windowHours } = parseAlerts(body);
                setState({ kind: 'ready', alerts, windowHours });
            })
            .catch((error: unknown) => {
                setState({
                    kind: 'error',
                    error: error instanceof Error ? error : new Error('alerts request failed'),
                });
            });
    }, [config.bucket]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    useEffect(() => {
        if (state.kind !== 'ready') return;
        const targets = state.alerts.filter(
            (alert) => !historyMap[`${alert.source}:${alert.sourceId}`],
        );
        if (targets.length === 0) return;
        let cancelled = false;
        Promise.all(
            targets.map(async (alert) => {
                try {
                    const res = await fetch(
                        `${API_BASE_URL}/prediction-markets/${encodeURIComponent(alert.source)}/${encodeURIComponent(alert.sourceId)}/history?days=7`,
                        { cache: 'no-store' },
                    );
                    if (!res.ok) return { key: `${alert.source}:${alert.sourceId}`, points: [] as readonly number[] };
                    const body = await res.json();
                    const points: readonly number[] = Array.isArray(body?.points)
                        ? (body.points as unknown[])
                              .map((point) =>
                                  typeof (point as Record<string, unknown>).yes_price === 'number'
                                      ? ((point as Record<string, unknown>).yes_price as number)
                                      : null,
                              )
                              .filter((v): v is number => v !== null)
                        : [];
                    return { key: `${alert.source}:${alert.sourceId}`, points };
                } catch {
                    return { key: `${alert.source}:${alert.sourceId}`, points: [] as readonly number[] };
                }
            }),
        )
            .then((results) => {
                if (cancelled) return;
                setHistoryMap((prev) => {
                    const next = { ...prev };
                    for (const result of results) {
                        next[result.key] = result.points;
                    }
                    return next;
                });
            });
        return () => {
            cancelled = true;
        };
    }, [state, historyMap]);

    if (state.kind === 'loading') {
        return <WidgetLoading message="Computing alerts..." />;
    }
    if (state.kind === 'error') {
        return <WidgetError title="Alerts unavailable" error={state.error} onRetry={refresh} />;
    }

    return (
        <div className="flex h-full flex-col gap-2">
            <div className="flex items-center justify-between px-1">
                <div role="group" aria-label="Alert window" className="flex items-center gap-1">
                    {BUCKETS.map((bucket) => (
                        <button
                            key={bucket.key}
                            type="button"
                            onClick={() => setConfig({ bucket: bucket.key })}
                            aria-pressed={config.bucket === bucket.key}
                            className={`rounded-full border px-2 py-0.5 text-[10px] ${
                                config.bucket === bucket.key
                                    ? 'border-blue-500/60 bg-blue-500/10 text-blue-400'
                                    : 'border-default bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                            }`}
                        >
                            {bucket.label}
                        </button>
                    ))}
                </div>
                <span className="text-[10px] text-[var(--text-muted)]">
                    {state.alerts.length} alerts
                </span>
            </div>
            {state.alerts.length === 0 ? (
                <WidgetEmpty
                    message="No alerts"
                    detail={`No market moved more than 2pp in the last ${state.windowHours}h.`}
                    icon={<BellRing size={18} />}
                />
            ) : (
                <div className="flex flex-1 flex-col gap-1 overflow-auto">
                    {state.alerts.map((alert) => {
                        const points =
                            historyMap[`${alert.source}:${alert.sourceId}`] ?? [
                                alert.previousYesPrice,
                                alert.yesPrice,
                            ];
                        return (
                            <PredictionMarketContextMenu
                                key={`${alert.source}:${alert.sourceId}`}
                                market={{
                                    source: alert.source,
                                    sourceId: alert.sourceId,
                                    question: alert.question,
                                    url: alert.url,
                                }}
                                onOpenDrawer={() =>
                                    setSelection({
                                        source: alert.source,
                                        sourceId: alert.sourceId,
                                        question: alert.question,
                                    })
                                }
                            >
                                <button
                                    type="button"
                                    onClick={() =>
                                        setSelection({
                                            source: alert.source,
                                            sourceId: alert.sourceId,
                                            question: alert.question,
                                        })
                                    }
                                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-default bg-[var(--bg-tertiary)] p-2 text-left text-xs transition-colors hover:bg-[var(--bg-hover)]"
                                >
                                    <div className="flex flex-col gap-1">
                                        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em]">
                                            <span className="text-blue-300">{alert.source}</span>
                                            {alert.category && (
                                                <span className="rounded-full border border-default px-2 py-0.5 text-[var(--text-muted)]">
                                                    {alert.category}
                                                </span>
                                            )}
                                        </div>
                                        <span className="text-[12px] font-semibold text-[var(--text-primary)]">
                                            {alert.question}
                                        </span>
                                        <span className="text-[10px] text-[var(--text-muted)]">
                                            {Math.round(alert.previousYesPrice * 100)}% →{' '}
                                            {Math.round(alert.yesPrice * 100)}%
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Sparkline
                                            values={points.slice(-12)}
                                            width={50}
                                            height={20}
                                        />
                                        <span
                                            className={
                                                alert.direction === 'up'
                                                    ? 'rounded-md px-2 py-1 text-xs text-emerald-400'
                                                    : 'rounded-md px-2 py-1 text-xs text-red-400'
                                            }
                                        >
                                            {alert.direction === 'up' ? '▲' : '▼'}{' '}
                                            {(Math.abs(alert.absoluteMovement) * 100).toFixed(1)}pp
                                        </span>
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