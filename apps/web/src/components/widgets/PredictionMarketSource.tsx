/**
 * PredictionMarketSourceWidget — shared body for source-specific lists.
 *
 * PolymarketWidget, KalshiWidget, PredictItWidget and LimitlessWidget all
 * render through this component. The container passes a `source` and an
 * optional `category`; the body does the fetch + filter + sort + render.
 *
 * Phase v2.x adds: a debounced search bar, category pills, a sort toggle,
 * per-row probability bars, an onSelect callback that opens the
 * PredictionMarketDrawer, and per-row context menus.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, ExternalLink } from 'lucide-react';
import { WidgetEmpty, WidgetError, WidgetLoading } from '@/components/ui/widget-states';
import { API_BASE_URL } from '@/lib/api';
import { CategoryPills, ProbabilityBar, SearchBar, SortButton, type SortDirection } from './prediction-market-ui';
import { PredictionMarketContextMenu } from './PredictionMarketContextMenu';
import {
    PredictionMarketSourceHealthStrip,
    sourceHealthStatusLabel,
    usePredictionMarketSourceHealth,
} from './PredictionMarketSourceHealthStrip';

export type PredictionMarketSource = 'polymarket' | 'kalshi' | 'predictit' | 'limitless' | 'manifold';

export type PredictionMarketCategory =
    | 'all'
    | 'economic'
    | 'sports'
    | 'politics'
    | 'crypto'
    | 'general';

export interface PredictionMarketRow {
    readonly source: string;
    readonly sourceId: string;
    readonly question: string;
    readonly category: PredictionMarketCategory | string;
    readonly outcomes: readonly string[];
    readonly prices: readonly number[];
    readonly volume: number | null;
    readonly liquidity: number | null;
    readonly endDate: string | null;
    readonly url: string | null;
    readonly active: boolean;
    readonly lastSyncedAt: string | null;
    readonly deltaSinceOpen?: number | null;
}

export interface PredictionMarketFreshness {
    readonly status: 'synced' | 'stale';
    readonly lastSyncedAt: string | null;
    readonly staleAfterSeconds: number | null;
}

export interface PredictionMarketPayload {
    readonly markets: readonly PredictionMarketRow[];
    readonly freshness: PredictionMarketFreshness;
}

type LoadState =
    | { readonly kind: 'loading' }
    | { readonly kind: 'error'; readonly error: Error }
    | { readonly kind: 'ready'; readonly payload: PredictionMarketPayload };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseStringArray(value: unknown): readonly string[] {
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : [];
}

function parseNumberArray(value: unknown): readonly number[] {
    return Array.isArray(value)
        ? value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item))
        : [];
}

function parsePayload(value: unknown): PredictionMarketPayload {
    if (!isRecord(value)) {
        throw new Error('Invalid prediction-market API response');
    }
    if (Array.isArray(value.markets) && isRecord(value.freshness)) {
        const status: 'synced' | 'stale' =
            (value.freshness as Record<string, unknown>).status === 'synced' ? 'synced' : 'stale';
        return {
            markets: (value.markets as unknown[])
                .map((row): PredictionMarketRow | null => {
                    if (!isRecord(row) || typeof row.question !== 'string') return null;
                    const source =
                        typeof row.source === 'string' ? row.source : 'unknown';
                    const sourceId =
                        typeof row.source_id === 'string'
                            ? row.source_id
                            : typeof (row as Record<string, unknown>).sourceId === 'string'
                                ? String((row as Record<string, unknown>).sourceId)
                                : row.question;
                    const lastSyncedAt =
                        typeof row.updated_at === 'string'
                            ? row.updated_at
                            : typeof (row as Record<string, unknown>).lastSyncedAt === 'string'
                                ? String((row as Record<string, unknown>).lastSyncedAt)
                                : null;
                    const outcomes = parseStringArray(row.outcomes);
                    const prices =
                        parseNumberArray(row.outcome_prices).length > 0
                            ? parseNumberArray(row.outcome_prices)
                            : parseNumberArray(
                                  (row as Record<string, unknown>).outcomePrices,
                              );
                    return {
                        source,
                        sourceId,
                        question: row.question,
                        category: typeof row.category === 'string' ? row.category : 'general',
                        outcomes,
                        prices,
                        volume: parseNumber(row.volume),
                        liquidity: parseNumber(row.liquidity),
                        endDate:
                            typeof row.end_date === 'string'
                                ? row.end_date
                                : typeof (row as Record<string, unknown>).endDate === 'string'
                                    ? String((row as Record<string, unknown>).endDate)
                                    : null,
                        url: typeof row.url === 'string' ? row.url : null,
                        active: typeof row.active === 'boolean' ? row.active : true,
                        lastSyncedAt,
                    };
                })
                .filter((row): row is PredictionMarketRow => row !== null),
            freshness: {
                status,
                lastSyncedAt:
                    typeof (value.freshness as Record<string, unknown>).lastSyncedAt === 'string'
                        ? String((value.freshness as Record<string, unknown>).lastSyncedAt)
                        : null,
                staleAfterSeconds: parseNumber(
                    (value.freshness as Record<string, unknown>).staleAfterSeconds,
                ),
            },
        };
    }
    if (Array.isArray(value.data)) {
        const markets = (value.data as unknown[])
            .map((row): PredictionMarketRow | null => {
                if (!isRecord(row) || typeof row.question !== 'string') return null;
                return {
                    source: typeof row.source === 'string' ? row.source : 'unknown',
                    sourceId:
                        typeof row.source_id === 'string'
                            ? row.source_id
                            : typeof (row as Record<string, unknown>).sourceId === 'string'
                                ? String((row as Record<string, unknown>).sourceId)
                                : row.question,
                    question: row.question,
                    category: typeof row.category === 'string' ? row.category : 'general',
                    outcomes: parseStringArray(row.outcomes),
                    prices: parseNumberArray(row.outcome_prices),
                    volume: parseNumber(row.volume),
                    liquidity: parseNumber(row.liquidity),
                    endDate:
                        typeof row.end_date === 'string'
                            ? row.end_date
                            : typeof (row as Record<string, unknown>).endDate === 'string'
                                ? String((row as Record<string, unknown>).endDate)
                                : null,
                    url: typeof row.url === 'string' ? row.url : null,
                    active: typeof row.active === 'boolean' ? row.active : true,
                    lastSyncedAt:
                        typeof row.updated_at === 'string'
                            ? row.updated_at
                            : typeof (row as Record<string, unknown>).lastSyncedAt === 'string'
                                ? String((row as Record<string, unknown>).lastSyncedAt)
                                : null,
                };
            })
            .filter((row): row is PredictionMarketRow => row !== null);
        return {
            markets,
            freshness: {
                status: 'synced',
                lastSyncedAt: markets[0]?.lastSyncedAt ?? null,
                staleAfterSeconds: null,
            },
        };
    }
    throw new Error('Invalid prediction-market API response');
}

export interface PredictionMarketSourceWidgetProps {
    readonly source: PredictionMarketSource;
    readonly title: string;
    readonly category?: PredictionMarketCategory;
    readonly topics?: readonly string[];
    readonly categoryOptions?: readonly { readonly value: string; readonly label: string }[];
    readonly emptyIcon?: React.ReactNode;
    readonly emptyMessage?: string;
    readonly onSelect?: (row: PredictionMarketRow) => void;
    readonly showFilters?: boolean;
    readonly showSearch?: boolean;
    readonly limit?: number;
}

type SortKey = 'yes' | 'volume' | 'endDate';

const SORT_OPTIONS: ReadonlyArray<{ readonly key: SortKey; readonly label: string }> = [
    { key: 'yes', label: 'YES%' },
    { key: 'volume', label: 'Volume' },
    { key: 'endDate', label: 'Ending' },
];

export function PredictionMarketSourceWidget(props: PredictionMarketSourceWidgetProps) {
    const {
        source,
        title,
        category = 'all',
        topics,
        categoryOptions,
        emptyMessage,
        showFilters = true,
        showSearch = true,
        limit = 25,
    } = props;
    const [state, setState] = useState<LoadState>({ kind: 'loading' });
    const [search, setSearch] = useState('');
    const [sortKey, setSortKey] = useState<SortKey>('yes');
    const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
    const sourceHealth = usePredictionMarketSourceHealth();
    const healthRow = sourceHealth.data?.find((row) => row.source === source);

    const refresh = useCallback(async () => {
        setState({ kind: 'loading' });
        const url = new URL(`${API_BASE_URL}/prediction-markets`);
        url.searchParams.set('source', source);
        url.searchParams.set('active', 'true');
        url.searchParams.set('limit', String(limit));
        if (category !== 'all') {
            url.searchParams.set('category', category);
        }
        for (const topic of topics ?? []) {
            url.searchParams.append('topic', topic);
        }
        try {
            const response = await fetch(url.toString(), { cache: 'no-store' });
            if (!response.ok) {
                throw new Error(`${source} API returned ${response.status}`);
            }
            setState({ kind: 'ready', payload: parsePayload(await response.json()) });
        } catch (error: unknown) {
            setState({
                kind: 'error',
                error: error instanceof Error ? error : new Error(`${source} request failed`),
            });
        }
    }, [source, category, topics, limit]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const visible = useMemo(() => {
        if (state.kind !== 'ready') return [] as readonly PredictionMarketRow[];
        const searchLower = search.trim().toLowerCase();
        const filtered = state.payload.markets.filter((market) => {
            if (!searchLower) return true;
            return (
                market.question.toLowerCase().includes(searchLower) ||
                String(market.category).toLowerCase().includes(searchLower)
            );
        });
        const sorted = [...filtered];
        sorted.sort((a, b) => {
            const pick = (row: PredictionMarketRow): number => {
                if (sortKey === 'yes') return row.prices[0] ?? 0;
                if (sortKey === 'volume') return row.volume ?? 0;
                if (row.endDate) {
                    const parsed = Date.parse(row.endDate);
                    return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
                }
                return Number.MAX_SAFE_INTEGER;
            };
            const av = pick(a);
            const bv = pick(b);
            return sortDirection === 'desc' ? bv - av : av - bv;
        });
        return sorted;
    }, [state, search, sortKey, sortDirection]);

    if (state.kind === 'loading') {
        return <WidgetLoading message={`Loading ${title} markets...`} />;
    }
    if (state.kind === 'error') {
        return (
            <WidgetError
                title={`${title} data unavailable`}
                error={state.error}
                onRetry={() => void refresh()}
            />
        );
    }
    if (state.payload.markets.length === 0) {
        return (
            <div className="flex h-full flex-col gap-3 p-1">
                <PredictionMarketSourceHealthStrip />
                <WidgetEmpty
                    message={emptyMessage ?? `No ${title} markets available`}
                    detail={`The database has no active ${title.toLowerCase()} markets yet.`}
                    icon={props.emptyIcon ?? <BarChart3 size={18} />}
                />
            </div>
        );
    }
    return (
        <div className="flex h-full flex-col gap-3 p-1">
            <header className="flex flex-col gap-2 border-b border-default pb-2">
                <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)]">
                    <span
                        className={
                            healthRow?.status === 'synced'
                                ? 'text-emerald-400'
                                : healthRow?.status === 'stale'
                                    ? 'text-amber-300'
                                    : undefined
                        }
                    >
                        {healthRow
                            ? `${sourceHealthStatusLabel(healthRow)} · ${visible.length} markets`
                            : `${sourceHealth.isError ? 'Freshness unavailable' : 'Checking freshness'} · ${visible.length} markets`}
                    </span>
                    <span>
                        Latest snapshot{' '}
                        {healthRow?.latestSnapshotAt
                            ? new Date(healthRow.latestSnapshotAt).toLocaleDateString()
                            : 'Unknown'}
                    </span>
                </div>
                <PredictionMarketSourceHealthStrip />
                {(showSearch || showFilters) && (
                    <div className="flex flex-wrap items-center gap-2">
                        {showSearch && (
                            <div className="flex-1 min-w-[140px]">
                                <SearchBar
                                    placeholder={`Search ${title}`}
                                    onDebouncedChange={setSearch}
                                />
                            </div>
                        )}
                        {showFilters && categoryOptions && categoryOptions.length > 0 && (
                            <CategoryPills
                                options={categoryOptions}
                                selected={new Set(category === 'all' ? [] : [category])}
                                onToggle={() => {
                                    // Category pills are inert for the
                                    // single-category widgets; intended use
                                    // is the new top-level selector that
                                    // re-renders the widget.
                                }}
                            />
                        )}
                        <div className="flex items-center gap-1">
                            {SORT_OPTIONS.map((option) => (
                                <button
                                    key={option.key}
                                    type="button"
                                    onClick={() => {
                                        if (sortKey === option.key) {
                                            setSortDirection(
                                                sortDirection === 'desc' ? 'asc' : 'desc',
                                            );
                                        } else {
                                            setSortKey(option.key);
                                            setSortDirection('desc');
                                        }
                                    }}
                                    className={`rounded-md border px-2 py-1 text-[11px] uppercase tracking-wide ${
                                        sortKey === option.key
                                            ? 'border-blue-500/60 bg-blue-500/10 text-blue-400'
                                            : 'border-default bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                                    }`}
                                >
                                    {option.label} {sortKey === option.key && (sortDirection === 'desc' ? '↓' : '↑')}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </header>
            <div className="flex flex-col gap-2">
                {visible.length === 0 && (
                    <div className="rounded-lg border border-dashed border-default p-4 text-center text-xs text-[var(--text-muted)]">
                        No markets match this filter.
                    </div>
                )}
                {visible.map((market) => {
                    const handleClick = props.onSelect
                        ? () => props.onSelect?.(market)
                        : undefined;
                    const yesPrice = market.prices[0];
                    return (
                        <PredictionMarketContextMenu
                            key={`${market.source}:${market.sourceId}`}
                            market={market}
                        >
                            <article
                                className={`rounded-lg border border-default bg-[var(--bg-tertiary)] p-3 transition-colors hover:bg-[var(--bg-hover)] ${
                                    props.onSelect ? 'cursor-pointer' : ''
                                }`}
                                onClick={handleClick}
                                role={props.onSelect ? 'button' : undefined}
                                tabIndex={props.onSelect ? 0 : undefined}
                                onKeyDown={
                                    props.onSelect
                                        ? (event) => {
                                              if (
                                                  event.key === 'Enter' ||
                                                  event.key === ' '
                                              ) {
                                                  event.preventDefault();
                                                  props.onSelect?.(market);
                                              }
                                          }
                                        : undefined
                                }
                            >
                                <div className="mb-2 flex items-start justify-between gap-3">
                                    <div className="flex flex-col">
                                        <div className="mb-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-blue-300">
                                            <span>{String(market.category)}</span>
                                            <span className="text-[var(--text-muted)]">
                                                ·
                                            </span>
                                            <span className="text-[var(--text-muted)]">
                                                {market.source}
                                            </span>
                                        </div>
                                        <h3 className="text-sm font-semibold leading-snug text-[var(--text-primary)]">
                                            {market.question}
                                        </h3>
                                    </div>
                                    {market.url && (
                                        <a
                                            href={market.url}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="rounded-md p-1 text-[var(--text-muted)] hover:bg-blue-500/10 hover:text-blue-300"
                                            aria-label={`Open ${market.question}`}
                                            onClick={(event) => event.stopPropagation()}
                                        >
                                            <ExternalLink size={13} />
                                        </a>
                                    )}
                                </div>
                                {typeof yesPrice === 'number' && (
                                    <ProbabilityBar
                                        value={yesPrice}
                                        height={6}
                                        showLabels
                                        delta={market.deltaSinceOpen ?? null}
                                    />
                                )}
                                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-[var(--text-secondary)] sm:grid-cols-4">
                                    <span>Yes {formatProb(yesPrice)}</span>
                                    <span>No {formatProb(market.prices[1])}</span>
                                    <span>Vol {formatMoney(market.volume)}</span>
                                    <span>Liq {formatMoney(market.liquidity)}</span>
                                </div>
                            </article>
                        </PredictionMarketContextMenu>
                    );
                })}
            </div>
        </div>
    );
}

function formatProb(value: number | undefined): string {
    return typeof value === 'number' ? `${Math.round(value * 100)}%` : '—';
}

function formatMoney(value: number | null): string {
    if (value === null) return '—';
    return new Intl.NumberFormat('en-US', {
        notation: 'compact',
        maximumFractionDigits: 1,
        style: 'currency',
        currency: 'USD',
    }).format(value);
}

export { SortButton };