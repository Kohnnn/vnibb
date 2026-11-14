'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BellRing } from 'lucide-react';
import { WidgetEmpty, WidgetError, WidgetLoading } from '@/components/ui/widget-states';
import { API_BASE_URL } from '@/lib/api';
import { Sparkline, usePersistedWidgetConfig } from './prediction-market-ui';
import { PredictionMarketContextMenu } from './PredictionMarketContextMenu';
import { PredictionMarketDrawer } from './PredictionMarketDrawer';
import { PredictionMarketSourceHealthStrip } from './PredictionMarketSourceHealthStrip';
import { buildWidgetRuntime } from '@/lib/widgetRuntime';
import { recordAlertActivity } from '@/lib/alertActivity';

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
    /** Source observation clock for both legs; null only if the API omitted them. */
    readonly baselineObservedAt: string | null;
    readonly currentObservedAt: string | null;
    readonly elapsedSeconds: number | null;
};

/**
 * Why the alert list looks the way it does. Only `complete` licenses an
 * aggregate "nothing moved" conclusion; `stale` may only describe the subset it
 * actually evaluated.
 */
type AlertStatus = 'unavailable' | 'empty' | 'no_baseline' | 'stale' | 'complete' | 'unknown';

type AlertCoverage = {
    readonly comparableMarkets: number;
    readonly currentMarkets: number;
    readonly evaluatedMarkets: number;
};

type AlertsPayload = {
    readonly alerts: AlertRow[];
    readonly windowHours: number;
    readonly status: AlertStatus;
    readonly coverage: AlertCoverage | null;
    readonly dataObservedThrough: string | null;
    readonly baselineToleranceSeconds: number | null;
};

type LoadState =
    | { readonly kind: 'loading' }
    | { readonly kind: 'error'; readonly error: Error }
    | ({ readonly kind: 'ready'; readonly stale: boolean; readonly error?: Error } & AlertsPayload);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const ALERT_STATUSES: readonly AlertStatus[] = [
    'unavailable', 'empty', 'no_baseline', 'stale', 'complete',
];

function parseCoverage(value: unknown): AlertCoverage | null {
    if (!isRecord(value)) return null;
    const num = (key: string) => (typeof value[key] === 'number' ? (value[key] as number) : 0);
    return {
        comparableMarkets: num('comparable_markets'),
        currentMarkets: num('current_markets'),
        evaluatedMarkets: num('evaluated_markets'),
    };
}

function parseAlerts(value: unknown): AlertsPayload {
    if (!isRecord(value)) {
        return {
            alerts: [], windowHours: 1, status: 'unknown', coverage: null,
            dataObservedThrough: null, baselineToleranceSeconds: null,
        };
    }
    const list: unknown[] = Array.isArray(value.alerts)
        ? value.alerts
        : Array.isArray(value.data)
            ? value.data
            : [];
    const alerts: AlertRow[] = [];
    for (const row of list) {
        if (!isRecord(row) || typeof row.question !== 'string') continue;
        const direction: 'up' | 'down' = row.direction === 'down' ? 'down' : 'up';
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
            baselineObservedAt:
                typeof row.baseline_observed_at === 'string' ? row.baseline_observed_at : null,
            currentObservedAt:
                typeof row.current_observed_at === 'string'
                    ? row.current_observed_at
                    : typeof row.captured_at === 'string'
                        ? row.captured_at
                        : null,
            elapsedSeconds: typeof row.elapsed_seconds === 'number' ? row.elapsed_seconds : null,
        });
    }
    const rawStatus = value.status;
    // A response without a status cannot license a no-movement claim.
    const status = ALERT_STATUSES.includes(rawStatus as AlertStatus)
        ? (rawStatus as AlertStatus)
        : 'unknown';
    return {
        alerts,
        windowHours: typeof value.window_hours === 'number' ? value.window_hours : 1,
        status,
        coverage: parseCoverage(value.coverage),
        dataObservedThrough:
            typeof value.data_observed_through === 'string' ? value.data_observed_through : null,
        baselineToleranceSeconds:
            typeof value.baseline_tolerance_seconds === 'number'
                ? value.baseline_tolerance_seconds
                : null,
    };
}

