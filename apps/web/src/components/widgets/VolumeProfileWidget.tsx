'use client';

import { useEffect, useMemo, useState } from 'react';
import { BarChart2 } from 'lucide-react';
import { useHistoricalPrices, useMicrostructureAnalysis } from '@/lib/queries';
import { sourceObservation } from '@/lib/intradayAvailability';
import { microstructureFailures, microstructureProvenance, microstructureTickFailure } from '@/lib/microstructureAvailability';
import { calculateVolumeProfile, type OHLCData } from '@/lib/chartUtils';
import { getQuantPeriodStartDate, QUANT_PERIOD_OPTIONS, type QuantPeriodOption } from '@/lib/quantPeriods';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout';
import { buildWidgetRuntime } from '@/lib/widgetRuntime';
import { deriveWidgetHealth } from '@/lib/widgetHealth';
import { isObservedVolume } from '@/lib/volumeObservation';
import type { EquityHistoricalData } from '@/types/equity';

interface VolumeProfileWidgetProps {
  symbol: string;
  onDataChange?: (data: WidgetDataPayload) => void;
}

interface VolumeBin {
  price: number;
  volume: number;
}

function formatVolume(volume: number): string {
  if (volume >= 1e9) return `${(volume / 1e9).toFixed(1)}B`;
  if (volume >= 1e6) return `${(volume / 1e6).toFixed(1)}M`;
  if (volume >= 1e3) return `${(volume / 1e3).toFixed(0)}K`;
  return Math.round(volume).toLocaleString();
}

function calculateHistoricalProfile(candles: EquityHistoricalData[]) {
  const bars: OHLCData[] = [];
  let hasTrades = false;
  for (const { time, open, high, low, close, volume } of candles) {
    if (!isObservedVolume(volume) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
      return null;
    }
    bars.push({
      time, open, close, volume,
      high: Math.max(high, low, close),
      low: Math.min(high, low, close),
    });
    hasTrades ||= volume > 0;
  }
  return hasTrades ? calculateVolumeProfile(bars, 24) : [];
}

function calculateValueArea(profile: VolumeBin[], targetShare = 0.7) {
  const totalVolume = profile.reduce((sum, bin) => sum + bin.volume, 0);
  if (!Number.isFinite(totalVolume) || totalVolume <= 0) return null;
  const targetVolume = totalVolume * targetShare;

  let pocIndex = 0;
  for (let i = 1; i < profile.length; i += 1) {
    if (profile[i].volume > profile[pocIndex].volume) {
      pocIndex = i;
    }
  }

  const included = new Set<number>([pocIndex]);
  let coveredVolume = profile[pocIndex].volume;
  let left = pocIndex - 1;
  let right = pocIndex + 1;

  while (coveredVolume < targetVolume && (left >= 0 || right < profile.length)) {
    const leftVolume = left >= 0 ? profile[left].volume : -1;
    const rightVolume = right < profile.length ? profile[right].volume : -1;

    if (leftVolume >= rightVolume && left >= 0) {
      included.add(left);
      coveredVolume += profile[left].volume;
      left -= 1;
    } else if (right < profile.length) {
      included.add(right);
      coveredVolume += profile[right].volume;
      right += 1;
    } else {
      break;
    }
  }

  const selected = [...included].sort((a, b) => a - b);
  const valPrice = profile[selected[0]]?.price ?? null;
  const vahPrice = profile[selected[selected.length - 1]]?.price ?? null;

  return {
    pocPrice: profile[pocIndex].price,
    vahPrice,
    valPrice,
  };
}

