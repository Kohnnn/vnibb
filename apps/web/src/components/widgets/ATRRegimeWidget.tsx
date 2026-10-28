'use client';

import { useEffect, useMemo } from 'react';
import { Gauge, ShieldAlert, TrendingDown, TrendingUp } from 'lucide-react';
import { useHistoricalPrices } from '@/lib/queries';
import { calculateATR, type OHLCData } from '@/lib/chartUtils';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { buildWidgetRuntime, type WidgetDataPayload } from '@/lib/widgetRuntime';
import { deriveWidgetHealth } from '@/lib/widgetHealth';

interface ATRRegimeWidgetProps {
  symbol: string;
  onDataChange?: (data: WidgetDataPayload) => void;
}

function percentileRank(values: number[], value: number): number {
  if (!values.length) return 0;
  let count = 0;
  for (const item of values) {
    if (item <= value) count += 1;
  }
  return (count / values.length) * 100;
}

function formatCompact(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(0);
}

function formatPrice(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '-';
}

function getRegime(percentile: number) {
  if (percentile < 33) {
    return { label: 'Low Vol', className: 'text-emerald-300', stopMultiple: 1.2 };
  }
  if (percentile < 67) {
    return { label: 'Normal Vol', className: 'text-amber-300', stopMultiple: 1.5 };
  }
  return { label: 'High Vol', className: 'text-red-300', stopMultiple: 2.0 };
}

