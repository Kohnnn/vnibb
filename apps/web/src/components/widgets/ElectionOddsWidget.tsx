'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Vote } from 'lucide-react';
import { WidgetEmpty, WidgetError, WidgetLoading } from '@/components/ui/widget-states';
import { API_BASE_URL } from '@/lib/api';
import { ProbabilityBar, SearchBar } from './prediction-market-ui';
import { PredictionMarketContextMenu } from './PredictionMarketContextMenu';
import { formatMarketAmount, formatProb, parsePredictionMarketPayload } from './PredictionMarketSource';


type PoliticsMarket = {
    readonly source: string;
    readonly question: string;
    readonly yesPrice: number | null;
    readonly outcomeLabel: string;
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


function parseMarkets(value: unknown): PoliticsMarket[] {
    return parsePredictionMarketPayload(value).markets
        .filter((market) => market.category === 'politics'
            || (Array.isArray(market.extra?.canonical_topics) && market.extra.canonical_topics.includes('election'))
            || ELECTION_SEARCH_TERMS.some((term) => market.question.toLowerCase().includes(term)))
        .map((market) => ({
            source: market.source,
            sourceId: market.sourceId,
            question: market.question,
            outcomeLabel: market.outcomes[0] ?? 'First outcome',
            yesPrice: market.prices[0] ?? null,
            volume: market.volume,
            liquidity: market.liquidity,
            url: market.url,
        }));
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
                    dedup.set(`${row.source}:${row.sourceId}`, row);
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
            return { key: topic.key, label: topic.label, count: priced.length };
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

    return (
        <div className="flex h-full flex-col gap-3 p-1">
            <header className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-3">
                    {tiles.map((tile) => (
                        <div
                            key={tile.key}
                            className="flex flex-1 items-center gap-3 rounded-lg border border-default bg-[var(--bg-tertiary)] p-3"
                        >
                            <div className="flex flex-col">
                                <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
                                    {tile.label}
                                </span>
                                <span className="text-base font-semibold text-[var(--text-primary)]">
                                    {tile.count === 0 ? 'No data' : tile.count}
                                </span>
                                <span className="text-[10px] text-[var(--text-muted)]">
                                    {tile.count === 0 ? 'No priced markets available' : 'priced markets · different contracts'}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
                <div className="flex items-center justify-between">
                    <SearchBar placeholder="Filter election markets" onDebouncedChange={setSearch} />
                </div>
                <p className="text-[11px] text-[var(--text-muted)]">Topic matches from a bounded catalogue, not pooled election odds. Different outcomes and resolution rules are not comparable probabilities.</p>
            </header>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {visible.length === 0 ? (
                    <div className="col-span-full">
                        <WidgetEmpty
                            message="No election market data"
                            detail="No fresh, genuine election markets are available for this selection."
                            icon={<Vote size={18} />}
                        />
                    </div>
                ) : (
                    visible.map((market) => {
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
                                    {market.yesPrice !== null && <ProbabilityBar value={market.yesPrice} height={6} />}
                                    <div className="mt-2 flex items-center gap-3 text-xs text-[var(--text-secondary)]">
                                        <span>
                                            {market.outcomeLabel} {market.yesPrice === null ? 'No data' : formatProb(market.yesPrice)}
                                        </span>
                                        <span>
                                            Vol {formatMarketAmount(market.volume, market.source, 'volume')}
                                        </span>
                                        <span>
                                            {market.source === 'kalshi' ? 'Open interest' : 'Liq'} {formatMarketAmount(market.liquidity, market.source, 'liquidity')}
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