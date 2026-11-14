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
    /** Source observation clock for both legs; null when the API omitted them. */
    readonly observedAt: string | null;
    readonly baselineAt: string | null;
    readonly elapsedSeconds: number | null;
};

/**
 * Why the alert list looks the way it does. Only `evaluated_zero` licenses a
 * "nothing moved" conclusion; every other status means the comparison did not
 * actually cover the requested window.
 */
type AlertStatus =
    | 'unavailable_storage'
    | 'empty'
    | 'no_baseline'
    | 'stale_insufficient'
    | 'evaluated_zero'
    | 'evaluated'
    | 'unknown';

type AlertCoverage = {
    readonly eligibleMarkets: number;
    readonly observedMarkets: number;
    readonly currentMarkets: number;
    readonly evaluatedMarkets: number;
    readonly excludedStaleMarkets: number;
    readonly excludedNoBaselineMarkets: number;
};

type AlertsPayload = {
    readonly alerts: AlertRow[];
    readonly windowHours: number;
    readonly status: AlertStatus;
    readonly coverage: AlertCoverage | null;
    readonly latestObservationAt: string | null;
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
    'unavailable_storage', 'empty', 'no_baseline', 'stale_insufficient', 'evaluated_zero', 'evaluated',
];

function parseCoverage(value: unknown): AlertCoverage | null {
    if (!isRecord(value)) return null;
    const num = (key: string) => (typeof value[key] === 'number' ? (value[key] as number) : 0);
    return {
        eligibleMarkets: num('eligible_markets'),
        observedMarkets: num('observed_markets'),
        currentMarkets: num('current_markets'),
        evaluatedMarkets: num('evaluated_markets'),
        excludedStaleMarkets: num('excluded_stale_markets'),
        excludedNoBaselineMarkets: num('excluded_no_baseline_markets'),
    };
}

