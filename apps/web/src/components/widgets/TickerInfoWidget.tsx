'use client';

import { memo } from 'react';
import { useStockQuote, useProfile } from '@/lib/queries';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { formatNumber } from '@/lib/formatters';
import { TrendingUp, TrendingDown, Info, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TickerInfoWidgetProps {
  id: string;
  symbol: string;
  hideHeader?: boolean;
  onRemove?: () => void;
}

function TickerInfoWidgetComponent({ id, symbol, hideHeader, onRemove }: TickerInfoWidgetProps) {
  const {
    data: quote,
    isLoading: quoteLoading,
    isFetching: quoteFetching,
    error: quoteError,
    refetch: refetchQuote,
    dataUpdatedAt: quoteUpdatedAt,
  } = useStockQuote(symbol);

  const {
    data: profile,
    isLoading: profileLoading,
    isFetching: profileFetching,
    error: profileError,
    refetch: refetchProfile,
    dataUpdatedAt: profileUpdatedAt,
  } = useProfile(symbol);

  const isLoading = quoteLoading || profileLoading;
  const isFetching = quoteFetching || profileFetching;
  const error = quoteError || profileError;
  const hasQuote = Boolean(quote?.symbol);
  const isFallback = Boolean(error && hasQuote);
  const updatedAt = quoteUpdatedAt || profileUpdatedAt;

  const handleRetry = () => {
    refetchQuote();
    refetchProfile();
  };

  if (isLoading && !hasQuote) {
    return <WidgetSkeleton lines={4} />;
  }

  if (error && !hasQuote) {
    return <WidgetError error={error as Error} onRetry={handleRetry} />;
  }

  if (!hasQuote) {
    return <WidgetEmpty message={`No quote data for ${symbol}`} />;
  }

  const price = quote?.price;
  const change = quote?.change;
  const changePct = quote?.changePct;
  const isPositive = (change ?? 0) >= 0;
  const changeLabel =
    change !== null && change !== undefined && changePct !== null && changePct !== undefined
      ? `${isPositive ? '+' : ''}${change.toLocaleString()} (${(changePct * 100).toFixed(2)}%)`
      : '--';

  return (
    <WidgetContainer
      title="Ticker Info"
      symbol={symbol}
      onRefresh={handleRetry}
      onClose={onRemove}
      isLoading={isLoading}
      widgetId={id}
      hideHeader={hideHeader}
    >
      <div className="flex flex-col h-full space-y-3">
        <WidgetMeta
          updatedAt={updatedAt}
          isFetching={isFetching && hasQuote}
          isCached={Boolean(quote?.cached) || isFallback}
          note={quote?.cached ? 'Cached response' : undefined}
          className="justify-between"
        />

        <div className="flex items-baseline justify-between animate-in fade-in duration-500">
          <div className="flex flex-col gap-1">
            <span className="text-3xl font-black font-mono tracking-tighter text-white tabular-nums drop-shadow-lg">
              {price !== null && price !== undefined ? price.toLocaleString() : '--'}
            </span>
            <div
              className={cn(
                'flex items-center gap-1.5 text-xs font-bold px-2 py-0.5 rounded-full w-fit',
                isPositive
                  ? 'text-emerald-300 bg-emerald-500/10 border border-emerald-500/20'
                  : 'text-rose-300 bg-rose-500/10 border border-rose-500/20'
              )}
            >
              {isPositive ? (
                <TrendingUp size={12} strokeWidth={3} />
              ) : (
                <TrendingDown size={12} strokeWidth={3} />
              )}
              <span>{changeLabel}</span>
            </div>
          </div>
          <div className="bg-blue-500/10 rounded-xl p-2.5 border border-blue-500/20 shadow-[0_0_15px_rgba(59,130,246,0.15)]">
            <Activity size={18} className="text-blue-400" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {[
            { label: 'High', value: quote?.high?.toLocaleString() },
            { label: 'Low', value: quote?.low?.toLocaleString() },
            { label: 'Volume', value: formatNumber(quote?.volume) },
            { label: 'Open', value: quote?.open?.toLocaleString() },
          ].map((item, i) => (
            <div
              key={i}
              className="p-2.5 rounded-xl bg-gray-900/40 border border-white/5 backdrop-blur-sm flex flex-col group hover:border-white/10 transition-colors"
            >
              <div className="text-[9px] font-black text-gray-500 uppercase tracking-widest mb-1 group-hover:text-blue-400 transition-colors">
                {item.label}
              </div>
              <div className="text-xs font-mono font-medium text-gray-200">
                {item.value || '--'}
              </div>
            </div>
          ))}
        </div>

        <div className="pt-2 border-t border-white/5">
          <div className="flex items-center gap-2 mb-1.5">
            <Info size={12} className="text-blue-500" />
            <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Company Profile</span>
          </div>
          <div
            className="text-xs font-bold text-gray-300 line-clamp-1 hover:text-white transition-colors cursor-default"
            title={profile?.data?.company_name}
          >
            {profile?.data?.company_name || 'Company information unavailable'}
          </div>
        </div>
      </div>
    </WidgetContainer>
  );
}

export const TickerInfoWidget = memo(TickerInfoWidgetComponent);
export default TickerInfoWidget;