const BUCKETS: ReadonlyArray<{ readonly key: '1h' | '4h' | '24h'; readonly hours: number; readonly label: string }> = [
    { key: '1h', hours: 1, label: 'Last 1h' },
    { key: '4h', hours: 4, label: 'Last 4h' },
    { key: '24h', hours: 24, label: 'Last 24h' },
];

/** What the widget may claim: `loaded` only for a fully evaluated window. */
function alertFeedState(state: LoadState): 'unavailable' | 'loading' | 'stale' | 'partial' | 'empty' | 'loaded' {
    if (state.kind === 'error') return 'unavailable';
    if (state.kind !== 'ready') return 'loading';
    if (state.stale || state.status === 'stale') return 'stale';
    if (state.status === 'unavailable') return 'unavailable';
    if (state.status === 'empty') return 'empty';
    return state.status === 'complete' ? 'loaded' : 'partial';
}

/** Honest empty-state copy: never assert "nothing moved" without evaluation. */
function alertEmptyCopy(state: Extract<LoadState, { kind: 'ready' }>): { message: string; detail: string } {
    const window = `${state.windowHours}h`;
    const coverage = state.coverage;
    const toleranceMinutes = Math.round((state.baselineToleranceSeconds ?? 0) / 60);
    switch (state.status) {
        case 'unavailable':
            return {
                message: 'Alerts unavailable',
                detail: 'The intraday snapshot store could not be read; no evaluation was performed.',
            };
        case 'empty':
            return {
                message: 'No intraday market observations yet',
                detail: 'The alerts feed has recorded no observations; nothing has been evaluated.',
            };
        case 'no_baseline':
            return {
                message: `Not enough intraday history for the last ${window}`,
                detail: `No comparison baseline exists within ${toleranceMinutes} min of the ${window} cutoff; nothing has been evaluated.`,
            };
        case 'stale':
            return {
                message: 'Coverage incomplete',
                detail: coverage
                    ? `${coverage.evaluatedMarkets} of ${coverage.comparableMarkets} markets evaluated for the last ${window}. No movement detected in the evaluated subset.`
                    : `Coverage of the last ${window} could not be verified. No movement detected in the evaluated subset.`,
            };
        case 'complete':
            return {
                message: 'No alerts',
                detail: coverage
                    ? `No market moved more than 2pp in the last ${window} (${coverage.evaluatedMarkets} markets evaluated).`
                    : `No market moved more than 2pp in the last ${window}.`,
            };
        default:
            return {
                message: 'Alert status unknown',
                detail: 'The alerts response did not report whether the window was evaluated.',
            };
    }
}

