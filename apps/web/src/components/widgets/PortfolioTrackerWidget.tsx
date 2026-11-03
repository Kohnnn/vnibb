// Portfolio Tracker Widget - Full-featured holdings tracker with P&L

'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQueries } from '@tanstack/react-query';
import {
    Briefcase, Plus, X, Edit2, Check, Download, FileJson, RefreshCw,
    TrendingUp, TrendingDown, PieChart, ChevronDown, ChevronUp
} from 'lucide-react';
import { usePortfolio, type Position } from '@/lib/hooks/usePortfolio';
import { usePortfolioPrices } from '@/lib/hooks/usePortfolioPrices';
import * as api from '@/lib/api';
import { equityQueryKeys } from '@/lib/queries/equity';
import { formatVND } from '@/lib/formatters';
// P/L percentage is already in percentage points; `input: 'percent'` keeps the
// auto heuristic (`|v| <= 1` means ratio) from re-scaling a 1.5% gain to 150%.
import { formatPercent } from '@/lib/units';
import { buildWidgetRuntime } from '@/lib/widgetRuntime';
import { exportToCSV, exportToJSON } from '@/lib/exportWidget';
import { calculatePortfolioConcentration, calculatePortfolioValuation } from '@/lib/portfolioAnalytics';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { WidgetEmpty } from '@/components/ui/widget-states';
import { useWidgetSymbolLink } from '@/hooks/useWidgetSymbolLink';
import type { WidgetGroupId } from '@/types/widget';

// ============================================================================
// Types
// ============================================================================

interface PortfolioTrackerWidgetProps {
    isEditing?: boolean;
    onRemove?: () => void;
    onSymbolClick?: (symbol: string) => void;
    widgetGroup?: WidgetGroupId;
    onDataChange?: (data: WidgetDataPayload) => void;
}

interface PositionWithPL extends Position {
    currentPrice: number | null;
    marketValue: number | null;
    costBasis: number;
    unrealizedPL: number | null;
    unrealizedPLPct: number | null;
    dayChange: number | null;
    dayChangePct: number | null;
    quoteUpdatedAt: string | null;
    quoteFetchedAt: number | null;
    isLoading: boolean;
}

type ViewMode = 'positions' | 'allocation';

// Brand §20 categorical extension: sectors carry no direction, so no green/red.
const SECTOR_COLORS: Record<string, string> = {
    'Technology': 'var(--chart-blue)',
    'Financials': 'var(--chart-slate)',
    'Real Estate': 'var(--chart-cat-4)',
    'Consumer Goods': 'var(--chart-cat-5)',
    'Materials': 'var(--chart-cat-6)',
    'Energy': 'var(--chart-cat-3)',
    'Industrials': 'var(--chart-cat-5)',
    'Utilities': 'var(--chart-cat-4)',
    'Healthcare': 'var(--chart-cat-6)',
    'Other': 'var(--text-muted)',
};

// ============================================================================
// Sub-components
// ============================================================================

// Direction as the reader sees it: a value that rounds to zero at the rendered
// precision has no side, so the arrow, the sign and the tint all agree.
type Direction = 'up' | 'down' | 'flat' | null;

function directionOf(value: number | null | undefined, decimals: number): Direction {
    if (value === null || value === undefined || !Number.isFinite(value)) return null;
    if (Number(Math.abs(value).toFixed(decimals)) === 0) return 'flat';
    return value > 0 ? 'up' : 'down';
}

function inkFor(direction: Direction): string {
    if (direction === 'up') return 'text-[var(--color-positive)]';
    if (direction === 'down') return 'text-[var(--color-negative)]';
    return 'text-[var(--color-text-muted)]';
}

