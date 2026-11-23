'use client';

import { useEffect } from 'react';
import { Activity, TrendingDown, TrendingUp } from 'lucide-react';
import { useHistoricalPrices } from '@/lib/queries';
import { calculateOBV } from '@/lib/chartUtils';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { QuantWarningBanner } from '@/components/ui/QuantWarningBanner';
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout';
import { buildWidgetRuntime } from '@/lib/widgetRuntime';
import { formatPercent } from '@/lib/units';
import { signedToneClass } from '@/lib/priceColor';
import type { EquityHistoricalData } from '@/types/equity';

interface OBVDivergenceWidgetProps {
  symbol: string;
  onDataChange?: (data: WidgetDataPayload) => void;
}

const LOOKBACK_BARS = 20;

type DivergenceSignal = 'bullish' | 'bearish' | 'none';

function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(0);
}

function detectDivergence(recent: EquityHistoricalData[]) {
  if (recent.length < LOOKBACK_BARS) return null;
  const obvSeries = calculateOBV(recent);
  if (!obvSeries) return null;

  const firstClose = recent[0].close;
  const lastClose = recent[recent.length - 1].close;
  const firstObv = obvSeries[0].value;
  const lastObv = obvSeries[obvSeries.length - 1].value;

  const priceDeltaPct = ((lastClose - firstClose) / firstClose) * 100;
  const obvDeltaPct = ((lastObv - firstObv) / Math.max(1, Math.abs(firstObv))) * 100;

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
    obvSeries,
  };
}