function parseAlerts(value: unknown): AlertsPayload {
    if (!isRecord(value)) {
        return {
            alerts: [], windowHours: 1, status: 'unknown', coverage: null,
            latestObservationAt: null, baselineToleranceSeconds: null,
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
            observedAt:
                typeof row.observed_at === 'string'
                    ? row.observed_at
                    : typeof row.captured_at === 'string'
                        ? row.captured_at
                        : null,
            baselineAt: typeof row.baseline_at === 'string' ? row.baseline_at : null,
            elapsedSeconds: typeof row.elapsed_seconds === 'number' ? row.elapsed_seconds : null,
        });
    }
    const rawStatus = value.status;
    // A response without a status cannot license a no-movement claim.
    const status = ALERT_STATUSES.includes(rawStatus as AlertStatus)
        ? (rawStatus as AlertStatus)
        : alerts.length > 0
            ? 'evaluated'
            : 'unknown';
    return {
        alerts,
        windowHours: typeof value.window_hours === 'number' ? value.window_hours : 1,
        status,
        coverage: parseCoverage(value.coverage),
        latestObservationAt:
            typeof value.latest_observation_at === 'string' ? value.latest_observation_at : null,
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

/** What the widget may claim: only `loaded` on a genuinely evaluated window. */
function alertFeedState(state: LoadState): 'unavailable' | 'loading' | 'stale' | 'partial' | 'loaded' {
    if (state.kind === 'error') return 'unavailable';
    if (state.kind !== 'ready') return 'loading';
    if (state.stale) return 'stale';
    if (state.status === 'unavailable_storage') return 'unavailable';
    if (state.status === 'evaluated' || state.status === 'evaluated_zero') return 'loaded';
    return 'partial';
}

/** Honest empty-state copy: never assert "nothing moved" without evaluation. */
function alertEmptyCopy(state: Extract<LoadState, { kind: 'ready' }>): { message: string; detail: string } {
    const window = `${state.windowHours}h`;
    const coverage = state.coverage;
    switch (state.status) {
        case 'unavailable_storage':
            return {
                message: 'Alert storage unavailable',
                detail: 'Intraday snapshots cannot be read, so no movement was measured.',
            };
        case 'empty':
            return {
                message: 'No observations yet',
                detail: `No intraday snapshot has been recorded, so the ${window} window was not evaluated.`,
            };
        case 'no_baseline':
            return {
                message: 'Baseline missing',
                detail: coverage
                    ? `${coverage.observedMarkets} market(s) observed but none has a snapshot ${window} back.`
                    : `No snapshot exists ${window} back to compare against.`,
            };
        case 'stale_insufficient':
            return {
                message: 'Coverage too sparse',
                detail: coverage
                    ? `${coverage.excludedStaleMarkets} market(s) lacked a baseline within the ${state.baselineToleranceSeconds ?? 0}s sampling tolerance of the ${window} cutoff.`
                    : `Nearest baselines fall outside the sampling tolerance of the ${window} cutoff.`,
            };
        case 'evaluated_zero':
            return {
                message: 'No alerts',
                detail: coverage
                    ? `No market moved more than 2pp in the last ${window} (${coverage.evaluatedMarkets} of ${coverage.eligibleMarkets} markets evaluated).`
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
            // Partial or absent coverage is not an empty result: only a genuinely
            // evaluated zero-alert window may compact the tile.
            empty: state.kind === 'ready' && state.alerts.length === 0 && state.status === 'evaluated_zero',
            apiGroup: '/prediction-markets',
            endpoint: '/api/v1/prediction-markets/alerts',
            sourceLabel: 'Prediction market alerts',
            lastDataDate: state.kind === 'ready' ? state.latestObservationAt : null,
            coverage: state.kind === 'ready' && state.coverage
                ? state.coverage.evaluatedMarkets > 0
                    && state.coverage.evaluatedMarkets === state.coverage.eligibleMarkets
                    ? 'complete'
                    : state.coverage.evaluatedMarkets === 0
                        ? 'unknown'
                        : 'partial'
                : undefined,
            stale: state.kind === 'error'
                || (state.kind === 'ready' && (state.stale || state.status === 'stale_insufficient')),
            extra: {
                feedState: alertFeedState(state),
                alertCount: state.kind === 'ready' ? state.alerts.length : 0,
                alertStatus: state.kind === 'ready' ? state.status : undefined,
                alertCoverage: state.kind === 'ready' ? state.coverage : null,
                windowHours: state.kind === 'ready' ? state.windowHours : undefined,
                latestObservationAt: state.kind === 'ready' ? state.latestObservationAt : null,
            },
        }));
    }, [onDataChange, state]);

    useEffect(() => {
        if (state.kind !== 'ready') return;
        for (const alert of state.alerts) {
            // Activity records keep the actual comparison span so a later reader
            // cannot mistake a wide interval for the requested window.
            const span = alert.elapsedSeconds === null
                ? `${state.windowHours}h`
                : `${(alert.elapsedSeconds / 3600).toFixed(alert.elapsedSeconds % 3600 === 0 ? 0 : 1)}h`;
            recordAlertActivity({
                id: `prediction:${alert.source}:${alert.sourceId}:${alert.observedAt || state.windowHours}:${alert.absoluteMovement}`,
                source: 'prediction_market',
                triggerTime: alert.observedAt || new Date().toISOString(),
                deliveryClass: 'polled',
                serverBacked: true,
                title: `${alert.source} probability movement`,
                detail: `${alert.question} · ${(Math.abs(alert.absoluteMovement) * 100).toFixed(1)}pp over ${span}`
                    + (alert.observedAt && alert.baselineAt ? ` (${alert.baselineAt} → ${alert.observedAt})` : ''),
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
                    ? ` · ${state.coverage.evaluatedMarkets}/${state.coverage.eligibleMarkets} evaluated`
                    : ''}
                {state.latestObservationAt
                    ? ` · last observation ${new Date(state.latestObservationAt).toLocaleString()}`
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