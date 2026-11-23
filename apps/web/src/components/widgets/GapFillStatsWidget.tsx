'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowDownCircle, ArrowUpCircle, CalendarClock } from 'lucide-react';
import { useHistoricalPrices } from '@/lib/queries';
import { getHistoricalSessionAdmission } from '@/lib/historicalSessionAdmission';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { QuantWarningBanner } from '@/components/ui/QuantWarningBanner';
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout';
import { getQuantPeriodStartDate, QUANT_PERIOD_OPTIONS, type QuantPeriodOption } from '@/lib/quantPeriods';
import { deriveWidgetHealth } from '@/lib/widgetHealth';
import { buildWidgetRuntime } from '@/lib/widgetRuntime';
import {
  analyzeGapFillStats,
  type GapFillAnalysis,
  FOLLOW_UP_TRADING_SESSIONS,
  MIN_OPENING_GAP_PCT,
  type GapEvent,
} from './gapFillStats';

interface GapFillStatsWidgetProps {
  symbol: string;
  onDataChange?: (data: WidgetDataPayload) => void;
}

const FOLLOW_UP_BASIS = `A fill reaches or crosses the prior close on the gap session (0) or during the next ${FOLLOW_UP_TRADING_SESSIONS} trading sessions. Rates exclude censored gaps; average time uses observed fills only.`;

const formatRate = (rate: number | null) => rate === null ? 'n/a' : `${rate.toFixed(1)}%`;

