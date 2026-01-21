// Similar Stocks Widget - Find stocks similar to current symbol

'use client';

import { useState } from 'react';
import { Users, RefreshCw, TrendingUp, TrendingDown } from 'lucide-react';
import { useProfile, useScreenerData } from '@/lib/queries';

interface SimilarStocksWidgetProps {
    symbol: string;
    isEditing?: boolean;
    onRemove?: () => void;
    onSymbolClick?: (symbol: string) => void;
}

// Mock similar stocks mapping
const SIMILAR_STOCKS: Record<string, string[]> = {
    VNM: ['MSN', 'SAB', 'QNS', 'MCH'],
    FPT: ['CMG', 'FTS', 'ELC', 'VGI'],
    VIC: ['VHM', 'NVL', 'PDR', 'KDH'],
    VHM: ['VIC', 'NVL', 'PDR', 'DXG'],
    HPG: ['HSG', 'NKG', 'TLH', 'POM'],
    default: ['VNM', 'FPT', 'VIC', 'VHM'],
};

function SimilarStockRow({ symbol, onClick }: { symbol: string; onClick?: () => void }) {
    const { data: profileData, isLoading: profileLoading } = useProfile(symbol);
    const { data: screenerData, isLoading: screenerLoading } = useScreenerData({ symbol, enabled: !!symbol });

    const profile = profileData?.data;
    const stock = screenerData?.data?.find(s => s.ticker === symbol) || screenerData?.data?.[0];
    const isLoading = profileLoading || screenerLoading;

    return (
        <div
            onClick={onClick}
            className="flex items-center justify-between p-2 rounded bg-gray-800/20 hover:bg-gray-800/40 cursor-pointer"
        >
            <div>
                <div className="text-sm font-medium text-white">{symbol}</div>
                <div className="text-[10px] text-gray-500 truncate max-w-[120px]">
                    {isLoading ? '...' : profile?.company_name || profile?.short_name || stock?.company_name || '-'}
                </div>
            </div>
            <div className="text-right">
                {isLoading ? (
                    <span className="text-gray-500 text-xs">...</span>
                ) : (
                    <>
                        <div className="text-xs text-gray-400">
                            P/E: {stock?.pe?.toFixed(1) || '-'}
                        </div>
                        <div className="text-xs text-gray-400">
                            MCap: {stock?.market_cap ? `${(stock.market_cap / 1e12).toFixed(1)}T` : '-'}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

export function SimilarStocksWidget({ symbol, isEditing, onRemove, onSymbolClick }: SimilarStocksWidgetProps) {
    const upperSymbol = symbol?.toUpperCase() || '';
    const similarSymbols = SIMILAR_STOCKS[upperSymbol] || SIMILAR_STOCKS.default;

    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-1 py-1 mb-2">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Users size={12} className="text-purple-400" />
                    <span>Similar to {upperSymbol || 'N/A'}</span>
                </div>
            </div>

            {/* Similar Stocks List */}
            <div className="flex-1 overflow-auto space-y-1">
                {similarSymbols.map((sym) => (
                    <SimilarStockRow
                        key={sym}
                        symbol={sym}
                        onClick={() => onSymbolClick?.(sym)}
                    />
                ))}
            </div>
        </div>
    );
}
