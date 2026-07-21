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
import { formatVND, formatPercent } from '@/lib/formatters';
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
    isLoading: boolean;
}

type ViewMode = 'positions' | 'allocation';

const SECTOR_COLORS: Record<string, string> = {
    'Technology': '#3B82F6',
    'Financials': '#10B981',
    'Real Estate': '#F59E0B',
    'Consumer Goods': '#EC4899',
    'Materials': '#06b6d4',
    'Energy': '#EF4444',
    'Industrials': '#06B6D4',
    'Utilities': '#F97316',
    'Healthcare': '#14B8A6',
    'Other': '#6B7280',
};

// ============================================================================
// Sub-components
// ============================================================================

function AddPositionForm({
    onAdd,
    onCancel,
}: {
    onAdd: (pos: Omit<Position, 'id'>) => void;
    onCancel: () => void;
}) {
    const [symbol, setSymbol] = useState('');
    const [quantity, setQuantity] = useState('');
    const [avgCost, setAvgCost] = useState('');
    const [purchaseDate, setPurchaseDate] = useState(
        new Date().toISOString().split('T')[0]
    );
    const [notes, setNotes] = useState('');

    const handleSubmit = () => {
        if (!symbol.trim() || !quantity || !avgCost) return;

        onAdd({
            symbol: symbol.trim().toUpperCase(),
            quantity: parseInt(quantity, 10),
            avgCost: parseFloat(avgCost),
            purchaseDate,
            notes: notes.trim() || undefined,
        });

        // Reset form
        setSymbol('');
        setQuantity('');
        setAvgCost('');
        setPurchaseDate(new Date().toISOString().split('T')[0]);
        setNotes('');
    };

    return (
        <div className="p-2 bg-zinc-800/50 rounded-lg space-y-2">
            <div className="grid grid-cols-4 gap-1">
                <input
                    type="text"
                    placeholder="Symbol"
                    value={symbol}
                    onChange={e => setSymbol(e.target.value.toUpperCase())}
                    className="bg-zinc-700 text-white text-xs px-2 py-1.5 rounded focus:ring-1 focus:ring-blue-500 outline-none"
                    maxLength={10}
                />
                <input
                    type="number"
                    placeholder="Qty"
                    value={quantity}
                    onChange={e => setQuantity(e.target.value)}
                    className="bg-zinc-700 text-white text-xs px-2 py-1.5 rounded focus:ring-1 focus:ring-blue-500 outline-none"
                    min={1}
                />
                <input
                    type="number"
                    placeholder="Avg Cost"
                    value={avgCost}
                    onChange={e => setAvgCost(e.target.value)}
                    className="bg-zinc-700 text-white text-xs px-2 py-1.5 rounded focus:ring-1 focus:ring-blue-500 outline-none"
                    min={0}
                    step={100}
                />
                <input
                    type="date"
                    value={purchaseDate}
                    onChange={e => setPurchaseDate(e.target.value)}
                    className="bg-zinc-700 text-white text-xs px-2 py-1.5 rounded focus:ring-1 focus:ring-blue-500 outline-none"
                />
            </div>
            <div className="flex gap-1">
                <input
                    type="text"
                    placeholder="Notes (optional)"
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    className="flex-1 bg-zinc-700 text-white text-xs px-2 py-1.5 rounded focus:ring-1 focus:ring-blue-500 outline-none"
                />
                <button
                    onClick={handleSubmit}
                    disabled={!symbol.trim() || !quantity || !avgCost}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-600 disabled:cursor-not-allowed text-white text-xs rounded transition-colors"
                >
                    Add
                </button>
                <button
                    onClick={onCancel}
                    className="px-2 py-1.5 bg-zinc-600 hover:bg-zinc-500 text-white text-xs rounded transition-colors"
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
    onSave: (updates: Partial<Omit<Position, 'id'>>) => void;
    onCancel: () => void;
}) {
    const [quantity, setQuantity] = useState(position.quantity.toString());
    const [avgCost, setAvgCost] = useState(position.avgCost.toString());

    return (
        <tr className="bg-zinc-800/50">
            <td className="py-1.5 px-1 text-white font-medium">{position.symbol}</td>
            <td className="py-1.5 px-1">
                <input
                    type="number"
                    value={quantity}
                    onChange={e => setQuantity(e.target.value)}
                    className="w-16 bg-zinc-700 text-white text-xs px-1 py-0.5 rounded"
                    min={1}
                />
            </td>
            <td className="py-1.5 px-1">
                <input
                    type="number"
                    value={avgCost}
                    onChange={e => setAvgCost(e.target.value)}
                    className="w-20 bg-zinc-700 text-white text-xs px-1 py-0.5 rounded"
                    min={0}
                    step={100}
                />
            </td>
            <td className="py-1.5 px-1 text-right" colSpan={2}>
                <button
                    onClick={() => onSave({
                        quantity: parseInt(quantity, 10),
                        avgCost: parseFloat(avgCost),
                    })}
                    className="p-1 text-green-400 hover:bg-zinc-700 rounded mr-1"
                >
                    <Check size={12} />
                </button>
                <button
                    onClick={onCancel}
                    className="p-1 text-zinc-400 hover:bg-zinc-700 rounded"
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
            <div className="flex h-32 flex-col items-center justify-center gap-1 text-center text-xs text-zinc-500">
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
                <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-2">
                    <div className="text-zinc-500">Largest Holding</div>
                    <div className="mt-0.5 text-white">
                        {concentration.largestHolding?.symbol} · {((concentration.largestHolding?.weight || 0) * 100).toFixed(1)}%
                    </div>
                </div>
                <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-2">
                    <div className="text-zinc-500">Top 3 Holdings</div>
                    <div className="mt-0.5 text-white">{(concentration.topThreeWeight * 100).toFixed(1)}%</div>
                </div>
                <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-2">
                    <div className="text-zinc-500">HHI / Effective</div>
                    <div className="mt-0.5 text-white">
                        {concentration.hhi.toFixed(3)} / {concentration.effectivePositions.toFixed(1)} positions
                    </div>
                </div>
                <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-2">
                    <div className="text-zinc-500">Largest Sector</div>
                    <div className="mt-0.5 text-white">
                        {concentration.largestSector?.name} · {((concentration.largestSector?.weight || 0) * 100).toFixed(1)}%
                    </div>
                </div>
            </div>
            <div className="text-[10px] text-zinc-500">
                Quote coverage: {concentration.quotedPositionCount} / {positions.length}; allocation uses quoted market value only.
            </div>
            <div className="text-[10px] text-zinc-500">
                Sector profiles: {concentration.resolvedSectorPositionCount} / {concentration.positionCount} quoted holdings · {formatVND(concentration.resolvedSectorValue)} / {formatVND(concentration.totalValue)} quoted market value; unresolved {concentration.unresolvedSectorPositionCount} / {formatVND(concentration.unresolvedSectorValue)}.
            </div>
            {concentration.sectors.map(sector => (
                <div key={sector.name} className="space-y-1">
                    <div className="flex justify-between text-xs">
                        <span className="text-zinc-300">{sector.name}</span>
                        <span className="text-zinc-400">
                            {(sector.weight * 100).toFixed(1)}% • {formatVND(sector.value)}
                        </span>
                    </div>
                    <div className="h-2 bg-zinc-700 rounded-full overflow-hidden">
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

    useEffect(() => {
        onDataChange?.(buildWidgetRuntime({
            empty: positions.length === 0,
            apiGroup: '/equity',
            endpoint: '/api/v1/market/quotes/batch',
            sourceLabel: 'Local portfolio',
            lastDataDate: latestQuoteUpdatedAt,
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
    }, [latestQuoteUpdatedAt, onDataChange, positions.length, sectors.size, symbols.length, totals.marketValue, totals.quotedMarketValue, totals.unpricedCostBasis, totals.unrealizedPL, totals.quotedPositionCount, totals.positionCount]);

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
        exportToCSV(rows, `portfolio_${new Date().toISOString().split('T')[0]}`, {
            widgetType: 'portfolio_tracker',
            widgetTitle: 'Portfolio Tracker',
            sourceLabel: 'Browser-local portfolio',
            apiGroup: '/equity',
            endpoint: '/api/v1/market/quotes/batch',
            localOnly: true,
        });
    }, [enrichedPositions.length, exportPayload, valueHistory]);

    const handleExportJSON = useCallback(() => {
        exportToJSON(exportPayload, `portfolio_${new Date().toISOString().split('T')[0]}`, {
            widgetType: 'portfolio_tracker',
            widgetTitle: 'Portfolio Tracker',
            sourceLabel: 'Browser-local portfolio',
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

    const isProfit = totals.unrealizedPL !== null && totals.unrealizedPL >= 0;

    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-2 py-1.5 border-b border-zinc-700">
                <div className="flex items-center gap-2">
                    <Briefcase size={14} className="text-cyan-400" />
                    <div className="text-xs">
                        <span className="text-zinc-400">{totals.marketValue === null ? 'Market value:' : 'Quoted market value:'} </span>
                        <span className="text-white font-medium">
                            {totals.marketValue === null ? 'Unavailable' : formatVND(totals.marketValue)}
                        </span>
                        {totals.unrealizedPLPct !== null && (
                            <span className={`ml-2 ${isProfit ? 'text-green-400' : 'text-red-400'}`}>
                                {formatPercent(totals.unrealizedPLPct / 100)}
                            </span>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <WidgetMeta
                        updatedAt={latestQuoteUpdatedAt}
                        isFetching={pricesLoading}
                        note="Local portfolio"
                        align="right"
                    />
                    <button
                        onClick={() => refetch()}
                        className="p-1 text-zinc-500 hover:text-white hover:bg-zinc-700 rounded transition-colors"
                        title="Refresh prices"
                    >
                        <RefreshCw size={12} className={pricesLoading ? 'animate-spin' : ''} />
                    </button>
                    <button
                        onClick={handleExportCSV}
                        disabled={positions.length === 0}
                        className="p-1 text-zinc-500 hover:text-white hover:bg-zinc-700 rounded transition-colors disabled:opacity-50"
                        title="Export to CSV"
                    >
                        <Download size={12} />
                    </button>
                    <button
                        onClick={handleExportJSON}
                        disabled={positions.length === 0}
                        className="p-1 text-zinc-500 hover:text-white hover:bg-zinc-700 rounded transition-colors disabled:opacity-50"
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
                                ? 'text-cyan-400 bg-cyan-400/10' 
                                : 'text-zinc-500 hover:text-white hover:bg-zinc-700'
                        }`}
                        title="Sector allocation"
                        aria-label="Toggle sector allocation"
                    >
                        <PieChart size={12} />
                    </button>
                    <button
                        onClick={() => setShowAddForm(!showAddForm)}
                        className="p-1 text-zinc-500 hover:text-white hover:bg-zinc-700 rounded transition-colors"
                        title="Add position"
                    >
                        <Plus size={12} />
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-2 px-2 py-1.5 border-b border-zinc-800 text-xs sm:grid-cols-4">
                <div>
                    <div className="text-zinc-500">Quoted market value</div>
                    <div className="text-white font-mono">{formatVND(totals.quotedMarketValue)}</div>
                </div>
                <div>
                    <div className="text-zinc-500">Unpriced cost basis</div>
                    <div className="text-white font-mono">{formatVND(totals.unpricedCostBasis)}</div>
                </div>
                <div>
                    <div className="text-zinc-500">Quote coverage</div>
                    <div className="text-white font-mono">{totals.quotedPositionCount} / {totals.positionCount}</div>
                </div>
                <div>
                    <div className="text-zinc-500">Unrealized P/L</div>
                    <div className={`font-mono ${totals.unrealizedPL === null ? 'text-zinc-500' : isProfit ? 'text-green-400' : 'text-red-400'}`}>
                        {totals.unrealizedPL === null ? 'Unavailable' : `${isProfit ? '+' : ''}${formatVND(totals.unrealizedPL)}`}
                    </div>
                </div>
            </div>
            {totals.unpricedPositionCount > 0 && (
                <div className="border-b border-amber-500/20 bg-amber-500/5 px-2 py-1 text-[10px] text-amber-200">
                    Aggregate market value and unrealized P/L are unavailable: {totals.unpricedPositionCount} holding{totals.unpricedPositionCount === 1 ? '' : 's'} lack a valid quote. Unpriced cost basis is not market value.
                </div>
            )}

            {/* Add Form */}
            {showAddForm && (
                <div className="px-2 py-2 border-b border-zinc-800">
                    <AddPositionForm
                        onAdd={pos => {
                            addPosition(pos);
                            setShowAddForm(false);
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
                        <thead className="text-zinc-500 sticky top-0 bg-zinc-900">
                            <tr className="border-b border-zinc-800">
                                <th
                                    className="text-left py-1.5 px-1 font-medium cursor-pointer hover:text-white"
                                    onClick={() => handleSort('symbol')}
                                >
                                    <span className="flex items-center gap-0.5">
                                        Symbol <SortIcon field="symbol" />
                                    </span>
                                </th>
                                <th className="text-right py-1.5 px-1 font-medium">Qty</th>
                                <th
                                    className="text-right py-1.5 px-1 font-medium cursor-pointer hover:text-white"
                                    onClick={() => handleSort('value')}
                                >
                                    <span className="flex items-center justify-end gap-0.5">
                                        Value <SortIcon field="value" />
                                    </span>
                                </th>
                                <th
                                    className="text-right py-1.5 px-1 font-medium cursor-pointer hover:text-white"
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
                                                updatePosition(pos.id, updates);
                                                setEditingId(null);
                                            }}
                                            onCancel={() => setEditingId(null)}
                                        />
                                    );
                                }

                                const profit = pos.unrealizedPL !== null && pos.unrealizedPL >= 0;
                                return (
                                    <tr
                                        key={pos.id}
                                        className="border-b border-zinc-800/30 hover:bg-zinc-800/20 group"
                                    >
                                        <td className="py-1.5 px-1">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setLinkedSymbol(pos.symbol);
                                                    onSymbolClick?.(pos.symbol);
                                                }}
                                                className="text-left text-white font-medium hover:text-blue-400"
                                            >
                                                <div className="flex items-center gap-1">
                                                    {pos.symbol}
                                                    {pos.isLoading && (
                                                        <div className="w-2 h-2 border border-zinc-500 border-t-transparent rounded-full animate-spin" />
                                                    )}
                                                </div>
                                                {pos.dayChangePct !== null && (
                                                    <div className={`text-[10px] ${pos.dayChangePct >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                                        {pos.dayChangePct >= 0 ? '↑' : '↓'} {Math.abs(pos.dayChangePct).toFixed(1)}%
                                                    </div>
                                                )}
                                            </button>
                                        </td>
                                        <td className="py-1.5 px-1 text-right text-zinc-400">
                                            {pos.quantity.toLocaleString()}
                                        </td>
                                        <td className="py-1.5 px-1 text-right text-white font-mono">
                                            {pos.marketValue === null ? <span className="text-zinc-500">Unavailable</span> : formatVND(pos.marketValue)}
                                        </td>
                                        <td className={`py-1.5 px-1 text-right font-mono ${pos.unrealizedPLPct === null ? 'text-zinc-500' : profit ? 'text-green-400' : 'text-red-400'}`}>
                                            {pos.unrealizedPLPct === null ? 'Unavailable' : (
                                                <div className="flex items-center justify-end gap-0.5">
                                                    {profit ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                                                    {formatPercent(pos.unrealizedPLPct / 100)}
                                                </div>
                                            )}
                                        </td>
                                        <td className="py-1.5 px-1">
                                            <div className="flex items-center justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button
                                                    onClick={() => setEditingId(pos.id)}
                                                    className="p-1 text-zinc-500 hover:text-white rounded"
                                                    title="Edit"
                                                >
                                                    <Edit2 size={10} />
                                                </button>
                                                <button
                                                    onClick={() => removePosition(pos.id)}
                                                    className="p-1 text-zinc-500 hover:text-red-400 rounded"
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
