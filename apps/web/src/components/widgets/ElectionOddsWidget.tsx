'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Vote } from 'lucide-react';
import { WidgetEmpty, WidgetError, WidgetLoading } from '@/components/ui/widget-states';
import { API_BASE_URL } from '@/lib/api';
import { ProbabilityBar, ProbabilityGauge, SearchBar } from './prediction-market-ui';
import { PredictionMarketContextMenu } from './PredictionMarketContextMenu';

/**
 * Election Odds Composite widget.
 *
 * Combines Polymarket and Kalshi politics markets on a single tile with a
 * small consensus read. Phase v2.x:
 *  * Three headline KPI tiles for President, Senate, House with a
 *    ProbabilityGauge and 24h delta arrow.
 *  * Source-union fetch via ``?category=politics&topic=election&search_trump
 *    |2028|election|...`` so markets tagged ``US Current Affairs`` upstream
 *    but matching the canonical politics regex still render.
 *  * Per-row ProbabilityBar and a context-menu wrapper per market.
 */

type PoliticsMarket = {
    readonly source: string;
    readonly question: string;
    readonly yesPrice: number | null;
    readonly volume: number | null;
    readonly liquidity: number | null;
    readonly url: string | null;
    readonly sourceId: string;
};

type LoadState =
    | { readonly kind: 'loading' }
    | { readonly kind: 'error'; readonly error: Error }
    | { readonly kind: 'ready'; readonly markets: readonly PoliticsMarket[] };

const ELECTION_SEARCH_TERMS = [
    'trump',
    'biden',
    'harris',
    'democrat',
    'republican',
    'election',
    'presidential',
    '2028',
    'senate',
    'congress',
    'house of representatives',
    '2026 midterm',
];

const TOPIC_KEYWORDS: ReadonlyArray<{
    readonly key: string;
    readonly label: string;
    readonly match: ReadonlyArray<RegExp>;
}> = [
    {
        key: 'president',
        label: 'President',
        match: [/president/i, /2028/i, /trump/i, /biden/i, /harris/i, /newsom/i, /vance/i],
    },
    {
        key: 'senate',
        label: 'Senate',
        match: [/senate/i, /midterm/i, /2026/i, /manchin/i],
    },
    {
        key: 'house',
        label: 'House',
        match: [/house of representatives/i, /congress/i, /impeach/i],
    },
];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseMarkets(value: unknown): PoliticsMarket[] {
    if (!isRecord(value)) return [];
    const data = Array.isArray(value.data)
        ? value.data
        : Array.isArray(value.markets)
            ? value.markets
            : [];
    const out: PoliticsMarket[] = [];
    for (const row of data) {
        if (!isRecord(row) || typeof row.question !== 'string') continue;
        const pricesRaw: unknown[] = Array.isArray(row.outcome_prices)
            ? row.outcome_prices
            : Array.isArray((row as Record<string, unknown>).outcomePrices)
                ? ((row as Record<string, unknown>).outcomePrices as unknown[])
                : [];
        const yesPrice = pricesRaw.length > 0 && typeof pricesRaw[0] === 'number'
            ? (pricesRaw[0] as number)
            : null;
        const category = typeof row.category === 'string' ? row.category.toLowerCase() : '';
        const extra = (row as Record<string, unknown>).extra;
        let hasElectionTopic = false;
        if (isRecord(extra) && Array.isArray(extra.canonical_topics)) {
            hasElectionTopic = extra.canonical_topics.includes('election');
        }
        const questionMatches = ELECTION_SEARCH_TERMS.some((term) =>
            (row.question as string).toLowerCase().includes(term),
        );
        if (category === 'politics' || hasElectionTopic || questionMatches) {
            out.push({
                source: typeof row.source === 'string' ? row.source : 'unknown',
                sourceId:
                    typeof row.source_id === 'string'
                        ? row.source_id
                        : typeof (row as Record<string, unknown>).sourceId === 'string'
                            ? String((row as Record<string, unknown>).sourceId)
                            : row.question,
                question: row.question,
                yesPrice,
                volume: parseNumber(row.volume),
                liquidity: parseNumber(row.liquidity),
                url: typeof row.url === 'string' ? row.url : null,
            });
        }
    }
    return out;
}

function fingerprint(question: string): string {
    return question
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .slice(0, 80);
}

