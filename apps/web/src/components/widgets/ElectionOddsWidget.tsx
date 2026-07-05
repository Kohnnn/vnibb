'use client';

import { useCallback, useEffect, useState } from 'react';
import { Vote } from 'lucide-react';
import { WidgetEmpty, WidgetError, WidgetLoading } from '@/components/ui/widget-states';
import { API_BASE_URL } from '@/lib/api';

/**
 * Election Odds Composite widget.
 *
 * Combines Polymarket and Kalshi politics markets on a single tile with a
 * small consensus read. Phase 8:
 *  * Uses the canonical ``?category=politics`` filter (the read endpoint
 *    maps friendly names to canonical buckets) instead of the substring
 *    substring-search client-side filter.
 *  * Dedupes by a normalised question fingerprint so the same market
 *    listed under slightly different wording doesn't render twice.
 */

type PoliticsMarket = {
    readonly source: string;
    readonly question: string;
    readonly yesPrice: number | null;
    readonly volume: number | null;
    readonly url: string | null;
};

type LoadState =
    | { readonly kind: 'loading' }
    | { readonly kind: 'error'; readonly error: Error }
    | { readonly kind: 'ready'; readonly markets: readonly PoliticsMarket[] };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseMarkets(value: unknown): PoliticsMarket[] {
    if (!isRecord(value)) return [];
    const data = Array.isArray(value.data) ? value.data : Array.isArray(value.markets) ? value.markets : [];
    const out: PoliticsMarket[] = [];
    for (const row of data) {
        if (!isRecord(row) || typeof row.question !== 'string') continue;
        if (typeof row.category !== 'string' || !row.category.toLowerCase().includes('polit')) continue;
        const pricesRaw = Array.isArray(row.outcome_prices)
            ? row.outcome_prices
            : Array.isArray((row as Record<string, unknown>).outcomePrices)
                ? (row as Record<string, unknown>).outcomePrices
                : [];
        const yesPrice = Array.isArray(pricesRaw) && pricesRaw.length > 0 && typeof pricesRaw[0] === 'number'
            ? (pricesRaw[0] as number)
            : null;
        out.push({
            source: typeof row.source === 'string' ? row.source : 'unknown',
            question: row.question,
            yesPrice,
            volume: parseNumber(row.volume),
            url: typeof row.url === 'string' ? row.url : null,
        });
    }
    return out;
}

function fingerprint(question: string): string {
    return question.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80);
}

export function ElectionOddsWidget() {
    const [state, setState] = useState<LoadState>({ kind: 'loading' });

    const refresh = useCallback(() => {
        setState({ kind: 'loading' });
        const urls = [
            `${API_BASE_URL}/prediction-markets?source=polymarket&category=politics&active=true&limit=15`,
            `${API_BASE_URL}/prediction-markets?source=kalshi&category=politics&active=true&limit=15`,
        ];
        Promise.all(
            urls.map((url) =>
                fetch(url, { cache: 'no-store' }).then(async (response) => {
                    if (!response.ok) throw new Error(`Politics markets API returned ${response.status}`);
                    return parseMarkets(await response.json());
                }),
            ),
        )
            .then(([poly, kalshi]) => {
                const dedup = new Map<string, PoliticsMarket>();
                for (const row of [...poly, ...kalshi]) dedup.set(`${row.source}:${fingerprint(row.question)}`, row);
                setState({ kind: 'ready', markets: Array.from(dedup.values()) });
            })
            .catch((error: unknown) => {
                setState({
                    kind: 'error',
                    error: error instanceof Error ? error : new Error('Election odds request failed'),
                });
            });
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    if (state.kind === 'loading') {
        return <WidgetLoading message="Loading election odds..." />;
    }
    if (state.kind === 'error') {
        return <WidgetError title="Election odds unavailable" error={state.error} onRetry={refresh} />;
    }
    if (state.markets.length === 0) {
        return (
            <WidgetEmpty
                message="No election markets available"
                detail="Add a politics-tagged prediction market to either Polymarket or Kalshi."
                icon={<Vote size={18} />}
            />
        );
    }

    const consensusAvg = (() => {
        const priced = state.markets.filter((m): m is PoliticsMarket & { yesPrice: number } => m.yesPrice !== null);
        if (priced.length === 0) return null;
        return priced.reduce((acc, m) => acc + m.yesPrice, 0) / priced.length;
    })();

    return (
        <div className="flex h-full flex-col gap-3 p-1">
            {consensusAvg !== null && (
                <div className="rounded border border-default bg-[var(--bg-tertiary)] px-3 py-2 text-[11px] text-[var(--text-muted)]">
                    Consensus (avg of {state.markets.length} markets):{' '}
                    <span className="font-bold text-[var(--text-primary)]">
                        {Math.round(consensusAvg * 100)}%
                    </span>
                </div>
            )}
            <div className="flex flex-col gap-2">
                {state.markets.map((market) => (
                    <a
                        key={`${market.source}:${market.question}`}
                        href={market.url ?? '#'}
                        target={market.url ? '_blank' : undefined}
                        rel="noreferrer"
                        className="block rounded-lg border border-default bg-[var(--bg-tertiary)] p-3 transition-colors hover:bg-[var(--bg-hover)]"
                    >
                        <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-blue-300">
                            {market.source}
                        </div>
                        <h3 className="text-sm font-semibold leading-snug text-[var(--text-primary)]">
                            {market.question}
                        </h3>
                        <div className="mt-2 flex items-center gap-3 text-xs text-[var(--text-secondary)]">
                            <span>Yes {market.yesPrice !== null ? `${Math.round(market.yesPrice * 100)}%` : '—'}</span>
                            <span>Vol {market.volume !== null ? market.volume.toLocaleString() : '—'}</span>
                        </div>
                    </a>
                ))}
            </div>
        </div>
    );
}