export function VolumeProfileWidget({ symbol, onDataChange }: VolumeProfileWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || '';
  const [period, setPeriod] = useState<QuantPeriodOption>('6M');
  const {
    data,
    isLoading,
    error,
    refetch,
    isFetching,
    dataUpdatedAt,
  } = useHistoricalPrices(upperSymbol, {
    startDate: getQuantPeriodStartDate(period),
    enabled: Boolean(upperSymbol),
  });

  const {
    data: microstructure,
    isLoading: isMicroLoading,
    error: microError,
    refetch: refetchMicro,
    isFetching: isMicroFetching,
    dataUpdatedAt: microUpdatedAt,
  } = useMicrostructureAnalysis(upperSymbol, {
    interval: '5m',
    lookbackDays: 7,
    valueAreaPct: 0.7,
    enabled: Boolean(upperSymbol),
  });

  const historyUnitStatus = data?.meta?.unit_status ?? '';
  const historyExpectedUnit = historyUnitStatus === 'confirmed_vnd' ? 'VND' : 'index_points';
  // Only per-row `price_unit` markers certify the OHLC fallback; a response-level
  // `unit_status` cannot certify rows that carry no marker (QA #98).
  const historyWithheld = (data?.data?.length ?? 0) > 0 && !(
    ['confirmed_vnd', 'index_points', 'not_applicable'].includes(historyUnitStatus)
    && (data?.data ?? []).every((row) => row.price_unit === historyExpectedUnit)
  );

  const candles = historyWithheld ? [] : (data?.data ?? []);

  const microProfile = microstructure?.data?.volume_profile;
  const hasMicroProfile = Boolean(microProfile?.bins?.length);
  const historicalProfile = hasMicroProfile || data?.meta?.completeness_status === 'partial'
    ? null : calculateHistoricalProfile(candles);
  const profileFromDepth = hasMicroProfile && microProfile?.quality === 'volume_at_price';
  const profileFromTicks = hasMicroProfile && microProfile?.quality === 'trade_ticks';
  const tickFeed = microstructure?.meta?.feed;
  const failures = microstructureFailures(microstructure);
  const tickFailure = microstructureTickFailure(microstructure, failures);
  const depthFailure = failures.price_depth ?? (microstructure?.retainedDepthProfile ? failures.unscoped : undefined);
  const profileInput = profileFromDepth || (!hasMicroProfile && depthFailure) ? 'price_depth' : 'trade_ticks';
  const inputFailure = profileInput === 'price_depth' ? depthFailure : tickFailure;
  const profileFailure = microError?.message || inputFailure || (!hasMicroProfile ? failures.unscoped : undefined);
  const historyFailure = error?.message || data?.error || undefined;
  const profile = hasMicroProfile
    ? (microProfile?.bins ?? []).map((bin) => ({ price: Number(bin.price), volume: Number(bin.volume) }))
    : (historicalProfile ?? []);
  const fallbackValueArea = calculateValueArea(profile);
  const hasData = fallbackValueArea !== null;
  const historicalIncomplete = !hasMicroProfile && historicalProfile === null;
  const unavailableReason = historyWithheld && !hasMicroProfile
    ? 'Volume profile unavailable: historical price units were not certified.'
    : historicalIncomplete
      ? 'Volume profile unavailable: incomplete historical observations.'
      : !hasMicroProfile && candles.length > 0 && candles.every((row) => row.volume === 0)
        ? 'No traded volume in the returned bars.'
        : undefined;
  const usesMicro = hasMicroProfile || (!hasData && !historyFailure && Boolean(profileFailure || isMicroLoading));
  const refreshFailure = usesMicro ? profileFailure : historyFailure;
  const alternateFailure = usesMicro ? (profileInput === 'price_depth' ? tickFailure : depthFailure) : profileFailure;
  const alternateWarning = alternateFailure !== refreshFailure ? alternateFailure : undefined;
  const historyWarning = usesMicro && historyFailure ? `Historical prices: ${historyFailure}` : undefined;
  const unscopedWarning = failures.unscoped !== refreshFailure && failures.unscoped !== alternateWarning
    ? failures.unscoped : undefined;
  const lastDataDate = hasData ? usesMicro
    ? profileFromTicks ? sourceObservation(tickFeed?.source_as_of) : null
    : data?.meta?.freshness_as_of ?? data?.meta?.last_data_date ?? candles.at(-1)?.time ?? null
    : null;
  const fetchedAt = usesMicro ? (profileFromTicks ? sourceObservation(tickFeed?.fetched_at) : null) ?? microUpdatedAt : dataUpdatedAt;
  const seriesFetching = usesMicro ? isMicroFetching : isFetching;
  const isRetained = hasData && (usesMicro
    ? Boolean(microError || (profileFromTicks ? tickFeed?.fallback : microstructure?.retainedDepthProfile))
    : Boolean(historyFailure));
  const primaryLoading = isMicroLoading || (!hasMicroProfile && isLoading);
  const observationStatus = hasData ? 'available' : primaryLoading ? 'loading'
    : refreshFailure || historyWithheld || historicalIncomplete ? 'unavailable' : 'empty';
  const refreshStatus = refreshFailure ? 'failed' : seriesFetching ? 'refreshing'
    : (usesMicro ? microstructure : data) ? 'succeeded' : undefined;
  const intraday = useMemo(() => usesMicro
    ? microstructureProvenance(microstructure, profileInput, { hasData, failure: inputFailure, requestError: microError })
    : undefined, [usesMicro, microstructure, profileInput, hasData, inputFailure, microError]);
  const { timedOut, resetTimeout } = useLoadingTimeout(primaryLoading && !hasData, { timeoutMs: 8_000 });

  const maxVolume = profile.reduce((max, bin) => Math.max(max, bin.volume), 0);
  // A positive-volume profile can supply levels when the trade-tick summary omits them (DQ-024).
  const pickFinite = (...vals: Array<number | null | undefined>): number | null => {
    for (const v of vals) {
      if (typeof v === 'number' && Number.isFinite(v)) return v;
    }
    return null;
  };
  const pocPrice = fallbackValueArea ? pickFinite(hasMicroProfile ? microProfile?.poc_price : null, fallbackValueArea.pocPrice) : null;
  const vahPrice = fallbackValueArea ? pickFinite(hasMicroProfile ? microProfile?.vah_price : null, fallbackValueArea.vahPrice) : null;
  const valPrice = fallbackValueArea ? pickFinite(hasMicroProfile ? microProfile?.val_price : null, fallbackValueArea.valPrice) : null;

  useEffect(() => {
    onDataChange?.(
      buildWidgetRuntime({
        empty: !hasData,
        apiGroup: usesMicro ? '/microstructure' : '/equity',
        endpoint: usesMicro
          ? `/microstructure/${upperSymbol}?interval=5m&lookback_days=7&value_area_pct=0.7`
          : `/equity/historical?symbol=${upperSymbol}`,
        sourceLabel: !usesMicro ? 'Volume profile (derived)'
          : profileInput === 'price_depth' ? 'Volume profile · volume at price' : 'Volume profile · trade ticks',
        lastDataDate,
        fetchedAt,
        cached: isRetained,
        coverage: 'unknown',
        observationStatus,
        refreshStatus,
        intraday,
        warnings: [refreshFailure, alternateWarning, historyWarning, unscopedWarning]
          .filter((reason): reason is string => Boolean(reason)),
        derived: hasData && !usesMicro,
        extra: hasData ? { bins: profile.length, pocPrice } : undefined,
      }),
    );
  }, [onDataChange, hasData, usesMicro, profileInput, isRetained, lastDataDate, fetchedAt, upperSymbol, profile.length,
    pocPrice, observationStatus, refreshStatus, intraday, refreshFailure, alternateWarning, historyWarning, unscopedWarning]);

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to view volume profile" icon={<BarChart2 size={18} />} />;
  }

  if (timedOut && primaryLoading && !hasData) {
    return <WidgetError title="Loading timed out" error={new Error('Volume profile data took too long to load.')} onRetry={() => { resetTimeout(); refetchMicro(); refetch(); }} />;
  }

  const warning = [hasData && refreshFailure, alternateWarning, historyWarning, unscopedWarning].filter(Boolean).join('; ');

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-1 py-1 mb-2">
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <BarChart2 size={12} className="text-[var(--color-accent-primary)]" />
          <span>Volume Profile</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            {QUANT_PERIOD_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setPeriod(option)}
                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${period === option ? 'bg-[var(--color-accent-fill)] text-[var(--color-on-accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}
              >
                {option}
              </button>
            ))}
          </div>
          <WidgetMeta
            updatedAt={lastDataDate}
            fetchedAt={fetchedAt}
            isFetching={seriesFetching && hasData}
            isCached={isRetained}
            health={intraday && hasData ? deriveWidgetHealth({
              intraday, observationStatus, refreshStatus, updatedAt: lastDataDate, cached: isRetained, coverage: 'unknown',
            }) : undefined}
            note={hasMicroProfile ? `Mongo • ${microProfile?.quality || 'profile'}` : hasData ? `${period} • 24 bins` : period}
            align="right"
          />
        </div>
      </div>
      {warning && !primaryLoading && <p role="status" className="mb-1 text-[11px] text-[var(--color-warning)]">{warning}</p>}

      {primaryLoading && !hasData ? (
        <WidgetSkeleton lines={10} />
      ) : refreshFailure && !hasData ? (
        <WidgetError title={unavailableReason ?? 'Volume profile unavailable'} error={new Error(refreshFailure)} onRetry={() => { refetchMicro(); refetch(); }} />
      ) : !hasData ? (
        <WidgetEmpty message={unavailableReason ?? 'No volume profile data'} icon={<BarChart2 size={18} />} />
      ) : (
      <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid grid-cols-3 gap-2 text-[10px] mb-2">
        <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1" title="Point of Control · price level with the highest traded volume in the lookback window. VND/share.">
          <div className="text-[var(--text-muted)] uppercase tracking-widest">POC <span className="ml-1 text-[8px] normal-case tracking-normal opacity-60">VND/share</span></div>
          <div className="text-[var(--color-accent-primary)] font-mono">{pocPrice != null ? pocPrice.toFixed(2) : '-'}</div>
        </div>
        <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1" title="Value Area High · upper bound of the price range that contained 70% of volume.">
          <div className="text-[var(--text-muted)] uppercase tracking-widest">VAH <span className="ml-1 text-[8px] normal-case tracking-normal opacity-60">VND/share</span></div>
          <div className="text-[var(--color-positive)] font-mono">{vahPrice != null ? vahPrice.toFixed(2) : '-'}</div>
        </div>
        <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1" title="Value Area Low · lower bound of the price range that contained 70% of volume.">
          <div className="text-[var(--text-muted)] uppercase tracking-widest">VAL <span className="ml-1 text-[8px] normal-case tracking-normal opacity-60">VND/share</span></div>
          <div className="text-[var(--color-warning)] font-mono">{valPrice != null ? valPrice.toFixed(2) : '-'}</div>
        </div>
      </div>

      <div className="flex-1 overflow-auto space-y-1 pr-1">
        {profile
          .slice()
          .reverse()
          .map((bin, index) => {
            const widthPct = maxVolume > 0 ? (bin.volume / maxVolume) * 100 : 0;
            const isPOC = pocPrice !== null && Math.abs(bin.price - pocPrice) < Number.EPSILON;
            const isInValueArea =
              vahPrice !== null && valPrice !== null && bin.price >= valPrice && bin.price <= vahPrice;
            const showPriceLabel = profile.length <= 14 || index % 2 === 0 || isPOC || isInValueArea;

            return (
              <div key={`${bin.price}-${index}`} className="flex items-center gap-2">
                <div className="w-16 text-[9px] text-[var(--text-muted)] shrink-0 font-mono" title={bin.price.toFixed(2)}>
                  {showPriceLabel ? bin.price.toFixed(2) : '·'}
                </div>
                <div className="flex-1 h-4 bg-[var(--bg-tertiary)] rounded overflow-hidden relative">
                  <div
                    className={`h-full ${
                      isPOC
                        ? 'bg-[var(--color-state-bg)]'
                        : isInValueArea
                          ? 'bg-[var(--color-positive-bg)]'
                          : 'bg-[var(--text-muted)]/45'
                    }`}
                    style={{ width: `${Math.max(2, widthPct)}%` }}
                  />
                </div>
                <div className="w-14 text-[10px] text-[var(--text-secondary)] text-right shrink-0">{formatVolume(bin.volume)}</div>
              </div>
            );
          })}
      </div>
      </div>
      )}
    </div>
  );
}

export default VolumeProfileWidget;
