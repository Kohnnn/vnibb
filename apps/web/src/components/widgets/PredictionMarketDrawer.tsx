'use client';

import { useCallback, useEffect, useState } from 'react';
import { Copy, X } from 'lucide-react';
import { WidgetEmpty, WidgetError, WidgetLoading } from '@/components/ui/widget-states';
import { API_BASE_URL } from '@/lib/api';
import { ConsensusStrip, Sparkline, ProbabilityBar } from './prediction-market-ui';

/**
 * Prediction Market Deep-Dive drawer.
 *
 * Click-through drawer that opens from any prediction-market row. Shows:
 * * 30-day YES price history (Sparkline from /history)
 * * Per-source consensus strip (from /consensus)
 * * Related-by-question list (from /consensus; same payload)
 * * Copy-link action via navigator.clipboard.writeText
 */

export interface PredictionMarketDrawerProps {
    readonly source: string | null;
    readonly sourceId: string | null;
    readonly question: string | null;
    readonly open: boolean;
    readonly onClose: () => void;
}

type HistoryPoint = { readonly captured_at: string; readonly yes_price: number };
type ConsensusSourceRow = {
    readonly source: string;
    readonly yes_price: number | null;
    readonly volume: number | null;
    readonly url: string | null;
};

type DrawerState =
    | { readonly kind: 'idle' }
    | { readonly kind: 'loading' }
    | { readonly kind: 'error'; readonly error: Error }
    | {
          readonly kind: 'ready';
          readonly history: readonly HistoryPoint[];
          readonly sources: readonly ConsensusSourceRow[];
          readonly consensus: number | null;
      };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseHistory(value: unknown): HistoryPoint[] {
    if (!isRecord(value)) return [];
    const list: unknown[] = Array.isArray(value.points) ? value.points : [];
    const out: HistoryPoint[] = [];
    for (const row of list) {
        if (!isRecord(row)) continue;
        if (typeof row.captured_at !== 'string' || typeof row.yes_price !== 'number') continue;
        out.push({ captured_at: row.captured_at, yes_price: row.yes_price });
    }
    return out;
}

function parseConsensus(value: unknown): {
    sources: ConsensusSourceRow[];
    consensus: number | null;
} {
    if (!isRecord(value)) return { sources: [], consensus: null };
    const list: unknown[] = Array.isArray(value.sources) ? value.sources : [];
    const sources: ConsensusSourceRow[] = [];
    for (const row of list) {
        if (!isRecord(row) || typeof row.source !== 'string') continue;
        sources.push({
            source: row.source,
            yes_price: typeof row.yes_price === 'number' ? row.yes_price : null,
            volume: typeof row.volume === 'number' ? row.volume : null,
            url: typeof row.url === 'string' ? row.url : null,
        });
    }
    const consensus = typeof value.consensus_yes_price === 'number' ? value.consensus_yes_price : null;
    return { sources, consensus };
}

