'use client';

import { memo, useEffect } from 'react';
import { useStockQuote, useProfile, useScreenerData, useTradingStats } from '@/lib/queries';
import { useUnit } from '@/contexts/UnitContext';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout';
import { useQuantRegime } from '@/hooks/useQuantRegime';
import { TrendingUp, TrendingDown, Info, Activity } from 'lucide-react';
import { formatCompactValueForUnit, formatNumber, formatPriceValueForUnit } from '@/lib/units';
import { cn } from '@/lib/utils';

function toPositiveNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null
  }
  return parsed
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

interface TickerInfoWidgetProps {
  id: string;
  symbol: string;
  hideHeader?: boolean;
  onRemove?: () => void;
  onDataChange?: (data: unknown) => void;
}

function TickerInfoWidgetComponent({ id, symbol, hideHeader, onRemove, onDataChange }: TickerInfoWidgetProps) {
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
  const { data: tradingStats } = useTradingStats(symbol, Boolean(symbol));
  const quantRegime = useQuantRegime(symbol, { period: '1Y', enabled: Boolean(symbol) })
  const { config: unitConfig } = useUnit();

  const isLoading = quoteLoading || profileLoading;
  const isFetching = quoteFetching || profileFetching || screenerFetching;
  const error = quoteError || profileError || screenerError;
  const hasQuote = Boolean(quote?.symbol);
  const isFallback = Boolean(error && hasQuote);
  const updatedAt = quoteUpdatedAt || profileUpdatedAt;
  const { timedOut, resetTimeout } = useLoadingTimeout(isLoading && !hasQuote, { timeoutMs: 8_000 })
  const screenerRow = screenerData?.data?.[0]
  const profileData = profile?.data

  useEffect(() => {
    onDataChange?.({
      quote,
      profile: profileData,
      screener: screenerRow,
    })
  }, [onDataChange, profileData, quote, screenerRow])

  const handleRetry = () => {
    refetchQuote();
    refetchProfile();
    refetchScreener();
  };

  if (timedOut && isLoading && !hasQuote) {
    return <WidgetError error={new Error('Ticker info took too long to load.')} title="Loading timed out" onRetry={() => {
      resetTimeout()
      handleRetry()
    }} />;
  }

  if (isLoading && !hasQuote) {
    return <WidgetSkeleton lines={4} />;
  }

  if (error && !hasQuote) {
    return <WidgetError error={error as Error} onRetry={handleRetry} />;
  }

  if (!hasQuote) {
    return <WidgetEmpty message={`No quote data for ${symbol}`} />;
  }

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

  const rangeLow = toPositiveNumber(tradingStats?.data?.low_52w)
  const rangeHigh = toPositiveNumber(tradingStats?.data?.high_52w)
  const rangePrice = toPositiveNumber(price)
  const hasRange = Boolean(rangeLow && rangeHigh && rangePrice && rangeHigh > rangeLow)
  const rangePosition = hasRange
    ? clampPercent((((rangePrice as number) - (rangeLow as number)) / ((rangeHigh as number) - (rangeLow as number))) * 100)
    : 0

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
      <div className="flex flex-col h-full space-y-2">
        <WidgetMeta
          updatedAt={updatedAt}
          isFetching={isFetching && hasQuote}
          isCached={Boolean(quote?.cached) || isFallback}
          note={
            marketCapSource === 'Derived'
              ? 'Market cap derived from profile shares x quote'
              : quote?.cached
                ? 'Cached response'
                : unitConfig.display === 'USD'
                  ? 'Price and value fields shown in USD using current FX defaults'
                  : undefined
          }
          sourceLabel="Quote + profile"
          className="justify-between"
        />

        <div className="flex items-start justify-between rounded-2xl border border-blue-500/15 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.16),transparent_48%),linear-gradient(180deg,rgba(15,23,42,0.18),transparent)] px-3 py-2.5 animate-in fade-in duration-500">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-black uppercase tracking-[0.24em] text-blue-300/80">
              {symbol}
            </span>
            <span className="text-3xl font-black font-mono tracking-tighter text-[var(--text-primary)] tabular-nums drop-shadow-lg">
              {formatPriceValueForUnit(price, unitConfig)}
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
            <div className="bg-blue-500/10 rounded-xl p-2 border border-blue-500/20 shadow-[0_0_15px_rgba(59,130,246,0.15)]">
              <Activity size={18} className="text-blue-400" />
            </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
            {[
            { label: 'Day High', value: formatPriceValueForUnit(quote?.high, unitConfig) },
            { label: 'Day Low', value: formatPriceValueForUnit(quote?.low, unitConfig) },
            { label: '52W High', value: formatPriceValueForUnit(rangeHigh, unitConfig) },
            { label: '52W Low', value: formatPriceValueForUnit(rangeLow, unitConfig) },
            { label: 'Volume', value: formatNumber(quote?.volume) },
            { label: 'Prev Close', value: formatPriceValueForUnit(quote?.prevClose, unitConfig) },
            { label: 'Open', value: formatPriceValueForUnit(quote?.open, unitConfig) },
            {
              label: 'Mkt Cap',
              value: formatCompactValueForUnit(marketCap, unitConfig),
              source: marketCapSource,
            },
          ].slice(0, 8).map((item, i) => (
            <div
              key={i}
              className="group flex min-h-[56px] flex-col justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] p-2 transition-colors hover:border-[var(--border-color)]"
            >
              <div className="text-[9px] font-black text-[var(--text-muted)] uppercase tracking-widest group-hover:text-blue-400 transition-colors">
                {item.label}
              </div>
              <div className={cn(
                'mt-1 text-sm font-mono font-semibold tabular-nums',
                item.value === '--' ? 'text-[var(--text-muted)]' : 'text-[var(--text-secondary)]'
              )}>
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

        {hasRange && (
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-3 py-2.5">
            <div className="mb-1.5 flex items-center justify-between text-[9px] font-black uppercase tracking-[0.22em] text-[var(--text-muted)]">
              <span>52W Range</span>
              <span className="text-[var(--text-secondary)]">{rangePosition.toFixed(0)}%</span>
            </div>
            <div className="relative h-2 rounded-full bg-[var(--bg-secondary)]">
              <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-rose-400/60 via-amber-300/60 to-emerald-400/70" style={{ width: `${rangePosition}%` }} />
              <div className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border border-white/50 bg-[var(--bg-primary)] shadow" style={{ left: `calc(${rangePosition}% - 6px)` }} />
            </div>
            <div className="mt-1.5 flex items-center justify-between text-[10px] font-mono text-[var(--text-secondary)] tabular-nums">
              <span>{formatPriceValueForUnit(rangeLow, unitConfig)}</span>
              <span className="text-[var(--text-primary)]">{formatPriceValueForUnit(rangePrice, unitConfig)}</span>
              <span>{formatPriceValueForUnit(rangeHigh, unitConfig)}</span>
            </div>
          </div>
        )}

        <div className="pt-1.5 border-t border-[var(--border-subtle)]">
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
          <div className="mt-1.5 flex flex-wrap gap-1.5">
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
            {quantRegime.hasData && (
              <span
                className={cn(
                  'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                  quantRegime.momentum.shortLabel === 'Bull'
                    ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                    : quantRegime.momentum.shortLabel === 'Bear'
                      ? 'border-rose-500/20 bg-rose-500/10 text-rose-300'
                      : 'border-cyan-500/20 bg-cyan-500/10 text-cyan-300'
                )}
                title={quantRegime.action}
              >
                {quantRegime.regimeLabel}
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
