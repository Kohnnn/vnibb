'use client';

import { useState, useCallback, useMemo, useEffect, useId, memo } from 'react';
import { useQuery, useQueries } from '@tanstack/react-query';
import { Plus, TrendingUp, TrendingDown, Minus, Star, Trash2 } from 'lucide-react';
import { getSymbols } from '@/lib/api';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { WidgetEmpty } from '@/components/ui/widget-states';
import { useWebSocket } from '@/lib/hooks/useWebSocket';
import { fetchStockQuote, quoteQueryKey } from '@/lib/queries';
import { getAdaptiveRefetchInterval, POLLING_PRESETS } from '@/lib/pollingPolicy';
import { useWidgetSymbolLink } from '@/hooks/useWidgetSymbolLink';
import { useDashboard } from '@/contexts/DashboardContext';
import { useDashboardWidget } from '@/hooks/useDashboardWidget';
import { buildWidgetRuntime } from '@/lib/widgetRuntime';
import { EMPTY_VALUE, formatNumber } from '@/lib/units';
import { normalizeTickerSymbol } from '@/lib/defaultTicker';
import type { WidgetGroupId } from '@/types/widget';

const STORAGE_KEY = 'vnibb-watchlist-v1';
const SORT_STORAGE_KEY = 'vnibb-watchlist-sort-v1';

interface WatchlistItem {
    symbol: string;
    name: string;
    price: number | null;
    change: number | null;
    changePercent: number | null;
    volume: number | null;
    asOf?: string | null;
    stale?: boolean | null;
    delivery?: 'WebSocket' | 'HTTP quote';
    source?: string | null;
    upstreamSource?: string | null;
    error?: string | null;
}

type SortField = 'symbol' | 'price' | 'changePercent' | 'volume';
type SortOrder = 'asc' | 'desc';

interface SortConfig {
    field: SortField;
    order: SortOrder;
}

interface WatchlistWidgetProps {
    id: string;
    symbol?: string;
    config?: Record<string, unknown>;
    isEditing?: boolean;
    widgetGroup?: WidgetGroupId;
    onDataChange?: (data: WidgetDataPayload) => void;
}

function hasOwnConfigKey(config: Record<string, unknown> | undefined, key: string): boolean {
    return Boolean(config) && Object.prototype.hasOwnProperty.call(config, key);
}

function parseLegacySymbols(): string[] {
    if (typeof window === 'undefined') return [];
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored ? (JSON.parse(stored) as string[]).filter((value): value is string => typeof value === 'string') : [];
    } catch {
        return [];
    }
}

function parseLegacySortConfig(): SortConfig {
    if (typeof window === 'undefined') return { field: 'symbol', order: 'asc' };
    try {
        const stored = localStorage.getItem(SORT_STORAGE_KEY);
        if (!stored) return { field: 'symbol', order: 'asc' };
        const parsed = JSON.parse(stored) as Partial<SortConfig>;
        return {
            field: parsed.field === 'price' || parsed.field === 'changePercent' || parsed.field === 'volume' ? parsed.field : 'symbol',
            order: parsed.order === 'desc' ? 'desc' : 'asc',
        };
    } catch {
        return { field: 'symbol', order: 'asc' };
    }
}

export function parseWatchlistSymbols(config: Record<string, unknown> | undefined): string[] {
    const rawValue = config?.watchlistSymbols;
    const symbols = Array.isArray(rawValue)
        ? rawValue
        : hasOwnConfigKey(config, 'watchlistSymbols') ? [] : parseLegacySymbols();

    return [...new Set(symbols
        .filter((value): value is string => typeof value === 'string')
        .map(normalizeTickerSymbol)
        .filter((value): value is string => value !== null))];
}

function parseWatchlistSort(config: Record<string, unknown> | undefined): SortConfig {
    const rawValue = config?.watchlistSort;
    if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
        return hasOwnConfigKey(config, 'watchlistSort') ? { field: 'symbol', order: 'asc' } : parseLegacySortConfig();
    }

    const parsed = rawValue as Partial<SortConfig>;
    return {
        field: parsed.field === 'price' || parsed.field === 'changePercent' || parsed.field === 'volume' ? parsed.field : 'symbol',
        order: parsed.order === 'desc' ? 'desc' : 'asc',
    };
}

