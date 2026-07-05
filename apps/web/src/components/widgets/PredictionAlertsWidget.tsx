'use client';

import { useCallback, useEffect, useState } from 'react';
import { BellRing } from 'lucide-react';
import { WidgetEmpty, WidgetError, WidgetLoading } from '@/components/ui/widget-states';
import { API_BASE_URL } from '@/lib/api';

/**
 * Prediction-market Alerts.
 *
 * Pulls `/prediction-markets/alerts?window=1h` and renders up/down cards
 * with category pills. Tolerates an empty alerts list (no movement above
 * the threshold) by rendering a friendly empty state instead of an error.
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
            typeof row.absolute_movement === 'number'
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
        });
    }
    return {
        alerts,
        windowHours: typeof value.window_hours === 'number' ? value.window_hours : 1,
    };
}

export function PredictionAlertsWidget() {
    const [state, setState] = useState<LoadState>({ kind: 'loading' });

    const refresh = useCallback(() => {
        setState({ kind: 'loading' });
        const url = new URL(`${API_BASE_URL}/prediction-markets/alerts`);
        url.searchParams.set('window', '1');
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
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    if (state.kind === 'loading') {
        return <WidgetLoading message="Computing alerts..." />;
    }
    if (state.kind === 'error') {
        return <WidgetError title="Alerts unavailable" error={state.error} onRetry={refresh} />;
    }
    if (state.alerts.length === 0) {
        return (
            <WidgetEmpty
                message="No alerts"
                detail={`No market moved more than 2pp in the last ${state.windowHours}h.`}
                icon={<BellRing size={18} />}
            />
        );
    }

    return (
        <div className="flex h-full flex-col gap-2 overflow-auto p-1">
            {state.alerts.map((alert) => (
                <a
                    key={`${alert.source}:${alert.sourceId}`}
                    href={alert.url ?? '#'}
                    target={alert.url ? '_blank' : undefined}
                    rel="noreferrer"
                    className="flex items-center justify-between gap-3 rounded-lg border border-default bg-[var(--bg-tertiary)] p-3 text-xs transition-colors hover:bg-[var(--bg-hover)]"
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
                        <span className="text-sm font-semibold text-[var(--text-primary)]">
                            {alert.question}
                        </span>
                        <span className="text-[10px] text-[var(--text-muted)]">
                            {Math.round(alert.previousYesPrice * 100)}% → {Math.round(alert.yesPrice * 100)}%
                        </span>
                    </div>
                    <div
                        className={
                            alert.direction === 'up'
                                ? 'rounded-md px-2 py-1 text-xs text-emerald-400'
                                : 'rounded-md px-2 py-1 text-xs text-red-400'
                        }
                    >
                        {alert.direction === 'up' ? '▲' : '▼'}{' '}
                        {(Math.abs(alert.absoluteMovement) * 100).toFixed(1)}pp
                    </div>
                </a>
            ))}
        </div>
    );
}