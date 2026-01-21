// Share Statistics Widget - Market cap, float, volume (OpenBB-style)

'use client';

import { useScreenerData } from '@/lib/queries';
import { formatVND, formatNumber, formatPercent } from '@/lib/formatters';


interface ShareStatisticsWidgetProps {
    symbol: string;
    isEditing?: boolean;
    onRemove?: () => void;
}

interface StatRowProps {
    label: string;
    value: string | number;
}

function StatRow({ label, value }: StatRowProps) {
    return (
        <div className="flex justify-between items-center py-1.5">
            <span className="text-sm text-gray-400">{label}</span>
            <span className="text-sm font-medium text-white">{value}</span>
        </div>
    );
}

export function ShareStatisticsWidget({ symbol, isEditing, onRemove }: ShareStatisticsWidgetProps) {
    const { data, isLoading } = useScreenerData({ symbol, enabled: !!symbol });
    const stock = data?.data?.[0];

    return (
        <>
            {isLoading ? (
                <div className="space-y-2 animate-pulse">
                    {[...Array(8)].map((_, i) => (
                        <div key={i} className="flex justify-between">
                            <div className="h-4 bg-gray-800 rounded w-24" />
                            <div className="h-4 bg-gray-800 rounded w-20" />
                        </div>
                    ))}
                </div>
            ) : !stock ? (
                <div className="text-gray-500 text-center py-8">
                    No data for {symbol}
                </div>
            ) : (
                <div className="space-y-1">
                    {/* Valuation */}
                    <div className="text-xs text-gray-500 uppercase tracking-wider pb-1">
                        Valuation
                    </div>
                    <StatRow label="Market Cap" value={formatVND(stock.market_cap)} />
                    <StatRow label="P/E Ratio" value={stock.pe?.toFixed(2) || '-'} />
                    <StatRow label="P/B Ratio" value={stock.pb?.toFixed(2) || '-'} />

                    {/* Volume */}
                    <div className="text-xs text-gray-500 uppercase tracking-wider pt-3 pb-1">
                        Volume
                    </div>
                    <StatRow label="Volume" value={formatNumber(stock.volume)} />
                    <StatRow label="Avg Volume (10D)" value={formatNumber(stock.volume)} />

                    {/* Price Performance */}
                    <div className="text-xs text-gray-500 uppercase tracking-wider pt-3 pb-1">
                        Performance
                    </div>
                    <StatRow label="1D Change" value={formatPercent(stock.change_1d)} />
                    <StatRow label="Beta" value={stock.beta?.toFixed(2) || '-'} />
                    <StatRow label="Dividend Yield" value={formatPercent(stock.dividend_yield)} />
                </div>
            )}
        </>
    );
}
