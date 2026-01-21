// Ticker Info Widget - Real-time price and basic info
'use client';

import { memo } from 'react';
import { useStockQuote, useProfile } from '@/lib/queries';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { formatVND, formatPercent, formatNumber } from '@/lib/formatters';
import { TrendingUp, TrendingDown, Info, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TickerInfoWidgetProps {
    id: string;
    symbol: string;
    hideHeader?: boolean;
    onRemove?: () => void;
}

function TickerInfoWidgetComponent({ id, symbol, hideHeader, onRemove }: TickerInfoWidgetProps) {
    const { data: quote, isLoading: quoteLoading, refetch } = useStockQuote(symbol);
    const { data: profile, isLoading: profileLoading } = useProfile(symbol);

    const price = quote?.price || 0;
    const change = quote?.change || 0;
    const changePct = quote?.changePct || 0;
    const isPositive = change >= 0;

    return (
        <WidgetContainer
            title="Ticker Info"
            symbol={symbol}
            onRefresh={() => refetch()}
            onClose={onRemove}
            isLoading={quoteLoading || profileLoading}
            widgetId={id}
            hideHeader={hideHeader}
        >
            <div className="flex flex-col h-full space-y-4">
                {/* Price Section */}
                <div className="flex items-baseline justify-between">
                    <div className="flex flex-col">
                        <span className="text-2xl font-black font-mono tracking-tighter text-white">
                            {price.toLocaleString()}
                        </span>
                        <div className={cn(
                            "flex items-center gap-1 text-xs font-bold",
                            isPositive ? 'text-green-400' : 'text-red-400'
                        )}>
                            {isPositive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                            <span>{isPositive ? '+' : ''}{change.toLocaleString()} ({changePct.toFixed(2)}%)</span>
                        </div>
                    </div>
                    <div className="bg-gray-800/50 rounded-lg p-2 border border-gray-700/50">
                        <Activity size={16} className="text-blue-500" />
                    </div>
                </div>

                {/* Info Grid */}
                <div className="grid grid-cols-2 gap-2">
                    <div className="p-2 rounded-lg bg-gray-900/50 border border-gray-800/50">
                        <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-0.5">High</div>
                        <div className="text-xs font-mono text-gray-200">{quote?.high?.toLocaleString() || '-'}</div>
                    </div>
                    <div className="p-2 rounded-lg bg-gray-900/50 border border-gray-800/50">
                        <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-0.5">Low</div>
                        <div className="text-xs font-mono text-gray-200">{quote?.low?.toLocaleString() || '-'}</div>
                    </div>
                    <div className="p-2 rounded-lg bg-gray-900/50 border border-gray-800/50">
                        <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-0.5">Volume</div>
                        <div className="text-xs font-mono text-gray-200">{formatNumber(quote?.volume)}</div>
                    </div>
                    <div className="p-2 rounded-lg bg-gray-900/50 border border-gray-800/50">
                        <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-0.5">Open</div>
                        <div className="text-xs font-mono text-gray-200">{quote?.open?.toLocaleString() || '-'}</div>
                    </div>
                </div>

                {/* Company Name */}
                <div className="pt-2 border-t border-gray-800">
                    <div className="flex items-center gap-2 mb-1">
                        <Info size={12} className="text-gray-500" />
                        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Company</span>
                    </div>
                    <div className="text-xs font-bold text-gray-300 line-clamp-1">{profile?.data?.company_name || 'Loading...'}</div>
                </div>
            </div>
        </WidgetContainer>
    );
}

export const TickerInfoWidget = memo(TickerInfoWidgetComponent);
export default TickerInfoWidget;
