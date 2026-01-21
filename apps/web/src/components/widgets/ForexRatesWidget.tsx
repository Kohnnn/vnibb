// Forex Rates Widget - Currency exchange rates

'use client';

import { useState } from 'react';
import { DollarSign, RefreshCw, TrendingUp, TrendingDown } from 'lucide-react';

interface ForexPair {
    pair: string;
    rate: number;
    change: number;
    changePct: number;
}

interface ForexRatesWidgetProps {
    isEditing?: boolean;
    onRemove?: () => void;
}

// Mock forex data (VND pairs)
const FOREX_PAIRS: ForexPair[] = [
    { pair: 'USD/VND', rate: 24500, change: 50, changePct: 0.20 },
    { pair: 'EUR/VND', rate: 26850, change: -120, changePct: -0.45 },
    { pair: 'JPY/VND', rate: 164.5, change: 0.8, changePct: 0.49 },
    { pair: 'GBP/VND', rate: 31200, change: 180, changePct: 0.58 },
    { pair: 'CNY/VND', rate: 3420, change: -15, changePct: -0.44 },
    { pair: 'SGD/VND', rate: 18350, change: 45, changePct: 0.25 },
    { pair: 'KRW/VND', rate: 18.2, change: -0.1, changePct: -0.55 },
    { pair: 'THB/VND', rate: 695, change: 3, changePct: 0.43 },
];

export function ForexRatesWidget({ isEditing, onRemove }: ForexRatesWidgetProps) {
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
                    <DollarSign size={12} className="text-green-400" />
                    <span>VND Exchange Rates</span>
                </div>
                <button
                    onClick={handleRefresh}
                    className="p-1 text-gray-500 hover:text-white hover:bg-gray-800 rounded"
                >
                    <RefreshCw size={12} className={isRefreshing ? 'animate-spin' : ''} />
                </button>
            </div>

            {/* Rates List */}
            <div className="flex-1 overflow-auto">
                <table className="w-full text-xs">
                    <thead className="text-gray-500 sticky top-0 bg-gray-900">
                        <tr className="border-b border-gray-800">
                            <th className="text-left py-1.5 px-1 font-medium">Pair</th>
                            <th className="text-right py-1.5 px-1 font-medium">Rate</th>
                            <th className="text-right py-1.5 px-1 font-medium">Change</th>
                        </tr>
                    </thead>
                    <tbody>
                        {FOREX_PAIRS.map((pair) => {
                            const isUp = pair.changePct >= 0;
                            return (
                                <tr key={pair.pair} className="border-b border-gray-800/30 hover:bg-gray-800/20">
                                    <td className="py-1.5 px-1 font-medium text-white">{pair.pair}</td>
                                    <td className="py-1.5 px-1 text-right text-gray-300 font-mono">
                                        {pair.rate.toLocaleString()}
                                    </td>
                                    <td className={`py-1.5 px-1 text-right flex items-center justify-end gap-1 ${isUp ? 'text-green-400' : 'text-red-400'
                                        }`}>
                                        {isUp ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                                        {isUp ? '+' : ''}{pair.changePct.toFixed(2)}%
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