function AddPositionForm({
    onAdd,
    onCancel,
}: {
    onAdd: (pos: Omit<Position, 'id'>) => boolean;
    onCancel: () => void;
}) {
    const [symbol, setSymbol] = useState('');
    const [quantity, setQuantity] = useState('');
    const [avgCost, setAvgCost] = useState('');
    const [purchaseDate, setPurchaseDate] = useState(
        new Date().toISOString().split('T')[0]
    );
    const [notes, setNotes] = useState('');

    const parsedQuantity = Number(quantity);
    const validQuantity = Number.isSafeInteger(parsedQuantity) && parsedQuantity > 0;
    const validCost = avgCost.trim() !== '' && Number.isFinite(Number(avgCost)) && Number(avgCost) >= 0;

    const handleSubmit = () => {
        if (!symbol.trim() || !validQuantity || !validCost) return;

        if (!onAdd({
            symbol: symbol.trim().toUpperCase(),
            quantity: parsedQuantity,
            avgCost: Number(avgCost),
            purchaseDate,
            notes: notes.trim() || undefined,
        })) return;

        setSymbol('');
        setQuantity('');
        setAvgCost('');
        setPurchaseDate(new Date().toISOString().split('T')[0]);
        setNotes('');
    };

    return (
        <div className="p-2 bg-[var(--color-bg-tertiary)] rounded-lg space-y-2">
            <div className="grid grid-cols-4 gap-1">
                <input
                    type="text"
                    placeholder="Symbol"
                    value={symbol}
                    onChange={e => setSymbol(e.target.value.toUpperCase())}
                    className="bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)] text-xs px-2 py-1.5 rounded focus:ring-1 focus:ring-[var(--focus-ring-color)] outline-none"
                    maxLength={10}
                />
                <input
                    type="number"
                    placeholder="Qty"
                    value={quantity}
                    onChange={e => setQuantity(e.target.value)}
                    className="bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)] text-xs px-2 py-1.5 rounded focus:ring-1 focus:ring-[var(--focus-ring-color)] outline-none"
                    min={1}
                    step={1}
                />
                <input
                    type="number"
                    placeholder="Avg Cost"
                    value={avgCost}
                    onChange={e => setAvgCost(e.target.value)}
                    className="bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)] text-xs px-2 py-1.5 rounded focus:ring-1 focus:ring-[var(--focus-ring-color)] outline-none"
                    min={0}
                    step={100}
                />
                <input
                    type="date"
                    value={purchaseDate}
                    onChange={e => setPurchaseDate(e.target.value)}
                    className="bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)] text-xs px-2 py-1.5 rounded focus:ring-1 focus:ring-[var(--focus-ring-color)] outline-none"
                />
            </div>
            <div className="flex gap-1">
                <input
                    type="text"
                    placeholder="Notes (optional)"
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    className="flex-1 bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)] text-xs px-2 py-1.5 rounded focus:ring-1 focus:ring-[var(--focus-ring-color)] outline-none"
                />
                <button
                    onClick={handleSubmit}
                    disabled={!symbol.trim() || !validQuantity || !validCost}
                    // Dimming only the label left muted ink on a solid fill
                    // (1.7:1 in light). Dimming the control keeps `on-accent`
                    // over `accent-fill` paired and still reads as disabled.
                    className="px-3 py-1.5 bg-[var(--color-accent-fill)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed text-[var(--color-on-accent)] text-xs rounded transition-colors"
                >
                    Add
                </button>
                <button
                    onClick={onCancel}
                    className="px-2 py-1.5 text-[var(--color-text-primary)] hover:text-[var(--color-text-muted)] text-xs rounded transition-colors"
                >
                    <X size={12} />
                </button>
            </div>
        </div>
    );
}