export function PredictionAlertsWidget({ onDataChange }: { onDataChange?: (data: WidgetDataPayload) => void }) {
    const [state, setState] = useState<LoadState>({ kind: 'loading' });
    const requestIdRef = useRef(0);
    const [config, setConfig] = usePersistedWidgetConfig<{ bucket: '1h' | '4h' | '24h' }>(
        'vnibb.prediction-alerts.config',
        { bucket: '1h' },
    );
    const [selection, setSelection] = useState<{ source: string; sourceId: string; question: string } | null>(null);
    const [historyMap, setHistoryMap] = useState<Record<string, readonly number[]>>({});

    const refresh = useCallback(() => {
        const requestId = ++requestIdRef.current;
        setState((current) => current.kind === 'ready' ? current : { kind: 'loading' });
        const url = new URL(`${API_BASE_URL}/prediction-markets/alerts`);
        const hours = BUCKETS.find((bucket) => bucket.key === config.bucket)?.hours ?? 1;
        url.searchParams.set('window_hours', String(hours));
        url.searchParams.set('min_movement_bps', '200');
        url.searchParams.set('limit', '12');
        fetch(url.toString(), { cache: 'no-store' })
            .then(async (response) => {
                if (!response.ok) throw new Error(`alerts API returned ${response.status}`);
                const body: unknown = await response.json();
                const payload = parseAlerts(body);
                if (requestId !== requestIdRef.current) return;
                setState({ kind: 'ready', ...payload, stale: false });
            })
            .catch((error: unknown) => {
                const resolvedError = error instanceof Error ? error : new Error('alerts request failed');
                if (requestId !== requestIdRef.current) return;
                setState((current) => current.kind === 'ready'
                    ? { ...current, stale: true, error: resolvedError }
                    : { kind: 'error', error: resolvedError });
            });
    }, [config.bucket]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    useEffect(() => {
        onDataChange?.(buildWidgetRuntime({
            // Only a complete evaluated zero-alert window may compact the tile, so
            // derived summaries never propagate "empty" for an unaudited window.
            empty: state.kind === 'ready' && state.status === 'complete' && state.alerts.length === 0
                && (state.coverage?.evaluatedMarkets ?? 0) > 0,
            apiGroup: '/prediction-markets',
            endpoint: '/api/v1/prediction-markets/alerts',
            sourceLabel: 'Prediction market alerts',
            lastDataDate: state.kind === 'ready' ? state.dataObservedThrough : null,
            coverage: state.kind === 'ready'
                ? (state.coverage?.evaluatedMarkets ?? 0) === 0
                    ? 'unknown'
                    : state.status === 'complete'
                        ? 'complete'
                        : 'partial'
                : undefined,
            stale: state.kind === 'error' || (state.kind === 'ready' && alertFeedState(state) === 'stale'),
            extra: {
                feedState: alertFeedState(state),
                windowHours: state.kind === 'ready' ? state.windowHours : undefined,
                status: state.kind === 'ready' ? state.status : undefined,
                evaluatedMarkets: state.kind === 'ready' ? (state.coverage?.evaluatedMarkets ?? 0) : 0,
                comparableMarkets: state.kind === 'ready' ? (state.coverage?.comparableMarkets ?? 0) : 0,
                baselineToleranceSeconds: state.kind === 'ready' ? state.baselineToleranceSeconds : null,
            },
        }));
    }, [onDataChange, state]);

    useEffect(() => {
        if (state.kind !== 'ready') return;
        // A partial window keeps honest rows, so every record carries the subset
        // qualifier: the bell must not present one as full coverage.
        const qualifier = state.status === 'complete' || !state.coverage
            ? ''
            : ` — coverage incomplete (${state.coverage.evaluatedMarkets} of ${state.coverage.comparableMarkets} markets evaluated, status ${state.status})`;
        for (const alert of state.alerts) {
            // Identity includes the requested window as well as the observation
            // clock: the same move seen through the 1h and 4h tabs is two
            // comparisons with different interval evidence, and the activity
            // store keeps the first record for a given ID.
            const span = alert.elapsedSeconds === null
                ? 'an unmeasured interval'
                : `${(alert.elapsedSeconds / 3600).toFixed(2)}h`;
            recordAlertActivity({
                id: `prediction:${alert.source}:${alert.sourceId}:${state.windowHours}h:${alert.currentObservedAt ?? alert.baselineObservedAt ?? 'unknown'}:${alert.absoluteMovement}`,
                source: 'prediction_market',
                triggerTime: alert.currentObservedAt ?? new Date().toISOString(),
                deliveryClass: 'polled',
                serverBacked: true,
                title: `${alert.source} probability movement`,
                detail: `${alert.question} · ${(Math.abs(alert.absoluteMovement) * 100).toFixed(1)}pp over ${span}`
                    + ` (window ${state.windowHours}h)${qualifier}`,
            });
        }
    }, [state]);

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
                                    ? 'border-[var(--color-state-border)] bg-[var(--color-state-bg)] text-[var(--color-accent-primary)]'
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
            <PredictionMarketSourceHealthStrip />
            <div className="px-1 text-[10px] text-[var(--text-muted)]">
                Feed {alertFeedState(state)}
                {' · '}{state.windowHours}h window
                {state.coverage
                    ? ` · ${state.coverage.evaluatedMarkets}/${state.coverage.comparableMarkets} markets evaluated`
                    : ''}
                {state.dataObservedThrough
                    ? ` · observed through ${new Date(state.dataObservedThrough).toLocaleString()}`
                    : ''}
            </div>
            {state.alerts.length === 0 ? (
                <WidgetEmpty
                    {...alertEmptyCopy(state)}
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
                                            <span className="text-[var(--color-accent-primary)]">{alert.source}</span>
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
                                            {alert.elapsedSeconds !== null && (
                                                <span className="ml-1 text-[var(--text-muted)]">
                                                    over {(alert.elapsedSeconds / 3600).toFixed(1)}h
                                                </span>
                                            )}
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
                                                    ? 'rounded-md px-2 py-1 text-xs text-[var(--color-positive)]'
                                                    : 'rounded-md px-2 py-1 text-xs text-[var(--color-negative)]'
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