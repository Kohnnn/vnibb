'use client';

import { useCallback, useEffect, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { WidgetEmpty, WidgetError, WidgetLoading } from '@/components/ui/widget-states';
import { API_BASE_URL } from '@/lib/api';

/**
 * Macro Calibration widget.
 *
 * Four-row summary strip that fetches the four `/estimate/{cpi,fed,recession,
 * macro}` endpoints and lays them out side-by-side. Each estimator caches
 * its result for 10 minutes server-side, so this widget stays cheap even
 * with multiple instances on the same dashboard.
 */

type CpiEstimateResponse = {
    readonly date: string;
    readonly n_markets: number;
    readonly p10: number;
    readonly p25: number;
    readonly p50: number;
    readonly p75: number;
    readonly p90: number;
    readonly confidence: number;
    readonly last_updated: string;
};

type FedEstimateRow = {
    readonly meeting_date: string;
    readonly p_cut: number;
    readonly p_hold: number;
    readonly p_hike: number;
    readonly implied_terminal_rate: number;
};

type FedEstimateResponse = {
    readonly meetings: readonly FedEstimateRow[];
    readonly confidence?: number;
    readonly n_markets?: number;
    readonly last_updated: string;
};

type RecessionEstimateResponse = {
    readonly year: number;
    readonly p_recession: number;
    readonly variance?: number;
    readonly n_contracts_per_source?: Record<string, number>;
    readonly sources: readonly { readonly source: string; readonly source_id: string; readonly probability: number }[];
    readonly confidence?: number;
    readonly last_updated: string;
};

type MacroEstimateResponse = {
    readonly cpi: CpiEstimateResponse;
    readonly fed: FedEstimateResponse;
    readonly recession: RecessionEstimateResponse;
    readonly composite: { readonly read: string; readonly last_updated: string };
};

type LoadState =
    | { readonly kind: 'loading' }
    | { readonly kind: 'error'; readonly error: Error }
    | { readonly kind: 'ready'; readonly payload: MacroEstimateResponse };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function MacroCalibrationWidget() {
    const [state, setState] = useState<LoadState>({ kind: 'loading' });

    const refresh = useCallback(() => {
        setState({ kind: 'loading' });
        const url = `${API_BASE_URL}/prediction-markets/estimate/macro`;
        fetch(url, { cache: 'no-store' })
            .then(async (response) => {
                if (!response.ok) throw new Error(`macro estimate API returned ${response.status}`);
                const body = await response.json();
                if (!isRecord(body)) throw new Error('macro estimate API returned malformed JSON');
                setState({ kind: 'ready', payload: body as unknown as MacroEstimateResponse });
            })
            .catch((error: unknown) => {
                setState({
                    kind: 'error',
                    error: error instanceof Error ? error : new Error('macro estimate failed'),
                });
            });
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    if (state.kind === 'loading') {
        return <WidgetLoading message="Computing macro calibration..." />;
    }
    if (state.kind === 'error') {
        return (
            <WidgetError
                title="Macro calibration unavailable"
                error={state.error}
                onRetry={refresh}
            />
        );
    }
    const { payload } = state;
    if (!payload.cpi || !payload.fed || !payload.recession) {
        return (
            <WidgetEmpty
                message="No macro calibration data"
                detail="The /estimate/macro endpoint returned an incomplete payload."
                icon={<BarChart3 size={18} />}
            />
        );
    }
    const nextMeeting = payload.fed.meetings?.[0];
    return (
        <div className="flex h-full flex-col gap-2 p-1">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <CalibrationTile
                    title="CPI"
                    value={`${payload.cpi.p50.toFixed(1)}%`}
                    range={`p25 ${payload.cpi.p25.toFixed(1)}% · p75 ${payload.cpi.p75.toFixed(1)}%`}
                    hint={`${payload.cpi.n_markets} markets`}
                    confidence={payload.cpi.confidence}
                />
                <CalibrationTile
                    title={nextMeeting ? `FOMC ${nextMeeting.meeting_date}` : 'Next FOMC'}
                    value={
                        nextMeeting
                            ? `${Math.round(nextMeeting.p_hold * 100)}% / ${Math.round(nextMeeting.p_cut * 100)}% / ${Math.round(nextMeeting.p_hike * 100)}%`
                            : '—'
                    }
                    range="Hold / Cut / Hike"
                    hint={nextMeeting ? `Implied terminal ${nextMeeting.implied_terminal_rate.toFixed(2)}%` : ''}
                    confidence={payload.fed.confidence}
                />
                <CalibrationTile
                    title={`Recession ${payload.recession.year}`}
                    value={`${Math.round(payload.recession.p_recession * 100)}%`}
                    range={payload.recession.sources.length > 0 ? `${payload.recession.sources[0].source} spot` : ''}
                    hint={`${payload.recession.sources.length} contracts`}
                    confidence={payload.recession.confidence}
                />
                <CalibrationTile
                    title="Macro composite"
                    value={payload.composite?.read ?? '—'}
                    range=""
                    hint={payload.composite?.last_updated ?? ''}
                />
            </div>
        </div>
    );
}

function ConfidencePill({ value }: { readonly value: number | undefined }) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        return (
            <span className="rounded-full border border-default px-2 py-0.5 text-[10px] text-[var(--text-muted)]">
                conf —
            </span>
        );
    }
    const bucket = value >= 0.66 ? 'emerald' : value >= 0.33 ? 'amber' : 'red';
    const colour =
        bucket === 'emerald'
            ? 'text-emerald-400 border-emerald-500/30'
            : bucket === 'amber'
                ? 'text-amber-300 border-amber-500/30'
                : 'text-red-400 border-red-500/30';
    return (
        <span className={`rounded-full border px-2 py-0.5 text-[10px] ${colour}`}>
            conf {Math.round(value * 100)}
        </span>
    );
}

function CalibrationTile(props: {
    title: string;
    value: string;
    range: string;
    hint: string;
    confidence?: number;
}) {
    return (
        <div className="rounded-lg border border-default bg-[var(--bg-tertiary)] p-3">
            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.14em] text-blue-300">
                <span>{props.title}</span>
                <ConfidencePill value={props.confidence} />
            </div>
            <div className="text-xl font-bold leading-tight text-[var(--text-primary)]">{props.value}</div>
            <div className="mt-1 text-[11px] text-[var(--text-muted)]">{props.range}</div>
            <div className="text-[11px] text-[var(--text-secondary)]">{props.hint}</div>
        </div>
    );
}