export function ATRRegimeWidget({ symbol, onDataChange }: ATRRegimeWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || '';
  const {
    data,
    isLoading,
    error,
    refetch,
    isFetching,
    dataUpdatedAt,
  } = useHistoricalPrices(upperSymbol, {
    startDate: new Date(Date.now() - 260 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0],
    enabled: Boolean(upperSymbol),
  });

  const candles = (data?.data || []) as OHLCData[];
  const meta = data?.meta;
  const quality = meta as (typeof meta & { unresolved_excluded_dates?: string[]; unresolved_session_count?: number });
  const expectedUnit = meta?.unit_status === 'confirmed_vnd' ? 'VND' : 'index_points';
  const certifiedUnits = ['confirmed_vnd', 'index_points', 'not_applicable'].includes(meta?.unit_status ?? '')
    && Boolean(data?.data.length)
    && data!.data.every((row) => row.price_unit === expectedUnit);
  const derivedWithheld = Boolean(data) && (!certifiedUnits || Boolean(quality?.unresolved_excluded_dates?.length || quality?.unresolved_session_count));
  const unavailableReason = !certifiedUnits
    ? 'ATR regime unavailable: historical price units were not certified.'
    : 'ATR regime unavailable: source quality is unresolved.';
  const atrSeries = derivedWithheld ? [] : calculateATR(candles, 14);
  const hasData = atrSeries.length > 20;
  const isFallback = Boolean(error && hasData);
  const lastDataDate = [meta?.freshness_as_of, meta?.last_data_date, candles[candles.length - 1]?.time]
    .find((value) => value != null && value !== '' && !Number.isNaN(new Date(value).getTime())) ?? null;
  const health = deriveWidgetHealth({ updatedAt: lastDataDate, stale: isFallback });
  const isStale = health?.status === 'stale';
  const warnings = useMemo(() => {
    const messages = [...(meta?.warnings ?? [])];
    if (meta?.completeness_status === 'partial') messages.push('Partial historical coverage');
    if (meta?.unit_status === 'mixed') messages.push('Mixed historical price units');
    if (meta?.unit_status === 'unconfirmed') messages.push('Historical price units unconfirmed');
    if (meta?.fallback_used) messages.push('Historical source fallback used');
    if (meta?.adjustment_warning) messages.push(meta.adjustment_warning);
    if (isFallback) messages.push('Latest historical refresh failed; showing previous observations');
    if (hasData && !lastDataDate) messages.push('Historical observation date unavailable');
    if (derivedWithheld) messages.push(unavailableReason);
    return [...new Set(messages)];
  }, [meta, isFallback, hasData, lastDataDate, derivedWithheld, unavailableReason]);

  useEffect(() => {
    onDataChange?.(
      buildWidgetRuntime({
        empty: !hasData,
        apiGroup: '/equity',
        endpoint: `/equity/historical?symbol=${upperSymbol}`,
        sourceLabel: 'ATR regime (derived)',
        lastDataDate,
        fetchedAt: dataUpdatedAt,
        stale: isStale,
        cached: isFallback,
        warnings,
        adjustmentMode: meta?.adjustment_mode,
        derived: true,
        extra: hasData ? { bars: atrSeries.length } : undefined,
      }),
    );
  }, [onDataChange, hasData, isStale, isFallback, lastDataDate, dataUpdatedAt, warnings, meta?.adjustment_mode, upperSymbol, atrSeries.length]);

  const lastAtr = atrSeries[atrSeries.length - 1]?.value ?? 0;
  const lastClose = candles[candles.length - 1]?.close ?? 0;
  const atrPct = lastClose > 0 ? (lastAtr / lastClose) * 100 : 0;

  const closeByTime = new Map(candles.map((candle) => [String(candle.time), candle.close]));
  const atrPctHistory = atrSeries
    .map((point) => {
      const close = closeByTime.get(String(point.time)) ?? 0;
      return close > 0 ? (point.value / close) * 100 : 0;
    })
    .filter((value) => value > 0);

  const rank = percentileRank(atrPctHistory, atrPct);
  const regime = getRegime(rank);

  const modelCapital = 100_000_000;
  const riskPerTradePct = 1;
  const riskBudget = modelCapital * (riskPerTradePct / 100);
  const stopDistance = lastAtr * regime.stopMultiple;
  const suggestedShares = stopDistance > 0 ? Math.max(0, Math.floor(riskBudget / stopDistance)) : 0;
  const suggestedValue = suggestedShares * lastClose;

  const recentAtr = atrSeries.slice(-12);
  const maxRecentAtr = recentAtr.reduce((max, point) => Math.max(max, point.value), 1);

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to view ATR regime" icon={<Gauge size={18} />} />;
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-1 py-1 mb-2">
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <Gauge size={12} className="text-cyan-400" />
          <span>ATR Regime (14D)</span>
        </div>
        <WidgetMeta
          updatedAt={lastDataDate}
          fetchedAt={dataUpdatedAt}
          isFetching={isFetching && hasData}
          isCached={isFallback}
          isStale={isStale}
          health={health ?? undefined}
          note={['Position sizing', ...warnings].join(' · ')}
          align="right"
        />
      </div>

      {isLoading && !hasData ? (
        <WidgetSkeleton lines={8} />
      ) : error && !hasData ? (
        <WidgetError error={error as Error} onRetry={() => refetch()} />
      ) : derivedWithheld ? (
        <WidgetEmpty message={unavailableReason} icon={<ShieldAlert size={18} />} />
      ) : !hasData ? (
        <WidgetEmpty message="Not enough ATR history" icon={<ShieldAlert size={18} />} />
      ) : (
        <>
      <div className="grid grid-cols-3 gap-2 mb-2 text-[10px]">
        <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
          <div className="text-[var(--text-muted)] uppercase tracking-widest">ATR</div>
          <div className="text-cyan-300 font-mono">{formatPrice(lastAtr)}</div>
        </div>
        <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
          <div className="text-[var(--text-muted)] uppercase tracking-widest">ATR %</div>
          <div className="text-amber-300 font-mono">{atrPct.toFixed(2)}%</div>
        </div>
        <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
          <div className="text-[var(--text-muted)] uppercase tracking-widest">Regime</div>
          <div className={`font-semibold ${regime.className}`}>{regime.label}</div>
        </div>
      </div>

      <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 mb-2">
        <div className="flex items-center justify-between mb-1">
          <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest">Sizing Model</div>
          <div className="text-[10px] text-[var(--text-secondary)]">Rank: {rank.toFixed(0)}%</div>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
          <div className="text-[var(--text-muted)]">Risk Budget</div>
          <div className="text-right text-[var(--text-primary)] font-mono">{formatCompact(riskBudget)}</div>
          <div className="text-[var(--text-muted)]">Stop Distance</div>
          <div className="text-right text-[var(--text-primary)] font-mono">{formatPrice(stopDistance)}</div>
          <div className="text-[var(--text-muted)]">Suggested Shares</div>
          <div className="text-right text-cyan-300 font-mono">{suggestedShares.toLocaleString()}</div>
          <div className="text-[var(--text-muted)]">Position Value</div>
          <div className="text-right text-[var(--text-primary)] font-mono">{formatCompact(suggestedValue)}</div>
        </div>
      </div>

      <div className="flex-1 overflow-auto space-y-1 pr-1">
        {recentAtr.map((point, index) => {
            const prev = recentAtr[index - 1]?.value ?? point.value;
            const isRising = point.value >= prev;
            const widthPct = (point.value / maxRecentAtr) * 100;

            return (
              <div key={`${point.time}-${index}`} className="flex items-center gap-2">
                <div className="w-14 text-[10px] text-[var(--text-muted)] shrink-0">{String(point.time).slice(5, 10)}</div>
                <div className="flex-1 h-4 bg-[var(--bg-tertiary)] rounded overflow-hidden">
                  <div
                    className={`h-full ${isRising ? 'bg-amber-500/70' : 'bg-cyan-500/70'}`}
                    style={{ width: `${Math.max(2, widthPct)}%` }}
                  />
                </div>
                <div className="w-14 text-[10px] text-[var(--text-secondary)] text-right font-mono">{point.value.toFixed(2)}</div>
                {isRising ? (
                  <TrendingUp size={10} className="text-amber-400" />
                ) : (
                  <TrendingDown size={10} className="text-cyan-400" />
                )}
              </div>
            );
          })
        }
      </div>
        </>
      )}
    </div>
  );
}

export default ATRRegimeWidget;