function EditPositionRow({
    position,
    onSave,
    onCancel,
}: {
    position: Position;
    onSave: (updates: Partial<Omit<Position, 'id'>>) => boolean;
    onCancel: () => void;
}) {
    const [quantity, setQuantity] = useState(position.quantity.toString());
    const [avgCost, setAvgCost] = useState(position.avgCost.toString());
    const parsedQuantity = Number(quantity);
    const validQuantity = quantity.trim() !== '' && Number.isSafeInteger(parsedQuantity) && parsedQuantity > 0;
    const validCost = avgCost.trim() !== '' && Number.isFinite(Number(avgCost)) && Number(avgCost) >= 0;

    return (
        <tr className="bg-[var(--color-bg-tertiary)]">
            <td className="py-1.5 px-1 text-[var(--color-text-primary)] font-medium">{position.symbol}</td>
            <td className="py-1.5 px-1">
                <input
                    type="number"
                    value={quantity}
                    onChange={e => setQuantity(e.target.value)}
                    className="w-16 bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)] text-xs px-1 py-0.5 rounded"
                    min={1}
                    step={1}
                />
            </td>
            <td className="py-1.5 px-1">
                <input
                    type="number"
                    value={avgCost}
                    onChange={e => setAvgCost(e.target.value)}
                    className="w-20 bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)] text-xs px-1 py-0.5 rounded"
                    min={0}
                    step={100}
                />
            </td>
            <td className="py-1.5 px-1 text-right" colSpan={2}>
                <button
                    onClick={() => onSave({
                        quantity: parsedQuantity,
                        avgCost: Number(avgCost),
                    })}
                    disabled={!validQuantity || !validCost}
                    className="p-1 text-[var(--color-positive)] hover:bg-[var(--color-bg-tertiary)] rounded mr-1"
                >
                    <Check size={12} />
                </button>
                <button
                    onClick={onCancel}
                    className="p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] rounded"
                >
                    <X size={12} />
                </button>
            </td>
        </tr>
    );
}

function AllocationChart({
    positions,
    sectors,
}: {
    positions: PositionWithPL[];
    sectors: Map<string, string>;
}) {
    const concentration = useMemo(() => calculatePortfolioConcentration(positions.flatMap((position) => (
        position.marketValue === null ? [] : [{
            symbol: position.symbol,
            marketValue: position.marketValue,
            sector: sectors.get(position.symbol) ?? null,
            hasLiveQuote: true,
        }]
    ))), [positions, sectors]);

    if (concentration.sectors.length === 0) {
        return (
            <div className="flex h-32 flex-col items-center justify-center gap-1 text-center text-xs text-[var(--color-text-muted)]">
                <span>{positions.length === 0 ? 'No positions to display' : 'Quoted sector allocation unavailable'}</span>
                {positions.length > 0 && (
                    <span>Sector profiles: 0 / {concentration.positionCount} quoted holdings · 0 / {formatVND(concentration.totalValue)} quoted market value.</span>
                )}
            </div>
        );
    }

    return (
        <div className="space-y-3 p-2">
            <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-tertiary)] p-2">
                    <div className="text-[var(--color-text-muted)]">Largest Holding</div>
                    <div className="mt-0.5 text-[var(--color-text-primary)]">
                        {concentration.largestHolding?.symbol} · {((concentration.largestHolding?.weight || 0) * 100).toFixed(1)}%
                    </div>
                </div>
                <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-tertiary)] p-2">
                    <div className="text-[var(--color-text-muted)]">Top 3 Holdings</div>
                    <div className="mt-0.5 text-[var(--color-text-primary)]">{(concentration.topThreeWeight * 100).toFixed(1)}%</div>
                </div>
                <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-tertiary)] p-2">
                    <div className="text-[var(--color-text-muted)]">HHI / Effective</div>
                    <div className="mt-0.5 text-[var(--color-text-primary)]">
                        {concentration.hhi.toFixed(3)} / {concentration.effectivePositions.toFixed(1)} positions
                    </div>
                </div>
                <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-tertiary)] p-2">
                    <div className="text-[var(--color-text-muted)]">Largest Sector</div>
                    <div className="mt-0.5 text-[var(--color-text-primary)]">
                        {concentration.largestSector?.name} · {((concentration.largestSector?.weight || 0) * 100).toFixed(1)}%
                    </div>
                </div>
            </div>
            <div className="text-[10px] text-[var(--color-text-muted)]">
                Quote coverage: {concentration.quotedPositionCount} / {positions.length}; allocation uses quoted market value only.
            </div>
            <div className="text-[10px] text-[var(--color-text-muted)]">
                Sector profiles: {concentration.resolvedSectorPositionCount} / {concentration.positionCount} quoted holdings · {formatVND(concentration.resolvedSectorValue)} / {formatVND(concentration.totalValue)} quoted market value; unresolved {concentration.unresolvedSectorPositionCount} / {formatVND(concentration.unresolvedSectorValue)}.
            </div>
            {concentration.sectors.map(sector => (
                <div key={sector.name} className="space-y-1">
                    <div className="flex justify-between text-xs">
                        <span className="text-[var(--color-text-secondary)]">{sector.name}</span>
                        <span className="text-[var(--color-text-secondary)]">
                            {(sector.weight * 100).toFixed(1)}% • {formatVND(sector.value)}
                        </span>
                    </div>
                    <div className="h-2 bg-[var(--color-bg-tertiary)] rounded-full overflow-hidden">
                        <div
                            className="h-full rounded-full transition-all duration-300"
                            style={{
                                width: `${sector.weight * 100}%`,
                                backgroundColor: SECTOR_COLORS[sector.name] || SECTOR_COLORS['Other'],
                            }}
                        />
                    </div>
                </div>
            ))}
        </div>
    );
}

