'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Sigma, TrendingUp } from 'lucide-react';

import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetEmpty, WidgetError } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { ChartMountGuard } from '@/components/ui/ChartMountGuard';
import * as api from '@/lib/api';
import { queryKeys, useDerivativesContracts } from '@/lib/queries';
import { buildDerivativesCurveRows, classifyDerivativesCurve } from '@/lib/derivativesAnalytics';
import { formatDate } from '@/lib/format';
import { formatNumber, formatPercent } from '@/lib/units';

interface DerivativesAnalyticsWidgetProps {
  id: string;
  onRemove?: () => void;
}

function formatCompact(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—'
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(2)}M`
  if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(1)}K`
  return formatNumber(value, { decimals: 0 })
}

export function DerivativesAnalyticsWidget({ id, onRemove }: DerivativesAnalyticsWidgetProps) {
  const contractsQuery = useDerivativesContracts(true)
  const sortedContracts = useMemo(
    () => [...(contractsQuery.data?.data || [])].sort((left, right) => new Date(left.expiry).getTime() - new Date(right.expiry).getTime()).slice(0, 4),
    [contractsQuery.data?.data]
  )

  const historyQueries = useQueries({
    queries: sortedContracts.map((contract) => ({
      queryKey: queryKeys.derivativesHistory(contract.symbol),
      queryFn: () => api.getDerivativesHistory(contract.symbol),
      staleTime: 60 * 1000,
    })),
  })

  const historyMap = useMemo(
    () => Object.fromEntries(sortedContracts.map((contract, index) => [contract.symbol, historyQueries[index]?.data?.data || []])),
    [historyQueries, sortedContracts]
  )
  const curveRows = useMemo(
    () => buildDerivativesCurveRows(sortedContracts, historyMap),
    [historyMap, sortedContracts]
  )
  const curveState = classifyDerivativesCurve(curveRows)
  const front = curveRows[0]
  const latestCurve = curveRows.filter((row) => row.latestClose !== null).map((row) => ({ tenor: row.daysToExpiry ?? 0, close: row.latestClose, symbol: row.symbol }))

  const hasData = curveRows.some((row) => row.latestClose !== null)
  const isLoading = (contractsQuery.isLoading || historyQueries.some((query) => query.isLoading)) && !hasData
  const isFetching = contractsQuery.isFetching || historyQueries.some((query) => query.isFetching)
  const error = contractsQuery.error || historyQueries.find((query) => query.error)?.error
  const updatedAt = Math.max(contractsQuery.dataUpdatedAt, ...historyQueries.map((query) => query.dataUpdatedAt || 0))

  return (
    <WidgetContainer
      title="Derivatives Analytics"
      subtitle="Front-contract pulse and short futures curve"
      widgetId={id}
      onClose={onRemove}
      onRefresh={() => {
        void contractsQuery.refetch()
        historyQueries.forEach((query) => { void query.refetch() })
      }}
      noPadding
      exportData={curveRows}
      exportFilename="derivatives_analytics"
    >
      <div className="flex h-full flex-col bg-[var(--bg-primary)] p-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <Sigma size={20} className="text-cyan-300" />
            <div>
              <div className="text-lg font-semibold text-[var(--text-primary)] capitalize">{curveState}</div>
              <div className="text-[11px] text-[var(--text-secondary)]">Short curve classification from front to far contracts</div>
            </div>
          </div>
          <WidgetMeta updatedAt={updatedAt} isFetching={isFetching && hasData} note={`${curveRows.length} contracts`} align="right" />
        </div>

        {isLoading ? (
          <WidgetSkeleton lines={7} />
        ) : error && !hasData ? (
          <WidgetError error={error as Error} onRetry={() => void contractsQuery.refetch()} />
        ) : !hasData ? (
          <WidgetEmpty message="No derivatives analytics available yet" icon={<Sigma size={18} />} />
        ) : (
          <div className="flex h-full flex-col gap-3">
            <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
              <MetricCard label="Front Contract" value={front?.symbol || '—'} tone="text-[var(--text-primary)]" />
              <MetricCard label="Front 20D Return" value={formatPercent(front?.return20dPct, { decimals: 1, input: 'percent', clamp: 'yoy_change' })} tone={front?.return20dPct != null && front.return20dPct >= 0 ? 'text-emerald-300' : 'text-rose-300'} />
              <MetricCard label="Front Vol 20D" value={formatPercent(front?.realizedVol20dPct, { decimals: 1, input: 'percent', clamp: 'margin' })} tone="text-cyan-300" />
              <MetricCard label="Avg Vol 20D" value={formatCompact(front?.avgVolume20d)} tone="text-[var(--text-primary)]" />
            </div>

            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3">
              <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-[var(--text-muted)]">
                <TrendingUp size={12} />
                Short Curve
              </div>
              <ChartMountGuard className="min-h-[220px]" minHeight={220}>
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={latestCurve} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" />
                    <XAxis dataKey="tenor" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(value) => `${value}d`} />
                    <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} width={56} />
                    <Tooltip formatter={(value) => formatNumber(Number(value), { decimals: 2 })} labelFormatter={(value, payload) => `${payload?.[0]?.payload?.symbol || ''} · ${value} days`} />
                    <Area type="monotone" dataKey="close" stroke="#38bdf8" fill="rgba(56,189,248,0.18)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartMountGuard>
            </div>

            <div className="flex-1 overflow-auto rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3">
              <div className="mb-2 text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Contract Ladder</div>
              <div className="space-y-2">
                {curveRows.map((row) => (
                  <div key={row.symbol} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-semibold text-[var(--text-primary)]">{row.symbol}</div>
                        <div className="text-[10px] text-[var(--text-muted)]">{formatDate(row.expiry)} • {row.daysToExpiry ?? '—'} days</div>
                      </div>
                      <div className="text-right text-[10px] text-[var(--text-secondary)]">
                        <div>Close {formatNumber(row.latestClose, { decimals: 2 })}</div>
                        <div>Spread {formatPercent(row.spreadToFrontPct, { decimals: 1, input: 'percent', clamp: 'yoy_change' })}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
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

export default DerivativesAnalyticsWidget