export function OBVDivergenceWidget({ symbol, onDataChange }: OBVDivergenceWidgetProps) {
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
    adjustmentMode: 'adjusted',
    enabled: Boolean(upperSymbol),
  });

  const meta = data?.meta;
  // Only per-row `price_unit` markers certify the series; a response-level
  // `unit_status` cannot certify rows that carry no marker (QA #98).
  const expectedUnit = meta?.unit_status === 'confirmed_vnd' ? 'VND' : 'index_points';
  const certifiedUnits = Boolean(data?.data?.length)
    && ['confirmed_vnd', 'index_points', 'not_applicable'].includes(meta?.unit_status ?? '')
    && (data?.data ??[]).every((row) => row.price_unit === expectedUnit);
  const derivedWithheld = Boolean(data) && !certifiedUnits;
  const candles = derivedWithheld ? [] : (data?.data ?? []);
  const recent = candles.slice(-LOOKBACK_BARS);
  const divergence = detectDivergence(recent);
  const hasData = divergence !== null;
  const isFallback = Boolean(error && hasData);
  const adjustmentWarning = meta?.adjustment_warning ?? null;
  const lastDataDate = [meta?.freshness_as_of, meta?.last_data_date, candles.at(-1)?.time]
    .find((value) => value != null && value !== '' && !Number.isNaN(new Date(value).getTime())) ?? null;
  const { timedOut, resetTimeout } = useLoadingTimeout(isLoading && !hasData, { timeoutMs: 8_000 });

  const signal = divergence?.signal;
  const confidence = divergence?.confidence;
  const unavailableReason = derivedWithheld
    ? 'OBV divergence unavailable: historical price units were not certified.'
    : recent.length < LOOKBACK_BARS
      ? 'Not enough historical candles'
      : `OBV divergence unavailable: incomplete observations in the ${LOOKBACK_BARS}-bar lookback.`;

  useEffect(() => {
    onDataChange?.(
      buildWidgetRuntime({
        empty: !hasData,
        apiGroup: '/equity',
        endpoint: `/equity/historical?symbol=${upperSymbol}&adjustment_mode=adjusted`,
        sourceLabel: 'OBV divergence (derived)',
        basis: hasData ? `Latest ${LOOKBACK_BARS} returned bars, each with observed volume.` : undefined,
        lastDataDate,
        fetchedAt: dataUpdatedAt,
        adjustmentMode: 'adjusted',
        stale: isFallback,
        derived: true,
        extra: {
          ...(hasData ? { signal, confidence } : {}),
          adjustmentCoveragePct: data?.meta?.adjustment_coverage_pct ?? null,
          adjustmentRequestedCount: data?.meta?.adjustment_requested_count ?? 0,
          adjustmentAppliedCount: data?.meta?.adjustment_applied_count ?? 0,
          adjustmentWarning,
        },
      }),
    );
  }, [adjustmentWarning, confidence, data?.meta?.adjustment_applied_count, data?.meta?.adjustment_coverage_pct, data?.meta?.adjustment_requested_count, dataUpdatedAt, hasData, isFallback, lastDataDate, onDataChange, signal, upperSymbol]);

  const maxAbsObv = divergence?.obvSeries.reduce((max, point) => Math.max(max, Math.abs(point.value)), 1) ?? 1;

  const signalLabel =
    signal === 'bullish'
      ? 'Bullish Divergence'
      : signal === 'bearish'
        ? 'Bearish Divergence'
        : 'No Divergence';
  const signalClass =
    signal === 'bullish'
      ? 'text-[var(--color-positive)]'
      : signal === 'bearish'
        ? 'text-[var(--color-negative)]'
        : 'text-[var(--text-secondary)]';

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to view OBV divergence" icon={<Activity size={18} />} />;
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-1 py-1 mb-2">
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <Activity size={12} className="text-[var(--color-accent-primary)]" />
          <span>OBV vs Price ({LOOKBACK_BARS} bars)</span>
        </div>
        <WidgetMeta
          updatedAt={lastDataDate}
          fetchedAt={dataUpdatedAt}
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
          <WidgetError title={recent.length === LOOKBACK_BARS ? unavailableReason : undefined} error={error as Error} onRetry={() => refetch()} />
        ) : !divergence ? (
          <WidgetEmpty
            message={unavailableReason}
            icon={<Activity size={18} />}
            size="compact"
          />
        ) : (
          <>
            <QuantWarningBanner warning={adjustmentWarning} className="mb-2" />
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 mb-2">
              <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest">Signal</div>
              <div className={`text-sm font-semibold ${signalClass}`}>{signalLabel}</div>
              <div className="mt-1 text-[10px] text-[var(--text-secondary)]">Confidence: {confidence}%</div>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-2">
              <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
                <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest">Price %</div>
                <div className={`text-xs font-mono ${signedToneClass(divergence.priceDeltaPct)}`}>
                  {formatPercent(divergence.priceDeltaPct, { input: 'percent', decimals: 2, signed: true })}
                </div>
              </div>
              <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1" title="OBV change over the lookback, relative to the starting magnitude (one-share denominator if the starting OBV is zero).">
                <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest">OBV %</div>
                <div className={`text-xs font-mono ${signedToneClass(divergence.obvDeltaPct)}`}>
                  {Math.abs(divergence.obvDeltaPct) > 300
                    ? `${divergence.obvDeltaPct > 0 ? '> +' : '< -'}300%`
                    : formatPercent(divergence.obvDeltaPct, { input: 'percent', decimals: 2, signed: true })}
                </div>
              </div>
            </div>

            {divergence.obvSeries.slice(-12).map((point, index) => {
              const prev = divergence.obvSeries[divergence.obvSeries.length - 12 + index - 1].value;
              const isUp = point.value >= prev;
              const widthPct = (Math.abs(point.value) / maxAbsObv) * 100;

              return (
                <div key={`${point.time}-${index}`} className="flex items-center gap-2">
                  <div className="w-14 text-[10px] text-[var(--text-muted)] shrink-0">{String(point.time).slice(5, 10)}</div>
                  <div className="flex-1 h-4 bg-[var(--bg-tertiary)] rounded overflow-hidden">
                    <div
                      className={`h-full ${isUp ? 'bg-[var(--color-positive-bg)]' : 'bg-[var(--color-negative-bg)]'}`}
                      style={{ width: `${Math.max(2, widthPct)}%` }}
                    />
                  </div>
                  <div className="w-16 text-[10px] text-[var(--text-secondary)] text-right font-mono">{formatCompact(point.value)}</div>
                  {isUp ? (
                    <TrendingUp size={10} className="text-[var(--color-positive)]" />
                  ) : (
                    <TrendingDown size={10} className="text-[var(--color-negative)]" />
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
