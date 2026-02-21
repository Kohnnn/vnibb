'use client';

import { memo } from 'react';
import { useStockQuote, useProfile, useScreenerData } from '@/lib/queries';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { formatNumber } from '@/lib/formatters';
import { TrendingUp, TrendingDown, Info, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';

function toPositiveNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null
  }
  return parsed
}

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

  const {
    data: screenerData,
    isFetching: screenerFetching,
    error: screenerError,
    refetch: refetchScreener,
  } = useScreenerData({
    symbol,
    limit: 1,
    enabled: Boolean(symbol),
  });

  const isLoading = quoteLoading || profileLoading;
  const isFetching = quoteFetching || profileFetching || screenerFetching;
  const error = quoteError || profileError || screenerError;
  const hasQuote = Boolean(quote?.symbol);
  const isFallback = Boolean(error && hasQuote);
  const updatedAt = quoteUpdatedAt || profileUpdatedAt;

  const handleRetry = () => {
    refetchQuote();
    refetchProfile();
    refetchScreener();
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

  const screenerRow = screenerData?.data?.[0]
  const profileData = profile?.data

  const price = quote?.price
  const change = quote?.change
  const changePct = quote?.changePct

  const screenerMarketCap = toPositiveNumber(screenerRow?.market_cap)
  const sharesOutstanding = toPositiveNumber(profileData?.outstanding_shares)
  const derivedMarketCap =
    sharesOutstanding && toPositiveNumber(price)
      ? sharesOutstanding * (toPositiveNumber(price) || 0)
      : null
  const marketCap = screenerMarketCap ?? derivedMarketCap
  const marketCapSource = screenerMarketCap
    ? 'Screener'
    : derivedMarketCap
      ? 'Derived'
      : 'Unavailable'

  const companyName =
    profileData?.company_name ||
    (screenerRow?.company_name as string | undefined) ||
    (screenerRow?.organ_name as string | undefined) ||
    symbol

  const exchange =
    profileData?.exchange ||
    (screenerRow?.exchange as string | undefined) ||
    null

  const industry =
    profileData?.industry ||
    (screenerRow?.industry as string | undefined) ||
    (screenerRow?.industry_name as string | undefined) ||
    null

  const isPositive = (change ?? 0) >= 0;
  const changeLabel =
    change !== null && change !== undefined && changePct !== null && changePct !== undefined
      ? `${isPositive ? '+' : ''}${change.toLocaleString()} (${changePct.toFixed(2)}%)`
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
          note={
            marketCapSource === 'Derived'
              ? 'Market cap derived from profile shares x quote'
              : quote?.cached
                ? 'Cached response'
                : undefined
          }
          sourceLabel="Quote + profile"
          className="justify-between"
        />

        <div className="flex items-baseline justify-between animate-in fade-in duration-500">
          <div className="flex flex-col gap-1">
            <span className="text-3xl font-black font-mono tracking-tighter text-[var(--text-primary)] tabular-nums drop-shadow-lg">
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
            { label: 'Prev Close', value: quote?.prevClose?.toLocaleString() },
            { label: 'Open', value: quote?.open?.toLocaleString() },
            {
              label: 'Mkt Cap',
              value: formatNumber(marketCap),
              source: marketCapSource,
            },
          ].map((item, i) => (
            <div
              key={i}
              className="p-2.5 rounded-xl bg-[var(--bg-tertiary)]/70 border border-[var(--border-subtle)] backdrop-blur-sm flex flex-col group hover:border-[var(--border-color)] transition-colors"
            >
              <div className="text-[9px] font-black text-[var(--text-muted)] uppercase tracking-widest mb-1 group-hover:text-blue-400 transition-colors">
                {item.label}
              </div>
              <div className="text-xs font-mono font-medium text-[var(--text-secondary)]">
                {item.value || '--'}
              </div>
              {item.source && (
                <div className="mt-1 text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
                  {item.source}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="pt-2 border-t border-[var(--border-subtle)]">
          <div className="flex items-center gap-2 mb-1.5">
            <Info size={12} className="text-blue-500" />
            <span className="text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest">Company Profile</span>
          </div>
          <div
            className="text-xs font-bold text-[var(--text-secondary)] line-clamp-1 hover:text-[var(--text-primary)] transition-colors cursor-default"
            title={companyName}
          >
            {companyName || 'Company information unavailable'}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {exchange && (
              <span className="inline-flex items-center rounded-full border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold text-blue-300">
                {exchange}
              </span>
            )}
            {industry && (
              <span className="inline-flex items-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                {industry}
              </span>
            )}
            {marketCapSource === 'Derived' && (
              <span className="inline-flex items-center rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                MCap derived
              </span>
            )}
          </div>
        </div>
      </div>
    </WidgetContainer>
  );
}

export const TickerInfoWidget = memo(TickerInfoWidgetComponent);
export default TickerInfoWidget;
