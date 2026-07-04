'use client';

import { useCallback, useEffect, useState } from 'react';
import { BarChart3, ExternalLink } from 'lucide-react';
import { WidgetEmpty, WidgetError, WidgetLoading } from '@/components/ui/widget-states';
import { API_BASE_URL } from '@/lib/api';

const POLYMARKET_MARKETS_ENDPOINT = `${API_BASE_URL}/prediction-markets?source=polymarket&active=true&limit=20`;

type PolymarketCategory = 'economic' | 'sports' | 'politics' | 'general';
type FreshnessStatus = 'synced' | 'stale';

type PolymarketMarket = {
    readonly source: string;
    readonly sourceId: string;
    readonly question: string;
    readonly category: PolymarketCategory;
    readonly outcomes: readonly string[];
    readonly prices: readonly number[];
    readonly volume: number | null;
    readonly liquidity: number | null;
    readonly endDate: string | null;
    readonly url: string | null;
    readonly active: boolean;
    readonly lastSyncedAt: string | null;
};

type PolymarketFreshness = {
    readonly status: FreshnessStatus;
    readonly lastSyncedAt: string | null;
    readonly staleAfterSeconds: number | null;
};

type PolymarketApiPayload = {
    readonly markets: readonly PolymarketMarket[];
    readonly freshness: PolymarketFreshness;
};

type LoadState =
    | { readonly kind: 'loading' }
    | { readonly kind: 'error'; readonly error: Error }
    | { readonly kind: 'ready'; readonly payload: PolymarketApiPayload };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseCategory(value: unknown): PolymarketCategory | null {
    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.toLowerCase();
    // Politics, elections, geopolitics, world-affairs all collapse to 'politics'.
    if (
        normalized.includes('politic') ||
        normalized.includes('election') ||
        normalized.includes('geopolit') ||
        normalized.includes('world affair') ||
        normalized.includes('us current') ||
        normalized.includes('government')
    ) {
        return 'politics';
    }
    if (normalized.includes('sport')) {
        return 'sports';
    }
    if (
        normalized.includes('econom') ||
        normalized.includes('business') ||
        normalized.includes('finance') ||
        normalized.includes('macro') ||
        normalized.includes('fed') ||
        normalized.includes('inflation') ||
        normalized.includes('cpi') ||
        normalized.includes('rate')
    ) {
        return 'economic';
    }
    // Catch-all so non-economic / non-sports / non-politics markets still
    // render. Without this the widget used to silently drop every
    // "Pop Culture", "Crypto", "AI", etc. row, producing the
    // "No Polymarket markets available" empty state even when data existed.
    return 'general';
}

function isFreshnessStatus(value: unknown): value is FreshnessStatus {
    return value === 'synced' || value === 'stale';
}

function readNullableString(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
}

function readRequiredString(value: unknown, fallback: string): string {
    return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function readNullableNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseStringArray(value: unknown): readonly string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function parseNumberArray(value: unknown): readonly number[] {
    return Array.isArray(value) ? value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item)) : [];
}

function readLatestTimestamp(markets: readonly PolymarketMarket[]): string | null {
    const timestamps = markets.map((market) => market.lastSyncedAt).filter((value): value is string => value !== null);
    return timestamps.length > 0 ? timestamps.sort().at(-1) ?? null : null;
}

function parseMarket(value: unknown): PolymarketMarket | null {
    if (!isRecord(value) || typeof value.question !== 'string') {
        return null;
    }

    const category = parseCategory(value.category);
    if (category === null) {
        return null;
    }

    return {
        source: readRequiredString(value.source, 'polymarket'),
        sourceId: readRequiredString(value.sourceId, readRequiredString(value.source_id, value.question)),
        question: value.question,
        category,
        outcomes: parseStringArray(value.outcomes),
        prices: parseNumberArray(value.prices).length > 0 ? parseNumberArray(value.prices) : parseNumberArray(value.outcome_prices),
        volume: readNullableNumber(value.volume),
        liquidity: readNullableNumber(value.liquidity),
        endDate: readNullableString(value.endDate) ?? readNullableString(value.end_date),
        url: readNullableString(value.url),
        active: typeof value.active === 'boolean' ? value.active : true,
        lastSyncedAt: readNullableString(value.lastSyncedAt) ?? readNullableString(value.updated_at),
    };
}