export function PredictionMarketDrawer(props: PredictionMarketDrawerProps) {
    const { source, sourceId, question, open, onClose } = props;
    const [state, setState] = useState<DrawerState>({ kind: 'idle' });
    const [copied, setCopied] = useState(false);

    const refresh = useCallback(async () => {
        if (!source || !sourceId) {
            setState({ kind: 'idle' });
            return;
        }
        setState({ kind: 'loading' });
        try {
            const [historyRes, consensusRes] = await Promise.all([
                fetch(
                    `${API_BASE_URL}/prediction-markets/${encodeURIComponent(source)}/${encodeURIComponent(sourceId)}/history?days=30`,
                    { cache: 'no-store' },
                ),
                fetch(
                    `${API_BASE_URL}/prediction-markets/consensus?query=${encodeURIComponent((question ?? '').slice(0, 80))}`,
                    { cache: 'no-store' },
                ),
            ]);
            if (!historyRes.ok) throw new Error(`history API returned ${historyRes.status}`);
            if (!consensusRes.ok) throw new Error(`consensus API returned ${consensusRes.status}`);
            const historyBody = await historyRes.json();
            const consensusBody = await consensusRes.json();
            const { sources, consensus } = parseConsensus(consensusBody);
            setState({
                kind: 'ready',
                history: parseHistory(historyBody),
                sources,
                consensus,
            });
        } catch (error: unknown) {
            setState({
                kind: 'error',
                error: error instanceof Error ? error : new Error('drawer fetch failed'),
            });
        }
    }, [source, sourceId, question]);

    useEffect(() => {
        if (open) {
            void refresh();
        }
    }, [open, refresh]);

    const handleCopy = useCallback(async () => {
        if (!source || !sourceId) return;
        try {
            await navigator.clipboard.writeText(
                `${API_BASE_URL}/prediction-markets/${encodeURIComponent(source)}/${encodeURIComponent(sourceId)}/history`,
            );
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            setCopied(false);
        }
    }, [source, sourceId]);

    if (!open) return null;

    const prices = state.kind === 'ready' ? state.history.map((point) => point.yes_price) : [];
    const trend =
        prices.length >= 2
            ? prices[prices.length - 1] - prices[0]
            : 0;

    return (
        <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-50 flex items-end justify-end bg-black/40 p-3 sm:items-center sm:justify-center"
            onClick={onClose}
        >
            <div
                className="flex w-full max-w-md flex-col gap-3 rounded-lg border border-default bg-[var(--bg-secondary)] p-4 shadow-xl"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-blue-300">
                            Deep dive · {source ?? 'unknown'}
                        </div>
                        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                            {question ?? 'Prediction market'}
                        </h3>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-md p-1 text-[var(--text-muted)] hover:bg-blue-500/10 hover:text-blue-300"
                        aria-label="Close drawer"
                    >
                        <X size={14} />
                    </button>
                </div>

                {state.kind === 'loading' && <WidgetLoading message="Loading history..." />}
                {state.kind === 'error' && (
                    <WidgetError
                        title="Could not load market detail"
                        error={state.error}
                        onRetry={refresh}
                    />
                )}
                {state.kind === 'ready' && (
                    <>
                        <div className="flex flex-col gap-2">
                            <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                                <span>30-day price history</span>
                                <span>{trend >= 0 ? '↑' : '↓'} {Math.abs(trend * 100).toFixed(1)}pp</span>
                            </div>
                            {prices.length < 2 ? (
                                <div className="text-[11px] text-[var(--text-muted)]">
                                    Not enough history yet — backfill on first boot will populate soon.
                                </div>
                            ) : (
                                <Sparkline values={prices} width={320} height={80} />
                            )}
                            {prices.length > 0 && (
                                <ProbabilityBar
                                    value={prices[prices.length - 1]}
                                    delta={prices.length > 1 ? trend : null}
                                    showLabels
                                />
                            )}
                        </div>

                        {state.sources.length > 0 && (
                            <div className="flex flex-col gap-1">
                                <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                                    Cross-source consensus
                                </div>
                                {state.consensus !== null && (
                                    <div className="text-sm font-semibold text-[var(--text-primary)]">
                                        Consensus {Math.round(state.consensus * 100)}%
                                    </div>
                                )}
                                <ConsensusStrip
                                    rows={state.sources.map((row) => ({
                                        source: row.source,
                                        yesPrice: row.yes_price,
                                        url: row.url,
                                    }))}
                                    caption="Per-source"
                                />
                                <div className="mt-2 flex flex-col gap-1">
                                    <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                                        Related on other sources
                                    </div>
                                    <ul className="flex flex-col gap-1 text-xs">
                                        {state.sources
                                            .filter((row) => row.source !== (source ?? ''))
                                            .map((row) => (
                                                <li
                                                    key={row.source}
                                                    className="flex items-center justify-between rounded-md border border-default bg-[var(--bg-tertiary)] px-2 py-1"
                                                >
                                                    <a
                                                        href={row.url ?? '#'}
                                                        target={row.url ? '_blank' : undefined}
                                                        rel="noreferrer"
                                                        className="text-[var(--text-primary)] hover:text-blue-300"
                                                    >
                                                        {row.source}
                                                    </a>
                                                    <span>
                                                        {row.yes_price === null
                                                            ? '—'
                                                            : `${Math.round(row.yes_price * 100)}%`}
                                                    </span>
                                                </li>
                                            ))}
                                    </ul>
                                </div>
                            </div>
                        )}

                        <button
                            type="button"
                            onClick={handleCopy}
                            className="flex items-center justify-center gap-2 rounded-md border border-default bg-[var(--bg-tertiary)] px-3 py-2 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                        >
                            <Copy size={12} />
                            {copied ? 'Link copied' : 'Copy market link'}
                        </button>
                    </>
                )}
                {state.kind === 'idle' && (
                    <WidgetEmpty
                        message="No market selected"
                        detail="Click a market row from a prediction-market widget to see history here."
                    />
                )}
            </div>
        </div>
    );
}