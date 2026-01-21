'use client';

import { Activity, RefreshCw, TrendingUp, TrendingDown, Clock } from 'lucide-react';
import { useIntraday } from '@/lib/queries';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { VirtualizedTable, type VirtualizedColumn } from '@/components/ui/VirtualizedTable';
import { memo, useMemo } from 'react';

interface IntradayTradesWidgetProps {
    id: string;
    symbol: string;
    isEditing?: boolean;
    onRemove?: () => void;
}

function formatTime(timeStr: string | null | undefined): string {
    if (!timeStr) return '-';
    // Handle various time formats
    const parts = timeStr.split(':');
    if (parts.length >= 2) {
        return `${parts[0]}:${parts[1]}:${parts[2]?.split('.')[0] || '00'}`;
    }
    return timeStr;
}

function formatPrice(price: number | null | undefined): string {
    if (!price) return '-';
    return price.toLocaleString('vi-VN');
}

function formatVolume(vol: number | null | undefined): string {
    if (!vol) return '-';
    return vol.toLocaleString('vi-VN');
}

function IntradayTradesWidgetComponent({ id, symbol, isEditing, onRemove }: IntradayTradesWidgetProps) {
    const { data, isLoading, refetch, isRefetching } = useIntraday(symbol, { limit: 1000 });

    const trades = useMemo(() => {
        const raw = data?.data || [];
        // Sort by time descending
        return [...raw].sort((a, b) => {
            const timeA = String(a.time || '');
            const timeB = String(b.time || '');
            return timeB.localeCompare(timeA);
        });
    }, [data]);

    const columns = useMemo((): VirtualizedColumn<any>[] => [
        { 
            id: 'time', 
            header: 'Time', 
            accessor: (row) => (
                <div className="flex items-center gap-1.5 text-gray-500 font-mono text-[10px]">
                    <Clock size={10} className="opacity-50" />
                    {formatTime(row.time)}
                </div>
            ),
            width: 80
        },
        { 
            id: 'price', 
            header: 'Price', 
            accessor: (row) => (
                <span className="font-bold text-white font-mono">{formatPrice(row.price)}</span>
            ),
            align: 'right',
            width: 80
        },
        { 
            id: 'volume', 
            header: 'Volume', 
            accessor: (row) => (
                <span className="text-gray-400 font-mono">{formatVolume(row.volume)}</span>
            ),
            align: 'right'
        },
        { 
            id: 'type', 
            header: 'Side', 
            accessor: (row) => {
                const isBuy = row.match_type?.toUpperCase().includes('BU') ||
                            row.match_type?.toUpperCase().includes('B');
                const isSell = row.match_type?.toUpperCase().includes('SD') ||
                             row.match_type?.toUpperCase().includes('S');
                
                return (
                    <div className="flex justify-center">
                        {isBuy ? (
                            <span className="text-[10px] font-black text-green-500 bg-green-500/10 px-1 rounded">B</span>
                        ) : isSell ? (
                            <span className="text-[10px] font-black text-red-500 bg-red-500/10 px-1 rounded">S</span>
                        ) : (
                            <span className="text-gray-600">-</span>
                        )}
                    </div>
                );
            },
            align: 'center',
            width: 50
        }
    ], []);

    return (
        <WidgetContainer
            title="Intraday Trades"
            symbol={symbol}
            onRefresh={() => refetch()}
            onClose={onRemove}
            isLoading={isLoading || isRefetching}
            noPadding
            widgetId={id}
            showLinkToggle
            exportData={trades}
            exportFilename={`trades_${symbol}_${new Date().toISOString().split('T')[0]}`}
        >
            <div className="h-full flex flex-col bg-black">
                <div className="flex-1 overflow-hidden">
                    {isLoading ? (
                        <div className="p-10 flex flex-col items-center justify-center text-gray-600 gap-2">
                            <RefreshCw size={24} className="animate-spin" />
                            <span className="text-[10px] font-bold uppercase tracking-widest">Streaming Ticks...</span>
                        </div>
                    ) : trades.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-2 opacity-50">
                            <Activity size={32} strokeWidth={1} />
                            <p className="text-[10px] font-bold uppercase tracking-widest">No trades for {symbol}</p>
                        </div>
                    ) : (
                        <VirtualizedTable
                            data={trades}
                            columns={columns}
                            rowHeight={30}
                        />
                    )}
                </div>
                
                <div className="px-3 py-1.5 border-t border-gray-800 bg-gray-900/20 flex items-center justify-between">
                    <div className="text-[9px] font-bold text-gray-600 uppercase tracking-tighter flex items-center gap-1">
                        <Activity size={10} />
                        Total {trades.length.toLocaleString()} Ticks
                    </div>
                    <div className="flex items-center gap-1">
                         <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                         <span className="text-[9px] text-gray-500 font-bold uppercase">Live</span>
                    </div>
                </div>
            </div>
        </WidgetContainer>
    );
}

export const IntradayTradesWidget = memo(IntradayTradesWidgetComponent);
export default IntradayTradesWidget;