function parsePayload(value: unknown): PolymarketApiPayload {
    if (!isRecord(value)) {
        throw new Error('Invalid Polymarket API response');
    }

    if (Array.isArray(value.markets) && isRecord(value.freshness)) {
        const status = isFreshnessStatus(value.freshness.status) ? value.freshness.status : 'stale';
        return {
            markets: value.markets.map(parseMarket).filter((market): market is PolymarketMarket => market !== null),
            freshness: {
                status,
                lastSyncedAt: readNullableString(value.freshness.lastSyncedAt),
                staleAfterSeconds: readNullableNumber(value.freshness.staleAfterSeconds),
            },
        };
    }

    if (Array.isArray(value.data)) {
        const markets = value.data.map(parseMarket).filter((market): market is PolymarketMarket => market !== null);
        const lastSyncedAt = readLatestTimestamp(markets);
        return {
            markets,
            freshness: {
                status: lastSyncedAt === null ? 'stale' : 'synced',
                lastSyncedAt,
                staleAfterSeconds: null,
            },
        };
    }

    throw new Error('Invalid Polymarket API response');
}

function formatMoney(value: number | null): string {
    if (value === null) {
        return '—';
    }

    return new Intl.NumberFormat('en-US', {
        notation: 'compact',
        maximumFractionDigits: 1,
        style: 'currency',
        currency: 'USD',
    }).format(value);
}

function formatProbability(value: number | undefined): string {
    return typeof value === 'number' ? `${Math.round(value * 100)}%` : '—';
}

function formatDate(value: string | null): string {
    if (value === null) {
        return 'Unknown';
    }

    return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value));
}

function categoryLabel(category: PolymarketCategory): string {
    switch (category) {
        case 'economic':
            return 'Economic';
        case 'sports':
            return 'Sports';
        case 'politics':
            return 'Politics';
        case 'general':
            return 'General';
    }
}

async function loadPolymarketMarkets(): Promise<PolymarketApiPayload> {
    const response = await fetch(POLYMARKET_MARKETS_ENDPOINT, { cache: 'no-store' });
    if (!response.ok) {
        throw new Error(`Polymarket API returned ${response.status}`);
    }

    return parsePayload(await response.json());
}

function FreshnessBadge({ freshness }: { readonly freshness: PolymarketFreshness }) {
    const isSynced = freshness.status === 'synced';

    return (
        <div className="flex items-center justify-between gap-2 border-b border-default px-1 pb-2 text-[11px] text-[var(--text-muted)]">
            <span className={isSynced ? 'text-emerald-400' : 'text-amber-300'}>{isSynced ? 'Synced' : 'Stale'}</span>
            <span>Last sync {formatDate(freshness.lastSyncedAt)}</span>
        </div>
    );
}

function MarketRow({ market }: { readonly market: PolymarketMarket }) {
    return (
        <article className="rounded-lg border border-default bg-[var(--bg-tertiary)] p-3 transition-colors hover:bg-[var(--bg-hover)]">
            <div className="mb-2 flex items-start justify-between gap-3">
                <div>
                    <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-blue-300">
                        {categoryLabel(market.category)}
                    </div>
                    <h3 className="text-sm font-semibold leading-snug text-[var(--text-primary)]">{market.question}</h3>
                </div>
                {market.url && (
                    <a
                        href={market.url}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-md p-1 text-[var(--text-muted)] hover:bg-blue-500/10 hover:text-blue-300"
                        aria-label={`Open ${market.question}`}
                    >
                        <ExternalLink size={13} />
                    </a>
                )}
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-[var(--text-secondary)] sm:grid-cols-4">
                <span>Yes {formatProbability(market.prices[0])}</span>
                <span>No {formatProbability(market.prices[1])}</span>
                <span>Vol {formatMoney(market.volume)}</span>
                <span>Liq {formatMoney(market.liquidity)}</span>
            </div>
        </article>
    );
}

export function PolymarketWidget() {
    const [state, setState] = useState<LoadState>({ kind: 'loading' });

    const refresh = useCallback(() => {
        setState({ kind: 'loading' });
        void loadPolymarketMarkets()
            .then((payload) => setState({ kind: 'ready', payload }))
            .catch((error: unknown) => {
                setState({ kind: 'error', error: error instanceof Error ? error : new Error('Polymarket request failed') });
            });
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    switch (state.kind) {
        case 'loading':
            return <WidgetLoading message="Loading Polymarket markets..." />;
        case 'error':
            return <WidgetError title="Polymarket data unavailable" error={state.error} onRetry={refresh} />;
        case 'ready':
            if (state.payload.markets.length === 0) {
                return (
                    <WidgetEmpty
                        message="No Polymarket markets available"
                        detail="The database has no active economic or sports markets yet."
                        icon={<BarChart3 size={18} />}
                    />
                );
            }

            return (
                <div className="flex h-full flex-col gap-3 p-1">
                    <FreshnessBadge freshness={state.payload.freshness} />
                    <div className="flex flex-col gap-2">
                        {state.payload.markets.map((market) => (
                            <MarketRow key={`${market.source}:${market.sourceId}`} market={market} />
                        ))}
                    </div>
                </div>
            );
    }
}
