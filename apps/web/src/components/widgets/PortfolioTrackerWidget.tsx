// Portfolio Tracker Widget - Full-featured holdings tracker with P&L

'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
    Briefcase, Plus, X, Edit2, Check, Download, RefreshCw,
    TrendingUp, TrendingDown, PieChart, ChevronDown, ChevronUp
} from 'lucide-react';
import { usePortfolio, type Position } from '@/lib/hooks/usePortfolio';
import { usePortfolioPrices } from '@/lib/hooks/usePortfolioPrices';
import { formatVND, formatPercent } from '@/lib/formatters';

// ============================================================================
// Types
// ============================================================================

interface PortfolioTrackerWidgetProps {
    isEditing?: boolean;
    onRemove?: () => void;
    onSymbolClick?: (symbol: string) => void;
}

interface PositionWithPL extends Position {
    currentPrice: number | null;
    marketValue: number;
    costBasis: number;
    unrealizedPL: number;
    unrealizedPLPct: number;
    dayChange: number | null;
    dayChangePct: number | null;
    isLoading: boolean;
}

type ViewMode = 'positions' | 'allocation';

// ============================================================================
// Sector mapping (simplified - in production, fetch from API)
// ============================================================================

const SECTOR_MAP: Record<string, string> = {
    VNM: 'Consumer Goods',
    FPT: 'Technology',
    VIC: 'Real Estate',
    VHM: 'Real Estate',
    HPG: 'Materials',
    MSN: 'Consumer Goods',
    TCB: 'Financials',
    VCB: 'Financials',
    MBB: 'Financials',
    ACB: 'Financials',
    SSI: 'Financials',
    VND: 'Financials',
    PNJ: 'Consumer Goods',
    MWG: 'Consumer Goods',
    REE: 'Industrials',
    GAS: 'Energy',
    PLX: 'Energy',
    POW: 'Utilities',
    VRE: 'Real Estate',
    NVL: 'Real Estate',
};

