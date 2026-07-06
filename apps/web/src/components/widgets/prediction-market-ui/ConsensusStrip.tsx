'use client';

import { ProbabilityBar } from './ProbabilityBar';

/**
 * ConsensusStrip — Polymarket vs. Kalshi (or any two sources) comparator.
 *
 * Renders a vertical stack of probability bars so users can spot at a
 * glance which source is pricing the same question higher.
 */

export interface ConsensusRow {
    readonly source: string;
    readonly yesPrice: number | null;
    readonly url: string | null;
}

export interface ConsensusStripProps {
    readonly rows: readonly ConsensusRow[];
    readonly caption?: string;
}

export function ConsensusStrip({ rows, caption }: ConsensusStripProps) {
    if (rows.length === 0) {
        return null;
    }
    const pricedRows = rows.filter((row): row is ConsensusRow & { yesPrice: number } => row.yesPrice !== null);
    if (pricedRows.length === 0) {
        return null;
    }
    const prices = pricedRows.map((row) => row.yesPrice);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const gap = max - min;
    return (
        <div className="flex flex-col gap-1 rounded-lg border border-default bg-[var(--bg-secondary)] p-2 text-[11px]">
            {caption && (
                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                    <span>{caption}</span>
                    <span>{gap >= 0.05 ? `${(gap * 100).toFixed(0)}pp gap` : 'aligned'}</span>
                </div>
            )}
            {rows.map((row) => (
                <div key={row.source} className="flex items-center gap-2">
                    <span className="w-20 text-[10px] uppercase text-[var(--text-muted)]">
                        {row.source}
                    </span>
                    <div className="flex-1">
                        <ProbabilityBar value={row.yesPrice ?? 0} height={6} />
                    </div>
                    <span className="w-10 text-right text-[11px] tabular-nums text-[var(--text-primary)]">
                        {row.yesPrice === null ? '—' : `${Math.round(row.yesPrice * 100)}%`}
                    </span>
                </div>
            ))}
        </div>
    );
}