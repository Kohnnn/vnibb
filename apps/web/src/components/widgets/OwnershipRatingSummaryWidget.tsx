'use client';

import { useEffect, useMemo } from 'react';
import { ShieldCheck, ShieldX, Users } from 'lucide-react';

import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetEmpty, WidgetError } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { useForeignTrading, useInsiderSentiment, useShareholders } from '@/lib/queries';
import { FOREIGN_WINDOW_SESSIONS, buildOwnershipSummary } from '@/lib/ownershipAnalytics';
import { buildWidgetRuntime } from '@/lib/widgetRuntime';
import { EMPTY_VALUE, formatNumber } from '@/lib/units';
import type { WidgetHealthState } from '@/lib/widgetHealth';
import type { WidgetDataPayload } from '@/lib/widgetRuntime';
import { getMarketState } from '@/lib/marketHours';
import { parseForeignTradingSnapshotTime } from './ForeignTradingWidget';
import { foreignFlowRefreshFailed, foreignFlowWarnings } from '@/lib/foreignFlowProvenance';
import { signedToneClass } from '@/lib/priceColor';

interface OwnershipRatingSummaryWidgetProps {
  id: string;
  symbol: string;
  onRemove?: () => void;
  onDataChange?: (data: WidgetDataPayload) => void;
}

function formatPct(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return EMPTY_VALUE
  return `${value.toFixed(2)}%`
}

function formatCompact(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return EMPTY_VALUE
  const abs = Math.abs(value)
  if (abs >= 1e6) return `${value < 0 ? '-' : ''}${(abs / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${value < 0 ? '-' : ''}${(abs / 1e3).toFixed(1)}K`
  return formatNumber(value, { decimals: 0 })
}

