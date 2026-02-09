// Similar Stocks Widget - Find stocks similar to current symbol

'use client';

import { Users } from 'lucide-react';
import { usePeerCompanies } from '@/lib/queries';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useWidgetSymbolLink } from '@/hooks/useWidgetSymbolLink';
import type { WidgetGroupId } from '@/types/widget';

interface SimilarStocksWidgetProps {
    symbol: string;
    widgetGroup?: WidgetGroupId;
    isEditing?: boolean;
    onRemove?: () => void;
}

function formatMarketCap(value?: number | null): string {
    if (!value && value !== 0) return '-';
    if (value >= 1e12) return `${(value / 1e12).toFixed(1)}T`;
    if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
    if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
    return value.toLocaleString();
}

export function SimilarStocksWidget({ symbol, widgetGroup }: SimilarStocksWidgetProps) {
    const upperSymbol = symbol?.toUpperCase() || '';
    const { setLinkedSymbol } = useWidgetSymbolLink(widgetGroup);
    const {
        data,
        isLoading,
        error,
        refetch,
        isFetching,
        dataUpdatedAt,
    } = usePeerCompanies(upperSymbol, { limit: 6, enabled: Boolean(upperSymbol) });

    const peers = data?.peers || [];
    const hasData = peers.length > 0;
    const isFallback = Boolean(error && hasData);

    if (!upperSymbol) {
        return <WidgetEmpty message="Select a symbol to view peers" icon={<Users size={18} />} />;
    }

    return (
        <div className="h-full flex flex-col">
            <div className="flex items-center justify-between pb-2 border-b border-gray-800/50">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Users size={12} className="text-cyan-400" />
                    <span>Similar to {upperSymbol}</span>
                </div>
                <WidgetMeta
                    updatedAt={dataUpdatedAt}
                    isFetching={isFetching && hasData}
                    isCached={isFallback}
                    align="right"
                />
            </div>

            <div className="flex-1 overflow-auto space-y-1 pt-2">
                {isLoading && !hasData ? (
                    <WidgetSkeleton lines={5} />
                ) : error && !hasData ? (
                    <WidgetError error={error as Error} onRetry={() => refetch()} />
                ) : !hasData ? (
                    <WidgetEmpty message={`No similar stocks found for ${upperSymbol}`} icon={<Users size={18} />} />
                ) : (
                    peers.map((peer, index) => (
                        <button
                            key={`${peer.symbol}-${index}`}
                            type="button"
                            onClick={() => setLinkedSymbol(peer.symbol)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    setLinkedSymbol(peer.symbol);
                                }
                            }}
                            className="w-full flex items-center justify-between p-2 rounded bg-gray-800/20 hover:bg-gray-800/40 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30"
                        >
                            <div>
                                <div className="text-sm font-medium text-white">{peer.symbol}</div>
                                <div className="text-[10px] text-gray-500 truncate max-w-[140px]">
                                    {peer.name || peer.industry || peer.sector || '-'}
                                </div>
                            </div>
                            <div className="text-right">
                                <div className="text-xs text-gray-400">
                                    P/E: {peer.pe_ratio?.toFixed(1) || '-'}
                                </div>
                                <div className="text-xs text-gray-400">
                                    MCap: {formatMarketCap(peer.market_cap)}
                                </div>
                            </div>
                        </button>
                    ))
                )}
            </div>
        </div>
    );
}
