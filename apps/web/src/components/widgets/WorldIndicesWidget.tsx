// World Indices Widget - Global market indices

'use client';

import { useState, useEffect } from 'react';
import { Globe, RefreshCw, TrendingUp, TrendingDown } from 'lucide-react';

interface WorldIndexData {
    name: string;
    symbol: string;
    value: number;
    change: number;
    changePct: number;
    region: 'asia' | 'europe' | 'americas';
}

interface WorldIndicesWidgetProps {
    isEditing?: boolean;
    onRemove?: () => void;
}

// Mock global indices data
const WORLD_INDICES: WorldIndexData[] = [
    { name: 'S&P 500', symbol: 'SPX', value: 5234.18, change: 32.45, changePct: 0.62, region: 'americas' },
    { name: 'Dow Jones', symbol: 'DJI', value: 39127.14, change: -45.23, changePct: -0.12, region: 'americas' },
    { name: 'NASDAQ', symbol: 'IXIC', value: 16439.22, change: 125.87, changePct: 0.77, region: 'americas' },
    { name: 'Nikkei 225', symbol: 'N225', value: 38487.90, change: 234.56, changePct: 0.61, region: 'asia' },
    { name: 'Hang Seng', symbol: 'HSI', value: 16589.44, change: -123.45, changePct: -0.74, region: 'asia' },
    { name: 'Shanghai', symbol: 'SSEC', value: 3015.17, change: 12.34, changePct: 0.41, region: 'asia' },
    { name: 'FTSE 100', symbol: 'FTSE', value: 8147.23, change: 45.67, changePct: 0.56, region: 'europe' },
    { name: 'DAX', symbol: 'GDAXI', value: 18089.67, change: -89.12, changePct: -0.49, region: 'europe' },
];

type RegionFilter = 'all' | 'asia' | 'europe' | 'americas';

export function WorldIndicesWidget({ isEditing, onRemove }: WorldIndicesWidgetProps) {
    const [filter, setFilter] = useState<RegionFilter>('all');
    const [isRefreshing, setIsRefreshing] = useState(false);

    const filteredIndices = filter === 'all'
        ? WORLD_INDICES
        : WORLD_INDICES.filter(idx => idx.region === filter);

    const handleRefresh = () => {
        setIsRefreshing(true);
        setTimeout(() => setIsRefreshing(false), 500);
    };

    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-1 py-1 mb-2">
                <div className="flex items-center gap-2">
                    <Globe size={12} className="text-blue-400" />
                    <div className="flex bg-gray-800 rounded text-[10px]">
                        {(['all', 'asia', 'europe', 'americas'] as RegionFilter[]).map(r => (
                            <button
                                key={r}
                                onClick={() => setFilter(r)}
                                className={`px-2 py-0.5 rounded capitalize ${filter === r ? 'bg-blue-600 text-white' : 'text-gray-400'
                                    }`}
                            >
                                {r === 'all' ? 'All' : r.slice(0, 2).toUpperCase()}
                            </button>
                        ))}
                    </div>
                </div>
                <button
                    onClick={handleRefresh}
                    className="p-1 text-gray-500 hover:text-white hover:bg-gray-800 rounded"
                >
                    <RefreshCw size={12} className={isRefreshing ? 'animate-spin' : ''} />
                </button>
            </div>

            {/* Indices List */}
            <div className="flex-1 overflow-auto space-y-1">
                {filteredIndices.map((index) => {
                    const isUp = index.changePct >= 0;
                    return (
                        <div
                            key={index.symbol}
                            className={`p-2 rounded-lg border ${isUp
                                    ? 'bg-green-500/5 border-green-500/20'
                                    : 'bg-red-500/5 border-red-500/20'
                                }`}
                        >
                            <div className="flex items-center justify-between">
                                <div>
                                    <div className="text-xs text-gray-400">{index.name}</div>
                                    <div className={`text-sm font-bold ${isUp ? 'text-green-400' : 'text-red-400'}`}>
                                        {index.value.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                    </div>
                                </div>
                                <div className={`flex items-center gap-1 text-xs ${isUp ? 'text-green-400' : 'text-red-400'}`}>
                                    {isUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                                    <span>{isUp ? '+' : ''}{index.changePct.toFixed(2)}%</span>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