export function OwnershipRatingSummaryWidget({ id, symbol, onRemove, onDataChange }: OwnershipRatingSummaryWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || ''
  const shareholdersQuery = useShareholders(upperSymbol, Boolean(upperSymbol))
  const foreignQuery = useForeignTrading(upperSymbol, {
    sessions: FOREIGN_WINDOW_SESSIONS,
    enabled: Boolean(upperSymbol),
  })
  const insiderQuery = useInsiderSentiment(upperSymbol, { days: 90, enabled: Boolean(upperSymbol) })

  const shareholders = shareholdersQuery.data?.data
  const foreignFlow = foreignQuery.data?.data
  const foreignCoverage = foreignQuery.data?.meta
  const insider = insiderQuery.data
  const shareholderError = useMemo(() => shareholdersQuery.error || (shareholdersQuery.data?.error ? new Error(shareholdersQuery.data.error) : null), [shareholdersQuery.error, shareholdersQuery.data?.error])
  const summary = useMemo(
    () => buildOwnershipSummary(shareholders, foreignFlow, insider, foreignCoverage),
    [shareholders, foreignFlow, insider, foreignCoverage],
  )
  const foreignWarnings = useMemo(
    () => foreignFlowWarnings(foreignQuery.data, summary.foreignFlowCoverage.windowVerified),
    [foreignQuery.data, summary.foreignFlowCoverage.windowVerified],
  )
  const foreignFailed = foreignFlowRefreshFailed(Boolean(foreignQuery.error), foreignWarnings)
  const hasData = summary.availableSources > 0 || Boolean(foreignFlow?.length)
  const isLoading = (shareholdersQuery.isLoading || foreignQuery.isLoading || insiderQuery.isLoading) && !hasData
  const isFetching = shareholdersQuery.isFetching || foreignQuery.isFetching || insiderQuery.isFetching
  const error = shareholderError || foreignQuery.error || insiderQuery.error
    || (foreignFailed ? new Error('Foreign flow refresh failed') : null)
  const fetchedAt = Math.max(shareholdersQuery.dataUpdatedAt, foreignQuery.dataUpdatedAt, insiderQuery.dataUpdatedAt) || null
  const foreignDate = summary.foreignFlowCoverage.calendarVerified ? summary.foreignFlowCoverage.lastValidatedSession : null
  const foreignSnapshot = parseForeignTradingSnapshotTime(foreignDate)
  const foreignSnapshotTime = foreignSnapshot?.getTime()
  const foreignAgeHours = foreignSnapshotTime !== undefined && Number.isFinite(foreignSnapshotTime) && foreignSnapshotTime <= Date.now()
    ? (Date.now() - foreignSnapshotTime) / (1000 * 60 * 60)
    : null
  const foreignAsOf = foreignAgeHours === null ? null : foreignDate
  const foreignStale = foreignAgeHours !== null && foreignAgeHours >= 12
    && !(getMarketState().phase === 'weekend' && foreignAgeHours <= 96)
  const gradeTone = summary.grade === 'A' ? 'text-[var(--color-positive)]' : summary.grade === 'B' ? 'text-[var(--color-accent-primary)]' : summary.grade === 'C' ? 'text-[var(--color-warning)]' : summary.grade === 'D' ? 'text-[var(--color-negative)]' : 'text-[var(--text-muted)]'
  const warnings = useMemo(() => {
    const inputs = [
      ['Shareholders', { ...shareholdersQuery, error: shareholderError }, summary.holderCount !== null && summary.holderCount > 0],
      ['Foreign flow', { ...foreignQuery, error: foreignFailed ? new Error('Foreign flow refresh failed') : null }, Boolean(foreignFlow?.length)],
      ['Insider sentiment', insiderQuery, summary.insiderNetValue !== null],
    ] as const
    const coverage = summary.foreignFlowCoverage
    const coverageNote = coverage.windowVerified && coverage.status !== 'complete'
      ? [`Foreign flow: ${coverage.observedSessions}/${coverage.requestedSessions} ${coverage.calendarVerified ? 'qualifying' : 'candidate'} sessions; requested ${coverage.requestedStartDate} to ${coverage.requestedEndDate}; returned ${coverage.startDate ?? 'none'} to ${coverage.endDate ?? 'none'}; ${coverage.gapSessions ?? 'unknown'} missing, ${coverage.nullSessions} null; ${coverage.requestedSessions}D total withheld.`]
      : coverage.status === 'partial'
        ? [`Foreign flow: retained history (${coverage.startDate ?? 'unknown'} to ${coverage.endDate ?? 'unknown'}); requested ${coverage.requestedSessions}-session range and coverage unverified; ${coverage.requestedSessions}D total withheld.`]
        : []
    return inputs.flatMap(([name, query, usable]) => query.error
      ? [`${name}: ${usable ? 'refresh failed; retained data may be stale' : 'unavailable (request failed)'}.`]
      : !usable ? [`${name}: ${query.isLoading ? 'loading' : 'no usable observations'}.`] : [])
      .concat(foreignWarnings.map((warning) => `Foreign flow: ${warning}`))
      .concat(coverageNote ?? [])
      .concat(coverage.warning && coverage.status !== 'partial' ? [`Foreign flow: ${coverage.warning}.`] : [])
      .concat(summary.holderCount && summary.ownershipUnitStatus !== 'explicit' ? ['Ownership percentages withheld: explicit source-unit evidence unavailable.'] : [])
      .concat(summary.score === null ? ['Composite withheld until all three inputs and ownership percentage units are usable.'] : [])
  }, [foreignWarnings, foreignFailed, foreignFlow?.length, shareholderError, shareholdersQuery.isLoading, foreignQuery.isLoading, insiderQuery.error, insiderQuery.isLoading, summary])
  const ownershipHealth: WidgetHealthState | undefined = error && hasData
    ? { status: 'stale', label: 'Refresh failed', detail: warnings.join(' ') }
    : foreignStale
      ? { status: 'stale', label: 'Foreign flow stale', detail: `Foreign flow was last observed on ${foreignAsOf}.` }
      : summary.coverage !== 'complete' && !isLoading
        ? { status: hasData ? 'limited' : 'coverage_gap', label: hasData ? 'Partial ownership view' : 'Coverage gap', detail: warnings.join(' ') }
        : undefined

  useEffect(() => {
    onDataChange?.(buildWidgetRuntime({
      empty: !hasData,
      apiGroup: '/equity + /insider',
      endpoint: `/api/v1/equity/${upperSymbol}/shareholders; /api/v1/equity/${upperSymbol}/foreign-trading; /api/v1/insider/${upperSymbol}/sentiment`,
      sourceLabel: foreignAsOf ? 'Shareholders + foreign flow + insider sentiment (foreign flow as-of only)' : 'Shareholders + foreign flow + insider sentiment',
      derived: true,
      lastDataDate: foreignAsOf,
      fetchedAt,
      coverage: summary.coverage,
      stale: Boolean((error && hasData) || foreignStale),
      cached: Boolean(error && hasData),
      warnings,
      extra: { ...summary, warnings },
      exportData: { ...summary, warnings },
    }))
  }, [error, fetchedAt, foreignAsOf, foreignStale, hasData, onDataChange, summary, upperSymbol, warnings])

  const refresh = () => {
    void shareholdersQuery.refetch()
    void foreignQuery.refetch()
    void insiderQuery.refetch()
  }

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to view ownership summary" icon={<Users size={18} />} />
  }

  return (
    <WidgetContainer
      title="Ownership Rating Summary"
      subtitle="Concentration, foreign participation, and insider bias"
      symbol={upperSymbol}
      widgetId={id}
      onClose={onRemove}
      onRefresh={refresh}
      noPadding
      exportData={{ ...summary, warnings }}
      exportFilename={`ownership_rating_summary_${upperSymbol}`}
    >
      <div className="flex h-full flex-col bg-[var(--bg-primary)] p-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            {summary.grade && (summary.grade === 'A' || summary.grade === 'B' ? <ShieldCheck size={20} className="text-[var(--color-positive)]" /> : <ShieldX size={20} className="text-[var(--color-negative)]" />)}
            <div>
              <div className={`text-2xl font-black ${gradeTone}`}>{summary.grade ?? EMPTY_VALUE}</div>
              <div className="text-[11px] text-[var(--text-secondary)]">{summary.stance ?? 'Ownership rating unavailable'}</div>
            </div>
          </div>
          <WidgetMeta updatedAt={foreignAsOf} fetchedAt={fetchedAt} isFetching={isFetching && hasData} sourceLabel={foreignAsOf ? 'Foreign flow as-of only' : undefined} note={summary.holderCount !== null ? `${summary.holderCount} reported holders` : 'Holder count unavailable'} health={ownershipHealth} align="right" />
        </div>
        {(hasData || summary.foreignFlowCoverage.windowVerified) && warnings.length > 0 && <p role="status" className="mb-3 text-[11px] text-[var(--text-secondary)]">{warnings.join(' ')}</p>}

        {isLoading ? (
          <WidgetSkeleton lines={6} />
        ) : error && !hasData ? (
          <WidgetError error={error as Error} onRetry={refresh} />
        ) : !hasData ? (
          <WidgetEmpty
            message={`No ownership summary for ${upperSymbol}`}
            icon={<Users size={18} />}
            health={ownershipHealth}
            size="default"
          />
        ) : (
          <div className="grid flex-1 grid-cols-2 gap-2 xl:grid-cols-4">
            <MetricCard label="Top 3" value={formatPct(summary.top3Pct)} tone="text-[var(--color-accent-primary)]" />
            <MetricCard label="Top 10" value={formatPct(summary.top10Pct)} tone="text-[var(--color-accent-primary)]" />
            <MetricCard
              label={summary.foreignFlowCoverage.status === 'complete'
                ? `Foreign Net ${summary.foreignFlowCoverage.requestedSessions}D`
                : summary.foreignFlowCoverage.status === 'partial'
                  ? 'Foreign Net (partial)'
                  : 'Foreign Net'}
              value={formatCompact(summary.foreignNetVolume)}
              tone={signedToneClass(summary.foreignNetVolume)}
            />
            <MetricCard label="Insider Net 90D" value={formatCompact(summary.insiderNetValue)} tone={signedToneClass(summary.insiderNetValue)} />
            <MetricCard label="Reported Institutional" value={formatCompact(summary.institutionalCount)} tone="text-[var(--text-primary)]" />
            <MetricCard label="Reported Foreign Holders" value={formatCompact(summary.foreignCount)} tone="text-[var(--text-primary)]" />
            <MetricCard label="Reported Insider Holders" value={formatCompact(summary.insiderCount)} tone="text-[var(--text-primary)]" />
            <MetricCard label="Score" value={summary.score !== null ? `${summary.score}/100` : EMPTY_VALUE} tone={gradeTone} />
          </div>
        )}
      </div>
    </WidgetContainer>
  )
}

function MetricCard({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">{label}</div>
      <div className={`mt-2 text-lg font-semibold ${tone}`}>{value}</div>
    </div>
  )
}

export default OwnershipRatingSummaryWidget
