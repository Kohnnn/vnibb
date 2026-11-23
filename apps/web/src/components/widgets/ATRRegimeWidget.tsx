'use client';

import { EMPTY_VALUE } from '@/lib/units';
import { useEffect, useMemo } from 'react';
import { Gauge, ShieldAlert, TrendingDown, TrendingUp } from 'lucide-react';
import { useHistoricalPrices } from '@/lib/queries';
import { calculateATR } from '@/lib/chartUtils';
import { getHistoricalSessionAdmission, isUsableHistoricalOHLC } from '@/lib/historicalSessionAdmission';
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
  return Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : EMPTY_VALUE;
}

function getRegime(percentile: number) {
  // Volatility regime is an ordinal level, not a direction: low volatility is
  // not a gain. One accent hue, muted at the low end.
  if (percentile < 33) {
    return { label: 'Low Vol', className: 'text-[var(--text-secondary)]', stopMultiple: 1.2 };
  }
  if (percentile < 67) {
    return { label: 'Normal Vol', className: 'text-[var(--text-primary)]', stopMultiple: 1.5 };
  }
  return { label: 'High Vol', className: 'text-[var(--color-accent-primary)]', stopMultiple: 2.0 };
}

const ATR_PERIOD = 14;
const MIN_RANK_POINTS = 21;

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
    adjustmentMode: 'adjusted',
    enabled: Boolean(upperSymbol),
  });

  const meta = data?.meta;
  const candles = useMemo(() => data?.data ?? [], [data]);
  const admission = useMemo(() => getHistoricalSessionAdmission(data), [data]);
  const firstSession = candles[0]?.time ?? null;
  const lastSession = candles.at(-1)?.time ?? null;
  const start = admission.expectedSessionDates.indexOf(firstSession ?? '');
  const end = admission.expectedSessionDates.indexOf(lastSession ?? '');
  const hasInteriorHole = start >= 0 && end - start + 1 !== candles.length;
  const unavailableReason = admission.reason
    ?? (hasInteriorHole ? 'Unresolved interior sessions prevent consecutive true ranges.' : null)
    ?? (candles.every(isUsableHistoricalOHLC) ? null : 'A returned session lacks valid OHLC prices.');
  const atrSeries = useMemo(() => unavailableReason ? [] : calculateATR(candles.map(
    ({ time, open, high, low, close }) => ({ time, open, high, low, close }),
  ), ATR_PERIOD), [candles, unavailableReason]);
  const hasData = atrSeries.length >= MIN_RANK_POINTS;
  const failure = data?.error || error?.message || null;
  const isFallback = Boolean(error && hasData);
  const lastDataDate = [meta?.freshness_as_of, meta?.last_data_date, lastSession]
    .find((value) => value != null && value !== '' && !Number.isNaN(new Date(value).getTime())) ?? null;
  const observationStatus = hasData ? 'available' : isLoading ? 'loading' : 'unavailable';
  const refreshStatus = failure ? 'failed' : isFetching ? 'refreshing' : data ? 'succeeded' : undefined;
  const coverage = meta?.calendar_verified === true ? meta.completeness_status ?? 'unknown' : 'unknown';
  const health = deriveWidgetHealth({ updatedAt: lastDataDate, cached: isFallback, stale: isFallback, observationStatus, refreshStatus, coverage });
  const isStale = health.status === 'stale';
  const admissionReason = hasData || isLoading ? undefined
    : failure ? 'Historical price request failed.'
    : unavailableReason ?? `Need at least ${MIN_RANK_POINTS} ATR observations for rank.`;
  const warnings = useMemo(() => [...new Set([
    ...(meta?.warnings ?? []),
    meta?.completeness_status === 'partial' ? 'Partial historical coverage' : null,
    meta?.unit_status === 'mixed' ? 'Mixed historical price units' : null,
    meta?.unit_status === 'unconfirmed' ? 'Historical price units unconfirmed' : null,
    meta?.fallback_used ? 'Historical source fallback used' : null,
    meta?.adjustment_warning,
    isFallback ? `Latest historical refresh failed; showing previous observations (${failure})` : failure,
    candles.length > 0 && !lastDataDate ? 'Historical observation date unavailable' : null,
    admissionReason,
  ].filter((message): message is string => Boolean(message)))], [meta, isFallback, failure, candles.length, lastDataDate, admissionReason]);

  const lastAtr = hasData ? atrSeries.at(-1)?.value ?? 0 : 0;
  const lastClose = candles.at(-1)?.close ?? 0;
  const atrPct = hasData ? (lastAtr / lastClose) * 100 : 0;
  const atrPctHistory = atrSeries.map((point, i) => (point.value / candles[i + ATR_PERIOD - 1].close) * 100);
  const rank = atrPct > 0 ? percentileRank(atrPctHistory, atrPct) : 0;
  const regime = getRegime(rank);
  const riskBudget = 1_000_000;
  const stopDistance = lastAtr * regime.stopMultiple;
  const sizingAdmitted = hasData && admission.unit === 'VND' && stopDistance > 0;
  const suggestedShares = sizingAdmitted ? Math.floor(riskBudget / stopDistance) : null;
  const suggestedValue = suggestedShares !== null ? suggestedShares * lastClose : null;
  const sizingReason = hasData && !sizingAdmitted
    ? admission.unit === 'index_points' ? 'Share sizing is not applicable to index points.' : 'Share sizing requires a positive stop distance.'
    : null;
  const basis = admission.basis === 'adjusted' ? 'Source-adjusted OHLC, verified daily sessions'
    : admission.basis === 'not_applicable' ? 'Index points, verified daily sessions' : undefined;
  const recentAtr = atrSeries.slice(-12);
  const maxRecentAtr = recentAtr.reduce((max, point) => Math.max(max, point.value), 1);

  useEffect(() => {
    const summary = {
      status: observationStatus, unavailableReason: admissionReason ?? null,
      firstSession, lastSession, admittedSessions: hasData ? candles.length : 0, returnedSessions: candles.length,
      historyCount: atrSeries.length, basis: basis ?? null,
      excludedRows: meta?.excluded_row_count ?? null,
      replacedExcludedDates: meta?.replaced_excluded_dates ?? null,
      unresolvedExcludedDates: meta?.unresolved_excluded_dates ?? null,
      atr: hasData ? lastAtr : null, atrPct: hasData ? atrPct : null, rank: hasData ? rank : null,
      regime: hasData ? regime.label : null, riskBudget: sizingAdmitted ? riskBudget : null,
      stopDistance: sizingAdmitted ? stopDistance : null, suggestedShares, suggestedValue, sizingReason,
    };
    onDataChange?.(buildWidgetRuntime({
      empty: !hasData,
      apiGroup: '/equity',
      endpoint: '/equity/historical',
      endpointKind: 'route_summary',
      sourceLabel: 'Historical OHLC (browser-derived ATR)',
      lastDataDate, fetchedAt: dataUpdatedAt,
      stale: isStale, cached: isFallback,
      warnings, observationStatus, refreshStatus, coverage, admissionReason,
      coverageDetail: {
        requestedStart: meta?.requested_start_date, requestedEnd: meta?.requested_end_date,
        observedStart: firstSession, observedEnd: lastSession,
        requestedSessions: meta?.expected_session_dates?.length,
        observedSessions: candles.length, gapSessions: meta?.missing_session_count,
        calendarVerified: meta?.calendar_verified,
      },
      adjustmentMode: meta?.adjustment_mode, basis, units: admission.unit ?? undefined,
      extra: summary, exportData: summary,
      requestScope: { symbol: upperSymbol },
    }));
  }, [onDataChange, hasData, observationStatus, refreshStatus, coverage, basis, admission.unit,
    firstSession, lastSession, candles.length, atrSeries.length, lastAtr, atrPct, regime.label, rank,
    riskBudget, stopDistance, suggestedShares, suggestedValue, sizingAdmitted, sizingReason, admissionReason, upperSymbol,
    isStale, isFallback, lastDataDate, dataUpdatedAt, warnings, meta]);

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to view ATR regime" icon={<Gauge size={18} />} />;
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-1 py-1 mb-2">
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <Gauge size={12} className="text-[var(--color-accent-primary)]" />
          <span>ATR Regime (14D)</span>
        </div>
        <WidgetMeta
          updatedAt={lastDataDate}
          fetchedAt={dataUpdatedAt}
          isFetching={isFetching && hasData}
          isCached={isFallback}
          isStale={isStale}
          health={health}
          note={failure && !hasData ? undefined : warnings.join(' · ')}
          align="right"
        />
      </div>

      {isLoading && !hasData ? (
        <WidgetSkeleton lines={8} />
      ) : failure && !hasData ? (
        <WidgetError error={error ?? new Error(failure)} onRetry={() => refetch()} />
      ) : data && unavailableReason ? (
        <WidgetEmpty message="ATR regime unavailable" detail={unavailableReason} icon={<ShieldAlert size={18} />} />
      ) : !hasData ? (
        <WidgetEmpty message="Not enough ATR history" icon={<ShieldAlert size={18} />} />
      ) : (
        <>
      <p className="mb-2 text-[10px] text-[var(--text-muted)]">
        {basis} · {candles.length} consecutive sessions ({firstSession} – {lastSession}) · {atrSeries.length} ATR observations for rank
      </p>
      <div className="grid grid-cols-3 gap-2 mb-2 text-[10px]">
        <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
          <div className="text-[var(--text-muted)] uppercase tracking-widest">ATR</div>
          <div className="text-[var(--color-accent-primary)] font-mono">{formatPrice(lastAtr)}</div>
        </div>
        <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
          <div className="text-[var(--text-muted)] uppercase tracking-widest">ATR %</div>
          <div className="text-[var(--color-warning)] font-mono">{atrPct.toFixed(2)}%</div>
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
          {sizingAdmitted && suggestedShares !== null && suggestedValue !== null ? <>
            <div className="text-[var(--text-muted)]">Risk Budget</div>
            <div className="text-right text-[var(--text-primary)] font-mono">{formatCompact(riskBudget)}</div>
            <div className="text-[var(--text-muted)]">Stop Distance</div>
            <div className="text-right text-[var(--text-primary)] font-mono">{formatPrice(stopDistance)}</div>
            <div className="text-[var(--text-muted)]">Suggested Shares</div>
            <div className="text-right text-[var(--color-accent-primary)] font-mono">{suggestedShares.toLocaleString()}</div>
            <div className="text-[var(--text-muted)]">Position Value</div>
            <div className="text-right text-[var(--text-primary)] font-mono">{formatCompact(suggestedValue)}</div>
          </> : <p className="col-span-2 text-[var(--text-muted)]">{sizingReason}</p>}
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
                    className={`h-full ${isRising ? 'bg-[var(--color-warning)]' : 'bg-[var(--color-accent-primary)]'}`} 
                    style={{ width: `${Math.max(2, widthPct)}%` }}
                  />
                </div>
                <div className="w-14 text-[10px] text-[var(--text-secondary)] text-right font-mono">{point.value.toFixed(2)}</div>
                {isRising ? (
                  <TrendingUp size={10} className="text-[var(--color-warning)]" />
                ) : (
                  <TrendingDown size={10} className="text-[var(--color-accent-primary)]" />
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
