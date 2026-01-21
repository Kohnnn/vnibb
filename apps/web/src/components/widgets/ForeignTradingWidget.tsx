'use client';

import { Globe, RefreshCw, TrendingUp, TrendingDown, Clock } from 'lucide-react';
import { useForeignTrading } from '@/lib/queries';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { VirtualizedTable, type VirtualizedColumn } from '@/components/ui/VirtualizedTable';
import { cn } from '@/lib/utils';
import { memo, useMemo } from 'react';

interface ForeignTradingWidgetProps {
    id: string;
    symbol: string;
    isEditing?: boolean;
    onRemove?: () => void;
}

function formatVolume(vol: number | null | undefined): string {
    if (!vol) return '-';
    if (Math.abs(vol) >= 1e6) return `${(vol / 1e6).toFixed(2)}M`;
    if (Math.abs(vol) >= 1e3) return `${(vol / 1e3).toFixed(1)}K`;
    return vol.toLocaleString();
}

function formatDate(dateStr: string | null | undefined): string {
    if (!dateStr) return '-';
    try {
        const date = new Date(dateStr);
        return date.toLocaleDateString('vi-VN', { month: 'short', day: 'numeric' });
    } catch {
        return dateStr.slice(0, 10);
    }
}

function ForeignTradingWidgetComponent({ id, symbol, isEditing, onRemove }: ForeignTradingWidgetProps) {
    const { data, isLoading, refetch, isRefetching } = useForeignTrading(symbol, { limit: 100 });

    const trades = useMemo(() => {
        const raw = data?.data || [];
        return [...raw].sort((a, b) => {
            const dateA = String(a.date || '');
            const dateB = String(b.date || '');
            return dateB.localeCompare(dateA);
        });
    }, [data]);

    // Calculate totals from all available data
    const totals = useMemo(() => {
        const buy = trades.reduce((sum, t) => sum + (t.buy_volume || 0), 0);
        const sell = trades.reduce((sum, t) => sum + (t.sell_volume || 0), 0);
        return { buy, sell, net: buy - sell };
    }, [trades]);

    const columns = useMemo((): VirtualizedColumn<any>[] => [
        {
            id: 'date',
            header: 'Date',
            accessor: (row) => (
                <div className="text-gray-500 font-mono text-[10px]">
                    {formatDate(row.date)}
                </div>
            ),
            width: 70
        },
        {
            id: 'buy',
            header: 'Buy',
            accessor: (row) => (
                <span className="text-green-500 font-mono">{formatVolume(row.buy_volume)}</span>
            ),
            align: 'right',
            width: 70
        },
        {
            id: 'sell',
            header: 'Sell',
            accessor: (row) => (
                <span className="text-red-500 font-mono">{formatVolume(row.sell_volume)}</span>
            ),
            align: 'right',
            width: 70
        },
        {
            id: 'net',
            header: 'Net',
            accessor: (row) => {
                const net = (row.buy_volume || 0) - (row.sell_volume || 0);
                return (
                    <span className={cn(
                        "font-bold font-mono flex items-center justify-end gap-1",
                        net >= 0 ? "text-green-400" : "text-red-400"
                    )}>
                        {net >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                        {formatVolume(Math.abs(net))}
                    </span>
                );
            },
            align: 'right'
        }
    ], []);

    return (
        <WidgetContainer
            title="Foreign Flow"
            symbol={symbol}
            onRefresh={() => refetch()}
            onClose={onRemove}
            isLoading={isLoading || isRefetching}
            noPadding
            widgetId={id}
            showLinkToggle
            exportData={trades}
            exportFilename={`foreign_${symbol}`}
        >
            <div className="h-full flex flex-col bg-black">
                {/* Net Summary Bar */}
                <div className="px-3 py-2 border-b border-gray-800 bg-gray-900/40 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Globe size={12} className="text-blue-500" />
                        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Net Position</span>
                    </div>
                    <div className={cn(
                        "text-xs font-black px-2 py-0.5 rounded",
                        totals.net >= 0 ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"
                    )}>
                        {totals.net >= 0 ? '+' : ''}{formatVolume(totals.net)}
                    </div>
                </div>

                <div className="flex-1 overflow-hidden">
                    {isLoading ? (
                        <div className="p-10 flex flex-col items-center justify-center text-gray-600 gap-2">
                            <RefreshCw size={24} className="animate-spin" />
                            <span className="text-[10px] font-bold uppercase tracking-widest">Aggregating Flow...</span>
                        </div>
                    ) : trades.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-2 opacity-50">
                            <Globe size={32} strokeWidth={1} />
                            <p className="text-[10px] font-bold uppercase tracking-widest">No data for {symbol}</p>
                        </div>
                    ) : (
                        <VirtualizedTable
                            data={trades}
                            columns={columns}
                            rowHeight={30}
                        />
                    )}
                </div>
            </div>
        </WidgetContainer>
    );
}

export const ForeignTradingWidget = memo(ForeignTradingWidgetComponent);
export default ForeignTradingWidget;
