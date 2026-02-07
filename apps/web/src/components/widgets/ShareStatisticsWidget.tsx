// Share Statistics Widget - Market cap, float, volume (OpenBB-style)

'use client';

import { useScreenerData } from '@/lib/queries';
import { formatVND, formatNumber, formatPercent } from '@/lib/formatters';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';

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

export function ShareStatisticsWidget({ symbol }: ShareStatisticsWidgetProps) {
    const {
        data,
        isLoading,
        error,
        refetch,
        isFetching,
        dataUpdatedAt,
    } = useScreenerData({ symbol, enabled: !!symbol });

    const stock = data?.data?.[0] ?? null;
    const hasData = Boolean(stock);
    const isFallback = Boolean(error && hasData);

    if (!symbol) {
        return <WidgetEmpty message="Select a symbol to view statistics" />;
    }

    return (
        <div className="h-full flex flex-col">
            <div className="pb-2 border-b border-gray-800/50">
                <WidgetMeta
                    updatedAt={dataUpdatedAt}
                    isFetching={isFetching && hasData}
                    isCached={isFallback}
                    align="right"
                />
            </div>
            <div className="flex-1 overflow-auto pt-2">
                {isLoading && !hasData ? (
                    <WidgetSkeleton lines={6} />
                ) : error && !hasData ? (
                    <WidgetError error={error as Error} onRetry={() => refetch()} />
                ) : !hasData ? (
                    <WidgetEmpty message={`No data for ${symbol}`} />
                ) : (
                    <div className="space-y-1">
                        {(() => {
                            const stockData = stock;
                            if (!stockData) return null;
                            return (
                                <>
                        <div className="text-xs text-gray-500 uppercase tracking-wider pb-1">Valuation</div>
                        <StatRow label="Market Cap" value={formatVND(stockData.market_cap)} />
                        <StatRow label="P/E Ratio" value={stockData.pe?.toFixed(2) || '-'} />
                        <StatRow label="P/B Ratio" value={stockData.pb?.toFixed(2) || '-'} />

                        <div className="text-xs text-gray-500 uppercase tracking-wider pt-3 pb-1">Volume</div>
                        <StatRow label="Volume" value={formatNumber(stockData.volume)} />
                        <StatRow label="Avg Volume (10D)" value={formatNumber(stockData.volume)} />

                        <div className="text-xs text-gray-500 uppercase tracking-wider pt-3 pb-1">Performance</div>
                        <StatRow label="1D Change" value={formatPercent(stockData.change_1d)} />
                        <StatRow label="Beta" value={stockData.beta?.toFixed(2) || '-'} />
                        <StatRow label="Dividend Yield" value={formatPercent(stockData.dividend_yield)} />
                                </>
                            );
                        })()}
                    </div>
                )}
            </div>
        </div>
    );
}