// ============================================================================
// Main Widget
// ============================================================================

export function PortfolioTrackerWidget({
    onSymbolClick,
    widgetGroup,
    onDataChange,
}: PortfolioTrackerWidgetProps) {
    const { setLinkedSymbol } = useWidgetSymbolLink(widgetGroup, { widgetType: 'portfolio_tracker' });
    const {
        portfolio,
        positions,
        cashBalance,
        valueHistory,
        symbols,
        addPosition,
        updatePosition,
        removePosition,
        recordValueSnapshot,
        storageError,
    } = usePortfolio();

    const { prices, isLoading: pricesLoading, refetch } = usePortfolioPrices(symbols);
    const profileQueries = useQueries({
        queries: symbols.map((symbol) => ({
            queryKey: equityQueryKeys.profile(symbol),
            queryFn: () => api.getProfile(symbol),
            staleTime: 10 * 60 * 1000,
        })),
    });
    const sectors = useMemo(() => new Map(symbols.flatMap((symbol, index) => {
        const sector = profileQueries[index]?.data?.data?.sector;
        return typeof sector === 'string' && sector.trim() ? [[symbol, sector]] : [];
    })), [profileQueries, symbols]);

    const [showAddForm, setShowAddForm] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<ViewMode>('positions');
    const [sortField, setSortField] = useState<'symbol' | 'value' | 'pl'>('value');
    const [sortAsc, setSortAsc] = useState(false);

    // Enrich positions with current prices and P/L
    const enrichedPositions: PositionWithPL[] = useMemo(() => {
        return positions.map(pos => {
            const priceData = prices.get(pos.symbol);
            const currentPrice = Number.isFinite(priceData?.currentPrice) && (priceData?.currentPrice ?? 0) > 0 ? priceData?.currentPrice ?? null : null;
            const costBasis = pos.quantity * pos.avgCost;
            const marketValue = currentPrice === null ? null : pos.quantity * currentPrice;
            const unrealizedPL = marketValue === null ? null : marketValue - costBasis;
            const unrealizedPLPct = unrealizedPL !== null && costBasis > 0 ? (unrealizedPL / costBasis) * 100 : null;

            return {
                ...pos,
                currentPrice,
                marketValue,
                costBasis,
                unrealizedPL,
                unrealizedPLPct,
                dayChange: priceData?.change ?? null,
                dayChangePct: priceData?.changePct ?? null,
                quoteUpdatedAt: priceData?.updatedAt ?? null,
                quoteFetchedAt: priceData?.fetchedAt ?? null,
                isLoading: priceData?.isLoading ?? true,
            };
        });
    }, [positions, prices]);

    // Sort positions
    const sortedPositions = useMemo(() => {
        const sorted = [...enrichedPositions];
        sorted.sort((a, b) => {
            let cmp = 0;
            switch (sortField) {
                case 'symbol':
                    cmp = a.symbol.localeCompare(b.symbol);
                    break;
                case 'value':
                    cmp = (a.marketValue ?? Number.NEGATIVE_INFINITY) - (b.marketValue ?? Number.NEGATIVE_INFINITY);
                    break;
                case 'pl':
                    cmp = (a.unrealizedPLPct ?? Number.NEGATIVE_INFINITY) - (b.unrealizedPLPct ?? Number.NEGATIVE_INFINITY);
                    break;
            }
            return sortAsc ? cmp : -cmp;
        });
        return sorted;
    }, [enrichedPositions, sortField, sortAsc]);

    const totals = useMemo(() => {
        const valuation = calculatePortfolioValuation(enrichedPositions);
        const todayChange = enrichedPositions.reduce((sum, position) => {
            if (position.dayChange === null || position.currentPrice === null) return sum;
            return sum + (position.dayChange * position.quantity);
        }, 0);
        return { ...valuation, todayChange };
    }, [enrichedPositions]);
    const latestQuoteUpdatedAt = useMemo(() => enrichedPositions.reduce<string | null>((latest, position) => (
        position.quoteUpdatedAt && (!latest || position.quoteUpdatedAt > latest) ? position.quoteUpdatedAt : latest
    ), null), [enrichedPositions]);
    const latestQuoteFetchedAt = useMemo(() => enrichedPositions.reduce<number | null>((latest, position) => (
        position.quoteFetchedAt && (!latest || position.quoteFetchedAt > latest) ? position.quoteFetchedAt : latest
    ), null), [enrichedPositions]);

    useEffect(() => {
        onDataChange?.(buildWidgetRuntime({
            empty: positions.length === 0,
            apiGroup: '/equity',
            endpoint: '/api/v1/market/quotes/batch',
            sourceLabel: 'Local portfolio',
            lastDataDate: latestQuoteUpdatedAt,
            fetchedAt: latestQuoteFetchedAt,
            derived: true,
            extra: {
                positionCount: positions.length,
                symbolCount: symbols.length,
                resolvedSectorCount: sectors.size,
                unresolvedSectorCount: Math.max(0, symbols.length - sectors.size),
                quotedMarketValue: totals.quotedMarketValue,
                unpricedCostBasis: totals.unpricedCostBasis,
                quoteCoverage: { quoted: totals.quotedPositionCount, total: totals.positionCount },
                marketValue: totals.marketValue,
                unrealizedPL: totals.unrealizedPL,
            },
        }));
    }, [latestQuoteUpdatedAt, latestQuoteFetchedAt, onDataChange, positions.length, sectors.size, symbols.length, totals.marketValue, totals.quotedMarketValue, totals.unpricedCostBasis, totals.unrealizedPL, totals.quotedPositionCount, totals.positionCount]);

    useEffect(() => {
        if (!pricesLoading && positions.length > 0 && totals.marketValue !== null) {
            recordValueSnapshot(totals.marketValue, totals.totalCostBasis);
        }
    }, [pricesLoading, positions.length, totals.marketValue, totals.totalCostBasis, recordValueSnapshot]);

    const exportPayload = useMemo(() => {
        const quoteCoverage = {
            quotedPositionCount: totals.quotedPositionCount,
            positionCount: totals.positionCount,
            unpricedPositionCount: totals.unpricedPositionCount,
            unquotedSymbols: enrichedPositions.filter((position) => position.currentPrice === null).map((position) => position.symbol),
            quoteUpdatedAt: Object.fromEntries(enrichedPositions.map((position) => [position.symbol, position.quoteUpdatedAt])),
        };
        const sectorCoverage = {
            resolvedPositionCount: enrichedPositions.filter((position) => sectors.has(position.symbol)).length,
            positionCount: enrichedPositions.length,
            unresolvedSymbols: enrichedPositions.filter((position) => !sectors.has(position.symbol)).map((position) => position.symbol),
        };
        return {
            localOnly: true,
            generatedAt: new Date().toISOString(),
            portfolio,
            positions: enrichedPositions.map(({ isLoading, ...position }) => ({ ...position, sector: sectors.get(position.symbol) ?? null })),
            totals: {
                ...totals,
                cashBalance,
                portfolioValueIncludingCash: totals.marketValue === null ? null : totals.marketValue + cashBalance,
                aggregateStatus: totals.marketValue === null ? 'partial_quote_coverage' : 'complete_quote_coverage',
            },
            cashBalance,
            valueHistory,
            quoteCoverage,
            sectorResolutionCoverage: sectorCoverage,
        };
    }, [cashBalance, enrichedPositions, portfolio, sectors, totals, valueHistory]);

    const handleExportCSV = useCallback(() => {
        if (enrichedPositions.length === 0) return;
        const rows = [
            ...exportPayload.positions.map((position) => ({ section: 'position', ...position })),
            { section: 'totals', ...exportPayload.totals },
            { section: 'quote_coverage', ...exportPayload.quoteCoverage },
            { section: 'sector_resolution_coverage', ...exportPayload.sectorResolutionCoverage },
            ...valueHistory.map((snapshot) => ({ section: 'value_history', ...snapshot })),
        ];
        exportToCSV(rows,             `holdings_${new Date().toISOString().split('T')[0]}`, {
            widgetType: 'portfolio_tracker',
            widgetTitle: 'Holdings Tracker',
            sourceLabel: 'Browser-local holdings',
            apiGroup: '/equity',
            endpoint: '/api/v1/market/quotes/batch',
            localOnly: true,
        });
    }, [enrichedPositions.length, exportPayload, valueHistory]);

    const handleExportJSON = useCallback(() => {
        exportToJSON(exportPayload,             `holdings_${new Date().toISOString().split('T')[0]}`, {
            widgetType: 'portfolio_tracker',
            widgetTitle: 'Holdings Tracker',
            sourceLabel: 'Browser-local holdings',
            apiGroup: '/equity',
            endpoint: '/api/v1/market/quotes/batch',
            localOnly: true,
        });
    }, [exportPayload]);

    const handleSort = (field: typeof sortField) => {
        if (sortField === field) {
            setSortAsc(!sortAsc);
        } else {
            setSortField(field);
            setSortAsc(false);
        }
    };

    const SortIcon = ({ field }: { field: typeof sortField }) => {
        if (sortField !== field) return null;
        return sortAsc ? <ChevronUp size={10} /> : <ChevronDown size={10} />;
    };

    // Break-even is neither gain nor loss: no green ink, no `+`, no arrow.
    // Each direction is read from the digits it decorates, so a glyph can never
    // claim a side the adjacent number does not show — the VND total rounds to
    // whole dong, the percentage to one decimal.
    const plDirection = directionOf(totals.unrealizedPL, 0);
    const plPctDirection = directionOf(totals.unrealizedPLPct, 1);
    const isProfit = plDirection === 'up';

    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-2 py-1.5 border-b border-[var(--color-border-default)]">
                <div className="flex items-center gap-2">
                    <Briefcase size={14} className="text-[var(--color-accent-primary)]" />
                    <div className="text-xs">
                        <span className="text-[var(--color-text-secondary)]">{totals.marketValue === null ? 'Market value:' : 'Quoted market value:'} </span>
                        <span className="text-[var(--color-text-primary)] font-medium">
                            {totals.marketValue === null ? 'Unavailable' : formatVND(totals.marketValue)}
                        </span>
                        {totals.unrealizedPLPct !== null && (
                            <span className={`ml-2 ${inkFor(plPctDirection)}`}>
                                {formatPercent(totals.unrealizedPLPct, { input: 'percent', decimals: 1, signed: true })}
                            </span>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <WidgetMeta
                        updatedAt={latestQuoteUpdatedAt}
                        fetchedAt={latestQuoteFetchedAt}
                        isFetching={pricesLoading}
                        note="Local holdings"
                        align="right"
                    />
                    <button
                        onClick={() => refetch()}
                        className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)] rounded transition-colors"
                        title="Refresh prices"
                    >
                        <RefreshCw size={12} className={pricesLoading ? 'animate-spin' : ''} />
                    </button>
                    <button
                        onClick={handleExportCSV}
                        disabled={positions.length === 0}
                        className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)] rounded transition-colors disabled:opacity-50"
                        title="Export to CSV"
                    >
                        <Download size={12} />
                    </button>
                    <button
                        onClick={handleExportJSON}
                        disabled={positions.length === 0}
                        className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)] rounded transition-colors disabled:opacity-50"
                        title="Export to JSON"
                        aria-label="Export portfolio to JSON"
                    >
                        <FileJson size={12} />
                    </button>
                    <button
                        onClick={() => setViewMode(viewMode === 'positions' ? 'allocation' : 'positions')}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setViewMode(viewMode === 'positions' ? 'allocation' : 'positions');
                            }
                        }}
                        className={`p-1 rounded transition-colors ${
                            viewMode === 'allocation' 
                                ? 'text-[var(--color-accent-primary)] bg-[var(--color-state-bg)]' 
                                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)]'
                        }`}
                        title="Sector allocation"
                        aria-label="Toggle sector allocation"
                    >
                        <PieChart size={12} />
                    </button>
                    <button
                        onClick={() => setShowAddForm(!showAddForm)}
                        className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)] rounded transition-colors"
                        title="Add position"
                    >
                        <Plus size={12} />
                    </button>
                </div>
            </div>

            <div className="border-b border-[var(--color-border-default)] px-2 py-1 text-[10px] text-[var(--color-text-muted)]">
                Browser-local holdings monitor. Not transaction accounting; realized returns, fees, dividends, deposits, withdrawals, and cash-flow-aware performance are not included.
            </div>

            <div className="grid grid-cols-2 gap-2 px-2 py-1.5 border-b border-[var(--color-border-default)] text-xs sm:grid-cols-4">
                <div>
                    <div className="text-[var(--color-text-muted)]">Quoted market value</div>
                    <div className="text-[var(--color-text-primary)] font-mono">{formatVND(totals.quotedMarketValue)}</div>
                </div>
                <div>
                    <div className="text-[var(--color-text-muted)]">Unpriced cost basis</div>
                    <div className="text-[var(--color-text-primary)] font-mono">{formatVND(totals.unpricedCostBasis)}</div>
                </div>
                <div>
                    <div className="text-[var(--color-text-muted)]">Quote coverage</div>
                    <div className="text-[var(--color-text-primary)] font-mono">{totals.quotedPositionCount} / {totals.positionCount}</div>
                </div>
                <div>
                    <div className="text-[var(--color-text-muted)]">Unrealized P/L</div>
                    <div className={`font-mono ${inkFor(plDirection)}`}>
                        {totals.unrealizedPL === null ? 'Unavailable' : `${plDirection === 'up' ? '+' : ''}${formatVND(totals.unrealizedPL)}`}
                    </div>
                </div>
            </div>
            {totals.unpricedPositionCount > 0 && (
                <div className="border-b border-[var(--color-state-border)] bg-[var(--color-state-bg)] px-2 py-1 text-[10px] text-[var(--color-warning)]">
                    Aggregate market value and unrealized P/L are unavailable: {totals.unpricedPositionCount} holding{totals.unpricedPositionCount === 1 ? '' : 's'} lack a valid quote. Unpriced cost basis is not market value.
                </div>
            )}

            {storageError && (
                <div role="alert" className="border-b border-[var(--color-state-border)] bg-[var(--color-negative-bg)] px-2 py-2 text-xs text-[var(--color-negative)]">
                    {storageError} Export CSV or JSON to back up the last saved holdings.
                </div>
            )}
            {/* Add Form */}
            {showAddForm && (
                <div className="px-2 py-2 border-b border-[var(--color-border-default)]">
                    <AddPositionForm
                        onAdd={pos => {
                            if (!addPosition(pos)) return false;
                            setShowAddForm(false);
                            return true;
                        }}
                        onCancel={() => setShowAddForm(false)}
                    />
                </div>
            )}

            {/* Content */}
            <div className="flex-1 overflow-auto">
                {viewMode === 'allocation' ? (
                    <AllocationChart positions={enrichedPositions} sectors={sectors} />
                ) : positions.length === 0 ? (
                    <WidgetEmpty message="Add holdings to track" icon={<Briefcase size={18} />} />
                ) : (
                    <table className="data-table w-full text-xs">
                        <thead className="text-[var(--color-text-muted)] sticky top-0 bg-[var(--color-bg-primary)]">
                            <tr className="border-b border-[var(--color-border-default)]">
                                <th
                                    className="text-left py-1.5 px-1 font-medium cursor-pointer hover:text-[var(--color-text-primary)]"
                                    onClick={() => handleSort('symbol')}
                                >
                                    <span className="flex items-center gap-0.5">
                                        Symbol <SortIcon field="symbol" />
                                    </span>
                                </th>
                                <th className="text-right py-1.5 px-1 font-medium">Qty</th>
                                <th
                                    className="text-right py-1.5 px-1 font-medium cursor-pointer hover:text-[var(--color-text-primary)]"
                                    onClick={() => handleSort('value')}
                                >
                                    <span className="flex items-center justify-end gap-0.5">
                                        Value <SortIcon field="value" />
                                    </span>
                                </th>
                                <th
                                    className="text-right py-1.5 px-1 font-medium cursor-pointer hover:text-[var(--color-text-primary)]"
                                    onClick={() => handleSort('pl')}
                                >
                                    <span className="flex items-center justify-end gap-0.5">
                                        P/L <SortIcon field="pl" />
                                    </span>
                                </th>
                                <th className="w-12"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {sortedPositions.map(pos => {
                                if (editingId === pos.id) {
                                    return (
                                        <EditPositionRow
                                            key={pos.id}
                                            position={pos}
                                            onSave={updates => {
                                                if (!updatePosition(pos.id, updates)) return false;
                                                setEditingId(null);
                                                return true;
                                            }}
                                            onCancel={() => setEditingId(null)}
                                        />
                                    );
                                }

                                // This cell prints the percentage, so its arrow and
                                // ink follow the percentage — not the VND total.
                                const rowDirection = directionOf(pos.unrealizedPLPct, 1);
                                return (
                                    <tr
                                        key={pos.id}
                                        className="border-b border-[var(--color-border-default)] hover:bg-[var(--color-bg-tertiary)] group"
                                    >
                                        <td className="py-1.5 px-1">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setLinkedSymbol(pos.symbol);
                                                    onSymbolClick?.(pos.symbol);
                                                }}
                                                className="text-left text-[var(--color-text-primary)] font-medium hover:text-[var(--color-accent-primary)]"
                                            >
                                                <div className="flex items-center gap-1">
                                                    {pos.symbol}
                                                    {pos.isLoading && (
                                                        <div className="w-2 h-2 border border-[var(--color-border-default)] border-t-transparent rounded-full animate-spin" />
                                                    )}
                                                </div>
                                                {pos.dayChangePct !== null && Number.isFinite(pos.dayChangePct) && (() => {
                                                    // Direction follows the displayed precision; zero stays unsigned and neutral.
                                                    const shown = Number(Math.abs(pos.dayChangePct).toFixed(1));
                                                    const direction = shown === 0 ? 0 : Math.sign(pos.dayChangePct);
                                                    return (
                                                        <div className={`text-[10px] ${direction === 0 ? 'text-[var(--color-text-muted)]' : direction > 0 ? 'text-[var(--color-positive)]' : 'text-[var(--color-negative)]'}`}>
                                                            {direction === 0 ? '' : direction > 0 ? '↑ ' : '↓ '}
                                                            {Math.abs(pos.dayChangePct).toFixed(1)}%
                                                        </div>
                                                    );
                                                })()}
                                            </button>
                                        </td>
                                        <td className="py-1.5 px-1 text-right text-[var(--color-text-secondary)]">
                                            {pos.quantity.toLocaleString()}
                                        </td>
                                        <td className="py-1.5 px-1 text-right text-[var(--color-text-primary)] font-mono">
                                            {pos.marketValue === null ? <span className="text-[var(--color-text-muted)]">Unavailable</span> : formatVND(pos.marketValue)}
                                        </td>
                                        <td className={`py-1.5 px-1 text-right font-mono ${inkFor(rowDirection)}`}>
                                            {pos.unrealizedPLPct === null ? 'Unavailable' : (
                                                <div className="flex items-center justify-end gap-0.5">
                                                    {rowDirection === 'up' ? <TrendingUp size={10} /> : rowDirection === 'down' ? <TrendingDown size={10} /> : null}
                                                    {formatPercent(pos.unrealizedPLPct, { input: 'percent', decimals: 1, signed: true })}
                                                </div>
                                            )}
                                        </td>
                                        <td className="py-1.5 px-1">
                                            <div className="flex items-center justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button
                                                    onClick={() => setEditingId(pos.id)}
                                                    className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] rounded"
                                                    title="Edit"
                                                >
                                                    <Edit2 size={10} />
                                                </button>
                                                <button
                                                    onClick={() => removePosition(pos.id)}
                                                    className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-negative)] rounded"
                                                    title="Remove"
                                                >
                                                    <X size={10} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
