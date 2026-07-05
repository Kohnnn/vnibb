'use client';

import { Layers } from 'lucide-react';
import { WidgetEmpty, WidgetError, WidgetLoading } from '@/components/ui/widget-states';
import { usePredictionMarketConsensus } from './usePredictionMarketConsensus';

/**
 * Consensus Odds widget.
 *
 * Multi-source readout: pulls Polymarket + Kalshi active markets through
 * the shared ``usePredictionMarketConsensus`` hook (Phase 8) and renders
 * side-by-side comparisons. Used to spot agreement / disagreement between
 * regulated (Kalshi) and offshore (Polymarket) platforms.
 *
 * The widget description advertises "AI sentiment" — that hook is
 * intentionally deferred (see plan Phase 8). For now the comparison is
 * pure source-vs-source.
 */

export function ConsensusOddsWidget() {
    const state = usePredictionMarketConsensus({ limit: 30 });

    if (state.kind === 'loading') {
        return <WidgetLoading message="Building consensus signal..." />;
    }
    if (state.kind === 'error') {
        return <WidgetError title="Consensus unavailable" error={state.error} onRetry={state.refresh} />;
    }
    if (state.rows.length === 0) {
        return (
            <WidgetEmpty
                message="No consensus data"
                detail="Neither Polymarket nor Kalshi returned any active markets."
                icon={<Layers size={18} />}
            />
        );
    }
    return (
        <div className="flex h-full flex-col gap-2 overflow-auto p-1">
            {state.rows.slice(0, 12).map((row) => (
                <a
                    key={`${row.source}:${row.sourceId}`}
                    href={row.url ?? '#'}
                    target={row.url ? '_blank' : undefined}
                    rel="noreferrer"
                    className="block rounded-lg border border-default bg-[var(--bg-tertiary)] p-3 text-xs transition-colors hover:bg-[var(--bg-hover)]"
                >
                    <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-blue-300">
                        {row.source}
                    </div>
                    <h3 className="text-sm font-semibold leading-snug text-[var(--text-primary)]">
                        {row.question}
                    </h3>
                    <div className="mt-1 text-[var(--text-secondary)]">
                        Yes probability {Math.round(row.yesPrice * 100)}%
                    </div>
                </a>
            ))}
        </div>
    );
}
