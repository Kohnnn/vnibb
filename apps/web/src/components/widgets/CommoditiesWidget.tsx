// Commodities Widget - Gold, Oil, and commodity prices

'use client';

import { useState } from 'react';
import { Gem, RefreshCw, TrendingUp, TrendingDown } from 'lucide-react';

interface Commodity {
    name: string;
    symbol: string;
    price: number;
    unit: string;
    change: number;
    changePct: number;
}

interface CommoditiesWidgetProps {
    isEditing?: boolean;
    onRemove?: () => void;
}

// Mock commodities data
const COMMODITIES: Commodity[] = [
    { name: 'Gold', symbol: 'XAU', price: 2045.30, unit: 'USD/oz', change: 12.50, changePct: 0.61 },
    { name: 'Silver', symbol: 'XAG', price: 23.15, unit: 'USD/oz', change: -0.25, changePct: -1.07 },
    { name: 'Crude Oil', symbol: 'WTI', price: 78.45, unit: 'USD/bbl', change: 1.20, changePct: 1.55 },
    { name: 'Brent Oil', symbol: 'BRENT', price: 82.30, unit: 'USD/bbl', change: 0.85, changePct: 1.04 },
    { name: 'Natural Gas', symbol: 'NG', price: 2.85, unit: 'USD/MMBtu', change: -0.08, changePct: -2.73 },
    { name: 'Copper', symbol: 'HG', price: 3.92, unit: 'USD/lb', change: 0.05, changePct: 1.29 },
    { name: 'Platinum', symbol: 'PL', price: 935.50, unit: 'USD/oz', change: -8.20, changePct: -0.87 },
    { name: 'Coffee', symbol: 'KC', price: 185.40, unit: 'USD/lb', change: 2.30, changePct: 1.26 },
];

function getCommodityIcon(symbol: string): string {
    switch (symbol) {
        case 'XAU': return '🥇';
        case 'XAG': return '🥈';
        case 'WTI':
        case 'BRENT': return '🛢️';
        case 'NG': return '🔥';
        case 'HG': return '🔶';
        case 'PL': return '⚪';
        case 'KC': return '☕';
        default: return '📦';
    }
}

export function CommoditiesWidget({ isEditing, onRemove }: CommoditiesWidgetProps) {
    const [isRefreshing, setIsRefreshing] = useState(false);

    const handleRefresh = () => {
        setIsRefreshing(true);
        setTimeout(() => setIsRefreshing(false), 500);
    };

    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-1 py-1 mb-2">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Gem size={12} className="text-yellow-400" />
                    <span>Commodities</span>
                </div>
                <button
                    onClick={handleRefresh}
                    className="p-1 text-gray-500 hover:text-white hover:bg-gray-800 rounded"
                >
                    <RefreshCw size={12} className={isRefreshing ? 'animate-spin' : ''} />
                </button>
            </div>

            {/* Commodities List */}
            <div className="flex-1 overflow-auto space-y-1">
                {COMMODITIES.map((commodity) => {
                    const isUp = commodity.changePct >= 0;
                    return (
                        <div
                            key={commodity.symbol}
                            className="flex items-center justify-between p-2 rounded bg-gray-800/20 hover:bg-gray-800/40"
                        >
                            <div className="flex items-center gap-2">
                                <span className="text-lg">{getCommodityIcon(commodity.symbol)}</span>
                                <div>
                                    <div className="text-sm font-medium text-white">{commodity.name}</div>
                                    <div className="text-[10px] text-gray-500">{commodity.unit}</div>
                                </div>
                            </div>
                            <div className="text-right">
                                <div className="text-sm font-mono text-white">
                                    ${commodity.price.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                </div>
                                <div className={`text-xs flex items-center justify-end gap-0.5 ${isUp ? 'text-green-400' : 'text-red-400'
                                    }`}>
                                    {isUp ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                                    {isUp ? '+' : ''}{commodity.changePct.toFixed(2)}%
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