const SECTOR_COLORS: Record<string, string> = {
    'Technology': '#3B82F6',
    'Financials': '#10B981',
    'Real Estate': '#F59E0B',
    'Consumer Goods': '#EC4899',
    'Materials': '#8B5CF6',
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
}: {
    positions: PositionWithPL[];
}) {
    // Group by sector
    const sectorData = useMemo(() => {
        const sectors: Record<string, number> = {};
        let total = 0;

        positions.forEach(p => {
            if (p.marketValue <= 0) return;
            const sector = SECTOR_MAP[p.symbol] || 'Other';
            sectors[sector] = (sectors[sector] || 0) + p.marketValue;
            total += p.marketValue;
        });

        return Object.entries(sectors)
            .map(([name, value]) => ({
                name,
                value,
                percentage: total > 0 ? (value / total) * 100 : 0,
                color: SECTOR_COLORS[name] || SECTOR_COLORS['Other'],
            }))
            .sort((a, b) => b.value - a.value);
    }, [positions]);

    if (sectorData.length === 0) {
        return (
            <div className="flex items-center justify-center h-32 text-zinc-500 text-xs">
                No positions to display
            </div>
        );
    }

    // Simple horizontal bar chart
    return (
        <div className="space-y-2 p-2">
            {sectorData.map(sector => (
                <div key={sector.name} className="space-y-1">
                    <div className="flex justify-between text-xs">
                        <span className="text-zinc-300">{sector.name}</span>
                        <span className="text-zinc-400">
                            {sector.percentage.toFixed(1)}% • {formatVND(sector.value)}
                        </span>
                    </div>
                    <div className="h-2 bg-zinc-700 rounded-full overflow-hidden">
                        <div
                            className="h-full rounded-full transition-all duration-300"
                            style={{
                                width: `${sector.percentage}%`,
                                backgroundColor: sector.color,
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
}: PortfolioTrackerWidgetProps) {
    const {
        positions,
        symbols,
        addPosition,
        updatePosition,
        removePosition,
        recordValueSnapshot,
    } = usePortfolio();

    const { prices, isLoading: pricesLoading, refetch } = usePortfolioPrices(symbols);

    const [showAddForm, setShowAddForm] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<ViewMode>('positions');
    const [sortField, setSortField] = useState<'symbol' | 'value' | 'pl'>('value');
    const [sortAsc, setSortAsc] = useState(false);

    // Enrich positions with current prices and P/L
    const enrichedPositions: PositionWithPL[] = useMemo(() => {
        return positions.map(pos => {
            const priceData = prices.get(pos.symbol);
            const currentPrice = priceData?.currentPrice ?? null;
            const costBasis = pos.quantity * pos.avgCost;
            const marketValue = currentPrice !== null ? pos.quantity * currentPrice : costBasis;
            const unrealizedPL = currentPrice !== null ? marketValue - costBasis : 0;
            const unrealizedPLPct = costBasis > 0 ? (unrealizedPL / costBasis) * 100 : 0;

            return {
                ...pos,
                currentPrice,
                marketValue,
                costBasis,
                unrealizedPL,
                unrealizedPLPct,
                dayChange: priceData?.change ?? null,
                dayChangePct: priceData?.changePct ?? null,
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
                    cmp = a.marketValue - b.marketValue;
                    break;
                case 'pl':
                    cmp = a.unrealizedPLPct - b.unrealizedPLPct;
                    break;
            }
            return sortAsc ? cmp : -cmp;
        });
        return sorted;
    }, [enrichedPositions, sortField, sortAsc]);

    // Portfolio totals
    const totals = useMemo(() => {
        const totalValue = enrichedPositions.reduce((sum, p) => sum + p.marketValue, 0);
        const totalCost = enrichedPositions.reduce((sum, p) => sum + p.costBasis, 0);
        const totalPL = totalValue - totalCost;
        const totalPLPct = totalCost > 0 ? (totalPL / totalCost) * 100 : 0;
        const todayChange = enrichedPositions.reduce((sum, p) => {
            if (p.dayChange === null || p.currentPrice === null) return sum;
            return sum + (p.dayChange * p.quantity);
        }, 0);

        return { totalValue, totalCost, totalPL, totalPLPct, todayChange };
    }, [enrichedPositions]);

    // Record value snapshot when prices update
    useEffect(() => {
        if (!pricesLoading && positions.length > 0 && totals.totalValue > 0) {
            recordValueSnapshot(totals.totalValue, totals.totalCost);
        }
    }, [pricesLoading, positions.length, totals.totalValue, totals.totalCost, recordValueSnapshot]);

    // Export to CSV
    const exportToCSV = useCallback(() => {
        if (enrichedPositions.length === 0) return;

        const headers = ['Symbol', 'Quantity', 'Avg Cost', 'Current Price', 'Market Value', 'Cost Basis', 'P/L', 'P/L %', 'Purchase Date', 'Notes'];
        const rows = enrichedPositions.map(p => [
            p.symbol,
            p.quantity,
            p.avgCost,
            p.currentPrice ?? 'N/A',
            p.marketValue,
            p.costBasis,
            p.unrealizedPL,
            p.unrealizedPLPct.toFixed(2) + '%',
            p.purchaseDate,
            p.notes || '',
        ]);

        // Add totals row
        rows.push([]);
        rows.push(['TOTAL', '', '', '', totals.totalValue, totals.totalCost, totals.totalPL, totals.totalPLPct.toFixed(2) + '%', '', '']);

        const csvContent = [headers, ...rows]
            .map(row => row.map(cell => `"${cell}"`).join(','))
            .join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `portfolio_${new Date().toISOString().split('T')[0]}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    }, [enrichedPositions, totals]);

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

    const isProfit = totals.totalPL >= 0;

    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-2 py-1.5 border-b border-zinc-700">
                <div className="flex items-center gap-2">
                    <Briefcase size={14} className="text-purple-400" />
                    <div className="text-xs">
                        <span className="text-zinc-400">Value: </span>
                        <span className="text-white font-medium">
                            {formatVND(totals.totalValue)}
                        </span>
                        <span className={`ml-2 ${isProfit ? 'text-green-400' : 'text-red-400'}`}>
                            {formatPercent(totals.totalPLPct / 100)}
                        </span>
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => refetch()}
                        className="p-1 text-zinc-500 hover:text-white hover:bg-zinc-700 rounded transition-colors"
                        title="Refresh prices"
                    >
                        <RefreshCw size={12} className={pricesLoading ? 'animate-spin' : ''} />
                    </button>
                    <button
                        onClick={exportToCSV}
                        disabled={positions.length === 0}
                        className="p-1 text-zinc-500 hover:text-white hover:bg-zinc-700 rounded transition-colors disabled:opacity-50"
                        title="Export to CSV"
                    >
                        <Download size={12} />
                    </button>
                    <button
                        onClick={() => setViewMode(viewMode === 'positions' ? 'allocation' : 'positions')}
                        className={`p-1 rounded transition-colors ${
                            viewMode === 'allocation' 
                                ? 'text-purple-400 bg-purple-400/10' 
                                : 'text-zinc-500 hover:text-white hover:bg-zinc-700'
                        }`}
                        title="Sector allocation"
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

            {/* Summary Stats */}
            <div className="grid grid-cols-3 gap-2 px-2 py-1.5 border-b border-zinc-800 text-xs">
                <div>
                    <div className="text-zinc-500">Cost Basis</div>
                    <div className="text-white font-mono">{formatVND(totals.totalCost)}</div>
                </div>
                <div>
                    <div className="text-zinc-500">Total P/L</div>
                    <div className={`font-mono ${isProfit ? 'text-green-400' : 'text-red-400'}`}>
                        {isProfit ? '+' : ''}{formatVND(totals.totalPL)}
                    </div>
                </div>
                <div>
                    <div className="text-zinc-500">Today</div>
                    <div className={`font-mono ${totals.todayChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {totals.todayChange >= 0 ? '+' : ''}{formatVND(totals.todayChange)}
                    </div>
                </div>
            </div>

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
                    <AllocationChart positions={enrichedPositions} />
                ) : positions.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-32 text-zinc-500">
                        <Briefcase size={24} className="mb-2 opacity-30" />
                        <p className="text-xs">Add holdings to track</p>
                    </div>
                ) : (
                    <table className="w-full text-xs">
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

                                const profit = pos.unrealizedPL >= 0;
                                return (
                                    <tr
                                        key={pos.id}
                                        className="border-b border-zinc-800/30 hover:bg-zinc-800/20 group"
                                    >
                                        <td
                                            className="py-1.5 px-1 text-white font-medium cursor-pointer hover:text-blue-400"
                                            onClick={() => onSymbolClick?.(pos.symbol)}
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
                                        </td>
                                        <td className="py-1.5 px-1 text-right text-zinc-400">
                                            {pos.quantity.toLocaleString()}
                                        </td>
                                        <td className="py-1.5 px-1 text-right text-white font-mono">
                                            {formatVND(pos.marketValue)}
                                        </td>
                                        <td className={`py-1.5 px-1 text-right font-mono ${profit ? 'text-green-400' : 'text-red-400'}`}>
                                            <div className="flex items-center justify-end gap-0.5">
                                                {profit ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                                                {formatPercent(pos.unrealizedPLPct / 100)}
                                            </div>
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
