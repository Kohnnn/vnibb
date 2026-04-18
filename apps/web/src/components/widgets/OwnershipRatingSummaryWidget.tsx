'use client';

import { ShieldCheck, ShieldX, Users } from 'lucide-react';

import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetEmpty, WidgetError } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { useForeignTrading, useInsiderSentiment, useShareholders } from '@/lib/queries';
import { buildOwnershipSummary } from '@/lib/ownershipAnalytics';
import { formatNumber } from '@/lib/units';

interface OwnershipRatingSummaryWidgetProps {
  id: string;
  symbol: string;
  onRemove?: () => void;
}

function formatPct(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${value.toFixed(1)}%`
}

function formatCompact(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  if (abs >= 1e6) return `${value < 0 ? '-' : ''}${(abs / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${value < 0 ? '-' : ''}${(abs / 1e3).toFixed(1)}K`
  return formatNumber(value, { decimals: 0 })
}

export function OwnershipRatingSummaryWidget({ id, symbol, onRemove }: OwnershipRatingSummaryWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || ''
  const shareholdersQuery = useShareholders(upperSymbol, Boolean(upperSymbol))
  const foreignQuery = useForeignTrading(upperSymbol, { limit: 20, enabled: Boolean(upperSymbol) })
  const insiderQuery = useInsiderSentiment(upperSymbol, { days: 90, enabled: Boolean(upperSymbol) })

  const shareholders = shareholdersQuery.data?.data || []
  const foreignFlow = foreignQuery.data?.data || []
  const insider = insiderQuery.data || null
  const summary = buildOwnershipSummary(shareholders, foreignFlow, insider)
  const hasData = shareholders.length > 0 || foreignFlow.length > 0 || Boolean(insider)
  const isLoading = (shareholdersQuery.isLoading || foreignQuery.isLoading || insiderQuery.isLoading) && !hasData
  const isFetching = shareholdersQuery.isFetching || foreignQuery.isFetching || insiderQuery.isFetching
  const error = shareholdersQuery.error || foreignQuery.error || insiderQuery.error
  const updatedAt = Math.max(shareholdersQuery.dataUpdatedAt, foreignQuery.dataUpdatedAt, insiderQuery.dataUpdatedAt)
  const gradeTone = summary.grade === 'A' ? 'text-emerald-300' : summary.grade === 'B' ? 'text-cyan-300' : summary.grade === 'C' ? 'text-amber-300' : 'text-rose-300'

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
      onRefresh={() => {
        void shareholdersQuery.refetch()
        void foreignQuery.refetch()
        void insiderQuery.refetch()
      }}
      noPadding
      exportData={{ summary, insider, foreignFlow: foreignFlow.slice(0, 10) }}
      exportFilename={`ownership_rating_summary_${upperSymbol}`}
    >
      <div className="flex h-full flex-col bg-[var(--bg-primary)] p-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            {summary.grade === 'A' || summary.grade === 'B' ? <ShieldCheck size={20} className="text-emerald-300" /> : <ShieldX size={20} className="text-rose-300" />}
            <div>
              <div className={`text-2xl font-black ${gradeTone}`}>{summary.grade}</div>
              <div className="text-[11px] text-[var(--text-secondary)]">{summary.stance}</div>
            </div>
          </div>
          <WidgetMeta updatedAt={updatedAt} isFetching={isFetching && hasData} note={`${summary.holderCount} holders`} align="right" />
        </div>

        {isLoading ? (
          <WidgetSkeleton lines={6} />
        ) : error && !hasData ? (
          <WidgetError error={error as Error} onRetry={() => void shareholdersQuery.refetch()} />
        ) : !hasData ? (
          <WidgetEmpty message="No ownership summary available yet" icon={<Users size={18} />} />
        ) : (
          <div className="grid flex-1 grid-cols-2 gap-2 xl:grid-cols-4">
            <MetricCard label="Top 3" value={formatPct(summary.top3Pct)} tone="text-cyan-300" />
            <MetricCard label="Top 10" value={formatPct(summary.top10Pct)} tone="text-blue-300" />
            <MetricCard label="Foreign Net 20D" value={formatCompact(summary.foreignNetVolume)} tone={summary.foreignNetVolume != null && summary.foreignNetVolume >= 0 ? 'text-emerald-300' : 'text-rose-300'} />
            <MetricCard label="Insider Net 90D" value={formatCompact(summary.insiderNetValue)} tone={summary.insiderNetValue != null && summary.insiderNetValue >= 0 ? 'text-emerald-300' : 'text-rose-300'} />
            <MetricCard label="Institutional" value={String(summary.institutionalCount)} tone="text-[var(--text-primary)]" />
            <MetricCard label="Foreign Holders" value={String(summary.foreignCount)} tone="text-[var(--text-primary)]" />
            <MetricCard label="Insider Holders" value={String(summary.insiderCount)} tone="text-[var(--text-primary)]" />
            <MetricCard label="Score" value={`${summary.score}/100`} tone={gradeTone} />
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