function GapMetric({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return (
    <div className="min-w-0 rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
      <dt className="text-[var(--text-muted)]">{label}</dt>
      <dd className="font-mono text-[var(--text-primary)]">{value}</dd>
      {detail && <dd className="text-[var(--text-muted)]">{detail}</dd>}
    </div>
  );
}

function GapOutcomeRow({ event }: { event: GapEvent }) {
  const isUp = event.direction === 'up';
  const directionColor = isUp ? 'text-[var(--color-positive)]' : 'text-[var(--color-negative)]';
  const DirectionIcon = isUp ? ArrowUpCircle : ArrowDownCircle;
  let outcomeLabel;
  if (event.outcome === 'filled') {
    const elapsed = event.sessionsToFill;
    outcomeLabel = elapsed === 0 ? 'Filled: same session (0)' : `Filled: ${elapsed} trading ${elapsed === 1 ? 'session' : 'sessions'}`;
  } else if (event.outcome === 'unfilled') {
    outcomeLabel = `Unfilled through ${event.observedThrough}`;
  } else {
    outcomeLabel = `Censored after ${event.observedThrough}`;
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2 py-1 text-[10px]">
      <time dateTime={event.date} className="shrink-0 text-[var(--text-muted)]">{event.date}</time>
      <DirectionIcon size={11} aria-hidden="true" className={directionColor} />
      <span className={`font-mono ${directionColor}`}>{isUp ? '+' : ''}{event.gapPct.toFixed(2)}%</span>
      <span className="ml-auto text-right text-[var(--text-secondary)]" title={`Observed through ${event.observedThrough}`}>{outcomeLabel}</span>
    </div>
  );
}

function GapFillResults({ analysis, priceBasis }: { analysis: GapFillAnalysis; priceBasis: string }) {
  const { events, metrics } = analysis;
  return (
    <>
      <p className="mb-2 text-[10px] text-[var(--text-secondary)]">{priceBasis}. {FOLLOW_UP_BASIS}</p>
      <dl className="mb-2 grid grid-cols-3 gap-2 text-[10px]">
        <GapMetric label="Eligible gaps" value={metrics.gaps} />
        <GapMetric label="Fill rate (resolved)" value={formatRate(metrics.fillRatePct)} detail={`${metrics.filledGaps} of ${metrics.resolvedGaps} resolved gaps filled`} />
        <GapMetric label="Avg trading sessions to fill" value={metrics.avgFillTradingSessions?.toFixed(1) ?? 'n/a'} detail={`${metrics.filledGaps} observed fills`} />
      </dl>
      <dl className="mb-2 grid grid-cols-2 gap-2 text-[10px]">
        <GapMetric label="Gap up fill" value={formatRate(metrics.upFillRatePct)} detail={`${metrics.upFilledGaps} of ${metrics.upResolvedGaps} resolved gaps filled`} />
        <GapMetric label="Gap down fill" value={formatRate(metrics.downFillRatePct)} detail={`${metrics.downFilledGaps} of ${metrics.downResolvedGaps} resolved gaps filled`} />
      </dl>
      <p className="mb-2 text-[10px] text-[var(--text-secondary)]">
        {metrics.filledGaps} filled · {metrics.unfilledGaps} unfilled · {metrics.censoredGaps} censored
      </p>
      {events.length === 0 ? (
        <WidgetEmpty message="No qualifying gaps among eligible comparisons" icon={<CalendarClock size={18} />} />
      ) : (
        <div className="space-y-1">
          {events.slice(-10).reverse().map(event => <GapOutcomeRow key={event.date} event={event} />)}
        </div>
      )}
    </>
  );
}

function GapWindowCoverage({ analysis }: { analysis: GapFillAnalysis }) {
  const { coverageDetail, metrics } = analysis;
  return (
    <>
      <p>
        {coverageDetail.observedSessions}/{coverageDetail.requestedSessions} expected trading sessions usable
        {coverageDetail.observedStart && ` (${coverageDetail.observedStart} to ${coverageDetail.observedEnd})`}.
      </p>
      <p>
        {metrics.eligibleComparisons} eligible comparisons · {metrics.excludedComparisons} excluded
        {metrics.comparisonStart && ` · First/last eligible openings: ${metrics.comparisonStart} to ${metrics.comparisonEnd}`}.
      </p>
    </>
  );
}

function gapCoverageWarning(analysis: GapFillAnalysis | null, partial: boolean) {
  if (!partial || !analysis) return null;
  const { coverageDetail, missingLeadingSessions, missingInteriorSessions, missingTrailingSessions } = analysis;
  if (missingLeadingSessions === null || coverageDetail.gapSessions === 0) return 'Partial historical coverage';
  return `Partial historical coverage: ${missingLeadingSessions} leading, ${missingInteriorSessions} interior, ${missingTrailingSessions} trailing sessions missing or unusable.`;
}

export function GapFillStatsWidget({ symbol, onDataChange }: GapFillStatsWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || '';
  const [period, setPeriod] = useState<QuantPeriodOption>('1Y');
  const startDate = getQuantPeriodStartDate(period);
  const {
    data,
    isLoading,
    error,
    refetch,
    isFetching,
    dataUpdatedAt,
  } = useHistoricalPrices(upperSymbol, {
    startDate,
    interval: '1D',
    adjustmentMode: 'adjusted',
    enabled: Boolean(upperSymbol),
  });

  const meta = data?.meta;
  const admission = useMemo(() => getHistoricalSessionAdmission(data), [data]);
  const analysis = useMemo(() => data && !admission.reason
    ? analyzeGapFillStats(data.data, admission.expectedSessionDates) : null, [admission, data]);
  const exportData = analysis?.metrics.eligibleComparisons ? analysis.metrics : null;
  const hasComparisons = exportData !== null;
  const withholdingReason = data && !hasComparisons
    ? !data.error && (meta?.calendar_verified !== true || !meta.expected_session_dates?.length)
      ? `Exchange sessions are not certified for the selected ${period} window. ${admission.reason}`
      : admission.reason ?? 'No qualified consecutive trading-session comparisons.'
    : null;
  const priceBasis = admission.basis === 'adjusted' ? 'Source-adjusted OHLC (VND)' : 'Index points (adjustment not applicable)';
  const isFallback = Boolean(error && hasComparisons);
  const refreshFailed = Boolean(error || data?.error);
  const { timedOut, resetTimeout } = useLoadingTimeout(isLoading && !data, { timeoutMs: 8_000 });
  const requestedStart = meta?.requested_start_date ?? startDate;
  const requestedEnd = meta?.requested_end_date ?? null;
  const lastDataDate = analysis?.coverageDetail.observedEnd ?? meta?.freshness_as_of ?? meta?.last_data_date ?? null;
  const coverage = !analysis ? 'unknown'
    : (analysis.coverageDetail.gapSessions > 0 || meta?.completeness_status === 'partial') ? 'partial' : 'complete';
  const observationStatus = isLoading && !data && !timedOut ? 'loading' : hasComparisons ? 'available' : 'unavailable';
  const refreshStatus = refreshFailed || timedOut ? 'failed' : isFetching ? 'refreshing' : data ? 'succeeded' : undefined;
  const admissionReason = withholdingReason ?? (timedOut ? 'Historical price request timed out.' : error ? 'Historical price request failed.' : undefined);
  const stale = deriveWidgetHealth({ updatedAt: lastDataDate }).status === 'stale';
  const health = deriveWidgetHealth({ updatedAt: lastDataDate, stale, cached: isFallback, observationStatus, refreshStatus, coverage });
  const warnings = useMemo(() => {
    const messages = [
      refreshFailed && !hasComparisons ? null : withholdingReason,
      gapCoverageWarning(analysis, coverage === 'partial'),
      analysis?.metrics.censoredGaps ? 'Censored gaps had no observed fill before a missing session or the end of the window. They are excluded from fill rates.' : null,
      analysis?.unusableRows ? `Unusable OHLC rows: ${analysis.unusableRows}.` : null,
      meta?.excluded_row_count || meta?.unresolved_session_count
        ? `Unit admission — excluded rows: ${meta.excluded_row_count ?? 'unknown'}; replaced dates: ${meta.replaced_excluded_dates?.length ?? 'unknown'}; unresolved dates: ${meta.unresolved_session_count ?? 'unknown'}.`
        : null,
      isFallback ? 'Latest historical refresh failed; showing previous observations' : null,
      meta?.fallback_used ? 'Historical source fallback used' : null,
      ...(meta?.warnings ?? []),
      meta?.adjustment_warning,
    ];
    return [...new Set(messages.filter((message): message is string => Boolean(message)))];
  }, [analysis, coverage, hasComparisons, isFallback, meta, refreshFailed, withholdingReason]);

  useEffect(() => {
    onDataChange?.(
      buildWidgetRuntime({
        empty: !hasComparisons,
        apiGroup: '/equity',
        endpoint: '/equity/historical',
        endpointKind: 'route_summary',
        sourceLabel: 'Gap fill stats (browser-derived)',
        lastDataDate,
        fetchedAt: dataUpdatedAt,
        cached: isFallback,
        stale,
        observationStatus,
        refreshStatus,
        admissionReason: hasComparisons ? undefined : admissionReason,
        period,
        periodScope: 'local',
        coverage,
        coverageDetail: { requestedStart, requestedEnd, ...analysis?.coverageDetail, calendarVerified: meta?.calendar_verified ?? null },
        adjustmentMode: admission.basis === 'adjusted' ? 'adjusted' : undefined,
        units: admission.unit ? `${admission.unit} prices; percentages and trading sessions` : undefined,
        basis: analysis ? `${priceBasis}. ${FOLLOW_UP_BASIS}` : undefined,
        warnings,
        // Keep the public summary flat for the bounded VniAgent sample.
        exportData,
        requestScope: { symbol: upperSymbol },
      }),
    );
  }, [admission.basis, admission.unit, admissionReason, analysis, coverage, dataUpdatedAt, exportData, hasComparisons,
    isFallback, lastDataDate, meta?.calendar_verified, observationStatus, onDataChange, period, priceBasis, refreshStatus,
    requestedEnd, requestedStart, stale, upperSymbol, warnings]);

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to view gap fill stats" icon={<CalendarClock size={18} />} />;
  }

  return (
    <div className="h-full flex flex-col">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-1 px-1 py-1">
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <CalendarClock size={12} className="text-[var(--color-accent-primary)]" />
          <span>Gap Fill Stats</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            {QUANT_PERIOD_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={period === option}
                onClick={() => setPeriod(option)}
                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${period === option ? 'bg-[var(--color-accent-fill)] text-[var(--color-on-accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}
              >
                {option}
              </button>
            ))}
          </div>
          <WidgetMeta
            updatedAt={lastDataDate}
            fetchedAt={dataUpdatedAt}
            isFetching={isFetching && Boolean(data)}
            isCached={isFallback}
            health={health}
            note={`${period} • ${MIN_OPENING_GAP_PCT}%+ gaps`}
            align="right"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto pr-1">
        <QuantWarningBanner warning={warnings.join(' · ')} className="mb-2" />
        {data && (
          <div className="mb-2 text-[10px] leading-4 text-[var(--text-secondary)]">
            <p>{coverage === 'complete' ? 'Complete historical window · ' : ''}Requested: {requestedStart} to {requestedEnd ?? 'unknown'}.</p>
            {analysis && <GapWindowCoverage analysis={analysis} />}
          </div>
        )}
        {isLoading && !data ? (
          timedOut ? (
            <WidgetError title="Loading timed out" error={new Error('Gap fill statistics took too long to load.')} onRetry={() => {
              resetTimeout();
              refetch();
            }} />
          ) : <WidgetSkeleton lines={8} />
        ) : refreshFailed && !hasComparisons ? (
          <WidgetError title="Gap statistics unavailable" error={new Error('Historical price request failed.')} onRetry={() => refetch()} />
        ) : !hasComparisons || !analysis ? (
          <WidgetEmpty message={withholdingReason ? 'Gap statistics withheld' : 'Gap statistics unavailable'} icon={<CalendarClock size={18} />} />
        ) : (
          <GapFillResults analysis={analysis} priceBasis={priceBasis} />
        )}
      </div>
    </div>
  );
}

export default GapFillStatsWidget;
