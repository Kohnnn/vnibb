'use client';

import { Activity, TrendingDown, TrendingUp } from 'lucide-react';
import { useHistoricalPrices } from '@/lib/queries';
import { calculateOBV, type OHLCData } from '@/lib/chartUtils';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout';

interface OBVDivergenceWidgetProps {
  symbol: string;
}

type DivergenceSignal = 'bullish' | 'bearish' | 'none';

function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(0);
}

function percentChange(current: number, previous: number): number {
  if (!Number.isFinite(previous) || previous === 0) return 0;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function detectDivergence(candles: OHLCData[], lookback: number) {
  if (candles.length < lookback + 1) {
    return {
      signal: 'none' as DivergenceSignal,
      priceDeltaPct: 0,
      obvDeltaPct: 0,
      confidence: 0,
    };
  }

  const recent = candles.slice(-lookback);
  const obvSeries = calculateOBV(recent);

  const firstClose = recent[0].close;
  const lastClose = recent[recent.length - 1].close;
  const firstObv = obvSeries[0]?.value ?? 0;
  const lastObv = obvSeries[obvSeries.length - 1]?.value ?? 0;

  const priceDeltaPct = percentChange(lastClose, firstClose);
  const obvDeltaPct = percentChange(lastObv, firstObv === 0 ? 1 : firstObv);

  const priceTrendUp = priceDeltaPct > 1.5;
  const priceTrendDown = priceDeltaPct < -1.5;
  const obvTrendUp = obvDeltaPct > 3;
  const obvTrendDown = obvDeltaPct < -3;

  let signal: DivergenceSignal = 'none';
  if (priceTrendDown && obvTrendUp) signal = 'bullish';
  if (priceTrendUp && obvTrendDown) signal = 'bearish';

  const confidence = Math.min(
    100,
    Math.round(Math.abs(priceDeltaPct) * 0.45 + Math.abs(obvDeltaPct) * 0.55)
  );

  return {
    signal,
    priceDeltaPct,
    obvDeltaPct,
    confidence,
  };
}

export function OBVDivergenceWidget({ symbol }: OBVDivergenceWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || '';
  const {
    data,
    isLoading,
    error,
    refetch,
    isFetching,
    dataUpdatedAt,
  } = useHistoricalPrices(upperSymbol, {
    startDate: new Date(Date.now() - 150 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0],
    enabled: Boolean(upperSymbol),
  });

  const candles = (data?.data || []) as OHLCData[];
  const hasData = candles.length > 30;
  const isFallback = Boolean(error && hasData);
  const { timedOut, resetTimeout } = useLoadingTimeout(isLoading && !hasData, { timeoutMs: 8_000 });

  const lookback = 20;
  const { signal, priceDeltaPct, obvDeltaPct, confidence } = detectDivergence(candles, lookback);

  const recent = candles.slice(-lookback);
  const recentObv = calculateOBV(recent);
  const maxAbsObv = recentObv.reduce((max, point) => Math.max(max, Math.abs(point.value)), 1);

  const signalLabel =
    signal === 'bullish'
      ? 'Bullish Divergence'
      : signal === 'bearish'
        ? 'Bearish Divergence'
        : 'No Divergence';
  const signalClass =
    signal === 'bullish'
      ? 'text-emerald-300'
      : signal === 'bearish'
        ? 'text-red-300'
        : 'text-[var(--text-secondary)]';

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to view OBV divergence" icon={<Activity size={18} />} />;
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-1 py-1 mb-2">
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <Activity size={12} className="text-cyan-400" />
          <span>OBV vs Price ({lookback}D)</span>
        </div>
        <WidgetMeta
          updatedAt={dataUpdatedAt}
          isFetching={isFetching && hasData}
          isCached={isFallback}
          note="OBV divergence"
          align="right"
        />
      </div>

      <div className="flex-1 overflow-auto space-y-1 pr-1">
        {timedOut && isLoading && !hasData ? (
          <WidgetError
            title="Loading timed out"
            error={new Error('OBV divergence data took too long to load.')}
            onRetry={() => {
              resetTimeout();
              refetch();
            }}
          />
        ) : isLoading && !hasData ? (
          <WidgetSkeleton lines={8} />
        ) : error && !hasData ? (
          <WidgetError error={error as Error} onRetry={() => refetch()} />
        ) : !hasData ? (
          <WidgetEmpty message="Not enough historical candles" icon={<Activity size={18} />} size="compact" />
        ) : (
          <>
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 mb-2">
              <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest">Signal</div>
              <div className={`text-sm font-semibold ${signalClass}`}>{signalLabel}</div>
              <div className="mt-1 text-[10px] text-[var(--text-secondary)]">Confidence: {confidence}%</div>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-2">
              <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
                <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest">Price %</div>
                <div className={`text-xs font-mono ${priceDeltaPct >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                  {priceDeltaPct >= 0 ? '+' : ''}
                  {priceDeltaPct.toFixed(2)}%
                </div>
              </div>
              <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
                <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest">OBV %</div>
                <div className={`text-xs font-mono ${obvDeltaPct >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                  {obvDeltaPct >= 0 ? '+' : ''}
                  {obvDeltaPct.toFixed(2)}%
                </div>
              </div>
            </div>

            {recentObv.slice(-12).map((point, index) => {
              const prev = recentObv[recentObv.length - 12 + index - 1]?.value ?? point.value;
              const isUp = point.value >= prev;
              const widthPct = (Math.abs(point.value) / maxAbsObv) * 100;

              return (
                <div key={`${point.time}-${index}`} className="flex items-center gap-2">
                  <div className="w-14 text-[10px] text-[var(--text-muted)] shrink-0">{String(point.time).slice(5, 10)}</div>
                  <div className="flex-1 h-4 bg-[var(--bg-tertiary)] rounded overflow-hidden">
                    <div
                      className={`h-full ${isUp ? 'bg-emerald-500/70' : 'bg-red-500/70'}`}
                      style={{ width: `${Math.max(2, widthPct)}%` }}
                    />
                  </div>
                  <div className="w-16 text-[10px] text-[var(--text-secondary)] text-right font-mono">{formatCompact(point.value)}</div>
                  {isUp ? (
                    <TrendingUp size={10} className="text-emerald-400" />
                  ) : (
                    <TrendingDown size={10} className="text-red-400" />
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

export default OBVDivergenceWidget;
