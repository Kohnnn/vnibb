'use client';

import { Layers } from 'lucide-react';
import { WidgetEmpty, WidgetError, WidgetLoading } from '@/components/ui/widget-states';
import { usePredictionMarketConsensus } from './usePredictionMarketConsensus';
import { formatProb } from './PredictionMarketSource';


export function ConsensusOddsWidget() {
    const state = usePredictionMarketConsensus({ limit: 30 });

    if (state.kind === 'loading') {
        return <WidgetLoading message="Loading related market prices..." />;
    }
    if (state.kind === 'error') {
        return <WidgetError title="Related markets unavailable" error={state.error} onRetry={state.refresh} />;
    }
    if (state.rows.length === 0) {
        return (
            <WidgetEmpty
                message="No data"
                detail="No fresh, genuine markets are available from Polymarket or Kalshi."
                icon={<Layers size={18} />}
            />
        );
    }
    return (
        <div className="flex h-full flex-col gap-2 overflow-auto p-1">
            <p className="text-[11px] text-[var(--text-muted)]">Individual reported prices from a bounded catalogue. Different questions are not equivalent contracts or a consensus.</p>
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
                        {row.outcomeLabel} {row.yesPrice === null ? 'No data' : formatProb(row.yesPrice)}
                    </div>
                </a>
            ))}
        </div>
    );
}
