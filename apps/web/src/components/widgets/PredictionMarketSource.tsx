/**
 * Shared PredictionMarketSource factory component.
 *
 * PolymarketWidget and KalshiWidget both render essentially the same row
 * layout with a different `?source=...` filter. Phase 7.3 extracts the
 * shared body so adding a new source (e.g. PredictIt, Limitless, etc.)
 * becomes a one-line declarative change.
 */

import { useCallback, useEffect, useState } from 'react';
import { BarChart3, ExternalLink } from 'lucide-react';
import { WidgetEmpty, WidgetError, WidgetLoading } from '@/components/ui/widget-states';
import { API_BASE_URL } from '@/lib/api';

export type PredictionMarketSource = 'polymarket' | 'kalshi';

export type PredictionMarketCategory =
    | 'all'
    | 'economic'
    | 'sports'
    | 'politics'
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
                        prices:
                            parseNumberArray(row.outcome_prices).length > 0
                                ? parseNumberArray(row.outcome_prices)
                                : parseNumberArray(
                                      (row as Record<string, unknown>).outcomePrices,
                                  ),
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
    readonly emptyIcon?: React.ReactNode;
    readonly emptyMessage?: string;
}

export function PredictionMarketSourceWidget(props: PredictionMarketSourceWidgetProps) {
    const { source, title, category = 'all', emptyMessage } = props;
    const [state, setState] = useState<LoadState>({ kind: 'loading' });

    const refresh = useCallback(() => {
        setState({ kind: 'loading' });
        const url = new URL(`${API_BASE_URL}/prediction-markets`);
        url.searchParams.set('source', source);
        url.searchParams.set('active', 'true');
        url.searchParams.set('limit', '20');
        if (category !== 'all') {
            url.searchParams.set('category', category);
        }
        void fetch(url.toString(), { cache: 'no-store' })
            .then(async (response) => {
                if (!response.ok) throw new Error(`${source} API returned ${response.status}`);
                setState({ kind: 'ready', payload: parsePayload(await response.json()) });
            })
            .catch((error: unknown) => {
                setState({
                    kind: 'error',
                    error: error instanceof Error ? error : new Error(`${source} request failed`),
                });
            });
    }, [source, category]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    if (state.kind === 'loading') {
        return <WidgetLoading message={`Loading ${title} markets...`} />;
    }
    if (state.kind === 'error') {
        return (
            <WidgetError
                title={`${title} data unavailable`}
                error={state.error}
                onRetry={refresh}
            />
        );
    }
    if (state.payload.markets.length === 0) {
        return (
            <WidgetEmpty
                message={emptyMessage ?? `No ${title} markets available`}
                detail={`The database has no active ${title.toLowerCase()} markets yet.`}
                icon={props.emptyIcon ?? <BarChart3 size={18} />}
            />
        );
    }
    return (
        <div className="flex h-full flex-col gap-3 p-1">
            <div className="flex items-center justify-between border-b border-default px-1 pb-2 text-[11px] text-[var(--text-muted)]">
                <span
                    className={
                        state.payload.freshness.status === 'synced'
                            ? 'text-emerald-400'
                            : 'text-amber-300'
                    }
                >
                    {state.payload.freshness.status === 'synced' ? 'Synced' : 'Stale'}
                </span>
                <span>
                    Last sync{' '}
                    {state.payload.freshness.lastSyncedAt
                        ? new Date(state.payload.freshness.lastSyncedAt).toLocaleDateString()
                        : 'Unknown'}
                </span>
            </div>
            <div className="flex flex-col gap-2">
                {state.payload.markets.map((market) => (
                    <article
                        key={`${market.source}:${market.sourceId}`}
                        className="rounded-lg border border-default bg-[var(--bg-tertiary)] p-3 transition-colors hover:bg-[var(--bg-hover)]"
                    >
                        <div className="mb-2 flex items-start justify-between gap-3">
                            <div>
                                <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-blue-300">
                                    {String(market.category)}
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
                                >
                                    <ExternalLink size={13} />
                                </a>
                            )}
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs text-[var(--text-secondary)] sm:grid-cols-4">
                            <span>Yes {formatProb(market.prices[0])}</span>
                            <span>No {formatProb(market.prices[1])}</span>
                            <span>Vol {formatMoney(market.volume)}</span>
                            <span>Liq {formatMoney(market.liquidity)}</span>
                        </div>
                    </article>
                ))}
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