function WatchlistWidgetComponent({ id, config, isEditing, onRemove, widgetGroup, onDataChange }: WatchlistWidgetProps & { onRemove?: () => void }) {
    const { updateWidget } = useDashboard();
    const widgetLocation = useDashboardWidget(id);
    const persistedSymbols = useMemo(() => parseWatchlistSymbols(config), [config]);
    const persistedSortConfig = useMemo(() => parseWatchlistSort(config), [config]);
    const [symbols, setSymbols] = useState<string[]>(persistedSymbols);
    const [sortConfig, setSortConfig] = useState<SortConfig>(persistedSortConfig);

    const [newSymbol, setNewSymbol] = useState('');
    const [symbolError, setSymbolError] = useState<string | null>(null);
    const symbolErrorId = useId();
    const [showAddInput, setShowAddInput] = useState(false);
    const [showClearConfirm, setShowClearConfirm] = useState(false);

    const { data: validSymbolsData } = useQuery({
        queryKey: ['symbols'],
        queryFn: () => getSymbols({ limit: 2000 }),
        staleTime: 30 * 60 * 1000,
    });

    const symbolNameMap = useMemo(() => {
        if (!validSymbolsData?.data) return new Map<string, string>();
        return new Map(validSymbolsData.data.map(s => [s.symbol.toUpperCase(), s.organ_name]));
    }, [validSymbolsData]);

    const { prices: livePrices, isConnected, isReceiving, lastUpdate, protocolError } = useWebSocket({ symbols });
    const storedQuotes = useQueries({ queries: symbols.map(symbol => ({
        queryKey: quoteQueryKey(symbol),
        queryFn: ({ signal }: { signal: AbortSignal }) => fetchStockQuote(symbol, signal),
        staleTime: 30_000,
        refetchInterval: isReceiving ? false : () => getAdaptiveRefetchInterval(POLLING_PRESETS.quotes),
        refetchIntervalInBackground: false,
        networkMode: 'online' as const,
    })) });
    const { setLinkedSymbol } = useWidgetSymbolLink(widgetGroup, { widgetType: 'watchlist' });

    useEffect(() => {
        setSymbols((current) => JSON.stringify(current) === JSON.stringify(persistedSymbols) ? current : persistedSymbols);
    }, [persistedSymbols]);

    useEffect(() => {
        setSortConfig((current) => JSON.stringify(current) === JSON.stringify(persistedSortConfig) ? current : persistedSortConfig);
    }, [persistedSortConfig]);

    useEffect(() => {
        if (!widgetLocation) return;

        const currentConfig = widgetLocation.widget.config || {};
        const nextConfig = {
            ...currentConfig,
            watchlistSymbols: symbols,
            watchlistSort: sortConfig,
        };

        if (
            JSON.stringify(currentConfig.watchlistSymbols ?? []) === JSON.stringify(symbols)
            && JSON.stringify(currentConfig.watchlistSort ?? {}) === JSON.stringify(sortConfig)
        ) {
            return;
        }

        updateWidget(widgetLocation.dashboardId, widgetLocation.tabId, id, {
            config: nextConfig,
        });
    }, [id, sortConfig, symbols, updateWidget, widgetLocation]);

    const watchlist = useMemo<WatchlistItem[]>(() => {
        return symbols.map((sym, index) => {
            const stream = livePrices.get(sym);
            const stored = storedQuotes[index]?.data;
            const admitted = stored?.price_unit === 'VND' ? stored : undefined;
            const streamTime = Date.parse(stream?.as_of || stream?.timestamp || '');
            const storedTime = Date.parse(admitted?.asOf || '');
            const quoteData = stream && (!admitted || !Number.isFinite(storedTime) || streamTime >= storedTime)
                ? stream : admitted ? { ...admitted, change_pct: admitted.changePct } : undefined;
            const quoteNumber = (value: number | null | undefined) => Number.isFinite(value) ? value ?? null : null;

            return {
                symbol: sym,
                name: symbolNameMap.get(sym) || 'Unknown',
                price: quoteNumber(quoteData?.price),
                change: quoteNumber(quoteData?.change),
                changePercent: quoteNumber(quoteData?.change_pct),
                volume: quoteNumber(quoteData?.volume),
                asOf: stream && quoteData === stream ? stream.as_of : admitted?.asOf,
                stale: stream && quoteData === stream ? stream.stale : admitted?.stale,
                delivery: quoteData ? stream && quoteData === stream ? 'WebSocket' : 'HTTP quote' : undefined,
                source: stream && quoteData === stream ? stream.source : admitted?.source,
                upstreamSource: stream && quoteData === stream ? null : admitted?.upstreamSource,
                error: stored?.error || storedQuotes[index]?.error?.message,
            };
        });
    }, [symbols, livePrices, symbolNameMap, storedQuotes]);

    const sortedWatchlist = useMemo(() => {
        const sorted = [...watchlist];
        sorted.sort((a, b) => {
            if (sortConfig.field === 'symbol') {
                const comparison = a.symbol.localeCompare(b.symbol);
                return sortConfig.order === 'asc' ? comparison : -comparison;
            }

            const field = sortConfig.field === 'price' ? 'price' : sortConfig.field === 'changePercent' ? 'changePercent' : 'volume';
            const aValue = a[field];
            const bValue = b[field];
            if (aValue === null) return bValue === null ? 0 : 1;
            if (bValue === null) return -1;
            const comparison = aValue - bValue;
            return sortConfig.order === 'asc' ? comparison : -comparison;
        });
        return sorted;
    }, [watchlist, sortConfig]);

    const hasSymbols = symbols.length > 0;
    const hasObservedQuote = watchlist.some(item => item.price !== null);
    const observedQuotes = watchlist.filter(item => item.price !== null);
    const observedTimes = observedQuotes.map(item => Date.parse(item.asOf || ''));
    const observedAt = observedTimes.length && observedTimes.every(Number.isFinite)
        ? new Date(Math.min(...observedTimes)) : null;
    const connectionNote = !hasSymbols
        ? 'Add symbols to begin'
        : isConnected
            ? hasObservedQuote ? 'Connected · Stored or observed quote' : 'Live feed · Awaiting quote'
            : hasObservedQuote ? 'Disconnected · Cached quote receipt' : 'Disconnected · Unavailable';
    const showCached = hasObservedQuote && (!isConnected || watchlist.some(item => item.delivery === 'HTTP quote' || item.stale));
    const stale = observedQuotes.some(item => item.stale === true) ? true
        : observedQuotes.length && observedQuotes.every(item => item.stale === false) ? false : undefined;
    const deliverySources = new Set(observedQuotes.map(item =>
        `${item.delivery} · ${item.source || 'Source unknown'} · ${item.upstreamSource ? `Lineage ${item.upstreamSource}` : 'Supplier unknown'}`));
    const sourceLabel = [...deliverySources].join('; ') || 'Quote source unknown';
    const warnings = [...new Set([
        ...(protocolError ? [`WebSocket: ${protocolError}`] : []),
        ...watchlist.flatMap(item => [
            ...(item.error ? [`${item.symbol}: ${item.error}`] : []),
            ...(item.price !== null && !Number.isFinite(Date.parse(item.asOf || ''))
                ? [`${item.symbol}: Observation time unknown; freshness unknown.`] : []),
        ]),
    ])];
    const warningsText = warnings.join('\n');
    const usesHttpQuotes = watchlist.some(item => item.delivery === 'HTTP quote');

    useEffect(() => {
        onDataChange?.(
            buildWidgetRuntime({
                empty: !hasSymbols,
                apiGroup: usesHttpQuotes ? '/equity' : '/ws',
                endpoint: usesHttpQuotes ? '/api/v1/equity/{symbol}/quote' : '/api/v1/ws/prices',
                sourceLabel,
                lastDataDate: observedAt?.toISOString() ?? null,
                fetchedAt: lastUpdate,
                cached: showCached,
                stale,
                warnings: warningsText ? warningsText.split('\n') : [],
                extra: hasSymbols ? { symbolCount: symbols.length } : undefined,
            }),
        );
    }, [hasSymbols, lastUpdate, showCached, stale, symbols.length, onDataChange, observedAt?.getTime(), sourceLabel, warningsText, usesHttpQuotes]);

    const handleAddSymbol = useCallback(() => {
        const symbolUpper = normalizeTickerSymbol(newSymbol);
        if (!symbolUpper) {
            setSymbolError('Enter a three-character ticker using letters or numbers.');
            return;
        }
        setSymbolError(null);
        if (symbols.includes(symbolUpper)) {
            setNewSymbol('');
            setShowAddInput(false);
            return;
        }
        setSymbols(prev => [...prev, symbolUpper]);
        setNewSymbol('');
        setShowAddInput(false);
    }, [newSymbol, symbols, setSymbols]);

    const handleRemoveSymbol = useCallback((symbolToRemove: string) => {
        setSymbols(prev => prev.filter(s => s !== symbolToRemove));
    }, [setSymbols]);

    const handleClearAll = useCallback(() => {
        setSymbols([]);
        setShowClearConfirm(false);
    }, []);

    const handleSort = useCallback((field: SortField) => {
        setSortConfig(prev => ({
            field,
            order: prev.field === field && prev.order === 'asc' ? 'desc' : 'asc'
        }));
    }, [setSortConfig]);

    const handleSymbolSelect = useCallback((symbol: string) => {
        setLinkedSymbol(symbol);
    }, [setLinkedSymbol]);

    const formatPrice = (price: number | null) => formatNumber(price, { decimals: 0, locale: 'vi-VN' });
    const formatChange = (change: number | null, percent: number | null) => {
        if (change === null || percent === null) return EMPTY_VALUE;
        return `${change > 0 ? '+' : ''}${percent.toFixed(2)}%`;
    };
    const getChangeColor = (change: number | null) => {
        if (change === null) return 'text-[var(--text-muted)]';
        if (change > 0) return 'text-green-400';
        if (change < 0) return 'text-red-400';
        return 'text-yellow-400';
    };
    const getChangeIcon = (change: number | null) => {
        if (change === null) return <Minus size={14} className="text-[var(--text-muted)]" />;
        if (change > 0) return <TrendingUp size={14} className="text-green-400" />;
        if (change < 0) return <TrendingDown size={14} className="text-red-400" />;
        return <Minus size={14} className="text-yellow-400" />;
    };
    const getSortIcon = (field: SortField) => {
        if (sortConfig.field !== field) return null;
        return sortConfig.order === 'asc' ? '↑' : '↓';
    };

    return (
        <WidgetContainer
            title="Watchlist"
            onClose={onRemove}
            noPadding
            widgetId={id}
        >
            <div className="h-full flex flex-col bg-[var(--bg-primary)] text-[var(--text-primary)]">
                <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)]">
                    <div className="flex items-center gap-2">
                        <Star size={14} className="text-yellow-400" />
                        <span className="text-xs text-[var(--text-muted)] font-bold uppercase tracking-tighter">{symbols.length} symbols</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <button type="button" aria-label="Add watchlist symbol" onClick={() => setShowAddInput(!showAddInput)} className="min-h-11 min-w-11 rounded p-2 text-[var(--text-muted)] hover:text-blue-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 transition-colors">
                            <Plus size={14} />
                        </button>
                        {symbols.length > 0 && (
                            <button type="button" aria-label="Clear watchlist" onClick={() => setShowClearConfirm(true)} className="min-h-11 min-w-11 rounded p-2 text-[var(--text-muted)] hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 transition-colors">
                                <Trash2 size={14} />
                            </button>
                        )}
                    </div>
                </div>

                <div className="px-3 py-1.5 border-b border-[var(--border-color)]/70 bg-[var(--bg-primary)]">
                    <WidgetMeta
                        updatedAt={observedAt}
                        fetchedAt={lastUpdate}
                        isCached={showCached}
                        isStale={stale}
                        note={connectionNote}
                        sourceLabel={sourceLabel}
                        align="right"
                    />
                    {warnings.map(warning => <p key={warning} role="status" className="mt-1 text-[10px] text-amber-400">{warning}</p>)}
                </div>

                {showClearConfirm && (
                    <div className="px-3 py-2 border-b border-red-900/20 bg-red-900/10 text-left">
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] text-red-400 font-bold uppercase">Clear watchlist?</span>
                            <div className="flex gap-2">
                                <button type="button" onClick={handleClearAll} className="min-h-11 rounded bg-red-600 px-3 text-[10px] font-bold uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40">Clear</button>
                                <button type="button" onClick={() => setShowClearConfirm(false)} className="min-h-11 rounded px-3 text-[var(--text-secondary)] text-[10px] font-bold uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40">Cancel</button>
                            </div>
                        </div>
                    </div>
                )}

                {showAddInput && (
                    <div className="px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]/40">
                        <div className="flex gap-1">
                            <input
                                type="text"
                                aria-label="Watchlist symbol"
                                aria-invalid={Boolean(symbolError)}
                                aria-describedby={symbolError ? symbolErrorId : undefined}
                                value={newSymbol}
                                onChange={(e) => { setNewSymbol(e.target.value.toUpperCase()); setSymbolError(null); }}
                                onKeyDown={(e) => e.key === 'Enter' && handleAddSymbol()}
                                className="min-h-11 flex-1 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-2 py-1 text-xs text-[var(--text-primary)] uppercase font-bold focus-visible:ring-2 focus-visible:ring-blue-500/40 outline-none"
                                placeholder="SYMBOL"
                                autoFocus
                            />
                            <button type="button" onClick={handleAddSymbol} className="min-h-11 rounded bg-blue-600 px-3 py-1 text-[10px] font-black uppercase tracking-tighter focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40">Add</button>
                        </div>
                        {symbolError && <p id={symbolErrorId} role="alert" className="mt-2 text-xs text-red-400">{symbolError}</p>}
                    </div>
                )}

                <div className="flex-1 overflow-y-auto scrollbar-hide">
                    {!hasSymbols ? (
                        <WidgetEmpty
                            message="Your watchlist is empty."
                            action={{ label: 'Add symbol', onClick: () => setShowAddInput(true) }}
                        />
                    ) : (
                        <table className="data-table w-full text-[11px] text-left border-collapse">
                            <thead className="sticky top-0 bg-[var(--bg-primary)] text-[var(--text-muted)] z-10">
                                <tr className="border-b border-[var(--border-color)]">
                                    <th className="px-3 py-2 font-black uppercase tracking-tighter cursor-pointer hover:text-[var(--text-primary)] transition-colors" onClick={() => handleSort('symbol')}>
                                        Symbol {getSortIcon('symbol')}
                                    </th>
                                    <th className="text-right px-2 py-2 font-black uppercase tracking-tighter cursor-pointer hover:text-[var(--text-primary)] transition-colors" onClick={() => handleSort('price')}>
                                        Price {getSortIcon('price')}
                                    </th>
                                    <th className="text-right px-3 py-2 font-black uppercase tracking-tighter cursor-pointer hover:text-[var(--text-primary)] transition-colors" onClick={() => handleSort('changePercent')}>
                                        Chg% {getSortIcon('changePercent')}
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="text-left">
                                {sortedWatchlist.map((item, index) => (
                                    <tr
                                        key={`${item.symbol}-${index}`}
                                        onClick={() => handleSymbolSelect(item.symbol)}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault();
                                                handleSymbolSelect(item.symbol);
                                            }
                                        }}
                                        role="button"
                                        tabIndex={0}
                                        aria-label={`View ${item.symbol}`}
                                        className="border-b border-[var(--border-color)]/70 hover:bg-[var(--bg-secondary)]/50 transition-colors cursor-pointer group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30"
                                    >
                                        <td className="px-3 py-2">
                                            <div className="flex items-center gap-2">
                                                {getChangeIcon(item.change)}
                                                <span className="font-black text-blue-400 group-hover:text-blue-300 transition-colors">{item.symbol}</span>
                                            </div>
                                        </td>
                                        <td className="text-right px-2 py-2 font-mono text-[var(--text-primary)]">
                                            <div>{formatPrice(item.price)}</div>
                                            {item.price === null && <div className="text-[9px] text-[var(--text-muted)]">{isConnected ? 'Awaiting quote' : 'Unavailable'}</div>}
                                        </td>
                                        <td className={`text-right px-3 py-2 font-mono ${getChangeColor(item.change)}`}>
                                            {formatChange(item.change, item.changePercent)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </WidgetContainer>
    );
}

export const WatchlistWidget = memo(WatchlistWidgetComponent);
export default WatchlistWidget;
