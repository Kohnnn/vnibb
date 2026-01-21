'use client';

import { useState, useCallback, useMemo, useRef, useEffect, memo } from 'react';
import { useQuery, useQueries } from '@tanstack/react-query';
import {
    Plus, X, TrendingUp, TrendingDown, Minus, RefreshCw, Star,
    Upload, Trash2, GripVertical, AlertCircle, Check
} from 'lucide-react';
import { useLocalStorage } from '@/lib/hooks/useLocalStorage';
import { getQuote, getSymbols } from '@/lib/api';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { useWebSocket } from '@/lib/hooks/useWebSocket';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'vnibb-watchlist-v1';
const SORT_STORAGE_KEY = 'vnibb-watchlist-sort-v1';

interface WatchlistItem {
    symbol: string;
    name: string;
    price: number;
    change: number;
    changePercent: number;
    volume?: number;
    isLoading?: boolean;
    error?: string;
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
    isEditing?: boolean;
}

function WatchlistWidgetComponent({ id, isEditing, onRemove }: WatchlistWidgetProps & { onRemove?: () => void }) {
    const [symbols, setSymbols, clearSymbols] = useLocalStorage<string[]>(STORAGE_KEY, []);
    const [sortConfig, setSortConfig] = useLocalStorage<SortConfig>(SORT_STORAGE_KEY, {
        field: 'symbol',
        order: 'asc'
    });

    const [newSymbol, setNewSymbol] = useState('');
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

    const { prices: livePrices, isConnected } = useWebSocket({ symbols });

    const watchlist = useMemo<WatchlistItem[]>(() => {
        return symbols.map((sym) => {
            const quoteData = livePrices.get(sym);
            const name = symbolNameMap.get(sym) || 'Unknown';

            return {
                symbol: sym,
                name: name,
                price: quoteData?.price ?? 0,
                change: quoteData?.change ?? 0,
                changePercent: quoteData?.change_pct ?? 0,
                volume: quoteData?.volume ?? undefined,
                isLoading: !quoteData && symbols.length > 0,
            };
        });
    }, [symbols, livePrices, symbolNameMap]);

    const sortedWatchlist = useMemo(() => {
        const sorted = [...watchlist];
        sorted.sort((a, b) => {
            let comparison = 0;
            switch (sortConfig.field) {
                case 'symbol':
                    comparison = a.symbol.localeCompare(b.symbol);
                    break;
                case 'price':
                    comparison = a.price - b.price;
                    break;
                case 'changePercent':
                    comparison = a.changePercent - b.changePercent;
                    break;
                case 'volume':
                    comparison = (a.volume ?? 0) - (b.volume ?? 0);
                    break;
            }
            return sortConfig.order === 'asc' ? comparison : -comparison;
        });
        return sorted;
    }, [watchlist, sortConfig]);

    const handleAddSymbol = useCallback(() => {
        if (!newSymbol.trim()) return;
        const symbolUpper = newSymbol.toUpperCase().trim();
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
        clearSymbols();
        setShowClearConfirm(false);
    }, [clearSymbols]);

    const handleSort = useCallback((field: SortField) => {
        setSortConfig(prev => ({
            field,
            order: prev.field === field && prev.order === 'asc' ? 'desc' : 'asc'
        }));
    }, [setSortConfig]);

    const formatPrice = (price: number) => new Intl.NumberFormat('vi-VN').format(price);
    const formatChange = (change: number, percent: number) => {
        const sign = change >= 0 ? '+' : '';
        return `${sign}${percent.toFixed(2)}%`;
    };
    const getChangeColor = (change: number) => {
        if (change > 0) return 'text-green-400';
        if (change < 0) return 'text-red-400';
        return 'text-yellow-400';
    };
    const getChangeIcon = (change: number) => {
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
            isLoading={!isConnected && symbols.length > 0}
            noPadding
            widgetId={id}
        >
            <div className="h-full flex flex-col bg-[#0a0a0a]">
                <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
                    <div className="flex items-center gap-2">
                        <Star size={14} className="text-yellow-400" />
                        <span className="text-xs text-gray-500 font-bold uppercase tracking-tighter">{symbols.length} symbols</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <button onClick={() => setShowAddInput(!showAddInput)} className="p-1 text-gray-500 hover:text-blue-400 transition-colors">
                            <Plus size={14} />
                        </button>
                        {symbols.length > 0 && (
                            <button onClick={() => setShowClearConfirm(true)} className="p-1 text-gray-500 hover:text-red-400 transition-colors">
                                <Trash2 size={14} />
                            </button>
                        )}
                    </div>
                </div>

                {showClearConfirm && (
                    <div className="px-3 py-2 border-b border-red-900/20 bg-red-900/10 text-left">
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] text-red-400 font-bold uppercase">Clear watchlist?</span>
                            <div className="flex gap-2">
                                <button onClick={handleClearAll} className="bg-red-600 text-white text-[10px] px-2 py-0.5 rounded font-bold uppercase">Clear</button>
                                <button onClick={() => setShowClearConfirm(false)} className="text-gray-400 text-[10px] font-bold uppercase">Cancel</button>
                            </div>
                        </div>
                    </div>
                )}

                {showAddInput && (
                    <div className="px-3 py-2 border-b border-gray-800 bg-gray-900/20">
                        <div className="flex gap-1">
                            <input
                                type="text"
                                value={newSymbol}
                                onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
                                onKeyDown={(e) => e.key === 'Enter' && handleAddSymbol()}
                                className="flex-1 bg-black border border-gray-800 rounded px-2 py-1 text-xs text-white uppercase font-bold focus:border-blue-500 outline-none"
                                placeholder="SYMBOL"
                                autoFocus
                            />
                            <button onClick={handleAddSymbol} className="bg-blue-600 text-white px-2 py-1 rounded text-[10px] font-black uppercase tracking-tighter">Add</button>
                        </div>
                    </div>
                )}

                <div className="flex-1 overflow-y-auto scrollbar-hide">
                    <table className="w-full text-[11px] text-left border-collapse">
                        <thead className="sticky top-0 bg-[#0a0a0a] text-gray-500 z-10">
                            <tr className="border-b border-gray-800">
                                <th className="px-3 py-2 font-black uppercase tracking-tighter cursor-pointer hover:text-white transition-colors" onClick={() => handleSort('symbol')}>
                                    Symbol {getSortIcon('symbol')}
                                </th>
                                <th className="text-right px-2 py-2 font-black uppercase tracking-tighter cursor-pointer hover:text-white transition-colors" onClick={() => handleSort('price')}>
                                    Price {getSortIcon('price')}
                                </th>
                                <th className="text-right px-3 py-2 font-black uppercase tracking-tighter cursor-pointer hover:text-white transition-colors" onClick={() => handleSort('changePercent')}>
                                    Chg% {getSortIcon('changePercent')}
                                </th>
                            </tr>
                        </thead>
                        <tbody className="text-left">
                            {sortedWatchlist.map((item) => (
                                <tr key={item.symbol} className="border-b border-gray-800/50 hover:bg-white/5 transition-colors cursor-pointer group">
                                    <td className="px-3 py-2">
                                        <div className="flex items-center gap-2">
                                            {getChangeIcon(item.change)}
                                            <span className="font-black text-blue-400 group-hover:text-blue-300 transition-colors">{item.symbol}</span>
                                        </div>
                                    </td>
                                    <td className="text-right px-2 py-2 font-mono text-white">
                                        {formatPrice(item.price)}
                                    </td>
                                    <td className={`text-right px-3 py-2 font-mono ${getChangeColor(item.change)}`}>
                                        {formatChange(item.change, item.changePercent)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {symbols.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-20 text-gray-600 opacity-20 uppercase font-black tracking-widest gap-2">
                            <Star size={48} strokeWidth={1} />
                            <p className="text-xs">Watchlist Empty</p>
                        </div>
                    )}
                </div>
            </div>
        </WidgetContainer>
    );
}

export const WatchlistWidget = memo(WatchlistWidgetComponent);
export default WatchlistWidget;