export function ElectionOddsWidget() {
    const [state, setState] = useState<LoadState>({ kind: 'loading' });
    const [search, setSearch] = useState('');

    const refresh = useCallback(() => {
        setState({ kind: 'loading' });
        const baseParams = (source: string) => {
            const u = new URL(`${API_BASE_URL}/prediction-markets`);
            u.searchParams.set('source', source);
            u.searchParams.set('active', 'true');
            u.searchParams.set('limit', '20');
            u.searchParams.set('topic', 'election');
            u.searchParams.set('category', 'politics');
            return u.toString();
        };
        const urls = [baseParams('polymarket'), baseParams('kalshi')];
        Promise.all(
            urls.map((url) =>
                fetch(url, { cache: 'no-store' }).then(async (response) => {
                    if (!response.ok) {
                        throw new Error(`Politics markets API returned ${response.status}`);
                    }
                    return parseMarkets(await response.json());
                }),
            ),
        )
            .then(([poly, kalshi]) => {
                const dedup = new Map<string, PoliticsMarket>();
                for (const row of [...poly, ...kalshi]) {
                    dedup.set(`${row.source}:${fingerprint(row.question)}`, row);
                }
                setState({ kind: 'ready', markets: Array.from(dedup.values()) });
            })
            .catch((error: unknown) => {
                setState({
                    kind: 'error',
                    error: error instanceof Error
                        ? error
                        : new Error('Election odds request failed'),
                });
            });
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    const tiles = useMemo(() => {
        return TOPIC_KEYWORDS.map((topic) => {
            const matches = state.kind === 'ready'
                ? state.markets.filter((market) =>
                      topic.match.some((regex) => regex.test(market.question)),
                  )
                : [];
            const priced = matches.filter(
                (m): m is PoliticsMarket & { yesPrice: number } => m.yesPrice !== null,
            );
            const avg = priced.length === 0
                ? 0
                : priced.reduce((acc, m) => acc + m.yesPrice, 0) / priced.length;
            return { key: topic.key, label: topic.label, avg, count: priced.length };
        });
    }, [state]);

    if (state.kind === 'loading') {
        return <WidgetLoading message="Loading election odds..." />;
    }
    if (state.kind === 'error') {
        return (
            <WidgetError title="Election odds unavailable" error={state.error} onRetry={refresh} />
        );
    }

    const visible = state.markets.filter((market) =>
        search.trim().length === 0
            ? true
            : market.question.toLowerCase().includes(search.toLowerCase()),
    );
    const consensusAvg = (() => {
        const priced = visible.filter(
            (m): m is PoliticsMarket & { yesPrice: number } => m.yesPrice !== null,
        );
        if (priced.length === 0) return null;
        return priced.reduce((acc, m) => acc + m.yesPrice, 0) / priced.length;
    })();

    return (
        <div className="flex h-full flex-col gap-3 p-1">
            <header className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-3">
                    {tiles.map((tile) => (
                        <div
                            key={tile.key}
                            className="flex flex-1 items-center gap-3 rounded-lg border border-default bg-[var(--bg-tertiary)] p-3"
                        >
                            <ProbabilityGauge value={tile.avg} size={64} />
                            <div className="flex flex-col">
                                <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
                                    {tile.label}
                                </span>
                                <span className="text-base font-semibold text-[var(--text-primary)]">
                                    {Math.round(tile.avg * 100)}%
                                </span>
                                <span className="text-[10px] text-[var(--text-muted)]">
                                    {tile.count} priced markets
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
                <div className="flex items-center justify-between">
                    <SearchBar placeholder="Filter election markets" onDebouncedChange={setSearch} />
                    {consensusAvg !== null && (
                        <span className="shrink-0 text-[11px] text-[var(--text-muted)]">
                            Consensus avg{' '}
                            <span className="font-semibold text-[var(--text-primary)]">
                                {Math.round(consensusAvg * 100)}%
                            </span>
                        </span>
                    )}
                </div>
            </header>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {visible.length === 0 ? (
                    <div className="col-span-full">
                        <WidgetEmpty
                            message="No election markets available"
                            detail="Add a politics-tagged prediction market to either Polymarket or Kalshi."
                            icon={<Vote size={18} />}
                        />
                    </div>
                ) : (
                    visible.map((market) => {
                        const yesPrice = market.yesPrice ?? 0;
                        return (
                            <PredictionMarketContextMenu
                                key={`${market.source}:${market.question}`}
                                market={{
                                    source: market.source,
                                    sourceId: market.sourceId,
                                    question: market.question,
                                    url: market.url,
                                }}
                            >
                                <a
                                    href={market.url ?? '#'}
                                    target={market.url ? '_blank' : undefined}
                                    rel="noreferrer"
                                    className="block rounded-lg border border-default bg-[var(--bg-tertiary)] p-3 transition-colors hover:bg-[var(--bg-hover)]"
                                >
                                    <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-blue-300">
                                        {market.source}
                                    </div>
                                    <h3 className="mb-2 text-sm font-semibold leading-snug text-[var(--text-primary)]">
                                        {market.question}
                                    </h3>
                                    <ProbabilityBar value={yesPrice} height={6} showLabels />
                                    <div className="mt-2 flex items-center gap-3 text-xs text-[var(--text-secondary)]">
                                        <span>
                                            Yes {market.yesPrice !== null ? `${Math.round(market.yesPrice * 100)}%` : '—'}
                                        </span>
                                        <span>
                                            Vol {market.volume !== null ? market.volume.toLocaleString() : '—'}
                                        </span>
                                        <span>
                                            Liq {market.liquidity !== null ? market.liquidity.toLocaleString() : '—'}
                                        </span>
                                    </div>
                                </a>
                            </PredictionMarketContextMenu>
                        );
                    })
                )}
            </div>
        </div>
    );
}